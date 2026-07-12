-- ============================================================
-- CamAI Enterprise Platform — Migration 0013
-- Signup hardening. app.seed_system_roles (called from the
-- on_auth_user_created trigger, inside the SAME transaction as the
-- auth.users insert) blindly unnest()'d hardcoded permission-key
-- arrays into role_permissions. role_permissions.permission has a
-- FK to permissions(key) — if this project's live permissions table
-- is missing even one referenced key (schema drift from the manual
-- migration history this project has had), that INSERT violates the
-- FK, the trigger raises, and the ENTIRE signup transaction aborts —
-- Supabase Auth reports that to the client as a bare 500 on signUp().
-- Guard every bulk permission grant with "and exists (select 1 from
-- permissions where key = ...)" so a missing/renamed permission just
-- means that role has fewer grants, never a failed signup.
-- ============================================================

create or replace function app.seed_system_roles(p_org uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare owner_role uuid;
begin
  insert into public.roles (org_id, name, is_system) values
    (p_org, 'Organization Owner', true) returning id into owner_role;
  insert into public.roles (org_id, name, is_system) values
    (p_org, 'Organization Admin', true),
    (p_org, 'Manager', true),
    (p_org, 'Operator', true),
    (p_org, 'Viewer', true),
    (p_org, 'Auditor', true),
    (p_org, 'Support Engineer', true);

  insert into public.role_permissions (role_id, permission)
    select r.id, p.key from public.roles r cross join public.permissions p
    where r.org_id = p_org and r.name in ('Organization Owner','Organization Admin');

  insert into public.role_permissions (role_id, permission)
    select r.id, perm.key
    from public.roles r
    cross join unnest(array['cameras.manage','cameras.assign',
                             'projects.manage','alerts.view','reports.view','incidents.manage']) as perm(key)
    where r.org_id = p_org and r.name = 'Manager'
      and exists (select 1 from public.permissions p where p.key = perm.key);

  insert into public.role_permissions (role_id, permission)
    select r.id, perm.key
    from public.roles r
    cross join unnest(array['alerts.view','reports.view','incidents.manage']) as perm(key)
    where r.org_id = p_org and r.name = 'Operator'
      and exists (select 1 from public.permissions p where p.key = perm.key);

  insert into public.role_permissions (role_id, permission)
    select r.id, perm.key
    from public.roles r
    cross join unnest(array['reports.view']) as perm(key)
    where r.org_id = p_org and r.name = 'Viewer'
      and exists (select 1 from public.permissions p where p.key = perm.key);

  insert into public.role_permissions (role_id, permission)
    select r.id, perm.key
    from public.roles r
    cross join unnest(array['audit.view','reports.view']) as perm(key)
    where r.org_id = p_org and r.name = 'Auditor'
      and exists (select 1 from public.permissions p where p.key = perm.key);

  insert into public.role_permissions (role_id, permission)
    select r.id, perm.key
    from public.roles r
    cross join unnest(array['support.manage','alerts.view','devices.manage']) as perm(key)
    where r.org_id = p_org and r.name = 'Support Engineer'
      and exists (select 1 from public.permissions p where p.key = perm.key);

  return owner_role;
end $$;

-- ------------------------------------------------------------
-- Same hardening for app.handle_new_user itself: never let a
-- secondary failure (a stray constraint, a duplicate code collision
-- vanishingly unlikely but not impossible) take down the whole
-- signup silently without a clear server-side log to diagnose from.
-- ------------------------------------------------------------
create or replace function app.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_type        text := coalesce(new.raw_user_meta_data->>'account_type', 'personal');
  v_name        text := coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1));
  v_org_name    text := coalesce(new.raw_user_meta_data->>'org_name', v_name);
  v_org         uuid;
  v_owner_role  uuid;
  v_user_code   text := app.generate_key('USR');
  v_org_code    text := app.generate_key('ORG');
  v_license_key text;
begin
  v_license_key := case when v_type = 'organization'
                        then app.generate_key('ADM') else app.generate_key('LIC') end;

  insert into public.organizations (org_code, name, kind)
  values (v_org_code, v_org_name, case when v_type='organization' then 'organization' else 'personal' end)
  returning id into v_org;

  insert into public.profiles (id, org_id, user_code, full_name, email)
  values (new.id, v_org, v_user_code, v_name, new.email);

  v_owner_role := app.seed_system_roles(v_org);
  insert into public.user_roles (user_id, role_id) values (new.id, v_owner_role);

  insert into public.licenses (org_id, user_id, key_hash, key_hint, kind)
  values (v_org, new.id, app.hash_key(v_license_key),
          split_part(v_license_key,'-',1) || '-••••-••••-' || split_part(v_license_key,'-',4),
          case when v_type='organization' then 'admin' else 'user' end);

  insert into app.provision_results (user_id, user_code, org_code, license_key)
  values (new.id, v_user_code, v_org_code, v_license_key);

  return new;
exception when others then
  raise warning 'handle_new_user failed for %: % (%)', new.email, sqlerrm, sqlstate;
  raise;
end $$;
