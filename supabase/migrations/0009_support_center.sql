-- ============================================================
-- CamAI Enterprise Platform — Migration 0009
-- Support center: distinguish general/bug-report/feature-request
-- tickets so the portal can filter and route them separately.
-- ============================================================

alter table public.support_tickets
  add column if not exists category text not null default 'general'
  check (category in ('general', 'bug', 'feature_request'));
