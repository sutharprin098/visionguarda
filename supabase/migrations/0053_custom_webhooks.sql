-- ============================================================
-- CamAI Enterprise Platform — Migration 0053
-- Implement Custom Webhook Dispatch for Alerts
-- ============================================================

create or replace function app.trg_alert_notify_webhook()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_settings record;
  v_webhook_url text;
  v_events jsonb;
begin
  begin
    select * into v_settings from public.organization_settings where org_id = new.org_id;
    if v_settings is null then return new; end if;

    v_webhook_url := v_settings.webhook->>'url';
    v_events := coalesce(v_settings.webhook->'events', '[]'::jsonb);

    -- Check if URL is configured and if 'alert.created' is in the subscribed events list
    if v_webhook_url is not null and v_webhook_url <> '' then
      if v_events ? 'alert.created' or v_events::text = '[]' then
        perform net.http_post(
          url := v_webhook_url,
          headers := jsonb_build_object('Content-Type', 'application/json'),
          body := json_build_object(
            'event', 'alert.created',
            'org_id', new.org_id,
            'alert_id', new.id,
            'kind', new.kind,
            'severity', new.severity,
            'title', new.title,
            'detail', new.detail,
            'timestamp', new.created_at
          )::jsonb
        );
      end if;
    end if;
  exception when others then
    -- pg_net absent, queue unavailable, etc. Swallow to avoid blocking the alert row.
    raise notice 'notify-webhook dispatch skipped for alert %: %', new.id, sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists alert_notify_webhook on public.alerts;
create trigger alert_notify_webhook
  after insert on public.alerts
  for each row execute function app.trg_alert_notify_webhook();
