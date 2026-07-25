-- ============================================================
-- CamAI Enterprise Platform — Migration 0037
-- Telegram notifications as a pure subscriber to the global alert
-- stream. There is NO per-detection configuration anywhere: the
-- moment ANY AI module (human / vehicle / helmet / ANPR / speed /
-- intrusion / face / …) raises an alert, it flows through the
-- existing pipeline (engine insert_alert -> report-events ->
-- public.alerts). This migration hangs a single AFTER INSERT
-- trigger off public.alerts that fans every new row out to the
-- notify-telegram edge function via pg_net. Model-agnostic by
-- construction — the trigger never looks at `kind`, so a new
-- detector added tomorrow is delivered with zero code changes.
--
-- Reuses the dispatch plumbing already proven by 0012 (email):
--   app.integration_config.edge_base_url + service_role_key.
-- The only per-org configuration is the Telegram destination
-- (enable + bot token + chat id), stored in public.telegram_settings.
-- ============================================================

-- ------------------------------------------------------------
-- Per-org Telegram destination. This is the ENTIRE configuration
-- surface: on/off, bot token, chat id. No event types, no
-- detection selectors — those would defeat the "send whatever the
-- active model produces" contract. One row per org.
-- ------------------------------------------------------------
create table if not exists public.telegram_settings (
  org_id     uuid primary key references public.organizations(id) on delete cascade,
  enabled    boolean not null default false,
  bot_token  text not null default '',
  chat_id    text not null default '',
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
alter table public.telegram_settings enable row level security;

-- org admins (org.manage — the same permission gating SMTP/webhook in
-- Settings.tsx) read and write their own org's row; nobody else can see the
-- bot token. Service role (the edge functions) bypasses RLS to read it.
drop policy if exists telegram_settings_read on public.telegram_settings;
create policy telegram_settings_read on public.telegram_settings for select
  using (org_id = app.current_org_id() and app.has_perm('org.manage'));
drop policy if exists telegram_settings_write on public.telegram_settings;
create policy telegram_settings_write on public.telegram_settings for all
  using (org_id = app.current_org_id() and app.has_perm('org.manage'))
  with check (org_id = app.current_org_id() and app.has_perm('org.manage'));

-- ------------------------------------------------------------
-- A dedicated bearer the alert trigger sends to the notify-telegram edge
-- function. Kept SEPARATE from service_role_key (which app.dispatch_pending_emails
-- still needs for send-email) because projects on Supabase's new API-key system
-- inject sb_secret_… into the function's SUPABASE_SERVICE_ROLE_KEY env, which
-- won't match a legacy service_role JWT. This is a random shared secret set on
-- both sides (integration_config.telegram_bearer here, TELEGRAM_WEBHOOK_SECRET
-- as the function secret). Falls back to service_role_key when left empty.
-- ------------------------------------------------------------
alter table app.integration_config add column if not exists telegram_bearer text not null default '';

-- ------------------------------------------------------------
-- The subscriber. AFTER INSERT on public.alerts, FOR EACH ROW:
-- if this alert's org has Telegram enabled and dispatch is
-- configured, POST { alert_id } to notify-telegram. The edge
-- function reloads the full row (with camera + org names) and
-- formats the message, so the Telegram payload is exactly the
-- alert the dashboard shows — no mapping, no conversion here.
--
-- net.http_post is asynchronous (it enqueues onto pg_net's own
-- worker and returns immediately), so this never slows an alert
-- insert. The whole body is wrapped so that a missing pg_net
-- extension, an unconfigured dispatch, or any transient failure
-- can NEVER roll back or block the alert itself — notifications
-- are strictly best-effort relative to recording the event.
-- ------------------------------------------------------------
create or replace function app.trg_alert_notify_telegram()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  cfg record;
  tg  record;
begin
  begin
    select * into cfg from app.integration_config where id = true;
    if cfg is null or coalesce(cfg.edge_base_url, '') = '' then
      return new; -- dispatch not configured for this deployment
    end if;

    select * into tg from public.telegram_settings where org_id = new.org_id;
    if tg is null or not tg.enabled
       or coalesce(tg.bot_token, '') = '' or coalesce(tg.chat_id, '') = '' then
      return new; -- org has not enabled/configured Telegram
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

drop trigger if exists alert_notify_telegram on public.alerts;
create trigger alert_notify_telegram
  after insert on public.alerts
  for each row execute function app.trg_alert_notify_telegram();

-- Trigger function fans out across the deployment's dispatch config and every
-- org's Telegram row — like the other notify_* functions (0008) it must only
-- run from trigger context, never as a client-callable RPC.
revoke execute on function app.trg_alert_notify_telegram() from public, anon, authenticated;

-- ------------------------------------------------------------
-- The desktop now uploads alert snapshots to the org-scoped `snapshots`
-- bucket (so they resolve in the dashboard and in Telegram). 0003 gave that
-- bucket INSERT + SELECT policies only; add UPDATE so re-uploading the same
-- per-alert object on a sync retry (upsert) is idempotent instead of failing.
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'storage_org_update'
  ) then
    create policy storage_org_update on storage.objects for update
      using (bucket_id in ('snapshots','recordings')
             and (storage.foldername(name))[1] = app.current_org_id()::text)
      with check (bucket_id in ('snapshots','recordings')
                  and (storage.foldername(name))[1] = app.current_org_id()::text);
  end if;
end $$;

-- pg_net is the same extension 0012 relies on; guard so this migration doesn't
-- hard-fail on a project where it isn't enabled yet. The trigger's own
-- exception block already tolerates its absence at runtime.
do $outer$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net not available — enable it so alert->Telegram dispatch works (see PLATFORM.md)';
end $outer$;
