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

async function generateChecksums() {
  for (const name of targets) {
    const filePath = path.join(distDir, name);
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
