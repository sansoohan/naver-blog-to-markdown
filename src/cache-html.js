const fs = require("fs");
const path = require("path");

let OUTPUT_ROOT = path.resolve(process.cwd(), "output");
let CACHE_FILE = path.join(OUTPUT_ROOT, "backup-cache.json");
let LOCK_FILE = path.join(OUTPUT_ROOT, ".backup-cache.lock");

function setBackupOutputRoot(outputDir) {
  OUTPUT_ROOT = outputDir
    ? path.resolve(outputDir)
    : path.resolve(process.cwd(), "output");

  CACHE_FILE = path.join(OUTPUT_ROOT, "backup-cache.json");
  LOCK_FILE = path.join(OUTPUT_ROOT, ".backup-cache.lock");
}

/*
 * 현재 처리 중인 게시글.
 *
 * downloader.js는 게시글 구조를 알 필요가 없다.
 * backup-page.js가 HTML 생성 직전에 context를 지정하고,
 * 모든 resource cache 접근은 이 게시글 안에서만 이루어진다.
 */
let activeContext = null;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function removeStaleBackupLock() {
  if (!fs.existsSync(LOCK_FILE)) return;

  try {
    const stat = fs.statSync(LOCK_FILE);

    if (Date.now() - stat.mtimeMs < 5000) return;

    const pid = Number(fs.readFileSync(LOCK_FILE, "utf8").trim());

    if (isProcessRunning(pid)) return;

    fs.rmSync(LOCK_FILE, {force: true});
  } catch {}
}

function acquireBackupLock(timeoutMs = 60000) {
  fs.mkdirSync(OUTPUT_ROOT, {recursive: true});

  const startedAt = Date.now();

  while (true) {
    try {
      const fd = fs.openSync(LOCK_FILE, "wx");

      fs.writeFileSync(fd, String(process.pid), "utf8");

      return fd;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;

      removeStaleBackupLock();

      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error("백업 캐시 락을 60초 안에 획득하지 못했습니다.");
      }

      sleepSync(50);
    }
  }
}

function releaseBackupLock(fd) {
  try {
    if (fd !== undefined && fd !== null) fs.closeSync(fd);
  } finally {
    fs.rmSync(LOCK_FILE, {force: true});
  }
}

function loadBackupCacheUnlocked() {
  if (!fs.existsSync(CACHE_FILE)) return {};

  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function loadBackupCache() {
  const lock = acquireBackupLock();

  try {
    return loadBackupCacheUnlocked();
  } finally {
    releaseBackupLock(lock);
  }
}

function saveBackupCacheUnlocked(cache) {
  const tempFile = `${CACHE_FILE}.${process.pid}.tmp`;

  fs.mkdirSync(OUTPUT_ROOT, {recursive: true});
  fs.writeFileSync(tempFile, JSON.stringify(cache, null, 2), "utf8");
  fs.rmSync(CACHE_FILE, {force: true});
  fs.renameSync(tempFile, CACHE_FILE);
}

function saveBackupCache(cache) {
  const lock = acquireBackupLock();

  try {
    saveBackupCacheUnlocked(cache);
  } finally {
    releaseBackupLock(lock);
  }
}

function updateBackupCache(update) {
  const lock = acquireBackupLock();

  try {
    const cache = loadBackupCacheUnlocked();
    const result = update(cache);

    saveBackupCacheUnlocked(cache);

    return result;
  } finally {
    releaseBackupLock(lock);
  }
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

  try {
    entries = fs.readdirSync(dir, {withFileTypes: true});
  } catch {
    return result;
  }

  const hasOriginal = entries.some(entry => entry.isFile() && entry.name === "original.html");
  const hasMarkdown = entries.some(entry => entry.isFile() && entry.name === "index.md");

  if (hasOriginal || hasMarkdown) {
    result.set(normalizePath(dir), {
      path: dir,
      complete: hasOriginal && hasMarkdown,
    });

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

    paths.set(normalized, {
      cacheKey,
      entry,
      path: backupDir,
    });
  }

  return {
    paths,
    invalidKeys,
    duplicateKeys,
  };
}

function getActivePostKeys() {
  const tempRoot = path.join(OUTPUT_ROOT, ".tmp");
  const keys = new Set();

  if (!fs.existsSync(tempRoot)) return keys;

  let entries;

  try {
    entries = fs.readdirSync(tempRoot, {withFileTypes: true});
  } catch {
    return keys;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const match = entry.name.match(/^(.+)_(\d+)_(?:\d+_)?\d+$/);

    if (!match) continue;

    keys.add(`${match[1]}/${match[2]}`);
    keys.add(match[2]);
  }

  return keys;
}

function checkBackupCache() {
  const lock = acquireBackupLock();

  try {
    const cache = loadBackupCacheUnlocked();
    const cacheData = collectCachePaths(cache);
    const filePaths = collectBackupDirectories();
    const activePostKeys = getActivePostKeys();
    const duplicatePaths = new Set();

    for (const cacheKey of cacheData.duplicateKeys) {
      const backupDir = getCacheBackupDir(cache[cacheKey]);

      if (backupDir) duplicatePaths.add(normalizePath(backupDir));
    }

    const commonPaths = new Set();

    for (const [normalizedPath] of cacheData.paths) {
      if (duplicatePaths.has(normalizedPath)) continue;
      if (!filePaths.has(normalizedPath)) continue;
      if (!filePaths.get(normalizedPath).complete) continue;

      commonPaths.add(normalizedPath);
    }

    const cacheOnlyKeys = new Set([
      ...cacheData.invalidKeys,
      ...cacheData.duplicateKeys,
    ]);

    for (const [normalizedPath, cacheInfo] of cacheData.paths) {
      if (!commonPaths.has(normalizedPath)) {
        cacheOnlyKeys.add(cacheInfo.cacheKey);
      }
    }

    /*
     * 다른 프로세스가 현재 .tmp에서 생성 중인 게시글은
     * 아직 최종 폴더가 없어도 캐시 정리 대상에서 제외한다.
     */
    for (const cacheKey of activePostKeys) {
      cacheOnlyKeys.delete(cacheKey);
    }

    const fileOnlyPaths = new Set();

    for (const [normalizedPath] of filePaths) {
      if (!commonPaths.has(normalizedPath)) {
        fileOnlyPaths.add(normalizedPath);
      }
    }

    console.log("");
    console.log("백업 캐시를 확인합니다.");
    console.log(
      `캐시: ${Object.keys(cache).length}개 / 백업: ${filePaths.size}개 / 공통: ${commonPaths.size}개 / `
      + `캐시만: ${cacheOnlyKeys.size}개 / 파일만: ${fileOnlyPaths.size}개`
    );

    if (!cacheOnlyKeys.size && !fileOnlyPaths.size) {
      console.log("캐시와 백업이 모두 1:1로 일치합니다.\n");

      return cache;
    }

    for (const cacheKey of cacheOnlyKeys) {
      if (!Object.prototype.hasOwnProperty.call(cache, cacheKey)) continue;

      console.log(`캐시 삭제: ${cacheKey}`);

      delete cache[cacheKey];
    }

    /*
     * 캐시에 없는 실제 백업은 절대로 삭제하지 않는다.
     */
    for (const normalizedPath of fileOnlyPaths) {
      const fileInfo = filePaths.get(normalizedPath);

      if (!fileInfo) continue;

      const relative = path.relative(process.cwd(), fileInfo.path);

      console.log(`캐시 없는 백업 보존: ${relative}`);
    }

    saveBackupCacheUnlocked(cache);

    console.log("캐시 정리 완료\n");

    return cache;
  } finally {
    releaseBackupLock(lock);
  }
}

module.exports = {
  CACHE_FILE,
  setBackupOutputRoot,
  loadBackupCache,
  loadBackupCacheUnlocked,
  saveBackupCache,
  saveBackupCacheUnlocked,
  updateBackupCache,
  checkBackupCache,
  acquireBackupLock,
  releaseBackupLock,
};