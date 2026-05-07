const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", windowsHide: false, ...opts });
  if (res.error) {
    console.error(res.error);
    process.exit(1);
  }
  if (res.status !== 0) process.exit(res.status ?? 1);
}

function main() {
  const root = path.resolve(__dirname, "..");
  const releaseDir = path.join(root, "release");
  ensureDir(releaseDir);

  const exePath = path.join(releaseDir, "WordTTS-Install.exe");
  const entry = path.join(root, "tools", "word-sideload.js");

  // Use pkg from node_modules (works cross-platform in npm scripts).
  const pkgCmd = process.platform === "win32"
    ? path.join(root, "node_modules", ".bin", "pkg.cmd")
    : path.join(root, "node_modules", ".bin", "pkg");

  if (process.platform === "win32") {
    const cmdLine = `"${pkgCmd}" -t node18-win-x64 -o "${exePath}" "${entry}"`;
    run("cmd.exe", ["/c", cmdLine], { cwd: root });
  } else {
    run(pkgCmd, ["-t", "node18-win-x64", "-o", exePath, entry], { cwd: root });
  }

  // Distribute manifest next to the exe so the installer can find it reliably.
  fs.copyFileSync(path.join(root, "manifest.xml"), path.join(releaseDir, "manifest.xml"));
}

main();

