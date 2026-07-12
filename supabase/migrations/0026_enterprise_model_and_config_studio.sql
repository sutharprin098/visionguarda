-- ============================================================
-- CamAI Enterprise Platform — Migration 0026
-- Enterprise AI Model Management & Drawing Studio tables
-- ============================================================

-- 1. Alter public.cameras to add zones and lines columns
alter table public.cameras add column if not exists zones text default '[]';
alter table public.cameras add column if not exists lines text default '[]';

-- 2. Create public.ai_model_packages table
create table public.ai_model_packages (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid references public.organizations(id) on delete cascade, -- null = public system models
  name              text not null,
  task              text not null check (task in ('detection', 'segmentation', 'pose', 'custom')),
  runtime           text not null check (runtime in ('openvino', 'onnx', 'pytorch', 'tensorrt')),
  version           text not null,
  labels            jsonb not null default '[]'::jsonb,
  size_bytes        bigint not null,
  checksum          text not null, -- sha256 checksum
  signature         text not null, -- digital signature for verification
  download_url      text not null,
  release_notes     text,
  hardware_support  jsonb not null default '["cpu", "gpu"]'::jsonb,
  dependencies      jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by        uuid references auth.users(id) on delete set null,
  deleted_at        timestamptz
);

create index ai_model_packages_org_idx on public.ai_model_packages (org_id);
create index ai_model_packages_deleted_at_idx on public.ai_model_packages (deleted_at) where deleted_at is not null;

alter table public.ai_model_packages enable row level security;

create policy ai_model_packages_read on public.ai_model_packages for select
  using ((is_public_model(org_id) or org_id = app.current_org_id() or app.is_super_admin()) and deleted_at is null);

create policy ai_model_packages_write on public.ai_model_packages for all
  using (app.is_super_admin() or (org_id = app.current_org_id() and app.has_perm('models.manage')))
  with check (app.is_super_admin() or (org_id = app.current_org_id() and app.has_perm('models.manage')));

-- Helper function to check if model package is public
create or replace function public.is_public_model(org_id uuid)
returns boolean language sql security definer as $$
  select org_id is null;
$$;


-- 3. Create public.analytics_drawings table
create table public.analytics_drawings (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  camera_id   uuid not null references public.cameras(id) on delete cascade,
  name        text not null,
  type        text not null check (type in ('polygon', 'rectangle', 'circle', 'free_draw', 'polyline', 'line', 'arrow', 'measurement')),
  purpose     text not null check (purpose in (
    'roi', 'restricted_zone', 'intrusion_zone', 'counting_line', 'entry_line', 'exit_line',
    'speed_zone', 'calibration_line', 'privacy_mask', 'exclusion_zone', 'heatmap_area',
    'queue_area', 'dwell_area', 'crowd_area', 'fire_zone', 'smoke_zone', 'vehicle_zone',
    'person_zone', 'animal_zone', 'parking_slot', 'lane', 'direction', 'custom_zone'
  )),
  points      jsonb not null, -- Array of [x, y] coordinates normalized to 0..1
  properties  jsonb not null default '{}'::jsonb, -- color, priority, custom settings
  is_draft    boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by  uuid references auth.users(id) on delete set null,
  deleted_at  timestamptz
);

create index analytics_drawings_camera_idx on public.analytics_drawings (camera_id);
create index analytics_drawings_deleted_at_idx on public.analytics_drawings (deleted_at) where deleted_at is not null;

alter table public.analytics_drawings enable row level security;

create policy analytics_drawings_read on public.analytics_drawings for select
  using ((org_id = app.current_org_id() or app.is_super_admin()) and deleted_at is null);

create policy analytics_drawings_write on public.analytics_drawings for all
  using (app.is_super_admin() or (org_id = app.current_org_id() and app.has_perm('cameras.manage')))
  with check (app.is_super_admin() or (org_id = app.current_org_id() and app.has_perm('cameras.manage')));


-- 4. Create public.rule_engine_rules table
create table public.rule_engine_rules (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  name               text not null,
  description        text,
  camera_id          uuid references public.cameras(id) on delete cascade, -- null = global org-wide rule
  trigger_type       text not null check (trigger_type in ('zone_intrusion', 'line_crossing', 'loitering', 'speed_limit', 'crowd_density', 'parking_occupancy', 'fire_smoke', 'custom')),
  trigger_source_id  uuid references public.analytics_drawings(id) on delete cascade,
  conditions         jsonb not null default '{}'::jsonb,
  actions            jsonb not null default '[]'::jsonb,
  is_draft           boolean not null default true,
  is_enabled         boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by         uuid references auth.users(id) on delete set null,
  deleted_at         timestamptz
);

create index rule_engine_rules_org_idx on public.rule_engine_rules (org_id);
create index rule_engine_rules_deleted_at_idx on public.rule_engine_rules (deleted_at) where deleted_at is not null;

alter table public.rule_engine_rules enable row level security;

create policy rule_engine_rules_read on public.rule_engine_rules for select
  using ((org_id = app.current_org_id() or app.is_super_admin()) and deleted_at is null);

create policy rule_engine_rules_write on public.rule_engine_rules for all
  using (app.is_super_admin() or (org_id = app.current_org_id() and app.has_perm('cameras.manage')))
  with check (app.is_super_admin() or (org_id = app.current_org_id() and app.has_perm('cameras.manage')));


-- 5. Create public.custom_ai_modes table
create table public.custom_ai_modes (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  name               text not null,
  description        text,
  model_assignments  jsonb not null default '[]'::jsonb, -- camera to model mapping
  active_rules       jsonb not null default '[]'::jsonb, -- active rule ids
  is_active          boolean not null default false,
  is_draft           boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by         uuid references auth.users(id) on delete set null,
  deleted_at         timestamptz
);

create index custom_ai_modes_org_idx on public.custom_ai_modes (org_id);
create index custom_ai_modes_deleted_at_idx on public.custom_ai_modes (deleted_at) where deleted_at is not null;

alter table public.custom_ai_modes enable row level security;

create policy custom_ai_modes_read on public.custom_ai_modes for select
  using ((org_id = app.current_org_id() or app.is_super_admin()) and deleted_at is null);

create policy custom_ai_modes_write on public.custom_ai_modes for all
  using (app.is_super_admin() or (org_id = app.current_org_id() and app.has_perm('cameras.manage')))
  with check (app.is_super_admin() or (org_id = app.current_org_id() and app.has_perm('cameras.manage')));


-- 6. Create public.config_versions table
create table public.config_versions (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  version            integer not null,
  drawings_snapshot  jsonb not null default '[]'::jsonb,
  rules_snapshot     jsonb not null default '[]'::jsonb,
  modes_snapshot     jsonb not null default '[]'::jsonb,
  settings_snapshot  jsonb not null default '[]'::jsonb,
  comment            text,
  published_at       timestamptz not null default now(),
  published_by       uuid references auth.users(id) on delete set null,
  status             text not null default 'active' check (status in ('active', 'rolled_back')),
  unique (org_id, version)
);

create index config_versions_org_idx on public.config_versions (org_id);

alter table public.config_versions enable row level security;

create policy config_versions_read on public.config_versions for select
  using (org_id = app.current_org_id() or app.is_super_admin());

create policy config_versions_write on public.config_versions for all
  using (app.is_super_admin() or (org_id = app.current_org_id() and app.has_perm('cameras.manage')))
  with check (app.is_super_admin() or (org_id = app.current_org_id() and app.has_perm('cameras.manage')));


-- 7. Add updated_at touch triggers to new tables
create trigger ai_model_packages_touch before update on public.ai_model_packages
  for each row execute function app.touch_updated_at();

create trigger analytics_drawings_touch before update on public.analytics_drawings
  for each row execute function app.touch_updated_at();

create trigger rule_engine_rules_touch before update on public.rule_engine_rules
  for each row execute function app.touch_updated_at();

create trigger custom_ai_modes_touch before update on public.custom_ai_modes
  for each row execute function app.touch_updated_at();
