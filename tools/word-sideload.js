const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function findManifestPath() {
  // Prefer manifest next to the packaged exe (simple distribution).
  // Fallback to repo root when running via node.
  const exeDir = path.dirname(process.execPath);
  const nextToExe = path.join(exeDir, "manifest.xml");
  if (fs.existsSync(nextToExe)) return nextToExe;

  return path.resolve(__dirname, "..", "manifest.xml");
}

function readAddinIdFromManifestXml(manifestPath) {
  const xml = fs.readFileSync(manifestPath, "utf8");
  const m = xml.match(/<Id>([^<]+)<\/Id>/i);
  if (!m) throw new Error("Cannot find <Id> in manifest.xml");
  return m[1].trim();
}

function regAddValue(key, name, type, data) {
  const args = ["add", key, "/f", "/v", name, "/t", type, "/d", data];
  const res = spawnSync("reg.exe", args, { stdio: "inherit", windowsHide: false });
  return res.status === 0;
}

function regDeleteValue(key, name) {
  const args = ["delete", key, "/f", "/v", name];
  const res = spawnSync("reg.exe", args, { stdio: "ignore", windowsHide: false });
  return res.status === 0;
}

function registerAddinForOfficeDev(manifestPath) {
  if (process.platform !== "win32") {
    throw new Error("This installer currently supports Windows only.");
  }

  const addinId = readAddinIdFromManifestXml(manifestPath);
  const devKey = "HKCU\\SOFTWARE\\Microsoft\\Office\\16.0\\Wef\\Developer";

  // If manifestPath was previously used as the value name, remove it (mirrors MS tool behavior).
  regDeleteValue(devKey, manifestPath);

  if (!regAddValue(devKey, addinId, "REG_SZ", manifestPath)) {
    throw new Error("Failed to write Office developer registry key.");
  }

  // Hint Office to refresh add-ins list.
  regAddValue(devKey, "RefreshAddins", "REG_DWORD", "1");
}

function main() {
  const manifestPath = findManifestPath();
  if (!fs.existsSync(manifestPath)) {
    console.error(`manifest.xml not found at: ${manifestPath}`);
    process.exit(1);
  }

  try {
    const resolvedManifest = path.resolve(manifestPath);
    const addinId = readAddinIdFromManifestXml(resolvedManifest);

    if (process.argv.includes("--uninstall")) {
      const devKey = "HKCU\\SOFTWARE\\Microsoft\\Office\\16.0\\Wef\\Developer";
      regDeleteValue(devKey, addinId);
      regAddValue(devKey, "RefreshAddins", "REG_DWORD", "1");
      console.log("Add-in unregistered. Restart Word if it is already open.");
      process.exit(0);
    }

    registerAddinForOfficeDev(resolvedManifest);
    console.log("Add-in registered for Word (developer sideload). Restart Word if it is already open.");
    process.exit(0);
  } catch (e) {
    console.error(e && e.message ? e.message : String(e));
    process.exit(1);
  }
}

main();

