-- ============================================================
-- CamAI Enterprise Platform — Migration 0044
--
-- "Organization Owner / Organization Admin get every permission" is the stated
-- RBAC rule, and app.seed_system_roles() implements it as:
--
--     insert into role_permissions (role_id, permission)
--       select r.id, p.key from roles r cross join permissions p
--       where r.org_id = p_org and r.name in ('Organization Owner',
--                                             'Organization Admin');
--
-- That is a SNAPSHOT taken at org-creation time, not a standing guarantee. Any
-- permission added to the catalog afterwards is granted to brand-new orgs and
-- silently withheld from every org that already existed — their Owner/Admin
-- rows were written before the key existed. The rule reads as "admins get
-- everything" but degrades to "admins got everything as of the day they signed
-- up", and nothing anywhere reports the divergence.
--
-- This migration makes the rule true continuously:
--   1. Backfills every existing Owner/Admin system role to the full catalog.
--   2. Adds a trigger so a future `insert into permissions` propagates to those
--      roles in the same statement.
--
-- Deliberately scoped to is_system Owner/Admin roles only. A custom role named
-- "Organization Admin" is NOT swept up (see the is_system check): roles_update
-- in 0015 has no is_system guard, so anyone holding roles.manage can rename a
-- role, and keying an all-permissions grant on a mutable name would hand them
-- privilege escalation. is_system is only ever set by the seeding function.
--
-- NOTE: this is the recurrence fix, not the Cameras-lockout fix. That bug was
-- the portal asking for `cameras.read`, a key that is not in this catalog and
-- therefore could never be granted to anyone — corrected in the portal to the
-- key RLS actually gates on (cameras.manage). No new permission keys are
-- introduced here on purpose: adding `cameras.read` to the catalog would mean
-- rewriting every RLS policy that currently reads `has_perm('cameras.manage')`,
-- which is a schema change, not a bug fix.
-- ============================================================

-- ---------- 1. Backfill existing orgs ----------
insert into public.role_permissions (role_id, permission)
  select r.id, p.key
  from public.roles r
  cross join public.permissions p
  where r.is_system
    and r.name in ('Organization Owner', 'Organization Admin')
on conflict (role_id, permission) do nothing;

-- ---------- 2. Keep it true for every future permission ----------
create or replace function app.grant_new_permission_to_admins()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.role_permissions (role_id, permission)
    select r.id, new.key
    from public.roles r
    where r.is_system
      and r.name in ('Organization Owner', 'Organization Admin')
  on conflict (role_id, permission) do nothing;
  return new;
end $$;

drop trigger if exists permissions_grant_admins on public.permissions;
create trigger permissions_grant_admins
  after insert on public.permissions
  for each row execute function app.grant_new_permission_to_admins();

-- ---------- 3. Report drift instead of hiding it ----------
-- A tiny read-only view so "which admin roles are missing catalog permissions"
-- is one query rather than an archaeology exercise. Should always be empty.
create or replace view app.admin_permission_drift as
  select r.org_id, r.id as role_id, r.name as role_name, p.key as missing_permission
  from public.roles r
  cross join public.permissions p
  where r.is_system
    and r.name in ('Organization Owner', 'Organization Admin')
    and not exists (
      select 1 from public.role_permissions rp
      where rp.role_id = r.id and rp.permission = p.key
    );

revoke all on app.admin_permission_drift from anon, authenticated;
