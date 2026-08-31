-- ============================================================
-- CamAI Enterprise Platform — Migration 0050
-- Unified Google Authentication Hardening & Identity Linking
-- ============================================================

-- 1. Ensure app.handle_new_user is fully idempotent on user profile creation.
--    When a user signs in via Google OAuth (or traditional auth), Supabase Auth
--    manages identity in auth.users & auth.identities. If a profile already exists
--    (e.g., from pre-provisioning or prior registration with the same sub/email),
--    ON CONFLICT (id) DO NOTHING prevents duplicate key failures.

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
  v_existing_org uuid;
begin
  -- Check if profile already exists for this user ID
  if exists (select 1 from public.profiles where id = new.id) then
    return new;
  end if;

  -- Check if an organization already exists for this user's email domain or previous record
  select org_id into v_existing_org
  from public.profiles
  where email = new.email
  limit 1;

  if v_existing_org is not null then
    v_org := v_existing_org;
  else
    v_license_key := case when v_type = 'organization'
                          then app.generate_key('ADM') else app.generate_key('LIC') end;

    insert into public.organizations (org_code, name, kind)
    values (v_org_code, v_org_name, case when v_type='organization' then 'organization' else 'personal' end)
    returning id into v_org;

    v_owner_role := app.seed_system_roles(v_org);
    
    insert into public.licenses (org_id, key_hash, key_hint, kind)
    values (v_org, app.hash_key(v_license_key),
            split_part(v_license_key,'-',1) || '-••••-••••-' || split_part(v_license_key,'-',4),
            case when v_type='organization' then 'admin' else 'user' end);

    insert into app.provision_results (user_id, user_code, org_code, license_key)
    values (new.id, v_user_code, v_org_code, v_license_key)
    on conflict (user_id) do nothing;
  end if;

  insert into public.profiles (id, org_id, user_code, full_name, email)
  values (new.id, v_org, v_user_code, v_name, new.email)
  on conflict (id) do update set
    full_name = case when public.profiles.full_name = '' then excluded.full_name else public.profiles.full_name end,
    updated_at = now();

  if v_owner_role is not null then
    insert into public.user_roles (user_id, role_id)
    values (new.id, v_owner_role)
    on conflict (user_id, role_id) do nothing;
  end if;

  return new;
exception when others then
  raise warning 'handle_new_user failed for %: % (%)', new.email, sqlerrm, sqlstate;
  return new;
end $$;

-- 2. RPC endpoint to verify or fetch identity metadata for current caller
create or replace function public.get_unified_auth_identity()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_google_sub text;
  v_profile jsonb;
begin
  if v_user_id is null then
    return jsonb_build_object('authenticated', false);
  end if;

  select email into v_email from auth.users where id = v_user_id;

  select provider_id into v_google_sub
  from auth.identities
  where user_id = v_user_id and provider = 'google'
  limit 1;

  select to_jsonb(p.*) into v_profile
  from public.profiles p
  where p.id = v_user_id;

  return jsonb_build_object(
    'authenticated', true,
    'user_id', v_user_id,
    'email', v_email,
    'google_sub', v_google_sub,
    'profile', v_profile
  );
end $$;

grant execute on function public.get_unified_auth_identity() to authenticated;
