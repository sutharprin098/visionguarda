-- ============================================================
-- CamAI Enterprise Platform — Migration 0001
-- Identity, Organizations, Roles/Permissions, Licensing, Devices
-- ============================================================

create extension if not exists pgcrypto;
create extension if not exists postgis;

create schema if not exists app;

-- ------------------------------------------------------------
-- Key generation: PREFIX-XXXX-XXXX-XXXX (crypto-random, never sequential)
-- ------------------------------------------------------------
-- crypto-secure random int helper (uses pgcrypto entropy)
create or replace function app.random_int_between(lo int, hi int)
returns int language sql volatile as $$
  select lo + (get_byte(gen_random_bytes(1), 0) % (hi - lo + 1));
$$;

create or replace function app.generate_key(prefix text)
returns text
language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I
  result text := prefix;
  block text;
  i int; j int;
begin
  for i in 1..3 loop
    block := '';
    for j in 1..4 loop
      block := block || substr(alphabet, 1 + app.random_int_between(0, 31), 1);
    end loop;
    result := result || '-' || block;
  end loop;
  return result;
end $$;

create or replace function app.hash_key(k text)
returns text language sql immutable as $$
  select encode(digest(k, 'sha256'), 'hex');
$$;

-- ------------------------------------------------------------
-- Organizations
-- ------------------------------------------------------------
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  org_code    text not null unique,                    -- ORG-XXXX-XXXX-XXXX
  name        text not null,
  kind        text not null default 'organization'
              check (kind in ('personal', 'organization')),
  plan        text not null default 'trial',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  user_code   text not null unique,                    -- USR-XXXX-XXXX-XXXX
  full_name   text not null default '',
  email       text not null,
  status      text not null default 'active'
              check (status in ('active','suspended','locked','disabled')),
  is_super_admin boolean not null default false,       -- platform staff only
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index profiles_org_idx on public.profiles(org_id);

-- ------------------------------------------------------------
-- Roles & Permissions (org-scoped, unlimited custom roles)
-- ------------------------------------------------------------
create table public.permissions (
  key         text primary key,           -- e.g. 'users.create', 'cameras.assign'
  description text not null default ''
);

create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null,
  is_system   boolean not null default false,          -- owner/admin/manager/operator/viewer/auditor
  created_at  timestamptz not null default now(),
  unique (org_id, name)
);

create table public.role_permissions (
  role_id     uuid not null references public.roles(id) on delete cascade,
  permission  text not null references public.permissions(key) on delete cascade,
  primary key (role_id, permission)
);

create table public.user_roles (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role_id     uuid not null references public.roles(id) on delete cascade,
  primary key (user_id, role_id)
);

insert into public.permissions (key, description) values
  ('org.manage',        'Edit organization settings & billing'),
  ('users.manage',      'Create/suspend/delete users, reset passwords'),
  ('roles.manage',      'Create roles and assign permissions'),
  ('licenses.manage',   'Issue/revoke/transfer licenses'),
  ('devices.manage',    'View/rename/deactivate/reset devices'),
  ('cameras.manage',    'Add/edit/delete cameras and NVRs'),
  ('cameras.assign',    'Assign cameras to users'),
  ('gis.manage',        'Create sites, zones, ROI layers'),
  ('gis.assign',        'Assign GIS layers to users'),
  ('ai.configure',      'Change AI models, thresholds, inference settings'),
  ('alerts.view',       'View alerts'),
  ('reports.view',      'View analytics & reports'),
  ('audit.view',        'View audit logs'),
  ('projects.manage',   'Create projects and assign members');

-- ------------------------------------------------------------
-- Licenses
-- ------------------------------------------------------------
create table public.licenses (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  user_id       uuid references public.profiles(id) on delete set null,
  key_hash      text not null unique,                  -- sha256(license key) — lookup/verify
  key_hint      text not null,                         -- 'LIC-••••-••••-QM71' display only
  kind          text not null default 'user' check (kind in ('user','admin')),
  status        text not null default 'active'
                check (status in ('active','inactive','expired','suspended','revoked','pending')),
  max_devices   int  not null default 1,
  expires_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index licenses_org_idx  on public.licenses(org_id);
create index licenses_user_idx on public.licenses(user_id);

-- ------------------------------------------------------------
-- Devices & Activations (desktop binding)
-- ------------------------------------------------------------
create table public.devices (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  user_id          uuid references public.profiles(id) on delete set null,
  name             text not null default 'Windows PC',
  fingerprint_hash text not null,                      -- sha256(CPU+board+disk+TPM+MachineGuid+OS)
  os_info          jsonb not null default '{}'::jsonb,
  status           text not null default 'active'
                   check (status in ('active','deactivated','removed')),
  last_seen_at     timestamptz,
  created_at       timestamptz not null default now(),
  unique (org_id, fingerprint_hash)
);
create index devices_org_idx on public.devices(org_id);

create table public.license_activations (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  license_id   uuid not null references public.licenses(id) on delete cascade,
  device_id    uuid not null references public.devices(id) on delete cascade,
  activated_at timestamptz not null default now(),
  revoked_at   timestamptz,
  unique (license_id, device_id)
);

create table public.desktop_sessions (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  device_id    uuid not null references public.devices(id) on delete cascade,
  app_version  text not null default '',
  started_at   timestamptz not null default now(),
  last_ping_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- RLS helpers
-- ------------------------------------------------------------
create or replace function app.current_org_id()
returns uuid language sql stable security definer set search_path = public as $$
  select org_id from public.profiles where id = auth.uid();
$$;

create or replace function app.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_super_admin from public.profiles where id = auth.uid()), false);
$$;

create or replace function app.has_perm(perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select app.is_super_admin() or exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    where ur.user_id = auth.uid() and rp.permission = perm
  );
$$;

-- ------------------------------------------------------------
-- RLS policies — hard org isolation on every table
-- ------------------------------------------------------------
alter table public.organizations       enable row level security;
alter table public.profiles            enable row level security;
alter table public.roles               enable row level security;
alter table public.role_permissions    enable row level security;
alter table public.user_roles          enable row level security;
alter table public.permissions         enable row level security;
alter table public.licenses            enable row level security;
alter table public.devices             enable row level security;
alter table public.license_activations enable row level security;
alter table public.desktop_sessions    enable row level security;

create policy org_read on public.organizations for select
  using (id = app.current_org_id() or app.is_super_admin());
create policy org_update on public.organizations for update
  using (id = app.current_org_id() and app.has_perm('org.manage'));

create policy perm_read on public.permissions for select using (true);

create policy profiles_read on public.profiles for select
  using (org_id = app.current_org_id() or app.is_super_admin());
create policy profiles_self_update on public.profiles for update
  using (id = auth.uid() or (org_id = app.current_org_id() and app.has_perm('users.manage')));

create policy roles_read on public.roles for select
  using (org_id = app.current_org_id() or app.is_super_admin());
create policy roles_write on public.roles for all
  using (org_id = app.current_org_id() and app.has_perm('roles.manage'));

create policy role_perms_read on public.role_permissions for select
  using (exists (select 1 from public.roles r where r.id = role_id and r.org_id = app.current_org_id()));
create policy role_perms_write on public.role_permissions for all
  using (app.has_perm('roles.manage')
         and exists (select 1 from public.roles r where r.id = role_id and r.org_id = app.current_org_id()));

create policy user_roles_read on public.user_roles for select
  using (exists (select 1 from public.profiles p where p.id = user_id and p.org_id = app.current_org_id()));
create policy user_roles_write on public.user_roles for all
  using (app.has_perm('users.manage')
         and exists (select 1 from public.profiles p where p.id = user_id and p.org_id = app.current_org_id()));

create policy licenses_read on public.licenses for select
  using (org_id = app.current_org_id() and (user_id = auth.uid() or app.has_perm('licenses.manage'))
         or app.is_super_admin());
create policy licenses_write on public.licenses for all
  using (org_id = app.current_org_id() and app.has_perm('licenses.manage'));

create policy devices_read on public.devices for select
  using (org_id = app.current_org_id() and (user_id = auth.uid() or app.has_perm('devices.manage'))
         or app.is_super_admin());
create policy devices_write on public.devices for all
  using (org_id = app.current_org_id() and app.has_perm('devices.manage'));

create policy activations_read on public.license_activations for select
  using (org_id = app.current_org_id());

create policy sessions_read on public.desktop_sessions for select
  using (org_id = app.current_org_id());
create policy sessions_self on public.desktop_sessions for all
  using (user_id = auth.uid());

-- ------------------------------------------------------------
-- Provisioning: runs on auth signup (metadata: account_type, full_name, org_name)
-- Creates org + profile + system roles + license. Returns keys via app.provision_result.
-- ------------------------------------------------------------
create table app.provision_results (          -- one-time key delivery, service-role only
  user_id     uuid primary key,
  user_code   text not null,
  org_code    text not null,
  license_key text not null,                  -- plaintext, deleted after first fetch
  created_at  timestamptz not null default now()
);

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
    (p_org, 'Auditor', true);

  -- owner + admin get everything
  insert into public.role_permissions (role_id, permission)
    select r.id, p.key from public.roles r cross join public.permissions p
    where r.org_id = p_org and r.name in ('Organization Owner','Organization Admin');
  -- manager
  insert into public.role_permissions (role_id, permission)
    select r.id, unnest(array['cameras.manage','cameras.assign','gis.manage','gis.assign',
                              'projects.manage','alerts.view','reports.view'])
    from public.roles r where r.org_id = p_org and r.name = 'Manager';
  -- operator
  insert into public.role_permissions (role_id, permission)
    select r.id, unnest(array['alerts.view','reports.view'])
    from public.roles r where r.org_id = p_org and r.name = 'Operator';
  -- viewer
  insert into public.role_permissions (role_id, permission)
    select r.id, unnest(array['reports.view'])
    from public.roles r where r.org_id = p_org and r.name = 'Viewer';
  -- auditor
  insert into public.role_permissions (role_id, permission)
    select r.id, unnest(array['audit.view','reports.view'])
    from public.roles r where r.org_id = p_org and r.name = 'Auditor';

  return owner_role;
end $$;

create or replace function app.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_type        text := coalesce(new.raw_user_meta_data->>'account_type', 'personal');
  v_name        text := coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1));
  v_org_name    text := coalesce(new.raw_user_meta_data->>'org_name', v_name);
  v_org         uuid;
  v_owner_role  uuid;
  v_user_code   text := app.generate_key('USR');
  v_org_code    text := app.generate_key('ORG');
  v_license_key text;
begin
  v_license_key := case when v_type = 'organization'
                        then app.generate_key('ADM') else app.generate_key('LIC') end;

  insert into public.organizations (org_code, name, kind)
  values (v_org_code, v_org_name, case when v_type='organization' then 'organization' else 'personal' end)
  returning id into v_org;

  insert into public.profiles (id, org_id, user_code, full_name, email)
  values (new.id, v_org, v_user_code, v_name, new.email);

  v_owner_role := app.seed_system_roles(v_org);
  insert into public.user_roles (user_id, role_id) values (new.id, v_owner_role);

  insert into public.licenses (org_id, user_id, key_hash, key_hint, kind)
  values (v_org, new.id, app.hash_key(v_license_key),
          split_part(v_license_key,'-',1) || '-••••-••••-' || split_part(v_license_key,'-',4),
          case when v_type='organization' then 'admin' else 'user' end);

  insert into app.provision_results (user_id, user_code, org_code, license_key)
  values (new.id, v_user_code, v_org_code, v_license_key);

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();
