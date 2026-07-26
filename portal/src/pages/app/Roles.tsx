import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus, ShieldCheck, Trash2, Edit2, Copy, Users, CheckSquare, Square, Search,
  Sparkles, UserPlus, UserMinus, ShieldAlert, Check, CheckCircle2, RefreshCw
} from "lucide-react";
import clsx from "clsx";
import { supabase } from "../../lib/supabase";
import { audit } from "../../lib/audit";
import { useAuth } from "../../contexts/AuthContext";
import { Role } from "../../lib/types";
import { PageHeader, Modal, Badge, ConfirmDialog, Field, Tabs } from "../../components/ui";

const MODULE_CONFIG: Record<string, { label: string; desc: string }> = {
  org: { label: "Organization", desc: "Workspace settings and branding" },
  users: { label: "User Management", desc: "User accounts, activation and suspension" },
  roles: { label: "Roles & Security", desc: "Role creation and permission matrices" },
  licenses: { label: "License Keys", desc: "Edge desktop license keys and node activations" },
  devices: { label: "Hardware Nodes", desc: "Authorized desktop client devices" },
  cameras: { label: "Camera Feeds", desc: "RTSP camera feeds and camera groups" },
  ai: { label: "AI Engine", desc: "Model configurations, thresholds, and detection profiles" },
  alerts: { label: "Alerts & Dispatches", desc: "Real-time alerts, sirens, and Telegram notifications" },
  incidents: { label: "Incidents", desc: "Incident tagging, review, and resolution" },
  reports: { label: "Reports & Analytics", desc: "Operational metrics and exportable reports" },
  audit: { label: "Audit Logs", desc: "System audit trail and security logs" },
};

const PRESET_TEMPLATES: Record<string, { label: string; desc: string; perms: string[] }> = {
  admin: {
    label: "Full Admin",
    desc: "Unrestricted access across all operational modules",
    perms: [
      "org.manage", "users.manage", "roles.manage", "licenses.manage", "devices.manage",
      "cameras.manage", "ai.configure", "alerts.view", "alerts.manage", "incidents.manage",
      "reports.view", "audit.view"
    ]
  },
  security_operator: {
    label: "Security Operator",
    desc: "Real-time stream monitoring, alert dispatches & incident logging",
    perms: ["cameras.manage", "alerts.view", "alerts.manage", "incidents.manage", "reports.view"]
  },
  site_manager: {
    label: "Site Manager",
    desc: "Manage site cameras, hardware nodes & view operational audit logs",
    perms: ["users.view", "cameras.manage", "devices.view", "alerts.view", "reports.view", "audit.view"]
  },
  viewer: {
    label: "Read-Only Viewer",
    desc: "View camera feeds, alerts and general reports without edit permissions",
    perms: ["cameras.view", "alerts.view", "reports.view"]
  }
};

export default function RolesPage() {
  const qc = useQueryClient();
  const { can, profile } = useAuth();
  const canManage = can("roles.manage");

  const [selected, setSelected] = useState<Role | null>(null);
  const [activeTab, setActiveTab] = useState<"matrix" | "users">("matrix");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedModule, setSelectedModule] = useState<string>("all");

  // Modals & Dialogs State
  const [createOpen, setCreateOpen] = useState(false);
  const [renameRoleObj, setRenameRoleObj] = useState<Role | null>(null);
  const [cloneRoleObj, setCloneRoleObj] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState<Role | null>(null);
  const [assignUserOpen, setAssignUserOpen] = useState(false);

  // Form Inputs
  const [newRoleName, setNewRoleName] = useState("");
  const [cloneNewName, setCloneNewName] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [selectedUserToAssign, setSelectedUserToAssign] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Fetch Roles
  const { data: roles, isLoading: rolesLoading } = useQuery({
    queryKey: ["roles"],
    queryFn: async () => {
      const { data } = await supabase
        .from("roles")
        .select("*, user_roles(count)")
        .order("is_system", { ascending: false })
        .order("name");
      return (data as (Role & { user_roles: { count: number }[] })[]) ?? [];
    },
  });

  // Automatically select first role on initial load
  useEffect(() => {
    if (roles && roles.length > 0 && !selected) {
      setSelected(roles[0]);
    }
  }, [roles, selected]);

  // Fetch All Available System Permissions
  const { data: allPerms } = useQuery({
    queryKey: ["permissions"],
    queryFn: async () => (await supabase.from("permissions").select("*").order("key")).data ?? [],
  });

  // Fetch Permissions granted to Selected Role
  const { data: rolePerms } = useQuery({
    queryKey: ["role-perms", selected?.id],
    enabled: !!selected,
    queryFn: async () =>
      (await supabase.from("role_permissions").select("permission").eq("role_id", selected!.id))
        .data?.map((r) => r.permission) ?? [],
  });

  // Fetch Users assigned to Selected Role
  const { data: roleUsers } = useQuery({
    queryKey: ["role-users", selected?.id],
    enabled: !!selected,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("user_id, profiles(id, full_name, email, department, status, user_code)")
        .eq("role_id", selected!.id);
      return data?.map((r: any) => r.profiles).filter(Boolean) ?? [];
    },
  });

  // Fetch all profiles for assign dropdown
  const { data: allProfiles } = useQuery({
    queryKey: ["all-profiles"],
    enabled: assignUserOpen,
    queryFn: async () => (await supabase.from("profiles").select("id, full_name, email, user_code").order("full_name")).data ?? [],
  });

  const notify = (msg: string) => {
    setSuccessToast(msg);
    setTimeout(() => setSuccessToast(null), 2500);
  };

  // Group permissions by module prefix
  const groupedPerms = (allPerms ?? []).reduce((acc: Record<string, any[]>, p: any) => {
    const mod = p.key.split(".")[0];
    (acc[mod] ??= []).push(p);
    return acc;
  }, {});

  // Toggle individual permission
  async function togglePerm(perm: string, on: boolean) {
    if (!selected || !canManage) return;
    setActionError(null);
    const { error } = on
      ? await supabase.from("role_permissions").insert({ role_id: selected.id, permission: perm })
      : await supabase.from("role_permissions").delete().eq("role_id", selected.id).eq("permission", perm);

    if (error) return setActionError(error.message);

    audit(on ? "role.grant" : "role.revoke", "role", selected.id, {
      module: "roles",
      detail: { permission: perm, role: selected.name },
    });

    notify(on ? `Granted ${perm}` : `Revoked ${perm}`);
    qc.invalidateQueries({ queryKey: ["role-perms", selected.id] });
  }

  // Toggle all permissions in a specific module
  async function toggleModulePerms(modPerms: any[], targetOn: boolean) {
    if (!selected || !canManage) return;
    setActionError(null);

    const permKeys = modPerms.map((p) => p.key);
    if (targetOn) {
      const missing = permKeys.filter((k) => !rolePerms?.includes(k));
      if (missing.length === 0) return;
      const rows = missing.map((k) => ({ role_id: selected.id, permission: k }));
      const { error } = await supabase.from("role_permissions").insert(rows);
      if (error) return setActionError(error.message);
    } else {
      const { error } = await supabase
        .from("role_permissions")
        .delete()
        .eq("role_id", selected.id)
        .in("permission", permKeys);
      if (error) return setActionError(error.message);
    }

    notify(targetOn ? "Module permissions granted" : "Module permissions cleared");
    qc.invalidateQueries({ queryKey: ["role-perms", selected.id] });
  }

  // Apply Preset Template to Selected Role
  async function applyPresetTemplate(templateKey: string) {
    if (!selected || !canManage) return;
    const template = PRESET_TEMPLATES[templateKey];
    if (!template) return;

    setActionError(null);
    // Clear existing permissions
    await supabase.from("role_permissions").delete().eq("role_id", selected.id);

    // Insert template permissions
    const rows = template.perms.map((p) => ({ role_id: selected.id, permission: p }));
    const { error } = await supabase.from("role_permissions").insert(rows);

    if (error) return setActionError(error.message);

    audit("role.template_apply", "role", selected.id, {
      module: "roles",
      detail: { template: template.label, role: selected.name },
    });

    notify(`Applied '${template.label}' template to ${selected.name}`);
    qc.invalidateQueries({ queryKey: ["role-perms", selected.id] });
  }

  // Create New Role
  async function handleCreateRole() {
    if (!newRoleName.trim()) return;
    setActionError(null);

    const { data: org, error: orgErr } = await supabase.from("organizations").select("id").maybeSingle();
    if (orgErr) return setActionError(orgErr.message);
    if (!org) return;

    const { data, error } = await supabase
      .from("roles")
      .insert({ name: newRoleName.trim(), org_id: org.id })
      .select()
      .maybeSingle();

    if (error) return setActionError(error.message);

    audit("role.create", "role", data.id, { module: "roles", new: { name: newRoleName } });
    setCreateOpen(false);
    setNewRoleName("");
    notify(`Created role "${data.name}"`);
    qc.invalidateQueries({ queryKey: ["roles"] });
    setSelected(data);
  }

  // Clone Role
  async function handleCloneRole() {
    if (!cloneRoleObj || !cloneNewName.trim()) return;
    setActionError(null);

    const { data: org } = await supabase.from("organizations").select("id").maybeSingle();
    if (!org) return;

    // Create new role
    const { data: newRole, error } = await supabase
      .from("roles")
      .insert({ name: cloneNewName.trim(), org_id: org.id })
      .select()
      .maybeSingle();

    if (error) return setActionError(error.message);

    // Fetch original perms & copy over
    const { data: sourcePerms } = await supabase
      .from("role_permissions")
      .select("permission")
      .eq("role_id", cloneRoleObj.id);

    if (sourcePerms && sourcePerms.length > 0) {
      const rows = sourcePerms.map((sp) => ({ role_id: newRole.id, permission: sp.permission }));
      await supabase.from("role_permissions").insert(rows);
    }

    audit("role.clone", "role", newRole.id, {
      module: "roles",
      detail: { sourceRole: cloneRoleObj.name, newRole: cloneNewName },
    });

    setCloneRoleObj(null);
    setCloneNewName("");
    notify(`Cloned "${cloneRoleObj.name}" into "${newRole.name}"`);
    qc.invalidateQueries({ queryKey: ["roles"] });
    setSelected(newRole);
  }

  // Rename Role
  async function handleRenameRole() {
    if (!renameRoleObj || !renameValue.trim()) return;
    setActionError(null);

    const { error } = await supabase
      .from("roles")
      .update({ name: renameValue.trim() })
      .eq("id", renameRoleObj.id);

    if (error) return setActionError(error.message);

    audit("role.rename", "role", renameRoleObj.id, {
      module: "roles",
      old: { name: renameRoleObj.name },
      new: { name: renameValue },
    });

    setRenameRoleObj(null);
    setRenameValue("");
    notify("Role renamed successfully");
    qc.invalidateQueries({ queryKey: ["roles"] });
    setSelected({ ...renameRoleObj, name: renameValue.trim() });
  }

  // Delete Role
  async function handleDeleteRole() {
    if (!deleting) return;
    setActionError(null);

    const { error } = await supabase.from("roles").delete().eq("id", deleting.id);
    if (error) return setActionError(error.message);

    audit("role.delete", "role", deleting.id, { module: "roles", old: { name: deleting.name } });
    if (selected?.id === deleting.id) setSelected(null);

    setDeleting(null);
    notify(`Deleted role "${deleting.name}"`);
    qc.invalidateQueries({ queryKey: ["roles"] });
  }

  // Assign User to Role
  async function handleAssignUser() {
    if (!selected || !selectedUserToAssign) return;
    setActionError(null);

    // Delete existing user roles first (single role policy)
    await supabase.from("user_roles").delete().eq("user_id", selectedUserToAssign);

    const { error } = await supabase.from("user_roles").insert({
      user_id: selectedUserToAssign,
      role_id: selected.id,
    });

    if (error) return setActionError(error.message);

    audit("role.assign_user", "role", selected.id, {
      module: "roles",
      detail: { user_id: selectedUserToAssign, role: selected.name },
    });

    setAssignUserOpen(false);
    setSelectedUserToAssign("");
    notify("User assigned to role");
    qc.invalidateQueries({ queryKey: ["role-users", selected.id] });
    qc.invalidateQueries({ queryKey: ["roles"] });
  }

  // Unassign User from Role
  async function handleUnassignUser(userId: string) {
    if (!selected) return;
    setActionError(null);

    const { error } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", userId)
      .eq("role_id", selected.id);

    if (error) return setActionError(error.message);

    audit("role.unassign_user", "role", selected.id, {
      module: "roles",
      detail: { user_id: userId, role: selected.name },
    });

    notify("User removed from role");
    qc.invalidateQueries({ queryKey: ["role-users", selected.id] });
    qc.invalidateQueries({ queryKey: ["roles"] });
  }

  // Filter modules based on module filter tab & search query
  const filteredModules = Object.entries(groupedPerms).filter(([mod, perms]) => {
    if (selectedModule !== "all" && mod !== selectedModule) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const modLabel = (MODULE_CONFIG[mod]?.label ?? mod).toLowerCase();
    const hasMatch = perms.some(
      (p: any) => p.key.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
    );
    return modLabel.includes(q) || hasMatch;
  });

  return (
    <>
      <PageHeader
        title="Roles & Permissions"
        subtitle="Manage custom role definitions, permission matrices, and user assignments."
        actions={
          canManage && (
            <button className="btn-primary" onClick={() => setCreateOpen(true)}>
              <Plus size={15} /> Create Role
            </button>
          )
        }
      />

      {/* Action Error Alert */}
      {actionError && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs font-medium text-rose-500">
          <div className="flex items-center gap-2">
            <ShieldAlert size={16} />
            <span>{actionError}</span>
          </div>
          <button className="text-xs font-bold underline" onClick={() => setActionError(null)}>Dismiss</button>
        </div>
      )}

      {/* Success Notification Toast */}
      {successToast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-2xl border border-emerald-500/30 bg-surface-1 px-4 py-3 text-xs font-bold text-emerald-500 shadow-2xl backdrop-blur-xl animate-bounce">
          <CheckCircle2 size={16} />
          <span>{successToast}</span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[260px_1fr] xl:grid-cols-[300px_1fr] items-start">
        {/* Left Column: Roles Sidebar */}
        <div className="space-y-3 lg:sticky lg:top-4 max-h-[calc(100vh-140px)] overflow-y-auto pr-1">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold uppercase tracking-wider text-ink-3">System & Custom Roles</span>
            <span className="keychip">{roles?.length ?? 0} Roles</span>
          </div>

          <div className="card overflow-hidden divide-y divide-line/60">
            {rolesLoading ? (
              <div className="p-8 text-center text-xs text-ink-3">Loading security roles…</div>
            ) : (
              roles?.map((r) => {
                const isSelected = selected?.id === r.id;
                const userCount = r.user_roles?.[0]?.count ?? 0;
                return (
                  <div
                    key={r.id}
                    className={clsx(
                      "group flex items-center justify-between p-3.5 transition-all cursor-pointer",
                      isSelected
                        ? "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-l-4 border-sky-500 font-semibold"
                        : "text-ink-2 hover:bg-surface-2/60"
                    )}
                    onClick={() => setSelected(r)}
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="flex items-center gap-2">
                        <ShieldCheck size={16} className={isSelected ? "text-sky-500 shrink-0" : "text-ink-3 shrink-0"} />
                        <span className="truncate text-xs font-bold tracking-tight text-ink-1">{r.name}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-ink-3">
                        <span>{userCount} user{userCount === 1 ? "" : "s"}</span>
                        {r.is_system && <span className="rounded bg-surface-3 px-1.5 py-0.2 font-mono text-[9px] text-ink-2">SYSTEM</span>}
                      </div>
                    </div>

                    {/* Action Bar for Role */}
                    <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
                      {canManage && (
                        <>
                          <button
                            title="Clone Role"
                            className="p-1.5 rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink-1 transition"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCloneRoleObj(r);
                              setCloneNewName(`${r.name} (Copy)`);
                            }}
                          >
                            <Copy size={13} />
                          </button>
                          {!r.is_system && (
                            <>
                              <button
                                title="Rename Role"
                                className="p-1.5 rounded-lg text-ink-3 hover:bg-surface-3 hover:text-sky-500 transition"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRenameRoleObj(r);
                                  setRenameValue(r.name);
                                }}
                              >
                                <Edit2 size={13} />
                              </button>
                              <button
                                title="Delete Role"
                                className="p-1.5 rounded-lg text-ink-3 hover:bg-surface-3 hover:text-rose-500 transition"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleting(r);
                                }}
                              >
                                <Trash2 size={13} />
                              </button>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Permission Matrix & Role Details */}
        <div className="card p-5 sm:p-6 space-y-6">
          {!selected ? (
            <div className="py-20 text-center text-sm text-ink-3">
              <ShieldCheck size={36} className="mx-auto mb-3 opacity-30 text-sky-500" />
              Select a security role from the left menu to configure its permission matrix.
            </div>
          ) : (
            <>
              {/* Role Header Banner */}
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line/60 pb-5">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-extrabold text-ink-1 tracking-tight">{selected.name}</h2>
                    {selected.is_system ? (
                      <Badge tone="accent">System Role</Badge>
                    ) : (
                      <Badge tone="default">Custom Role</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-ink-3 font-medium">
                    {rolePerms?.length ?? 0} of {allPerms?.length ?? 0} system permissions granted · {roleUsers?.length ?? 0} active users assigned
                  </p>
                </div>

                {/* Tab Switcher: Permission Matrix vs Users */}
                <div className="flex flex-wrap sm:flex-nowrap items-center gap-1.5 bg-surface-2 p-1 rounded-xl border border-line/60 shrink-0">
                  <button
                    onClick={() => setActiveTab("matrix")}
                    className={clsx(
                      "px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap",
                      activeTab === "matrix" ? "bg-surface-1 text-sky-600 dark:text-sky-400 shadow-sm" : "text-ink-3 hover:text-ink-1"
                    )}
                  >
                    <ShieldCheck size={14} />
                    <span>Permission Matrix</span>
                  </button>
                  <button
                    onClick={() => setActiveTab("users")}
                    className={clsx(
                      "px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap",
                      activeTab === "users" ? "bg-surface-1 text-sky-600 dark:text-sky-400 shadow-sm" : "text-ink-3 hover:text-ink-1"
                    )}
                  >
                    <Users size={14} />
                    <span>Assigned Users ({roleUsers?.length ?? 0})</span>
                  </button>
                </div>
              </div>

              {/* TAB 1: PERMISSION MATRIX */}
              {activeTab === "matrix" && (
                <div className="space-y-6">
                  {/* Preset Template Quick Bar */}
                  {canManage && (
                    <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-sky-600 dark:text-sky-400">
                          <Sparkles size={14} />
                          <span>Apply Preset Permission Template</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4 gap-2">
                        {Object.entries(PRESET_TEMPLATES).map(([key, t]) => (
                          <button
                            key={key}
                            onClick={() => applyPresetTemplate(key)}
                            className="p-2.5 text-left rounded-xl border border-line bg-surface-1 hover:border-sky-500/50 hover:bg-surface-2 transition group min-w-0"
                          >
                            <div className="text-xs font-bold text-ink-1 group-hover:text-sky-500 truncate">{t.label}</div>
                            <div className="text-[10px] text-ink-3 truncate mt-0.5">{t.desc}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Custom Access Block Message Configurator */}
                  {canManage && (
                    <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                          <ShieldAlert size={14} />
                          <span>Configured Access Block Message for Users</span>
                        </div>
                        <Badge tone="default">Role Policy Enforcer</Badge>
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs text-ink-3">
                          When users with this role try to access unauthorized modules, this custom message will be displayed on their screen:
                        </p>
                        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                          <select
                            className="input text-xs py-2 w-full sm:w-auto min-w-[240px]"
                          >
                            <option value="">-- Select Preset Block Reason --</option>
                            <option value="1">🛡️ Standard: "Access Restricted by IT Security Administrator"</option>
                            <option value="2">🔒 Compliance: "Privilege Restricted under Enterprise Data Policy"</option>
                            <option value="3">👁️ View-Only: "View-only security role. Editing & export privileges locked."</option>
                            <option value="4">⚠️ Pending Review: "Account permissions under administrative review."</option>
                          </select>
                          <input
                            type="text"
                            defaultValue={`Access Restricted: Your assigned role (${selected.name}) is blocked from accessing this module. Contact IT Admin.`}
                            className="input text-xs py-2 flex-1 min-w-[240px]"
                            placeholder="Type custom access blocked message for user..."
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Search & Module Filters */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="relative flex-1 min-w-[200px]">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-3" />
                      <input
                        type="text"
                        placeholder="Search permissions (e.g. cameras, manage, alerts)..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 rounded-xl bg-surface-2 border border-line text-xs font-medium text-ink-1 placeholder-ink-3 outline-none focus:ring-2 focus:ring-sky-500/30"
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        onClick={() => setSelectedModule("all")}
                        className={clsx(
                          "px-2.5 py-1 text-[11px] font-bold rounded-lg whitespace-nowrap transition",
                          selectedModule === "all" ? "bg-sky-500 text-white" : "bg-surface-2 text-ink-3 hover:text-ink-1"
                        )}
                      >
                        All Modules
                      </button>
                      {Object.keys(groupedPerms).map((mod) => (
                        <button
                          key={mod}
                          onClick={() => setSelectedModule(mod)}
                          className={clsx(
                            "px-2.5 py-1 text-[11px] font-bold rounded-lg whitespace-nowrap transition uppercase",
                            selectedModule === mod ? "bg-sky-500 text-white" : "bg-surface-2 text-ink-3 hover:text-ink-1"
                          )}
                        >
                          {mod}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Permission Groups Accordions / Cards */}
                  <div className="space-y-6">
                    {filteredModules.length === 0 ? (
                      <div className="py-12 text-center text-xs text-ink-3">No matching permissions found.</div>
                    ) : (
                      filteredModules.map(([mod, perms]) => {
                        const config = MODULE_CONFIG[mod] ?? { label: mod.toUpperCase(), desc: "" };
                        const modPermKeys = perms.map((p) => p.key);
                        const grantedCount = modPermKeys.filter((k) => rolePerms?.includes(k)).length;
                        const allGranted = grantedCount === perms.length;

                        return (
                          <div key={mod} className="rounded-2xl border border-line/80 bg-surface-1/60 p-4 space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/50 pb-3">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-extrabold uppercase tracking-wider text-ink-1">
                                    {config.label}
                                  </span>
                                  <span className="text-[10px] font-mono text-ink-3 font-semibold bg-surface-2 px-2 py-0.5 rounded-full border border-line/40">
                                    {grantedCount} / {perms.length} Granted
                                  </span>
                                </div>
                                {config.desc && <p className="text-[11px] text-ink-3 mt-0.5">{config.desc}</p>}
                              </div>

                              {canManage && (
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => toggleModulePerms(perms, !allGranted)}
                                    className="px-2.5 py-1 text-[10px] font-bold rounded-lg border border-line bg-surface-2 text-ink-2 hover:text-ink-1 transition flex items-center gap-1"
                                  >
                                    {allGranted ? <Square size={12} /> : <CheckSquare size={12} />}
                                    <span>{allGranted ? "Clear All" : "Grant All"}</span>
                                  </button>
                                </div>
                              )}
                            </div>

                            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
                              {perms.map((p: any) => {
                                const isGranted = rolePerms?.includes(p.key) ?? false;
                                return (
                                  <label
                                    key={p.key}
                                    className={clsx(
                                      "flex items-start justify-between p-3 rounded-xl border transition-all cursor-pointer",
                                      isGranted
                                        ? "border-sky-500/40 bg-sky-500/5 text-ink-1"
                                        : "border-line/70 bg-surface-1 text-ink-2 hover:bg-surface-2/60"
                                    )}
                                  >
                                    <div className="min-w-0 pr-3">
                                      <div className="flex items-center gap-1.5">
                                        <span className="font-mono text-xs font-bold text-ink-1">{p.key}</span>
                                        {isGranted && <Badge tone="ok">Granted</Badge>}
                                      </div>
                                      <div className="mt-1 text-[11px] text-ink-3 leading-normal">{p.description}</div>
                                    </div>

                                    <input
                                      type="checkbox"
                                      checked={isGranted}
                                      disabled={!canManage}
                                      onChange={(e) => togglePerm(p.key, e.target.checked)}
                                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-line accent-sky-500 focus:ring-sky-500 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                                    />
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* TAB 2: ASSIGNED USERS */}
              {activeTab === "users" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-ink-1">Users Holding Role</h3>
                      <p className="text-xs text-ink-3">Changes to role permissions apply to these users in real-time.</p>
                    </div>
                    {canManage && (
                      <button className="btn-primary text-xs py-1.5" onClick={() => setAssignUserOpen(true)}>
                        <UserPlus size={14} /> Assign User to Role
                      </button>
                    )}
                  </div>

                  <div className="divide-y divide-line/60 rounded-2xl border border-line bg-surface-1">
                    {roleUsers?.length === 0 ? (
                      <div className="p-8 text-center text-xs text-ink-3">
                        No users currently assigned to this role.
                      </div>
                    ) : (
                      roleUsers?.map((u: any) => (
                        <div key={u.id} className="flex items-center justify-between p-3.5">
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-500/10 font-bold text-xs text-sky-500">
                              {u.full_name?.slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div className="text-xs font-bold text-ink-1 flex items-center gap-2">
                                <span>{u.full_name}</span>
                                <span className="keychip text-[9px]">{u.user_code}</span>
                              </div>
                              <div className="text-[11px] text-ink-3">{u.email} · {u.department || "General"}</div>
                            </div>
                          </div>

                          {canManage && (
                            <button
                              className="btn-ghost text-xs text-rose-500 py-1 px-2.5 gap-1"
                              onClick={() => handleUnassignUser(u.id)}
                            >
                              <UserMinus size={13} />
                              <span>Remove</span>
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Modal: Create Custom Role */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create New Role">
        <div className="space-y-4">
          <Field label="Role Name" hint="Choose a descriptive name for this security role (e.g. Dispatcher, Regional Admin).">
            <input
              className="input"
              placeholder="e.g. Perimeter Guard"
              value={newRoleName}
              onChange={(e) => setNewRoleName(e.target.value)}
            />
          </Field>
          <button className="btn-primary w-full" onClick={handleCreateRole} disabled={!newRoleName.trim()}>
            Create Role
          </button>
        </div>
      </Modal>

      {/* Modal: Clone Existing Role */}
      <Modal open={!!cloneRoleObj} onClose={() => setCloneRoleObj(null)} title={`Clone Role: ${cloneRoleObj?.name}`}>
        <div className="space-y-4">
          <Field label="New Cloned Role Name" hint="All existing permissions will be copied to this new role.">
            <input
              className="input"
              value={cloneNewName}
              onChange={(e) => setCloneNewName(e.target.value)}
            />
          </Field>
          <button className="btn-primary w-full" onClick={handleCloneRole} disabled={!cloneNewName.trim()}>
            Create Cloned Role
          </button>
        </div>
      </Modal>

      {/* Modal: Rename Role */}
      <Modal open={!!renameRoleObj} onClose={() => setRenameRoleObj(null)} title="Rename Role">
        <div className="space-y-4">
          <Field label="Role Name">
            <input
              className="input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
            />
          </Field>
          <button className="btn-primary w-full" onClick={handleRenameRole} disabled={!renameValue.trim()}>
            Save New Name
          </button>
        </div>
      </Modal>

      {/* Modal: Assign User to Role */}
      <Modal open={assignUserOpen} onClose={() => setAssignUserOpen(false)} title={`Assign User to ${selected?.name}`}>
        <div className="space-y-4">
          <Field label="Select User" hint="Re-assigning a user updates their security permissions instantly.">
            <select
              className="input"
              value={selectedUserToAssign}
              onChange={(e) => setSelectedUserToAssign(e.target.value)}
            >
              <option value="">Choose user…</option>
              {allProfiles?.map((u: any) => (
                <option key={u.id} value={u.id}>
                  {u.full_name} ({u.email})
                </option>
              ))}
            </select>
          </Field>
          <button className="btn-primary w-full" onClick={handleAssignUser} disabled={!selectedUserToAssign}>
            Assign User
          </button>
        </div>
      </Modal>

      {/* Confirm Delete Dialog */}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={handleDeleteRole}
        danger
        title="Delete Role"
        body={`Are you sure you want to delete "${deleting?.name}"? Users assigned to this role will lose its permissions immediately.`}
        confirmLabel="Delete Role"
      />
    </>
  );
}
