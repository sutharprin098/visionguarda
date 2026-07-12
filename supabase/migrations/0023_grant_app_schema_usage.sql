-- ============================================================
-- CamAI Enterprise Platform — Migration 0023
-- Grant USAGE on the `app` schema to anon/authenticated.
--
-- Schema-level USAGE is a separate privilege from per-function
-- EXECUTE: without it, PostgREST can't resolve *any* function in
-- `app` at all (confirmed live: "permission denied for schema app"
-- even for app.create_organization, which already has its own
-- explicit EXECUTE grant + is_super_admin() check from 0017). This
-- only grants visibility into the schema — access to any individual
-- function is still gated by that function's own EXECUTE grant
-- (locked down per-function in 0022) and, for anything touching
-- tables, by RLS.
-- ============================================================

grant usage on schema app to anon, authenticated;
