const fs = require("fs");
const path = require("path");

function getExtension(url, fallback = ".jpg") {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname);

    if (ext && ext.length <= 6) return ext.toLowerCase();
  } catch {}

  return fallback;
}

async function downloadFile(url, destination) {
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
  fs.writeFileSync(destination, buffer);
}

function getImageSource(image) {
  return (
    image.attr("data-lazy-src") ||
    image.attr("data-src") ||
    image.attr("src") ||
    ""
  );
}

function highResolutionImageUrl(url) {
  if (!url) return "";

  try {
    const parsed = new URL(url);
    parsed.searchParams.set("type", "w2000");
    return parsed.toString();
  } catch {
    return url;
  }
}

async function localizeImages($, root, outputDir) {
  let imageIndex = 0;
  const images = root.find("img").toArray();

  for (const element of images) {
    const image = $(element);

    if (image.closest(".se-oglink").length) continue;
    if (image.closest(".se-component.se-video").length) continue;

    const source = getImageSource(image);
    if (!source) continue;

    imageIndex++;

    const ext = getExtension(source);
    const filename = `image-${String(imageIndex).padStart(3, "0")}${ext}`;
    const destination = path.join(outputDir, filename);

    try {
      await downloadFile(highResolutionImageUrl(source), destination);
    } catch {
      imageIndex--;
      continue;
    }

    const width = Number(image.attr("data-width"));

    image.attr("src", `./${filename}`);
    image.removeAttr("data-lazy-src");
    image.removeAttr("data-src");
    image.removeAttr("srcset");

    if (Number.isFinite(width) && width > 0) {
      image.attr(
        "style",
        `width:${width}px;max-width:100%;height:auto;`
      );
    } else {
      image.attr("style", "max-width:100%;height:auto;");
    }
  }
}

module.exports = {
  localizeImages,
};
