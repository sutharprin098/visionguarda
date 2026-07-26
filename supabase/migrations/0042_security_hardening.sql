-- ============================================================
-- CamAI Enterprise Platform — Migration 0042
-- Security hardening pass. Three independent fixes, none of which
-- changes any supported behaviour:
--
--   1. profiles: block self-service privilege escalation (CRITICAL)
--   2. re-pin search_path on the SECURITY DEFINER functions that lost it
--   3. explicit REVOKE on the two internal app.* tables that carry no RLS
-- ============================================================


-- ------------------------------------------------------------
-- 1. public.profiles — privileged columns are not self-writable
-- ------------------------------------------------------------
-- The RLS policy from 0001 is:
--
--   create policy profiles_self_update on public.profiles for update
--     using (id = auth.uid() or (org_id = app.current_org_id()
--                                and app.has_perm('users.manage')));
--
-- A policy with no WITH CHECK re-uses its USING expression as the check, so
-- the row is validated by `id = auth.uid()` BOTH before and after the update.
-- Every column therefore stays writable by the row's owner — including
-- `is_super_admin`, which app.is_super_admin() turns into an unconditional
-- bypass in every other RLS policy on the platform, and which add-camera /
-- update-camera / publish-config / rollback-config / admin-users all honour
-- as "may act on any organization".
--
-- So any signed-in user could run, with nothing but the public anon key:
--
--   supabase.from('profiles').update({ is_super_admin: true }).eq('id', <self>)
--
-- and become platform staff: read and write every tenant's cameras, alerts,
-- licences and audit log, and delete any user. `org_id` was writable the same
-- way (move yourself into another tenant), as were `status` (a suspended or
-- locked account could re-activate itself, defeating admin-users' set_status
-- and the session kill that follows it), `email` and `user_code`.
--
-- The fix is a BEFORE UPDATE trigger rather than a policy rewrite, because the
-- privileged columns must stay writable for the paths that legitimately set
-- them — the provisioning trigger, invite-user (re-homes org_id), admin-users
-- (set_status) — all of which run as service_role or as the table owner.
-- Only PostgREST sessions carrying an `authenticated`/`anon` JWT are pinned.
--
-- Behaviour preserved: the portal's only profile write (Users.tsx ProfileTab)
-- sends full_name / phone / department / designation, none of which is touched
-- here. Avatar, and every other non-privileged column, stays writable too.

create or replace function app.protect_profile_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := '';
begin
  -- Read the caller's JWT role straight from the GUC PostgREST sets, rather
  -- than auth.role() — this must never be able to raise (an exception here
  -- would abort every profile UPDATE on the platform), and it must behave
  -- correctly on a plain SQL connection where no GUC is set at all.
  begin
    v_role := coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role',
      ''
    );
  exception when others then
    v_role := '';
  end;

  -- service_role (edge functions), the table owner (triggers, definer
  -- functions) and direct SQL connections keep exactly today's behaviour.
  if v_role not in ('authenticated', 'anon') then
    return new;
  end if;

  -- Silently pin rather than raise: a rejected UPDATE would turn an ordinary
  -- profile save that happens to echo the whole row back into a hard error.
  new.is_super_admin := old.is_super_admin;   -- platform-staff flag
  new.org_id         := old.org_id;           -- tenant membership
  new.user_code      := old.user_code;        -- identity, issued at signup
  new.email          := old.email;            -- authoritative copy is auth.users
  new.status         := old.status;           -- admin decision (admin-users)
  return new;
end $$;

revoke execute on function app.protect_profile_privileged_columns() from public, anon, authenticated;

drop trigger if exists profiles_protect_privileged_columns on public.profiles;
create trigger profiles_protect_privileged_columns
  before update on public.profiles
  for each row execute function app.protect_profile_privileged_columns();


-- ------------------------------------------------------------
-- 2. Re-pin search_path on SECURITY DEFINER functions
-- ------------------------------------------------------------
-- 0031 pinned publish_config/rollback_config with ALTER FUNCTION ... SET
-- search_path. 0032 then re-created both with CREATE OR REPLACE and no SET
-- clause — which preserves the ACL (the 0031 revokes still stand) but wipes
-- proconfig, silently un-pinning them. is_public_model (0026) never had one.
--
-- An unpinned definer function resolves every unqualified name through the
-- CALLER's search_path, which is the classic definer-function hijack: get a
-- schema you control in front of `public` and your table/function is what the
-- function body touches, executing as the function's owner.
alter function public.publish_config(uuid, text, uuid)  set search_path = public, pg_temp;
alter function public.rollback_config(uuid, int, uuid)  set search_path = public, pg_temp;
alter function public.is_public_model(uuid)             set search_path = public, pg_temp;


-- ------------------------------------------------------------
-- 3. app.provision_results / app.rate_limits — explicit REVOKE
-- ------------------------------------------------------------
-- Both are internal, service-role-only tables and neither carries RLS.
-- app.provision_results holds one-time signup credentials in PLAINTEXT
-- (user_code, org_code, license_key) and a licence key is all activate-license
-- needs to mint a full session for its owner.
--
-- They are not reachable today: `app` is exposed to PostgREST (config.toml)
-- and 0023 granted USAGE on the schema, but neither table was ever granted to
-- anon/authenticated, and Supabase's default privileges only cover `public`.
-- That safety is implicit, though — one stray `grant all on all tables in
-- schema app` would expose every licence key on the platform. Make it explicit
-- so the grant has to be deliberate.
revoke all on table app.provision_results from anon, authenticated;
revoke all on table app.rate_limits       from anon, authenticated;
alter default privileges in schema app revoke all on tables from anon, authenticated;
