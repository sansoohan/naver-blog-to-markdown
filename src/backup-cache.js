const fs = require("fs");
const path = require("path");

const OUTPUT_ROOT = path.resolve(process.cwd(), "output");
const CACHE_FILE = path.join(OUTPUT_ROOT, "backup-cache.json");

/*
 * 현재 처리 중인 게시글.
 *
 * downloader.js는 게시글 구조를 알 필요가 없다.
 * backup-page.js가 HTML 생성 직전에 context를 지정하고,
 * 모든 resource cache 접근은 이 게시글 안에서만 이루어진다.
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

    const relative = path.relative(process.cwd(), fileInfo.path);

    console.log(`캐시 없는 백업 보존: ${relative}`);
  }

  saveBackupCache(cache);

  console.log("캐시 정리 완료\n");

  return cache;
}

/*
 * 게시글별 리소스 캐시
 *
 * 성공:
 *
 *   resources
 *
 * 이미지 / 첨부파일 / CSS / MP4 / poster 등
 * 실제 다운로드되는 모든 파일을 여기서 관리한다.
 *
 * 성공 resource key:
 *
 *   원본 filename + 원격 원본 size
 *
 * 예:
 *
 *   photo.jpg:583921
 *
 *
 * 중요:
 *
 * size는 로컬 저장 파일의 크기가 아니다.
 *
 * HEAD:
 *   Content-Length
 *
 * Range:
 *   Content-Range의 전체 크기
 *
 * GET:
 *   Content-Length
 *   없으면 transform 전 raw response buffer.length
 *
 * 를 사용한다.
 *
 * CSS처럼 다운로드 후 transform되는 파일은
 * 원격 크기와 로컬 크기가 달라질 수 있으므로
 * fs.stat(file).size와 비교하면 안 된다.
 *
 *
 * ETag:
 *
 * 양쪽 모두 존재하면 ETag까지 같아야 cache hit.
 * 한쪽이라도 없으면 filename + size만으로 판단한다.
 *
 *
 * 실패:
 *
 *   resourceErrors
 *
 * 실패 시 filename/size를 알 수 없을 수 있으므로
 * URL을 key로 저장한다.
 *
 * 한 번 실패한 URL은 이후 실행에서
 * HEAD / Range / GET을 전부 하지 않는다.
 *
 *
 * useCache:
 *
 * 기존 cache를 읽어서 재사용할지 여부만 의미한다.
 *
 * 성공/실패 결과 기록은 useCache와 관계없이 항상 한다.
 */

function setResourceContext(cacheKey, outputDir, useCache = false) {
  const key = String(cacheKey || "").trim();

  if (!key) throw new Error("리소스 캐시 게시글 키가 없습니다.");
  if (!outputDir) throw new Error("리소스 캐시 게시글 경로가 없습니다.");

  activeContext = {
    cacheKey: key,
    outputDir: path.resolve(outputDir),
    useCache: Boolean(useCache),
  };
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

function normalizeResourceFilename(value) {
  return String(value || "").trim();
}

function normalizeResourceSize(value) {
  const size = Number(value);
  return Number.isFinite(size) && size > 0 ? Math.trunc(size) : 0;
}

function normalizeEtag(value) {
  return String(value || "").trim();
}

function normalizeResourceUrl(value) {
  return String(value || "").trim();
}

function makeResourceKey(filename, size) {
  const normalizedFilename = normalizeResourceFilename(filename);
  const normalizedSize = normalizeResourceSize(size);

  if (!normalizedFilename || !normalizedSize) return "";

  return `${normalizedFilename}:${normalizedSize}`;
}

function ensurePostCache(cache, cacheKey) {
  if (!cache[cacheKey] || typeof cache[cacheKey] !== "object") cache[cacheKey] = {};

  const entry = cache[cacheKey];

  if (!entry.resources || typeof entry.resources !== "object" || Array.isArray(entry.resources)) {
    entry.resources = {};
  }

  if (
    !entry.resourceErrors
    || typeof entry.resourceErrors !== "object"
    || Array.isArray(entry.resourceErrors)
  ) {
    entry.resourceErrors = {};
  }

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

function getResourceState(metadata) {
  if (!isResourceCacheEnabled()) return null;

  const context = requireResourceContext();
  const filename = normalizeResourceFilename(metadata?.filename);
  const size = normalizeResourceSize(metadata?.size);
  const etag = normalizeEtag(metadata?.etag);
  const key = makeResourceKey(filename, size);

  if (!key) return null;

  const cache = loadBackupCache();
  const entry = cache[context.cacheKey];

  if (!entry || typeof entry !== "object") return null;

  const resources = entry.resources;

  if (!resources || typeof resources !== "object") return null;

  const item = resources[key];

  if (!item || typeof item !== "object") return null;
  if (!item.path) return null;

  const cachedEtag = normalizeEtag(item.etag);

  if (etag && cachedEtag && etag !== cachedEtag) return null;

  const filePath = fromPostRelativePath(item.path);

  /*
   * resource의 size는 원격 원본 크기이므로
   * 로컬 파일의 fs.stat().size와 비교하지 않는다.
   *
   * CSS처럼 다운로드 후 transform되는 리소스는
   * 로컬 크기가 원본 Content-Length와 달라질 수 있다.
   */
  if (!isExistingFile(filePath)) return null;

  return {
    key,
    status: "ok",
    path: filePath,
    storedPath: item.path,
    filename: item.filename || filename,
    size,
    etag: cachedEtag,
    item,
  };
}

function getResource(metadata) {
  const state = getResourceState(metadata);
  return state?.status === "ok" ? state : null;
}

function setResource(metadata, filePath) {
  if (!activeContext) return;

  const context = requireResourceContext();
  const filename = normalizeResourceFilename(metadata?.filename);
  const size = normalizeResourceSize(metadata?.size);
  const etag = normalizeEtag(metadata?.etag);
  const key = makeResourceKey(filename, size);

  if (!key || !filePath) return;

  const cache = loadBackupCache();
  const entry = ensurePostCache(cache, context.cacheKey);

  entry.resources[key] = {
    filename,
    size,
    etag: etag || null,
    path: toPostRelativePath(filePath),
  };

  saveBackupCache(cache);
}

function setResources(metadataList, filePath) {
  if (!activeContext) return;
  if (!Array.isArray(metadataList) || !metadataList.length || !filePath) return;

  const context = requireResourceContext();
  const cache = loadBackupCache();
  const entry = ensurePostCache(cache, context.cacheKey);
  const storedPath = toPostRelativePath(filePath);

  for (const metadata of metadataList) {
    const filename = normalizeResourceFilename(metadata?.filename);
    const size = normalizeResourceSize(metadata?.size);
    const etag = normalizeEtag(metadata?.etag);
    const key = makeResourceKey(filename, size);

    if (!key) continue;

    entry.resources[key] = {
      filename,
      size,
      etag: etag || null,
      path: storedPath,
    };
  }

  saveBackupCache(cache);
}

function getResourceError(url) {
  if (!isResourceCacheEnabled()) return null;

  const context = requireResourceContext();
  const source = normalizeResourceUrl(url);

  if (!source) return null;

  const cache = loadBackupCache();
  const entry = cache[context.cacheKey];

  if (!entry || typeof entry !== "object") return null;

  const errors = entry.resourceErrors;

  if (!errors || typeof errors !== "object") return null;

  const item = errors[source];

  if (!item || typeof item !== "object") return null;

  return {
    status: "error",
    url: source,
    error: String(item.error || "다운로드 실패"),
    failedAt: item.failedAt || "",
    item,
  };
}

function setResourceError(url, error) {
  if (!activeContext) return;

  const context = requireResourceContext();
  const source = normalizeResourceUrl(url);

  if (!source) return;

  const cache = loadBackupCache();
  const entry = ensurePostCache(cache, context.cacheKey);

  entry.resourceErrors[source] = {
    error: String(error?.message || error || "다운로드 실패"),
    failedAt: new Date().toISOString(),
  };

  saveBackupCache(cache);
}

function setResourcesError(urls, error) {
  if (!activeContext) return;
  if (!Array.isArray(urls) || !urls.length) return;

  const context = requireResourceContext();
  const cache = loadBackupCache();
  const entry = ensurePostCache(cache, context.cacheKey);
  const failedAt = new Date().toISOString();
  const message = String(error?.message || error || "다운로드 실패");

  for (const url of urls) {
    const source = normalizeResourceUrl(url);

    if (!source) continue;

    entry.resourceErrors[source] = {
      error: message,
      failedAt,
    };
  }

  saveBackupCache(cache);
}

function clearResourceError(url) {
  if (!activeContext) return;

  const context = requireResourceContext();
  const source = normalizeResourceUrl(url);

  if (!source) return;

  const cache = loadBackupCache();
  const entry = cache[context.cacheKey];

  if (!entry || typeof entry !== "object") return;
  if (!entry.resourceErrors || typeof entry.resourceErrors !== "object") return;
  if (!Object.prototype.hasOwnProperty.call(entry.resourceErrors, source)) return;

  delete entry.resourceErrors[source];

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

      if (sourceStat.isFile() && destinationStat.isFile() && sourceStat.size === destinationStat.size) {
        return filename;
      }
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
 * 리소스 경로는 게시글 폴더 기준 상대경로이므로
 * 게시글 폴더가 이동해도 resources 수정이 필요 없다.
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

  getResourceError,
  setResourceError,
  setResourcesError,
  clearResourceError,

  copyCachedFile,
  relocateResourcePaths,
};