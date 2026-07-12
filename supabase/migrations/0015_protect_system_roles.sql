-- ============================================================
-- CamAI Enterprise Platform — Migration 0015
-- roles_write (0001) is a single "for all" policy gated only on
-- org_id + roles.manage, with no is_system check. The portal UI
-- (Roles.tsx) treats is_system as a hard rule — it doesn't even
-- render a Delete button for system roles ("Organization Owner",
-- "Organization Admin", "Manager", "Operator", "Viewer", "Auditor",
-- "Support Engineer"; see the `r.is_system ? <Badge> : <button
-- onClick={() => setDeleting(r)}>` branch) — but that's a client-side
-- convenience only. Any org member holding roles.manage (granted to
-- Owner/Admin by default, and assignable to any custom role) can
-- call supabase.from("roles").delete().eq("id", <system-role-id>)
-- directly and the database allows it: role_permissions/user_roles
-- cascade-delete with it (both FKs are ON DELETE CASCADE), silently
-- stripping every holder of that role's permissions — including,
-- in the worst case, deleting "Organization Owner" and locking every
-- non-super-admin out of org administration with no RLS-level way
-- back in.
--
-- Split roles_write into insert/update (unchanged) and a delete
-- policy that also requires the row not be a system role, matching
-- the UI's own rule at the layer that actually enforces access.
-- ============================================================
drop policy if exists roles_write on public.roles;

create policy roles_insert on public.roles for insert
  with check (org_id = app.current_org_id() and app.has_perm('roles.manage'));

create policy roles_update on public.roles for update
  using (org_id = app.current_org_id() and app.has_perm('roles.manage'));

create policy roles_delete on public.roles for delete
  using (org_id = app.current_org_id() and app.has_perm('roles.manage') and not is_system);
