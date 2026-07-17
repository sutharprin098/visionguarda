import type { CameraTelemetry } from "../lib/telemetry";
import type { ZoneProfileKey } from "../lib/zoneProfiles";

/**
 * Per-profile stat tiles.
 *
 * A traffic operator and a security operator do not want the same numbers, and
 * the previous single line ("2P · 0V · 1.5 fps") served neither. Every tile here
 * reads a field the engine genuinely emits (see pipeline.py's telemetry build) —
 * no tile exists for a metric nothing produces, which is how "PPE Compliance"
 * and "Fire Alerts" would have ended up displaying a confident 0% for a
 * detector that does not exist.
 */
interface Props {
  profile: ZoneProfileKey | null;
  t: CameraTelemetry;
}

interface Tile { label: string; value: string; hint?: string }

function fmt(n: number | undefined, unit = ""): string {
  if (n == null) return "—";
  return `${Math.round(n * 10) / 10}${unit}`;
}

function tilesFor(profile: ZoneProfileKey | null, t: CameraTelemetry): Tile[] {
  const c = t.counters ?? {};
  const fps = { label: "FPS", value: fmt(t.fps) };

  if (profile === "traffic") {
    // Average speed is only meaningful once a speed gate has calibrated a
    // reading; showing the uncalibrated pixel heuristic as an average km/h
    // would be inventing a measurement. "—" until a gate exists.
    const calibrated = (t.detections ?? []).filter((d) => d.speed_calibrated && d.speed);
    const avg = calibrated.length
      ? calibrated.reduce((s, d) => s + (d.speed ?? 0), 0) / calibrated.length
      : null;
    return [
      { label: "Vehicles", value: String(t.vehicles ?? 0) },
      { label: "Counted", value: `${c.vehicles_in ?? 0} in / ${c.vehicles_out ?? 0} out` },
      {
        label: "Avg Speed",
        value: avg != null ? fmt(avg, " km/h") : "—",
        hint: avg == null ? "Needs a calibrated speed gate (two lines + real distance)" : undefined,
      },
      { label: "Density", value: t.zone_stats?.length ? `${t.zone_stats.length} zone(s)` : "—" },
      { label: "Queue", value: t.crowd_stats ? fmt((t.crowd_stats as any).max_count ?? 0) : "—" },
      fps,
    ];
  }

  if (profile === "security") {
    const faces = (t.detections ?? []).filter((d) => d.class === "face").length;
    return [
      { label: "People", value: String(t.people ?? 0) },
      { label: "Counted", value: `${c.people_in ?? 0} in / ${c.people_out ?? 0} out` },
      { label: "Faces", value: String(faces) },
      { label: "Items", value: String(t.items ?? 0) },
      { label: "Crowd", value: t.crowd_stats ? fmt((t.crowd_stats as any).max_count ?? 0) : "—" },
      fps,
    ];
  }

  if (profile === "factory") {
    return [
      { label: "Workers", value: String(t.people ?? 0) },
      { label: "Counted", value: `${c.people_in ?? 0} in / ${c.people_out ?? 0} out` },
      { label: "Zones", value: t.zone_stats?.length ? String(t.zone_stats.length) : "—" },
      fps,
    ];
  }

  // custom / unset — no template, so report what the engine reports.
  return [
    { label: "People", value: String(t.people ?? 0) },
    { label: "Vehicles", value: String(t.vehicles ?? 0) },
    { label: "Items", value: String(t.items ?? 0) },
    fps,
  ];
}

export default function ProfileDashboard({ profile, t }: Props) {
  const tiles = tilesFor(profile, t);
  return (
    <div className="grid grid-cols-3 gap-px overflow-hidden rounded border border-line bg-line sm:grid-cols-6">
      {tiles.map((tile) => (
        <div key={tile.label} className="bg-surface-2 px-2 py-1.5" title={tile.hint}>
          <div className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">{tile.label}</div>
          <div className={`truncate text-xs font-semibold ${tile.value === "—" ? "text-zinc-600" : "text-zinc-200"}`}>
            {tile.value}
          </div>
        </div>
      ))}
    </div>
  );
}
