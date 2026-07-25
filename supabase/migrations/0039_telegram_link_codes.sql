-- ============================================================
-- CamAI — Migration 0039
-- One-time 6-digit linking-code Telegram connect (replaces the
-- QR / deep-link flow from 0038). No QR, no per-user bot token.
--
-- Flow:
--   1. Desktop Alerts page calls telegram-link-code (JWT auth) →
--      a random 6-digit code is stored with a 5-minute expiry.
--   2. UI shows the code. User DMs it to @CamAiAdmin_bot.
--   3. telegram-bot webhook matches the code (exists, not expired,
--      not used), consumes it, and writes chat_id into the org's
--      telegram_connections row → connection is live.
--   4. Realtime flips the desktop UI to "Connected" with no refresh.
--
-- telegram_connections stays ORG-scoped (one destination per org),
-- so notify-telegram (0037/0038) delivers alerts unchanged.
-- ============================================================

-- One-time linking codes. Short-lived, single-use.
create table if not exists public.telegram_link_codes (
  id         uuid primary key default gen_random_uuid(),
  link_code  text not null,                                   -- the 6-digit code the user types to the bot
  user_id    uuid not null references public.profiles(id) on delete cascade,
  org_id     uuid not null references public.organizations(id) on delete cascade,
  expires_at timestamptz not null,                            -- created_at + 5 min
  used       boolean not null default false,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

-- At most ONE active (unused) row per code value so the webhook lookup by code
-- is unambiguous. Expired-but-unused rows are cleared on the next generate.
create unique index if not exists telegram_link_codes_active_uq
  on public.telegram_link_codes (link_code) where used = false;

create index if not exists telegram_link_codes_user_idx
  on public.telegram_link_codes (user_id);
create index if not exists telegram_link_codes_expiry_idx
  on public.telegram_link_codes (expires_at) where used = false;

alter table public.telegram_link_codes enable row level security;

-- A user can only ever see their own codes.
drop policy if exists tglink_read on public.telegram_link_codes;
create policy tglink_read on public.telegram_link_codes for select
  using (user_id = auth.uid());

-- Writes are gated to the caller's own row + org, admin-only (org.manage) —
-- the same gate that guards the org-wide Telegram destination itself. In
-- practice the edge function writes with the service role; this policy is the
-- defence-in-depth floor if a client ever writes directly.
drop policy if exists tglink_write on public.telegram_link_codes;
create policy tglink_write on public.telegram_link_codes for all
  using  (user_id = auth.uid() and org_id = app.current_org_id() and app.has_perm('org.manage'))
  with check (user_id = auth.uid() and org_id = app.current_org_id() and app.has_perm('org.manage'));
-- Service role (the bot webhook) bypasses RLS to validate + consume codes.

-- Record who linked the chat and their Telegram @username, for display in the
-- desktop + portal. chat_name (0038) already carries the first_name.
alter table public.telegram_connections add column if not exists tg_username text;
alter table public.telegram_connections add column if not exists linked_by uuid references public.profiles(id);

-- telegram_connections is already in the supabase_realtime publication (0038);
-- the desktop subscribes to it to flip to "Connected" the moment the bot
-- consumes a code. No polling anywhere in the flow.
