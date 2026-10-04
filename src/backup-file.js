const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value) {
  return cheerio.load(`<body>${String(value || "")}</body>`).text();
}

function safeFilename(value) {
  return normalizeText(value)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 150);
}

function removeDirectory(directory) {
  if (!directory || !fs.existsSync(directory)) return;

  fs.rmSync(directory, {
    recursive: true,
    force: true,
  });
}

function copyDirectory(source, destination) {
  if (!source || !fs.existsSync(source)) return;

  fs.mkdirSync(destination, {recursive: true});

  for (const entry of fs.readdirSync(source, {withFileTypes: true})) {
    if (entry.name === "metadata.json") continue;

    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function renameDirectory(source, destination) {
  let lastError;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.renameSync(source, destination);
      return;
    } catch (error) {
      lastError = error;

      if (error.code !== "EPERM" && error.code !== "EBUSY") throw error;

      await sleep(200 * (attempt + 1));
    }
  }

  throw lastError;
}

function backupExists(outputDir) {
  if (!outputDir || !fs.existsSync(outputDir)) return false;
  if (!fs.existsSync(path.join(outputDir, "original.html"))) return false;
  if (!fs.existsSync(path.join(outputDir, "index.md"))) return false;

  return true;
}

module.exports = {
  normalizeText,
  decodeHtmlEntities,
  safeFilename,
  removeDirectory,
  copyDirectory,
  renameDirectory,
  backupExists,
};