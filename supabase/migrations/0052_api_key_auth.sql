-- ============================================================
-- CamAI Enterprise Platform — Migration 0052
-- Implement API Key Authentication via PostgREST Pre-Request Hook
-- ============================================================

create or replace function app.api_key_auth_hook()
returns void as $$
declare
  v_headers text;
  v_api_key text;
  v_key_hash text;
  v_api_key_record record;
begin
  -- PostgREST exposes headers via current_setting('request.headers')
  -- Header keys are typically lowercased.
  v_headers := current_setting('request.headers', true);
  
  if v_headers is not null and v_headers <> '' then
    begin
      v_api_key := v_headers::json->>'x-camai-api-key';
    exception when others then
      v_api_key := null;
    end;
  end if;
  
  if v_api_key is not null then
    -- Check if it matches our CAK- format
    if v_api_key like 'CAK-%' then
      v_key_hash := app.hash_key(v_api_key);
      
      select * into v_api_key_record from public.api_keys 
      where key_hash = v_key_hash 
        and revoked_at is null 
        and (expires_at is null or expires_at > now());
        
      if found then
        -- Valid key, elevate privileges to match the user who created it
        perform set_config('role', 'authenticated', true);
        
        -- Override JWT claims so auth.uid() and RLS policies work seamlessly
        perform set_config('request.jwt.claims', 
          json_build_object(
            'role', 'authenticated',
            'sub', v_api_key_record.user_id,
            'org_id', v_api_key_record.org_id
          )::text, true);
      else
        -- Invalid API key provided in the custom header
        raise exception 'Invalid or revoked API Key provided in x-camai-api-key' using errcode = '28P01';
      end if;
    end if;
  end if;
end;
$$ language plpgsql security definer set search_path = public, app;

-- Assign the pre-request hook to the authenticator role
alter role authenticator set pgrst.db_pre_request = 'app.api_key_auth_hook';

-- Note: In a managed Supabase project, you might need to run 
-- NOTIFY pgrst, 'reload config'; or restart the REST API for this to take effect.
-- For local CLI, `supabase db reset` automatically reloads the config.
