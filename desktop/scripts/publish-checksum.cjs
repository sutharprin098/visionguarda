const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// `electron-builder --publish always` uploads only the artifacts it itself
// produced (installer, .blockmap, latest.yml) — it doesn't know about the
// .sha256 companion checksum.cjs writes afterward. This attaches that file
// to the same release so `npm run release` ships a verifiable checksum
// without a second manual step (the gap that caused v1.0.0 to ship without
// one — see docs/DEPLOYMENT.md).
const releaseDir = path.join(__dirname, "..", "release");
const pkg = require(path.join(__dirname, "..", "package.json"));
const tag = `v${pkg.version}`;
const repo = `${pkg.build.publish.owner}/${pkg.build.publish.repo}`;

const checksums = fs.readdirSync(releaseDir).filter((f) => f.endsWith(".sha256"));
if (!checksums.length) {
  console.error(`publish-checksum.js: no .sha256 files in ${releaseDir} — run checksum.cjs first`);
  process.exit(1);
}

for (const name of checksums) {
  console.log(`Uploading ${name} to ${repo}@${tag}...`);
  execFileSync(
    "gh",
    ["release", "upload", tag, path.join(releaseDir, name), "--repo", repo, "--clobber"],
    { stdio: "inherit" },
  );
}
