-- ============================================================
-- CamAI Enterprise Platform — Migration 0019
-- Fix extension function calls (gen_random_bytes and digest)
-- by explicitly referencing the extensions schema.
-- ============================================================

create or replace function app.random_int_between(lo int, hi int)
returns int language sql volatile as $$
  select lo + (get_byte(extensions.gen_random_bytes(1), 0) % (hi - lo + 1));
$$;

create or replace function app.hash_key(k text)
returns text language sql immutable as $$
  select encode(extensions.digest(k, 'sha256'), 'hex');
$$;

create or replace function public.create_api_key(p_name text, p_scopes text[] default '{}')
returns text language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app.current_org_id();
  v_key text;
begin
  if v_org is null then raise exception 'no profile'; end if;
  v_key := 'CAK-' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.api_keys (org_id, user_id, name, key_hash, key_hint, scopes)
  values (v_org, auth.uid(), p_name, app.hash_key(v_key),
          'CAK-…' || right(v_key, 6), p_scopes);
  perform public.audit('api_key.create', 'api_key', p_name, '{}'::jsonb, 'settings');
  return v_key;
end $$;
