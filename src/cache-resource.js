const fs = require("fs");
const path = require("path");
const {
  loadBackupCache,
  updateBackupCache,
} = require("./cache-html");

function normalizePath(value) {
  const normalized = path.resolve(value);

  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

/*
 * 현재 처리 중인 게시글.
 *
 * downloader.js는 게시글 구조를 알 필요가 없다.
 * backup-page.js가 HTML 생성 직전에 context를 지정하고,
 * 모든 resource cache 접근은 이 게시글 안에서만 이루어진다.
 */
let activeContext = null;

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
    usedResourceKeys: new Set(),
  };
}

function markResourceUsed(key) {
  if (!activeContext || !key) return;

  activeContext.usedResourceKeys.add(key);
}

function finalizeResources(resources) {
  const context = requireResourceContext();
  const usedResourceKeys = context.usedResourceKeys;
  const result = {};

  if (!resources || typeof resources !== "object") {
    return result;
  }

  for (const [key, item] of Object.entries(resources)) {
    if (usedResourceKeys.has(key)) {
      result[key] = item;
      continue;
    }

    if (!item || typeof item !== "object" || !item.path) continue;

    const filePath = fromPostRelativePath(item.path);

    if (!isExistingFile(filePath)) continue;

    const usedByAnotherResource = Object.entries(resources).some(([otherKey, otherItem]) => {
      if (!usedResourceKeys.has(otherKey)) return false;
      if (!otherItem || typeof otherItem !== "object" || !otherItem.path) return false;

      return normalizePath(fromPostRelativePath(otherItem.path)) === normalizePath(filePath);
    });

    if (!usedByAnotherResource) {
      fs.rmSync(filePath, {force: true});
    }
  }

  return result;
}

function clearResourceContext() {
  activeContext = null;
}

function getResourceContext() {
  return activeContext ? {...activeContext} : null;
}

function requireResourceContext() {
  if (!activeContext) {
    throw new Error("리소스 캐시 게시글 context가 설정되지 않았습니다.");
  }

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
  if (!cache[cacheKey] || typeof cache[cacheKey] !== "object") {
    cache[cacheKey] = {};
  }

  const entry = cache[cacheKey];

  if (
    !entry.resources
    || typeof entry.resources !== "object"
    || Array.isArray(entry.resources)
  ) {
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
  const relative = path.relative(
    path.resolve(directory),
    path.resolve(filePath)
  );

  return (
    relative !== ""
    && !relative.startsWith("..")
    && !path.isAbsolute(relative)
  );
}

function toPostRelativePath(filePath) {
  const context = requireResourceContext();
  const absolute = path.resolve(filePath);

  if (normalizePath(absolute) === normalizePath(context.outputDir)) {
    return "";
  }

  if (!isInsideDirectory(absolute, context.outputDir)) {
    throw new Error(
      `게시글 폴더 밖의 리소스는 캐시할 수 없습니다: ${absolute}`
    );
  }

  return path.relative(context.outputDir, absolute);
}

function fromPostRelativePath(storedPath) {
  const context = requireResourceContext();

  return path.resolve(
    context.outputDir,
    String(storedPath || "")
  );
}

function getResourceState(metadata) {
  if (!isResourceCacheEnabled()) return null;

  const context = requireResourceContext();
  const filename = normalizeResourceFilename(metadata?.filename);
  const size = normalizeResourceSize(metadata?.size);
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

  const filePath = fromPostRelativePath(item.path);

  /*
   * resource의 size는 원격 원본 크기이므로
   * 로컬 파일의 fs.stat().size와 비교하지 않는다.
   *
   * CSS처럼 다운로드 후 transform되는 리소스는
   * 로컬 크기가 원본 Content-Length와 달라질 수 있다.
   */
  if (!isExistingFile(filePath)) return null;

  markResourceUsed(key);

  return {
    key,
    status: "ok",
    path: filePath,
    storedPath: item.path,
    filename: item.filename || filename,
    size,
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
  const key = makeResourceKey(filename, size);

  if (!key || !filePath) return;

  const storedPath = toPostRelativePath(filePath);

  markResourceUsed(key);

  updateBackupCache(cache => {
    const entry = ensurePostCache(cache, context.cacheKey);

    entry.resources[key] = {
      filename,
      size,
      path: storedPath,
    };
  });
}

function setResources(metadataList, filePath) {
  if (!activeContext) return;
  if (!Array.isArray(metadataList) || !metadataList.length || !filePath) return;

  const context = requireResourceContext();
  const storedPath = toPostRelativePath(filePath);

  updateBackupCache(cache => {
    const entry = ensurePostCache(cache, context.cacheKey);

    for (const metadata of metadataList) {
      const filename = normalizeResourceFilename(metadata?.filename);
      const size = normalizeResourceSize(metadata?.size);
      const key = makeResourceKey(filename, size);

      if (!key) continue;

      markResourceUsed(key);

      entry.resources[key] = {
        filename,
        size,
        path: storedPath,
      };
    }
  });
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

  updateBackupCache(cache => {
    const entry = ensurePostCache(cache, context.cacheKey);

    entry.resourceErrors[source] = {
      error: String(error?.message || error || "다운로드 실패"),
      failedAt: new Date().toISOString(),
    };
  });
}

function setResourcesError(urls, error) {
  if (!activeContext) return;
  if (!Array.isArray(urls) || !urls.length) return;

  const context = requireResourceContext();
  const failedAt = new Date().toISOString();
  const message = String(error?.message || error || "다운로드 실패");

  updateBackupCache(cache => {
    const entry = ensurePostCache(cache, context.cacheKey);

    for (const url of urls) {
      const source = normalizeResourceUrl(url);

      if (!source) continue;

      entry.resourceErrors[source] = {
        error: message,
        failedAt,
      };
    }
  });
}

function clearResourceError(url) {
  if (!activeContext) return;

  const context = requireResourceContext();
  const source = normalizeResourceUrl(url);

  if (!source) return;

  updateBackupCache(cache => {
    const entry = cache[context.cacheKey];

    if (!entry || typeof entry !== "object") return;
    if (!entry.resourceErrors || typeof entry.resourceErrors !== "object") return;
    if (!Object.prototype.hasOwnProperty.call(entry.resourceErrors, source)) return;

    delete entry.resourceErrors[source];
  });
}

function copyCachedFile(sourcePath, destinationDir, preferredName = "") {
  if (!isExistingFile(sourcePath)) return "";

  fs.mkdirSync(destinationDir, {recursive: true});

  const filename = preferredName || path.basename(sourcePath);
  let destinationPath = path.join(destinationDir, filename);

  if (normalizePath(sourcePath) === normalizePath(destinationPath)) {
    return filename;
  }

  if (fs.existsSync(destinationPath)) {
    try {
      const sourceStat = fs.statSync(sourcePath);
      const destinationStat = fs.statSync(destinationPath);

      if (
        sourceStat.isFile()
        && destinationStat.isFile()
        && sourceStat.size === destinationStat.size
      ) {
        return filename;
      }
    } catch {}

    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    let index = 2;

    do {
      destinationPath = path.join(
        destinationDir,
        `${base}_${index}${ext}`
      );

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
  setResourceContext,
  clearResourceContext,
  getResourceContext,
  finalizeResources,

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