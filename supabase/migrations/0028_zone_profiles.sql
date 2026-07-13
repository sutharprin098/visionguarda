-- ============================================================
-- CamAI Enterprise Platform — Migration 0028
-- Zone Profiles: replace the flat zone-type list with four
-- enterprise Zone Profiles (Traffic / Security / Factory / Custom).
-- Each profile is a *category* that carries an editable set of AI
-- feature configs (toggles, thresholds, object classes, tracking,
-- alerts, schedule) persisted per camera.
-- ============================================================

-- 1. Mark the active profile on each camera.
alter table public.cameras
  add column if not exists zone_profile text
  check (zone_profile is null or zone_profile in ('traffic', 'security', 'factory', 'custom'));

-- 2. Per-camera, per-profile feature configuration.
--    `features` holds the full editable feature tree for the profile:
--      { "<feature_key>": { "enabled": bool, "params": { ... } }, ... }
--    The front-end catalog (desktop/src/lib/zoneProfiles.ts) is the
--    source of truth for which features/params exist; this stores the
--    operator-chosen values.
create table if not exists public.zone_profile_configs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  camera_id   uuid not null references public.cameras(id) on delete cascade,
  profile     text not null check (profile in ('traffic', 'security', 'factory', 'custom')),
  features    jsonb not null default '{}'::jsonb,
  is_draft    boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by  uuid references auth.users(id) on delete set null,
  deleted_at  timestamptz,
  unique (camera_id, profile)
);

create index if not exists zone_profile_configs_org_idx on public.zone_profile_configs (org_id);
create index if not exists zone_profile_configs_camera_idx on public.zone_profile_configs (camera_id);

alter table public.zone_profile_configs enable row level security;

create policy zone_profile_configs_read on public.zone_profile_configs for select
  using ((org_id = app.current_org_id() or app.is_super_admin()) and deleted_at is null);

create policy zone_profile_configs_write on public.zone_profile_configs for all
  using (app.is_super_admin() or (org_id = app.current_org_id() and app.has_perm('cameras.manage')))
  with check (app.is_super_admin() or (org_id = app.current_org_id() and app.has_perm('cameras.manage')));

create trigger zone_profile_configs_touch before update on public.zone_profile_configs
  for each row execute function app.touch_updated_at();

-- 3. Tag drawings with the profile + feature they serve, so a drawn ROI
--    can be bound to a specific feature (e.g. a lane polygon -> "lane_detection",
--    a tripwire -> "line_crossing"). Nullable: legacy/global drawings keep null.
alter table public.analytics_drawings
  add column if not exists profile text
  check (profile is null or profile in ('traffic', 'security', 'factory', 'custom'));

alter table public.analytics_drawings
  add column if not exists feature_key text;

-- 4. The rigid purpose CHECK constraint blocked new feature-specific zone
--    purposes (hazard_zone, machine_zone, stop_line, wrong_way_zone, ...) and
--    the Custom profile's arbitrary zones. Drop it; the app catalog validates
--    purposes now. Existing rows are unaffected.
alter table public.analytics_drawings
  drop constraint if exists analytics_drawings_purpose_check;

-- Likewise loosen the rule trigger_type list so profile alert rules
-- (wrong_way, speed_limit, ppe_violation, fall, fire_smoke, anpr, ...)
-- can be stored without churn.
alter table public.rule_engine_rules
  drop constraint if exists rule_engine_rules_trigger_type_check;

-- 5. Snapshot profile configs in the config_versions publish/rollback flow.
alter table public.config_versions
  add column if not exists profile_configs_snapshot jsonb not null default '[]'::jsonb;

-- 6. Extend publish_config to snapshot + publish profile configs.
create or replace function public.publish_config(
  p_org_id uuid,
  p_comment text,
  p_user_id uuid
) returns json language plpgsql security definer as $$
declare
  v_next_version int;
  v_drawings_json jsonb;
  v_rules_json jsonb;
  v_modes_json jsonb;
  v_settings_json jsonb;
  v_profiles_json jsonb;
  v_camera record;
  v_zones_json text;
  v_lines_json text;
begin
  select coalesce(max(version), 0) + 1 into v_next_version
  from public.config_versions
  where org_id = p_org_id;

  select coalesce(jsonb_agg(d), '[]'::jsonb) into v_drawings_json
  from public.analytics_drawings d
  where org_id = p_org_id and deleted_at is null;

  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_rules_json
  from public.rule_engine_rules r
  where org_id = p_org_id and deleted_at is null;

  select coalesce(jsonb_agg(m), '[]'::jsonb) into v_modes_json
  from public.custom_ai_modes m
  where org_id = p_org_id and deleted_at is null;

  select coalesce(jsonb_agg(s), '[]'::jsonb) into v_settings_json
  from public.settings s
  where org_id = p_org_id and deleted_at is null;

  select coalesce(jsonb_agg(p), '[]'::jsonb) into v_profiles_json
  from public.zone_profile_configs p
  where org_id = p_org_id and deleted_at is null;

  insert into public.config_versions (
    org_id, version, drawings_snapshot, rules_snapshot, modes_snapshot,
    settings_snapshot, profile_configs_snapshot, comment, published_by
  ) values (
    p_org_id, v_next_version, v_drawings_json, v_rules_json, v_modes_json,
    v_settings_json, v_profiles_json, p_comment, p_user_id
  );

  update public.analytics_drawings
  set is_draft = false
  where org_id = p_org_id and is_draft = true and deleted_at is null;

  update public.rule_engine_rules
  set is_draft = false
  where org_id = p_org_id and is_draft = true and deleted_at is null;

  update public.custom_ai_modes
  set is_draft = false
  where org_id = p_org_id and is_draft = true and deleted_at is null;

  update public.zone_profile_configs
  set is_draft = false
  where org_id = p_org_id and is_draft = true and deleted_at is null;

  for v_camera in (
    select id from public.cameras where org_id = p_org_id and deleted_at is null
  ) loop
    select coalesce(
      json_strip_nulls(
        json_agg(
          json_build_object(
            'id', id, 'name', name, 'shapeType', type,
            'zoneType', purpose, 'profile', profile, 'featureKey', feature_key,
            'points', points, 'properties', properties
          )
        )
      )::text, '[]'
    ) into v_zones_json
    from public.analytics_drawings
    where camera_id = v_camera.id
      and deleted_at is null
      and purpose not in ('counting_line', 'entry_line', 'exit_line', 'calibration_line');

    select coalesce(
      json_strip_nulls(
        json_agg(
          json_build_object(
            'id', id, 'name', name, 'shapeType', type,
            'purpose', purpose, 'profile', profile, 'featureKey', feature_key,
            'points', points, 'properties', properties
          )
        )
      )::text, '[]'
    ) into v_lines_json
    from public.analytics_drawings
    where camera_id = v_camera.id
      and deleted_at is null
      and purpose in ('counting_line', 'entry_line', 'exit_line', 'calibration_line');

    update public.cameras
    set zones = v_zones_json,
        lines = v_lines_json,
        updated_at = now()
    where id = v_camera.id;
  end loop;

  return json_build_object('success', true, 'version', v_next_version);
end;
$$;

-- 7. Extend rollback_config to restore profile configs.
create or replace function public.rollback_config(
  p_org_id uuid,
  p_version int,
  p_user_id uuid
) returns json language plpgsql security definer as $$
declare
  v_version_row record;
  v_drawing jsonb;
  v_rule jsonb;
  v_mode jsonb;
  v_profile jsonb;
  v_camera record;
  v_zones_json text;
  v_lines_json text;
begin
  select * into v_version_row
  from public.config_versions
  where org_id = p_org_id and version = p_version;

  if not found then
    return json_build_object('success', false, 'error', 'Version not found');
  end if;

  delete from public.analytics_drawings where org_id = p_org_id;
  delete from public.rule_engine_rules where org_id = p_org_id;
  delete from public.custom_ai_modes where org_id = p_org_id;
  delete from public.zone_profile_configs where org_id = p_org_id;

  for v_drawing in select * from jsonb_array_elements(v_version_row.drawings_snapshot) loop
    insert into public.analytics_drawings (
      id, org_id, camera_id, name, type, purpose, profile, feature_key,
      points, properties, is_draft, created_at, updated_at, created_by, updated_by
    ) values (
      (v_drawing->>'id')::uuid, p_org_id, (v_drawing->>'camera_id')::uuid,
      v_drawing->>'name', v_drawing->>'type', v_drawing->>'purpose',
      v_drawing->>'profile', v_drawing->>'feature_key',
      v_drawing->'points', v_drawing->'properties', false,
      coalesce((v_drawing->>'created_at')::timestamptz, now()), now(),
      (v_drawing->>'created_by')::uuid, p_user_id
    );
  end loop;

  for v_rule in select * from jsonb_array_elements(v_version_row.rules_snapshot) loop
    insert into public.rule_engine_rules (
      id, org_id, name, description, camera_id, trigger_type, trigger_source_id,
      conditions, actions, is_draft, is_enabled, created_at, updated_at, created_by, updated_by
    ) values (
      (v_rule->>'id')::uuid, p_org_id, v_rule->>'name', v_rule->>'description',
      (v_rule->>'camera_id')::uuid, v_rule->>'trigger_type', (v_rule->>'trigger_source_id')::uuid,
      v_rule->'conditions', v_rule->'actions', false,
      coalesce((v_rule->>'is_enabled')::boolean, true),
      coalesce((v_rule->>'created_at')::timestamptz, now()), now(),
      (v_rule->>'created_by')::uuid, p_user_id
    );
  end loop;

  for v_mode in select * from jsonb_array_elements(v_version_row.modes_snapshot) loop
    insert into public.custom_ai_modes (
      id, org_id, name, description, model_assignments, active_rules,
      is_active, is_draft, created_at, updated_at, created_by, updated_by
    ) values (
      (v_mode->>'id')::uuid, p_org_id, v_mode->>'name', v_mode->>'description',
      v_mode->'model_assignments', v_mode->'active_rules',
      coalesce((v_mode->>'is_active')::boolean, false), false,
      coalesce((v_mode->>'created_at')::timestamptz, now()), now(),
      (v_mode->>'created_by')::uuid, p_user_id
    );
  end loop;

  for v_profile in select * from jsonb_array_elements(v_version_row.profile_configs_snapshot) loop
    insert into public.zone_profile_configs (
      id, org_id, camera_id, profile, features, is_draft,
      created_at, updated_at, created_by, updated_by
    ) values (
      (v_profile->>'id')::uuid, p_org_id, (v_profile->>'camera_id')::uuid,
      v_profile->>'profile', coalesce(v_profile->'features', '{}'::jsonb), false,
      coalesce((v_profile->>'created_at')::timestamptz, now()), now(),
      (v_profile->>'created_by')::uuid, p_user_id
    );
  end loop;

  for v_camera in (
    select id from public.cameras where org_id = p_org_id and deleted_at is null
  ) loop
    select coalesce(
      json_strip_nulls(
        json_agg(
          json_build_object(
            'id', id, 'name', name, 'shapeType', type,
            'zoneType', purpose, 'profile', profile, 'featureKey', feature_key,
            'points', points, 'properties', properties
          )
        )
      )::text, '[]'
    ) into v_zones_json
    from public.analytics_drawings
    where camera_id = v_camera.id
      and purpose not in ('counting_line', 'entry_line', 'exit_line', 'calibration_line');

    select coalesce(
      json_strip_nulls(
        json_agg(
          json_build_object(
            'id', id, 'name', name, 'shapeType', type,
            'purpose', purpose, 'profile', profile, 'featureKey', feature_key,
            'points', points, 'properties', properties
          )
        )
      )::text, '[]'
    ) into v_lines_json
    from public.analytics_drawings
    where camera_id = v_camera.id
      and purpose in ('counting_line', 'entry_line', 'exit_line', 'calibration_line');

    update public.cameras
    set zones = v_zones_json,
        lines = v_lines_json,
        updated_at = now()
    where id = v_camera.id;
  end loop;

  return json_build_object('success', true);
end;
$$;
