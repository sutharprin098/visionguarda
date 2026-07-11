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
