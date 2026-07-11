-- ============================================================
-- CamAI Enterprise Platform — Migration 0002
-- Projects, Sites, Cameras, GIS layers/ROI, AI models & settings
-- ============================================================

-- ------------------------------------------------------------
-- Projects & Sites
-- ------------------------------------------------------------
create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null,
  description text not null default '',
  created_at  timestamptz not null default now()
);

create table public.project_members (
  project_id  uuid not null references public.projects(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  primary key (project_id, user_id)
);

create table public.sites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  project_id  uuid references public.projects(id) on delete set null,
  name        text not null,
  kind        text not null default 'site' check (kind in ('site','building','road','zone')),
  location    geometry(Point, 4326),
  footprint   geometry(Polygon, 4326),
  created_at  timestamptz not null default now()
);
create index sites_geo_idx on public.sites using gist (location);

-- ------------------------------------------------------------
-- Cameras
-- ------------------------------------------------------------
create table public.cameras (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  site_id     uuid references public.sites(id) on delete set null,
  project_id  uuid references public.projects(id) on delete set null,
  name        text not null,
  source_type text not null default 'rtsp'
              check (source_type in ('rtsp','usb','onvif','ip','nvr','dvr')),
  -- connection secrets (rtsp url w/ credentials) are stored encrypted by the
  -- Edge Function using AES-256-GCM; only ciphertext lands in this column.
  connection_encrypted text not null default '',
  onvif_profile jsonb not null default '{}'::jsonb,
  location    geometry(Point, 4326),
  heading_deg real,
  is_enabled  boolean not null default true,
  status      text not null default 'offline' check (status in ('online','offline','error')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index cameras_org_idx on public.cameras(org_id);

create table public.camera_groups (
  id     uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name   text not null
);

create table public.camera_group_members (
  group_id  uuid not null references public.camera_groups(id) on delete cascade,
  camera_id uuid not null references public.cameras(id) on delete cascade,
  primary key (group_id, camera_id)
);

-- users only ever see cameras assigned to them (admins see all)
create table public.camera_assignments (
  camera_id   uuid not null references public.cameras(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid references public.profiles(id),
  assigned_at timestamptz not null default now(),
  primary key (camera_id, user_id)
);

-- ------------------------------------------------------------
-- GIS layers & ROI
-- ------------------------------------------------------------
create table public.gis_layers (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  site_id     uuid references public.sites(id) on delete set null,
  name        text not null,
  kind        text not null default 'overlay'
              check (kind in ('overlay','restricted_area','speed_zone','roi')),
  style       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create table public.gis_layer_assignments (
  layer_id uuid not null references public.gis_layers(id) on delete cascade,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  primary key (layer_id, user_id)
);

-- Image-space ROI drawn on a camera view (normalized 0..1 coords)
create table public.polygon_roi (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  camera_id  uuid not null references public.cameras(id) on delete cascade,
  layer_id   uuid references public.gis_layers(id) on delete set null,
  name       text not null,
  points     jsonb not null,           -- [[x,y], ...] normalized
  rule       text not null default 'intrusion'
             check (rule in ('intrusion','loitering','restricted','count')),
  created_at timestamptz not null default now()
);

create table public.line_roi (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  camera_id  uuid not null references public.cameras(id) on delete cascade,
  layer_id   uuid references public.gis_layers(id) on delete set null,
  name       text not null,
  p1         jsonb not null,           -- [x,y] normalized
  p2         jsonb not null,
  direction  text not null default 'both' check (direction in ('a_to_b','b_to_a','both')),
  created_at timestamptz not null default now()
);

create table public.speed_zones (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  camera_id    uuid references public.cameras(id) on delete cascade,
  layer_id     uuid references public.gis_layers(id) on delete set null,
  name         text not null,
  geom         geometry(Polygon, 4326),
  points       jsonb,                  -- image-space alternative
  limit_kmh    real not null default 50,
  created_at   timestamptz not null default now()
);

-- ------------------------------------------------------------
-- AI models & settings
-- ------------------------------------------------------------
create table public.ai_models (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,           -- 'yolo11n', 'yolo11s', ...
  task        text not null default 'detect' check (task in ('detect','segment','pose')),
  runtime     text not null default 'pytorch' check (runtime in ('pytorch','tensorrt','openvino','onnx')),
  storage_path text not null default '',   -- supabase storage object
  is_public   boolean not null default true,
  org_id      uuid references public.organizations(id) on delete cascade  -- null = global
);

-- org-wide AI defaults, overridable per camera via settings.scope
create table public.settings (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  scope      text not null default 'org',      -- 'org' | 'camera:<uuid>' | 'user:<uuid>'
  key        text not null,                    -- 'ai.confidence', 'ai.model', 'ai.classes', ...
  value      jsonb not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (org_id, scope, key)
);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table public.projects              enable row level security;
alter table public.project_members       enable row level security;
alter table public.sites                 enable row level security;
alter table public.cameras               enable row level security;
alter table public.camera_groups         enable row level security;
alter table public.camera_group_members  enable row level security;
alter table public.camera_assignments    enable row level security;
alter table public.gis_layers            enable row level security;
alter table public.gis_layer_assignments enable row level security;
alter table public.polygon_roi           enable row level security;
alter table public.line_roi              enable row level security;
alter table public.speed_zones           enable row level security;
alter table public.ai_models             enable row level security;
alter table public.settings              enable row level security;

create policy projects_read  on public.projects for select using (org_id = app.current_org_id());
create policy projects_write on public.projects for all
  using (org_id = app.current_org_id() and app.has_perm('projects.manage'));

create policy proj_members_read on public.project_members for select
  using (exists (select 1 from public.projects p where p.id = project_id and p.org_id = app.current_org_id()));
create policy proj_members_write on public.project_members for all
  using (app.has_perm('projects.manage')
         and exists (select 1 from public.projects p where p.id = project_id and p.org_id = app.current_org_id()));

create policy sites_read  on public.sites for select using (org_id = app.current_org_id());
create policy sites_write on public.sites for all
  using (org_id = app.current_org_id() and app.has_perm('gis.manage'));

-- cameras: managers see all org cameras; everyone else only assigned ones
create policy cameras_read on public.cameras for select
  using (org_id = app.current_org_id()
         and (app.has_perm('cameras.manage')
              or exists (select 1 from public.camera_assignments ca
                         where ca.camera_id = id and ca.user_id = auth.uid())));
create policy cameras_write on public.cameras for all
  using (org_id = app.current_org_id() and app.has_perm('cameras.manage'));

create policy cam_groups_rw on public.camera_groups for all
  using (org_id = app.current_org_id() and app.has_perm('cameras.manage'));
create policy cam_groups_read on public.camera_groups for select
  using (org_id = app.current_org_id());

create policy cam_group_members_rw on public.camera_group_members for all
  using (exists (select 1 from public.camera_groups g
                 where g.id = group_id and g.org_id = app.current_org_id() and app.has_perm('cameras.manage')));

create policy cam_assign_read on public.camera_assignments for select
  using (user_id = auth.uid()
         or exists (select 1 from public.cameras c
                    where c.id = camera_id and c.org_id = app.current_org_id() and app.has_perm('cameras.assign')));
create policy cam_assign_write on public.camera_assignments for all
  using (app.has_perm('cameras.assign')
         and exists (select 1 from public.cameras c where c.id = camera_id and c.org_id = app.current_org_id()));

-- gis: same pattern — assignees or managers
create policy gis_read on public.gis_layers for select
  using (org_id = app.current_org_id()
         and (app.has_perm('gis.manage')
              or exists (select 1 from public.gis_layer_assignments la
                         where la.layer_id = id and la.user_id = auth.uid())));
create policy gis_write on public.gis_layers for all
  using (org_id = app.current_org_id() and app.has_perm('gis.manage'));

create policy gis_assign_read on public.gis_layer_assignments for select
  using (user_id = auth.uid() or app.has_perm('gis.assign'));
create policy gis_assign_write on public.gis_layer_assignments for all
  using (app.has_perm('gis.assign')
         and exists (select 1 from public.gis_layers l where l.id = layer_id and l.org_id = app.current_org_id()));

create policy poly_roi_read  on public.polygon_roi for select using (org_id = app.current_org_id());
create policy poly_roi_write on public.polygon_roi for all
  using (org_id = app.current_org_id() and app.has_perm('gis.manage'));
create policy line_roi_read  on public.line_roi for select using (org_id = app.current_org_id());
create policy line_roi_write on public.line_roi for all
  using (org_id = app.current_org_id() and app.has_perm('gis.manage'));
create policy speed_zones_read  on public.speed_zones for select using (org_id = app.current_org_id());
create policy speed_zones_write on public.speed_zones for all
  using (org_id = app.current_org_id() and app.has_perm('gis.manage'));

create policy ai_models_read on public.ai_models for select
  using (is_public or org_id = app.current_org_id());
create policy ai_models_write on public.ai_models for all
  using (org_id = app.current_org_id() and app.has_perm('ai.configure'));

create policy settings_read on public.settings for select using (org_id = app.current_org_id());
create policy settings_write on public.settings for all
  using (org_id = app.current_org_id() and app.has_perm('ai.configure'));

-- global model catalog
insert into public.ai_models (name, task, runtime) values
  ('yolo11n', 'detect', 'pytorch'),
  ('yolo11s', 'detect', 'pytorch'),
  ('yolo11m', 'detect', 'tensorrt'),
  ('yolo11n-seg', 'segment', 'pytorch');
