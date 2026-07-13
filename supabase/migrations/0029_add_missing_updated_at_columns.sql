-- ============================================================
-- CamAI Enterprise Platform — Migration 0029
-- Add missing updated_at columns to tables with touch_updated_at triggers
-- ============================================================

alter table public.roles add column if not exists updated_at timestamptz not null default now();
alter table public.devices add column if not exists updated_at timestamptz not null default now();
alter table public.projects add column if not exists updated_at timestamptz not null default now();
alter table public.sites add column if not exists updated_at timestamptz not null default now();
alter table public.camera_groups add column if not exists updated_at timestamptz not null default now();
alter table public.ai_models add column if not exists updated_at timestamptz not null default now();
alter table public.api_keys add column if not exists updated_at timestamptz not null default now();
alter table public.reports add column if not exists updated_at timestamptz not null default now();
