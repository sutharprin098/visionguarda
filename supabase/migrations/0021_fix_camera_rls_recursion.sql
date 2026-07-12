-- ============================================================
-- CamAI Enterprise Platform — Migration 0021
-- Fix infinite RLS recursion (Postgres 42P17) on cameras,
-- camera_assignments, and camera_group_members.
--
-- Root cause: cameras_read's policy queries camera_assignments via
-- EXISTS, and camera_assignments' own read policy queries cameras
-- back via EXISTS — a genuine two-table RLS cycle present since both
-- tables/policies were created in 0002 (0020 only added the
-- super-admin bypass on top of the same recursive shape, it didn't
-- introduce the cycle). cam_group_members_read additionally
-- self-references camera_group_members from within its own policy
-- (introduced in 0020). Verified live: every authenticated,
-- non-super-admin SELECT against any of these three tables throws
-- "42P17 infinite recursion detected in policy for relation ...".
--
-- This is why a camera insert (via the service-role add-camera Edge
-- Function, which runs as service_role and bypasses RLS entirely)
-- succeeded but the camera never appeared in the portal: the
-- follow-up SELECT from the browser session errored at the RLS
-- layer, and Cameras.tsx's queryFn never checked PostgREST's `error`
-- (only read `.data`), so React Query silently cached `null` as "no
-- cameras" — see the matching Cameras.tsx fix in the same change.
--
-- Fix: move the cross-table (and self-table) lookups into
-- SECURITY DEFINER helper functions. Such a function executes with
-- the privileges of its owner (the migration role, which owns these
-- tables and is therefore exempt from their RLS by default — the
-- same mechanism app.current_org_id()/app.has_perm() already rely on
-- for public.profiles/user_roles), so the lookup inside the function
-- does not re-trigger the sibling table's RLS policy at all — it
-- breaks the cycle instead of just reordering it.
-- ============================================================

create or replace function app.camera_assigned_to_me(p_camera_id uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from camera_assignments
    where camera_id = p_camera_id and user_id = auth.uid()
  );
$$;

create or replace function app.camera_org(p_camera_id uuid)
returns uuid
language sql stable security definer set search_path to 'public'
as $$
  select org_id from cameras where id = p_camera_id;
$$;

create or replace function app.group_contains_my_camera(p_group_id uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from camera_group_members gm
    join camera_assignments ca on ca.camera_id = gm.camera_id
    where gm.group_id = p_group_id and ca.user_id = auth.uid()
  );
$$;

-- ---------- cameras ----------
drop policy if exists cameras_read on public.cameras;
create policy cameras_read on public.cameras for select
  using (app.is_super_admin()
         or (org_id = app.current_org_id() and deleted_at is null
             and (app.has_perm('cameras.manage') or app.camera_assigned_to_me(id))));

-- ---------- camera_assignments ----------
drop policy if exists cam_assign_read on public.camera_assignments;
create policy cam_assign_read on public.camera_assignments for select
  using (app.is_super_admin()
         or user_id = auth.uid()
         or (app.has_perm('cameras.assign') and app.camera_org(camera_id) = app.current_org_id()));

drop policy if exists cam_assign_write on public.camera_assignments;
create policy cam_assign_write on public.camera_assignments for all
  using (app.is_super_admin()
         or (app.has_perm('cameras.assign') and app.camera_org(camera_id) = app.current_org_id()))
  with check (app.is_super_admin()
              or (app.has_perm('cameras.assign')
                  and app.camera_org(camera_id) = app.current_org_id()
                  and exists (select 1 from public.profiles p
                              where p.id = user_id and p.org_id = app.camera_org(camera_id))));

-- ---------- camera_group_members ----------
drop policy if exists cam_group_members_read on public.camera_group_members;
create policy cam_group_members_read on public.camera_group_members for select
  using (app.is_super_admin()
         or exists (select 1 from public.camera_groups g
                    where g.id = group_id and g.org_id = app.current_org_id()
                          and (app.has_perm('cameras.manage') or app.group_contains_my_camera(g.id))));
