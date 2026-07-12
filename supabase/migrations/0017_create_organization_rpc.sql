-- ============================================================
-- CamAI Enterprise Platform — Migration 0017
-- Super admins had no way to provision a new organization directly —
-- every org today is created implicitly by the public signup trigger
-- (app.handle_new_user). Organizations.tsx (the super-admin console)
-- can suspend/reactivate/delete existing orgs but had no "Create"
-- action at all. Adds a create_organization RPC that reuses the same
-- app.seed_system_roles() the signup trigger uses, so a super-admin-
-- created org gets the identical system role set.
--
-- Deliberately scoped to just the org + its system roles — it does not
-- attempt to invite an initial owner into an arbitrary org. invite-user
-- (the edge function) only ever provisions users into the CALLER's own
-- org today; extending it to target an arbitrary org as a super-admin
-- action is a separate, larger change and isn't made here.
-- ============================================================

create or replace function app.create_organization(p_name text, p_kind text default 'organization', p_plan text default 'trial')
returns table (id uuid, org_code text)
language plpgsql security definer set search_path = public as $$
declare
  v_org_id   uuid;
  v_org_code text := app.generate_key('ORG');
begin
  if not app.is_super_admin() then
    raise exception 'only a super admin can create an organization' using errcode = '42501';
  end if;
  if p_kind not in ('personal', 'organization') then
    raise exception 'invalid organization kind: %', p_kind using errcode = '22023';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'organization name is required' using errcode = '22023';
  end if;

  insert into public.organizations (org_code, name, kind, plan, created_by)
  values (v_org_code, trim(p_name), p_kind, p_plan, auth.uid())
  returning organizations.id into v_org_id;

  perform app.seed_system_roles(v_org_id);

  return query select v_org_id, v_org_code;
end $$;

grant execute on function app.create_organization(text, text, text) to authenticated;
