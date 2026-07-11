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
  try {
    const out = execSync(
      "powershell -NoProfile -Command \"(Get-CimInstance -Namespace 'root/cimv2/Security/MicrosoftTpm' -ClassName Win32_Tpm -ErrorAction SilentlyContinue) -ne $null\"",
      { encoding: "utf8", windowsHide: true, timeout: 10_000 },
    );
    return out.trim();
  } catch {
    return "unknown";
  }
}

export interface FingerprintResult {
  hash: string;
  osInfo: Record<string, unknown>;
  deviceName: string;
}

export async function computeFingerprint(): Promise<FingerprintResult> {
  const [cpu, board, disks, os] = await Promise.all([
    si.cpu(),
    si.baseboard(),
    si.diskLayout(),
    si.osInfo(),
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
    deviceName: os.hostname || "Windows PC",
  };
}
