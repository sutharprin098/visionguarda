import { useState, useEffect } from "react";
import { Bell, Check, Sliders, Volume2, VolumeX, ShieldAlert, Car, User } from "lucide-react";
import {
  getDesktopNotificationSettings,
  saveDesktopNotificationSettings,
  type DesktopNotificationSettings,
} from "../lib/notifications";

export default function NotificationPreferencesCard() {
  const [settings, setSettings] = useState<DesktopNotificationSettings>(getDesktopNotificationSettings);
  const [savedMessage, setSavedMessage] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setSettings(getDesktopNotificationSettings());
  }, []);

  const update = (patch: Partial<DesktopNotificationSettings> | { events: Partial<DesktopNotificationSettings["events"]> }) => {
    const current = getDesktopNotificationSettings();
    const updated: DesktopNotificationSettings = {
      ...current,
      ...patch,
      events: {
        ...current.events,
        ...("events" in patch && patch.events ? patch.events : {}),
      },
    };
    setSettings(updated);
    saveDesktopNotificationSettings(updated);
    setSavedMessage(true);
    setTimeout(() => setSavedMessage(false), 1500);
  };

  return (
    <div className="rounded-xl border border-line bg-surface-1 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-line">
        <div className="flex items-center gap-2.5">
          <Bell size={16} className="text-accent" />
          <div>
            <div className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
              Alert & Notification Preferences
              {savedMessage && (
                <span className="text-[10px] font-normal text-ok flex items-center gap-0.5">
                  <Check size={10} /> Saved
                </span>
              )}
            </div>
            <div className="text-[10px] text-zinc-500">
              Only receive the messages and notifications you actually want — no spam.
            </div>
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-accent hover:underline flex items-center gap-1"
        >
          <Sliders size={12} />
          {expanded ? "Hide Options" : "Configure"}
        </button>
      </div>

      {expanded && (
        <div className="p-4 space-y-3 bg-surface-0/50">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Master Toggle */}
            <label className="flex items-center justify-between rounded-lg border border-line bg-surface-1 p-3 cursor-pointer hover:border-zinc-700">
              <div>
                <div className="text-xs font-medium text-zinc-200">System Notifications</div>
                <div className="text-[10px] text-zinc-500">Show desktop notifications for new events</div>
              </div>
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) => update({ enabled: e.target.checked })}
                className="h-4 w-4 accent-accent"
              />
            </label>

            {/* Audio Alert */}
            <label className="flex items-center justify-between rounded-lg border border-line bg-surface-1 p-3 cursor-pointer hover:border-zinc-700">
              <div>
                <div className="text-xs font-medium text-zinc-200 flex items-center gap-1.5">
                  {settings.soundEnabled ? <Volume2 size={13} className="text-ok" /> : <VolumeX size={13} className="text-zinc-500" />}
                  Sound Chime on Alert
                </div>
                <div className="text-[10px] text-zinc-500">Play alert sound for critical events</div>
              </div>
              <input
                type="checkbox"
                checked={settings.soundEnabled}
                onChange={(e) => update({ soundEnabled: e.target.checked })}
                className="h-4 w-4 accent-accent"
              />
            </label>
          </div>

          <div className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider pt-2">
            Notification Categories
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {/* Violations & Security (Default ON) */}
            <label className="flex items-start gap-2.5 rounded-lg border border-line bg-surface-1 p-3 cursor-pointer hover:border-zinc-700">
              <input
                type="checkbox"
                checked={settings.events.intrusion}
                onChange={(e) => update({ events: { intrusion: e.target.checked } })}
                className="h-4 w-4 mt-0.5 accent-accent"
              />
              <div>
                <div className="text-xs font-medium text-zinc-200 flex items-center gap-1.5">
                  <ShieldAlert size={12} className="text-ok" />
                  Violations &amp; Security
                </div>
                <div className="text-[10px] text-zinc-500 leading-tight mt-0.5">
                  Wrong-way, speeding, perimeter intrusion, safety rules.
                </div>
              </div>
            </label>

            {/* Vehicle Presence (Default OFF to stop spam) */}
            <label className="flex items-start gap-2.5 rounded-lg border border-line bg-surface-1 p-3 cursor-pointer hover:border-zinc-700">
              <input
                type="checkbox"
                checked={settings.events.vehicle}
                onChange={(e) => update({ events: { vehicle: e.target.checked } })}
                className="h-4 w-4 mt-0.5 accent-accent"
              />
              <div>
                <div className="text-xs font-medium text-zinc-200 flex items-center gap-1.5">
                  <Car size={12} className={settings.events.vehicle ? "text-accent" : "text-zinc-500"} />
                  Vehicle Presence
                </div>
                <div className="text-[10px] text-zinc-500 leading-tight mt-0.5">
                  Alert on every normal car passing (keep off to prevent spam).
                </div>
              </div>
            </label>

            {/* Person Presence (Default OFF to stop spam) */}
            <label className="flex items-start gap-2.5 rounded-lg border border-line bg-surface-1 p-3 cursor-pointer hover:border-zinc-700">
              <input
                type="checkbox"
                checked={settings.events.person}
                onChange={(e) => update({ events: { person: e.target.checked } })}
                className="h-4 w-4 mt-0.5 accent-accent"
              />
              <div>
                <div className="text-xs font-medium text-zinc-200 flex items-center gap-1.5">
                  <User size={12} className={settings.events.person ? "text-accent" : "text-zinc-500"} />
                  Pedestrian Presence
                </div>
                <div className="text-[10px] text-zinc-500 leading-tight mt-0.5">
                  Alert on every person passing (keep off to prevent spam).
                </div>
              </div>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
