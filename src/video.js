const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

function safeFilename(value, fallback) {
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

function getFilenameFromUrl(url, fallback) {
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

async function downloadFile(url, outputPath) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: "https://blog.naver.com/",
    },
  });

  if (!response.ok) {
    throw new Error(`다운로드 실패: ${response.status} ${url}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  fs.writeFileSync(outputPath, buffer);
}

function parseModuleData(raw) {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseYouTubeStart(value) {
  if (!value) {
    return 0;
  }

  if (/^\d+$/.test(String(value))) {
    return Number(value);
  }

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

  if (match) {
    return match[1];
  }

  match = text.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/i);

  if (match) {
    return match[1];
  }

  match = text.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/i);

  return match ? match[1] : null;
}

function makeYouTubeIframe(id, start = 0) {
  const src = `https://www.youtube.com/embed/${id}${start ? `?start=${start}` : ""}`;

  return `<iframe width="560" height="315" src="${src}" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;
}

function cheerioLoadFragment(html) {
  return cheerio.load(html, { decodeEntities: false }, false);
}

function findYouTubeIframe($, component) {
  const existing = component.find("iframe").first();

  if (existing.length && getYouTubeId(existing.attr("src"))) {
    return $.html(existing);
  }

  for (const element of component.find("script.__se_module_data").toArray()) {
    const script = $(element);
    const raws = [script.attr("data-module-v2"), script.attr("data-module"), script.html()];

    for (const raw of raws) {
      if (!raw) {
        continue;
      }

      const data = parseModuleData(raw);

      if (data) {
        const candidates = [data.html, data.data?.html, data.result?.html, data.oembed?.html];

        for (const candidate of candidates) {
          if (typeof candidate !== "string") {
            continue;
          }

          const fragment = cheerioLoadFragment(candidate);
          const iframe = fragment("iframe").first();

          if (iframe.length && getYouTubeId(iframe.attr("src"))) {
            return fragment.html(iframe);
          }
        }

        const serialized = JSON.stringify(data);
        const id = getYouTubeId(serialized);

        if (id) {
          const startMatch = serialized.match(/"(?:start|startTime|start_time)"\s*:\s*"?([^",}]+)"?/i);
          return makeYouTubeIframe(id, startMatch ? parseYouTubeStart(startMatch[1]) : 0);
        }
      }

      const id = getYouTubeId(raw);

      if (id) {
        return makeYouTubeIframe(id);
      }
    }
  }

  return "";
}

function restoreYouTubeEmbeds($, root) {
  const components = root.find(".se-component.se-oembed, .se-oembed").toArray();

  for (const element of components) {
    const component = $(element);

    if (component.hasClass("naver-local-youtube")) {
      continue;
    }

    const iframe = findYouTubeIframe($, component);

    if (!iframe) {
      continue;
    }

    component.addClass("naver-local-youtube");
    component.attr("data-youtube", "true");

    const module = component.find(".se-module").first();

    if (module.length) {
      module.empty().append(iframe);
    } else {
      component.empty().append(iframe);
    }
  }
}

function protectYouTube($, root, store) {
  const components = root.find(".naver-local-youtube").toArray();

  for (const element of components) {
    const component = $(element);
    const iframe = component.find("iframe").first();

    if (!iframe.length) {
      continue;
    }

    component.replaceWith(`<div class="naver-protected">${store.add($.html(iframe))}</div>`);
  }

  const rawComponents = root.find(".se-component.se-oembed").toArray();

  for (const element of rawComponents) {
    const component = $(element);
    const iframe = findYouTubeIframe($, component);

    if (!iframe) {
      continue;
    }

    component.replaceWith(`<div class="naver-protected">${store.add(iframe)}</div>`);
  }
}

function getVideoMetadataCandidates($, component) {
  const candidates = [];
  const seen = new Set();

  function add(metadata) {
    if (!metadata?.vid) {
      return;
    }

    const normalized = {
      vid: String(metadata.vid),
      inKey: String(metadata.inKey || metadata.inkey || metadata.in_key || ""),
      thumbnail: String(metadata.thumbnail || ""),
      width: Number(metadata.width || metadata.originalWidth || 0),
      height: Number(metadata.height || metadata.originalHeight || 0),
    };

    const key = `${normalized.vid}|${normalized.inKey}`;

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    candidates.push(normalized);
  }

  for (const element of component.find("script.__se_module_data").toArray()) {
    const script = $(element);

    for (const attr of ["data-module-v2", "data-module"]) {
      const raw = script.attr(attr);
      const parsed = parseModuleData(raw);
      const data = parsed?.data;

      if (!data?.vid) {
        continue;
      }

      add({
        vid: data.vid,
        inKey: data.inkey || data.inKey || data.in_key || "",
        thumbnail: data.thumbnail || "",
        width: data.width || data.originalWidth || 0,
        height: data.height || data.originalHeight || 0,
      });
    }
  }

  return candidates;
}

async function fetchVideoInfo(vid, inKey) {
  const params = new URLSearchParams({
    key: inKey,
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

  if (!response.ok) {
    throw new Error(`Naver VOD API 실패: ${response.status}`);
  }

  return response.json();
}

function findBestMp4(data) {
  const videos = data?.videos?.list;

  if (!Array.isArray(videos) || !videos.length) {
    return "";
  }

  const results = videos
    .filter(video => typeof video.source === "string" && video.source.startsWith("http"))
    .map(video => ({
      src: video.source.replace(/∈/g, "&"),
      size: Number(video.size || 0),
      width: Number(video.encodingOption?.width || video.width || 0),
      height: Number(video.encodingOption?.height || video.height || 0),
      bitrate: Number(video.bitrate?.video || video.bitrate || 0),
    }));

  results.sort((a, b) => {
    const resolutionDiff = (b.width * b.height) - (a.width * a.height);

    if (resolutionDiff !== 0) {
      return resolutionDiff;
    }

    if (b.bitrate !== a.bitrate) {
      return b.bitrate - a.bitrate;
    }

    return b.size - a.size;
  });

  return results[0]?.src || "";
}

function findPoster(data) {
  const candidates = [data?.meta?.cover?.source, data?.meta?.cover?.url, data?.thumbnail, data?.poster];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.startsWith("http")) {
      return candidate;
    }
  }

  let result = "";

  function walk(value) {
    if (result || !value) {
      return;
    }

    if (Array.isArray(value)) {
      for (const child of value) {
        walk(child);

        if (result) {
          return;
        }
      }

      return;
    }

    if (typeof value !== "object") {
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      if (typeof child === "string" && child.startsWith("http") && /thumbnail|poster|cover/i.test(key) && /\.(jpg|jpeg|png|webp)(?:\?|$)/i.test(child)) {
        result = child;
        return;
      }

      walk(child);

      if (result) {
        return;
      }
    }
  }

  walk(data);

  return result;
}

async function resolveNaverVideo(candidates) {
  let lastError = null;

  for (const metadata of candidates) {
    try {
      console.log(`Naver 동영상 확인: ${metadata.vid} / ${metadata.inKey || "inkey 없음"}`);

      const info = await fetchVideoInfo(metadata.vid, metadata.inKey);
      const videoUrl = findBestMp4(info);

      if (!videoUrl) {
        lastError = new Error("MP4 URL을 찾지 못함");
        continue;
      }

      return {
        metadata,
        info,
        videoUrl,
      };
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw lastError;
  }

  return null;
}

function replaceNaverVideoPlayer($, component, videoHtml) {
  const module = component.find(".se-module.se-module-video").first();

  if (module.length) {
    module.replaceWith(videoHtml);
    return;
  }

  const section = component.find(".se-section.se-section-video").first();

  if (section.length) {
    section.empty().append(videoHtml);
    return;
  }

  const content = component.find(".se-component-content").first();

  if (content.length) {
    content.empty().append(videoHtml);
    return;
  }

  component.empty().append(videoHtml);
}

async function localizeNaverVideos($, root, outputDir, imageManager) {
  let index = 1;

  const downloadedVideos = new Map();
  const components = root.find(".se-component.se-video").toArray();

  for (const element of components) {
    const component = $(element);

    if (component.hasClass("naver-local-video")) {
      continue;
    }

    const candidates = getVideoMetadataCandidates($, component);

    if (!candidates.length) {
      console.warn("Naver 동영상 메타데이터를 찾지 못함");
      continue;
    }

    try {
      const resolved = await resolveNaverVideo(candidates);

      if (!resolved) {
        continue;
      }

      const { metadata, info, videoUrl } = resolved;
      const number = String(index).padStart(3, "0");

      let videoFilename;

      if (downloadedVideos.has(videoUrl)) {
        videoFilename = downloadedVideos.get(videoUrl);
      } else {
        videoFilename = getFilenameFromUrl(videoUrl, `video-${number}.mp4`);

        if (!path.extname(videoFilename)) {
          videoFilename += ".mp4";
        }

        videoFilename = getUniqueFilename(outputDir, videoFilename);

        console.log(`동영상 다운로드: ${videoFilename}`);

        await downloadFile(videoUrl, path.join(outputDir, videoFilename));

        downloadedVideos.set(videoUrl, videoFilename);
      }

      let posterFilename = "";
      const posterUrl = findPoster(info) || metadata.thumbnail;

      if (posterUrl && imageManager?.download) {
        try {
          posterFilename = await imageManager.download(posterUrl, {
            fallbackPrefix: "video-thumb",
          });
        } catch (error) {
          console.warn(`동영상 썸네일 다운로드 실패: ${error.message}`);
        }
      }

      const poster = posterFilename ? ` poster="./${posterFilename}"` : "";
      const width = metadata.width || 500;
      const height = metadata.height || 281;

      const videoHtml = `
        <video controls preload="metadata" width="${width}" height="${height}"${poster}>
          <source src="./${videoFilename}" type="video/mp4">
        </video>
      `;

      component.addClass("naver-local-video");
      component.attr("data-naver-video", "true");

      replaceNaverVideoPlayer($, component, videoHtml);

      console.log(`동영상 로컬화 완료: ${videoFilename} (${width}x${height})`);

      index++;
    } catch (error) {
      console.warn(`동영상 다운로드 실패: ${candidates[0]?.vid || "unknown"} - ${error.message}`);
    }
  }
}

function protectNaverVideos($, root, store) {
  const videos = root.find(".naver-local-video").toArray();

  for (const element of videos) {
    const component = $(element);
    const video = component.find("video").first();

    if (!video.length) {
      continue;
    }

    component.replaceWith(`<div class="naver-protected">${store.add($.html(video))}</div>`);
  }
}

module.exports = {
  restoreYouTubeEmbeds,
  protectYouTube,
  localizeNaverVideos,
  protectNaverVideos,
};
