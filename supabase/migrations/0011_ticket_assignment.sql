-- ============================================================
-- CamAI Enterprise Platform — Migration 0011
-- Support tickets: let admins assign a ticket to a specific team
-- member (the portal previously only had status/priority/thread —
-- no way to say "this one is Alex's").
-- ============================================================

alter table public.support_tickets
  add column if not exists assigned_to uuid references public.profiles(id) on delete set null;

create index if not exists support_tickets_assigned_idx on public.support_tickets(assigned_to);

-- tickets_update (0004) already allows any support.manage holder to update
-- any column on an org ticket, so no RLS change is needed for assignment.
