import { useEffect, useState, FormEvent, ChangeEvent } from "react";
import { Target, Upload, Trash2, CheckCircle2, AlertCircle, RefreshCw, Edit3, Check, Sparkles } from "lucide-react";
import { controlHeaders, getEngineBase } from "../lib/localEngine";

interface EnrolledTarget {
  target_id: string;
  name: string;
  threshold: number;
  created_at: number;
  image_path?: string;
  thumbnail?: string;
  has_face?: boolean;
}

export default function TargetMatcherUI() {
  const [targets, setTargets] = useState<EnrolledTarget[]>([]);
  const [name, setName] = useState("");
  const [threshold, setThreshold] = useState(0.70);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [autoEnroll, setAutoEnroll] = useState(true);
  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const fetchTargets = async () => {
    try {
      const res = await fetch(`${getEngineBase()}/api/target/list`);
      if (res.ok) {
        const data = await res.json();
        setTargets(data.targets || []);
      }
      const autoRes = await fetch(`${getEngineBase()}/api/target/auto-enroll`);
      if (autoRes.ok) {
        const autoData = await autoRes.json();
        setAutoEnroll(autoData.enabled ?? true);
      }
    } catch (e) {
      console.warn("Failed to fetch targets from local engine:", e);
    }
  };

  useEffect(() => {
    fetchTargets();
    const timer = setInterval(fetchTargets, 4000);
    return () => clearInterval(timer);
  }, []);

  const handleToggleAutoEnroll = async () => {
    const nextVal = !autoEnroll;
    setAutoEnroll(nextVal);
    try {
      const headers = await controlHeaders();
      await fetch(`${getEngineBase()}/api/target/auto-enroll`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextVal }),
      });
    } catch (e) {
      console.error("Failed to toggle auto-enroll:", e);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const f = e.target.files[0];
      setFile(f);
      setPreview(URL.createObjectURL(f));
    }
  };

  const handleUpload = async (e: FormEvent) => {
    e.preventDefault();
    if (!file || !name.trim()) {
      setStatusMsg({ type: "error", text: "Please enter a target name and select an image file." });
      return;
    }
    setUploading(true);
    setStatusMsg(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("name", name.trim());
    formData.append("threshold", threshold.toString());

    try {
      const headers = await controlHeaders();
      const fetchHeaders: Record<string, string> = {};
      if (headers["X-CamAI-Token"]) {
        fetchHeaders["X-CamAI-Token"] = headers["X-CamAI-Token"];
      }

      const url = `${getEngineBase()}/api/target/upload?name=${encodeURIComponent(name.trim())}&threshold=${threshold}`;
      const res = await fetch(url, {
        method: "POST",
        headers: fetchHeaders,
        body: formData,
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setStatusMsg({ type: "success", text: `Target "${data.name}" (ID: ${data.target_id}) enrolled!` });
        setName("");
        setFile(null);
        setPreview(null);
        fetchTargets();
      } else {
        setStatusMsg({ type: "error", text: data.detail || "Failed to upload target." });
      }
    } catch (err: any) {
      setStatusMsg({ type: "error", text: `Upload failed: ${err.message}` });
    } finally {
      setUploading(false);
    }
  };

  const handleSaveRename = async (targetId: string) => {
    if (!editingName.trim()) return;
    try {
      const headers = await controlHeaders();
      const res = await fetch(`${getEngineBase()}/api/target/rename`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ target_id: targetId, name: editingName.trim() }),
      });
      if (res.ok) {
        setStatusMsg({ type: "success", text: `Renamed to "${editingName.trim()}" successfully!` });
        setEditingId(null);
        setEditingName("");
        fetchTargets();
      }
    } catch (e) {
      console.error("Rename failed:", e);
    }
  };

  const handleDelete = async (targetId: string, targetName: string) => {
    if (!confirm(`Delete face target "${targetName}"?`)) return;
    try {
      const headers = await controlHeaders();
      const res = await fetch(`${getEngineBase()}/api/target/${targetId}`, {
        method: "DELETE",
        headers,
      });
      if (res.ok) {
        fetchTargets();
      }
    } catch (e) {
      console.error("Delete failed:", e);
    }
  };

  return (
    <div className="w-full max-w-full overflow-hidden space-y-3 rounded-lg border border-zinc-700/80 bg-zinc-900/95 p-3 text-xs shadow-md">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-cyan-500/20 text-cyan-400">
            <Target size={16} />
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-zinc-100 text-xs truncate">Face Database &amp; Re-ID</h3>
            <p className="text-[10px] text-zinc-400 truncate">Face detection &amp; target matching</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label className="flex items-center gap-1.5 cursor-pointer rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-[10px] text-zinc-200">
            <input type="checkbox" checked={autoEnroll} onChange={handleToggleAutoEnroll} className="accent-cyan-500" />
            <Sparkles size={11} className="text-amber-400" />
            <span>Auto-Save Faces</span>
          </label>
          <button
            onClick={fetchTargets}
            className="p-1 rounded bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-zinc-100 transition"
            title="Refresh Target List"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {/* Enrollment Form */}
      <form onSubmit={handleUpload} className="space-y-2.5">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
            Person / Target Name
          </label>
          <input
            type="text"
            placeholder="e.g. Rahul Sharma, Security Officer"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded bg-zinc-950 border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            required
          />
        </div>

        <div>
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
            <span>Sensitivity (Match Ratio)</span>
            <span className="text-cyan-400 font-mono">{(threshold * 100).toFixed(0)}%</span>
          </div>
          <input
            type="range"
            min="0.40"
            max="0.95"
            step="0.05"
            value={threshold}
            onChange={(e) => setThreshold(parseFloat(e.target.value))}
            className="w-full cursor-pointer accent-cyan-500"
          />
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
            Reference Face Photo
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-zinc-800 border border-zinc-700 cursor-pointer hover:bg-zinc-700 transition text-zinc-200 text-xs shrink-0 max-w-full truncate">
              <Upload size={13} className="text-cyan-400 shrink-0" />
              <span className="truncate">{file ? file.name : "Choose Image..."}</span>
              <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>

            {preview && (
              <div className="h-8 w-8 rounded border border-cyan-500 overflow-hidden shrink-0">
                <img src={preview} alt="Preview" className="h-full w-full object-cover" />
              </div>
            )}

            <button
              type="submit"
              disabled={uploading || !file || !name.trim()}
              className="ml-auto flex items-center gap-1.5 rounded bg-cyan-500 px-3 py-1.5 text-xs font-bold text-zinc-950 hover:bg-cyan-400 transition disabled:opacity-50 shrink-0"
            >
              {uploading ? (
                <>
                  <RefreshCw size={12} className="animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Target size={13} />
                  <span>Save Face</span>
                </>
              )}
            </button>
          </div>
        </div>
      </form>

      {/* Status Alert */}
      {statusMsg && (
        <div
          className={`flex items-center gap-1.5 p-2 rounded border text-[11px] font-medium leading-tight ${
            statusMsg.type === "success"
              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
              : "bg-rose-500/10 text-rose-400 border-rose-500/30"
          }`}
        >
          {statusMsg.type === "success" ? <CheckCircle2 size={13} className="shrink-0" /> : <AlertCircle size={13} className="shrink-0" />}
          <span className="break-all">{statusMsg.text}</span>
        </div>
      )}

      {/* Enrolled Targets List */}
      {targets.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-zinc-800">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-zinc-400">
            <span>Enrolled Faces ({targets.length})</span>
            <span className="text-emerald-400 font-mono">● Active</span>
          </div>
          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-0.5">
            {targets.map((t) => (
              <div
                key={t.target_id}
                className="flex items-center justify-between p-2 rounded bg-zinc-950/80 border border-zinc-800 gap-2 w-full min-w-0"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {t.thumbnail ? (
                    <img
                      src={t.thumbnail}
                      alt={t.name}
                      className="h-8 w-8 rounded object-cover border border-cyan-500/40 shrink-0"
                    />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded bg-cyan-500/20 text-cyan-400 shrink-0">
                      <Target size={14} />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    {editingId === t.target_id ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          className="w-24 rounded bg-zinc-900 border border-zinc-700 px-1.5 py-0.5 text-xs text-zinc-100 focus:outline-none"
                          autoFocus
                        />
                        <button
                          onClick={() => handleSaveRename(t.target_id)}
                          className="p-1 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 shrink-0"
                          title="Save Name"
                        >
                          <Check size={12} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 font-bold text-zinc-100 min-w-0">
                        <span className="truncate text-xs">{t.name}</span>
                        <button
                          onClick={() => { setEditingId(t.target_id); setEditingName(t.name); }}
                          className="text-zinc-500 hover:text-cyan-400 transition shrink-0"
                          title="Edit Name"
                        >
                          <Edit3 size={10} />
                        </button>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 text-[10px] text-zinc-400 truncate">
                      <span className="font-mono bg-zinc-800 text-zinc-300 px-1 rounded text-[9px]">ID: {t.target_id}</span>
                      <span className="font-mono text-cyan-400 text-[9px]">{(t.threshold * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(t.target_id, t.name)}
                  className="text-zinc-400 hover:text-rose-400 p-1 transition shrink-0"
                  title="Remove Face Record"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
