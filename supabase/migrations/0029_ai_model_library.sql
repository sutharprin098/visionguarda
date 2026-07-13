-- ============================================================
-- CamAI Enterprise Platform — Migration 0029
-- AI Model Library: full catalog metadata, model→profile
-- assignment, and a seeded set of default system models.
-- Catalog-only: download_url / checksum / signature are made
-- nullable because binaries + signing keys are supplied later;
-- the management, categorisation and assignment layer is real.
-- ============================================================

-- 1. Widen the model catalog metadata.
alter table public.ai_model_packages drop constraint if exists ai_model_packages_task_check;
alter table public.ai_model_packages drop constraint if exists ai_model_packages_runtime_check;

alter table public.ai_model_packages
  add column if not exists category        text,
  add column if not exists framework       text,
  add column if not exists description      text,
  add column if not exists cpu_requirement text,
  add column if not exists gpu_requirement text,
  add column if not exists ram_requirement text,
  add column if not exists cuda_requirement text,
  add column if not exists status          text not null default 'published';

alter table public.ai_model_packages
  drop constraint if exists ai_model_packages_status_check;
alter table public.ai_model_packages
  add constraint ai_model_packages_status_check
  check (status in ('draft', 'published', 'deprecated'));

alter table public.ai_model_packages
  drop constraint if exists ai_model_packages_category_check;
alter table public.ai_model_packages
  add constraint ai_model_packages_category_check
  check (category is null or category in (
    'detection', 'segmentation', 'tracking', 'ocr', 'pose',
    'face', 'fire', 'smoke', 'vehicle', 'ppe', 'custom'
  ));

-- Binaries + keys arrive later; allow catalog entries without them.
alter table public.ai_model_packages alter column download_url drop not null;
alter table public.ai_model_packages alter column checksum drop not null;
alter table public.ai_model_packages alter column signature drop not null;

-- 2. Model → profile assignment.
create table if not exists public.model_profile_assignments (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid references public.organizations(id) on delete cascade, -- null = platform default
  model_id    uuid not null references public.ai_model_packages(id) on delete cascade,
  profile     text not null check (profile in ('traffic', 'security', 'factory', 'custom')),
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null default auth.uid()
);

-- Treat a null org_id as a fixed sentinel so platform-default rows can't
-- duplicate (nulls are otherwise distinct in a unique constraint).
create unique index if not exists model_profile_assignments_uniq
  on public.model_profile_assignments (
    model_id, profile, coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
create index if not exists model_profile_assignments_org_idx on public.model_profile_assignments (org_id);

alter table public.model_profile_assignments enable row level security;

create policy model_profile_assignments_read on public.model_profile_assignments for select
  using (org_id is null or org_id = app.current_org_id() or app.is_super_admin());

create policy model_profile_assignments_write on public.model_profile_assignments for all
  using (app.is_super_admin() or (org_id = app.current_org_id() and app.has_perm('models.manage')))
  with check (app.is_super_admin() or (org_id = app.current_org_id() and app.has_perm('models.manage')));

-- 3. Seed the default system model catalog (org_id null = public).
--    Idempotent: skip a model whose (name, version) already exists.
insert into public.ai_model_packages
  (org_id, name, task, category, framework, runtime, version, description,
   size_bytes, cpu_requirement, gpu_requirement, ram_requirement, cuda_requirement,
   hardware_support, release_notes, status)
select v.* from (values
  -- Detection
  (null::uuid, 'YOLO11 Nano',  'detection', 'detection', 'Ultralytics', 'onnx',     '11.0.0', 'Fastest YOLO11 detector for CPU / edge devices.',          6291456::bigint,  '2 cores', 'Optional',        '2 GB', 'None',   '["cpu","gpu"]'::jsonb, 'Baseline nano detector. Ideal when no GPU is present.', 'published'),
  (null::uuid, 'YOLO11 Small', 'detection', 'detection', 'Ultralytics', 'onnx',     '11.0.0', 'Balanced YOLO11 detector for entry-level GPUs.',          20971520::bigint, '4 cores', 'GTX-class',       '4 GB', '11.8+',  '["cpu","gpu"]'::jsonb, 'Good accuracy/speed trade-off for GTX GPUs.',           'published'),
  (null::uuid, 'YOLO11 Medium','detection', 'detection', 'Ultralytics', 'onnx',     '11.0.0', 'Higher-accuracy YOLO11 detector.',                        52428800::bigint, '6 cores', 'RTX-class',       '8 GB', '11.8+',  '["gpu"]'::jsonb,       'Recommended for RTX GPUs.',                             'published'),
  (null::uuid, 'YOLO11 Large', 'detection', 'detection', 'Ultralytics', 'tensorrt', '11.0.0', 'Maximum-accuracy YOLO11 detector, TensorRT optimised.',   104857600::bigint,'8 cores', 'RTX 3060+',       '12 GB','12.0+',  '["gpu"]'::jsonb,       'Best accuracy. TensorRT engine build on first load.',   'published'),
  -- Segmentation
  (null::uuid, 'YOLO11 Seg',   'segmentation', 'segmentation', 'Ultralytics', 'onnx',     '11.0.0', 'Instance segmentation with YOLO11.',                 54525952::bigint, '6 cores', 'GTX-class',    '6 GB', '11.8+', '["cpu","gpu"]'::jsonb, 'Per-object masks for zone occupancy.',             'published'),
  (null::uuid, 'SAM2',         'segmentation', 'segmentation', 'Meta',        'pytorch',  '2.1.0',  'Segment Anything v2 — promptable segmentation.',     357564416::bigint,'8 cores', 'RTX 3080+',    '16 GB','12.0+', '["gpu"]'::jsonb,       'Heavy; workstation GPUs only.',                    'published'),
  (null::uuid, 'MobileSAM',    'segmentation', 'segmentation', 'Community',   'onnx',     '1.0.0',  'Lightweight distilled SAM for edge.',                41943040::bigint, '4 cores', 'Optional',     '4 GB', '11.8+', '["cpu","gpu"]'::jsonb, 'Runs on CPU at reduced speed.',                    'published'),
  (null::uuid, 'FastSAM',      'segmentation', 'segmentation', 'Ultralytics', 'onnx',     '1.0.0',  'Real-time SAM alternative built on YOLO.',           146800640::bigint,'6 cores', 'GTX-class',    '6 GB', '11.8+', '["cpu","gpu"]'::jsonb, 'Faster than SAM2 with slightly lower quality.',    'published'),
  -- Tracking
  (null::uuid, 'ByteTrack',    'tracking', 'tracking', 'ByteDance', 'onnx',    '1.0.0', 'High-performance multi-object tracker.',        2097152::bigint, '2 cores', 'Optional', '2 GB', 'None',  '["cpu","gpu"]'::jsonb, 'Default tracker. Association-only, pairs with any detector.', 'published'),
  (null::uuid, 'BoT-SORT',     'tracking', 'tracking', 'Community', 'onnx',    '1.0.0', 'Tracker with camera-motion compensation + ReID.', 8388608::bigint, '4 cores', 'GTX-class','4 GB', '11.8+', '["cpu","gpu"]'::jsonb, 'Better ID persistence on moving cameras.',                   'published'),
  (null::uuid, 'DeepSORT',     'tracking', 'tracking', 'Community', 'onnx',    '1.0.0', 'Appearance-embedding tracker.',                 12582912::bigint,'4 cores', 'GTX-class','4 GB', '11.8+', '["cpu","gpu"]'::jsonb, 'Robust ReID; higher cost.',                                  'published'),
  (null::uuid, 'OC-SORT',      'tracking', 'tracking', 'Community', 'onnx',    '1.0.0', 'Observation-centric SORT.',                     2097152::bigint, '2 cores', 'Optional', '2 GB', 'None',  '["cpu","gpu"]'::jsonb, 'Strong on occlusion without appearance model.',              'published'),
  -- OCR
  (null::uuid, 'PaddleOCR',    'ocr', 'ocr', 'PaddlePaddle', 'onnx', '2.7.0', 'Multilingual scene-text recognition.', 20971520::bigint, '4 cores', 'GTX-class','4 GB', '11.8+', '["cpu","gpu"]'::jsonb, 'Used by ANPR / plate reading.', 'published'),
  (null::uuid, 'EasyOCR',      'ocr', 'ocr', 'JaidedAI',     'pytorch','1.7.0','80+ language OCR.',                    67108864::bigint, '4 cores', 'GTX-class','6 GB', '11.8+', '["cpu","gpu"]'::jsonb, 'Broad language coverage.',      'published'),
  -- Pose
  (null::uuid, 'RTMPose',      'pose', 'pose', 'OpenMMLab',   'onnx', '1.1.0', 'Real-time whole-body pose estimation.', 25165824::bigint, '4 cores', 'GTX-class','4 GB', '11.8+', '["cpu","gpu"]'::jsonb, 'Feeds fall detection.',    'published'),
  (null::uuid, 'YOLO Pose',    'pose', 'pose', 'Ultralytics', 'onnx', '11.0.0','YOLO11 keypoint pose model.',          22020096::bigint, '4 cores', 'GTX-class','4 GB', '11.8+', '["cpu","gpu"]'::jsonb, 'Single-stage pose.',       'published'),
  -- Face
  (null::uuid, 'RetinaFace',   'face', 'face', 'InsightFace', 'onnx', '1.0.0', 'Robust face detector with landmarks.', 29360128::bigint, '4 cores', 'GTX-class','4 GB', '11.8+', '["cpu","gpu"]'::jsonb, 'Front-end for face recognition.', 'published'),
  (null::uuid, 'SCRFD',        'face', 'face', 'InsightFace', 'onnx', '1.0.0', 'Efficient face detector for edge.',    10485760::bigint, '2 cores', 'Optional', '2 GB', 'None',  '["cpu","gpu"]'::jsonb, 'Lightweight face detection.',     'published'),
  -- Fire / Smoke
  (null::uuid, 'Fire Detection',  'detection', 'fire',  'CamAI', 'onnx', '1.0.0', 'Vision-based fire detection.',  15728640::bigint, '4 cores', 'GTX-class','4 GB', '11.8+', '["cpu","gpu"]'::jsonb, 'Trained on flame imagery.', 'published'),
  (null::uuid, 'Smoke Detection', 'detection', 'smoke', 'CamAI', 'onnx', '1.0.0', 'Vision-based smoke detection.', 15728640::bigint, '4 cores', 'GTX-class','4 GB', '11.8+', '["cpu","gpu"]'::jsonb, 'Early smoke plume detection.', 'published'),
  -- Vehicle
  (null::uuid, 'Vehicle Classifier',       'detection', 'vehicle', 'CamAI', 'onnx', '1.0.0', 'Fine-grained vehicle type classifier.',        18874368::bigint, '4 cores', 'GTX-class','4 GB', '11.8+', '["cpu","gpu"]'::jsonb, 'Sedan / truck / bus / two-wheeler.', 'published'),
  (null::uuid, 'License Plate Detection',  'detection', 'vehicle', 'CamAI', 'onnx', '1.0.0', 'ANPR plate localisation.',                     12582912::bigint, '4 cores', 'GTX-class','4 GB', '11.8+', '["cpu","gpu"]'::jsonb, 'Pairs with PaddleOCR for reading.',  'published'),
  (null::uuid, 'Speed Estimation',         'detection', 'vehicle', 'CamAI', 'onnx', '1.0.0', 'Calibrated vehicle speed estimation.',         6291456::bigint,  '4 cores', 'Optional', '4 GB', 'None',  '["cpu","gpu"]'::jsonb, 'Requires calibration lines.',        'published'),
  -- PPE / Factory
  (null::uuid, 'PPE Detection',    'detection', 'ppe', 'CamAI', 'onnx', '1.0.0', 'Multi-class PPE compliance detector.', 22020096::bigint, '4 cores', 'GTX-class','4 GB', '11.8+', '["cpu","gpu"]'::jsonb, 'Helmet / vest / gloves / shoes.', 'published'),
  (null::uuid, 'Helmet Detection', 'detection', 'ppe', 'CamAI', 'onnx', '1.0.0', 'Hard-hat compliance detector.',        12582912::bigint, '2 cores', 'Optional', '2 GB', 'None',  '["cpu","gpu"]'::jsonb, 'Single-class helmet model.',      'published'),
  (null::uuid, 'Vest Detection',   'detection', 'ppe', 'CamAI', 'onnx', '1.0.0', 'Hi-vis vest compliance detector.',     12582912::bigint, '2 cores', 'Optional', '2 GB', 'None',  '["cpu","gpu"]'::jsonb, 'Single-class vest model.',        'published')
) as v(org_id, name, task, category, framework, runtime, version, description,
       size_bytes, cpu_requirement, gpu_requirement, ram_requirement, cuda_requirement,
       hardware_support, release_notes, status)
where not exists (
  select 1 from public.ai_model_packages e
  where e.org_id is null and e.name = v.name and e.version = v.version
);

-- 4. Seed platform-default profile assignments by category.
--    Traffic  → detection, tracking, vehicle
--    Security → detection, segmentation, tracking, face, fire, smoke
--    Factory  → detection, ppe, fire, smoke
--    Custom   → none (operator chooses)
insert into public.model_profile_assignments (org_id, model_id, profile)
select null, m.id, a.profile
from public.ai_model_packages m
join (values
  ('traffic',  'detection'), ('traffic',  'tracking'), ('traffic',  'vehicle'),
  ('security', 'detection'), ('security', 'segmentation'), ('security', 'tracking'),
  ('security', 'face'), ('security', 'fire'), ('security', 'smoke'),
  ('factory',  'detection'), ('factory',  'ppe'), ('factory',  'fire'), ('factory', 'smoke')
) as a(profile, category) on a.category = m.category
where m.org_id is null
on conflict do nothing;
