-- ============================================================
-- CamAI Enterprise Platform — Migration 0020
-- Camera Management module fixes:
--   1. Super Admin could not read/write cameras, camera_assignments,
--      camera_groups, camera_group_members, camera_health, or sites
--      belonging to any org other than their own — every other
--      cross-org table (organizations, profiles, roles, licenses,
--      devices) already carries an `or app.is_super_admin()` escape
--      from the `org_id = app.current_org_id()` clause; the camera
--      tables were missed when that pattern was established.
--   2. cameras.status only allowed ('online','offline','error') —
--      too coarse to show accurate Connecting / Authentication Failed
--      / Network Error states, which the health-reporting pipeline
--      (see report-camera-health edge function) now needs to write.
--   3. camera_group_members had no read policy reachable by a user who
--      is only assigned individual cameras (only cameras.manage could
--      read it) — group membership silently showed empty to them even
--      though camera_groups itself is org-readable.
-- ============================================================

-- ---------- 1. super-admin bypass on camera-related RLS ----------
drop policy if exists cameras_read on public.cameras;
create policy cameras_read on public.cameras for select
  using (app.is_super_admin()
         or (org_id = app.current_org_id() and deleted_at is null
             and (app.has_perm('cameras.manage')
                  or exists (select 1 from public.camera_assignments ca
                             where ca.camera_id = id and ca.user_id = auth.uid()))));

drop policy if exists cameras_write on public.cameras;
create policy cameras_write on public.cameras for all
  using (app.is_super_admin()
         or (org_id = app.current_org_id() and app.has_perm('cameras.manage')))
  with check (app.is_super_admin()
              or (org_id = app.current_org_id() and app.has_perm('cameras.manage')));

drop policy if exists cam_groups_read on public.camera_groups;
create policy cam_groups_read on public.camera_groups for select
  using (app.is_super_admin() or (org_id = app.current_org_id() and deleted_at is null));

drop policy if exists cam_groups_rw on public.camera_groups;
create policy cam_groups_rw on public.camera_groups for all
  using (app.is_super_admin()
         or (org_id = app.current_org_id() and app.has_perm('cameras.manage')))
  with check (app.is_super_admin()
              or (org_id = app.current_org_id() and app.has_perm('cameras.manage')));

drop policy if exists cam_group_members_rw on public.camera_group_members;
create policy cam_group_members_read on public.camera_group_members for select
  using (app.is_super_admin()
         or exists (select 1 from public.camera_groups g
                    where g.id = group_id and g.org_id = app.current_org_id()
                          and (app.has_perm('cameras.manage')
                               or exists (select 1 from public.camera_group_members gm2
                                          join public.camera_assignments ca
                                            on ca.camera_id = gm2.camera_id
                                          where gm2.group_id = g.id and ca.user_id = auth.uid()))));
create policy cam_group_members_write on public.camera_group_members for insert
  with check (app.is_super_admin()
              or exists (select 1 from public.camera_groups g
                         where g.id = group_id and g.org_id = app.current_org_id()
                               and app.has_perm('cameras.manage')));
create policy cam_group_members_delete on public.camera_group_members for delete
  using (app.is_super_admin()
         or exists (select 1 from public.camera_groups g
                    where g.id = group_id and g.org_id = app.current_org_id()
                          and app.has_perm('cameras.manage')));

drop policy if exists cam_assign_read on public.camera_assignments;
create policy cam_assign_read on public.camera_assignments for select
  using (app.is_super_admin()
         or user_id = auth.uid()
         or exists (select 1 from public.cameras c
                    where c.id = camera_id and c.org_id = app.current_org_id() and app.has_perm('cameras.assign')));

-- also verifies the assignee's own org_id matches the camera's — the
-- original policy only checked the camera's org, so any cameras.assign
-- holder could hand access to a user in a completely different
-- organization (camera_assignments.user_id has no org FK of its own to
-- catch this at the schema level).
drop policy if exists cam_assign_write on public.camera_assignments;
create policy cam_assign_write on public.camera_assignments for all
  using (app.is_super_admin()
         or (app.has_perm('cameras.assign')
             and exists (select 1 from public.cameras c where c.id = camera_id and c.org_id = app.current_org_id())))
  with check (app.is_super_admin()
              or (app.has_perm('cameras.assign')
                  and exists (select 1 from public.cameras c
                              join public.profiles p on p.id = user_id
                              where c.id = camera_id and c.org_id = app.current_org_id()
                                    and p.org_id = c.org_id)));

drop policy if exists cam_health_read on public.camera_health;
create policy cam_health_read on public.camera_health for select
  using (app.is_super_admin() or org_id = app.current_org_id());

drop policy if exists sites_read on public.sites;
create policy sites_read on public.sites for select
  using (app.is_super_admin() or (org_id = app.current_org_id() and deleted_at is null));

-- ---------- 2. expand cameras.status for accurate health reporting ----------
-- Looked up by column rather than assumed name (`cameras_status_check`) —
-- prior migrations in this project (0008, 0012) were bitten by exactly this
-- kind of naming assumption; pg_constraint is the source of truth.
do $$
declare
  con text;
begin
  select c.conname into con
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  where t.relname = 'cameras' and c.contype = 'c'
        and pg_get_constraintdef(c.oid) ilike '%status%';
  if con is not null then
    execute format('alter table public.cameras drop constraint %I', con);
  end if;
end $$;

alter table public.cameras add constraint cameras_status_check
  check (status in ('online', 'offline', 'connecting', 'auth_failed', 'network_error', 'error'));
-- 'error' kept for backward compatibility with any existing rows; new
-- writes from report-camera-health use the five specific states above.
