-- ============================================================
-- CamAI Enterprise Platform — Migration 0007
-- Downloads now sources release metadata live from the GitHub
-- Releases API (see supabase/functions/github-releases) instead of
-- a manually-maintained table — drop the now-unused registry.
-- ============================================================

-- A pre-existing `downloads` table (download click-through log, not part of
-- any migration in this repo — schema drift from earlier manual setup) has a
-- FK into app_releases. Drop just that constraint so app_releases can go
-- without CASCADE, which would silently delete the downloads table's rows.
alter table if exists public.downloads drop constraint if exists downloads_release_id_fkey;

-- DROP TABLE already takes its policies with it — no separate DROP POLICY
-- needed (and "DROP POLICY ... ON app_releases" would itself error with
-- "relation does not exist" if this migration is ever re-run after the
-- table is already gone, since IF EXISTS there only guards the policy name).
drop table if exists public.app_releases;

-- The 'releases' storage bucket is now unused too, but Supabase blocks
-- direct SQL deletes on storage.buckets (storage.protect_delete()) — remove
-- it manually via Dashboard > Storage or the Storage API if desired; an
-- unused empty bucket left in place is harmless.
