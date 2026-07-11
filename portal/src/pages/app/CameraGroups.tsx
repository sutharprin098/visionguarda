import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers, Plus } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { audit } from "../../lib/audit";
import { PageHeader, Badge, Modal, ConfirmDialog, Field, Empty } from "../../components/ui";

interface GroupRow {
  id: string;
  name: string;
  camera_group_members: { camera_id: string; cameras: { id: string; name: string; status: string } | null }[];
}

export default function CameraGroupsPage() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<GroupRow | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; body: string; run: () => Promise<void> } | null>(null);

  const { data: groups } = useQuery({
    queryKey: ["camera-groups"],
    queryFn: async () =>
      (await supabase
        .from("camera_groups")
        .select("*, camera_group_members(camera_id, cameras(id, name, status))")
        .order("name")).data as GroupRow[] | null,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["camera-groups"] });

  return (
    <>
      <PageHeader
        title="Camera Groups"
        subtitle="Bundle cameras for bulk assignment and dashboard filtering."
        actions={
          <button className="btn-primary" onClick={() => setCreateOpen(true)}>
            <Plus size={15} /> New Group
          </button>
        }
      />

      {!groups?.length ? (
        <Empty text="No camera groups yet. Create one to organize your cameras." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => {
            const members = g.camera_group_members?.map((m) => m.cameras).filter(Boolean) ?? [];
            return (
              <div key={g.id} className="card p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Layers size={15} className="text-accent" />
                    <span className="font-medium text-ink-1">{g.name}</span>
                  </div>
                  <span className="text-xs text-ink-3">{members.length} cameras</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {members.length === 0 && <span className="text-xs text-ink-3">Empty group.</span>}
                  {members.slice(0, 6).map((c) => (
                    <Badge key={c!.id} tone={c!.status === "online" ? "ok" : "default"}>{c!.name}</Badge>
                  ))}
                  {members.length > 6 && <Badge>+{members.length - 6} more</Badge>}
                </div>
                <div className="mt-4 flex gap-2 border-t border-line pt-3">
                  <button className="btn-ghost flex-1 text-xs" onClick={() => setEditing(g)}>Manage</button>
                  <button className="btn-ghost text-xs text-danger" onClick={() =>
                    setConfirm({
                      title: "Delete group",
                      body: `Delete group "${g.name}"? Cameras themselves are not deleted.`,
                      run: async () => {
                        await supabase.from("camera_groups").delete().eq("id", g.id);
                        audit("camera_group.delete", "camera_group", g.id, { module: "cameras", old: { name: g.name } });
                        refresh();
                      },
                    })}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New camera group">
        <CreateForm onDone={() => { setCreateOpen(false); refresh(); }} />
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Manage — ${editing?.name}`}>
        {editing && <MembersForm group={editing} onDone={() => { setEditing(null); refresh(); }} />}
      </Modal>

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={async () => { await confirm!.run(); }}
        title={confirm?.title ?? ""}
        body={confirm?.body ?? ""}
        danger
      />
    </>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const { data: org } = useQuery({
    queryKey: ["org-id"],
    queryFn: async () => (await supabase.from("organizations").select("id").single()).data,
  });
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!org) return;
    setBusy(true);
    const { data } = await supabase.from("camera_groups").insert({ org_id: org.id, name }).select("id").single();
    if (data) audit("camera_group.create", "camera_group", data.id, { module: "cameras", new: { name } });
    setBusy(false);
    onDone();
  }

  return (
    <div className="space-y-3">
      <Field label="Group name">
        <input className="input" placeholder="e.g. Perimeter — North" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <button className="btn-primary w-full" onClick={submit} disabled={busy || !name.trim() || !org}>
        {busy ? "Creating…" : "Create Group"}
      </button>
    </div>
  );
}

function MembersForm({ group, onDone }: { group: GroupRow; onDone: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(group.name);

  const { data: cameras } = useQuery({
    queryKey: ["cameras-brief"],
    queryFn: async () => (await supabase.from("cameras").select("id, name, status").order("name")).data ?? [],
  });
  const { data: members } = useQuery({
    queryKey: ["group-members", group.id],
    queryFn: async () =>
      (await supabase.from("camera_group_members").select("camera_id").eq("group_id", group.id)).data?.map((m) => m.camera_id) ?? [],
  });

  async function toggle(cameraId: string, on: boolean) {
    if (on) await supabase.from("camera_group_members").insert({ group_id: group.id, camera_id: cameraId });
    else await supabase.from("camera_group_members").delete().eq("group_id", group.id).eq("camera_id", cameraId);
    qc.invalidateQueries({ queryKey: ["group-members", group.id] });
    qc.invalidateQueries({ queryKey: ["camera-groups"] });
  }

  async function rename() {
    if (name.trim() && name !== group.name) {
      await supabase.from("camera_groups").update({ name }).eq("id", group.id);
      audit("camera_group.rename", "camera_group", group.id, { module: "cameras", old: { name: group.name }, new: { name } });
    }
    onDone();
  }

  return (
    <div className="space-y-3">
      <Field label="Group name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="max-h-72 space-y-1.5 overflow-y-auto">
        {!cameras?.length && <p className="py-4 text-center text-sm text-ink-3">No cameras in your organization yet.</p>}
        {cameras?.map((c: any) => (
          <label key={c.id} className="flex cursor-pointer items-center justify-between rounded-md border border-line px-3 py-2 hover:bg-surface-2">
            <span className="text-sm text-ink-1">{c.name}</span>
            <input type="checkbox" className="h-4 w-4 accent-[#5b8cff]"
                   checked={members?.includes(c.id) ?? false}
                   onChange={(e) => toggle(c.id, e.target.checked)} />
          </label>
        ))}
      </div>
      <button className="btn-primary w-full" onClick={rename}>Done</button>
    </div>
  );
}
