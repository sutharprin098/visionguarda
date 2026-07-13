-- ============================================================
-- CamAI Enterprise Platform — Migration 0028
-- Update cameras source_type check constraint and fix profile
-- foreign keys to prevent account deletion blockages
-- ============================================================

-- 1. Update check constraint on cameras.source_type
alter table public.cameras drop constraint if exists cameras_source_type_check;
alter table public.cameras add constraint cameras_source_type_check 
  check (source_type in ('rtsp','usb','onvif','ip','nvr','dvr','screen_share'));

-- 2. Update profiles references to allow set null on delete
-- camera_assignments (assigned_by)
alter table public.camera_assignments drop constraint if exists camera_assignments_assigned_by_fkey;
alter table public.camera_assignments add constraint camera_assignments_assigned_by_fkey
  foreign key (assigned_by) references public.profiles(id) on delete set null;

-- settings (updated_by)
alter table public.settings drop constraint if exists settings_updated_by_fkey;
alter table public.settings add constraint settings_updated_by_fkey
  foreign key (updated_by) references public.profiles(id) on delete set null;

-- alerts (acknowledged_by)
alter table public.alerts drop constraint if exists alerts_acknowledged_by_fkey;
alter table public.alerts add constraint alerts_acknowledged_by_fkey
  foreign key (acknowledged_by) references public.profiles(id) on delete set null;

-- organization_settings (updated_by)
alter table public.organization_settings drop constraint if exists organization_settings_updated_by_fkey;
alter table public.organization_settings add constraint organization_settings_updated_by_fkey
  foreign key (updated_by) references public.profiles(id) on delete set null;

-- incidents (created_by)
alter table public.incidents drop constraint if exists incidents_created_by_fkey;
alter table public.incidents add constraint incidents_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

-- reports (created_by)
alter table public.reports drop constraint if exists reports_created_by_fkey;
alter table public.reports add constraint reports_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;
