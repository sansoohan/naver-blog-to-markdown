const fs = require("fs");
const path = require("path");
const {downloadFirst, getFilenameFromUrl, getUniqueFilename} = require("./downloader");

function decodeLegacyEucKr(value) {
  const source = String(value || "");
  const bytes = [];

  for (let index = 0; index < source.length; index++) {
    if (source[index] === "%" && /^[0-9a-f]{2}$/i.test(source.slice(index + 1, index + 3))) {
      bytes.push(parseInt(source.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(source.charCodeAt(index));
    }
  }

  return new TextDecoder("euc-kr", {fatal: true}).decode(Buffer.from(bytes));
}

function decodeFilename(value) {
  const source = String(value || "");

  try {
    return decodeURIComponent(source);
  } catch {}

  return decodeLegacyEucKr(source);
}

function safeFilename(value, fallback) {
  let filename;

  try {
    filename = decodeFilename(value);
  } catch {
    return fallback;
  }

  filename = filename
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();

  return filename || fallback;
}

function getExtensionFromContentType(contentType, fallback = ".jpg") {
  if (/image\/jpeg/i.test(contentType)) return ".jpg";
  if (/image\/png/i.test(contentType)) return ".png";
  if (/image\/gif/i.test(contentType)) return ".gif";
  if (/image\/webp/i.test(contentType)) return ".webp";
  if (/image\/bmp/i.test(contentType)) return ".bmp";
  if (/image\/svg\+xml/i.test(contentType)) return ".svg";
  if (/image\/avif/i.test(contentType)) return ".avif";

  return fallback;
}

function getExtensionFromBuffer(buffer, contentType = "", fallback = ".jpg") {
  if (!buffer || buffer.length < 4) return getExtensionFromContentType(contentType, fallback);

  const hex = buffer.subarray(0, 16).toString("hex");
  const ascii = buffer.subarray(0, 16).toString("ascii");

  if (hex.startsWith("ffd8ff")) return ".jpg";
  if (hex.startsWith("89504e470d0a1a0a")) return ".png";
  if (ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a")) return ".gif";
  if (ascii.startsWith("BM")) return ".bmp";

  if (ascii.startsWith("RIFF") && buffer.subarray(8, 12).toString("ascii") === "WEBP") return ".webp";
  if (buffer.subarray(4, 12).toString("ascii").includes("ftypavif")) return ".avif";

  const beginning = buffer.subarray(0, 512).toString("utf8").trimStart();

  if (beginning.startsWith("<svg") || (beginning.startsWith("<?xml") && beginning.includes("<svg"))) {
    return ".svg";
  }

  return getExtensionFromContentType(contentType, fallback);
}

function isImageBuffer(buffer, contentType = "") {
  if (!buffer || buffer.length < 4) return false;
  return Boolean(getExtensionFromBuffer(buffer, contentType, ""));
}

function normalizeInputUrl(url) {
  return String(url || "").trim().replace(/&amp;/g, "&");
}

function removeWrappingQuotes(value) {
  return String(value || "").trim().replace(/^["']+|["']+$/g, "");
}

function addUniqueCandidate(candidates, value) {
  const candidate = normalizeInputUrl(value);
  if (!candidate || candidates.includes(candidate)) return;
  candidates.push(candidate);
}

function addProtocolCandidates(candidates, value) {
  try {
    const parsed = new URL(value.startsWith("//") ? `https:${value}` : value);

    if (parsed.protocol === "http:") {
      const httpsUrl = new URL(parsed);
      httpsUrl.protocol = "https:";
      addUniqueCandidate(candidates, httpsUrl.toString());
    } else if (parsed.protocol === "https:") {
      const httpUrl = new URL(parsed);
      httpUrl.protocol = "http:";
      addUniqueCandidate(candidates, httpUrl.toString());
    }
  } catch {}
}

function addNestedImageCandidates(candidates, parsed) {
  const parameterNames = ["src", "url", "image", "imageUrl", "img", "original", "originalUrl"];

  for (const parameterName of parameterNames) {
    const value = parsed.searchParams.get(parameterName);
    if (!value) continue;

    const nestedUrl = removeWrappingQuotes(value);

    if (!/^https?:\/\//i.test(nestedUrl) && !nestedUrl.startsWith("//")) continue;

    addUniqueCandidate(candidates, nestedUrl);
    addProtocolCandidates(candidates, nestedUrl);
  }
}

function addHighResolutionCandidate(candidates, parsed) {
  if (!/(^|\.)pstatic\.net$/i.test(parsed.hostname)) return;
  if (!parsed.searchParams.has("type")) return;

  const highResolutionUrl = new URL(parsed);
  highResolutionUrl.searchParams.set("type", "w2000");

  addUniqueCandidate(candidates, highResolutionUrl.toString());
}

function getImageCandidates(url, options = {}) {
  const {highResolution = false} = options;
  const source = normalizeInputUrl(url);
  const candidates = [];

  if (!source) return candidates;

  if (
    source.startsWith("./")
    || source.startsWith("../")
    || source.startsWith("data:")
    || source.startsWith("blob:")
  ) {
    addUniqueCandidate(candidates, source);
    return candidates;
  }

  addUniqueCandidate(candidates, source);

  try {
    const parsed = new URL(source.startsWith("//") ? `https:${source}` : source);

    addNestedImageCandidates(candidates, parsed);
    if (highResolution) addHighResolutionCandidate(candidates, parsed);
    addProtocolCandidates(candidates, parsed.toString());
  } catch {}

  return candidates;
}

function getNestedFilenameUrl(url) {
  try {
    const parsed = new URL(normalizeInputUrl(url));
    const parameterNames = ["src", "url", "image", "imageUrl", "img", "original", "originalUrl"];

    for (const parameterName of parameterNames) {
      const value = parsed.searchParams.get(parameterName);
      if (!value) continue;

      const nestedUrl = removeWrappingQuotes(value);

      if (/^https?:\/\//i.test(nestedUrl) || nestedUrl.startsWith("//")) return nestedUrl;
    }
  } catch {}

  return "";
}

function getFilenameSource(originalUrl, successfulUrl) {
  const successfulFilename = getFilenameFromUrl(successfulUrl, "");
  if (successfulFilename) return successfulUrl;

  const nestedUrl = getNestedFilenameUrl(originalUrl);
  return nestedUrl || successfulUrl || originalUrl;
}

function shouldSkipImageUrl(value) {
  const source = normalizeInputUrl(value);

  if (!source) return false;

  try {
    const url = new URL(source.startsWith("//") ? `https:${source}` : source);
    const filename = path.posix.basename(url.pathname).toLowerCase();

    return ["btn_urlcopy.gif", "spc.gif", "00ico_lock_p_2.gif"].includes(filename);
  } catch {
    const filename = source.split(/[?#]/)[0].replace(/\\/g, "/").split("/").pop().toLowerCase();

    return ["btn_urlcopy.gif", "spc.gif", "00ico_lock_p_2.gif"].includes(filename);
  }
}

function getImageSources(image) {
  const sources = [];
  const attributes = ["data-lazy-src", "data-original", "data-origin-src", "data-src", "src"];

  for (const attribute of attributes) {
    const value = image.attr(attribute);

    if (value && !shouldSkipImageUrl(value) && !sources.includes(value)) sources.push(value);
  }

  const srcset = image.attr("srcset") || "";

  for (const entry of srcset.split(",")) {
    const value = entry.trim().split(/\s+/)[0];

    if (value && !shouldSkipImageUrl(value) && !sources.includes(value)) sources.push(value);
  }

  return sources;
}

function getImageSource(image) {
  return getImageSources(image)[0] || "";
}

function getImageWidth(image) {
  const width = Number(image.attr("data-width") || image.attr("width"));

  return Number.isFinite(width) && width > 0 ? width : 0;
}

function applyLocalizedImage(image, filename) {
  image.attr("src", `./${filename}`);
  image.removeAttr("data-lazy-src");
  image.removeAttr("data-original");
  image.removeAttr("data-origin-src");
  image.removeAttr("data-src");
  image.removeAttr("srcset");

  const width = getImageWidth(image);

  if (width) {
    image.attr("style", `width:${width}px;max-width:100%;height:auto;`);
  } else if (!image.attr("style")) {
    image.attr("style", "max-width:100%;height:auto;");
  }
}

function replaceWithMissingImage(image) {
  const module = image.closest(".se-module.se-module-image");
  const width = getImageWidth(image);
  const style = width ? `width:${width}px;max-width:100%;` : "";

  const html = [
    `<div class="se-state-error " style="${style}">`,
    '<div class="se-state-error-detail">',
    '<div class="se-state-error-text">존재하지 않는 이미지입니다.</div>',
    "</div>",
    "</div>",
  ].join("");

  if (module.length) {
    module.attr("style", "").empty().append(html);
  } else {
    image.replaceWith(html);
  }
}

function getExistingFile(outputDir, filename) {
  if (!outputDir || !filename) return "";

  const root = path.resolve(outputDir);
  const localPath = path.resolve(root, filename);

  if (localPath !== root && !localPath.startsWith(`${root}${path.sep}`)) return "";

  try {
    if (!fs.statSync(localPath).isFile()) return "";
  } catch {
    return "";
  }

  return filename;
}

function getExistingFilenameCandidates(filename) {
  const candidates = [];

  function add(value) {
    if (!value || candidates.includes(value)) return;
    candidates.push(value);
  }

  add(filename);

  const ext = path.extname(filename);

  if (!ext) {
    add(`${filename}.jpg`);
    add(`${filename}.jpeg`);
    add(`${filename}.png`);
    add(`${filename}.webp`);
    add(`${filename}.gif`);
    add(`${filename}.bmp`);
    add(`${filename}.svg`);
    add(`${filename}.avif`);
  }

  if (ext.toLowerCase() === ".img") {
    const base = path.basename(filename, ext);

    add(`${base}.jpg`);
    add(`${base}.jpeg`);
    add(`${base}.png`);
    add(`${base}.webp`);
    add(`${base}.gif`);
    add(`${base}.bmp`);
    add(`${base}.svg`);
    add(`${base}.avif`);
  }

  return candidates;
}

function getExistingImageFilename(outputDir, originalUrl, candidates, fallback) {
  const filenameUrls = [];

  function addFilenameUrl(value) {
    const source = normalizeInputUrl(value);
    if (!source || filenameUrls.includes(source)) return;
    filenameUrls.push(source);
  }

  const nestedUrl = getNestedFilenameUrl(originalUrl);

  addFilenameUrl(originalUrl);
  addFilenameUrl(nestedUrl);

  for (const candidate of candidates) addFilenameUrl(candidate);

  for (const source of filenameUrls) {
    const rawFilename = getFilenameFromUrl(source, "");
    if (!rawFilename) continue;

    const filename = safeFilename(rawFilename, fallback);
    if (!filename) continue;

    for (const candidateFilename of getExistingFilenameCandidates(filename)) {
      const existingFilename = getExistingFile(outputDir, candidateFilename);

      if (existingFilename) return existingFilename;
    }
  }

  return "";
}

function getLocalImageFilename(image) {
  if (!image || !image.length) return "";

  const source = String(image.attr("src") || "").trim();

  if (!source.startsWith("./") || source.startsWith("../")) return "";

  let filename = source.slice(2).split(/[?#]/)[0];

  try {
    filename = decodeURIComponent(filename);
  } catch {}

  filename = filename.replace(/\//g, path.sep);

  if (!filename || path.isAbsolute(filename)) return "";
  if (filename.split(path.sep).includes("..")) return "";

  return filename;
}

function normalizeImageIdentityUrl(value) {
  const source = normalizeInputUrl(value);
  if (!source) return "";

  try {
    const url = new URL(source.startsWith("//") ? `https:${source}` : source);

    url.protocol = "https:";
    url.hash = "";

    if (/(^|\.)pstatic\.net$/i.test(url.hostname)) url.searchParams.delete("type");

    return url.toString();
  } catch {
    return source;
  }
}

function getImageIdentityUrls(image) {
  const identities = [];

  function add(value) {
    const normalized = normalizeImageIdentityUrl(value);
    if (!normalized || identities.includes(normalized)) return;
    identities.push(normalized);
  }

  for (const source of getImageSources(image)) {
    add(source);

    const nestedUrl = getNestedFilenameUrl(source);
    if (nestedUrl) add(nestedUrl);
  }

  return identities;
}

function imagesHaveSameIdentity(currentImage, previousImage) {
  const currentIdentities = getImageIdentityUrls(currentImage);
  const previousIdentities = getImageIdentityUrls(previousImage);

  if (!currentIdentities.length || !previousIdentities.length) return false;

  return currentIdentities.some(identity => previousIdentities.includes(identity));
}

function getComponentInfo($, image, root) {
  const component = image.closest(".se-component");
  if (!component.length) return null;

  const componentElement = component.get(0);
  const components = root.find(".se-component").add(root.filter(".se-component")).toArray();
  const componentIndex = components.indexOf(componentElement);

  if (componentIndex < 0) return null;

  const componentImages = component.find("img").filter((index, element) => {
    return !$(element).closest(".se-component.se-video").length;
  }).toArray();

  const imageIndex = componentImages.indexOf(image.get(0));
  if (imageIndex < 0) return null;

  return {
    componentIndex,
    imageIndex,
  };
}

function findPreviousImageByComponent($, image, root, previous$, previousRoot, outputDir) {
  if (!previous$ || !previousRoot) return "";

  const info = getComponentInfo($, image, root);
  if (!info) return "";

  const previousComponents = previousRoot.find(".se-component").add(previousRoot.filter(".se-component")).toArray();
  const previousComponentElement = previousComponents[info.componentIndex];

  if (!previousComponentElement) return "";

  const previousComponent = previous$(previousComponentElement);

  const previousImages = previousComponent.find("img").filter((index, element) => {
    return !previous$(element).closest(".se-component.se-video").length;
  }).toArray();

  const previousImageElement = previousImages[info.imageIndex];
  if (!previousImageElement) return "";

  const previousImage = previous$(previousImageElement);

  if (!imagesHaveSameIdentity(image, previousImage)) return "";

  const filename = getLocalImageFilename(previousImage);
  if (!filename) return "";

  return getExistingFile(outputDir, filename);
}

function createImageManager(outputDir, managerOptions = {}) {
  const cache = new Map();
  let fallbackIndex = 0;

  async function downloadImage(url, options = {}) {
    const {
      highResolution = false,
      fallbackPrefix = "image",
      timeout = 1000,
      previousFilename = "",
    } = options;

    if (!url) return "";
    if (url.startsWith("./")) return url.slice(2);

    /*
     * previous original.html과 정확히 대응되고 원격 이미지 identity까지 같은 이미지가 있으면
     * URL cache보다 먼저 기존 파일을 사용한다.
     *
     * 같은 URL을 사용하는 여러 이미지가
     * image.png / image_2.png / image_3.png처럼 서로 다른 파일로 저장되어 있을 수 있으므로
     * 이 경로에서는 URL 기반 메모리 cache를 사용하거나 기록하면 안 된다.
     */
    if (previousFilename) {
      const existingPreviousFilename = getExistingFile(outputDir, previousFilename);

      if (existingPreviousFilename) {
        console.log(`이미지 기존 HTML 재사용: ${existingPreviousFilename}`);
        return existingPreviousFilename;
      }
    }

    const candidates = getImageCandidates(url, {highResolution});

    if (!candidates.length || candidates[0].startsWith("data:") || candidates[0].startsWith("blob:")) {
      return "";
    }

    const cacheKey = JSON.stringify(candidates);

    /*
     * previousFilename으로 처리되지 않은 일반적인 이미지에 대해서만
     * URL 기반 메모리 cache를 사용한다.
     */
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    fallbackIndex++;

    const fallback = `${fallbackPrefix}-${String(fallbackIndex).padStart(3, "0")}`;
    const filenameSource = getFilenameSource(url, candidates[0]);

    let filename = safeFilename(getFilenameFromUrl(filenameSource, fallback), fallback);
    if (!path.extname(filename)) filename += ".img";

    try {
      const result = await downloadFirst(candidates, {
        outputDir,
        filename,
        fallbackFilename: filename,
        timeout,
        logLabel: "이미지",
        headers: {
          "User-Agent": "Mozilla/5.0",
          Referer: "https://blog.naver.com/",
          Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
        validate: async (buffer, {contentType}) => {
          if (!isImageBuffer(buffer, contentType)) {
            throw new Error(`이미지가 아닌 응답: ${contentType || "unknown"}`);
          }
        },
        resolveFilename: ({buffer, contentType}) => {
          if (path.extname(filename).toLowerCase() !== ".img") return filename;

          const extension = getExtensionFromBuffer(buffer, contentType, ".jpg");
          return `${path.basename(filename, ".img")}${extension}`;
        },
      });

      cache.set(cacheKey, result.filename);
      return result.filename;
    } catch (error) {
      throw error;
    }
  }

  return {
    outputDir,
    download: downloadImage,
  };
}

async function downloadFromImageSources(imageManager, sources, options) {
  const failures = [];

  for (const source of sources) {
    if (
      source.startsWith("./")
      || source.startsWith("../")
      || source.startsWith("data:")
      || source.startsWith("blob:")
    ) {
      continue;
    }

    try {
      const filename = await imageManager.download(source, options);
      if (filename) return {filename, source};
    } catch (error) {
      failures.push(`${source} → ${error.message}`);
    }
  }

  if (failures.length) throw new Error(failures.join("\n"));

  return {filename: "", source: ""};
}

async function localizeImages($, root, imageManager, options = {}) {
  const {
    editorVersion = 0,
    previous$ = null,
    previousRoot = null,
  } = options;

  const images = root.find("img").add(root.filter("img")).toArray();

  for (const element of images) {
    const image = $(element);

    // Naver 동영상 poster는 video.js에서 별도로 처리한다.
    if (image.closest(".se-component.se-video").length) continue;

    const sources = getImageSources(image);
    if (!sources.length) continue;

    const isOgImage = Boolean(image.closest(".se-oglink,.og").length);

    let previousFilename = "";

    /*
     * previous original.html이 있으면 기존 이미지 재사용을 시도한다.
     *
     * findPreviousImageByComponent() 내부에서 현재/이전 이미지의 원격 URL identity를 비교하므로
     * 단순히 같은 위치에 있다는 이유만으로 다른 이미지를 잘못 재사용하지 않는다.
     */
    if (previous$ && previousRoot) {
      previousFilename = findPreviousImageByComponent(
        $,
        image,
        root,
        previous$,
        previousRoot,
        imageManager.outputDir
      );
    }

    let downloaded;

    try {
      downloaded = await downloadFromImageSources(imageManager, sources, {
        editorVersion,
        highResolution: !isOgImage,
        fallbackPrefix: isOgImage ? "og-thumb" : "image",
        previousFilename,
      });
    } catch (error) {
      console.warn(`이미지 다운로드 실패: ${sources.join(", ")}`);
      console.warn(error.message);

      if (isOgImage) {
        image.attr("data-download-error", "true");
      } else {
        replaceWithMissingImage(image);
      }

      continue;
    }

    if (!downloaded.filename) {
      if (isOgImage) {
        image.attr("data-download-error", "true");
      } else {
        replaceWithMissingImage(image);
      }

      continue;
    }

    applyLocalizedImage(image, downloaded.filename);
  }
}

module.exports = {
  createImageManager,
  localizeImages,
  getImageSource,
  getImageSources,
  getImageCandidates,
};
