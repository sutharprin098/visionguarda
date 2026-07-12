-- ============================================================
-- CamAI Enterprise Platform — Migration 0012
-- Real email delivery. org_settings.smtp + CAMAI_SMTP_PASSWORD
-- (0004/Settings.tsx) were pure input with no consumer — nothing
-- ever sent mail. This wires a pg_cron sweep that finds
-- unsent, email-worthy notifications and calls the `send-email`
-- edge function (pg_net) for each, using per-org SMTP settings.
-- ============================================================

alter table public.notifications add column if not exists email_sent_at timestamptz;

-- ------------------------------------------------------------
-- Where to POST (edge function base URL + service-role key). Set
-- once per deployment via app.configure_email_dispatch(...) — see
-- PLATFORM.md. Locked down like release_watermark: RLS with no
-- policies at all, so only the service role (which bypasses RLS)
-- or a security-definer function can touch it.
-- ------------------------------------------------------------
create table if not exists app.integration_config (
  id               boolean primary key default true check (id),
  edge_base_url    text not null default '',
  service_role_key text not null default ''
);
alter table app.integration_config enable row level security;

create or replace function app.configure_email_dispatch(p_edge_base_url text, p_service_role_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role only — run this from the SQL editor / CLI, not the client';
  end if;
  insert into app.integration_config (id, edge_base_url, service_role_key)
  values (true, p_edge_base_url, p_service_role_key)
  on conflict (id) do update set edge_base_url = excluded.edge_base_url, service_role_key = excluded.service_role_key;
end $$;
revoke execute on function app.configure_email_dispatch(text, text) from public, anon, authenticated;
grant execute on function app.configure_email_dispatch(text, text) to service_role;

-- ------------------------------------------------------------
-- Dispatch sweep: every notification kind worth an email already
-- carries a concrete user_id (notify_user / notify_perm_holders in
-- 0008 both insert one row per real recipient — only the org-wide
-- broadcasts like new_release use user_id = null, and those stay
-- in-app only). Skips orgs that haven't configured SMTP.
-- ------------------------------------------------------------
create or replace function app.dispatch_pending_emails()
returns void language plpgsql security definer set search_path = public as $$
declare
  cfg record;
  n record;
  v_smtp jsonb;
  v_to text;
begin
  select * into cfg from app.integration_config where id = true;
  if cfg is null or cfg.edge_base_url = '' then return; end if;

  for n in
    select nt.id, nt.org_id, nt.user_id, nt.kind, nt.title, nt.body
    from public.notifications nt
    where nt.email_sent_at is null
      and nt.user_id is not null
      and nt.kind in ('license_expiring', 'license_status', 'security', 'camera_offline')
      and nt.created_at > now() - interval '1 hour'   -- never backfill a stale backlog
    order by nt.created_at
    limit 50
  loop
    select smtp into v_smtp from public.organization_settings where org_id = n.org_id;
    if v_smtp is null or coalesce(v_smtp->>'host', '') = '' then
      continue; -- org hasn't configured SMTP — leave email_sent_at null, don't retry forever either
    end if;
    select email into v_to from public.profiles where id = n.user_id;
    if v_to is null then continue; end if;

    perform net.http_post(
      url := cfg.edge_base_url || '/send-email',
      headers := jsonb_build_object('Authorization', 'Bearer ' || cfg.service_role_key, 'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'to', v_to, 'subject', n.title, 'text', n.body,
        'smtp', jsonb_build_object('host', v_smtp->>'host', 'port', coalesce((v_smtp->>'port')::int, 587),
                                    'username', v_smtp->>'username', 'from', coalesce(v_smtp->>'from', v_smtp->>'username'))
      )
    );
    update public.notifications set email_sent_at = now() where id = n.id;
  end loop;
end $$;
revoke execute on function app.dispatch_pending_emails() from public, anon, authenticated;
grant execute on function app.dispatch_pending_emails() to service_role;

do $outer$
begin
  create extension if not exists pg_net;
  perform cron.schedule('dispatch-pending-emails', '* * * * *', $cron$select app.dispatch_pending_emails()$cron$);
exception when others then
  raise notice 'pg_net/pg_cron not available — schedule app.dispatch_pending_emails() manually (see PLATFORM.md)';
end $outer$;
