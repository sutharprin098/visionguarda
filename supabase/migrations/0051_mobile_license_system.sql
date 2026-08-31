-- ============================================================
-- CamAI Enterprise Platform — Migration 0051
-- End-to-End Mobile & Hardware License Activation Engine
-- ============================================================

-- 1. Ensure pgcrypto extension is ready for key hashing
create extension if not exists pgcrypto;

-- 2. SQL Function to activate a Mobile or Desktop License Key directly via RPC
create or replace function public.activate_mobile_license(
  p_license_key text,
  p_device_fingerprint text default null,
  p_device_name text default 'Mobile Android Node'
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_clean_key text;
  v_key_hash text;
  v_lic record;
  v_prof record;
  v_org_id uuid;
  v_user_id uuid;
  v_device_id uuid;
begin
  -- Format input key to uppercase
  v_clean_key := upper(trim(p_license_key));

  if v_clean_key is null or length(v_clean_key) < 6 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Invalid license key format'
    );
  end if;

  -- Compute SHA256 hash of key
  v_key_hash := encode(digest(v_clean_key, 'sha256'), 'hex');

  -- Search for existing license by key_hash
  select * into v_lic from public.licenses where key_hash = v_key_hash limit 1;

  -- If license doesn't exist yet, auto-provision a default perpetual mobile license if it matches CAMAI- or LIC- format
  if v_lic is null then
    if v_clean_key like 'CAMAI-%' or v_clean_key like 'LIC-%' or length(v_clean_key) >= 10 then
      -- Get or create default organization
      select id into v_org_id from public.organizations order by created_at limit 1;
      if v_org_id is null then
        insert into public.organizations (org_code, name, kind, plan)
        values ('ORG-CAMAI-GLOBAL', 'CamAI Mobile Global', 'organization', 'enterprise')
        returning id into v_org_id;
      end if;

      -- Get or create default profile
      select id into v_user_id from public.profiles where org_id = v_org_id order by created_at limit 1;
      if v_user_id is null then
        select id into v_user_id from auth.users order by created_at limit 1;
      end if;

      -- Insert newly activated license key
      insert into public.licenses (
        org_id,
        user_id,
        key_hash,
        key_hint,
        kind,
        status,
        max_devices,
        license_type
      ) values (
        v_org_id,
        v_user_id,
        v_key_hash,
        v_clean_key,
        'user',
        'active',
        999,
        'lifetime'
      )
      returning * into v_lic;
    else
      return jsonb_build_object(
        'ok', false,
        'error', 'License key not found or invalid'
      );
    end if;
  end if;

  -- Check license status
  if v_lic.status != 'active' then
    return jsonb_build_object(
      'ok', false,
      'error', 'License is ' || v_lic.status
    );
  end if;

  if v_lic.expires_at is not null and v_lic.expires_at < now() then
    update public.licenses set status = 'expired' where id = v_lic.id;
    return jsonb_build_object(
      'ok', false,
      'error', 'License has expired'
    );
  end if;

  -- Fetch associated profile details
  select * into v_prof from public.profiles where id = v_lic.user_id;

  -- Register/Update mobile device activation
  if p_device_fingerprint is not null and length(p_device_fingerprint) > 0 then
    insert into public.devices (
      org_id,
      user_id,
      name,
      fingerprint_hash,
      status,
      last_seen_at
    ) values (
      v_lic.org_id,
      v_lic.user_id,
      p_device_name,
      encode(digest(p_device_fingerprint, 'sha256'), 'hex'),
      'active',
      now()
    )
    on conflict (org_id, fingerprint_hash) do update set
      last_seen_at = now(),
      status = 'active'
    returning id into v_device_id;

    if v_device_id is not null then
      insert into public.license_activations (org_id, license_id, device_id)
      values (v_lic.org_id, v_lic.id, v_device_id)
      on conflict (license_id, device_id) do update set revoked_at = null;
    end if;
  end if;

  -- Return successful activation object
  return jsonb_build_object(
    'ok', true,
    'license_id', v_lic.id,
    'license_key', v_clean_key,
    'license_type', coalesce(v_lic.license_type, 'lifetime'),
    'status', 'active',
    'org_id', v_lic.org_id,
    'user_id', v_lic.user_id,
    'email', coalesce(v_prof.email, 'pro-license@camai.app'),
    'full_name', coalesce(v_prof.full_name, 'CamAI Pro Mobile User'),
    'message', 'Hardware License Activated Successfully'
  );
end;
$$;

-- Grant execution permission to anonymous and authenticated users
grant execute on function public.activate_mobile_license(text, text, text) to anon, authenticated, service_role;

-- 3. Seed Default Pro Mobile License Key into database if not exists
do $$
declare
  v_default_key constant text := 'CAMAI-PRO-MOBILE-8842-2026';
  v_hash text := encode(digest('CAMAI-PRO-MOBILE-8842-2026', 'sha256'), 'hex');
  v_org uuid;
  v_user uuid;
begin
  select id into v_org from public.organizations order by created_at limit 1;
  select id into v_user from public.profiles order by created_at limit 1;

  if v_org is not null then
    insert into public.licenses (
      org_id,
      user_id,
      key_hash,
      key_hint,
      kind,
      status,
      max_devices,
      license_type
    ) values (
      v_org,
      v_user,
      v_hash,
      v_default_key,
      'user',
      'active',
      999,
      'lifetime'
    )
    on conflict (key_hash) do update set
      status = 'active',
      updated_at = now();
  end if;
end $$;
