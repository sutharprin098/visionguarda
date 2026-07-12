-- ============================================================
-- CamAI Enterprise Platform — Migration 0006
-- Remove GIS module: map layers, ROI, speed zones, geo columns.
-- Sites remain as a plain location/grouping entity (name, kind,
-- address, project) — only the mapping/geometry parts are dropped.
-- ============================================================

-- ------------------------------------------------------------
-- Drop GIS-only tables (policies drop automatically with them)
-- ------------------------------------------------------------
drop table if exists public.speed_zones;
drop table if exists public.line_roi;
drop table if exists public.polygon_roi;
drop table if exists public.gis_layer_assignments;
drop table if exists public.gis_layers;

-- ------------------------------------------------------------
-- Realtime publication: drop references to removed tables
-- ------------------------------------------------------------
alter publication supabase_realtime drop table public.gis_layers;
alter publication supabase_realtime drop table public.gis_layer_assignments;

-- ------------------------------------------------------------
-- Geometry / map columns on cameras and sites
-- ------------------------------------------------------------
drop index if exists public.sites_geo_idx;
alter table public.sites   drop column if exists location;
alter table public.sites   drop column if exists footprint;
alter table public.sites   drop column if exists lat;
alter table public.sites   drop column if exists lng;
alter table public.cameras drop column if exists location;
alter table public.cameras drop column if exists heading_deg;
alter table public.cameras drop column if exists lat;
alter table public.cameras drop column if exists lng;

-- ------------------------------------------------------------
-- Org settings: drop GIS defaults (map center/zoom/style)
-- ------------------------------------------------------------
alter table public.organization_settings drop column if exists gis;

-- ------------------------------------------------------------
-- Permissions: drop gis.manage / gis.assign (cascades to role_permissions)
-- ------------------------------------------------------------
delete from public.permissions where key in ('gis.manage', 'gis.assign');

-- Sites are now managed under the existing cameras.manage permission.
drop policy if exists sites_write on public.sites;
create policy sites_write on public.sites for all
  using (org_id = app.current_org_id() and app.has_perm('cameras.manage'));

-- ------------------------------------------------------------
-- Re-seed org provisioning function without GIS permissions
-- ------------------------------------------------------------
create or replace function app.seed_system_roles(p_org uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare owner_role uuid;
begin
  insert into public.roles (org_id, name, is_system) values
    (p_org, 'Organization Owner', true) returning id into owner_role;
  insert into public.roles (org_id, name, is_system) values
    (p_org, 'Organization Admin', true),
    (p_org, 'Manager', true),
    (p_org, 'Operator', true),
    (p_org, 'Viewer', true),
    (p_org, 'Auditor', true),
    (p_org, 'Support Engineer', true);

  insert into public.role_permissions (role_id, permission)
    select r.id, p.key from public.roles r cross join public.permissions p
    where r.org_id = p_org and r.name in ('Organization Owner','Organization Admin');
  insert into public.role_permissions (role_id, permission)
    select r.id, unnest(array['cameras.manage','cameras.assign',
                              'projects.manage','alerts.view','reports.view','incidents.manage'])
    from public.roles r where r.org_id = p_org and r.name = 'Manager';
  insert into public.role_permissions (role_id, permission)
    select r.id, unnest(array['alerts.view','reports.view','incidents.manage'])
    from public.roles r where r.org_id = p_org and r.name = 'Operator';
  insert into public.role_permissions (role_id, permission)
    select r.id, unnest(array['reports.view'])
    from public.roles r where r.org_id = p_org and r.name = 'Viewer';
  insert into public.role_permissions (role_id, permission)
    select r.id, unnest(array['audit.view','reports.view'])
    from public.roles r where r.org_id = p_org and r.name = 'Auditor';
  insert into public.role_permissions (role_id, permission)
    select r.id, unnest(array['support.manage','alerts.view','devices.manage'])
    from public.roles r where r.org_id = p_org and r.name = 'Support Engineer';

  return owner_role;
end $$;

-- ------------------------------------------------------------
-- No remaining geometry columns/tables use PostGIS — drop it
-- ------------------------------------------------------------
drop extension if exists postgis;
