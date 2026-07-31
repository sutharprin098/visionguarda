const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// Post-build Authenticode check, run right after checksum.js.
//
// WHY THIS EXISTS: electron-builder signs only when it finds a certificate, and
// when it doesn't it says so once, quietly, in the middle of a few hundred
// lines of packaging output — then produces a perfectly normal-looking
// installer. That is the exact failure this repo has been bitten by before
// (see the AGPL/YOLOX note: editing the source didn't re-freeze the shipped
// engine, and nobody noticed because the artifact still built). A release that
// was MEANT to be signed and silently wasn't is the same class of bug, except
// the person who discovers it is the customer, at the SmartScreen dialog.
//
// So: if this build intended to sign, an unsigned output is a BUILD FAILURE.
// If it didn't intend to sign, this prints exactly what shipped and why, and
// exits 0 — v1.0.0 is deliberately unsigned (see docs/SIGNING.md).

const releaseDir = path.join(__dirname, "..", "release");
const installerExt = /\.(exe|msi)$/i;

/** Did this build ask for a signature? Mirrors every input electron-builder
 *  itself accepts, so "intended to sign" here means the same thing it does
 *  there — otherwise this check would pass builds it should have failed. */
function signingWasRequested() {
  const env = ["CSC_LINK", "WIN_CSC_LINK", "CSC_NAME", "CSC_KEY_PASSWORD", "WIN_CSC_KEY_PASSWORD"];
  for (const k of env) {
    if (process.env[k] && process.env[k].trim()) return `env ${k}`;
  }
  try {
    const win = require(path.join(__dirname, "..", "package.json")).build?.win ?? {};
    if (win.certificateFile) return "build.win.certificateFile";
    if (win.certificateSubjectName) return "build.win.certificateSubjectName";
    if (win.sign) return "build.win.sign";
  } catch { /* package.json unreadable — fall through to "not requested" */ }
  return null;
}

/** Authenticode status via PowerShell. signtool.exe is deliberately NOT used —
 *  it ships with the Windows SDK, which the build machine does not have, so
 *  shelling out to it would make this check silently unavailable on exactly the
 *  machine that cuts the release.
 *
 *  pwsh (PowerShell 7) is tried BEFORE powershell.exe (Windows PowerShell 5.1):
 *  on the current build host 5.1 cannot autoload Microsoft.PowerShell.Security
 *  and Get-AuthenticodeSignature throws CouldNotAutoloadMatchingModule, while
 *  pwsh answers fine. Trying only 5.1 made this script report a signature
 *  problem on a plainly unsigned file — a verifier that produces false alarms
 *  gets ignored, which defeats the point of having one. */
function authenticodeStatus(file) {
  const ps =
    `$ErrorActionPreference='Stop';` +
    `$s = Get-AuthenticodeSignature -LiteralPath ${JSON.stringify(file)};` +
    `$subject = if ($s.SignerCertificate) { $s.SignerCertificate.Subject } else { '' };` +
    `Write-Output ("{0}|{1}" -f $s.Status, $subject)`;
  const errors = [];
  for (const shell of ["pwsh", "powershell.exe"]) {
    try {
      const out = execFileSync(
        shell,
        ["-NoProfile", "-NonInteractive", "-Command", ps],
        { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] },
      ).trim();
      const [status, ...rest] = out.split("|");
      if (status && status.trim()) {
        return { status: status.trim(), subject: rest.join("|").trim() };
      }
      errors.push(`${shell}: empty response`);
    } catch (err) {
      errors.push(`${shell}: ${String(err.message).split("\n")[0]}`);
    }
  }
  // Indeterminate — NOT the same as "unsigned" and not the same as "bad
  // signature". Reported as its own outcome so it can never be mistaken for
  // either.
  return { status: "CheckUnavailable", subject: "", error: errors.join("; ") };
}

if (!fs.existsSync(releaseDir)) {
  console.error(`verify-signature.js: ${releaseDir} does not exist — did electron-builder run?`);
  process.exit(1);
}
const targets = fs.readdirSync(releaseDir).filter((f) => installerExt.test(f));
if (!targets.length) {
  console.error(`verify-signature.js: no .exe/.msi found in ${releaseDir}`);
  process.exit(1);
}

if (process.platform !== "win32") {
  console.log("verify-signature.js: not on Windows — Authenticode check skipped.");
  process.exit(0);
}

const requested = signingWasRequested();
let unsigned = 0;      // definitely has no usable signature
let indeterminate = 0; // could not be established either way

for (const name of targets) {
  const { status, subject, error } = authenticodeStatus(path.join(releaseDir, name));
  const signer = subject ? ` — ${subject}` : "";
  if (status === "Valid") {
    console.log(`${name}: SIGNED and trusted${signer}`);
  } else if (status === "NotSigned") {
    unsigned++;
    console.log(`${name}: UNSIGNED`);
  } else if (status === "CheckUnavailable") {
    indeterminate++;
    console.log(`${name}: could not verify — ${error}`);
  } else {
    // NotTrusted (self-signed / untrusted chain), HashMismatch (modified after
    // signing), UnknownError. All of these mean "there is a signature but
    // Windows will not honour it", which is worse than unsigned because it
    // looks done.
    unsigned++;
    console.log(`${name}: SIGNATURE PROBLEM — ${status}${signer}`);
  }
}

if (requested && (unsigned > 0 || indeterminate > 0)) {
  const why = unsigned > 0
    ? `${unsigned} artifact(s) are not validly signed`
    : `${indeterminate} artifact(s) could not be verified`;
  console.error(
    `\nverify-signature.js: signing was requested (${requested}) but ${why}. ` +
    `Failing the build rather than shipping an installer that only looks ` +
    `finished. See docs/SIGNING.md.`,
  );
  process.exit(1);
}

if (indeterminate > 0) {
  // No signature was asked for, so nothing is wrong with the artifact — only
  // this check is unavailable. Say that, rather than asserting a state.
  console.log(
    "\nNOTE: Authenticode status could not be determined on this machine, and " +
    "no signing was configured, so the installer is presumed unsigned. " +
    "See docs/SIGNING.md.",
  );
} else if (unsigned > 0) {
  console.log(
    "\nNOTE: this installer is UNSIGNED. Windows SmartScreen will show " +
    "\"Windows protected your PC — Unknown publisher\" and the user must click " +
    "More info -> Run anyway.\nThis is the intended state for v1.0.0: a " +
    "code-signing certificate is bound to a legal identity and is not " +
    "transferable, so the acquirer signs under their own. See docs/SIGNING.md.",
  );
}
