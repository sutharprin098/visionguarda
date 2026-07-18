-- Allow the traffic-pilot event kinds on public.alerts so the engine's
-- helmet/plate/triple-riding events can sync to the cloud (report-events edge
-- function). The plate number, speed, track id, and confidence ride in the
-- existing detail jsonb column; created_at is the event timestamp.
--
-- The kind column was a CHECK-constrained text enum (0003_ops_audit_billing).
-- We widen it rather than migrate to a Postgres enum type so the change is a
-- single constraint swap with no column rewrite or downtime.

alter table public.alerts drop constraint if exists alerts_kind_check;

alter table public.alerts
  add constraint alerts_kind_check
  check (kind in (
    -- existing kinds (0003)
    'intrusion', 'line_crossing', 'speed_violation', 'traffic_jam',
    'camera_offline', 'license_expiry', 'device_removed', 'custom',
    -- traffic pilot (helmet + ANPR)
    'helmet_violation', 'triple_riding', 'number_plate'
  ));

-- Make sure the portal can see these events arrive live. Adding a table that is
-- already a member raises, so guard it.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'alerts'
  ) then
    alter publication supabase_realtime add table public.alerts;
  end if;
end $$;
