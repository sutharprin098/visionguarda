-- ============================================================
-- CamAI — Migration 0040
-- Connection-code Telegram connect — removes the QR/deep-link flow entirely.
-- The ONLY Telegram link is the plain bot link (t.me/<BOT_USERNAME>); the user
-- types  /start <CODE>  where <CODE> is a short, single-use, 5-minute code.
--
-- The code itself lives in the existing public.telegram_link_codes table
-- (link_code column holds the connection code). This migration only:
--   1. adds telegram_user_id to telegram_connections (spec field), and
--   2. adds a rate-limit table for failed /start CODE attempts.
-- ============================================================

-- Spec field: the numeric Telegram user id of whoever linked the chat. Stored
-- server-side only; never shown in the desktop UI or any bot reply.
alter table public.telegram_connections
  add column if not exists telegram_user_id text;

-- Brute-force guard. The bot inserts one row per FAILED /start CODE attempt and
-- refuses further attempts from a chat once it exceeds the window budget. Only
-- the service-role bot webhook ever touches this table (RLS on, no policies →
-- clients are denied; service role bypasses RLS).
create table if not exists public.telegram_connect_attempts (
  id           bigint generated always as identity primary key,
  chat_id      text not null,
  attempted_at timestamptz not null default now()
);

create index if not exists telegram_connect_attempts_idx
  on public.telegram_connect_attempts (chat_id, attempted_at);

alter table public.telegram_connect_attempts enable row level security;
