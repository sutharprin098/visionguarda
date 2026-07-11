-- ============================================================
-- CamAI Enterprise Platform — Migration 0004
-- Enterprise expansion: org settings, camera health, incidents,
-- reports, downloads, support, richer profiles/devices/licenses,
-- audit old/new values, license + API-key + stats RPCs
-- ============================================================

-- ------------------------------------------------------------
-- Profile enrichment
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists phone            text not null default '',
  add column if not exists department       text not null default '',
  add column if not exists designation      text not null default '',
  add column if not exists avatar_url       text not null default '',
  add column if not exists last_login_at    timestamptz,
  add column if not exists last_activity_at timestamptz,
  add column if not exists last_ip          inet;

-- ------------------------------------------------------------
-- License types
-- ------------------------------------------------------------
alter table public.licenses
  add column if not exists license_type text not null default 'personal'
  check (license_type in ('personal','enterprise','trial','lifetime','subscription'));

-- ------------------------------------------------------------
-- Device hardware inventory (populated by desktop at activation/heartbeat)
-- ------------------------------------------------------------
alter table public.devices
  add column if not exists hardware  jsonb not null default '{}'::jsonb, -- cpu, ram_gb, gpu, mac, machine_id
  add column if not exists last_ip   inet,
  add column if not exists country   text not null default '',
  add column if not exists is_online boolean not null default false;

-- ------------------------------------------------------------
-- Cameras: plain lat/lng for the UI (geometry kept for PostGIS analytics),
-- AI model assignment, ordering
-- ------------------------------------------------------------
alter table public.cameras
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists ai_model_id uuid references public.ai_models(id) on delete set null;

alter table public.sites
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists address text not null default '';

-- ------------------------------------------------------------
-- Camera health (upserted by the AI engine via service role)
-- ------------------------------------------------------------
create table public.camera_health (
  camera_id    uuid primary key references public.cameras(id) on delete cascade,
  org_id       uuid not null references public.organizations(id) on delete cascade,
  resolution   text not null default '',
  fps          real not null default 0,
  bitrate_kbps int  not null default 0,
  recording    boolean not null default false,
  is_online    boolean not null default false,
  checked_at   timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Organization settings (branding, SMTP, defaults, retention, webhook)
-- ------------------------------------------------------------
create table public.organization_settings (
  org_id          uuid primary key references public.organizations(id) on delete cascade,
  branding        jsonb not null default '{}'::jsonb,  -- logo_path, primary_color, name_override
  theme           text  not null default 'system' check (theme in ('dark','light','system')),
  smtp            jsonb not null default '{}'::jsonb,  -- host, port, username, from (password via edge secret)
  gis             jsonb not null default '{}'::jsonb,  -- default_center, default_zoom, default_style
  camera_defaults jsonb not null default '{}'::jsonb,  -- fps, recording, retention_days
  retention       jsonb not null default '{"recordings_days":30,"alerts_days":90,"audit_days":365}'::jsonb,
  webhook         jsonb not null default '{}'::jsonb,  -- url, secret_set, events[]
  updated_by      uuid references public.profiles(id),
  updated_at      timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Incidents (escalated from alerts, with workflow)
-- ------------------------------------------------------------
create table public.incidents (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  alert_id    uuid references public.alerts(id) on delete set null,
  camera_id   uuid references public.cameras(id) on delete set null,
  title       text not null,
  description text not null default '',
  severity    text not null default 'warning' check (severity in ('info','warning','critical')),
  status      text not null default 'open' check (status in ('open','investigating','resolved','closed')),
  assigned_to uuid references public.profiles(id) on delete set null,
  notes       jsonb not null default '[]'::jsonb,      -- [{by, by_name, at, text}]
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index incidents_org_idx on public.incidents(org_id, status);

-- ------------------------------------------------------------
-- Reports (generated exports, stored in the 'reports' bucket or inline)
-- ------------------------------------------------------------
create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null,
  kind        text not null default 'custom' check (kind in ('daily','weekly','monthly','custom')),
  format      text not null default 'csv' check (format in ('csv','xlsx','pdf')),
  params      jsonb not null default '{}'::jsonb,      -- date range, cameras, metrics
  row_count   int not null default 0,
  storage_path text not null default '',
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Download log (who downloaded which desktop build)
-- ------------------------------------------------------------
create table public.downloads (
  id           bigint generated always as identity primary key,
  org_id       uuid not null references public.organizations(id) on delete cascade,
  user_id      uuid references public.profiles(id) on delete set null,
  release_id   uuid references public.app_releases(id) on delete set null,
  version      text not null default '',
  downloaded_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Support tickets
-- ------------------------------------------------------------
create table public.support_tickets (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete set null,
  subject    text not null,
  priority   text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status     text not null default 'open' check (status in ('open','pending','closed')),
  thread     jsonb not null default '[]'::jsonb,       -- [{by, by_name, at, text}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Audit: old/new values + client context
-- ------------------------------------------------------------
alter table public.audit_logs
  add column if not exists module    text not null default '',
  add column if not exists old_value jsonb,
  add column if not exists new_value jsonb,
  add column if not exists browser   text not null default '',
  add column if not exists os        text not null default '';

-- richer audit rpc — replaces the 0003 4-arg version (dropped to avoid
-- overload ambiguity, since the new signature defaults args 4-9)
drop function if exists public.audit(text, text, text, jsonb);
create or replace function public.audit(
  p_action text, p_target_type text, p_target_id text,
  p_detail jsonb default '{}'::jsonb,
  p_module text default '', p_old jsonb default null, p_new jsonb default null,
  p_browser text default '', p_os text default ''
)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_logs
    (org_id, actor_id, actor_email, action, target_type, target_id, detail,
     module, old_value, new_value, browser, os)
  select p.org_id, p.id, p.email, p_action, p_target_type, p_target_id, p_detail,
         p_module, p_old, p_new, p_browser, p_os
  from public.profiles p where p.id = auth.uid();
$$;

-- ------------------------------------------------------------
-- New permissions + Support Engineer system role (incl. backfill)
-- ------------------------------------------------------------
insert into public.permissions (key, description) values
  ('incidents.manage', 'Create, assign and resolve incidents'),
  ('support.manage',   'Respond to support tickets')
on conflict (key) do nothing;

-- update seeding for future orgs
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

  insert into public.role_permissions (role_id, permission)
    select r.id, p.key from public.roles r cross join public.permissions p
    where r.org_id = p_org and r.name in ('Organization Owner','Organization Admin');
  insert into public.role_permissions (role_id, permission)
    select r.id, unnest(array['cameras.manage','cameras.assign','gis.manage','gis.assign',
                              'projects.manage','alerts.view','reports.view','incidents.manage'])
    from public.roles r where r.org_id = p_org and r.name = 'Manager';
  insert into public.role_permissions (role_id, permission)
    select r.id, unnest(array['alerts.view','reports.view','incidents.manage'])
    from public.roles r where r.org_id = p_org and r.name = 'Operator';
  insert into public.role_permissions (role_id, permission)
    select r.id, unnest(array['reports.view'])
    from public.roles r where r.org_id = p_org and r.name = 'Viewer';
  insert into public.role_permissions (role_id, permission)
    select r.id, unnest(array['audit.view','reports.view'])
    from public.roles r where r.org_id = p_org and r.name = 'Auditor';
  insert into public.role_permissions (role_id, permission)
    select r.id, unnest(array['support.manage','alerts.view','devices.manage'])
    from public.roles r where r.org_id = p_org and r.name = 'Support Engineer';

  return owner_role;
end $$;

-- backfill Support Engineer for existing orgs
insert into public.roles (org_id, name, is_system)
select o.id, 'Support Engineer', true from public.organizations o
where not exists (select 1 from public.roles r where r.org_id = o.id and r.name = 'Support Engineer');
insert into public.role_permissions (role_id, permission)
select r.id, unnest(array['support.manage','alerts.view','devices.manage'])
from public.roles r
where r.name = 'Support Engineer'
  and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id);
-- incidents.manage backfill for managers/operators
insert into public.role_permissions (role_id, permission)
select r.id, 'incidents.manage' from public.roles r
where r.is_system and r.name in ('Manager','Operator')
on conflict do nothing;

-- ------------------------------------------------------------
-- RPC: generate a license (plaintext returned ONCE to the caller)
-- ------------------------------------------------------------
create or replace function public.generate_license(
  p_user_id uuid,
  p_license_type text default 'personal',
  p_expires_at timestamptz default null,
  p_max_devices int default 1
)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app.current_org_id();
  v_key text;
begin
  if not app.has_perm('licenses.manage') then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id and org_id = v_org) then
    raise exception 'user not in your organization';
  end if;
  v_key := app.generate_key('LIC');
  insert into public.licenses (org_id, user_id, key_hash, key_hint, kind, license_type, expires_at, max_devices)
  values (v_org, p_user_id, app.hash_key(v_key),
          'LIC-••••-••••-' || split_part(v_key,'-',4),
          'user', p_license_type, p_expires_at, greatest(p_max_devices, 1));
  perform public.audit('license.generate', 'license', p_user_id::text,
                       jsonb_build_object('type', p_license_type), 'licenses');
  return v_key;
end $$;

-- RPC: reset a license — revoke old, issue fresh key for the same user
create or replace function public.reset_license(p_license_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app.current_org_id();
  lic record;
  v_key text;
begin
  if not app.has_perm('licenses.manage') then
    raise exception 'forbidden';
  end if;
  select * into lic from public.licenses where id = p_license_id and org_id = v_org;
  if lic is null then raise exception 'license not found'; end if;

  update public.licenses set status = 'revoked', updated_at = now() where id = p_license_id;
  update public.license_activations set revoked_at = now()
   where license_id = p_license_id and revoked_at is null;

  v_key := app.generate_key(case when lic.kind = 'admin' then 'ADM' else 'LIC' end);
  insert into public.licenses (org_id, user_id, key_hash, key_hint, kind, license_type, expires_at, max_devices)
  values (v_org, lic.user_id, app.hash_key(v_key),
          split_part(v_key,'-',1) || '-••••-••••-' || split_part(v_key,'-',4),
          lic.kind, lic.license_type, lic.expires_at, lic.max_devices);
  perform public.audit('license.reset', 'license', p_license_id::text, '{}'::jsonb, 'licenses');
  return v_key;
end $$;

-- RPC: create API key (plaintext returned once)
create or replace function public.create_api_key(p_name text, p_scopes text[] default '{}')
returns text language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app.current_org_id();
  v_key text;
begin
  if v_org is null then raise exception 'no profile'; end if;
  v_key := 'CAK-' || encode(gen_random_bytes(24), 'hex');
  insert into public.api_keys (org_id, user_id, name, key_hash, key_hint, scopes)
  values (v_org, auth.uid(), p_name, app.hash_key(v_key),
          'CAK-…' || right(v_key, 6), p_scopes);
  perform public.audit('api_key.create', 'api_key', p_name, '{}'::jsonb, 'settings');
  return v_key;
end $$;

-- RPC: org dashboard stats in one round-trip
create or replace function public.org_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'users',           (select count(*) from public.profiles      where org_id = app.current_org_id()),
    'cameras',         (select count(*) from public.cameras       where org_id = app.current_org_id()),
    'cameras_online',  (select count(*) from public.cameras       where org_id = app.current_org_id() and status = 'online'),
    'devices',         (select count(*) from public.devices       where org_id = app.current_org_id() and status = 'active'),
    'devices_online',  (select count(*) from public.devices       where org_id = app.current_org_id() and is_online),
    'licenses_active', (select count(*) from public.licenses      where org_id = app.current_org_id() and status = 'active'),
    'alerts_today',    (select count(*) from public.alerts        where org_id = app.current_org_id() and created_at > now() - interval '24 hours'),
    'incidents_open',  (select count(*) from public.incidents     where org_id = app.current_org_id() and status in ('open','investigating')),
    'storage_mb',      coalesce((select sum(quantity) from public.usage_logs
                                 where org_id = app.current_org_id() and metric = 'storage_mb'), 0),
    'events_7d',       (select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'count', coalesce(a.n, 0)) order by d.day), '[]'::jsonb)
                        from (select generate_series(current_date - 6, current_date, '1 day')::date as day) d
                        left join (select created_at::date as day, count(*) as n
                                   from public.alerts where org_id = app.current_org_id()
                                     and created_at > current_date - 7 group by 1) a using (day))
  );
$$;

-- RPC: super-admin platform stats
create or replace function public.platform_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when app.is_super_admin() then jsonb_build_object(
    'organizations', (select count(*) from public.organizations),
    'users',         (select count(*) from public.profiles),
    'devices',       (select count(*) from public.devices where status = 'active'),
    'licenses',      (select count(*) from public.licenses where status = 'active'),
    'revenue_cents', coalesce((select sum(amount_cents) from public.billing where status = 'paid'), 0),
    'subscriptions', (select count(*) from public.subscriptions where status = 'active')
  ) else null end;
$$;

-- ------------------------------------------------------------
-- RLS for new tables
-- ------------------------------------------------------------
alter table public.camera_health         enable row level security;
alter table public.organization_settings enable row level security;
alter table public.incidents             enable row level security;
alter table public.reports               enable row level security;
alter table public.downloads             enable row level security;
alter table public.support_tickets       enable row level security;

create policy cam_health_read on public.camera_health for select
  using (org_id = app.current_org_id());

create policy org_settings_read on public.organization_settings for select
  using (org_id = app.current_org_id());
create policy org_settings_write on public.organization_settings for all
  using (org_id = app.current_org_id() and app.has_perm('org.manage'))
  with check (org_id = app.current_org_id() and app.has_perm('org.manage'));

create policy incidents_read on public.incidents for select
  using (org_id = app.current_org_id() and app.has_perm('alerts.view'));
create policy incidents_write on public.incidents for all
  using (org_id = app.current_org_id() and app.has_perm('incidents.manage'))
  with check (org_id = app.current_org_id() and app.has_perm('incidents.manage'));

create policy reports_read on public.reports for select
  using (org_id = app.current_org_id() and app.has_perm('reports.view'));
create policy reports_write on public.reports for insert
  with check (org_id = app.current_org_id() and app.has_perm('reports.view'));

create policy downloads_read on public.downloads for select
  using (org_id = app.current_org_id());
create policy downloads_ins on public.downloads for insert
  with check (org_id = app.current_org_id() and user_id = auth.uid());

create policy tickets_read on public.support_tickets for select
  using (org_id = app.current_org_id() and (user_id = auth.uid() or app.has_perm('support.manage')));
create policy tickets_ins on public.support_tickets for insert
  with check (org_id = app.current_org_id() and user_id = auth.uid());
create policy tickets_update on public.support_tickets for update
  using (org_id = app.current_org_id() and (user_id = auth.uid() or app.has_perm('support.manage')));

-- super-admin org controls
create policy org_super_update on public.organizations for update
  using (app.is_super_admin());
create policy org_super_delete on public.organizations for delete
  using (app.is_super_admin());

-- ------------------------------------------------------------
-- Realtime + storage
-- ------------------------------------------------------------
alter publication supabase_realtime add table
  public.incidents, public.camera_health, public.support_tickets;

insert into storage.buckets (id, name, public) values
  ('branding', 'branding', false),
  ('reports',  'reports',  false)
on conflict (id) do nothing;

create policy storage_branding_rw on storage.objects for all
  using (bucket_id = 'branding' and (storage.foldername(name))[1] = app.current_org_id()::text)
  with check (bucket_id = 'branding' and (storage.foldername(name))[1] = app.current_org_id()::text);
create policy storage_reports_rw on storage.objects for all
  using (bucket_id = 'reports' and (storage.foldername(name))[1] = app.current_org_id()::text)
  with check (bucket_id = 'reports' and (storage.foldername(name))[1] = app.current_org_id()::text);

-- track last login on the profile (used by Users table)
create or replace function app.touch_last_login()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set last_login_at = now() where id = new.user_id;
  return new;
end $$;
drop trigger if exists on_session_created on auth.sessions;
create trigger on_session_created
  after insert on auth.sessions
  for each row execute function app.touch_last_login();
