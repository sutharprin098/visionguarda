import { useEffect, useState, FormEvent, ChangeEvent } from "react";
import { Target, Upload, Trash2, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";
import { controlHeaders } from "../lib/localEngine";

interface EnrolledTarget {
  target_id: string;
  name: string;
  threshold: number;
  created_at: number;
  image_path?: string;
}

export default function TargetMatcherUI() {
  const [targets, setTargets] = useState<EnrolledTarget[]>([]);
  const [name, setName] = useState("");
  const [threshold, setThreshold] = useState(0.70);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchTargets = async () => {
    try {
      const res = await fetch("http://127.0.0.1:8000/api/target/list");
      if (res.ok) {
        const data = await res.json();
        setTargets(data.targets || []);
      }
    } catch (e) {
      console.warn("Failed to fetch targets from local engine:", e);
    }
  };

  useEffect(() => {
    fetchTargets();
  }, []);

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
      // Remove Content-Type header so browser sets multipart boundary automatically
      const fetchHeaders: Record<string, string> = {};
      if (headers["X-CamAI-Token"]) {
        fetchHeaders["X-CamAI-Token"] = headers["X-CamAI-Token"];
      }

      const res = await fetch("http://127.0.0.1:8000/api/target/upload", {
        method: "POST",
        headers: fetchHeaders,
        body: formData,
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setStatusMsg({ type: "success", text: `Target "${data.name}" enrolled & tracking activated!` });
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

  const handleDelete = async (targetId: string, targetName: string) => {
    if (!confirm(`Delete search target "${targetName}"?`)) return;
    try {
      const headers = await controlHeaders();
      const res = await fetch(`http://127.0.0.1:8000/api/target/${targetId}`, {
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
    <div className="space-y-4 rounded-lg border border-accent/40 bg-surface-2/60 p-4 text-xs">
      <div className="flex items-center justify-between border-b border-line pb-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-accent/20 text-accent">
            <Target size={16} />
          </div>
          <div>
            <h3 className="font-bold text-ink-1 text-sm">Target Image Upload &amp; Tracker</h3>
            <p className="text-[10px] text-ink-3">Desktop Client One-Shot Appearance Matcher Engine</p>
          </div>
        </div>
        <button
          onClick={fetchTargets}
          className="p-1.5 rounded bg-surface-1 border border-line text-ink-3 hover:text-ink-1 transition"
          title="Refresh Target List"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      <form onSubmit={handleUpload} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-ink-3 mb-1">
              Target Label / Name
            </label>
            <input
              type="text"
              placeholder="e.g. John Doe, Suspect Person, Red Car"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input w-full"
              required
            />
          </div>

          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-ink-3 mb-1">
              Match Sensitivity: {(threshold * 100).toFixed(0)}%
            </label>
            <input
              type="range"
              min="0.40"
              max="0.95"
              step="0.05"
              value={threshold}
              onChange={(e) => setThreshold(parseFloat(e.target.value))}
              className="w-full cursor-pointer accent-accent mt-2"
            />
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-ink-3 mb-1">
            Upload Target Photo / Crop
          </label>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 px-3 py-2 rounded bg-surface-1 border border-line cursor-pointer hover:bg-surface-2 transition text-ink-2">
              <Upload size={14} className="text-accent" />
              <span>{file ? file.name : "Choose Photo File..."}</span>
              <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
                required
              />
            </label>

            {preview && (
              <div className="h-10 w-10 rounded border border-accent overflow-hidden shrink-0">
                <img src={preview} alt="Preview" className="h-full w-full object-cover" />
              </div>
            )}

            <button
              type="submit"
              disabled={uploading || !file || !name.trim()}
              className="ml-auto flex items-center gap-1.5 rounded bg-accent px-4 py-2 text-xs font-bold text-zinc-950 hover:bg-accent/80 transition disabled:opacity-50"
            >
              {uploading ? (
                <>
                  <RefreshCw size={12} className="animate-spin" />
                  <span>Enrolling...</span>
                </>
              ) : (
                <>
                  <Target size={14} />
                  <span>Enroll Target</span>
                </>
              )}
            </button>
          </div>
        </div>
      </form>

      {statusMsg && (
        <div
          className={`flex items-center gap-2 p-2 rounded border text-[11px] font-medium ${
            statusMsg.type === "success"
              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
              : "bg-rose-500/10 text-rose-400 border-rose-500/30"
          }`}
        >
          {statusMsg.type === "success" ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
          <span>{statusMsg.text}</span>
        </div>
      )}

      {targets.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-line/60">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
            Enrolled Active Search Targets ({targets.length})
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {targets.map((t) => (
              <div
                key={t.target_id}
                className="flex items-center justify-between p-2.5 rounded bg-surface-1 border border-line"
              >
                <div className="flex items-center gap-2 truncate">
                  <Target size={14} className="text-accent shrink-0" />
                  <div className="truncate">
                    <div className="font-bold text-ink-1 truncate">{t.name}</div>
                    <div className="text-[10px] text-ink-3 font-mono">
                      Match Threshold: {(t.threshold * 100).toFixed(0)}%
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(t.target_id, t.name)}
                  className="text-ink-3 hover:text-rose-400 p-1.5 transition"
                  title="Remove Search Target"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
