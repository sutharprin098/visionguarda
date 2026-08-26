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

/** Sum the alert types a tile covers. analytics.py is the source of these
 *  strings; a tile must only name types something actually raises, or it
 *  displays a confident 0 for a detector that does not exist (which is how
 *  "Fire Alerts" would have read on a build with no fire model). */
function alerts(t: CameraTelemetry, ...types: string[]): number {
  const a = t.alert_counts ?? {};
  return types.reduce((s, k) => s + (a[k] ?? 0), 0);
}

/** Live count of detections of the given class(es) in the current frame. Reads
 *  the same t.detections the overlay draws, so a tile never disagrees with the
 *  boxes on screen. Only classes yolox actually emits are counted — there is no
 *  "auto-rickshaw" tile because COCO/yolox has no such class (it would read a
 *  confident 0), same reason the traffic profile has no pedestrian tile: it
 *  intentionally reports vehicles only, so person is filtered before telemetry. */
function countClass(t: CameraTelemetry, ...classes: string[]): number {
  const set = new Set(classes);
  return (t.detections ?? []).reduce((s, d) => s + (set.has(d.class) ? 1 : 0), 0);
}

function tilesFor(profile: ZoneProfileKey | null, t: CameraTelemetry): Tile[] {
  const c = t.counters ?? {};
  const fps = { label: "FPS", value: fmt(t.fps) };
  
  const nv = t.night_vision;
  let nvVal = "Standby";
  if (nv) {
    if (nv.zero_dce_applied) {
      nvVal = `Active (${nv.mean_luminance}L)`;
    } else if (nv.method === "off") {
      nvVal = "Off";
    } else {
      nvVal = `Idle (${nv.mean_luminance}L)`;
    }
  }
  const nvTile: Tile = { label: "Night Vision", value: nvVal, hint: nv?.zero_dce_applied ? "Zero-DCE low-light enhancement active" : "Luminance monitoring" };

  if (profile === "traffic") {
    // Average speed is only meaningful once a speed gate has calibrated a
    // reading; showing the uncalibrated pixel heuristic as an average km/h
    // would be inventing a measurement. "—" until a gate exists.
    const calibrated = (t.detections ?? []).filter((d) => d.speed_calibrated && d.speed);
    const avg = calibrated.length
      ? calibrated.reduce((s, d) => s + (d.speed ?? 0), 0) / calibrated.length
      : null;
    // Peak (fastest) live vehicle, calibrated or estimated — the number an
    // operator scans for. Estimated is marked with "~" like the overlay label.
    const speeds = (t.detections ?? []).filter((d) => d.speed != null);
    const peak = speeds.length
      ? speeds.reduce((m, d) => ((d.speed ?? 0) > (m.speed ?? 0) ? d : m))
      : null;
    return [
      { label: "Vehicles", value: String(t.vehicles ?? 0) },
      // Per-type live counts, from the same detections the overlay draws. Only
      // yolox-producible classes get a tile (no auto-rickshaw / pedestrian tile
      // — see countClass()).
      { label: "Cars", value: String(countClass(t, "car")) },
      { label: "Bikes", value: String(countClass(t, "motorcycle")) },
      { label: "Trucks", value: String(countClass(t, "truck")) },
      { label: "Buses", value: String(countClass(t, "bus")) },
      { label: "Cycles", value: String(countClass(t, "bicycle")) },
      { label: "Counted", value: `${c.vehicles_in ?? 0} in / ${c.vehicles_out ?? 0} out` },
      {
        label: "Avg Speed",
        value: avg != null ? fmt(avg, " km/h") : "—",
        hint: avg == null ? "Calibrated avg — needs a speed gate (two lines + real distance)" : undefined,
      },
      {
        label: "Peak Speed",
        value: peak?.speed != null ? `${peak.speed_calibrated ? "" : "~"}${Math.round(peak.speed)} km/h` : "—",
        hint: peak && !peak.speed_calibrated ? "Estimated from object height (~±25%)" : undefined,
      },
      // Real event tallies (analytics.py raises these; helmet.py / plate.py feed them).
      { label: "Helmet Violations", value: String(alerts(t, "helmet_violation", "triple_riding")) },
      { label: "Plates Read", value: String(alerts(t, "number_plate")) },
      // wrong_direction + speed_limit are what analytics actually raises for a
      // traffic camera. stop-line / u-turn / red-light have no alert type yet,
      // so they are not silently folded in as a zero.
      { label: "Violations", value: String(alerts(t, "wrong_direction", "speed_limit")) },
      fps,
    ];
  }

  if (profile === "security") {
    const faces = (t.detections ?? []).filter((d) => d.class === "face").length;
    const dwells = (t.detections ?? []).map((d) => d.dwell_time ?? 0).filter((v) => v > 0);
    const maxDwell = dwells.length ? Math.max(...dwells) : null;
    return [
      { label: "People", value: String(t.people ?? 0) },
      { label: "Counted", value: `${c.people_in ?? 0} in / ${c.people_out ?? 0} out` },
      { label: "Faces", value: String(faces) },
      { label: "Intrusions", value: String(alerts(t, "human_entry")) },
      {
        label: "Alerts",
        value: String(alerts(t, "human_entry", "loitering", "abandoned_object", "overcrowding", "crowd_density", "zone_full")),
      },
      // Longest time any tracked person has currently been in frame. dwell_time
      // rides on each detection (analytics sets it from the track's first_seen),
      // so this needs no extra plumbing — it was simply never surfaced.
      { label: "Dwell", value: maxDwell != null ? `${Math.round(maxDwell)}s` : "—" },
      fps,
    ];
    // Deliberately no "Unknown Faces" tile: that needs face RECOGNITION, which
    // is coming-soon (the model is licence-clean but there is no enrolment
    // database yet). A tile reading "0 unknown faces" would say the camera had
    // checked and cleared everyone.
  }

  if (profile === "factory") {
    return [
      { label: "Workers", value: String(t.people ?? 0) },
      { label: "Counted", value: `${c.people_in ?? 0} in / ${c.people_out ?? 0} out` },
      // Both of these are backed by features that genuinely run: fall_alert is
      // the bbox-aspect heuristic, human_entry is restricted_machine_zone /
      // hazard_zone presence.
      { label: "Falls", value: String(alerts(t, "fall_alert")) },
      { label: "Machine Events", value: String(alerts(t, "human_entry")) },
      { label: "Zones", value: t.zone_stats?.length ? String(t.zone_stats.length) : "—" },
      fps,
    ];
    // Deliberately no "PPE Compliance" / "Fire Alerts" / "Smoke Alerts" tiles.
    // analytics still has ppe_violation / fire_alert / smoke_alert branches, but
    // their producers were removed with the colour-threshold fabrications, so
    // those counts can only ever be 0. A "Fire Alerts: 0" tile is the most
    // dangerous thing on this page — it reads as "no fire detected" from a
    // detector that does not exist.
  }

  if (profile === "micro_motion") {
    return [
      { label: "Subtle Motion", value: String(t.items ?? 0) },
      { label: "Detections", value: String((t.detections ?? []).length) },
      { label: "People", value: String(t.people ?? 0) },
      { label: "Vehicles", value: String(t.vehicles ?? 0) },
      nvTile,
      fps,
    ];
  }

  // custom / unset — no template, so report what the engine reports.
  return [
    { label: "People", value: String(t.people ?? 0) },
    { label: "Vehicles", value: String(t.vehicles ?? 0) },
    { label: "Items", value: String(t.items ?? 0) },
    nvTile,
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
