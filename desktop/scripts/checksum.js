const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// electron-builder writes installers here (build.directories.output). This is
// deliberately NOT `dist/`, which is vite's renderer output: vite empties its
// outDir on every build, so a ~450 MB installer sitting in it made `npm run
// build` fail with EPERM the moment anything held the file open — running the
// installer, an antivirus scan, even an Explorer preview. Sharing the directory
// also let `files: ["dist/**"]` pack a previous installer inside the next
// build's app payload.
const releaseDir = path.join(__dirname, "..", "release");
const installerExt = /\.(exe|msi)$/i;

if (!fs.existsSync(releaseDir)) {
  console.error(`checksum.js: ${releaseDir} does not exist — did electron-builder run?`);
  process.exit(1);
}

const targets = fs.readdirSync(releaseDir).filter((f) => installerExt.test(f));
if (!targets.length) {
  console.error(`checksum.js: no .exe/.msi found in ${releaseDir}`);
  process.exit(1);
}

async function generateChecksums() {
  for (const name of targets) {
    const filePath = path.join(releaseDir, name);
    const hash = crypto.createHash("sha256");
    const input = fs.createReadStream(filePath);

    await new Promise((resolve, reject) => {
      input.on("data", (chunk) => hash.update(chunk));
      input.on("error", (err) => reject(err));
      input.on("end", () => {
        const result = hash.digest("hex");
        fs.writeFileSync(`${filePath}.sha256`, `${result}  ${name}\n`);
        console.log(`${name}.sha256 -> ${result}`);
        resolve();
      });
    });
  }
}

generateChecksums().catch((err) => {
  console.error(err);
  process.exit(1);
});
