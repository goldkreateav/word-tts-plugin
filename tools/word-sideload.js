const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const AdmZip = require("adm-zip");

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

function readAddinVersionFromManifestXml(manifestPath) {
  const xml = fs.readFileSync(manifestPath, "utf8");
  const m = xml.match(/<Version>([^<]+)<\/Version>/i);
  if (!m) throw new Error("Cannot find <Version> in manifest.xml");
  return m[1].trim();
}

function findTemplateDocxPath() {
  const exeDir = path.dirname(process.execPath);
  const nextToExe = path.join(exeDir, "WordDocumentWithTaskPane.docx");
  if (fs.existsSync(nextToExe)) return nextToExe;

  return path.resolve(__dirname, "templates", "WordDocumentWithTaskPane.docx");
}

function makeUniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const parsed = path.parse(p);
  for (let i = 2; i < 1000; i++) {
    const candidate = path.join(parsed.dir, `${parsed.name}.${i}${parsed.ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(parsed.dir, `${parsed.name}.${Date.now()}${parsed.ext}`);
}

function generateSideloadDocx(addinId, addinVersion) {
  const templatePath = findTemplateDocxPath();
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template docx not found at: ${templatePath}`);
  }

  const outPath = makeUniquePath(path.join(process.env.TEMP || ".", `Word add-in ${addinId}.docx`));

  const templateZip = new AdmZip(templatePath);
  const outZip = new AdmZip();

  const webExtPath = "word/webextensions/webextension.xml";
  const entry = templateZip.getEntry(webExtPath);
  if (!entry) throw new Error("webextension.xml was not found in the template docx.");

  const patchedXml = templateZip
    .readAsText(entry)
    .replace(/00000000-0000-0000-0000-000000000000/g, addinId)
    .replace(/1\.0\.0\.0/g, addinVersion);

  for (const e of templateZip.getEntries()) {
    let data = e.getData();
    if (e.entryName === webExtPath) {
      data = Buffer.from(patchedXml, "utf8");
    }
    outZip.addFile(e.entryName, data, e.comment, e.attr);
  }

  outZip.writeZip(outPath);
  return outPath;
}

function launchFile(filePath) {
  if (process.platform !== "win32") return;
  // Open with default associated app (Word for .docx).
  spawnSync("cmd.exe", ["/c", "start", "", `"${filePath}"`], {
    stdio: "ignore",
    windowsHide: false
  });
}

function regAddValue(key, name, type, data) {
  const args = ["add", key, "/f", "/v", name, "/t", type, "/d", data];
  const res = spawnSync("reg.exe", args, { stdio: "inherit", windowsHide: false });
  return res.status === 0;
}

function regAddValueInView(view, key, name, type, data) {
  const args = ["add", key, "/f", "/v", name, "/t", type, "/d", data, `/reg:${view}`];
  const res = spawnSync("reg.exe", args, { stdio: "inherit", windowsHide: false });
  return res.status === 0;
}

function regDeleteValueInView(view, key, name) {
  const args = ["delete", key, "/f", "/v", name, `/reg:${view}`];
  const res = spawnSync("reg.exe", args, { stdio: "ignore", windowsHide: false });
  return res.status === 0;
}

function regDeleteValue(key, name) {
  const args = ["delete", key, "/f", "/v", name];
  const res = spawnSync("reg.exe", args, { stdio: "ignore", windowsHide: false });
  return res.status === 0;
}

function addInBothRegistryViews(key, name, type, data) {
  const ok32 = regAddValueInView(32, key, name, type, data);
  const ok64 = regAddValueInView(64, key, name, type, data);
  return ok32 || ok64;
}

function deleteInBothRegistryViews(key, name) {
  const ok32 = regDeleteValueInView(32, key, name);
  const ok64 = regDeleteValueInView(64, key, name);
  return ok32 || ok64;
}

function registerAddinForOfficeDev(manifestPath) {
  if (process.platform !== "win32") {
    throw new Error("This installer currently supports Windows only.");
  }

  const addinId = readAddinIdFromManifestXml(manifestPath);
  const devKey = "HKCU\\SOFTWARE\\Microsoft\\Office\\16.0\\Wef\\Developer";

  // If manifestPath was previously used as the value name, remove it (mirrors MS tool behavior).
  deleteInBothRegistryViews(devKey, manifestPath);

  if (!addInBothRegistryViews(devKey, addinId, "REG_SZ", manifestPath)) {
    throw new Error("Failed to write Office developer registry key.");
  }

  // Hint Office to refresh add-ins list.
  addInBothRegistryViews(devKey, "RefreshAddins", "REG_DWORD", "1");
}

function pauseIfPackaged() {
  // When launched by double-click, console closes immediately; pause so user can see messages.
  // pkg sets process.pkg at runtime.
  if (!process.pkg) return;
  try {
    // eslint-disable-next-line no-sync
    fs.writeSync(1, "\nPress Enter to close...\n");
    // eslint-disable-next-line no-sync
    fs.readFileSync(0);
  } catch {
    // ignore
  }
}

function main() {
  const manifestPath = findManifestPath();
  if (!fs.existsSync(manifestPath)) {
    console.error(`manifest.xml not found at: ${manifestPath}`);
    pauseIfPackaged();
    process.exit(1);
  }

  try {
    const resolvedManifest = path.resolve(manifestPath);
    const addinId = readAddinIdFromManifestXml(resolvedManifest);
    const addinVersion = readAddinVersionFromManifestXml(resolvedManifest);

    if (process.argv.includes("--uninstall")) {
      const devKey = "HKCU\\SOFTWARE\\Microsoft\\Office\\16.0\\Wef\\Developer";
      deleteInBothRegistryViews(devKey, addinId);
      addInBothRegistryViews(devKey, "RefreshAddins", "REG_DWORD", "1");
      console.log("Add-in unregistered. Restart Word if it is already open.");
      pauseIfPackaged();
      process.exit(0);
    }

    registerAddinForOfficeDev(resolvedManifest);
    const sideloadDocx = generateSideloadDocx(addinId, addinVersion);
    console.log(`Launching Word via ${sideloadDocx}`);
    launchFile(sideloadDocx);
    console.log("Add-in registered. If Word was already open, close all Word windows and reopen the document.");
    pauseIfPackaged();
    process.exit(0);
  } catch (e) {
    console.error(e && e.message ? e.message : String(e));
    pauseIfPackaged();
    process.exit(1);
  }
}

main();

