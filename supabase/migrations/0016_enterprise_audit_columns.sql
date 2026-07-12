-- ============================================================
-- CamAI Enterprise Platform — Migration 0016
-- Adds created_by / updated_by / deleted_at (soft delete) to every
-- user-managed CRUD entity, per the enterprise hardening spec for the
-- new project. Deliberately NOT applied to:
--   - audit_logs: append-only by design (no update/delete RLS exists
--     at all — adding mutable audit columns would undermine the
--     immutability guarantee that IS the security feature here).
--   - permissions, camera_health, usage_logs, billing, subscriptions,
--     app_releases, downloads, release_watermark, app.integration_config,
--     app.provision_results: system/telemetry/catalog tables that are
--     never authored by an end user — created_by/updated_by would
--     always be null and deleted_at would never be set, so the columns
--     would be pure noise.
--   - notifications: already has archived_at (0008) serving the same
--     purpose as deleted_at for this table.
--   - license_activations: already has revoked_at (0001) serving the
--     same purpose.
--   - desktop_sessions: ephemeral, invalidated by row deletion already.
-- Junction/assignment tables (role_permissions, user_roles,
-- camera_group_members, camera_assignments, project_members) get
-- created_by only (who made the assignment) — they're hard-deleted on
-- unassign by existing app behavior, which is correct; adding
-- updated_by/deleted_at to a row that's either present or absent adds
-- nothing.
-- ============================================================

-- ---------- audit trigger: extends the existing touch_updated_at ----------
-- (0005 only set updated_at; broaden it to also stamp updated_by, and
-- attach it to every table below instead of just incidents/tickets)
-- Only ever attached to tables that carry both columns (see the
-- attachment loop below) — no need for a jsonb existence probe.
create or replace function app.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

-- 0005 attached the pre-broadened function under a differently-named
-- trigger on support_tickets (`tickets_touch`, not `support_tickets_touch`)
-- — drop it explicitly so the loop below doesn't leave a duplicate that
-- fires app.touch_updated_at() twice per update.
drop trigger if exists tickets_touch on public.support_tickets;

-- ---------- full triad: created_by, updated_by, deleted_at ----------
do $$
declare
  t text;
  tables text[] := array[
    'organizations','roles','licenses','devices','projects','sites',
    'cameras','camera_groups','ai_models','settings','api_keys',
    'incidents','reports','support_tickets'
  ];
begin
  foreach t in array tables loop
    execute format(
      'alter table public.%I
         add column if not exists created_by uuid references auth.users(id) on delete set null default auth.uid(),
         add column if not exists updated_by uuid references auth.users(id) on delete set null,
         add column if not exists deleted_at timestamptz', t);
    execute format(
      'create index if not exists %I on public.%I (deleted_at) where deleted_at is not null',
      t || '_deleted_at_idx', t);
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function app.touch_updated_at()',
      t || '_touch', t);
  end loop;
end $$;

-- profiles: soft-delete only (created_by/updated_by don't apply — the
-- row IS the user, self-authored via the signup trigger)
alter table public.profiles add column if not exists deleted_at timestamptz;
create index if not exists profiles_deleted_at_idx on public.profiles (deleted_at) where deleted_at is not null;

-- junction tables: created_by only (audit trail for who assigned what)
do $$
declare
  t text;
  tables text[] := array[
    'role_permissions','user_roles','camera_group_members',
    'camera_assignments','project_members'
  ];
begin
  foreach t in array tables loop
    execute format(
      'alter table public.%I add column if not exists created_by uuid references auth.users(id) on delete set null default auth.uid()', t);
  end loop;
end $$;

-- ---------- SELECT policies: exclude soft-deleted rows ----------
drop policy if exists org_read on public.organizations;
create policy org_read on public.organizations for select
  using ((id = app.current_org_id() or app.is_super_admin()) and deleted_at is null);

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select
  using ((org_id = app.current_org_id() or app.is_super_admin()) and deleted_at is null);

drop policy if exists roles_read on public.roles;
create policy roles_read on public.roles for select
  using ((org_id = app.current_org_id() or app.is_super_admin()) and deleted_at is null);

drop policy if exists licenses_read on public.licenses;
create policy licenses_read on public.licenses for select
  using ((org_id = app.current_org_id() and (user_id = auth.uid() or app.has_perm('licenses.manage'))
          or app.is_super_admin()) and deleted_at is null);

drop policy if exists devices_read on public.devices;
create policy devices_read on public.devices for select
  using ((org_id = app.current_org_id() and (user_id = auth.uid() or app.has_perm('devices.manage'))
          or app.is_super_admin()) and deleted_at is null);

drop policy if exists projects_read on public.projects;
create policy projects_read on public.projects for select
  using (org_id = app.current_org_id() and deleted_at is null);

drop policy if exists sites_read on public.sites;
create policy sites_read on public.sites for select
  using (org_id = app.current_org_id() and deleted_at is null);

drop policy if exists cameras_read on public.cameras;
create policy cameras_read on public.cameras for select
  using (org_id = app.current_org_id() and deleted_at is null
         and (app.has_perm('cameras.manage')
              or exists (select 1 from public.camera_assignments ca
                         where ca.camera_id = id and ca.user_id = auth.uid())));

drop policy if exists cam_groups_read on public.camera_groups;
create policy cam_groups_read on public.camera_groups for select
  using (org_id = app.current_org_id() and deleted_at is null);

drop policy if exists ai_models_read on public.ai_models;
create policy ai_models_read on public.ai_models for select
  using ((is_public or org_id = app.current_org_id()) and deleted_at is null);

drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select
  using (org_id = app.current_org_id() and deleted_at is null);

drop policy if exists api_keys_read on public.api_keys;
create policy api_keys_read on public.api_keys for select
  using (org_id = app.current_org_id() and (user_id = auth.uid() or app.has_perm('org.manage'))
         and deleted_at is null);

drop policy if exists incidents_read on public.incidents;
create policy incidents_read on public.incidents for select
  using (org_id = app.current_org_id() and app.has_perm('alerts.view') and deleted_at is null);

drop policy if exists reports_read on public.reports;
create policy reports_read on public.reports for select
  using (org_id = app.current_org_id() and app.has_perm('reports.view') and deleted_at is null);

drop policy if exists tickets_read on public.support_tickets;
create policy tickets_read on public.support_tickets for select
  using (org_id = app.current_org_id() and (user_id = auth.uid() or app.has_perm('support.manage'))
         and deleted_at is null);

-- ---------- new table: ai_model_assignments ----------
-- Per-camera (or org-wide default when camera_id is null) AI model
-- overrides. Complements the existing org-wide ai.model/ai.confidence/
-- ai.classes keys in `settings` — those remain the org default; a row
-- here overrides them for one specific camera.
create table public.ai_model_assignments (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  camera_id   uuid references public.cameras(id) on delete cascade,
  model_id    uuid not null references public.ai_models(id) on delete restrict,
  confidence  numeric(3,2) check (confidence between 0.05 and 0.95),
  classes     jsonb,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by  uuid references auth.users(id) on delete set null,
  deleted_at  timestamptz,
  unique (org_id, camera_id)
);

-- The table-level `unique (org_id, camera_id)` only constrains rows
-- where camera_id is not null (Postgres treats NULLs as distinct in
-- unique constraints) — add a partial unique index so an org can't
-- accumulate more than one org-wide default (camera_id is null) row.
create unique index ai_model_assignments_org_default_idx
  on public.ai_model_assignments (org_id) where camera_id is null;

create index ai_model_assignments_org_idx on public.ai_model_assignments (org_id);
create index ai_model_assignments_camera_idx on public.ai_model_assignments (camera_id);
create index ai_model_assignments_deleted_at_idx on public.ai_model_assignments (deleted_at) where deleted_at is not null;

alter table public.ai_model_assignments enable row level security;

create policy ai_model_assignments_read on public.ai_model_assignments for select
  using (org_id = app.current_org_id() and deleted_at is null
         and (app.has_perm('ai.configure')
              or camera_id is null
              or exists (select 1 from public.camera_assignments ca
                         where ca.camera_id = ai_model_assignments.camera_id and ca.user_id = auth.uid())));
create policy ai_model_assignments_write on public.ai_model_assignments for all
  using (org_id = app.current_org_id() and app.has_perm('ai.configure'))
  with check (org_id = app.current_org_id() and app.has_perm('ai.configure'));

create trigger ai_model_assignments_touch before update on public.ai_model_assignments
  for each row execute function app.touch_updated_at();

alter publication supabase_realtime add table public.ai_model_assignments;
