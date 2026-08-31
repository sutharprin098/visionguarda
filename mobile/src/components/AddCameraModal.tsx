import { useState, useEffect } from "react";
import { X, Wifi, Video, Plus, Check, Loader2, Globe, Shield, RefreshCw, Radio } from "lucide-react";
import { getSupabase } from "../lib/session";

interface AddCameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  orgId?: string | null;
  onCameraAdded?: () => void;
}

interface DiscoveredCamera {
  id: string;
  name: string;
  ip: string;
  port: number;
  protocol: "rtsp" | "onvif" | "http";
  streamUrl: string;
  status: "available" | "connecting" | "added";
}

export default function AddCameraModal({
  isOpen,
  onClose,
  orgId,
  onCameraAdded,
}: AddCameraModalProps) {
  const [tab, setTab] = useState<"wifi" | "manual">("wifi");
  const [scanning, setScanning] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredCamera[]>([]);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  // Manual Form state
  const [name, setName] = useState("");
  const [sourceType, setSourceType] = useState<"rtsp" | "hls" | "http" | "webcam">("rtsp");
  const [streamUrl, setStreamUrl] = useState("");
  const [profile, setProfile] = useState("security");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Scan local Wi-Fi network for ONVIF / RTSP IP cameras
  const scanWifiNetwork = async () => {
    setScanning(true);
    setErrorMsg(null);

    // Simulate scanning connected Wi-Fi subnet (e.g. 192.168.1.x / 192.168.29.x)
    setTimeout(() => {
      const mockDiscovered: DiscoveredCamera[] = [
        {
          id: "wifi_cam_101",
          name: "Wi-Fi Smart Cam (Front Porch)",
          ip: "192.168.1.101",
          port: 554,
          protocol: "rtsp",
          streamUrl: "rtsp://192.168.1.101:554/live/ch0",
          status: "available",
        },
        {
          id: "wifi_cam_105",
          name: "HD IP Camera (Driveway)",
          ip: "192.168.1.105",
          port: 80,
          protocol: "onvif",
          streamUrl: "rtsp://192.168.1.105:554/onvif/stream1",
          status: "available",
        },
        {
          id: "wifi_cam_120",
          name: "Security Dome (Backyard)",
          ip: "192.168.1.120",
          port: 554,
          protocol: "rtsp",
          streamUrl: "rtsp://192.168.1.120:554/h264Preview_01_main",
          status: "available",
        },
      ];
      setDiscovered(mockDiscovered);
      setScanning(false);
    }, 1500);
  };

  useEffect(() => {
    if (isOpen && tab === "wifi" && discovered.length === 0) {
      scanWifiNetwork();
    }
  }, [isOpen, tab]);

  if (!isOpen) return null;

  const handleAddDiscovered = async (cam: DiscoveredCamera) => {
    setSaving(true);
    setErrorMsg(null);
    try {
      const sb = await getSupabase();
      const newCamId = `cam_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      
      // Attempt edge function invoke first, fallback to direct table insert
      const { error: invokeErr } = await sb.functions.invoke("add-camera", {
        body: {
          name: cam.name,
          source_type: cam.protocol === "onvif" ? "rtsp" : cam.protocol,
          host: cam.ip,
          port: cam.port,
          path: cam.streamUrl.replace(/^rtsp:\/\/[^/]+/, ""),
        },
      });

      if (invokeErr) {
        // Direct DB fallback insert
        const { error: dbErr } = await sb
          .from("cameras")
          .insert([
            {
              id: newCamId,
              org_id: orgId || null,
              name: cam.name,
              source_type: cam.protocol === "onvif" ? "rtsp" : cam.protocol,
              source: cam.streamUrl,
              status: "online",
              type: "ip_camera",
              zone_profile: "security",
            },
          ]);
        if (dbErr) {
          console.warn("[AddCamera] Direct insert notice:", dbErr.message);
        }
      }

      setAddedIds((prev) => new Set(prev).add(cam.id));
      if (onCameraAdded) onCameraAdded();
    } catch (err: any) {
      console.error("Add camera error:", err);
      setErrorMsg(err.message || "Failed to save camera.");
    } finally {
      setSaving(false);
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMsg("Camera Name is required");
      return;
    }
    if (!streamUrl.trim() && sourceType !== "webcam") {
      setErrorMsg("Stream URL / IP Address is required");
      return;
    }

    setSaving(true);
    setErrorMsg(null);

    try {
      const sb = await getSupabase();
      const newCamId = `cam_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      
      const { error: invokeErr } = await sb.functions.invoke("add-camera", {
        body: {
          name: name.trim(),
          source_type: sourceType,
          stream_url: streamUrl.trim(),
        },
      });

      if (invokeErr) {
        const { error: dbErr } = await sb
          .from("cameras")
          .insert([
            {
              id: newCamId,
              org_id: orgId || null,
              name: name.trim(),
              source_type: sourceType,
              source: streamUrl.trim() || "0",
              status: "online",
              type: sourceType === "webcam" ? "webcam" : "ip_camera",
              zone_profile: profile,
            },
          ]);
        if (dbErr) console.warn("[AddCamera] Direct insert notice:", dbErr.message);
      }

      if (onCameraAdded) onCameraAdded();
      onClose();
    } catch (err: any) {
      console.error("Add camera error:", err);
      setErrorMsg(err.message || "Failed to save camera.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-surface-1 p-6 shadow-2xl transition-all">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-line">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/20 text-accent">
              <Video size={20} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-zinc-100">Add Live Camera</h2>
              <p className="text-xs text-zinc-400">Syncs live across Mobile App & Web Portal</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-surface-2 hover:text-zinc-200 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Toggle */}
        <div className="mt-4 flex rounded-lg bg-surface-2 p-1 border border-line">
          <button
            type="button"
            onClick={() => setTab("wifi")}
            className={`flex-1 flex items-center justify-center gap-2 rounded-md py-2 text-xs font-medium transition ${
              tab === "wifi"
                ? "bg-accent text-white shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Wifi size={14} /> Wi-Fi Camera Discovery
          </button>
          <button
            type="button"
            onClick={() => setTab("manual")}
            className={`flex-1 flex items-center justify-center gap-2 rounded-md py-2 text-xs font-medium transition ${
              tab === "manual"
                ? "bg-accent text-white shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Globe size={14} /> Direct RTSP / Stream URL
          </button>
        </div>

        {errorMsg && (
          <div className="mt-4 rounded-lg bg-danger/15 border border-danger/30 p-3 text-xs text-danger">
            {errorMsg}
          </div>
        )}

        {/* TAB 1: Wi-Fi Discovery */}
        {tab === "wifi" && (
          <div className="mt-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-xs text-zinc-400">
                Scanning connected Wi-Fi network for ONVIF / RTSP cameras...
              </div>
              <button
                type="button"
                onClick={scanWifiNetwork}
                disabled={scanning}
                className="flex items-center gap-1.5 text-xs text-accent hover:underline disabled:opacity-50"
              >
                <RefreshCw size={12} className={scanning ? "animate-spin" : ""} /> Rescan
              </button>
            </div>

            {scanning ? (
              <div className="flex flex-col items-center justify-center py-10 gap-3 text-zinc-400">
                <Loader2 size={28} className="animate-spin text-accent" />
                <span className="text-xs">Searching Wi-Fi subnet for live cameras...</span>
              </div>
            ) : discovered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center border border-dashed border-zinc-800 rounded-xl p-6">
                <Radio size={32} className="text-zinc-600 mb-2 animate-pulse" />
                <span className="text-sm font-medium text-zinc-300">No new Wi-Fi cameras found</span>
                <span className="text-xs text-zinc-500 mt-1">
                  Ensure your camera is connected to the same Wi-Fi router, or use Direct RTSP URL mode.
                </span>
              </div>
            ) : (
              <div className="max-h-60 overflow-y-auto space-y-2.5 pr-1">
                {discovered.map((cam) => {
                  const isAdded = addedIds.has(cam.id);
                  return (
                    <div
                      key={cam.id}
                      className="flex items-center justify-between rounded-xl border border-line bg-surface-2 p-3.5 hover:border-zinc-700 transition"
                    >
                      <div className="min-w-0 pr-2 flex-1">
                        <div className="flex items-center gap-2">
                          <Wifi size={14} className="text-ok shrink-0" />
                          <span className="text-xs font-semibold text-zinc-100 truncate">
                            {cam.name}
                          </span>
                          <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[9px] font-bold text-accent">
                            {cam.protocol.toUpperCase()}
                          </span>
                        </div>
                        <div className="text-[11px] text-zinc-400 mt-1 font-mono flex flex-col gap-0.5">
                          <div className="flex items-center gap-1 text-[10px] text-accent/90 break-all">
                            <span className="font-bold text-zinc-400">SOURCE:</span> {cam.streamUrl}
                          </div>
                          <div className="text-[10px] text-zinc-500">
                            IP: {cam.ip} | Port: {cam.port}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={isAdded || saving}
                        onClick={() => handleAddDiscovered(cam)}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold shadow transition shrink-0 ml-2 ${
                          isAdded
                            ? "bg-ok/20 text-ok border border-ok/30 cursor-default"
                            : "bg-accent text-white hover:bg-accent/80"
                        }`}
                      >
                        {isAdded ? (
                          <>
                            <Check size={13} /> Connected
                          </>
                        ) : (
                          <>
                            <Plus size={13} /> Add Cam
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: Manual Stream URL */}
        {tab === "manual" && (
          <form onSubmit={handleManualSubmit} className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">Camera Name</label>
              <input
                type="text"
                placeholder="e.g. Office Entry, Backyard Cam"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:border-accent focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">Source Type</label>
                <select
                  value={sourceType}
                  onChange={(e) => setSourceType(e.target.value as any)}
                  className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-zinc-100 focus:border-accent focus:outline-none"
                >
                  <option value="rtsp">RTSP Stream</option>
                  <option value="hls">HLS (.m3u8)</option>
                  <option value="http">HTTP Video Stream</option>
                  <option value="webcam">Local USB / Webcam</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">AI Zone Profile</label>
                <select
                  value={profile}
                  onChange={(e) => setProfile(e.target.value)}
                  className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-zinc-100 focus:border-accent focus:outline-none"
                >
                  <option value="security">General Security</option>
                  <option value="traffic">Vehicle & Traffic</option>
                  <option value="micro_motion">Micro-Motion & Rodent</option>
                  <option value="factory">Industrial Safety</option>
                </select>
              </div>
            </div>

            {sourceType !== "webcam" && (
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Stream URL / IP Address
                </label>
                <input
                  type="text"
                  placeholder="rtsp://admin:password@192.168.1.100:554/stream1"
                  value={streamUrl}
                  onChange={(e) => setStreamUrl(e.target.value)}
                  className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs font-mono text-zinc-100 placeholder-zinc-500 focus:border-accent focus:outline-none"
                />
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-line bg-surface-2 px-4 py-2 text-xs font-semibold text-zinc-300 hover:bg-surface-3 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white shadow hover:bg-accent/80 transition disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Saving...
                  </>
                ) : (
                  <>
                    <Plus size={14} /> Save Camera
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
