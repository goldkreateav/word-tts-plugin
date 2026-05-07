const fs = require("fs");
const path = require("path");

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function main() {
  const root = path.resolve(__dirname, "..");
  const releaseDir = path.join(root, "release");
  ensureDir(releaseDir);

  fs.copyFileSync(path.join(root, "manifest.xml"), path.join(releaseDir, "manifest.xml"));
}

main();

