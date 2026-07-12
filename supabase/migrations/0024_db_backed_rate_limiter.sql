-- ============================================================
-- CamAI Enterprise Platform — Migration 0024
-- Replace the in-memory edge-function rate limiter with a
-- Postgres-backed one.
--
-- Verified live against production: 25 rapid sequential calls to
-- test-camera (limit: 20/min) all returned 200, zero 429s. Root
-- cause: _shared/util.ts's rateLimit() kept its hit counter in a
-- module-level in-memory Map, scoped to a single Deno edge-function
-- instance. Supabase Edge Functions run on horizontally-scaled,
-- stateless isolates with no guaranteed instance affinity per
-- caller, so that counter never reliably accumulated across the
-- very requests it was meant to be counting — every rate limit in
-- the app (test-camera, add-camera, update-camera, invite-user,
-- admin-users, decrypt-camera, report-camera-health, activate-license,
-- download-release, github-releases) shared this flaw.
--
-- Fix: move the counter into a table every instance actually shares.
-- app.check_rate_limit is a fixed-window counter (matches the
-- previous in-memory semantics exactly — a window resets fully once
-- p_window_seconds elapses since it started, rather than sliding),
-- implemented as a single atomic upsert so concurrent requests from
-- different instances can't race each other into both succeeding.
-- ============================================================

create table app.rate_limits (
  key          text primary key,
  count        int not null default 1,
  window_start timestamptz not null default now()
);

-- Best-effort housekeeping only — a stale row just gets its window
-- reset on next use regardless, this just keeps the table small.
create index rate_limits_window_idx on app.rate_limits (window_start);

create or replace function app.check_rate_limit(p_key text, p_max int, p_window_seconds int)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  insert into app.rate_limits (key, count, window_start)
  values (p_key, 1, now())
  on conflict (key) do update set
    count = case when app.rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
                 then 1
                 else app.rate_limits.count + 1 end,
    window_start = case when app.rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
                        then now()
                        else app.rate_limits.window_start end
  returning count into v_count;
  return v_count <= p_max;
end $$;

-- Internal only — called exclusively from edge functions via the
-- service-role client, never a direct RPC target (same posture as
-- the other internal-only app.* functions locked down in 0022).
revoke execute on function app.check_rate_limit(text, int, int) from public;
