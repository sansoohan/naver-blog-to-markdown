const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const {downloadNaverVideo, setNaverVideoPoster} = require("./downloader");
const {CONTENT_WIDTH_LAYOUTS} = require("./content-width");

function normalizeUrl(url) {
  return String(url || "").trim().replace(/&amp;/g, "&");
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }

  return "";
}

function parseJson(value) {
  if (!value || typeof value !== "string") return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function getObjectValue(object, keys) {
  if (!object || typeof object !== "object") return "";

  for (const key of keys) {
    const value = object[key];

    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }

  return "";
}

function findObjectValue(object, keys, depth = 0) {
  if (!object || typeof object !== "object" || depth > 8) return "";

  const direct = getObjectValue(object, keys);
  if (direct) return direct;

  for (const value of Object.values(object)) {
    if (!value || typeof value !== "object") continue;

    const found = findObjectValue(value, keys, depth + 1);
    if (found) return found;
  }

  return "";
}

function getAttributeValue(element, names) {
  for (const name of names) {
    const value = element.attr(name);

    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }

  return "";
}

function getDataJsonObjects(element) {
  const objects = [];

  for (const [name, value] of Object.entries(element.attr() || {})) {
    if (!name.startsWith("data-") || typeof value !== "string") continue;

    const parsed = parseJson(value);
    if (parsed && typeof parsed === "object") objects.push(parsed);
  }

  return objects;
}

function getNaverVideoMetadata(element) {
  const objects = getDataJsonObjects(element);

  let vid = getAttributeValue(element, ["data-vid", "data-video-id", "data-videoid", "data-vod-id", "data-vodid", "vid"]);
  let inKey = getAttributeValue(element, ["data-inkey", "data-in-key", "data-video-key", "data-videokey", "key"]);
  let thumbnail = getAttributeValue(element, ["data-thumbnail", "data-thumbnail-url", "data-poster", "data-poster-url"]);

  for (const object of objects) {
    if (!vid) vid = findObjectValue(object, ["vid", "videoId", "video_id", "vodId", "vod_id"]);
    if (!inKey) inKey = findObjectValue(object, ["inKey", "inkey", "in_key", "videoKey", "video_key"]);

    if (!thumbnail) {
      thumbnail = findObjectValue(object, ["thumbnail", "thumbnailUrl", "thumbnail_url", "poster", "posterUrl", "poster_url"]);
    }
  }

  return {
    vid: String(vid || "").trim(),
    inKey: String(inKey || "").trim(),
    thumbnail: normalizeUrl(thumbnail),
  };
}

function collectNaverVideoMetadata($, component) {
  const candidates = [];
  const seen = new Set();

  function add(element) {
    const metadata = getNaverVideoMetadata(element);
    if (!metadata.vid) return;

    const key = `${metadata.vid}\n${metadata.inKey}`;
    if (seen.has(key)) return;

    seen.add(key);
    candidates.push(metadata);
  }

  add(component);

  component.find("*").each((_, element) => {
    const child = $(element);
    const attrs = child.attr() || {};
    const hasVideoData = Object.keys(attrs).some(name => /vid|video|vod|inkey|in-key|thumbnail|poster|data-module/i.test(name));

    if (hasVideoData) add(child);
  });

  return candidates;
}

function findThumbnailInComponent($, component) {
  const images = component.find("img").toArray();

  for (const element of images) {
    const image = $(element);

    const source = firstNonEmpty(
      image.attr("data-lazy-src"),
      image.attr("data-original"),
      image.attr("data-origin-src"),
      image.attr("data-src"),
      image.attr("src")
    );

    if (source) return normalizeUrl(source);
  }

  return "";
}

function enrichVideoCandidates($, component, candidates) {
  const thumbnail = findThumbnailInComponent($, component);

  return candidates.map(candidate => ({...candidate, thumbnail: candidate.thumbnail || thumbnail}));
}

function createLocalVideoHtml(videoFilename, posterFilename, vid, editorVersion) {
  const attributes = ["controls", 'preload="metadata"', `src="./${videoFilename}"`];

  if (posterFilename) attributes.push(`poster="./${posterFilename}"`);

  attributes.push('style="display:block;width:100%;aspect-ratio:16/9;object-fit:contain;background:#000;"');

  const layout = CONTENT_WIDTH_LAYOUTS[editorVersion];
  const leftWidth = layout?.leftWidth || 0;
  const rightWidth = layout?.rightWidth || 0;

  return `<div class="naver-local-video" data-naver-video="true" data-naver-vid="${vid}" `
    + `style="padding:0 ${rightWidth}px 0 ${leftWidth}px;box-sizing:border-box;">`
    + `<video ${attributes.join(" ")}></video></div>`;
}

function replaceNaverVideoComponent($, component, result, posterFilename = "", editorVersion = 0) {
  const html = createLocalVideoHtml(result.videoFilename, posterFilename, result.vid, editorVersion);

  /*
   * SmartEditor 1.x / 2.x 구형 네이버 동영상
   */
  if (component.is("._naverVideo")) {
    component.replaceWith(html);
    return true;
  }

  /*
   * SmartEditor 3.x 이상
   */
  const target = component.closest(".se-component.se-video").length ? component.closest(".se-component.se-video") : component;

  target.replaceWith(html);

  return true;
}

function getLocalFilename(value) {
  const source = String(value || "").trim();
  if (!source) return "";

  const withoutQuery = source.split(/[?#]/, 1)[0];
  const normalized = withoutQuery.replace(/\\/g, "/");

  return path.posix.basename(normalized);
}

function findExistingLocalFile(outputDir, value) {
  const filename = getLocalFilename(value);
  if (!filename) return null;

  const root = path.resolve(outputDir);
  const filePath = path.resolve(root, filename);

  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) return null;

  try {
    if (!fs.statSync(filePath).isFile()) return null;
  } catch {
    return null;
  }

  return {
    filename,
    filePath,
  };
}

function findPreviousNaverVideo(previous$, previousRoot, vid, outputDir) {
  const normalizedVid = String(vid || "").trim();
  if (!normalizedVid || !previous$ || !previousRoot?.length) return null;

  const selectors = [
    `video[data-naver-vid="${normalizedVid}"]`,
    `[data-naver-vid="${normalizedVid}"] video`,
    `.naver-local-video[data-naver-vid="${normalizedVid}"] video`,
  ];

  let previousVideo = previousRoot.find(selectors.join(", ")).first();

  if (!previousVideo.length) {
    previousRoot.find("video").each((_, element) => {
      if (previousVideo.length) return;

      const video = previous$(element);
      const parent = video.closest("[data-naver-vid]");
      const previousVid = String(video.attr("data-naver-vid") || parent.attr("data-naver-vid") || "").trim();

      if (previousVid === normalizedVid) previousVideo = video;
    });
  }

  if (!previousVideo.length) return null;

  const videoSource = firstNonEmpty(previousVideo.attr("src"), previousVideo.find("source").first().attr("src"));
  const videoFile = findExistingLocalFile(outputDir, videoSource);

  if (!videoFile) return null;

  const posterSource = previousVideo.attr("poster") || "";
  const posterFile = posterSource ? findExistingLocalFile(outputDir, posterSource) : null;

  return {
    videoFilename: videoFile.filename,
    videoPath: videoFile.filePath,
    posterFilename: posterFile?.filename || "",
    posterPath: posterFile?.filePath || "",
  };
}

async function localizeNaverVideos($, root, imageManager, options = {}) {
  const {previous$ = null, previousRoot = null} = options;

  const selectors = [
    ".se-component.se-video",
    ".se_video",
    ".se-video",
    "[data-module*='video']",
    "._naverVideo",
  ];

  const elements = root.find(selectors.join(", ")).add(root.filter(selectors.join(", "))).toArray();
  const components = [];
  const processed = new Set();

  for (const element of elements) {
    const current = $(element);
    const owner = current.closest(".se-component.se-video, .se_video, .se-video, ._naverVideo");
    const component = owner.length ? owner : current;
    const componentElement = component[0];

    if (!componentElement || processed.has(componentElement)) continue;

    processed.add(componentElement);
    components.push(componentElement);
  }

  for (const element of components) {
    const component = $(element);
    let candidates = collectNaverVideoMetadata($, component);

    if (!candidates.length) continue;

    candidates = enrichVideoCandidates($, component, candidates);

    let result;
    let posterFilename = "";

    if (previous$ && previousRoot) {
      for (const candidate of candidates) {
        const previous = findPreviousNaverVideo(previous$, previousRoot, candidate.vid, imageManager.outputDir);
        if (!previous) continue;

        result = {
          vid: candidate.vid,
          videoFilename: previous.videoFilename,
          videoPath: previous.videoPath,
          posterFilename: previous.posterFilename,
          posterUrl: "",
          metadata: candidate,
        };

        posterFilename = previous.posterFilename;

        console.log(`Naver 동영상 기존 파일 재사용: ${result.videoFilename}`);
        if (posterFilename) console.log(`Naver 동영상 썸네일 기존 파일 재사용: ${posterFilename}`);

        break;
      }
    }

    if (!result) {
      try {
        result = await downloadNaverVideo(candidates, {
          outputDir: imageManager.outputDir,
          fallbackFilename: `video-${String(components.indexOf(element) + 1).padStart(3, "0")}.mp4`,
          timeout: 60000,
        });
      } catch (error) {
        console.warn(`동영상 다운로드 실패: ${candidates[0]?.vid || "unknown"}`);
        console.warn(error.message);
        continue;
      }

      posterFilename = result.posterFilename || "";

      if (!posterFilename && result.posterUrl && imageManager?.download) {
        try {
          posterFilename = await imageManager.download(result.posterUrl, {
            fallbackPrefix: "video-thumb",
            highResolution: true,
          });
        } catch (error) {
          console.warn(`동영상 썸네일 다운로드 실패: ${result.posterUrl}`);
          console.warn(error.message);
        }
      }
    }

    if (posterFilename) {
      const posterPath = path.join(imageManager.outputDir, posterFilename);
      setNaverVideoPoster(result.vid, result.videoPath, posterPath);
    }

    replaceNaverVideoComponent($, component, result, posterFilename, options.editorVersion);
  }
}

function parseYouTubeStart(value) {
  if (!value) return 0;
  if (/^\d+$/.test(String(value))) return Number(value);

  const text = String(value);
  let seconds = 0;

  const h = text.match(/(\d+)h/i);
  const m = text.match(/(\d+)m/i);
  const s = text.match(/(\d+)s/i);

  if (h) seconds += Number(h[1]) * 3600;
  if (m) seconds += Number(m[1]) * 60;
  if (s) seconds += Number(s[1]);

  return seconds;
}

function getYouTubeId(value) {
  const text = String(value || "");

  let match = text.match(/youtube\.com\/watch\?.*?v=([A-Za-z0-9_-]{6,})/i);
  if (match) return match[1];

  match = text.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/i);
  if (match) return match[1];

  match = text.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/i);

  return match ? match[1] : null;
}

function extractYoutubeId(value) {
  return getYouTubeId(normalizeUrl(value)) || "";
}

function getIframeAspectRatio(iframe) {
  const width = Number(iframe.attr("width"));
  const height = Number(iframe.attr("height"));

  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return "";

  return `${width}/${height}`;
}

function addLazyLoadingToIframe(iframe, useWrapperRatio = false) {
  const aspectRatio = getIframeAspectRatio(iframe);

  iframe.attr("loading", "lazy");
  iframe.removeAttr("width");
  iframe.removeAttr("height");

  if (useWrapperRatio) {
    iframe.attr("style", "position:absolute;inset:0;display:block;width:100%;height:100%;");
  } else if (aspectRatio) {
    iframe.attr("style", `display:block;width:100%;aspect-ratio:${aspectRatio};`);
  } else {
    iframe.attr("style", "display:block;width:100%;");
  }

  return iframe;
}

function prepareYouTubeModule(module) {
  if (!module.length) return;

  const style = String(module.attr("style") || "").trim();

  if (/position\s*:/i.test(style)) return;

  module.attr("style", `${style}${style && !style.endsWith(";") ? ";" : ""}position:relative;`);
}

function restoreDeferredYouTubeSrc(iframe) {
  const src = iframe.attr("src");
  const deferredSrc = iframe.attr("data-youtube-src");

  if (!src && deferredSrc) {
    iframe.attr("src", deferredSrc);
    iframe.removeAttr("data-youtube-src");
  }

  return iframe;
}

function makeYouTubeIframe(id, start = 0) {
  const src = `https://www.youtube.com/embed/${id}${start ? `?start=${start}` : ""}`;

  return `<iframe src="${src}" title="YouTube video player" frameborder="0" loading="lazy" `
    + `style="display:block;width:100%;" `
    + `allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" `
    + `allowfullscreen></iframe>`;
}

function cheerioLoadFragment(html) {
  return cheerio.load(html, {decodeEntities: false}, false);
}

function findYouTubeIframe($, component) {
  const existing = component.find("iframe").first();

  if (existing.length && getYouTubeId(existing.attr("src"))) return $.html(existing);

  for (const element of component.find("script.__se_module_data").toArray()) {
    const script = $(element);
    const raws = [script.attr("data-module-v2"), script.attr("data-module"), script.html()];

    for (const raw of raws) {
      if (!raw) continue;

      const data = parseJson(raw);

      if (data) {
        const candidates = [data.html, data.data?.html, data.result?.html, data.oembed?.html];

        for (const candidate of candidates) {
          if (typeof candidate !== "string") continue;

          const fragment = cheerioLoadFragment(candidate);
          const iframe = fragment("iframe").first();

          if (iframe.length && getYouTubeId(iframe.attr("src"))) return fragment.html(iframe);
        }

        const serialized = JSON.stringify(data);
        const id = getYouTubeId(serialized);

        if (id) {
          const startMatch = serialized.match(/"(?:start|startTime|start_time)"\s*:\s*"?([^",}]+)"?/i);
          return makeYouTubeIframe(id, startMatch ? parseYouTubeStart(startMatch[1]) : 0);
        }
      }

      const id = getYouTubeId(raw);
      if (id) return makeYouTubeIframe(id);
    }
  }

  return "";
}

function restoreYouTubeEmbeds($, root) {
  const selector = ".se-component.se-oembed, .se-oembed";
  const components = root.find(selector).add(root.filter(selector)).toArray();
  const processed = new Set();

  for (const element of components) {
    if (processed.has(element)) continue;

    processed.add(element);

    const component = $(element);
    if (component.hasClass("naver-local-youtube")) continue;

    const iframeHtml = findYouTubeIframe($, component);
    if (!iframeHtml) continue;

    const fragment = cheerioLoadFragment(iframeHtml);
    const iframe = fragment("iframe").first();

    if (!iframe.length) continue;

    component.addClass("naver-local-youtube").attr("data-youtube", "true");

    const module = component.find(".se-module.se-module-oembed").first();

    if (module.length) {
      addLazyLoadingToIframe(iframe, true);
      prepareYouTubeModule(module);
      module.empty().append(fragment.html(iframe));
    } else {
      addLazyLoadingToIframe(iframe);
      component.empty().append(fragment.html(iframe));
    }
  }
}

function restoreYoutubeVideos($, root) {
  restoreYouTubeEmbeds($, root);
}

function protectNaverVideos($, root, store) {
  const videos = root.find(".naver-local-video").add(root.filter(".naver-local-video")).toArray();

  for (const element of videos) {
    const component = $(element);
    const video = component.find("video").first();

    if (!video.length) continue;

    /*
     * original.html에서만 사용하는 좌우 패딩 래퍼는 제거하고
     * Markdown에는 video 태그만 보존한다.
     */
    const html = $.html(video).replace(/>\s+</g, "><");

    component.replaceWith(`<div class="naver-protected">${store.add(html)}</div>`);
  }
}

function protectYouTube($, root, store) {
  const components = root.find(".naver-local-youtube").add(root.filter(".naver-local-youtube")).toArray();

  for (const element of components) {
    const component = $(element);
    const module = component.find(".se-module.se-module-oembed").first();
    const iframe = component.find("iframe").first();

    if (!iframe.length) continue;

    restoreDeferredYouTubeSrc(iframe);

    if (module.length) {
      addLazyLoadingToIframe(iframe, true);
      prepareYouTubeModule(module);
    } else {
      addLazyLoadingToIframe(iframe);
    }

    /*
     * 신형 YouTube는 se-module-oembed의 padding-top 비율을 보존하고,
     * 구형 YouTube는 iframe의 원본 width / height 비율을 aspect-ratio로 보존한다.
     */
    const html = module.length ? $.html(module).replace(/>\s+</g, "><") : $.html(iframe);

    component.replaceWith(`<div class="naver-protected">${store.add(html)}</div>`);
  }

  const rawComponents = root.find(".se-component.se-oembed").add(root.filter(".se-component.se-oembed")).toArray();

  for (const element of rawComponents) {
    const component = $(element);
    const iframeHtml = findYouTubeIframe($, component);

    if (!iframeHtml) continue;

    const fragment = cheerioLoadFragment(iframeHtml);
    const iframe = fragment("iframe").first();

    if (!iframe.length) continue;

    restoreDeferredYouTubeSrc(iframe);

    const module = component.find(".se-module.se-module-oembed").first();

    if (module.length) {
      addLazyLoadingToIframe(iframe, true);
      prepareYouTubeModule(module);
      module.empty().append(fragment.html(iframe));

      const html = $.html(module).replace(/>\s+</g, "><");
      component.replaceWith(`<div class="naver-protected">${store.add(html)}</div>`);
    } else {
      addLazyLoadingToIframe(iframe);
      component.replaceWith(`<div class="naver-protected">${store.add(fragment.html(iframe))}</div>`);
    }
  }

  const iframes = root.find("iframe").add(root.filter("iframe")).toArray();

  for (const element of iframes) {
    const iframe = $(element);

    restoreDeferredYouTubeSrc(iframe);

    if (!getYouTubeId(iframe.attr("src"))) continue;

    const module = iframe.closest(".se-module.se-module-oembed");

    if (module.length) {
      addLazyLoadingToIframe(iframe, true);
      prepareYouTubeModule(module);

      const html = $.html(module).replace(/>\s+</g, "><");
      module.replaceWith(`<div class="naver-protected">${store.add(html)}</div>`);
    } else {
      addLazyLoadingToIframe(iframe);
      iframe.replaceWith(`<div class="naver-protected">${store.add($.html(iframe))}</div>`);
    }
  }
}

async function localizeVideos($, root, imageManager, options = {}) {
  await localizeNaverVideos($, root, imageManager, options);
  restoreYouTubeEmbeds($, root);
}

module.exports = {
  localizeVideos,
  localizeNaverVideos,
  restoreYouTubeEmbeds,
  restoreYoutubeVideos,
  protectYouTube,
  protectNaverVideos,
  extractYoutubeId,
  getNaverVideoMetadata,
};