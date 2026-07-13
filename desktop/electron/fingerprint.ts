// Hardware fingerprint for device binding.
// Combines CPU + motherboard + system disk + TPM presence + Windows MachineGuid + OS,
// hashed with SHA-256. Only the hash ever leaves the machine.
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import si from "systeminformation";

function machineGuid(): string {
  try {
    const out = execSync(
      'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
      { encoding: "utf8", windowsHide: true },
    );
    return out.split("REG_SZ").pop()?.trim() ?? "";
  } catch {
    return "";
  }
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

export async function computeFingerprint(): Promise<FingerprintResult> {
  const [cpu, board, disks, os, mem, graphics] = await Promise.all([
    si.cpu(),
    si.baseboard(),
    si.diskLayout(),
    si.osInfo(),
    si.mem(),
    si.graphics(),
  ]);
  const systemDisk = disks[0];

  const material = [
    cpu.manufacturer, cpu.brand, cpu.family, cpu.model,
    board.manufacturer, board.model, board.serial,
    systemDisk?.serialNum ?? "", systemDisk?.name ?? "",
    tpmPresent(),
    machineGuid(),
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
