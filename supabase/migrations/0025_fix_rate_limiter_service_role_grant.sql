-- ============================================================
-- CamAI Enterprise Platform — Migration 0025
-- Fix: app.check_rate_limit (0024) was unreachable by service_role.
--
-- Verified live: after 0024 + redeploying every rate-limited edge
-- function, the exact same 25-rapid-calls test still returned zero
-- 429s. Root cause: adminClient() (the service-role client every
-- rate-limited function calls rateLimit() through) had neither
-- USAGE on schema app nor EXECUTE on app.check_rate_limit — 0023
-- only granted schema USAGE to anon/authenticated, and 0024's
-- REVOKE ... FROM PUBLIC correctly locked the function down but
-- never explicitly re-granted it to service_role either. Every call
-- failed with "permission denied for schema app", and rateLimit()'s
-- fail-open error handling (correct in principle — a broken limiter
-- must not take down the endpoint it protects) silently swallowed
-- that into an always-true result, masking the second bug as if the
-- first fix had never happened.
-- ============================================================

grant usage on schema app to service_role;
grant execute on function app.check_rate_limit(text, int, int) to service_role;
