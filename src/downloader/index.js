const fs = require("fs");
const path = require("path");

const {
  getResourceState,
  setResource,
  getResourceError,
  setResourceError,
  clearResourceError,
} = require("../cache-resource");

const {
  isNetworkError,
} = require("../network");

const {
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
} = require("./utils");

const PROGRESS_THRESHOLD = 10 * 1024 * 1024;
const PROGRESS_STEP = 5;

function formatMegabytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function readResponseBuffer(response, logLabel) {
  const totalSize = getHeaderSize(response);
  const showProgress = totalSize >= PROGRESS_THRESHOLD && response.body;

  if (!response.body) {
    return Buffer.from(await response.arrayBuffer());
  }

  const reader = response.body.getReader();
  const chunks = [];
  let receivedSize = 0;
  let nextProgress = PROGRESS_STEP;
  let progressShown = false;

  try {
    while (true) {
      const {done, value} = await reader.read();

      if (done) break;

      const chunk = Buffer.from(value);
      chunks.push(chunk);
      receivedSize += chunk.length;

      if (!showProgress) continue;

      const progress = Math.min(100, Math.floor(receivedSize / totalSize * 100));

      if (progress < nextProgress) continue;

      const displayedProgress = Math.min(100, Math.floor(progress / PROGRESS_STEP) * PROGRESS_STEP);

      process.stdout.write(
        `\r${logLabel} 다운로드: ${displayedProgress}% (${formatMegabytes(receivedSize)} / ${formatMegabytes(totalSize)})`
      );

      progressShown = true;
      nextProgress = displayedProgress + PROGRESS_STEP;
    }
  } finally {
    if (progressShown) process.stdout.write("\n");
    reader.releaseLock();
  }

  return Buffer.concat(chunks, receivedSize);
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
    noCache,
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
  if (!noCache) {
    const previousError = getResourceError(source);

    if (previousError?.status === "error") {
      throw new Error(
        `이전 다운로드 실패로 재시도 안 함: ${source}`
        + `${previousError.error ? ` - ${previousError.error}` : ""}`
      );
    }
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
   *
   * HEAD는 500ms timeout으로 최대 2회 시도한다.
   */
  let headMetadata = null;
  let headSucceeded = false;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const head = await fetchResourceMetadata(source, requestOptions);
      headMetadata = head.metadata;
      headSucceeded = true;
      break;
    } catch {}
  }

  if (!noCache && headMetadata) {
    const cached = getResourceState(headMetadata);

    if (cached?.status === "ok") {
      const result = copyCachedResource(cached, source, requestOptions);

      console.log(`${logLabel} 캐시 재사용: ${result.filename}`);

      return result;
    }
  }

  let fetched = null;
  let fetchError = null;

  /*
   * 실제 GET이 실패한 경우에만 resourceErrors에 기록한다.
   *
   * HEAD가 성공한 경우에는 retries 설정에 따라 GET을 재시도한다.
   *
   * HEAD가 2회 모두 실패한 경우에는
   * retries와 관계없이 GET을 1회만 시도한다.
   *
   * retries=0
   *   최초 1회
   *
   * retries=1
   *   최초 1회 + 재시도 1회
   */
  const retryCount = headSucceeded ? Math.max(0, Number(retries) || 0) : 0;

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
    if (!noCache && !isNetworkError(fetchError)) {
      setResourceError(source, fetchError);
    }

    throw fetchError;
  }

  /*
   * HEAD에서 cache를 확인하지 못했더라도
   * GET 응답 헤더에서 filename + Content-Length를 얻을 수 있다.
   *
   * body를 모두 다운로드하기 전에 resources cache를 다시 확인하고,
   * hit이면 GET body를 중단한 뒤 기존 파일을 재사용한다.
   */
  const getMetadata = getResourceMetadata(source, fetched.response, requestOptions);

  if (!noCache && getMetadata) {
    const cached = getResourceState(getMetadata);

    if (cached?.status === "ok") {
      if (fetched.response.body) {
        await fetched.response.body.cancel();
      }

      const result = copyCachedResource(cached, source, requestOptions);

      console.log(`${logLabel} 캐시 재사용: ${result.filename}`);

      return result;
    }
  }

  let rawBuffer;

  try {
    rawBuffer = await readResponseBuffer(fetched.response, logLabel);

    if (!rawBuffer.length) {
      throw new Error("빈 응답");
    }
  } catch (error) {
    /*
     * GET 응답 헤더를 받은 뒤 body 다운로드에 실패한 경우에도
     * 실제 파일 다운로드 실패로 처리한다.
     */
    if (!noCache && !isNetworkError(error)) {
      setResourceError(source, error);
    }

    throw error;
  }

  /*
   * GET 자체는 성공했으므로 과거 실패 기록이 존재한다면 제거한다.
   *
   * 일반적으로 위에서 실패 cache가 발견되면 GET을 하지 않기 때문에
   * 여기까지 오는 경우는 거의 없지만,
   * cache 정책이 바뀌거나 수동으로 일부 cache를 수정한 경우에도
   * 상태가 일관되도록 해둔다.
   */
  if (!noCache) {
    clearResourceError(source);
  }

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
      rawBuffer,
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
    if (!noCache) {
      setResourceError(source, error);
    }

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
  if (!noCache && resourceMetadata.size) {
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