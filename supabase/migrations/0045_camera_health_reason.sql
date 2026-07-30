-- Camera status system fix, part 2 of 4 (engine + desktop are the other
-- parts; see plan). Two gaps closed:
--
-- 1. camera_health had nowhere to carry the engine's human-readable failure
--    reason (source_error_text() in server/app/ai/pipeline.py) or per-camera
--    latency — both already computed and already in the WS telemetry
--    payload, just discarded before they reached Supabase.
--
-- 2. org_stats()'s cameras_online count trusted a possibly-stale
--    cameras.status the same way devices_online used to, before the fix
--    documented right above it in 0005_client_ops.sql: "devices_online must
--    not trust a stale is_online=true (a crashed desktop never flips it
--    back): only count devices seen in the last 3 minutes." cameras_online
--    never got the equivalent guard. 20s mirrors the portal's own staleness
--    cutoff (see portal/src/lib/cameraStatus.ts) — comfortably above the
--    ~2s report interval, tight enough that a stopped relay stops counting
--    almost immediately.
alter table public.camera_health
  add column if not exists source_error text,
  add column if not exists latency_ms integer not null default 0;

create or replace function public.org_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'users',           (select count(*) from public.profiles      where org_id = app.current_org_id()),
    'cameras',         (select count(*) from public.cameras       where org_id = app.current_org_id()),
    'cameras_online',  (select count(*) from public.cameras c
                          join public.camera_health ch on ch.camera_id = c.id
                         where c.org_id = app.current_org_id() and c.status = 'online'
                           and ch.checked_at > now() - interval '20 seconds'),
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
