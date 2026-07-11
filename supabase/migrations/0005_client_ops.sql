-- ============================================================
-- CamAI Enterprise Platform — Migration 0005
-- Client-side operations that RLS previously blocked silently
-- ============================================================

-- Deactivating/removing a device from the portal must revoke its
-- license activations. 0001 only defined activations_read, so the
-- portal's update matched 0 rows without erroring. Allow admins to
-- revoke (update) activations inside their org.
create policy activations_revoke on public.license_activations for update
  using (org_id = app.current_org_id() and app.has_perm('devices.manage'))
  with check (org_id = app.current_org_id());

-- Incident/ticket threads mutate updated_at from the client; keep it
-- honest server-side regardless of what the client sends.
create or replace function app.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists incidents_touch on public.incidents;
create trigger incidents_touch before update on public.incidents
  for each row execute function app.touch_updated_at();

drop trigger if exists tickets_touch on public.support_tickets;
create trigger tickets_touch before update on public.support_tickets
  for each row execute function app.touch_updated_at();

-- Desktops watch license_activations so an admin revocation fails the
-- device closed within ~1s (desktop-sync returns 403 on the next sync).
alter publication supabase_realtime add table public.license_activations;

-- devices_online must not trust a stale is_online=true (a crashed desktop
-- never flips it back): only count devices seen in the last 3 minutes.
-- Heartbeats arrive via desktop-sync at most once per minute per device.
create or replace function public.org_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'users',           (select count(*) from public.profiles      where org_id = app.current_org_id()),
    'cameras',         (select count(*) from public.cameras       where org_id = app.current_org_id()),
    'cameras_online',  (select count(*) from public.cameras       where org_id = app.current_org_id() and status = 'online'),
    'devices',         (select count(*) from public.devices       where org_id = app.current_org_id() and status = 'active'),
    'devices_online',  (select count(*) from public.devices       where org_id = app.current_org_id() and is_online
                          and last_seen_at > now() - interval '3 minutes'),
    'licenses_active', (select count(*) from public.licenses      where org_id = app.current_org_id() and status = 'active'),
    'alerts_today',    (select count(*) from public.alerts        where org_id = app.current_org_id() and created_at > now() - interval '24 hours'),
    'incidents_open',  (select count(*) from public.incidents     where org_id = app.current_org_id() and status in ('open','investigating')),
    'storage_mb',      coalesce((select sum(quantity) from public.usage_logs
                                 where org_id = app.current_org_id() and metric = 'storage_mb'), 0),
    'events_7d',       (select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'count', coalesce(a.n, 0)) order by d.day), '[]'::jsonb)
                        from (select generate_series(current_date - 6, current_date, '1 day')::date as day) d
                        left join (select created_at::date as day, count(*) as n
                                   from public.alerts where org_id = app.current_org_id()
                                     and created_at > current_date - 7 group by 1) a using (day))
  );
$$;
