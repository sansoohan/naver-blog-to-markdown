const fs = require("fs");
const path = require("path");

const {
  getResourceState,
  setResource,
  setResources,
  setResourceError,
  getVideoState,
  setVideo,
  setVideoError,
  copyCachedFile,
} = require("./backup-cache");

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

function getUniqueFilename(outputDir, filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let result = filename;
  let index = 2;

  while (fs.existsSync(path.join(outputDir, result))) {
    result = `${base}_${index}${ext}`;
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

function getCacheAliases(url, options = {}) {
  const aliases = [url, ...(options.cacheAliases || [])];
  return [...new Set(aliases.map(normalizeUrl).filter(Boolean))];
}

function saveResourceSuccess(urls, filePath) {
  if (typeof setResources === "function") {
    setResources(urls, filePath);
    return;
  }

  for (const url of urls) setResource(url, filePath);
}

function copyCachedResource(cachedPath, url, options = {}) {
  const {
    outputDir = "",
    filename = "",
    fallbackFilename = "download",
    overwrite = false,
  } = options;

  if (!outputDir) {
    return {
      status: "cached",
      cached: true,
      path: cachedPath,
      filename: path.basename(cachedPath),
      url,
      response: null,
    };
  }

  fs.mkdirSync(outputDir, {recursive: true});

  const preferredName = safeFilename(filename || path.basename(cachedPath) || fallbackFilename, fallbackFilename);
  let destination;
  let finalFilename;

  /*
   * CSS처럼 파일명이 고정되어야 하는 리소스는 overwrite=true를 사용한다.
   * 이 경우 copyCachedFile()의 _2, _3 이름 생성을 사용하지 않는다.
   */
  if (overwrite && filename) {
    destination = getExactDestination(outputDir, preferredName);
    finalFilename = preferredName;

    if (path.resolve(cachedPath) !== destination) fs.copyFileSync(cachedPath, destination);
  } else {
    finalFilename = copyCachedFile(cachedPath, outputDir, preferredName);
    if (!finalFilename) throw new Error(`캐시 파일 재사용 실패: ${cachedPath}`);

    destination = path.resolve(outputDir, finalFilename);
  }

  saveResourceSuccess(getCacheAliases(url, options), destination);

  return {
    status: "cached",
    cached: true,
    path: destination,
    filename: finalFilename,
    url,
    response: null,
  };
}

async function fetchResource(url, options = {}) {
  const {
    headers = {},
    redirect = "follow",
    signal = null,
    timeout = 0,
  } = options;

  const fetchOptions = {headers, redirect};

  if (signal) fetchOptions.signal = signal;
  else if (timeout > 0) fetchOptions.signal = AbortSignal.timeout(timeout);

  const response = await fetch(url, fetchOptions);

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const buffer = Buffer.from(await response.arrayBuffer());

  if (!buffer.length) throw new Error("빈 응답");

  return {buffer, response};
}

async function prepareBuffer(buffer, response, url, options = {}) {
  const {validate = null, transform = null} = options;

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

  if (!result) result = getFilenameFromUrl(response.url || url, fallbackFilename);

  return safeFilename(result, fallbackFilename);
}

async function download(url, options = {}) {
  const source = normalizeUrl(url);

  if (!source) throw new Error("다운로드 URL이 없습니다.");

  const {
    outputDir = "",
    fallbackFilename = "download",
    noDownload = false,
    logLabel = "파일",
    overwrite = false,
    retries = 0,
  } = options;

  /*
   * 다운로드 직전 영구 캐시 확인.
   *
   * ok    -> 네트워크 요청 없이 기존 파일 재사용
   * error -> 이전 실패이므로 네트워크 요청 금지
   * miss  -> --no-download가 아니면 실제 다운로드
   */
  const cached = getResourceState(source);

  if (cached?.status === "ok") {
    const result = copyCachedResource(cached.path, source, options);
    console.log(`${logLabel} 캐시 재사용: ${result.filename}`);
    return result;
  }

  if (cached?.status === "error") {
    throw new Error(`이전 ${logLabel} 다운로드 실패로 재시도 안 함: ${source} - ${cached.error}`);
  }

  if (noDownload) throw new Error(`--no-download ${logLabel} 캐시 없음: ${source}`);

  let fetched;
  let fetchError = null;
  const retryCount = Math.max(0, Number(retries) || 0);

  /*
   * 네트워크 요청/응답 자체가 실패하면 지정된 횟수만큼 재시도한다.
   *
   * retries=0 -> 최초 1회
   * retries=1 -> 최초 1회 + 재시도 1회
   *
   * 모든 시도가 실패한 경우에만 error cache로 저장한다.
   */
  for (let attempt = 0; attempt <= retryCount; attempt++) {
    try {
      fetched = await fetchResource(source, options);
      fetchError = null;
      break;
    } catch (error) {
      fetchError = error;
    }
  }

  if (!fetched) {
    setResourceError(source, fetchError);
    throw fetchError;
  }

  let buffer;

  /*
   * 응답 검증 실패도 해당 URL에서 올바른 리소스를 받지 못한 것이므로
   * URL 실패로 기록한다.
   */
  try {
    buffer = await prepareBuffer(fetched.buffer, fetched.response, source, options);
  } catch (error) {
    setResourceError(source, error);
    throw error;
  }

  /*
   * resolveFilename은 HTTP 응답을 확인한 뒤 실행한다.
   *
   * 첨부파일:
   * Content-Disposition -> 실제 파일명
   *
   * 이미지:
   * URL/Content-Type 등을 이용한 파일명 결정
   *
   * CSS:
   * filename을 직접 지정하므로 resolveFilename 불필요
   */
  const resolvedFilename = await resolveDownloadFilename(source, fetched.response, buffer, options);

  if (!outputDir) throw new Error(`${logLabel} outputDir이 없습니다.`);

  const destination = getDestination(outputDir, resolvedFilename, overwrite);

  fs.writeFileSync(destination, buffer);

  const aliases = [
    source,
    fetched.response.url,
    ...(options.cacheAliases || []),
  ];

  saveResourceSuccess([...new Set(aliases.map(normalizeUrl).filter(Boolean))], destination);

  console.log(`${logLabel} 다운로드: ${path.basename(destination)}`);

  return {
    status: "downloaded",
    cached: false,
    path: destination,
    filename: path.basename(destination),
    url: source,
    response: fetched.response,
  };
}

async function downloadFirst(urls, options = {}) {
  const candidates = [...new Set((urls || []).map(normalizeUrl).filter(Boolean))];

  if (!candidates.length) throw new Error("다운로드 후보 URL이 없습니다.");

  const failures = [];

  for (const url of candidates) {
    try {
      return await download(url, options);
    } catch (error) {
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

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: "https://blog.naver.com/",
      Accept: "application/json, text/plain, */*",
    },
  });

  if (!response.ok) throw new Error(`Naver VOD API 실패: HTTP ${response.status}`);

  return response.json();
}

function findBestMp4(data) {
  const videos = data?.videos?.list;

  if (!Array.isArray(videos) || !videos.length) return "";

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
    if (typeof candidate === "string" && /^https?:\/\//i.test(candidate)) return normalizeUrl(candidate);
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
      lastError = error;
    }
  }

  if (lastError) throw lastError;

  throw new Error("사용 가능한 Naver 동영상 메타데이터가 없습니다.");
}

function reuseCachedVideo(cached, vid, metadata, outputDir) {
  fs.mkdirSync(outputDir, {recursive: true});

  const videoFilename = copyCachedFile(cached.videoPath, outputDir, path.basename(cached.videoPath));

  if (!videoFilename) throw new Error(`동영상 캐시 파일이 없습니다: ${vid}`);

  const videoPath = path.resolve(outputDir, videoFilename);
  let posterFilename = "";
  let posterPath = "";

  if (cached.posterPath) {
    posterFilename = copyCachedFile(cached.posterPath, outputDir, path.basename(cached.posterPath));

    if (posterFilename) posterPath = path.resolve(outputDir, posterFilename);
  }

  setVideo(vid, videoPath, posterPath);

  console.log(`동영상 캐시 재사용: ${videoFilename}`);

  return {
    status: "cached",
    cached: true,
    vid,
    metadata,
    videoPath,
    videoFilename,
    posterPath,
    posterFilename,
    posterUrl: "",
    info: null,
  };
}

function findExistingFile(outputDir, filename) {
  if (!outputDir || !filename) return "";

  const root = path.resolve(outputDir);
  const filePath = path.resolve(root, filename);

  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) return "";

  try {
    if (!fs.statSync(filePath).isFile()) return "";
  } catch {
    return "";
  }

  return filePath;
}

function findExistingVideoFromResolved(resolved, outputDir, fallbackFilename = "video.mp4") {
  const {metadata, info, videoUrl, posterUrl} = resolved;
  const vid = String(metadata?.vid || "").trim();

  let fallback = safeFilename(fallbackFilename, "video.mp4");
  if (!path.extname(fallback)) fallback += ".mp4";

  let videoFilename = getFilenameFromUrl(videoUrl, fallback);
  if (!path.extname(videoFilename)) videoFilename += ".mp4";

  const videoPath = findExistingFile(outputDir, videoFilename);

  if (!videoPath) {
    throw new Error(`--no-download 기존 동영상 파일 없음: ${videoFilename}`);
  }

  let posterFilename = "";
  let posterPath = "";

  if (posterUrl) {
    posterFilename = getFilenameFromUrl(posterUrl, "");

    if (posterFilename) {
      posterPath = findExistingFile(outputDir, posterFilename);

      if (!posterPath) {
        posterFilename = "";
        posterPath = "";
      }
    }
  }

  setVideo(vid, videoPath, posterPath);

  console.log(`동영상 기존 파일 재사용: ${videoFilename}`);

  if (posterFilename) {
    console.log(`동영상 썸네일 기존 파일 재사용: ${posterFilename}`);
  }

  return {
    status: "existing",
    cached: true,
    vid,
    metadata,
    videoPath,
    videoFilename,
    posterPath,
    posterFilename,
    posterUrl: posterFilename ? "" : posterUrl,
    info,
  };
}

async function downloadNaverVideo(candidates, options = {}) {
  const {
    outputDir = "",
    fallbackFilename = "video.mp4",
    noDownload = false,
  } = options;

  if (!Array.isArray(candidates) || !candidates.length) {
    throw new Error("Naver 동영상 메타데이터가 없습니다.");
  }

  if (!outputDir) throw new Error("Naver 동영상 outputDir이 없습니다.");

  const vids = [...new Set(
    candidates
      .map(candidate => String(candidate?.vid || "").trim())
      .filter(Boolean)
  )];

  if (!vids.length) throw new Error("Naver 동영상 vid가 없습니다.");

  /*
   * VOD API보다 먼저 vid cache를 확인한다.
   *
   * 같은 vid가 이미 성공:
   * VOD API 호출 안 함.
   *
   * 같은 vid가 이전에 실패:
   * VOD API 호출 안 함.
   */
  for (const vid of vids) {
    const cached = getVideoState(vid);
    const metadata = candidates.find(candidate => String(candidate?.vid || "").trim() === vid) || candidates[0];

    if (cached?.status === "ok") return reuseCachedVideo(cached, vid, metadata, outputDir);

    if (cached?.status === "error") {
      throw new Error(`이전 동영상 다운로드 실패로 재시도 안 함: ${vid} - ${cached.error}`);
    }
  }

  let resolved;

  /*
   * vid cache miss일 때 VOD API를 호출한다.
   *
   * --no-download에서도 VOD API의 JSON 메타데이터 조회는 허용한다.
   * 실제 MP4/poster 파일 다운로드는 하지 않는다.
   */
  try {
    resolved = await resolveNaverVideo(candidates);
  } catch (error) {
    if (!noDownload) {
      for (const vid of vids) setVideoError(vid, error);
    }

    throw error;
  }

  /*
   * --no-download에서는 VOD API에서 얻은 URL로 파일명만 계산한 뒤
   * 이미 outputDir에 복사되어 있는 기존 MP4/poster를 찾는다.
   */
  if (noDownload) {
    return findExistingVideoFromResolved(resolved, outputDir, fallbackFilename);
  }

  const {metadata, info, videoUrl, posterUrl} = resolved;
  const vid = String(metadata.vid || "").trim();

  let fallback = safeFilename(fallbackFilename, "video.mp4");

  if (!path.extname(fallback)) fallback += ".mp4";

  let videoResult;

  /*
   * MP4 URL을 얻은 뒤에도 바로 fetch하지 않는다.
   *
   * 반드시 일반 download()를 통과시켜서
   * 최종 MP4 URL의 resource cache도 검사한다.
   */
  try {
    videoResult = await download(videoUrl, {
      outputDir,
      fallbackFilename: fallback,
      logLabel: "동영상",
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: "https://blog.naver.com/",
      },
      resolveFilename: ({url, response}) => {
        let filename = getFilenameFromUrl(response.url || url, fallback);

        if (!path.extname(filename)) filename += ".mp4";

        return filename;
      },
    });
  } catch (error) {
    for (const candidateVid of vids) setVideoError(candidateVid, error);
    throw error;
  }

  setVideo(vid, videoResult.path, "");

  return {
    status: videoResult.status,
    cached: videoResult.cached,
    vid,
    metadata,
    videoPath: videoResult.path,
    videoFilename: videoResult.filename,
    posterPath: "",
    posterFilename: "",
    posterUrl,
    info,
  };
}

function setNaverVideoPoster(vid, videoPath, posterPath) {
  if (!vid || !videoPath) return;
  setVideo(vid, videoPath, posterPath || "");
}

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
