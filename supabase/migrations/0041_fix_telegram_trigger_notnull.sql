-- ============================================================
-- CamAI — Migration 0041
-- FIX: alert → Telegram dispatch never fired for connected orgs.
--
-- app.trg_alert_notify_telegram() gated delivery on `tg is not null` and
-- `conn is not null`. In PL/pgSQL, `record IS NOT NULL` is TRUE only when
-- EVERY column of the record is non-null. telegram_connections (and
-- telegram_settings) almost always have at least one NULL column
-- (connect_token, token_expires_at, tg_username, connected_at, …), so those
-- record-level checks were ALWAYS false → should_notify stayed false → the
-- trigger returned without ever calling net.http_post. Result: alerts were
-- inserted but NO Telegram message was ever sent from the automatic pipeline,
-- even though the connection was live and notify-telegram worked when invoked
-- directly.
--
-- Fix: test the actual columns (via coalesce) instead of the whole record.
-- Everything else (auth bearer, pg_net call, notify-telegram) is unchanged.
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
    -- `record IS NULL` is true only when the whole row is null (no row found),
    -- so this early-out is correct as written.
    if cfg is null or coalesce(cfg.edge_base_url, '') = '' then
      return new; -- dispatch not configured for this deployment
    end if;

    -- 1. Legacy per-org settings (own bot token + chat id). Check the COLUMNS,
    -- not `tg is not null` — a missing row leaves every column NULL, and any
    -- present-but-nullable column would otherwise defeat a record-level test.
    select * into tg from public.telegram_settings where org_id = new.org_id;
    if coalesce(tg.enabled, false)
       and coalesce(tg.bot_token, '') <> ''
       and coalesce(tg.chat_id, '') <> '' then
      should_notify := true;
    end if;

    -- 2. Shared-bot connection (connection-code / deep-link flow).
    if not should_notify then
      select * into conn from public.telegram_connections where org_id = new.org_id;
      if coalesce(conn.connected, false)
         and coalesce(conn.chat_id, '') <> '' then
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
