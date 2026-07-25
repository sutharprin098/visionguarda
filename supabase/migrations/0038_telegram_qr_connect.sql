-- ============================================================
-- CamAI — Migration 0038
-- QR-code Telegram connect: users scan a QR → CamAI's own bot
-- automatically links their Telegram chat to their org.
-- No per-user bot token. No manual chat ID. Just scan & done.
--
-- How it works:
--   1. Desktop calls telegram-connect edge function (JWT auth).
--   2. Function generates a short unique token, stores it with
--      the user's org_id in telegram_connections.
--   3. Returns a deep link: https://t.me/{BOT_USERNAME}?start={TOKEN}
--   4. Desktop renders that URL as a QR code.
--   5. User scans QR → Telegram opens CamAI bot → /start TOKEN.
--   6. telegram-bot webhook receives the /start, looks up the
--      token, stores chat_id → connection is live.
--   7. notify-telegram reads from telegram_connections (not
--      telegram_settings) using CamAI's shared TELEGRAM_BOT_TOKEN.
-- ============================================================

-- Per-org Telegram connection. One row per org — scanning a new QR
-- overwrites the chat_id so orgs can re-link at any time.
create table if not exists public.telegram_connections (
  org_id       uuid primary key references public.organizations(id) on delete cascade,
  -- The one-time token embedded in the deep link / QR code.
  -- Regenerated each time "Get QR" is clicked; invalidated once used.
  connect_token text unique,
  token_expires_at timestamptz,
  -- Telegram chat id filled in by the bot on /start.
  chat_id      text,
  chat_name    text,   -- first_name / group title from the Telegram user object
  connected    boolean not null default false,
  connected_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.telegram_connections enable row level security;

-- Org members can read their own connection status (to show QR / connected UI).
drop policy if exists tgconn_read on public.telegram_connections;
create policy tgconn_read on public.telegram_connections for select
  using (org_id = app.current_org_id());

-- Only org admins can request a new QR (insert / update the token column).
drop policy if exists tgconn_write on public.telegram_connections;
create policy tgconn_write on public.telegram_connections for all
  using  (org_id = app.current_org_id() and app.has_perm('org.manage'))
  with check (org_id = app.current_org_id() and app.has_perm('org.manage'));

-- Service role (the bot webhook) bypasses RLS to write chat_id.

-- Expose to realtime so the desktop UI can subscribe and flip to "Connected"
-- the moment the user taps Start in Telegram.
do $$
begin
  if not exists (
    select 1
    from pg_publication_rel pr
    join pg_publication p on p.oid = pr.prpubid
    join pg_class c on c.oid = pr.prrelid
    where p.pubname = 'supabase_realtime'
      and c.relname = 'telegram_connections'
  ) then
    alter publication supabase_realtime add table public.telegram_connections;
  end if;
end;
$$;

-- ============================================================
-- ============================================================
-- Update the alert notify trigger to use telegram_connections
-- when the shared-bot flow is active (TELEGRAM_BOT_TOKEN set),
-- falling back to telegram_settings for legacy per-org bots.
-- ============================================================

create or replace function app.trg_alert_notify_telegram()
returns trigger
security definer
set search_path = public
language plpgsql
as $$
declare
  cfg record;
  tg record;
  conn record;
  should_notify boolean := false;
begin
  begin
    select * into cfg from app.integration_config where id = true;
    if cfg is null or coalesce(cfg.edge_base_url, '') = '' then
      return new; -- dispatch not configured for this deployment
    end if;

    -- 1. Check legacy settings
    select * into tg from public.telegram_settings where org_id = new.org_id;
    if tg is not null and tg.enabled and coalesce(tg.bot_token, '') <> '' and coalesce(tg.chat_id, '') <> '' then
      should_notify := true;
    end if;

    -- 2. Check new QR connection
    if not should_notify then
      select * into conn from public.telegram_connections where org_id = new.org_id;
      if conn is not null and conn.connected and coalesce(conn.chat_id, '') <> '' then
        should_notify := true;
      end if;
    end if;

    if not should_notify then
      return new;
    end if;

    perform net.http_post(
      url := cfg.edge_base_url || '/notify-telegram',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || coalesce(nullif(cfg.telegram_bearer, ''), cfg.service_role_key),
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object('alert_id', new.id)
    );
  exception when others then
    -- pg_net absent, queue unavailable, etc. Swallow — the alert row is
    -- already committed and must not be jeopardised by a delivery hiccup.
    raise notice 'notify-telegram dispatch skipped for alert %: %', new.id, sqlerrm;
  end;
  return new;
end $$;

-- Grant select to authenticated so the desktop-sync bundle can
-- include the connection status without a separate edge function call.
grant select on public.telegram_connections to authenticated;

