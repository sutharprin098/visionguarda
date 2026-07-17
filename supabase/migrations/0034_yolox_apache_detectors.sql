-- ============================================================
-- CamAI Enterprise Platform — Migration 0030
-- Retire the AGPL-3.0 YOLO11 detector from the catalog in favour
-- of the Apache-2.0 YOLOX detectors the engine now ships.
--
-- Context: the engine's detector was swapped from Ultralytics
-- YOLO11-seg (AGPL-3.0 weights, incompatible with proprietary
-- redistribution) to YOLOX (Apache-2.0). The engine's built-in
-- model ids are now yolox_tiny / yolox_s / yolox_m and it no
-- longer performs segmentation — analytics was always box-only,
-- masks were overlay decoration. See LICENSING.md.
-- ============================================================

-- 1. Functional catalog: `ai_models` rows drive the org-wide `ai.model`
--    setting, which desktop/src/lib/localEngine.ts forwards verbatim to the
--    engine's /api/model/select. Names must match the engine's built-ins
--    exactly or every sync tick 400s.
delete from public.ai_models where name in ('yolo11n', 'yolo11s', 'yolo11m', 'yolo11n-seg');

insert into public.ai_models (name, task, runtime)
select v.name, v.task, v.runtime
from (values
  ('yolox_tiny', 'detect', 'openvino'),
  ('yolox_s',    'detect', 'openvino'),
  ('yolox_m',    'detect', 'openvino')
) as v(name, task, runtime)
where not exists (
  select 1 from public.ai_models m where m.name = v.name and m.org_id is null
);

-- 2. Repoint any org that had explicitly selected a YOLO11 tier onto the
--    equivalent YOLOX tier, so an upgraded install keeps a working model
--    instead of a setting the engine rejects. `ai.model` is a jsonb scalar
--    string; #>> '{}' reads it as text.
update public.settings set value = to_jsonb('yolox_tiny'::text)
 where key = 'ai.model' and value #>> '{}' in ('yolo11n', 'yolo11n-seg');
update public.settings set value = to_jsonb('yolox_s'::text)
 where key = 'ai.model' and value #>> '{}' = 'yolo11s';
update public.settings set value = to_jsonb('yolox_m'::text)
 where key = 'ai.model' and value #>> '{}' = 'yolo11m';

-- 3. Display catalog: `ai_model_packages` rows are updated in place rather
--    than deleted+reinserted because model_profile_assignments references
--    them with on delete cascade — a delete would silently drop an org's
--    profile assignments.
update public.ai_model_packages
   set name = 'YOLOX Tiny', framework = 'Megvii (Apache-2.0)', runtime = 'openvino',
       version = '0.1.1', size_bytes = 20259174,
       description = 'Fastest YOLOX detector for CPU / edge devices.',
       release_notes = 'Baseline tiny detector. Ideal when no GPU is present.'
 where name = 'YOLO11 Nano' and org_id is null;

update public.ai_model_packages
   set name = 'YOLOX S', framework = 'Megvii (Apache-2.0)', runtime = 'openvino',
       version = '0.1.1', size_bytes = 35897360,
       description = 'Balanced YOLOX detector.',
       release_notes = 'Good accuracy/speed trade-off. Default on GPU hosts.'
 where name = 'YOLO11 Small' and org_id is null;

update public.ai_model_packages
   set name = 'YOLOX M', framework = 'Megvii (Apache-2.0)', runtime = 'openvino',
       version = '0.1.1', size_bytes = 101310487,
       description = 'Higher-accuracy YOLOX detector.',
       release_notes = 'Recommended where latency budget allows.'
 where name = 'YOLO11 Medium' and org_id is null;

-- YOLOX-L is a real upstream Apache-2.0 checkpoint but is not one of the three
-- tiers the engine ships; kept as a catalog entry an operator can add via
-- export_models.py, hence status 'draft' rather than 'published'.
update public.ai_model_packages
   set name = 'YOLOX L', framework = 'Megvii (Apache-2.0)', runtime = 'onnx',
       version = '0.1.1', size_bytes = 216006656,
       description = 'Maximum-accuracy YOLOX detector.',
       release_notes = 'Not bundled — export locally with server/export_models.py.',
       status = 'draft'
 where name = 'YOLO11 Large' and org_id is null;

-- The engine no longer ships a segmentation model, and this row named an
-- AGPL-licensed one. Cascades to any model_profile_assignments for it.
delete from public.ai_model_packages where name = 'YOLO11 Seg' and org_id is null;
