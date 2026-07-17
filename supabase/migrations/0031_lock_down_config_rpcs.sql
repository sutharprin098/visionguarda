-- ============================================================
-- CamAI Enterprise Platform — Migration 0031
-- Lock down publish_config / rollback_config
-- ============================================================
--
-- 0027 created both as `security definer` (RLS bypassed inside) taking
-- p_org_id and p_user_id as plain arguments, with no check that the caller
-- belongs to that org — and never revoked EXECUTE, which Postgres grants to
-- PUBLIC by default. Both are therefore reachable directly over PostgREST
-- (POST /rest/v1/rpc/publish_config) by any signed-in user with the anon key,
-- with any org_id and any user_id. rollback_config is the worse of the two:
-- it DELETEs every analytics_drawing / rule / mode for the target org before
-- restoring the snapshot, so a foreign org_id wipes another tenant's config.
--
-- Fixing the edge functions alone does not close this — PostgREST is a
-- separate front door onto the same procedure. The grant is the fix; the edge
-- functions (which now resolve org_id from the caller's profile and check
-- cameras.manage) become the only supported path in.
--
-- Also pins search_path: a `security definer` function without one resolves
-- unqualified names through the caller's search_path, which is the classic
-- definer-function hijack.

revoke all on function public.publish_config(uuid, text, uuid)  from public, anon, authenticated;
revoke all on function public.rollback_config(uuid, int, uuid)  from public, anon, authenticated;

grant execute on function public.publish_config(uuid, text, uuid)  to service_role;
grant execute on function public.rollback_config(uuid, int, uuid)  to service_role;

alter function public.publish_config(uuid, text, uuid)  set search_path = public, pg_temp;
alter function public.rollback_config(uuid, int, uuid)  set search_path = public, pg_temp;
