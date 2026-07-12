import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { audit } from "../../lib/audit";
import {
  PageHeader, Badge, statusTone, Modal, Drawer, ConfirmDialog, Field, Tabs, SecretReveal,
} from "../../components/ui";
import DataTable, { Column } from "../../components/DataTable";
import { fmtAgo, fmtDateTime } from "../../lib/format";
import { Role } from "../../lib/types";

interface UserRow {
  id: string; user_code: string; full_name: string; email: string; phone: string;
  department: string; designation: string; status: string; avatar_url: string;
  last_login_at: string | null; last_activity_at: string | null; last_ip: string | null;
  created_at: string;
  user_roles: { role_id: string; roles: { name: string } }[];
  licenses: { id: string; key_hint: string; status: string }[];
  devices: { count: number }[];
}

async function adminAction(action: string, user_id: string, extra: Record<string, unknown> = {}) {
  const { error } = await supabase.functions.invoke("admin-users", { body: { action, user_id, ...extra } });
  if (error) throw new Error("action failed");
}

export default function UsersPage() {
  const qc = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [viewing, setViewing] = useState<UserRow | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; body: string; danger?: boolean; run: () => Promise<void> } | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);

  const { data: users } = useQuery({
    queryKey: ["users"],
    queryFn: async () =>
      (await supabase
        .from("profiles")
        .select("*, user_roles(role_id, roles(name)), licenses(id, key_hint, status), devices(count)")
        .order("created_at")).data as UserRow[] | null,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["users"] });

  const columns: Column<UserRow>[] = [
    {
      key: "user", header: "User", sortable: true, value: (u) => u.full_name,
      render: (u) => (
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent">
            {u.full_name.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="truncate text-ink-1">{u.full_name}</div>
            <div className="truncate text-xs text-ink-3">{u.email}</div>
          </div>
        </div>
      ),
    },
    { key: "code", header: "User ID", value: (u) => u.user_code, render: (u) => <span className="keychip">{u.user_code}</span> },
    {
      key: "dept", header: "Department", filter: true, sortable: true, value: (u) => u.department || "—",
      render: (u) => <span className="text-ink-2">{u.department || "—"}</span>,
    },
    {
      key: "role", header: "Role", filter: true,
      value: (u) => u.user_roles?.map((r) => r.roles?.name).filter(Boolean).join(", ") || "—",
      render: (u) => <span className="text-ink-2">{u.user_roles?.map((r) => r.roles?.name).filter(Boolean).join(", ") || "—"}</span>,
    },
    {
      key: "license", header: "License", value: (u) => u.licenses?.find((l) => l.status === "active")?.key_hint ?? "—",
      render: (u) => {
        const lic = u.licenses?.find((l) => l.status === "active");
        return lic ? <span className="keychip">{lic.key_hint}</span> : <span className="text-ink-3">—</span>;
      },
    },
    { key: "devices", header: "Devices", sortable: true, value: (u) => u.devices?.[0]?.count ?? 0, render: (u) => u.devices?.[0]?.count ?? 0 },
    {
      key: "last_login", header: "Last Login", sortable: true, value: (u) => u.last_login_at ?? "",
      render: (u) => <span className="text-ink-3">{fmtAgo(u.last_login_at)}</span>,
    },
    {
      key: "status", header: "Status", filter: true, value: (u) => u.status,
      render: (u) => <Badge tone={statusTone[u.status]}>{u.status}</Badge>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Everyone in your organization. Click a row for the full profile."
        actions={
          <button className="btn-primary" onClick={() => setInviteOpen(true)}>
            <UserPlus size={15} /> Add User
          </button>
        }
      />
      <DataTable
        rows={users ?? []}
        columns={columns}
        rowKey={(u) => u.id}
        searchText={(u) => `${u.full_name} ${u.email} ${u.user_code} ${u.department} ${u.designation}`}
        exportName="users"
        onRowClick={setViewing}
        bulkActions={[
          {
            label: "Suspend",
            run: async (rows) => {
              await Promise.all(rows.map((u) => adminAction("set_status", u.id, { status: "suspended" })));
              refresh();
            },
          },
          {
            label: "Activate",
            run: async (rows) => {
              await Promise.all(rows.map((u) => adminAction("set_status", u.id, { status: "active" })));
              refresh();
            },
          },
        ]}
      />

      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Add user">
        <InviteForm
          onDone={(licenseKey) => {
            setInviteOpen(false);
            if (licenseKey) setRevealed(licenseKey);
            refresh();
          }}
        />
      </Modal>

      <Modal open={!!revealed} onClose={() => setRevealed(null)} title="User created">
        {revealed && (
          <>
            <SecretReveal label="License key" secret={revealed}
                          note="Give this to the user for desktop activation — it is shown only once." />
            <button className="btn-primary mt-4 w-full" onClick={() => setRevealed(null)}>Done</button>
          </>
        )}
      </Modal>

      <Drawer open={!!viewing} onClose={() => setViewing(null)} title={viewing?.full_name ?? ""}>
        {viewing && (
          <UserDetail
            user={viewing}
            onAction={(c) => setConfirm(c)}
            onReveal={setRevealed}
            onChanged={() => { refresh(); setViewing(null); }}
          />
        )}
      </Drawer>

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={async () => { await confirm!.run(); refresh(); setViewing(null); }}
        title={confirm?.title ?? ""}
        body={confirm?.body ?? ""}
        danger={confirm?.danger}
      />
    </>
  );
}

// ------------------------------------------------------------------ detail
function UserDetail({ user, onAction, onReveal, onChanged }: {
  user: UserRow;
  onAction: (c: { title: string; body: string; danger?: boolean; run: () => Promise<void> }) => void;
  onReveal: (key: string) => void;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState("Profile");
  const qc = useQueryClient();

  const { data: assignments } = useQuery({
    queryKey: ["user-assign", user.id],
    queryFn: async () => {
      const [cams, projects, devices] = await Promise.all([
        supabase.from("camera_assignments").select("cameras(id, name, status)").eq("user_id", user.id),
        supabase.from("project_members").select("projects(id, name)").eq("user_id", user.id),
        supabase.from("devices").select("id, name, is_online, last_seen_at").eq("user_id", user.id),
      ]);
      return {
        cameras: (cams.data ?? []).map((r: any) => r.cameras).filter(Boolean),
        projects: (projects.data ?? []).map((r: any) => r.projects).filter(Boolean),
        devices: devices.data ?? [],
      };
    },
  });

  const { data: activity } = useQuery({
    queryKey: ["user-activity", user.id],
    enabled: tab === "Activity",
    queryFn: async () =>
      (await supabase.from("audit_logs").select("id, action, module, created_at, ip")
        .eq("actor_id", user.id).order("created_at", { ascending: false }).limit(25)).data ?? [],
  });

  const activeLicense = user.licenses?.find((l) => l.status === "active");

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <Badge tone={statusTone[user.status]}>{user.status}</Badge>
        <span className="keychip">{user.user_code}</span>
      </div>
      <Tabs tabs={["Profile", "Assignments", "Activity"]} active={tab} onChange={setTab} />

      {tab === "Profile" && (
        <ProfileTab user={user} onSaved={() => { qc.invalidateQueries({ queryKey: ["users"] }); onChanged(); }} />
      )}

      {tab === "Assignments" && (
        <div className="space-y-4">
          <AssignList title="Cameras" items={assignments?.cameras.map((c: any) => c.name) ?? []} />
          <AssignList title="Projects" items={assignments?.projects.map((p: any) => p.name) ?? []} />
          <AssignList title="Devices" items={assignments?.devices.map((d: any) => `${d.name}${d.is_online ? " · online" : ""}`) ?? []} />
          <p className="text-xs text-ink-3">Assign cameras from the Cameras page.</p>
        </div>
      )}

      {tab === "Activity" && (
        <div className="divide-y divide-line">
          {!activity?.length && <p className="py-6 text-center text-sm text-ink-3">No activity recorded.</p>}
          {activity?.map((a: any) => (
            <div key={a.id} className="flex items-center justify-between py-2">
              <div>
                <span className="text-sm text-ink-1">{a.action}</span>
                {a.module && <span className="ml-2 text-xs text-ink-3">{a.module}</span>}
              </div>
              <span className="text-xs text-ink-3">{fmtDateTime(a.created_at)}</span>
            </div>
          ))}
        </div>
      )}

      {/* action bar */}
      <div className="mt-6 grid grid-cols-2 gap-2 border-t border-line pt-4">
        <button className="btn-ghost text-xs" onClick={() =>
          onAction({
            title: "Reset password",
            body: `Send a password-reset email to ${user.email}?`,
            run: async () => { await adminAction("reset_password", user.id); },
          })}>
          Reset Password
        </button>
        {activeLicense && (
          <button className="btn-ghost text-xs" onClick={() =>
            onAction({
              title: "Reset license",
              body: "Revoke the current license (all its device activations are revoked) and issue a fresh key?",
              danger: true,
              run: async () => {
                const { data, error } = await supabase.rpc("reset_license", { p_license_id: activeLicense.id });
                if (!error && data) onReveal(data as string);
              },
            })}>
            Reset License
          </button>
        )}
        {user.status === "active" ? (
          <button className="btn-ghost text-xs text-warn" onClick={() =>
            onAction({
              title: "Suspend user",
              body: `Suspend ${user.full_name}? Their sessions are terminated immediately.`,
              danger: true,
              run: async () => { await adminAction("set_status", user.id, { status: "suspended" }); },
            })}>
            Suspend
          </button>
        ) : (
          <button className="btn-ghost text-xs text-ok" onClick={() =>
            onAction({
              title: "Activate user",
              body: `Re-activate ${user.full_name}?`,
              run: async () => { await adminAction("set_status", user.id, { status: "active" }); },
            })}>
            Activate
          </button>
        )}
        <button className="btn-danger text-xs" onClick={() =>
          onAction({
            title: "Delete user",
            body: `Permanently delete ${user.full_name}? Licenses are revoked and all their data is removed. This cannot be undone.`,
            danger: true,
            run: async () => { await adminAction("delete", user.id); },
          })}>
          Delete User
        </button>
      </div>
    </>
  );
}

function ProfileTab({ user, onSaved }: { user: UserRow; onSaved: () => void }) {
  const [form, setForm] = useState({
    full_name: user.full_name, phone: user.phone,
    department: user.department, designation: user.designation,
  });
  const [busy, setBusy] = useState(false);

  const { data: roles } = useQuery({
    queryKey: ["roles"],
    queryFn: async () => (await supabase.from("roles").select("*").order("name")).data as Role[],
  });
  const [roleId, setRoleId] = useState(user.user_roles?.[0]?.role_id ?? "");

  async function save() {
    setBusy(true);
    await supabase.from("profiles").update(form).eq("id", user.id);
    if (roleId && roleId !== user.user_roles?.[0]?.role_id) {
      await supabase.from("user_roles").delete().eq("user_id", user.id);
      await supabase.from("user_roles").insert({ user_id: user.id, role_id: roleId });
    }
    audit("user.update", "user", user.id, {
      module: "users",
      old: { full_name: user.full_name, department: user.department, designation: user.designation },
      new: { ...form },
    });
    setBusy(false);
    onSaved();
  }

  return (
    <div className="space-y-3">
      <Field label="Full name">
        <input className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Department">
          <input className="input" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
        </Field>
        <Field label="Designation">
          <input className="input" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} />
        </Field>
      </div>
      <Field label="Phone">
        <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      </Field>
      <Field label="Role">
        <select className="input" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          <option value="">No role</option>
          {roles?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3 text-xs text-ink-3">
        <div>Last login: {fmtAgo(user.last_login_at)}</div>
        <div>Last activity: {fmtAgo(user.last_activity_at)}</div>
        <div>Last IP: {user.last_ip ?? "—"}</div>
        <div>Joined: {fmtDateTime(user.created_at)}</div>
      </div>
      <button className="btn-primary w-full" onClick={save} disabled={busy}>
        {busy ? "Saving…" : "Save Changes"}
      </button>
    </div>
  );
}

function AssignList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-ink-3">{title}</div>
      {!items.length ? (
        <p className="text-sm text-ink-3">None assigned.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((i) => <Badge key={i}>{i}</Badge>)}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ invite
function InviteForm({ onDone }: { onDone: (licenseKey?: string) => void }) {
  const [form, setForm] = useState({ email: "", full_name: "", role_id: "", department: "", designation: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: roles } = useQuery({
    queryKey: ["roles"],
    queryFn: async () => (await supabase.from("roles").select("*").order("name")).data as Role[],
  });

  async function submit() {
    setBusy(true);
    setError("");
    const { data, error } = await supabase.functions.invoke("invite-user", {
      body: { email: form.email, full_name: form.full_name, role_id: form.role_id || null },
    });
    if (error) {
      setBusy(false);
      return setError("Invite failed — check the email is not already registered.");
    }
    if (data?.user_id && (form.department || form.designation)) {
      await supabase.from("profiles")
        .update({ department: form.department, designation: form.designation })
        .eq("id", data.user_id);
    }
    setBusy(false);
    onDone(data?.license_key);
  }

  return (
    <div className="space-y-3">
      <Field label="Full name">
        <input className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
      </Field>
      <Field label="Email">
        <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Department">
          <input className="input" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
        </Field>
        <Field label="Designation">
          <input className="input" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} />
        </Field>
      </div>
      <Field label="Role">
        <select className="input" value={form.role_id} onChange={(e) => setForm({ ...form, role_id: e.target.value })}>
          <option value="">Select role…</option>
          {roles?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </Field>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button className="btn-primary w-full" onClick={submit} disabled={busy || !form.email || !form.full_name}>
        {busy ? "Creating…" : "Create User & Generate License"}
      </button>
      <p className="text-xs text-ink-3">
        The user receives a password-reset email; their license key is shown to you once.
      </p>
    </div>
  );
}
