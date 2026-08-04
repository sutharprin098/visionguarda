-- ============================================================
-- CamAI Enterprise Platform — Migration 0046
-- Close the same class of bug 0042 fixed on public.profiles, found on
-- public.roles during a follow-up audit (2026-08-04).
-- ============================================================
--
-- 0015 added roles_insert/roles_update/roles_delete to replace a single
-- "for all" policy, and made roles_delete require `not is_system` so a
-- system role (Organization Owner, Organization Admin, ...) can never be
-- deleted through PostgREST. roles_insert and roles_update were left as
-- they were:
--
--   create policy roles_insert on public.roles for insert
--     with check (org_id = app.current_org_id() and app.has_perm('roles.manage'));
--
--   create policy roles_update on public.roles for update
--     using (org_id = app.current_org_id() and app.has_perm('roles.manage'));
--
-- Neither mentions is_system, and roles_update has no WITH CHECK at all (a
-- policy with none re-uses USING as the check, which here says nothing about
-- is_system either). So any org member holding roles.manage — grantable to a
-- custom, non-admin role — could, with nothing but the public anon key:
--
--   1. INSERT a brand-new role with is_system = true. 0044's
--      app.grant_new_permission_to_admins() deliberately scopes its
--      all-permissions auto-grant by is_system rather than by role name
--      specifically so a renamed custom role can't ride in on that grant
--      (see 0044's own comment) — this bypassed that guard from the other
--      direction, by forging a role that was never seeded as an admin role
--      but carries the same is_system flag.
--
--   2. UPDATE an existing system role's is_system to false, then DELETE it
--      through roles_delete (which only checks `not is_system` on the row
--      as it exists at delete time) — fully reopening the "Organization
--      Owner" lockout scenario 0015 was written to close, just via an extra
--      step.
--
-- Same fix shape as 0042: a BEFORE INSERT/UPDATE trigger, not a policy
-- rewrite, because is_system must stay writable for the path that
-- legitimately sets it — the org-provisioning function that seeds the
-- default role set (0001, 0004, 0006, 0013) — which runs as service_role/
-- the function owner, never as a PostgREST authenticated/anon session.
-- Only PostgREST sessions carrying an authenticated/anon JWT are pinned.
--
-- Behaviour preserved: every legitimate write the portal's Roles.tsx makes
-- (create a custom role, rename/edit permissions on a non-system role) never
-- touches is_system, so it is untouched by this trigger.

create or replace function app.protect_role_is_system()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := '';
begin
  begin
    v_role := coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role',
      ''
    );
  exception when others then
    v_role := '';
  end;

  -- service_role (edge functions, org provisioning), the table owner and
  -- direct SQL connections keep exactly today's behaviour.
  if v_role not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A JWT-carrying caller can never mint a system role from scratch.
    new.is_system := false;
    return new;
  end if;

  -- UPDATE: silently pin rather than raise, for the same reason 0042 does -
  -- a rejected UPDATE would turn an ordinary role-permissions save that
  -- happens to echo the whole row back into a hard error.
  new.is_system := old.is_system;
  return new;
end $$;

revoke execute on function app.protect_role_is_system() from public, anon, authenticated;

drop trigger if exists roles_protect_is_system on public.roles;
create trigger roles_protect_is_system
  before insert or update on public.roles
  for each row execute function app.protect_role_is_system();
