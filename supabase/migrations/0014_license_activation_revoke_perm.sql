-- ============================================================
-- CamAI Enterprise Platform — Migration 0014
-- license_activations revoke policy was devices.manage-only (0005),
-- but the Licenses page also revokes activations directly from the
-- client on suspend/revoke/transfer (setStatus/TransferForm in
-- Licenses.tsx) — a role with licenses.manage but not devices.manage
-- (a custom org role, since only Owner/Admin get both by default)
-- would flip the license's status while the update to
-- license_activations silently matched 0 rows under RLS, leaving
-- devices activated on a license that now shows suspended/revoked.
-- Allow either permission to revoke.
-- ============================================================
drop policy if exists activations_revoke on public.license_activations;
create policy activations_revoke on public.license_activations for update
  using (org_id = app.current_org_id()
         and (app.has_perm('devices.manage') or app.has_perm('licenses.manage')))
  with check (org_id = app.current_org_id());
