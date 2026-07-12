import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ShieldCheck, Trash2 } from "lucide-react";
import clsx from "clsx";
import { supabase } from "../../lib/supabase";
import { audit } from "../../lib/audit";
import { useAuth } from "../../contexts/AuthContext";
import { Role } from "../../lib/types";
import { PageHeader, Modal, Badge, ConfirmDialog, Field } from "../../components/ui";

const MODULE_LABELS: Record<string, string> = {
  org: "Organization", users: "Users", roles: "Roles", licenses: "Licenses",
  devices: "Devices", cameras: "Cameras", ai: "AI",
  alerts: "Alerts", incidents: "Incidents", reports: "Reports",
  audit: "Audit", projects: "Projects", support: "Support",
};

export default function RolesPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const canManage = can("roles.manage");
  const [selected, setSelected] = useState<Role | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<Role | null>(null);
  const [newName, setNewName] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: roles } = useQuery({
    queryKey: ["roles"],
    queryFn: async () =>
      (await supabase.from("roles").select("*, user_roles(count)")
        .order("is_system", { ascending: false }).order("name")).data as (Role & { user_roles: { count: number }[] })[] | null,
  });
  const { data: allPerms } = useQuery({
    queryKey: ["permissions"],
    queryFn: async () => (await supabase.from("permissions").select("*").order("key")).data ?? [],
  });
  const { data: rolePerms } = useQuery({
    queryKey: ["role-perms", selected?.id],
    enabled: !!selected,
    queryFn: async () =>
      (await supabase.from("role_permissions").select("permission").eq("role_id", selected!.id))
        .data?.map((r) => r.permission) ?? [],
  });

  const grouped = (allPerms ?? []).reduce((acc: Record<string, any[]>, p: any) => {
    const mod = p.key.split(".")[0];
    (acc[mod] ??= []).push(p);
    return acc;
  }, {});

  async function togglePerm(perm: string, on: boolean) {
    if (!selected) return;
    setActionError(null);
    const { error } = on
      ? await supabase.from("role_permissions").insert({ role_id: selected.id, permission: perm })
      : await supabase.from("role_permissions").delete().eq("role_id", selected.id).eq("permission", perm);
    if (error) return setActionError(error.message);
    audit(on ? "role.grant" : "role.revoke", "role", selected.id, {
      module: "roles", detail: { permission: perm, role: selected.name },
    });
    qc.invalidateQueries({ queryKey: ["role-perms", selected.id] });
  }

  async function createRole() {
    setActionError(null);
    const { data: org, error: orgErr } = await supabase.from("organizations").select("id").maybeSingle();
    if (orgErr) return setActionError(orgErr.message);
    if (!org) return;
    const { data, error } = await supabase.from("roles").insert({ name: newName.trim(), org_id: org.id }).select().maybeSingle();
    if (error) return setActionError(error.message);
    if (data) audit("role.create", "role", data.id, { module: "roles", new: { name: newName } });
    setCreateOpen(false);
    setNewName("");
    qc.invalidateQueries({ queryKey: ["roles"] });
  }

  async function deleteRole() {
    if (!deleting) return;
    setActionError(null);
    const { error } = await supabase.from("roles").delete().eq("id", deleting.id);
    if (error) return setActionError(error.message);
    audit("role.delete", "role", deleting.id, { module: "roles", old: { name: deleting.name } });
    if (selected?.id === deleting.id) setSelected(null);
    qc.invalidateQueries({ queryKey: ["roles"] });
  }

  return (
    <>
      <PageHeader
        title="Roles & Permissions"
        subtitle="System roles plus unlimited custom roles. Changes apply to desktops in realtime."
        actions={
          canManage && (
            <button className="btn-primary" onClick={() => setCreateOpen(true)}>
              <Plus size={15} /> New Role
            </button>
          )
        }
      />
      {actionError && (
        <div className="mb-4 flex items-center justify-between rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          <span>{actionError}</span>
          <button className="text-xs underline" onClick={() => setActionError(null)}>Dismiss</button>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="card h-fit divide-y divide-line">
          {roles?.map((r) => (
            <div key={r.id} className={clsx(
              "group flex w-full items-center justify-between px-4 py-2.5 text-left text-sm transition",
              selected?.id === r.id ? "bg-accent/10 text-accent" : "text-ink-2 hover:bg-surface-2",
            )}>
              <button className="flex min-w-0 flex-1 items-center gap-2" onClick={() => setSelected(r)}>
                <ShieldCheck size={14} className="shrink-0" />
                <span className="truncate">{r.name}</span>
              </button>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="text-[10px] text-ink-3">{r.user_roles?.[0]?.count ?? 0}</span>
                {r.is_system ? (
                  <Badge>system</Badge>
                ) : canManage ? (
                  <button className="hidden text-ink-3 hover:text-danger group-hover:block"
                          onClick={() => setDeleting(r)}>
                    <Trash2 size={13} />
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <div className="card p-5">
          {!selected ? (
            <p className="py-10 text-center text-sm text-ink-3">Select a role to edit its permission matrix.</p>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-ink-1">{selected.name}</h3>
                <span className="text-xs text-ink-3">{rolePerms?.length ?? 0} of {allPerms?.length ?? 0} permissions</span>
              </div>
              <div className="space-y-5">
                {Object.entries(grouped).map(([mod, perms]) => (
                  <div key={mod}>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">
                      {MODULE_LABELS[mod] ?? mod}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {perms.map((p: any) => {
                        const on = rolePerms?.includes(p.key) ?? false;
                        return (
                          <label key={p.key}
                                 className="flex cursor-pointer items-center justify-between rounded-md border border-line px-3 py-2 transition hover:bg-surface-2">
                            <div className="min-w-0">
                              <div className="truncate font-mono text-xs text-ink-1">{p.key}</div>
                              <div className="truncate text-xs text-ink-3">{p.description}</div>
                            </div>
                            <input type="checkbox" checked={on} disabled={!canManage}
                                   className="ml-2 h-4 w-4 shrink-0 accent-[#5b8cff] disabled:cursor-not-allowed disabled:opacity-50"
                                   onChange={(e) => togglePerm(p.key, e.target.checked)} />
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create custom role">
        <div className="space-y-3">
          <Field label="Role name">
            <input className="input" placeholder="e.g. Site Supervisor" value={newName}
                   onChange={(e) => setNewName(e.target.value)} />
          </Field>
          <button className="btn-primary w-full" onClick={createRole} disabled={!newName.trim()}>
            Create Role
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={deleteRole}
        danger
        title="Delete role"
        body={`Delete "${deleting?.name}"? Users holding it lose its permissions immediately.`}
        confirmLabel="Delete"
      />
    </>
  );
}
