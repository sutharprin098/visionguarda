-- ============================================================
-- CamAI Enterprise Platform — Migration 0047
-- Interactive 2D Floor Plan / GIS Map Support
-- ============================================================

-- ---------- 1. Register new permissions ----------
insert into public.permissions (key, description) values
  ('maps.manage', 'Create, update, delete floor plans and assign cameras/permissions'),
  ('maps.view', 'View permitted interactive floor plans and camera placements')
on conflict (key) do nothing;

-- ---------- 2. Create tables ----------

-- Floor plans metadata
create table public.floor_plans (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null,
  image_url   text not null, -- Path inside the 'maps' storage bucket
  created_at  timestamptz not null default now()
);
create index floor_plans_org_idx on public.floor_plans(org_id);

-- Placed cameras on floor plans
create table public.floor_plan_cameras (
  floor_plan_id uuid not null references public.floor_plans(id) on delete cascade,
  camera_id     uuid not null references public.cameras(id) on delete cascade,
  x             real not null check (x >= 0 and x <= 100), -- percentage X (0-100)
  y             real not null check (y >= 0 and y <= 100), -- percentage Y (0-100)
  heading_deg   real not null default 0,                  -- rotation angle
  primary key (floor_plan_id, camera_id)
);

-- User viewing permissions for floor plans (for non-admin users)
create table public.floor_plan_permissions (
  floor_plan_id uuid not null references public.floor_plans(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  assigned_by   uuid references public.profiles(id),
  assigned_at   timestamptz not null default now(),
  primary key (floor_plan_id, user_id)
);

-- ---------- 3. Row Level Security ----------

alter table public.floor_plans enable row level security;
alter table public.floor_plan_cameras enable row level security;
alter table public.floor_plan_permissions enable row level security;

-- Floor Plans policies
create policy floor_plans_read on public.floor_plans for select
  using (
    org_id = app.current_org_id()
    and (
      app.has_perm('maps.manage')
      or exists (
        select 1 from public.floor_plan_permissions fpp
        where fpp.floor_plan_id = id and fpp.user_id = auth.uid()
      )
    )
  );

create policy floor_plans_write on public.floor_plans for all
  using (
    org_id = app.current_org_id()
    and app.has_perm('maps.manage')
  );

-- Floor Plan Cameras policies
create policy floor_plan_cams_read on public.floor_plan_cameras for select
  using (
    exists (
      select 1 from public.floor_plans fp
      where fp.id = floor_plan_id
        and fp.org_id = app.current_org_id()
        and (
          app.has_perm('maps.manage')
          or exists (
            select 1 from public.floor_plan_permissions fpp
            where fpp.floor_plan_id = fp.id and fpp.user_id = auth.uid()
          )
        )
    )
  );

create policy floor_plan_cams_write on public.floor_plan_cameras for all
  using (
    exists (
      select 1 from public.floor_plans fp
      where fp.id = floor_plan_id
        and fp.org_id = app.current_org_id()
        and app.has_perm('maps.manage')
    )
  );

-- Floor Plan Permissions policies
create policy floor_plan_perms_read on public.floor_plan_permissions for select
  using (
    exists (
      select 1 from public.floor_plans fp
      where fp.id = floor_plan_id
        and fp.org_id = app.current_org_id()
        and (
          app.has_perm('maps.manage')
          or user_id = auth.uid()
        )
    )
  );

create policy floor_plan_perms_write on public.floor_plan_permissions for all
  using (
    exists (
      select 1 from public.floor_plans fp
      where fp.id = floor_plan_id
        and fp.org_id = app.current_org_id()
        and app.has_perm('maps.manage')
    )
  );

-- ---------- 4. Storage Bucket ----------
insert into storage.buckets (id, name, public) values
  ('maps', 'maps', false)
on conflict (id) do nothing;

create policy storage_maps_rw on storage.objects for all
  using (bucket_id = 'maps' and (storage.foldername(name))[1] = app.current_org_id()::text)
  with check (bucket_id = 'maps' and (storage.foldername(name))[1] = app.current_org_id()::text);

-- ---------- 5. Realtime Sync ----------
-- Add to realtime publication so the desktop and web clients sync instantly
do $$
begin
  alter publication supabase_realtime add table public.floor_plans;
exception when others then
  raise notice 'floor_plans already in publication';
end $$;

do $$
begin
  alter publication supabase_realtime add table public.floor_plan_cameras;
exception when others then
  raise notice 'floor_plan_cameras already in publication';
end $$;

do $$
begin
  alter publication supabase_realtime add table public.floor_plan_permissions;
exception when others then
  raise notice 'floor_plan_permissions already in publication';
end $$;

-- ---------- 6. Backfill defaults for Manager & Operator roles ----------
-- Backfill existing Managers to get maps.manage and maps.view
insert into public.role_permissions (role_id, permission)
  select r.id, unnest(array['maps.manage', 'maps.view'])
  from public.roles r
  where r.name = 'Manager'
on conflict (role_id, permission) do nothing;

-- Backfill existing Operators & Support Engineers to get maps.view
insert into public.role_permissions (role_id, permission)
  select r.id, 'maps.view'
  from public.roles r
  where r.name in ('Operator', 'Support Engineer', 'Viewer', 'Auditor')
on conflict (role_id, permission) do nothing;

-- ---------- 7. Re-seed org provisioning function to include map permissions ----------
create or replace function app.seed_system_roles(p_org uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare owner_role uuid;
begin
  insert into public.roles (org_id, name, is_system) values
    (p_org, 'Organization Owner', true) returning id into owner_role;
  insert into public.roles (org_id, name, is_system) values
    (p_org, 'Organization Admin', true),
    (p_org, 'Manager', true),
    (p_org, 'Operator', true),
    (p_org, 'Viewer', true),
    (p_org, 'Auditor', true),
    (p_org, 'Support Engineer', true);

  -- owner + admin get everything
  insert into public.role_permissions (role_id, permission)
    select r.id, p.key from public.roles r cross join public.permissions p
    where r.org_id = p_org and r.name in ('Organization Owner','Organization Admin');
  
  -- manager
  insert into public.role_permissions (role_id, permission)
    select r.id, unnest(array['cameras.manage','cameras.assign',
                              'projects.manage','alerts.view','reports.view','incidents.manage',
                              'maps.manage', 'maps.view'])
    from public.roles r where r.org_id = p_org and r.name = 'Manager';

  -- operator
  insert into public.role_permissions (role_id, permission)
    select r.id, unnest(array['alerts.view','reports.view','incidents.manage', 'maps.view'])
    from public.roles r where r.org_id = p_org and r.name = 'Operator';

  -- viewer
  insert into public.role_permissions (role_id, permission)
    select r.id, unnest(array['reports.view', 'maps.view'])
    from public.roles r where r.org_id = p_org and r.name = 'Viewer';

  -- auditor
  insert into public.role_permissions (role_id, permission)
    select r.id, unnest(array['audit.view','reports.view', 'maps.view'])
    from public.roles r where r.org_id = p_org and r.name = 'Auditor';

  -- support engineer
  insert into public.role_permissions (role_id, permission)
    select r.id, unnest(array['support.manage','alerts.view','devices.manage', 'maps.view'])
    from public.roles r where r.org_id = p_org and r.name = 'Support Engineer';

  return owner_role;
end $$;
