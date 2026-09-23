const fs = require("fs");
const path = require("path");

const OUTPUT_ROOT = path.resolve(process.cwd(), "output");
const CACHE_FILE = path.join(OUTPUT_ROOT, "backup-cache.json");

function loadBackupCache() {
  if (!fs.existsSync(CACHE_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); } catch { return {}; }
}

function saveBackupCache(cache) {
  const tempFile = `${CACHE_FILE}.tmp`;
  fs.mkdirSync(OUTPUT_ROOT, {recursive: true});
  fs.writeFileSync(tempFile, JSON.stringify(cache, null, 2), "utf8");
  fs.renameSync(tempFile, CACHE_FILE);
}

function normalizePath(value) {
  const normalized = path.resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isInsideOutput(targetPath) {
  const relative = path.relative(OUTPUT_ROOT, targetPath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function getCacheBackupDir(entry) {
  if (!entry || typeof entry !== "object" || !entry.path) return "";
  const backupDir = path.resolve(process.cwd(), entry.path);
  return isInsideOutput(backupDir) ? backupDir : "";
}

function collectBackupDirectories(dir = OUTPUT_ROOT, result = new Map()) {
  if (!fs.existsSync(dir)) return result;

  let entries;
  try { entries = fs.readdirSync(dir, {withFileTypes: true}); } catch { return result; }

  const hasOriginal = entries.some(entry => entry.isFile() && entry.name === "original.html");
  const hasMarkdown = entries.some(entry => entry.isFile() && entry.name === "index.md");

  if (hasOriginal || hasMarkdown) {
    result.set(normalizePath(dir), {path: dir, complete: hasOriginal && hasMarkdown});
    return result;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === ".tmp") continue;
    collectBackupDirectories(path.join(dir, entry.name), result);
  }

  return result;
}

function collectCachePaths(cache) {
  const paths = new Map();
  const invalidKeys = new Set();
  const duplicateKeys = new Set();

  for (const [cacheKey, entry] of Object.entries(cache)) {
    const backupDir = getCacheBackupDir(entry);

    if (!backupDir) {
      invalidKeys.add(cacheKey);
      continue;
    }

    const normalized = normalizePath(backupDir);

    if (paths.has(normalized)) {
      duplicateKeys.add(paths.get(normalized).cacheKey);
      duplicateKeys.add(cacheKey);
      continue;
    }

    paths.set(normalized, {cacheKey, entry, path: backupDir});
  }

  return {paths, invalidKeys, duplicateKeys};
}

function removeEmptyParentDirectories(startDir) {
  let currentDir = path.dirname(startDir);

  while (normalizePath(currentDir) !== normalizePath(OUTPUT_ROOT)) {
    if (!isInsideOutput(currentDir)) break;

    let entries;
    try { entries = fs.readdirSync(currentDir); } catch { break; }

    if (entries.length) break;

    try { fs.rmdirSync(currentDir); } catch { break; }
    currentDir = path.dirname(currentDir);
  }
}

function checkBackupCache() {
  const cache = loadBackupCache();

  // 먼저 양쪽 데이터를 전부 수집한다. 이 단계에서는 삭제하지 않는다.
  const cacheData = collectCachePaths(cache);
  const filePaths = collectBackupDirectories();
  const duplicatePaths = new Set();

  for (const cacheKey of cacheData.duplicateKeys) {
    const backupDir = getCacheBackupDir(cache[cacheKey]);
    if (backupDir) duplicatePaths.add(normalizePath(backupDir));
  }

  // 캐시 ∩ 파일
  const commonPaths = new Set();

  for (const [normalizedPath] of cacheData.paths) {
    if (duplicatePaths.has(normalizedPath)) continue;
    if (!filePaths.has(normalizedPath)) continue;
    if (!filePaths.get(normalizedPath).complete) continue;
    commonPaths.add(normalizedPath);
  }

  // 캐시 - 공통
  const cacheOnlyKeys = new Set([...cacheData.invalidKeys, ...cacheData.duplicateKeys]);

  for (const [normalizedPath, cacheInfo] of cacheData.paths) {
    if (!commonPaths.has(normalizedPath)) cacheOnlyKeys.add(cacheInfo.cacheKey);
  }

  // 파일 - 공통
  const fileOnlyPaths = new Set();

  for (const [normalizedPath] of filePaths) {
    if (!commonPaths.has(normalizedPath)) fileOnlyPaths.add(normalizedPath);
  }

  console.log("");
  console.log("백업 캐시를 확인합니다.");
  console.log(`캐시: ${Object.keys(cache).length}개 / 백업: ${filePaths.size}개 / 공통: ${commonPaths.size}개 / 캐시만: ${cacheOnlyKeys.size}개 / 파일만: ${fileOnlyPaths.size}개`);

  if (!cacheOnlyKeys.size && !fileOnlyPaths.size) {
    console.log("캐시와 백업이 모두 1:1로 일치합니다.\n");
    return cache;
  }

  // 모든 비교가 끝난 뒤에만 실제 삭제한다.
  for (const cacheKey of cacheOnlyKeys) {
    if (!Object.prototype.hasOwnProperty.call(cache, cacheKey)) continue;
    console.log(`캐시 삭제: ${cacheKey}`);
    delete cache[cacheKey];
  }

  for (const normalizedPath of fileOnlyPaths) {
    const fileInfo = filePaths.get(normalizedPath);
    if (!fileInfo) continue;

    const backupDir = fileInfo.path;

    if (!isInsideOutput(backupDir)) {
      console.warn(`백업 삭제 건너뜀: ${backupDir}`);
      continue;
    }

    const relative = path.relative(process.cwd(), backupDir);
    console.log(`백업 삭제: ${relative}`);

    try {
      fs.rmSync(backupDir, {recursive: true, force: true});
      removeEmptyParentDirectories(backupDir);
    } catch (error) {
      console.warn(`백업 삭제 실패: ${relative} - ${error.message}`);
    }
  }

  saveBackupCache(cache);
  console.log("캐시 정리 완료\n");

  return cache;
}

module.exports = {loadBackupCache, saveBackupCache, checkBackupCache};