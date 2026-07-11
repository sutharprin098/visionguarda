-- ============================================================
-- CamAI Enterprise Platform — Migration 0003
-- Alerts, Audit, Notifications, API keys, Billing, Releases, Realtime
-- ============================================================

-- ------------------------------------------------------------
-- Alerts (AI events surfaced to users)
-- ------------------------------------------------------------
create table public.alerts (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  camera_id   uuid references public.cameras(id) on delete set null,
  kind        text not null
              check (kind in ('intrusion','line_crossing','speed_violation','traffic_jam',
                              'camera_offline','license_expiry','device_removed','custom')),
  severity    text not null default 'info' check (severity in ('info','warning','critical')),
  title       text not null,
  detail      jsonb not null default '{}'::jsonb,
  snapshot_path text,                             -- supabase storage object
  acknowledged_by uuid references public.profiles(id),
  acknowledged_at timestamptz,
  created_at  timestamptz not null default now()
);
create index alerts_org_time_idx on public.alerts(org_id, created_at desc);

-- ------------------------------------------------------------
-- Audit logs — append-only, no update/delete policies at all
-- ------------------------------------------------------------
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  org_id      uuid references public.organizations(id) on delete set null,
  actor_id    uuid,                                -- profiles.id (kept even if user deleted)
  actor_email text not null default '',
  action      text not null,                       -- 'login','license.revoke','camera.create',...
  target_type text not null default '',            -- 'user','license','camera','device',...
  target_id   text not null default '',
  ip          inet,
  device_id   uuid,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index audit_org_time_idx on public.audit_logs(org_id, created_at desc);

-- exposed as rpc('audit') to portal/desktop clients
create or replace function public.audit(p_action text, p_target_type text, p_target_id text, p_detail jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_logs (org_id, actor_id, actor_email, action, target_type, target_id, detail)
  select p.org_id, p.id, p.email, p_action, p_target_type, p_target_id, p_detail
  from public.profiles p where p.id = auth.uid();
$$;

-- ------------------------------------------------------------
-- Notifications
-- ------------------------------------------------------------
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete cascade,  -- null = whole org
  channel    text not null default 'in_app'
             check (channel in ('in_app','desktop','email','browser','mobile')),
  kind       text not null default 'info',
  title      text not null,
  body       text not null default '',
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notif_user_idx on public.notifications(user_id, created_at desc);

-- ------------------------------------------------------------
-- API keys (hash only; plaintext shown once at creation)
-- ------------------------------------------------------------
create table public.api_keys (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete cascade,
  name       text not null,
  key_hash   text not null unique,
  key_hint   text not null,
  scopes     text[] not null default '{}',
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Billing / subscriptions / usage
-- ------------------------------------------------------------
create table public.subscriptions (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  plan           text not null default 'trial',
  seats          int not null default 1,
  camera_limit   int not null default 4,
  status         text not null default 'active'
                 check (status in ('active','past_due','canceled','trialing')),
  period_start   timestamptz not null default now(),
  period_end     timestamptz,
  external_ref   text                              -- stripe subscription id etc.
);

create table public.billing (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  amount_cents int not null,
  currency   text not null default 'usd',
  status     text not null default 'paid' check (status in ('paid','open','void','failed')),
  invoice_url text,
  created_at timestamptz not null default now()
);

create table public.usage_logs (
  id         bigint generated always as identity primary key,
  org_id     uuid not null references public.organizations(id) on delete cascade,
  metric     text not null,                        -- 'stream_minutes','inference_frames','storage_mb'
  quantity   numeric not null,
  recorded_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Desktop app releases (download page)
-- ------------------------------------------------------------
create table public.app_releases (
  id            uuid primary key default gen_random_uuid(),
  version       text not null unique,              -- '1.4.0'
  channel       text not null default 'stable' check (channel in ('stable','beta')),
  platform      text not null default 'windows',
  storage_path  text not null,                     -- storage object for the EXE
  sha256        text not null,
  size_bytes    bigint not null default 0,
  release_notes text not null default '',
  min_os        text not null default 'Windows 10 21H2',
  published_at  timestamptz not null default now()
);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table public.alerts        enable row level security;
alter table public.audit_logs    enable row level security;
alter table public.notifications enable row level security;
alter table public.api_keys      enable row level security;
alter table public.subscriptions enable row level security;
alter table public.billing       enable row level security;
alter table public.usage_logs    enable row level security;
alter table public.app_releases  enable row level security;

create policy alerts_read on public.alerts for select
  using (org_id = app.current_org_id() and app.has_perm('alerts.view'));
create policy alerts_ack on public.alerts for update
  using (org_id = app.current_org_id() and app.has_perm('alerts.view'));
-- inserts come from the AI backend via service role (bypasses RLS)

create policy audit_read on public.audit_logs for select
  using ((org_id = app.current_org_id() and app.has_perm('audit.view')) or app.is_super_admin());
-- append-only: no insert/update/delete policies for authenticated users;
-- writes go through app.audit() (security definer) or service role.

create policy notif_read on public.notifications for select
  using (org_id = app.current_org_id() and (user_id = auth.uid() or user_id is null));
create policy notif_mark_read on public.notifications for update
  using (user_id = auth.uid());

create policy api_keys_read on public.api_keys for select
  using (org_id = app.current_org_id() and (user_id = auth.uid() or app.has_perm('org.manage')));
create policy api_keys_write on public.api_keys for all
  using (org_id = app.current_org_id() and (user_id = auth.uid() or app.has_perm('org.manage')));

create policy subs_read on public.subscriptions for select
  using ((org_id = app.current_org_id() and app.has_perm('org.manage')) or app.is_super_admin());
create policy billing_read on public.billing for select
  using ((org_id = app.current_org_id() and app.has_perm('org.manage')) or app.is_super_admin());
create policy usage_read on public.usage_logs for select
  using ((org_id = app.current_org_id() and app.has_perm('org.manage')) or app.is_super_admin());

create policy releases_read on public.app_releases for select
  using (auth.uid() is not null);                  -- any signed-in user can download

-- ------------------------------------------------------------
-- Realtime: desktop apps subscribe to org-scoped changes
-- ------------------------------------------------------------
alter publication supabase_realtime add table
  public.profiles, public.user_roles, public.role_permissions,
  public.licenses, public.devices, public.cameras, public.camera_assignments,
  public.gis_layers, public.gis_layer_assignments, public.settings,
  public.alerts, public.notifications, public.organizations;

-- ------------------------------------------------------------
-- Storage buckets (snapshots, recordings, models, releases)
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public) values
  ('snapshots',  'snapshots',  false),
  ('recordings', 'recordings', false),
  ('models',     'models',     false),
  ('releases',   'releases',   false)
on conflict (id) do nothing;

-- org-scoped storage: objects live under '<org_id>/...'
create policy storage_org_read on storage.objects for select
  using (bucket_id in ('snapshots','recordings')
         and (storage.foldername(name))[1] = app.current_org_id()::text);
create policy storage_org_write on storage.objects for insert
  with check (bucket_id in ('snapshots','recordings')
              and (storage.foldername(name))[1] = app.current_org_id()::text);
create policy storage_releases_read on storage.objects for select
  using (bucket_id = 'releases' and auth.uid() is not null);
create policy storage_models_read on storage.objects for select
  using (bucket_id = 'models' and auth.uid() is not null);
