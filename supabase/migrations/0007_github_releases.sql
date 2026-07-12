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

drop policy if exists releases_read on public.app_releases;
drop table if exists public.app_releases;

delete from storage.buckets where id = 'releases';
