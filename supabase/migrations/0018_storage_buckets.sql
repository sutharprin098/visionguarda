-- ============================================================
-- CamAI Enterprise Platform — Migration 0018
-- Adds the remaining buckets from the enterprise storage spec that
-- weren't already covered by 0003/0004 (snapshots, recordings, models,
-- releases, branding, reports already exist and are actively used by
-- Alerts/Reports/Settings). avatars/documents/exports/attachments are
-- pure infrastructure here — RLS-scoped and org-isolated per the spec
-- — but have no consuming upload UI yet (profiles.avatar_url is
-- displayed in Users.tsx but nothing writes to it, so this closes the
-- storage-layer half of that gap without inventing a UI on top of it).
-- ============================================================

insert into storage.buckets (id, name, public) values
  ('avatars',     'avatars',     false),
  ('documents',   'documents',   false),
  ('exports',     'exports',     false),
  ('attachments', 'attachments', false)
on conflict (id) do nothing;

-- avatars: every org member can read any other member's avatar (needed
-- to render other users' pictures in shared UI like assignee pickers);
-- only the owning user (or an admin with users.manage) can write/replace it.
-- Path convention: '<org_id>/<user_id>/...'
create policy storage_avatars_read on storage.objects for select
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = app.current_org_id()::text);
create policy storage_avatars_write on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = app.current_org_id()::text
              and ((storage.foldername(name))[2] = auth.uid()::text or app.has_perm('users.manage')));
create policy storage_avatars_update on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = app.current_org_id()::text
         and ((storage.foldername(name))[2] = auth.uid()::text or app.has_perm('users.manage')));
create policy storage_avatars_delete on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = app.current_org_id()::text
         and ((storage.foldername(name))[2] = auth.uid()::text or app.has_perm('users.manage')));

-- documents / exports: org-scoped, same read/write pattern as the
-- existing branding/reports buckets (path convention '<org_id>/...').
create policy storage_documents_rw on storage.objects for all
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = app.current_org_id()::text)
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = app.current_org_id()::text);
create policy storage_exports_rw on storage.objects for all
  using (bucket_id = 'exports' and (storage.foldername(name))[1] = app.current_org_id()::text)
  with check (bucket_id = 'exports' and (storage.foldername(name))[1] = app.current_org_id()::text);

-- attachments: support-ticket files. Path convention
-- '<org_id>/<ticket_id>/...' — readable/writable by the ticket's
-- creator or support.manage, mirroring support_tickets' own RLS (0004).
create policy storage_attachments_rw on storage.objects for all
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = app.current_org_id()::text
         and exists (select 1 from public.support_tickets t
                     where t.id::text = (storage.foldername(name))[2]
                       and t.org_id = app.current_org_id()
                       and (t.user_id = auth.uid() or app.has_perm('support.manage'))))
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = app.current_org_id()::text
              and exists (select 1 from public.support_tickets t
                          where t.id::text = (storage.foldername(name))[2]
                            and t.org_id = app.current_org_id()
                            and (t.user_id = auth.uid() or app.has_perm('support.manage'))));
