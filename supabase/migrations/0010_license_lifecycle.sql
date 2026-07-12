-- ============================================================
-- CamAI Enterprise Platform — Migration 0010
-- License lifecycle: correct the type taxonomy to the spec'd
-- Trial/Monthly/Yearly/Lifetime/Enterprise, and add the Edit,
-- Delete, and Renew actions the portal was missing RPCs for.
-- ============================================================

-- ------------------------------------------------------------
-- License types: personal/subscription were never in the spec.
-- Map existing rows onto the real taxonomy before tightening the
-- check constraint. 'personal' (auto-provisioned on signup) reads
-- as a free perpetual key -> trial felt wrong, lifetime is the
-- honest description of "no expiry, meant to keep working".
-- 'subscription' had no cadence recorded, so monthly is the safer
-- default (shorter — an admin under-billing themselves notices
-- and can extend, vs. an admin who forgot to bill for a year).
-- ------------------------------------------------------------
update public.licenses set license_type = 'lifetime' where license_type = 'personal';
update public.licenses set license_type = 'monthly'  where license_type = 'subscription';

alter table public.licenses drop constraint if exists licenses_license_type_check;
alter table public.licenses
  add constraint licenses_license_type_check
  check (license_type in ('trial', 'monthly', 'yearly', 'lifetime', 'enterprise'));
alter table public.licenses alter column license_type set default 'trial';

-- app.handle_new_user (0001) relies on the licenses.license_type default
-- when it provisions the signup license — 'trial' is now that default,
-- so new personal/org signups start as trial rather than silently
-- inheriting the old 'personal' value the check constraint no longer allows.

-- ------------------------------------------------------------
-- RPC: edit a license's type / device cap / expiry
-- ------------------------------------------------------------
create or replace function public.edit_license(
  p_license_id uuid,
  p_license_type text default null,
  p_max_devices int default null,
  p_expires_at timestamptz default null,
  p_clear_expiry boolean default false
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app.current_org_id();
  lic record;
begin
  if not app.has_perm('licenses.manage') then
    raise exception 'forbidden';
  end if;
  select * into lic from public.licenses where id = p_license_id and org_id = v_org;
  if lic is null then raise exception 'license not found'; end if;

  update public.licenses set
    license_type = coalesce(p_license_type, license_type),
    max_devices  = coalesce(p_max_devices, max_devices),
    expires_at   = case when p_clear_expiry then null else coalesce(p_expires_at, expires_at) end,
    updated_at   = now()
  where id = p_license_id;

  perform public.audit('license.edit', 'license', p_license_id::text,
    jsonb_build_object(
      'old', jsonb_build_object('license_type', lic.license_type, 'max_devices', lic.max_devices, 'expires_at', lic.expires_at),
      'new', jsonb_build_object('license_type', coalesce(p_license_type, lic.license_type),
                                 'max_devices', coalesce(p_max_devices, lic.max_devices),
                                 'expires_at', case when p_clear_expiry then null else coalesce(p_expires_at, lic.expires_at) end)
    ), 'licenses');
end $$;

-- ------------------------------------------------------------
-- RPC: renew a license — push out expires_at and reactivate if expired
-- ------------------------------------------------------------
create or replace function public.renew_license(p_license_id uuid, p_new_expires_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app.current_org_id();
  lic record;
begin
  if not app.has_perm('licenses.manage') then
    raise exception 'forbidden';
  end if;
  select * into lic from public.licenses where id = p_license_id and org_id = v_org;
  if lic is null then raise exception 'license not found'; end if;
  if p_new_expires_at is not null and p_new_expires_at <= now() then
    raise exception 'new expiry must be in the future';
  end if;

  update public.licenses set
    expires_at = p_new_expires_at,
    status = case when status = 'expired' then 'active' else status end,
    expiry_notified_at = null,
    updated_at = now()
  where id = p_license_id;

  perform public.audit('license.renew', 'license', p_license_id::text,
    jsonb_build_object('old_expires_at', lic.expires_at, 'new_expires_at', p_new_expires_at), 'licenses');
end $$;

-- ------------------------------------------------------------
-- RPC: delete a license outright (not a status flip — a hard
-- delete for keys that were issued in error / duplicated). Revokes
-- any live activations first so a bound desktop fails closed
-- immediately rather than racing the cascade delete.
-- ------------------------------------------------------------
create or replace function public.delete_license(p_license_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app.current_org_id();
  lic record;
begin
  if not app.has_perm('licenses.manage') then
    raise exception 'forbidden';
  end if;
  select * into lic from public.licenses where id = p_license_id and org_id = v_org;
  if lic is null then raise exception 'license not found'; end if;

  update public.license_activations set revoked_at = now()
   where license_id = p_license_id and revoked_at is null;

  perform public.audit('license.delete', 'license', p_license_id::text,
    jsonb_build_object('key_hint', lic.key_hint, 'user_id', lic.user_id, 'license_type', lic.license_type), 'licenses');

  delete from public.licenses where id = p_license_id;
end $$;

grant execute on function public.edit_license(uuid, text, int, timestamptz, boolean) to authenticated;
grant execute on function public.renew_license(uuid, timestamptz) to authenticated;
grant execute on function public.delete_license(uuid) to authenticated;
