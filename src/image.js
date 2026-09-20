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

function getExtensionFromContentType(contentType, fallback = ".jpg") {
  if (/image\/jpeg/i.test(contentType)) return ".jpg";
  if (/image\/png/i.test(contentType)) return ".png";
  if (/image\/gif/i.test(contentType)) return ".gif";
  if (/image\/webp/i.test(contentType)) return ".webp";
  if (/image\/bmp/i.test(contentType)) return ".bmp";

  return fallback;
}

function normalizeImageUrl(url, highResolution = false) {
  if (!url) {
    return "";
  }

  if (
    url.startsWith("./") ||
    url.startsWith("../") ||
    url.startsWith("data:") ||
    url.startsWith("blob:")
  ) {
    return url;
  }

  try {
    const parsed = new URL(url);

    if (highResolution) {
      parsed.searchParams.set("type", "w2000");
    }

    return parsed.toString();
  } catch {
    return url;
  }
}

function createImageManager(outputDir) {
  const cache = new Map();
  let fallbackIndex = 0;

  async function download(url, options = {}) {
    const { highResolution = false, fallbackPrefix = "image" } = options;

    if (!url) {
      return "";
    }

    if (url.startsWith("./")) {
      return url.slice(2);
    }

    const downloadUrl = normalizeImageUrl(url, highResolution);

    if (
      !downloadUrl ||
      downloadUrl.startsWith("data:") ||
      downloadUrl.startsWith("blob:")
    ) {
      return "";
    }

    if (cache.has(downloadUrl)) {
      return cache.get(downloadUrl);
    }

    fallbackIndex++;

    const fallback = `${fallbackPrefix}-${String(fallbackIndex).padStart(3, "0")}.jpg`;

    let filename = getFilenameFromUrl(url, fallback);
    const originalExt = path.extname(filename);

    const response = await fetch(downloadUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: "https://blog.naver.com/",
      },
    });

    if (!response.ok) {
      throw new Error(`다운로드 실패: ${response.status} ${downloadUrl}`);
    }

    if (!originalExt) {
      const contentType = response.headers.get("content-type") || "";
      filename += getExtensionFromContentType(contentType);
    }

    filename = getUniqueFilename(outputDir, filename);

    const buffer = Buffer.from(await response.arrayBuffer());

    fs.writeFileSync(path.join(outputDir, filename), buffer);

    cache.set(downloadUrl, filename);

    return filename;
  }

  return {
    download,
  };
}

function getImageSource(image) {
  return image.attr("data-lazy-src")
    || image.attr("data-src")
    || image.attr("src")
    || "";
}

async function localizeImages($, root, imageManager) {
  const images = root.find("img").toArray();

  for (const element of images) {
    const image = $(element);

    if (image.closest(".se-component.se-video").length) {
      continue;
    }

    const source = getImageSource(image);

    if (!source) {
      continue;
    }

    if (
      source.startsWith("./") ||
      source.startsWith("../") ||
      source.startsWith("data:")
    ) {
      continue;
    }

    let filename;

    try {
      filename = await imageManager.download(source, {
        highResolution: !image.closest(".se-oglink").length,
        fallbackPrefix: image.closest(".se-oglink").length ? "og-thumb" : "image",
      });
    } catch {
      console.warn(`이미지 다운로드 실패: ${source}`);
      continue;
    }

    if (!filename) {
      continue;
    }

    const width = Number(image.attr("data-width"));

    image.attr("src", `./${filename}`);
    image.removeAttr("data-lazy-src");
    image.removeAttr("data-src");
    image.removeAttr("srcset");

    if (Number.isFinite(width) && width > 0) {
      image.attr("style", `width:${width}px;max-width:100%;height:auto;`);
    } else if (!image.attr("style")) {
      image.attr("style", "max-width:100%;height:auto;");
    }
  }
}

module.exports = {
  createImageManager,
  localizeImages,
  getImageSource,
};
