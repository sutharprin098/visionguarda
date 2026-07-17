-- ============================================================
-- CamAI Enterprise Platform — Migration 0035
-- Publish the tables the desktop already listens to
-- ============================================================
--
-- desktop/src/lib/sync.ts subscribes to postgres_changes on 17 tables
-- (WATCHED_TABLES) and refetches the desktop-sync bundle whenever any of them
-- changes. There is no polling fallback — that subscription is the only thing
-- that makes a running client notice a config change.
--
-- Six of those tables were never added to the supabase_realtime publication, so
-- they emitted no events at all and the subscription silently did nothing:
--
--   analytics_drawings     the zones and lines an operator draws
--   rule_engine_rules      alert rules
--   zone_profile_configs   the per-profile feature config
--   config_versions        the record a publish writes
--   custom_ai_modes
--   ai_model_packages
--
-- The effect is precisely the thing Admin Studio promises not to do: an admin
-- draws a zone, edits a rule, changes a profile's features, or hits Publish, and
-- the running desktop never finds out. Verified live: the engine sat with
-- profile_features="{}" while the database held a full, published config for
-- that camera. It only ever caught up when something on `cameras` or `settings`
-- happened to change and dragged a fresh bundle along with it.
--
-- Note this is the second half of the same story as 0031/0032: the publish
-- pipeline itself was broken (org_id never sent), and even once fixed, its
-- result could not reach a running client. Both had to be true for "publish →
-- cameras hot-swap live" to actually hold.
--
-- add table is not idempotent — it errors if the table is already a member —
-- so each is guarded against the publication's current contents.
do $$
declare
  t text;
begin
  foreach t in array array[
    'analytics_drawings',
    'rule_engine_rules',
    'zone_profile_configs',
    'config_versions',
    'custom_ai_modes',
    'ai_model_packages'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
      raise notice 'added %.% to supabase_realtime', 'public', t;
    end if;
  end loop;
end $$;
