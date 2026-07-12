-- ============================================================
-- CamAI Enterprise Platform — Migration 0022
-- Revoke EXECUTE on app-schema functions that must only ever run as
-- triggers or be called internally by another SECURITY DEFINER
-- function — never as a direct RPC call.
--
-- Context: the `app` schema (where all of this lives) is not yet
-- exposed via PostgREST (db_schema is "public,graphql_public" only),
-- so none of this is reachable over HTTP today. It's being fixed
-- as part of the same change that exposes `app` (needed for
-- app.create_organization, which Organizations.tsx already calls and
-- currently 404s). But every function in `app` currently has EXECUTE
-- granted to PUBLIC (Postgres' default), so exposing the schema
-- as-is would turn every one of them into a directly-callable RPC —
-- including app.seed_system_roles(p_org uuid), which performs ZERO
-- ownership/authorization check on p_org: it inserts a full
-- "Organization Owner" role with every platform permission into
-- whatever org UUID is passed. Exposed to PostgREST, that's an
-- unauthenticated (anon-key-only) privilege-escalation endpoint
-- reachable by anyone who can guess or enumerate an org_id.
--
-- Fix: explicitly revoke EXECUTE from PUBLIC on every function here
-- that is (a) a trigger function (touch_*/trg_notify_*), which
-- Postgres will refuse to run outside trigger context anyway but
-- should never have had a direct-call grant in the first place, or
-- (b) an internal helper with no caller-identity check
-- (seed_system_roles, handle_new_user). This does not affect their
-- existing callers: triggers fire regardless of the modifying role's
-- own EXECUTE grant on the trigger function, and SECURITY DEFINER
-- functions calling these internally (app.create_organization ->
-- app.seed_system_roles, the auth.users trigger -> app.handle_new_user)
-- run as the function owner, who retains implicit EXECUTE on their
-- own functions independent of any REVOKE FROM PUBLIC/anon/authenticated.
--
-- Left untouched (intentionally callable): app.create_organization
-- (has its own is_super_admin() check + explicit grant to
-- authenticated), app.current_org_id/has_perm/is_super_admin/
-- camera_assigned_to_me/camera_org/group_contains_my_camera (all
-- self-scoped via auth.uid(), safe for any caller to invoke on their
-- own behalf), and app.generate_key/hash_key/random_int_between
-- (pure functions, no table access).
-- ============================================================

revoke execute on function app.seed_system_roles(uuid) from public;
revoke execute on function app.handle_new_user() from public;
revoke execute on function app.touch_last_login() from public;
revoke execute on function app.touch_updated_at() from public;
revoke execute on function app.trg_notify_camera_offline() from public;
revoke execute on function app.trg_notify_device_change() from public;
revoke execute on function app.trg_notify_license_status() from public;
revoke execute on function app.trg_notify_new_user() from public;
revoke execute on function app.trg_notify_security_event() from public;
