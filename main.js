const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const TurndownService = require("turndown");

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

function parsePostUrl(input) {
  const url = new URL(input);
  const parts = url.pathname.split("/").filter(Boolean);

  if (parts.length >= 2 && /^\d+$/.test(parts[1])) return { blogId: parts[0], logNo: parts[1] };

  const blogId = url.searchParams.get("blogId");
  const logNo = url.searchParams.get("logNo");

  if (blogId && logNo) return { blogId, logNo };
  throw new Error(`지원하지 않는 네이버 블로그 URL: ${input}`);
}

function safeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 180);
}

function escapeHtmlAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlText(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// YouTube URL 시작 시간 추출
// t=65 / t=65s / t=1m5s / t=1h2m3s / start=65
function getYouTubeStartSeconds(inputUrl) {
  if (!inputUrl) return null;

  try {
    const url = new URL(inputUrl);

    const start = url.searchParams.get("start");
    if (start && /^\d+$/.test(start)) return Number(start);

    const t = url.searchParams.get("t");
    if (!t) return null;

    if (/^\d+s?$/.test(t)) return Number(t.replace(/s$/, ""));

    const match = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    if (!match) return null;

    const hours = Number(match[1] || 0);
    const minutes = Number(match[2] || 0);
    const seconds = Number(match[3] || 0);
    const total = hours * 3600 + minutes * 60 + seconds;

    return total > 0 ? total : null;
  } catch {
    return null;
  }
}

function applyYouTubeStartTime(iframeHtml, startSeconds) {
  if (!iframeHtml || !startSeconds || startSeconds <= 0) return iframeHtml;

  return iframeHtml.replace(/src="([^"]+)"/i, (whole, src) => {
    if (/[?&]start=\d+/i.test(src)) return whole;

    const separator = src.includes("?") ? "&" : "?";
    return `src="${src}${separator}start=${startSeconds}"`;
  });
}

function cleanMarkdown(markdown) {
  return markdown
    .replace(/\u200b/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/^([ \t]*[-*+] .+)\n{2,}(?=[ \t]*[-*+] )/gm, "$1\n")
    .replace(/^([ \t]*\\[-*+] .+)\n{2,}(?=[ \t]*\\[-*+] )/gm, "$1\n")
    .replace(/^([ \t]*\d+\\?\. .+)\n{2,}(?=[ \t]*\d+\\?\. )/gm, "$1\n")
    .replace(/(?:<br>\s*){3,}/g, "<br>\n<br>\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getImageExtension(contentType, imageUrl) {
  const type = (contentType || "").split(";")[0].trim().toLowerCase();

  switch (type) {
    case "image/jpeg": return ".jpg";
    case "image/png": return ".png";
    case "image/gif": return ".gif";
    case "image/webp": return ".webp";
    case "image/bmp": return ".bmp";
    case "image/svg+xml": return ".svg";
    case "image/avif": return ".avif";
  }

  try {
    const ext = path.extname(new URL(imageUrl).pathname).toLowerCase();

    if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".avif"].includes(ext)) {
      return ext === ".jpeg" ? ".jpg" : ext;
    }
  } catch {}

  return ".jpg";
}

// 일반 본문 이미지 → w2000
function normalizePostImageUrl(src) {
  if (!src) return null;
  if (src.startsWith("data:") || src.startsWith("blob:")) return null;
  if (src.startsWith("//")) src = `https:${src}`;

  try {
    const url = new URL(src);
    url.searchParams.set("type", "w2000");
    return url.toString();
  } catch {
    return src;
  }
}

// OG 썸네일 → 네이버가 제공하는 썸네일 URL 그대로 사용
function normalizeThumbnailUrl(src) {
  if (!src) return null;
  if (src.startsWith("data:") || src.startsWith("blob:")) return null;
  if (src.startsWith("//")) src = `https:${src}`;

  return src;
}

async function downloadImage(imageUrl, outputDir, number, type) {
  const response = await fetch(imageUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      Referer: "https://blog.naver.com/",
    },
  });

  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);

  const contentType = response.headers.get("content-type") || "";
  const extension = getImageExtension(contentType, imageUrl);
  const prefix = type === "thumbnail" ? "thumb" : "image";
  const filename = `${prefix}-${String(number).padStart(3, "0")}${extension}`;
  const buffer = Buffer.from(await response.arrayBuffer());

  fs.writeFileSync(path.join(outputDir, filename), buffer);

  return { filename, size: buffer.length };
}

function normalizeNaverHtml($, content) {
  const images = [];

  // YouTube oEmbed
  content.find(".se-component.se-oembed").each((_, el) => {
    const $component = $(el);
    const $data = $component.find("script.__se_module_data").first();

    if (!$data.length) return;

    const raw = $data.attr("data-module-v2") || $data.attr("data-module");
    if (!raw) return;

    let moduleData;

    try {
      moduleData = JSON.parse(raw);
    } catch (error) {
      console.warn("oEmbed 데이터 파싱 실패:", error.message);
      return;
    }

    const data = moduleData.data;
    if (!data || data.providerName !== "YouTube") return;

    const inputUrl = data.inputUrl || "";
    let iframeHtml = data.html || "";

    if (!iframeHtml) return;

    const startSeconds = getYouTubeStartSeconds(inputUrl);
    iframeHtml = applyYouTubeStartTime(iframeHtml, startSeconds);

    const encodedIframe = Buffer.from(iframeHtml, "utf8").toString("base64");
    $component.replaceWith(`NAVEROEMBEDSTART${encodedIframe}NAVEROEMBEDEND`);
  });

  // OG 링크 미리보기 → table 카드
  content.find(".se-component.se-oglink").each((_, el) => {
    const $component = $(el);
    const $link = $component.find("a[href]").first();
    const href = $link.attr("href");

    if (!href) {
      $component.remove();
      return;
    }

    const title =
      $component.find(".se-oglink-title").first().text().trim() ||
      $component.find("strong").first().text().trim() ||
      href;

    const description =
      $component.find(".se-oglink-summary").first().text().trim() ||
      $component.find(".se-oglink-description").first().text().trim() ||
      "";

    let domain =
      $component.find(".se-oglink-url").first().text().trim() ||
      $component.find(".se-oglink-domain").first().text().trim();

    if (!domain) {
      try {
        domain = new URL(href).hostname.replace(/^www\./, "");
      } catch {
        domain = "";
      }
    }

    // OG 썸네일
    const $img = $component.find("img").first();
    let imageSrc = $img.attr("data-lazy-src") || $img.attr("data-src") || $img.attr("src");
    let imageToken = null;

    imageSrc = normalizeThumbnailUrl(imageSrc);

    if (imageSrc) {
      const index = images.length;
      imageToken = `NAVERIMAGE${index}END`;

      images.push({
        token: imageToken,
        url: imageSrc,
        type: "thumbnail",
      });
    }

    const safeHref = escapeHtmlAttribute(href);
    const safeTitle = escapeHtmlText(title);
    const safeDescription = escapeHtmlText(description);
    const safeDomain = escapeHtmlText(domain);

    let infoHtml = `<a href="${safeHref}" target="_blank"><strong>${safeTitle}</strong></a>`;

    if (safeDescription) infoHtml += `<br><br><span>${safeDescription}</span>`;
    if (safeDomain) infoHtml += `<br><br><small>${safeDomain}</small>`;

    let cardHtml;

    if (imageToken) {
      cardHtml =
        `<table>` +
        `<tbody><tr>` +
        `<td width="180" valign="middle"><a href="${safeHref}" target="_blank"><img src="${imageToken}" width="180"></a></td>` +
        `<td valign="middle">${infoHtml}</td>` +
        `</tr></tbody>` +
        `</table>`;
    } else {
      cardHtml =
        `<table>` +
        `<tbody><tr>` +
        `<td>${infoHtml}</td>` +
        `</tr></tbody>` +
        `</table>`;
    }

    const encodedCard = Buffer.from(cardHtml, "utf8").toString("base64");
    $component.replaceWith(`NAVEROGCARDSTART${encodedCard}NAVEROGCARDEND`);
  });

  // 불필요 요소 제거
  content.find("script, style, noscript").remove();

  // 일반 본문 이미지
  content.find("img").each((_, img) => {
    const $img = $(img);
    let src = $img.attr("data-lazy-src") || $img.attr("data-src") || $img.attr("src");

    src = normalizePostImageUrl(src);
    if (!src) return;

    const index = images.length;
    const token = `NAVERIMAGE${index}END`;

    images.push({
      token,
      url: src,
      type: "image",
    });

    $img.attr("src", token);
    $img.removeAttr("data-lazy-src");
    $img.removeAttr("data-src");
  });

  // href 없는 의미 없는 이미지 링크만 제거
  content.find("a").each((_, a) => {
    const $a = $(a);
    const href = $a.attr("href");

    if ((!href || href === "#") && $a.find("img").length) {
      $a.replaceWith($a.contents());
    }
  });

  return images;
}

function createTurndown() {
  const turndown = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    strongDelimiter: "**",
  });

  // 원래 본문의 <a> 링크 보존
  turndown.addRule("preserveLinks", {
    filter: "a",

    replacement(content, node) {
      const href = node.getAttribute("href");
      if (!href) return content;

      let attrs = `href="${escapeHtmlAttribute(href)}"`;

      const target = node.getAttribute("target");
      const title = node.getAttribute("title");

      if (target) attrs += ` target="${escapeHtmlAttribute(target)}"`;
      if (title) attrs += ` title="${escapeHtmlAttribute(title)}"`;

      return `<a ${attrs}>${content}</a>`;
    },
  });

  // 네이버 글자 크기
  turndown.addRule("naverFontSize", {
    filter(node) {
      if (node.nodeName !== "SPAN") return false;

      const className = node.getAttribute("class") || "";
      return /\bse-fs-fs\d+\b/.test(className);
    },

    replacement(content, node) {
      const className = node.getAttribute("class") || "";
      const match = className.match(/\bse-fs-fs(\d+)\b/);

      if (!match) return content;

      const size = Number(match[1]);
      const text = content.replace(/\u200b/g, "").trim();

      if (!text) return "";

      switch (size) {
        case 13: return text;
        case 15: return `\n\n#### ${text}\n\n`;
        case 16: return `\n\n### ${text}\n\n`;
        case 19: return `\n\n## ${text}\n\n`;
        case 24: return `\n\n# ${text}\n\n`;
        default: return `<span style="font-size:${size}px">${text}</span>`;
      }
    },
  });

  // 이미지
  turndown.addRule("naverImage", {
    filter: "img",

    replacement(content, node) {
      const src = node.getAttribute("src");
      if (!src) return "";

      return `\n\n![](${src})\n\n`;
    },
  });

  // 네이버 문단
  turndown.addRule("naverParagraph", {
    filter(node) {
      return (
        node.nodeName === "P" &&
        (node.getAttribute("class") || "").includes("se-text-paragraph") &&
        node.parentNode?.nodeName !== "LI"
      );
    },

    replacement(content) {
      const text = content.replace(/\u200b/g, "").trim();

      if (!text) return "\nNAVEREMPTYLINE\n";
      return `${text}\n`;
    },
  });

  return turndown;
}

// 네이버 빈 문단 복원
// 연속 빈 문단은 <br> 최대 2개
function restoreEmptyLines(markdown) {
  return markdown.replace(/(?:\s*NAVEREMPTYLINE\s*)+/g, (match) => {
    const count = (match.match(/NAVEREMPTYLINE/g) || []).length;

    if (count === 1) return "\n\n";
    if (count === 2) return "\n\n<br>\n\n";

    return "\n\n<br>\n<br>\n\n";
  });
}

// YouTube iframe 복원
function restoreOEmbed(markdown) {
  return markdown.replace(/NAVEROEMBEDSTART([A-Za-z0-9+/=]+)NAVEROEMBEDEND/g, (_, encodedIframe) => {
    try {
      const iframeHtml = Buffer.from(encodedIframe, "base64").toString("utf8");
      return `\n\n${iframeHtml}\n\n`;
    } catch (error) {
      console.warn("oEmbed 복원 실패:", error.message);
      return "";
    }
  });
}

// OG 카드 복원
function restoreOgCards(markdown) {
  return markdown.replace(/NAVEROGCARDSTART([A-Za-z0-9+/=]+)NAVEROGCARDEND/g, (_, encodedCard) => {
    try {
      const cardHtml = Buffer.from(encodedCard, "base64").toString("utf8");
      return `\n\n${cardHtml}\n\n`;
    } catch (error) {
      console.warn("OG 카드 복원 실패:", error.message);
      return "";
    }
  });
}

// 이미지 + 썸네일 다운로드
// image / thumbnail 번호는 각각 따로 증가
async function localizeImages(markdown, images, outputDir) {
  let result = markdown;
  let imageNumber = 0;
  let thumbnailNumber = 0;

  for (const image of images) {
    let number;

    if (image.type === "thumbnail") {
      thumbnailNumber++;
      number = thumbnailNumber;
    } else {
      imageNumber++;
      number = imageNumber;
    }

    try {
      const downloaded = await downloadImage(image.url, outputDir, number, image.type);

      console.log(`${image.type === "thumbnail" ? "썸네일" : "이미지"}: ${downloaded.filename} (${downloaded.size} bytes)`);
      result = result.replaceAll(image.token, downloaded.filename);
    } catch (error) {
      console.warn(`${image.type === "thumbnail" ? "썸네일" : "이미지"} 다운로드 실패: ${image.url}`);
      console.warn(`  ${error.message}`);

      result = result.replaceAll(image.token, image.url);
    }
  }

  return result;
}

async function getPost(inputUrl) {
  const { blogId, logNo } = parsePostUrl(inputUrl);

  const postUrl =
    "https://blog.naver.com/PostView.naver" +
    `?blogId=${encodeURIComponent(blogId)}` +
    `&logNo=${encodeURIComponent(logNo)}`;

  console.log(`가져오는 중: ${postUrl}`);

  const response = await fetch(postUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      Referer: "https://blog.naver.com/",
    },
  });

  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);

  const html = await response.text();
  const $ = cheerio.load(html);

  // 제목
  let title =
    $('meta[property="og:title"]').attr("content") ||
    $(".se-title-text").text().trim() ||
    $("title").text().trim() ||
    `${blogId}-${logNo}`;

  title = title.replace(/\s*:\s*네이버 블로그\s*$/, "").trim();

  // 카테고리
  const categoryLink = $(".blog2_series a").first();
  let categoryName = categoryLink.text().trim();
  let categoryNo = null;

  const categoryHref = categoryLink.attr("href");

  if (categoryHref) {
    try {
      const categoryUrl = new URL(categoryHref, "https://blog.naver.com");
      categoryNo = categoryUrl.searchParams.get("categoryNo");
    } catch {
      categoryNo = null;
    }
  }

  if (!categoryName) categoryName = "미분류";

  console.log(`카테고리: ${categoryName}${categoryNo ? ` (${categoryNo})` : ""}`);

  // 본문
  let content = $(".se-main-container").first();

  if (!content.length) content = $("#postViewArea").first();
  if (!content.length) content = $(".se3_view").first();
  if (!content.length) throw new Error("본문 영역을 찾지 못했습니다.");

  const images = normalizeNaverHtml($, content);

  const turndown = createTurndown();
  let bodyMarkdown = turndown.turndown(content.html() || "");

  bodyMarkdown = restoreEmptyLines(bodyMarkdown);
  bodyMarkdown = cleanMarkdown(bodyMarkdown);

  bodyMarkdown = restoreOEmbed(bodyMarkdown);
  bodyMarkdown = restoreOgCards(bodyMarkdown);

  bodyMarkdown = cleanMarkdown(bodyMarkdown);

  const markdown = [
    `# ${title}`,
    "",
    `> 원본: https://blog.naver.com/${blogId}/${logNo}`,
    "",
    bodyMarkdown,
    "",
  ].join("\n");

  return {
    title,
    blogId,
    logNo,
    categoryName,
    categoryNo,
    markdown,
    images,
  };
}

async function main() {
  const inputUrl = process.argv[2];
  const dest = process.argv[3] || "output";

  if (!inputUrl) {
    console.log("사용법:\nnode main.js <네이버 블로그 글 URL> [저장폴더]");
    process.exit(1);
  }

  const post = await getPost(inputUrl);

  const postFolderName = safeFilename(post.title) || `${post.blogId}-${post.logNo}`;
  const categoryFolder = safeFilename(post.categoryName) || "미분류";
  const postDir = path.join(dest, categoryFolder, postFolderName);

  fs.mkdirSync(postDir, { recursive: true });

  post.markdown = await localizeImages(post.markdown, post.images, postDir);
  post.markdown = cleanMarkdown(post.markdown) + "\n";

  const outputPath = path.join(postDir, "index.md");

  fs.writeFileSync(outputPath, post.markdown, "utf8");

  console.log("");
  console.log(`완료: ${outputPath}`);
  console.log(`글자 수: ${post.markdown.length}`);
}

main().catch((error) => {
  console.error("");
  console.error("실패:", error.message);
  console.error(error.stack);
  process.exit(1);
});