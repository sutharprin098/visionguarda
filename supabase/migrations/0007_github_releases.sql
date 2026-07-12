-- ============================================================
-- CamAI Enterprise Platform — Migration 0007
-- Downloads now sources release metadata live from the GitHub
-- Releases API (see supabase/functions/github-releases) instead of
-- a manually-maintained table — drop the now-unused registry.
-- ============================================================

drop policy if exists releases_read on public.app_releases;
drop table if exists public.app_releases;

delete from storage.buckets where id = 'releases';
