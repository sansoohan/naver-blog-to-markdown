const fs = require("fs");
const path = require("path");

const OUTPUT_ROOT = path.resolve(process.cwd(), "output");
const CACHE_FILE = path.join(OUTPUT_ROOT, "backup-cache.json");

/*
 * 현재 처리 중인 게시글.
 *
 * downloader.js는 게시글 구조를 알 필요가 없다.
 * backup-page.js가 HTML 생성 직전에 context를 지정하고,
 * 모든 resource/video cache 접근은 이 게시글 안에서만 이루어진다.
 */
let activeContext = null;

function loadBackupCache() {
  if (!fs.existsSync(CACHE_FILE)) return {};

  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveBackupCache(cache) {
  const tempFile = `${CACHE_FILE}.tmp`;

  fs.mkdirSync(OUTPUT_ROOT, {recursive: true});
  fs.writeFileSync(tempFile, JSON.stringify(cache, null, 2), "utf8");
  fs.rmSync(CACHE_FILE, {force: true});
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

  try {
    entries = fs.readdirSync(dir, {withFileTypes: true});
  } catch {
    return result;
  }

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

    try {
      entries = fs.readdirSync(currentDir);
    } catch {
      break;
    }

    if (entries.length) break;

    try {
      fs.rmdirSync(currentDir);
    } catch {
      break;
    }

    currentDir = path.dirname(currentDir);
  }
}

function checkBackupCache() {
  const cache = loadBackupCache();
  const cacheData = collectCachePaths(cache);
  const filePaths = collectBackupDirectories();
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

  const cacheOnlyKeys = new Set([...cacheData.invalidKeys, ...cacheData.duplicateKeys]);

  for (const [normalizedPath, cacheInfo] of cacheData.paths) {
    if (!commonPaths.has(normalizedPath)) cacheOnlyKeys.add(cacheInfo.cacheKey);
  }

  const fileOnlyPaths = new Set();

  for (const [normalizedPath] of filePaths) {
    if (!commonPaths.has(normalizedPath)) fileOnlyPaths.add(normalizedPath);
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

/*
 * 게시글별 리소스 캐시
 *
 * backup-cache.json:
 *
 * {
 *   "blogId/logNo": {
 *     ...
 *     "resources": {
 *       "URL": {
 *         "status": "ok",
 *         "path": "image.png"
 *       }
 *     },
 *     "videos": {
 *       "vid": {
 *         "status": "ok",
 *         "video": "video.mp4",
 *         "poster": "poster.jpg"
 *       }
 *     }
 *   }
 * }
 *
 * path/video/poster는 게시글 폴더 기준 상대경로다.
 */

function setResourceContext(cacheKey, outputDir, useCache = false) {
  const key = String(cacheKey || "").trim();

  if (!key) throw new Error("리소스 캐시 게시글 키가 없습니다.");
  if (!outputDir) throw new Error("리소스 캐시 게시글 경로가 없습니다.");

  activeContext = {cacheKey: key, outputDir: path.resolve(outputDir), useCache: Boolean(useCache)};
}

function clearResourceContext() {
  activeContext = null;
}

function getResourceContext() {
  return activeContext ? {...activeContext} : null;
}

function requireResourceContext() {
  if (!activeContext) throw new Error("리소스 캐시 게시글 context가 설정되지 않았습니다.");
  return activeContext;
}

function isResourceCacheEnabled() {
  return Boolean(activeContext?.useCache);
}

function normalizeResourceKey(value) {
  return String(value || "").trim().replace(/&amp;/g, "&");
}

function ensurePostCache(cache, cacheKey) {
  if (!cache[cacheKey] || typeof cache[cacheKey] !== "object") cache[cacheKey] = {};

  const entry = cache[cacheKey];

  if (!entry.resources || typeof entry.resources !== "object" || Array.isArray(entry.resources)) entry.resources = {};
  if (!entry.videos || typeof entry.videos !== "object" || Array.isArray(entry.videos)) entry.videos = {};

  return entry;
}

function isExistingFile(filePath) {
  if (!filePath) return false;

  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isInsideDirectory(filePath, directory) {
  const relative = path.relative(path.resolve(directory), path.resolve(filePath));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function toPostRelativePath(filePath) {
  const context = requireResourceContext();
  const absolute = path.resolve(filePath);

  if (normalizePath(absolute) === normalizePath(context.outputDir)) return "";

  if (!isInsideDirectory(absolute, context.outputDir)) {
    throw new Error(`게시글 폴더 밖의 리소스는 캐시할 수 없습니다: ${absolute}`);
  }

  return path.relative(context.outputDir, absolute);
}

function fromPostRelativePath(storedPath) {
  const context = requireResourceContext();
  return path.resolve(context.outputDir, String(storedPath || ""));
}

function getResourceState(url) {
  if (!isResourceCacheEnabled()) return null;

  const context = requireResourceContext();
  const key = normalizeResourceKey(url);

  if (!key) return null;

  const cache = loadBackupCache();
  const entry = cache[context.cacheKey];

  if (!entry || typeof entry !== "object") return null;

  const resources = entry.resources;

  if (!resources || typeof resources !== "object") return null;

  const item = resources[key];

  if (!item) return null;

  if (item.status === "error") {
    return {
      key,
      status: "error",
      error: String(item.error || "다운로드 실패"),
      failedAt: item.failedAt || "",
      item,
    };
  }

  if (!item.path) return null;

  const filePath = fromPostRelativePath(item.path);

  if (!isExistingFile(filePath)) return null;

  return {
    key,
    status: "ok",
    path: filePath,
    storedPath: item.path,
    updatedAt: item.updatedAt || "",
    item,
  };
}

function getResource(url) {
  const state = getResourceState(url);
  return state?.status === "ok" ? state : null;
}

function setResource(url, filePath) {
  if (!isResourceCacheEnabled()) return;

  const context = requireResourceContext();
  const key = normalizeResourceKey(url);

  if (!key || !filePath) return;

  const cache = loadBackupCache();
  const entry = ensurePostCache(cache, context.cacheKey);

  entry.resources[key] = {
    status: "ok",
    path: toPostRelativePath(filePath),
    updatedAt: new Date().toISOString(),
  };

  saveBackupCache(cache);
}

function setResources(urls, filePath) {
  if (!isResourceCacheEnabled()) return;

  const context = requireResourceContext();
  const keys = [...new Set((urls || []).map(normalizeResourceKey).filter(Boolean))];

  if (!keys.length || !filePath) return;

  const cache = loadBackupCache();
  const entry = ensurePostCache(cache, context.cacheKey);
  const storedPath = toPostRelativePath(filePath);
  const updatedAt = new Date().toISOString();

  for (const key of keys) {
    entry.resources[key] = {status: "ok", path: storedPath, updatedAt};
  }

  saveBackupCache(cache);
}

function setResourceError(url, error) {
  if (!isResourceCacheEnabled()) return;

  const context = requireResourceContext();
  const key = normalizeResourceKey(url);

  if (!key) return;

  const cache = loadBackupCache();
  const entry = ensurePostCache(cache, context.cacheKey);

  entry.resources[key] = {
    status: "error",
    error: String(error?.message || error || "다운로드 실패"),
    failedAt: new Date().toISOString(),
  };

  saveBackupCache(cache);
}

function setResourcesError(urls, error) {
  if (!isResourceCacheEnabled()) return;

  const context = requireResourceContext();
  const keys = [...new Set((urls || []).map(normalizeResourceKey).filter(Boolean))];

  if (!keys.length) return;

  const cache = loadBackupCache();
  const entry = ensurePostCache(cache, context.cacheKey);
  const message = String(error?.message || error || "다운로드 실패");
  const failedAt = new Date().toISOString();

  for (const key of keys) {
    entry.resources[key] = {status: "error", error: message, failedAt};
  }

  saveBackupCache(cache);
}

function getVideoState(vid) {
  if (!isResourceCacheEnabled()) return null;

  const context = requireResourceContext();
  const key = String(vid || "").trim();

  if (!key) return null;

  const cache = loadBackupCache();
  const entry = cache[context.cacheKey];

  if (!entry || typeof entry !== "object") return null;

  const videos = entry.videos;

  if (!videos || typeof videos !== "object") return null;

  const item = videos[key];

  if (!item) return null;

  if (item.status === "error") {
    return {
      vid: key,
      status: "error",
      error: String(item.error || "다운로드 실패"),
      failedAt: item.failedAt || "",
      item,
    };
  }

  if (!item.video) return null;

  const videoPath = fromPostRelativePath(item.video);

  if (!isExistingFile(videoPath)) return null;

  let posterPath = "";

  if (item.poster) {
    const candidate = fromPostRelativePath(item.poster);
    if (isExistingFile(candidate)) posterPath = candidate;
  }

  return {
    vid: key,
    status: "ok",
    videoPath,
    posterPath,
    updatedAt: item.updatedAt || "",
    item,
  };
}

function getVideo(vid) {
  const state = getVideoState(vid);
  return state?.status === "ok" ? state : null;
}

function setVideo(vid, videoPath, posterPath = "") {
  if (!isResourceCacheEnabled()) return;

  const context = requireResourceContext();
  const key = String(vid || "").trim();

  if (!key || !videoPath) return;

  const cache = loadBackupCache();
  const entry = ensurePostCache(cache, context.cacheKey);

  entry.videos[key] = {
    status: "ok",
    video: toPostRelativePath(videoPath),
    poster: posterPath ? toPostRelativePath(posterPath) : "",
    updatedAt: new Date().toISOString(),
  };

  saveBackupCache(cache);
}

function setVideoError(vid, error) {
  if (!isResourceCacheEnabled()) return;

  const context = requireResourceContext();
  const key = String(vid || "").trim();

  if (!key) return;

  const cache = loadBackupCache();
  const entry = ensurePostCache(cache, context.cacheKey);

  entry.videos[key] = {
    status: "error",
    error: String(error?.message || error || "다운로드 실패"),
    failedAt: new Date().toISOString(),
  };

  saveBackupCache(cache);
}

function copyCachedFile(sourcePath, destinationDir, preferredName = "") {
  if (!isExistingFile(sourcePath)) return "";

  fs.mkdirSync(destinationDir, {recursive: true});

  const filename = preferredName || path.basename(sourcePath);
  let destinationPath = path.join(destinationDir, filename);

  if (normalizePath(sourcePath) === normalizePath(destinationPath)) return filename;

  if (fs.existsSync(destinationPath)) {
    try {
      const sourceStat = fs.statSync(sourcePath);
      const destinationStat = fs.statSync(destinationPath);

      if (sourceStat.isFile() && destinationStat.isFile() && sourceStat.size === destinationStat.size) return filename;
    } catch {}

    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    let index = 2;

    do {
      destinationPath = path.join(destinationDir, `${base}_${index}${ext}`);
      index++;
    } while (fs.existsSync(destinationPath));
  }

  fs.copyFileSync(sourcePath, destinationPath);

  return path.basename(destinationPath);
}

/*
 * 이제 리소스 경로는 게시글 폴더 기준 상대경로이므로
 * 게시글 폴더가 이동해도 resources/videos 수정이 필요 없다.
 *
 * 기존 호출부 호환을 위해 함수는 남겨둔다.
 */
function relocateResourcePaths() {}

module.exports = {
  CACHE_FILE,
  loadBackupCache,
  saveBackupCache,
  checkBackupCache,

  setResourceContext,
  clearResourceContext,
  getResourceContext,

  getResourceState,
  getResource,
  setResource,
  setResources,
  setResourceError,
  setResourcesError,

  getVideoState,
  getVideo,
  setVideo,
  setVideoError,

  copyCachedFile,
  relocateResourcePaths,
};
