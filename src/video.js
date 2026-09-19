// src/video.js

const fs = require("fs");
const path = require("path");

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

  if (!response.ok) throw new Error(`다운로드 실패: ${response.status} ${url}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
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

function makeYouTubeIframe(id, start = 0) {
  const src = `https://www.youtube.com/embed/${id}${start ? `?start=${start}` : ""}`;

  return `<iframe width="560" height="315" src="${src}" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;
}

function protectYouTube($, root, store) {
  root.find("script.__se_module_data").each((_, element) => {
    const script = $(element);
    const raw = script.attr("data-module-v2") || script.attr("data-module");

    if (!raw) return;

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    const serialized = JSON.stringify(data);
    const id = getYouTubeId(serialized);

    if (!id) return;

    const startMatch = serialized.match(/"(?:start|startTime|start_time)"\s*:\s*"?([^",}]+)"?/i);
    const iframe = makeYouTubeIframe(id, startMatch ? parseYouTubeStart(startMatch[1]) : 0);
    const token = store.add(iframe);
    const component = script.closest(".se-component");

    if (component.length) component.replaceWith(`<div class="naver-protected">${token}</div>`);
    else script.replaceWith(`<div class="naver-protected">${token}</div>`);
  });
}

function findVideoMetadata(value) {
  const text = String(value || "");
  const vid = text.match(/"(?:vid|videoId|video_id)"\s*:\s*"([^"]+)"/i);
  const inKey = text.match(/"(?:inKey|inkey|in_key)"\s*:\s*"([^"]+)"/i);

  return vid ? { vid: vid[1], inKey: inKey ? inKey[1] : "" } : null;
}

async function fetchVideoInfo(vid, inKey) {
  const params = new URLSearchParams({ vid });

  if (inKey) params.set("inKey", inKey);

  const response = await fetch(
    `https://apis.naver.com/rmcnmv/rmcnmv/vod/play/v2.0/${vid}?${params}`,
    {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: "https://blog.naver.com/",
      },
    }
  );

  if (!response.ok) throw new Error(`Naver VOD API 실패: ${response.status}`);

  return response.json();
}

function findBestMp4(data) {
  const results = [];

  function walk(value) {
    if (!value) return;

    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    if (typeof value !== "object") return;

    const src = value.source || value.url || value.src || "";
    const type = value.type || value.mimeType || value.mime || "";

    if (
      typeof src === "string" &&
      src.startsWith("http") &&
      (/\.mp4(?:\?|$)/i.test(src) || /video\/mp4/i.test(type))
    ) {
      const width = Number(value.width || value.encodingWidth || value.videoWidth || 0);
      const height = Number(value.height || value.encodingHeight || value.videoHeight || 0);
      const bitrate = Number(value.bitrate || value.videoBitrate || 0);

      results.push({
        src,
        score: width * height * 1000000 + bitrate,
      });
    }

    Object.values(value).forEach(walk);
  }

  walk(data);

  results.sort((a, b) => b.score - a.score);

  return results[0]?.src || "";
}

function findPoster(data) {
  let result = "";

  function walk(value) {
    if (result || !value) return;

    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    if (typeof value !== "object") return;

    for (const [key, child] of Object.entries(value)) {
      if (
        typeof child === "string" &&
        child.startsWith("http") &&
        /thumbnail|poster|cover/i.test(key) &&
        /\.(jpg|jpeg|png|webp)(?:\?|$)/i.test(child)
      ) {
        result = child;
        return;
      }

      walk(child);
    }
  }

  walk(data);

  return result;
}

async function protectNaverVideos($, root, outputDir, store, imageManager) {
  let index = 1;
  const downloadedVideos = new Map();

  for (const element of root.find(".se-video, .se-component.se-video").toArray()) {
    const component = $(element);
    let metadata = null;

    for (const script of component.find("script").toArray()) {
      const node = $(script);
      const raw = node.attr("data-module-v2") || node.attr("data-module") || node.html() || "";

      metadata = findVideoMetadata(raw);

      if (metadata) break;
    }

    if (!metadata) metadata = findVideoMetadata(component.html() || "");
    if (!metadata) continue;

    try {
      const info = await fetchVideoInfo(metadata.vid, metadata.inKey);
      const videoUrl = findBestMp4(info);

      if (!videoUrl) continue;

      const number = String(index).padStart(3, "0");
      let videoFilename;

      if (downloadedVideos.has(videoUrl)) {
        videoFilename = downloadedVideos.get(videoUrl);
      } else {
        videoFilename = getFilenameFromUrl(videoUrl, `video-${number}.mp4`);
        videoFilename = getUniqueFilename(outputDir, videoFilename);

        await downloadFile(videoUrl, path.join(outputDir, videoFilename));
        downloadedVideos.set(videoUrl, videoFilename);
      }

      let poster = "";
      const posterUrl = findPoster(info);

      if (posterUrl) {
        try {
          const posterFilename = await imageManager.download(posterUrl, {
            fallbackPrefix: "video-thumb",
          });

          if (posterFilename) poster = ` poster="${posterFilename}"`;
        } catch {}
      }

      const html = `<video controls style="width:100%;height:auto;"${poster}><source src="${videoFilename}" type="video/mp4"></video>`;

      component.replaceWith(`<div class="naver-protected">${store.add(html)}</div>`);

      index++;
    } catch {
      console.warn(`동영상 다운로드 실패: ${metadata.vid}`);
    }
  }
}

module.exports = {
  protectYouTube,
  protectNaverVideos,
};
