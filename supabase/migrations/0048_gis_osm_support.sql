-- Migration 0048: GIS OSM Support & Permission Backfill
ALTER TABLE public.cameras ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE public.cameras ADD COLUMN IF NOT EXISTS lng double precision;
ALTER TABLE public.cameras ADD COLUMN IF NOT EXISTS heading_deg real DEFAULT 0;

-- Backfill ALL existing roles with maps.manage and maps.view permissions
INSERT INTO public.role_permissions (role_id, permission)
  SELECT r.id, unnest(array['maps.manage', 'maps.view'])
  from public.roles r
ON CONFLICT (role_id, permission) DO NOTHING;
