import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Video } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Camera } from "../../lib/types";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader, Table, Badge, statusTone, Modal, Empty } from "../../components/ui";

export default function CamerasPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [addOpen, setAddOpen] = useState(false);
  const [assignFor, setAssignFor] = useState<Camera | null>(null);

  const { data: cameras } = useQuery({
    queryKey: ["cameras"],
    queryFn: async () => {
      const { data } = await supabase
        .from("cameras")
        .select("*, camera_assignments(user_id, profiles(full_name))")
        .order("created_at");
      return (data ?? []) as (Camera & { camera_assignments: { user_id: string; profiles: { full_name: string } }[] })[];
    },
  });

  return (
    <>
      <PageHeader
        title="Cameras"
        subtitle="RTSP, ONVIF, USB, IP, NVR and DVR sources. Users only see cameras assigned to them."
        actions={
          can("cameras.manage") && (
            <button className="btn-primary" onClick={() => setAddOpen(true)}>
              <Plus size={15} /> Add Camera
            </button>
          )
        }
      />
      {!cameras?.length ? (
        <Empty text="No cameras yet." />
      ) : (
        <Table headers={["Camera", "Type", "Assigned Users", "Status", ""]}>
          {cameras.map((c) => (
            <tr key={c.id} className="hover:bg-surface-2/50">
              <td className="td">
                <div className="flex items-center gap-2 text-zinc-100">
                  <Video size={14} className="text-zinc-500" /> {c.name}
                </div>
              </td>
              <td className="td"><Badge>{c.source_type.toUpperCase()}</Badge></td>
              <td className="td text-zinc-400">
                {c.camera_assignments?.map((a) => a.profiles?.full_name).filter(Boolean).join(", ") || "—"}
              </td>
              <td className="td"><Badge tone={statusTone[c.status]}>{c.status}</Badge></td>
              <td className="td whitespace-nowrap text-right">
                {can("cameras.assign") && (
                  <button className="text-xs text-accent hover:underline" onClick={() => setAssignFor(c)}>
                    Assign
                  </button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add camera">
        <AddCameraForm onDone={() => { setAddOpen(false); qc.invalidateQueries({ queryKey: ["cameras"] }); }} />
      </Modal>
      <Modal open={!!assignFor} onClose={() => setAssignFor(null)} title={`Assign — ${assignFor?.name}`}>
        {assignFor && <AssignForm camera={assignFor} onDone={() => { setAssignFor(null); qc.invalidateQueries({ queryKey: ["cameras"] }); }} />}
      </Modal>
    </>
  );
}

function AddCameraForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("rtsp");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    // connection string may contain credentials — encrypted server-side (AES-256-GCM)
    const { error } = await supabase.functions.invoke("add-camera", {
      body: { name, source_type: type, connection: url },
    });
    if (error) return setError("Failed — is the add-camera function deployed?");
    onDone();
  }

  return (
    <div className="space-y-3">
      <input className="input" placeholder="Camera name" value={name} onChange={(e) => setName(e.target.value)} />
      <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
        {["rtsp", "onvif", "usb", "ip", "nvr", "dvr"].map((t) => (
          <option key={t} value={t}>{t.toUpperCase()}</option>
        ))}
      </select>
      <input className="input" placeholder="rtsp://user:pass@host:554/stream" value={url}
             onChange={(e) => setUrl(e.target.value)} />
      <p className="text-xs text-zinc-500">Credentials in the URL are encrypted with AES-256 before storage.</p>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button className="btn-primary w-full" onClick={submit} disabled={!name}>Add Camera</button>
    </div>
  );
}

function AssignForm({ camera, onDone }: { camera: Camera; onDone: () => void }) {
  const { data: users } = useQuery({
    queryKey: ["users-brief"],
    queryFn: async () => (await supabase.from("profiles").select("id, full_name, email")).data ?? [],
  });
  const { data: assigned } = useQuery({
    queryKey: ["cam-assign", camera.id],
    queryFn: async () =>
      (await supabase.from("camera_assignments").select("user_id").eq("camera_id", camera.id)).data?.map((a) => a.user_id) ?? [],
  });
  const qc = useQueryClient();

  async function toggle(userId: string, on: boolean) {
    if (on) await supabase.from("camera_assignments").insert({ camera_id: camera.id, user_id: userId });
    else await supabase.from("camera_assignments").delete().eq("camera_id", camera.id).eq("user_id", userId);
    qc.invalidateQueries({ queryKey: ["cam-assign", camera.id] });
    qc.invalidateQueries({ queryKey: ["cameras"] });
  }

  return (
    <div className="max-h-80 space-y-1.5 overflow-y-auto">
      {users?.map((u: any) => (
        <label key={u.id} className="flex cursor-pointer items-center justify-between rounded-md border border-line px-3 py-2 hover:bg-surface-2">
          <div>
            <div className="text-sm text-zinc-200">{u.full_name}</div>
            <div className="text-xs text-zinc-500">{u.email}</div>
          </div>
          <input type="checkbox" className="h-4 w-4 accent-[#5b8cff]"
                 checked={assigned?.includes(u.id) ?? false}
                 onChange={(e) => toggle(u.id, e.target.checked)} />
        </label>
      ))}
      <button className="btn-ghost mt-2 w-full" onClick={onDone}>Done</button>
    </div>
  );
}
