const fs = require("fs");
const path = require("path");

const {
  getResourceState,
  setResource,
  getResourceError,
  setResourceError,
  clearResourceError,
  copyCachedFile,
} = require("./cache-resource");

const {
  isNetworkError,
  withConnectionRetry,
} = require("./network");

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
    };

    const signal = getRequestSignal(options);

    if (signal) fetchOptions.signal = signal;

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

    const signal = getRequestSignal(options);

    if (signal) fetchOptions.signal = signal;

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (!buffer.length) {
      throw new Error("빈 응답");
    }

    return {
      buffer,
      response,
    };
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

async function download(url, options = {}) {
  const defaultOptions = {
    outputDir: "",
    logLabel: "파일",
    overwrite: false,
    retries: 1,
    timeout: 10000,
  };

  const requestOptions = {
    ...defaultOptions,
    ...options,
  };

  const {
    outputDir,
    logLabel,
    overwrite,
    retries,
  } = requestOptions;

  const source = normalizeUrl(url);

  if (!source) {
    throw new Error("다운로드 URL이 없습니다.");
  }

  /*
   * 이전 실행에서 이 URL 자체가 실패했다면
   * HEAD/GET을 포함한 모든 네트워크 요청을 생략한다.
   *
   * 실패 cache만 URL 기반인 이유:
   *
   * 다운로드에 실패한 경우에는 원본 filename이나
   * Content-Length를 얻지 못했을 수 있기 때문이다.
   */
  const previousError = getResourceError(source);

  if (previousError?.status === "error") {
    throw new Error(
      `이전 다운로드 실패로 재시도 안 함: ${source}`
      + `${previousError.error ? ` - ${previousError.error}` : ""}`
    );
  }

  /*
   * GET 전에 HEAD를 보내 원격 리소스 metadata를 확인한다.
   *
   * HEAD
   *   ↓
   * filename + Content-Length
   *   ↓
   * resources cache 확인
   *   ↓
   * hit이면 GET 없이 기존 파일 재사용
   *
   * HEAD 자체가 실패하거나 Content-Length가 없는 것은
   * 실제 파일 다운로드 실패로 간주하지 않는다.
   *
   * 일부 서버는 HEAD만 지원하지 않을 수도 있기 때문이다.
   * 이 경우 그냥 정상 GET으로 넘어간다.
   */
  let headMetadata = null;

  try {
    const head = await fetchResourceMetadata(source, requestOptions);
    headMetadata = head.metadata;
  } catch (error) {
    /*
    * HEAD 자체를 지원하지 않거나 HTTP 오류가 발생한 경우에는
    * 실제 GET이 성공할 수 있으므로 정상적으로 GET을 시도한다.
    *
    * 반면 HEAD가 timeout된 경우에는 같은 서버에 GET을 다시 보내도
    * 동일하게 timeout될 가능성이 높으므로 해당 URL을 즉시 실패 처리한다.
    */
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      throw error;
    }
  }

  if (headMetadata) {
    const cached = getResourceState(headMetadata);

    if (cached?.status === "ok") {
      const result = copyCachedResource(cached, source, requestOptions);

      console.log(`${logLabel} 캐시 재사용: ${result.filename}`);

      return result;
    }
  }

  let fetched = null;
  let fetchError = null;
  const retryCount = Math.max(0, Number(retries) || 0);

  /*
   * 실제 GET이 실패한 경우에만 resourceErrors에 기록한다.
   *
   * retries=0
   *   최초 1회
   *
   * retries=1
   *   최초 1회 + 재시도 1회
   */
  for (let attempt = 0; attempt <= retryCount; attempt++) {
    try {
      fetched = await fetchResource(source, requestOptions);
      fetchError = null;
      break;
    } catch (error) {
      fetchError = error;
    }
  }

  /*
   * 병신같은 ChatGPT 이부분에서 기능누락 했으니 조심
   *
   * connection error는 resourceErrors에 절대 저장하지 않는다.
   * 연결이 복구될 때까지 기다린 뒤 같은 요청을 다시 시도해야 한다.
   */
  if (!fetched) {
    if (!isNetworkError(fetchError)) {
      setResourceError(source, fetchError);
    }

    throw fetchError;
  }

  /*
   * GET 자체는 성공했으므로 과거 실패 기록이 존재한다면 제거한다.
   *
   * 일반적으로 위에서 실패 cache가 발견되면 GET을 하지 않기 때문에
   * 여기까지 오는 경우는 거의 없지만,
   * cache 정책이 바뀌거나 수동으로 일부 cache를 수정한 경우에도
   * 상태가 일관되도록 해둔다.
   */
  clearResourceError(source);

  /*
   * 반드시 transform 전에 원격 서버가 알려준 원본 크기를 보관한다.
   *
   * CSS처럼 transform되는 리소스는 이후 buffer.length가 바뀔 수 있으므로
   * 변환된 buffer 크기를 resource size로 사용하면 안 된다.
   */
  const remoteSize = getHeaderSize(fetched.response);

  let buffer;

  try {
    buffer = await prepareBuffer(
      fetched.buffer,
      fetched.response,
      source,
      requestOptions
    );
  } catch (error) {
    /*
     * GET은 성공했어도 validation/transform에 실패했다면
     * 이 URL로부터 정상적인 로컬 리소스를 만들지 못한 것이므로
     * 실패 cache에 기록한다.
     */
    setResourceError(source, error);
    throw error;
  }

  const resolvedFilename = await resolveDownloadFilename(
    source,
    fetched.response,
    buffer,
    requestOptions
  );

  if (!outputDir) {
    throw new Error(`${logLabel} outputDir이 없습니다.`);
  }

  const destination = getDestination(
    outputDir,
    resolvedFilename,
    overwrite
  );

  try {
    fs.writeFileSync(destination, buffer);
  } catch (error) {
    /*
     * 로컬 파일 쓰기 실패는 원격 URL 자체의 실패가 아니다.
     *
     * 따라서 resourceErrors에는 저장하지 않는다.
     * 다음 실행에서 다시 시도할 수 있어야 한다.
     */
    throw error;
  }

  /*
   * 성공 resource metadata:
   *
   * filename = 원격 리소스의 원본 파일명
   * size     = 원격 GET 응답의 Content-Length
   * path     = 실제 로컬 저장 위치
   *
   * size는 buffer.length나 fs.stat().size로 대체하지 않는다.
   *
   * CSS처럼 transform되는 리소스는:
   *
   *   remoteSize !== buffer.length
   *
   * 일 수 있기 때문이다.
   */
  const originalFilename = getOriginalFilename(
    source,
    fetched.response,
    requestOptions
  );

  const resourceMetadata = {
    filename: originalFilename || resolvedFilename,
    size: remoteSize,
  };

  /*
   * Content-Length를 제공하지 않는 서버라면
   * filename + size라는 안정적인 성공 cache key를 만들 수 없다.
   *
   * 이 경우 파일 다운로드와 저장 자체는 정상적으로 완료하되
   * resources에는 넣지 않는다.
   */
  if (resourceMetadata.size) {
    setResource(resourceMetadata, destination);
  }

  console.log(`${logLabel} 다운로드: ${path.basename(destination)}`);

  return {
    status: "downloaded",
    cached: false,
    path: destination,
    filename: path.basename(destination),
    url: source,
    response: fetched.response,
    resource: resourceMetadata.size ? resourceMetadata : null,
  };
}

async function downloadFirst(urls, options = {}) {
  const candidates = [
    ...new Set(
      (urls || [])
        .map(normalizeUrl)
        .filter(Boolean)
    ),
  ];

  if (!candidates.length) {
    throw new Error("다운로드 후보 URL이 없습니다.");
  }

  const failures = [];

  /*
   * 후보 URL별로 각각 download()를 호출한다.
   *
   * 따라서:
   *
   * URL A 실패 → A만 resourceErrors에 기록
   * URL B 성공 → 정상 다운로드
   *
   * 다음 실행에서는 A는 즉시 건너뛰고 B를 확인한다.
   */
  for (const url of candidates) {
    try {
      return await download(url, options);
    } catch (error) {
      /*
       * 병신같은 ChatGPT 이부분에서 기능누락 했으니 조심
       *
       * connection error는 다음 후보 URL의 실패로 처리하지 않는다.
       * 정상적인 connection error라면 download() 내부에서 연결이
       * 복구될 때까지 기다리지만, 밖으로 전달되더라도 실패 목록에
       * 넣어 일반적인 리소스 실패로 바꾸면 안 된다.
       */
      if (isNetworkError(error)) {
        throw error;
      }

      failures.push(`${url} -> ${error.message}`);
    }
  }

  throw new Error(`모든 다운로드 주소 실패:\n${failures.join("\n")}`);
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

async function downloadNaverVideo(candidates, options = {}) {
  const defaultOptions = {
    outputDir: "",
    fallbackFilename: "video.mp4",
    timeout: 10000,
  };

  const requestOptions = {
    ...defaultOptions,
    ...options,
  };

  const {
    outputDir,
    fallbackFilename,
    timeout,
  } = requestOptions;

  if (!Array.isArray(candidates) || !candidates.length) {
    throw new Error("Naver 동영상 메타데이터가 없습니다.");
  }

  if (!outputDir) {
    throw new Error("Naver 동영상 outputDir이 없습니다.");
  }

  /*
   * videos 전용 영구 cache는 사용하지 않는다.
   *
   * vid/inKey는 현재 MP4 URL을 얻기 위한 식별자로만 사용한다.
   *
   * 실제 MP4 파일은 이미지/CSS/첨부파일/poster와 동일하게
   * 일반 resources cache에서 관리한다.
   */
  const resolved = await resolveNaverVideo(candidates);

  const {
    metadata,
    info,
    videoUrl,
    posterUrl,
  } = resolved;

  const vid = String(metadata.vid || "").trim();

  let fallback = safeFilename(
    fallbackFilename,
    "video.mp4"
  );

  if (!path.extname(fallback)) {
    fallback += ".mp4";
  }

  /*
   * VOD API에서 현재 MP4 URL을 얻은 뒤
   * 반드시 일반 download()를 통과시킨다.
   *
   * 따라서 MP4도:
   *
   *   HEAD
   *     ↓
   *   filename + size
   *     ↓
   *   resources cache
   *
   * 구조를 그대로 사용한다.
   */
  const videoResult = await download(videoUrl, {
    outputDir,
    fallbackFilename: fallback,
    logLabel: "동영상",
    timeout,
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: "https://blog.naver.com/",
    },
    resolveFilename: ({url, response}) => {
      let filename = getFilenameFromUrl(
        response.url || url,
        fallback
      );

      if (!path.extname(filename)) {
        filename += ".mp4";
      }

      return filename;
    },
  });

  return {
    status: videoResult.status,
    cached: videoResult.cached,
    vid,
    metadata,
    info,
    videoPath: videoResult.path,
    videoFilename: videoResult.filename,
    posterPath: "",
    posterFilename: "",
    posterUrl,
  };
}

/*
 * 이전에는 video cache에서:
 *
 *   vid → video + poster
 *
 * 관계를 저장하기 위해 사용했다.
 *
 * videos cache를 제거했으므로 더 이상 별도 저장하지 않는다.
 *
 * poster 파일 자체는 video.js에서 일반 download()를 통과하므로
 * 자동으로 resources cache에 들어간다.
 *
 * 기존 video.js 호출부를 수정하지 않아도 되도록
 * 함수 자체만 호환용으로 남겨둔다.
 */
function setNaverVideoPoster() {}

module.exports = {
  download,
  downloadFirst,
  downloadNaverVideo,
  setNaverVideoPoster,

  normalizeUrl,
  safeFilename,
  getFilenameFromUrl,
  getUniqueFilename,
};