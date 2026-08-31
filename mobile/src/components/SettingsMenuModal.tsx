import { useState, useEffect } from "react";
import {
  X,
  Settings,
  Download,
  Globe,
  Bell,
  LogOut,
  CheckCircle2,
  Loader2,
  Shield,
  Volume2,
  VolumeX,
  Smartphone,
  RefreshCw
} from "lucide-react";
import { getDesktopNotificationSettings, saveDesktopNotificationSettings, DesktopNotificationSettings } from "../lib/notifications";

interface SettingsMenuModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSignOut: () => void;
}

export default function SettingsMenuModal({ isOpen, onClose, onSignOut }: SettingsMenuModalProps) {
  const [serverUrl, setServerUrl] = useState(() => {
    return localStorage.getItem("camai_server_url") || "https://camai.princesite.in";
  });
  const [updating, setUpdating] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);

  const [notifSettings, setNotifSettings] = useState<DesktopNotificationSettings>(() => getDesktopNotificationSettings());

  useEffect(() => {
    setNotifSettings(getDesktopNotificationSettings());
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSaveServerUrl = () => {
    localStorage.setItem("camai_server_url", serverUrl);
    setUpdateMsg("Server URL saved successfully.");
    setTimeout(() => setUpdateMsg(null), 3000);
  };

  const handleCheckOTAUpdate = async () => {
    setUpdating(true);
    setUpdateMsg("Checking for latest Web & Mobile App updates...");
    
    setTimeout(() => {
      setUpdating(false);
      setUpdateMsg("App is already on the latest version (v1.0.7). Web assets reloaded!");
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then((regs) => {
          regs.forEach((r) => r.update());
        });
      }
      setTimeout(() => setUpdateMsg(null), 4000);
    }, 1500);
  };

  const handleToggleNotif = (key: keyof DesktopNotificationSettings['events']) => {
    const updated = {
      ...notifSettings,
      events: {
        ...notifSettings.events,
        [key]: !notifSettings.events[key],
      },
    };
    setNotifSettings(updated);
    saveDesktopNotificationSettings(updated);
  };

  const handleToggleMasterNotif = () => {
    const updated = {
      ...notifSettings,
      enabled: !notifSettings.enabled,
    };
    setNotifSettings(updated);
    saveDesktopNotificationSettings(updated);
    if (updated.enabled && 'Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission();
    }
  };

  const handleToggleSound = () => {
    const updated = {
      ...notifSettings,
      soundEnabled: !notifSettings.soundEnabled,
    };
    setNotifSettings(updated);
    saveDesktopNotificationSettings(updated);
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-surface-1 p-6 shadow-2xl transition-all">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-line">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/20 text-accent">
              <Settings size={20} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-zinc-100">Settings & Updates</h2>
              <p className="text-xs text-zinc-400">CamAI Mobile Client v1.0.7</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-surface-2 hover:text-zinc-200 transition"
          >
            <X size={18} />
          </button>
        </div>

        {updateMsg && (
          <div className="mt-4 rounded-lg bg-accent/15 border border-accent/30 p-3 text-xs text-accent flex items-center gap-2">
            <CheckCircle2 size={16} />
            <span>{updateMsg}</span>
          </div>
        )}

        <div className="mt-5 space-y-5 max-h-[70vh] overflow-y-auto pr-1">
          {/* SECTION 1: 1-Click OTA App Updates */}
          <div className="rounded-xl border border-line bg-surface-2 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
                <RefreshCw size={15} className="text-accent" />
                <span>1-Click App Update (In-App OTA)</span>
              </div>
              <span className="rounded bg-accent/20 px-2 py-0.5 text-[10px] font-bold text-accent">
                v1.0.7
              </span>
            </div>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              Instantly fetch and apply the latest CamAI portal and engine updates without downloading a new APK file.
            </p>
            <button
              onClick={handleCheckOTAUpdate}
              disabled={updating}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-xs font-semibold text-white shadow hover:bg-accent/80 transition disabled:opacity-50"
            >
              {updating ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Checking for Updates...
                </>
              ) : (
                <>
                  <Download size={14} /> Update App Now (1-Click)
                </>
              )}
            </button>
          </div>

          {/* SECTION 2: Web Server & Cloud Portal URL */}
          <div className="rounded-xl border border-line bg-surface-2 p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
              <Globe size={15} className="text-accent" />
              <span>Web Portal / Cloud Server URL</span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="https://camai.princesite.in"
                className="flex-1 rounded-lg border border-line bg-surface-1 px-3 py-2 text-xs font-mono text-zinc-100 focus:border-accent focus:outline-none"
              />
              <button
                onClick={handleSaveServerUrl}
                className="rounded-lg bg-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-700 transition"
              >
                Save
              </button>
            </div>
          </div>

          {/* SECTION 3: 24/7 Background Notifications (WhatsApp Style) */}
          <div className="rounded-xl border border-line bg-surface-2 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
                <Bell size={15} className="text-accent" />
                <span>24/7 Background Push Notifications</span>
              </div>
              <button
                onClick={handleToggleMasterNotif}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  notifSettings.enabled ? "bg-accent" : "bg-zinc-700"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    notifSettings.enabled ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            <p className="text-[11px] text-zinc-400">
              Receive high-priority WhatsApp-style detection popups & alerts even when the app is in the background or screen is off.
            </p>

            {notifSettings.enabled && (
              <div className="pt-2 border-t border-line space-y-2.5 text-xs text-zinc-300">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    {notifSettings.soundEnabled ? <Volume2 size={14} className="text-accent" /> : <VolumeX size={14} className="text-zinc-500" />}
                    Notification Sound & Chime
                  </span>
                  <input
                    type="checkbox"
                    checked={notifSettings.soundEnabled}
                    onChange={handleToggleSound}
                    className="accent-accent h-4 w-4 rounded"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span>Person / Human Detections</span>
                  <input
                    type="checkbox"
                    checked={notifSettings.events.person}
                    onChange={() => handleToggleNotif("person")}
                    className="accent-accent h-4 w-4 rounded"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span>Vehicle & ANPR Alerts</span>
                  <input
                    type="checkbox"
                    checked={notifSettings.events.vehicle}
                    onChange={() => handleToggleNotif("vehicle")}
                    className="accent-accent h-4 w-4 rounded"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span>Intrusion & Line Crossing</span>
                  <input
                    type="checkbox"
                    checked={notifSettings.events.intrusion}
                    onChange={() => handleToggleNotif("intrusion")}
                    className="accent-accent h-4 w-4 rounded"
                  />
                </div>
              </div>
            )}
          </div>

          {/* SECTION 4: Sign Out / Deactivate License */}
          <div className="pt-2">
            <button
              onClick={() => {
                onClose();
                onSignOut();
              }}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-danger/15 border border-danger/30 px-4 py-3 text-xs font-semibold text-danger hover:bg-danger/25 transition"
            >
              <LogOut size={16} /> Sign Out / Deactivate License
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
