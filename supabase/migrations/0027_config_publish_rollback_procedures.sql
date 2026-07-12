-- ============================================================
-- CamAI Enterprise Platform — Migration 0027
-- Database procedures for config publish and rollback
-- ============================================================

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
  v_camera record;
  v_zones_json text;
  v_lines_json text;
begin
  -- 1. Determine next version number
  select coalesce(max(version), 0) + 1 into v_next_version
  from public.config_versions
  where org_id = p_org_id;

  -- 2. Gather current configurations into snapshot JSONs
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

  -- 3. Create version entry
  insert into public.config_versions (
    org_id, version, drawings_snapshot, rules_snapshot, modes_snapshot, settings_snapshot, comment, published_by
  ) values (
    p_org_id, v_next_version, v_drawings_json, v_rules_json, v_modes_json, v_settings_json, p_comment, p_user_id
  );

  -- 4. Mark drafts as published (is_draft = false)
  update public.analytics_drawings
  set is_draft = false
  where org_id = p_org_id and is_draft = true and deleted_at is null;

  update public.rule_engine_rules
  set is_draft = false
  where org_id = p_org_id and is_draft = true and deleted_at is null;

  update public.custom_ai_modes
  set is_draft = false
  where org_id = p_org_id and is_draft = true and deleted_at is null;

  -- 5. Compile drawings into cameras.zones and cameras.lines!
  for v_camera in (
    select id from public.cameras where org_id = p_org_id and deleted_at is null
  ) loop
    -- Compile zones (intrusion_zone, restricted_zone, etc.)
    select coalesce(
      json_strip_nulls(
        json_agg(
          json_build_object(
            'id', id,
            'name', name,
            'shapeType', type,
            'zoneType', purpose,
            'points', points,
            'properties', properties
          )
        )
      )::text,
      '[]'
    ) into v_zones_json
    from public.analytics_drawings
    where camera_id = v_camera.id 
      and deleted_at is null
      and purpose not in ('counting_line', 'entry_line', 'exit_line', 'calibration_line');

    -- Compile lines (counting_line, entry_line, exit_line, calibration_line)
    select coalesce(
      json_strip_nulls(
        json_agg(
          json_build_object(
            'id', id,
            'name', name,
            'shapeType', type,
            'purpose', purpose,
            'points', points,
            'properties', properties
          )
        )
      )::text,
      '[]'
    ) into v_lines_json
    from public.analytics_drawings
    where camera_id = v_camera.id 
      and deleted_at is null
      and purpose in ('counting_line', 'entry_line', 'exit_line', 'calibration_line');

    -- Update cameras table
    update public.cameras
    set zones = v_zones_json,
        lines = v_lines_json,
        updated_at = now()
    where id = v_camera.id;
  end loop;

  return json_build_object('success', true, 'version', v_next_version);
end;
$$;


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
  v_camera record;
  v_zones_json text;
  v_lines_json text;
begin
  -- 1. Fetch snapshot from config_versions
  select * into v_version_row
  from public.config_versions
  where org_id = p_org_id and version = p_version;

  if not found then
    return json_build_object('success', false, 'error', 'Version not found');
  end if;

  -- 2. Clear current configurations
  delete from public.analytics_drawings where org_id = p_org_id;
  delete from public.rule_engine_rules where org_id = p_org_id;
  delete from public.custom_ai_modes where org_id = p_org_id;

  -- 3. Restore drawings from snapshot
  for v_drawing in select * from jsonb_array_elements(v_version_row.drawings_snapshot) loop
    insert into public.analytics_drawings (
      id, org_id, camera_id, name, type, purpose, points, properties, is_draft, created_at, updated_at, created_by, updated_by
    ) values (
      (v_drawing->>'id')::uuid,
      p_org_id,
      (v_drawing->>'camera_id')::uuid,
      v_drawing->>'name',
      v_drawing->>'type',
      v_drawing->>'purpose',
      v_drawing->'points',
      v_drawing->'properties',
      false,
      coalesce((v_drawing->>'created_at')::timestamptz, now()),
      now(),
      (v_drawing->>'created_by')::uuid,
      p_user_id
    );
  end loop;

  -- 4. Restore rules from snapshot
  for v_rule in select * from jsonb_array_elements(v_version_row.rules_snapshot) loop
    insert into public.rule_engine_rules (
      id, org_id, name, description, camera_id, trigger_type, trigger_source_id, conditions, actions, is_draft, is_enabled, created_at, updated_at, created_by, updated_by
    ) values (
      (v_rule->>'id')::uuid,
      p_org_id,
      v_rule->>'name',
      v_rule->>'description',
      (v_rule->>'camera_id')::uuid,
      v_rule->>'trigger_type',
      (v_rule->>'trigger_source_id')::uuid,
      v_rule->'conditions',
      v_rule->'actions',
      false,
      coalesce((v_rule->>'is_enabled')::boolean, true),
      coalesce((v_rule->>'created_at')::timestamptz, now()),
      now(),
      (v_rule->>'created_by')::uuid,
      p_user_id
    );
  end loop;

  -- 5. Restore custom modes from snapshot
  for v_mode in select * from jsonb_array_elements(v_version_row.modes_snapshot) loop
    insert into public.custom_ai_modes (
      id, org_id, name, description, model_assignments, active_rules, is_active, is_draft, created_at, updated_at, created_by, updated_by
    ) values (
      (v_mode->>'id')::uuid,
      p_org_id,
      v_mode->>'name',
      v_mode->>'description',
      v_mode->'model_assignments',
      v_mode->'active_rules',
      coalesce((v_mode->>'is_active')::boolean, false),
      false,
      coalesce((v_mode->>'created_at')::timestamptz, now()),
      now(),
      (v_mode->>'created_by')::uuid,
      p_user_id
    );
  end loop;

  -- 6. Recompile and update cameras
  for v_camera in (
    select id from public.cameras where org_id = p_org_id and deleted_at is null
  ) loop
    select coalesce(
      json_strip_nulls(
        json_agg(
          json_build_object(
            'id', id,
            'name', name,
            'shapeType', type,
            'zoneType', purpose,
            'points', points,
            'properties', properties
          )
        )
      )::text,
      '[]'
    ) into v_zones_json
    from public.analytics_drawings
    where camera_id = v_camera.id 
      and purpose not in ('counting_line', 'entry_line', 'exit_line', 'calibration_line');

    select coalesce(
      json_strip_nulls(
        json_agg(
          json_build_object(
            'id', id,
            'name', name,
            'shapeType', type,
            'purpose', purpose,
            'points', points,
            'properties', properties
          )
        )
      )::text,
      '[]'
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
