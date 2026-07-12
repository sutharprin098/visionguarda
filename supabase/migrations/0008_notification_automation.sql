-- ============================================================
-- CamAI Enterprise Platform — Migration 0008
-- Notification center: archive/delete support + automatic
-- notifications for the events the portal needs to surface
-- (new users, offline cameras, device changes, license status/
-- expiry, security-sensitive audit actions, new desktop releases).
-- ============================================================

alter table public.notifications add column if not exists archived_at timestamptz;

-- users can delete their own notifications (org-wide/system ones, user_id
-- is null, are not deletable by a single member — only by an admin via
-- the service role / a future admin tool)
create policy notif_delete on public.notifications for delete
  using (user_id = auth.uid());

-- ------------------------------------------------------------
-- Notify helpers (security definer — triggers run as table owner,
-- but we still scope every insert to an explicit org_id)
-- ------------------------------------------------------------
create or replace function app.notify_user(p_org uuid, p_user uuid, p_kind text, p_title text, p_body text default '')
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (org_id, user_id, kind, title, body)
  select p_org, p_user, p_kind, p_title, p_body where p_user is not null;
$$;

create or replace function app.notify_org(p_org uuid, p_kind text, p_title text, p_body text default '')
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (org_id, user_id, kind, title, body)
  values (p_org, null, p_kind, p_title, p_body);
$$;

-- one row per profile in the org holding permission p_perm
create or replace function app.notify_perm_holders(p_org uuid, p_perm text, p_kind text, p_title text, p_body text default '')
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (org_id, user_id, kind, title, body)
  select distinct p_org, ur.user_id, p_kind, p_title, p_body
  from public.user_roles ur
  join public.role_permissions rp on rp.role_id = ur.role_id
  join public.profiles pr on pr.id = ur.user_id
  where pr.org_id = p_org and rp.permission = p_perm;
$$;

-- ------------------------------------------------------------
-- New user joined -> org admins (users.manage)
-- ------------------------------------------------------------
create or replace function app.trg_notify_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform app.notify_perm_holders(new.org_id, 'users.manage', 'new_user',
    'New user joined', new.full_name || ' (' || new.email || ') joined the organization.');
  return new;
end $$;
drop trigger if exists notify_new_user on public.profiles;
create trigger notify_new_user after insert on public.profiles
  for each row execute function app.trg_notify_new_user();

-- ------------------------------------------------------------
-- Camera goes offline -> org admins (cameras.manage)
-- ------------------------------------------------------------
create or replace function app.trg_notify_camera_offline()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'offline' and old.status is distinct from 'offline' then
    perform app.notify_perm_holders(new.org_id, 'cameras.manage', 'camera_offline',
      'Camera offline', new.name || ' went offline.');
  end if;
  return new;
end $$;
drop trigger if exists notify_camera_offline on public.cameras;
create trigger notify_camera_offline after update of status on public.cameras
  for each row execute function app.trg_notify_camera_offline();

-- ------------------------------------------------------------
-- Device status changes -> org admins (devices.manage)
-- ------------------------------------------------------------
create or replace function app.trg_notify_device_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    perform app.notify_perm_holders(new.org_id, 'devices.manage', 'device_change',
      'Device ' || new.status, new.name || ' is now ' || new.status || '.');
  end if;
  return new;
end $$;
drop trigger if exists notify_device_change on public.devices;
create trigger notify_device_change after update of status on public.devices
  for each row execute function app.trg_notify_device_change();

-- ------------------------------------------------------------
-- License status changes -> the affected user
-- ------------------------------------------------------------
create or replace function app.trg_notify_license_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and new.status in ('expired', 'revoked', 'suspended') then
    perform app.notify_user(new.org_id, new.user_id, 'license_status',
      'License ' || new.status, 'Your license ' || new.key_hint || ' is now ' || new.status || '.');
  end if;
  return new;
end $$;
drop trigger if exists notify_license_status on public.licenses;
create trigger notify_license_status after update of status on public.licenses
  for each row execute function app.trg_notify_license_status();

-- ------------------------------------------------------------
-- License expiring soon -> daily check via pg_cron (7-day warning,
-- re-notified at most once per 6 days so it isn't spammy)
-- ------------------------------------------------------------
alter table public.licenses add column if not exists expiry_notified_at timestamptz;

create or replace function app.check_expiring_licenses()
returns void language plpgsql security definer set search_path = public as $$
declare lic record;
begin
  for lic in
    select * from public.licenses
    where status = 'active'
      and expires_at is not null
      and expires_at between now() and now() + interval '7 days'
      and (expiry_notified_at is null or expiry_notified_at < now() - interval '6 days')
  loop
    perform app.notify_user(lic.org_id, lic.user_id, 'license_expiring',
      'License expiring soon', 'Your license ' || lic.key_hint || ' expires ' ||
      to_char(lic.expires_at, 'DD Mon YYYY') || '.');
    update public.licenses set expiry_notified_at = now() where id = lic.id;
  end loop;
end $$;

-- Requires the pg_cron extension enabled on the project (Supabase: Dashboard
-- > Database > Extensions, or `create extension pg_cron` with sufficient
-- privileges). Wrapped so this migration doesn't hard-fail on projects where
-- it isn't enabled yet — schedule it manually afterwards in that case.
do $outer$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('check-expiring-licenses', '0 8 * * *', $cron$select app.check_expiring_licenses()$cron$);
exception when others then
  raise notice 'pg_cron not available — schedule app.check_expiring_licenses() manually (see PLATFORM.md)';
end $outer$;

-- ------------------------------------------------------------
-- Security-sensitive audit actions -> org admins (org.manage)
-- ------------------------------------------------------------
create or replace function app.trg_notify_security_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.action in ('role.grant', 'role.revoke', 'user.delete', 'api_key.revoke', 'device.reset') then
    perform app.notify_perm_holders(new.org_id, 'org.manage', 'security',
      initcap(replace(new.action, '.', ' ')), 'By ' || coalesce(new.actor_email, 'system') || '.');
  end if;
  return new;
end $$;
drop trigger if exists notify_security_event on public.audit_logs;
create trigger notify_security_event after insert on public.audit_logs
  for each row execute function app.trg_notify_security_event();

-- ------------------------------------------------------------
-- New desktop release available -> org-wide announcement, every org.
-- Watermark + the RPC live in `public` so the github-releases edge
-- function can reach them without schema-header gymnastics; both are
-- locked to service_role only (RLS with no policies + explicit revoke).
-- ------------------------------------------------------------
create table if not exists public.release_watermark (
  id       boolean primary key default true check (id),
  last_tag text not null default ''
);
alter table public.release_watermark enable row level security;
-- no policies -> no authenticated/anon access at all; service role bypasses RLS

create or replace function public.notify_new_release(p_tag text, p_title text)
returns void language plpgsql security definer set search_path = public as $$
declare org record;
begin
  for org in select id from public.organizations loop
    perform app.notify_org(org.id, 'app_update', 'New CamAI Desktop release', p_title || ' (' || p_tag || ') is now available.');
  end loop;
end $$;

-- ------------------------------------------------------------
-- Lock down direct RPC access: these fan out across users/orgs and
-- must only run from trigger context or the service role (edge
-- functions), never as an RPC an authenticated user can call to spam
-- or cross-org-leak notifications.
-- ------------------------------------------------------------
revoke execute on function app.notify_user(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke execute on function app.notify_org(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function app.notify_perm_holders(uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.notify_new_release(text, text) from public, anon, authenticated;
revoke execute on function app.check_expiring_licenses() from public, anon, authenticated;
grant execute on function public.notify_new_release(text, text) to service_role;
grant execute on function app.check_expiring_licenses() to service_role;
