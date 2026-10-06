const fs = require("fs");
const path = require("path");

const {
  setResource,
  copyCachedFile,
} = require("../cache-resource");

const {
  isNetworkError,
  withConnectionRetry,
} = require("../network");

function normalizeUrl(url) {
  const source = String(url || "").trim().replace(/&amp;/g, "&");
  if (source.startsWith("//")) return `https:${source}`;
  return source;
}

function safeFilename(value, fallback = "download") {
  let filename;

  try {
    filename = decodeURIComponent(String(value));
  } catch {
    filename = String(value);
  }

  filename = filename
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();

  return filename || fallback;
}

function getFilenameFromUrl(url, fallback = "download") {
  try {
    const filename = path.posix.basename(new URL(url).pathname);
    return safeFilename(filename, fallback);
  } catch {
    return fallback;
  }
}

function getFilenameFromDisposition(value) {
  const source = String(value || "").trim();

  if (!source) return "";

  const utf8 = source.match(/filename\*=UTF-8''([^;]+)/i);

  if (utf8) {
    try {
      return safeFilename(decodeURIComponent(utf8[1]), "");
    } catch {}
  }

  const normal = source.match(/filename="?([^";]+)"?/i);

  if (!normal) return "";

  return safeFilename(normal[1], "");
}

function getUniqueFilename(outputDir, filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let result = filename;
  let index = 2;

  while (fs.existsSync(path.join(outputDir, result))) {
    result = `${base}.__dup${index}__${ext}`;
    index++;
  }

  return result;
}

function getExactDestination(outputDir, filename) {
  fs.mkdirSync(outputDir, {recursive: true});
  return path.resolve(outputDir, filename);
}

function getDestination(outputDir, filename, overwrite = false) {
  fs.mkdirSync(outputDir, {recursive: true});

  if (overwrite) return getExactDestination(outputDir, filename);

  return path.resolve(outputDir, getUniqueFilename(outputDir, filename));
}

function getRequestSignal(options = {}) {
  if (options.signal) return options.signal;
  if (options.timeout > 0) return AbortSignal.timeout(options.timeout);
  return undefined;
}

function getHeaderSize(response) {
  const value = response.headers.get("content-length");

  if (!value) return 0;

  const size = Number(value);

  return Number.isFinite(size) && size > 0 ? Math.trunc(size) : 0;
}

function getOriginalFilename(url, response, options = {}) {
  const disposition = response?.headers?.get("content-disposition") || "";
  const dispositionFilename = getFilenameFromDisposition(disposition);

  if (dispositionFilename) return dispositionFilename;

  /*
   * CSS처럼 호출부에서 filename을 명시한 경우에는
   * 그것을 원본 리소스 이름으로 사용한다.
   */
  if (options.filename) {
    return safeFilename(options.filename, options.fallbackFilename || "download");
  }

  return getFilenameFromUrl(response?.url || url, options.fallbackFilename || "download");
}

function getResourceMetadata(url, response, options = {}) {
  const size = getHeaderSize(response);

  if (!size) return null;

  const filename = getOriginalFilename(url, response, options);

  if (!filename) return null;

  return {
    filename,
    size,
  };
}

function copyCachedResource(cached, url, options = {}) {
  const {
    outputDir = "",
    filename = "",
    fallbackFilename = "download",
    overwrite = false,
  } = options;

  const cachedPath = cached.path;

  if (!outputDir) {
    return {
      status: "cached",
      cached: true,
      path: cachedPath,
      filename: path.basename(cachedPath),
      url,
      response: null,
      resource: {
        filename: cached.filename,
        size: cached.size,
      },
    };
  }

  fs.mkdirSync(outputDir, {recursive: true});

  const preferredName = safeFilename(filename || path.basename(cachedPath) || fallbackFilename, fallbackFilename);
  let destination;
  let finalFilename;

  /*
   * CSS처럼 파일명이 고정되어야 하는 리소스는 overwrite=true를 사용한다.
   */
  if (overwrite && filename) {
    destination = getExactDestination(outputDir, preferredName);
    finalFilename = preferredName;

    if (path.resolve(cachedPath) !== destination) {
      fs.copyFileSync(cachedPath, destination);
    }
  } else {
    finalFilename = copyCachedFile(cachedPath, outputDir, preferredName);

    if (!finalFilename) {
      throw new Error(`캐시 파일 재사용 실패: ${cachedPath}`);
    }

    destination = path.resolve(outputDir, finalFilename);
  }

  /*
   * --update에서는 기존 게시글 폴더에서 임시 폴더로
   * 캐시 파일이 복사될 수 있다.
   *
   * 따라서 재사용 후 현재 파일 위치로 path를 갱신한다.
   */
  setResource({
    filename: cached.filename,
    size: cached.size,
  }, destination);

  return {
    status: "cached",
    cached: true,
    path: destination,
    filename: finalFilename,
    url,
    response: null,
    resource: {
      filename: cached.filename,
      size: cached.size,
    },
  };
}

async function fetchResourceMetadata(url, options = {}) {
  const {
    headers = {},
    redirect = "follow",
  } = options;

  return withConnectionRetry(async () => {
    const fetchOptions = {
      method: "HEAD",
      headers,
      redirect,
      signal: AbortSignal.timeout(500),
    };

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      throw new Error(`HEAD HTTP ${response.status}`);
    }

    return {
      response,
      metadata: getResourceMetadata(url, response, options),
    };
  });
}

async function fetchResource(url, options = {}) {
  const {
    headers = {},
    redirect = "follow",
  } = options;

  return withConnectionRetry(async () => {
    const fetchOptions = {
      headers,
      redirect,
    };

    let controller = null;
    let timeoutId = null;

    if (options.signal) {
      fetchOptions.signal = options.signal;
    } else if (options.timeout > 0) {
      controller = new AbortController();
      fetchOptions.signal = controller.signal;
      timeoutId = setTimeout(() => controller.abort(), options.timeout);
    }

    try {
      const response = await fetch(url, fetchOptions);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return {
        response,
      };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  });
}

async function prepareBuffer(buffer, response, url, options = {}) {
  const {
    validate = null,
    transform = null,
  } = options;

  if (validate) {
    await validate(buffer, {
      response,
      contentType: response.headers.get("content-type") || "",
      url,
    });
  }

  if (!transform) return buffer;

  const transformed = await transform(buffer, {
    response,
    contentType: response.headers.get("content-type") || "",
    url,
  });

  if (Buffer.isBuffer(transformed)) return transformed;
  if (transformed instanceof Uint8Array) return Buffer.from(transformed);

  return Buffer.from(String(transformed), "utf8");
}

async function resolveDownloadFilename(url, response, buffer, options = {}) {
  const {
    filename = "",
    fallbackFilename = "download",
    resolveFilename = null,
  } = options;

  let result = filename;

  if (resolveFilename) {
    result = await resolveFilename({
      url,
      response,
      buffer,
      contentType: response.headers.get("content-type") || "",
    });
  }

  if (!result) {
    result = getFilenameFromUrl(response.url || url, fallbackFilename);
  }

  return safeFilename(result, fallbackFilename);
}

async function fetchNaverVideoInfo(vid, inKey) {
  const params = new URLSearchParams({
    key: String(inKey || ""),
    sid: "2",
    nonce: String(Date.now()),
    devt: "html5_pc",
  });

  const url = `https://apis.naver.com/rmcnmv/rmcnmv/vod/play/v2.0/${encodeURIComponent(vid)}?${params}`;

  return withConnectionRetry(async () => {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: "https://blog.naver.com/",
        Accept: "application/json, text/plain, */*",
      },
    });

    if (!response.ok) {
      throw new Error(`Naver VOD API 실패: HTTP ${response.status}`);
    }

    return response.json();
  });
}

function findBestMp4(data) {
  const videos = data?.videos?.list;

  if (!Array.isArray(videos) || !videos.length) {
    return "";
  }

  const results = videos
    .filter(video => typeof video.source === "string" && /^https?:\/\//i.test(video.source))
    .map(video => ({
      src: normalizeUrl(video.source.replace(/∈/g, "&")),
      size: Number(video.size || 0),
      width: Number(video.encodingOption?.width || video.width || 0),
      height: Number(video.encodingOption?.height || video.height || 0),
      bitrate: Number(video.bitrate?.video || video.bitrate || 0),
    }));

  results.sort((a, b) => {
    const resolutionDiff = (b.width * b.height) - (a.width * a.height);

    if (resolutionDiff !== 0) return resolutionDiff;
    if (b.bitrate !== a.bitrate) return b.bitrate - a.bitrate;

    return b.size - a.size;
  });

  return results[0]?.src || "";
}

function findPoster(data) {
  const candidates = [
    data?.meta?.cover?.source,
    data?.meta?.cover?.url,
    data?.thumbnail,
    data?.poster,
  ];

  for (const candidate of candidates) {
    if (
      typeof candidate === "string"
      && /^https?:\/\//i.test(candidate)
    ) {
      return normalizeUrl(candidate);
    }
  }

  let result = "";

  function walk(value) {
    if (result || !value) return;

    if (Array.isArray(value)) {
      for (const child of value) {
        walk(child);

        if (result) return;
      }

      return;
    }

    if (typeof value !== "object") return;

    for (const [key, child] of Object.entries(value)) {
      if (
        typeof child === "string"
        && /^https?:\/\//i.test(child)
        && /thumbnail|poster|cover/i.test(key)
        && /\.(?:jpg|jpeg|png|webp)(?:\?|$)/i.test(child)
      ) {
        result = normalizeUrl(child);
        return;
      }

      walk(child);

      if (result) return;
    }
  }

  walk(data);

  return result;
}

async function resolveNaverVideo(candidates) {
  let lastError = null;

  for (const metadata of candidates || []) {
    const vid = String(metadata?.vid || "").trim();
    const inKey = String(metadata?.inKey || "").trim();

    if (!vid || !inKey) continue;

    try {
      console.log(`Naver 동영상 확인: ${vid}`);

      const info = await fetchNaverVideoInfo(vid, inKey);
      const videoUrl = findBestMp4(info);

      if (!videoUrl) {
        lastError = new Error("MP4 URL을 찾지 못함");
        continue;
      }

      return {
        metadata,
        info,
        videoUrl,
        posterUrl: findPoster(info) || normalizeUrl(metadata.thumbnail),
      };
    } catch (error) {
      if (isNetworkError(error)) {
        throw error;
      }

      lastError = error;
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error("사용 가능한 Naver 동영상 메타데이터가 없습니다.");
}

module.exports = {
  normalizeUrl,
  safeFilename,
  getFilenameFromUrl,
  getUniqueFilename,
  getDestination,
  getHeaderSize,
  getOriginalFilename,
  getResourceMetadata,
  copyCachedResource,
  fetchResourceMetadata,
  fetchResource,
  prepareBuffer,
  resolveDownloadFilename,
  resolveNaverVideo,
};