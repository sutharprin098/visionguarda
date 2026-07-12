// Writes a <file>.sha256 next to every installer electron-builder produced
// in dist/, so the release process can attach it as its own GitHub Release
// asset. The portal's github-releases edge function reads that small text
// file (not the multi-hundred-MB installer) to show a verifiable checksum
// on the Downloads page without ever streaming the installer through an
// edge function.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const distDir = path.join(__dirname, "..", "dist");
const installerExt = /\.(exe|msi)$/i;

if (!fs.existsSync(distDir)) {
  console.error(`checksum.js: ${distDir} does not exist — did electron-builder run?`);
  process.exit(1);
}

const targets = fs.readdirSync(distDir).filter((f) => installerExt.test(f));
if (!targets.length) {
  console.error(`checksum.js: no .exe/.msi found in ${distDir}`);
  process.exit(1);
}

for (const name of targets) {
  const filePath = path.join(distDir, name);
  const hash = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  fs.writeFileSync(`${filePath}.sha256`, `${hash}  ${name}\n`);
  console.log(`${name}.sha256 -> ${hash}`);
}
