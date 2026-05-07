const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function mustExist(p) {
  if (!fs.existsSync(p)) {
    throw new Error(`Missing required file: ${p}`);
  }
}

function main() {
  const root = path.resolve(__dirname, "..");
  const releaseDir = path.join(root, "release");
  ensureDir(releaseDir);

  const exePath = path.join(releaseDir, "WordTTS-Install.exe");
  const manifestPath = path.join(releaseDir, "manifest.xml");
  const templatePath = path.join(releaseDir, "WordDocumentWithTaskPane.docx");

  mustExist(exePath);
  mustExist(manifestPath);
  mustExist(templatePath);

  const zipPath = path.join(releaseDir, "WordTTS-Install.zip");
  const zip = new AdmZip();
  zip.addLocalFile(exePath);
  zip.addLocalFile(manifestPath);
  zip.addLocalFile(templatePath);
  zip.writeZip(zipPath);
}

main();

