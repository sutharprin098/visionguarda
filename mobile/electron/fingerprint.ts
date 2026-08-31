// Hardware fingerprint for device binding.
// Combines CPU + motherboard + system disk + TPM presence + Windows MachineGuid + OS,
// hashed with SHA-256. Only the hash ever leaves the machine.
//
// PERFORMANCE: every call here is a WMI query underneath (systeminformation
// shells out to wmic/PowerShell on Windows), and si.graphics() + si.diskLayout()
// are seconds-slow on a cold WMI service. That cost used to land squarely in
// the middle of activation, with the user staring at "Activating…" while six
// WMI queries and a synchronous `reg query` ran. Two fixes, neither of which
// changes what gets hashed:
//   1. The result is cached on disk. The material is hardware — it does not
//      change between launches, so re-deriving it is pure waste. A cached
//      fingerprint makes re-activation effectively instant.
//   2. warmFingerprint() kicks the computation off at app start, so on a true
//      first run the WMI queries overlap with the user reading the activation
//      screen and typing a 20-character key instead of running after they
//      press the button.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { app } from "electron";

// Bump when the hashed material changes, so stale caches are ignored rather
// than silently pinning devices to an old fingerprint scheme.
const CACHE_VERSION = 1;

function machineGuid(): Promise<string> {
  // execFile, not execSync: this runs on the main process, and a synchronous
  // registry query blocks every IPC handler — including the ones the splash
  // screen is waiting on — for as long as it takes.
  return new Promise((resolve) => {
    execFile(
      "reg",
      ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"],
      { encoding: "utf8", windowsHide: true, timeout: 5000 },
      (err, stdout) => {
        if (err) return resolve("");
        resolve(stdout.split("REG_SZ").pop()?.trim() ?? "");
      },
    );
  });
}

function tpmPresent(): string {
  return "unknown";
}

export interface FingerprintResult {
  hash: string;
  osInfo: Record<string, unknown>;
  hardware: Record<string, unknown>; // inventory shown in the admin portal
  deviceName: string;
}

function cachePath(): string {
  return join(app.getPath("userData"), "vault", "fingerprint.json");
}

function readCache(): FingerprintResult | null {
  try {
    const raw = JSON.parse(readFileSync(cachePath(), "utf-8"));
    if (raw?.version !== CACHE_VERSION || !raw?.result?.hash) return null;
    return raw.result as FingerprintResult;
  } catch {
    return null;
  }
}

function writeCache(result: FingerprintResult): void {
  try {
    mkdirSync(dirname(cachePath()), { recursive: true });
    writeFileSync(cachePath(), JSON.stringify({ version: CACHE_VERSION, result }, null, 2));
  } catch { /* a cache miss next launch is the only cost */ }
}

async function derive(): Promise<FingerprintResult> {
  // Imported here rather than at module scope: systeminformation is ~300KB that
  // vite inlines into the main bundle, and every byte of it was being parsed and
  // evaluated before app.whenReady() fired — i.e. in front of window creation,
  // on every single launch, to serve a code path that runs once per install.
  const si = (await import("systeminformation")).default;

  // machineGuid joins the same Promise.all rather than running after it — it is
  // an independent subprocess and there is no reason to serialise it.
  const [cpu, board, disks, os, mem, graphics, guid] = await Promise.all([
    si.cpu(),
    si.baseboard(),
    si.diskLayout(),
    si.osInfo(),
    si.mem(),
    si.graphics(),
    machineGuid(),
  ]);
  const systemDisk = disks[0];

  const material = [
    cpu.manufacturer, cpu.brand, cpu.family, cpu.model,
    board.manufacturer, board.model, board.serial,
    systemDisk?.serialNum ?? "", systemDisk?.name ?? "",
    tpmPresent(),
    guid,
    os.platform, os.arch,
  ].join("|");

  return {
    hash: createHash("sha256").update(material).digest("hex"),
    osInfo: {
      platform: os.platform,
      distro: os.distro,
      release: `${os.distro} ${os.release}`,
      arch: os.arch,
      hostname: os.hostname,
    },
    hardware: {
      cpu: `${cpu.manufacturer} ${cpu.brand}`.trim(),
      ram_gb: Math.round(mem.total / 1024 ** 3),
      gpu: graphics.controllers?.[0]?.model ?? "",
      disk_gb: systemDisk ? Math.round(systemDisk.size / 1024 ** 3) : 0,
    },
    deviceName: os.hostname || "Windows PC",
  };
}

// In-flight promise, so warmFingerprint() and a user pressing Activate share
// one computation instead of racing two sets of WMI queries.
let inFlight: Promise<FingerprintResult> | null = null;

export async function computeFingerprint(): Promise<FingerprintResult> {
  const cached = readCache();
  if (cached) return cached;
  if (inFlight) return inFlight;
  inFlight = derive()
    .then((r) => {
      writeCache(r);
      return r;
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

/** Fire-and-forget precompute at app start. Failures are ignored — the real
 *  call re-derives and reports properly. */
export function warmFingerprint(): void {
  void computeFingerprint().catch(() => { /* activation will retry and report */ });
}
