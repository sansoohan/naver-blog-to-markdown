const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const TurndownService = require("turndown");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

function parsePostUrl(input) {
  const url = new URL(input), parts = url.pathname.split("/").filter(Boolean);
  if (parts.length >= 2 && /^\d+$/.test(parts[1])) return { blogId: parts[0], logNo: parts[1] };
  const blogId = url.searchParams.get("blogId"), logNo = url.searchParams.get("logNo");
  if (blogId && logNo) return { blogId, logNo };
  throw new Error(`지원하지 않는 네이버 블로그 URL: ${input}`);
}

function safeFilename(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").replace(/[. ]+$/g, "").trim().slice(0, 180);
}

function escapeHtmlAttribute(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlText(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function getStyleProperty(style, property) {
  if (!style) return null;

  for (const declaration of style.split(";")) {
    const index = declaration.indexOf(":");
    if (index === -1) continue;

    const name = declaration.slice(0, index).trim().toLowerCase();
    const value = declaration.slice(index + 1).trim();

    if (name === property.toLowerCase() && value) return value;
  }

  return null;
}

function protectLeadingSpaces(html) {
  const pattern = /(<(?:span|strike|s|del)\b[^>]*>)([ \t]+)/gi;
  return html.replace(pattern, (_, tag, spaces) => `${tag}NAVERLEADINGSPACE${spaces.length}END`);
}

function restoreLeadingSpaces(text) {
  return text.replace(/NAVERLEADINGSPACE(\d+)END/g, (_, n) => " ".repeat(Number(n))).replace(/\u00a0/g, " ");
}

function normalizeNaverCheckbox(text) {
  text = text.replace(/\u00a0/g, " ");
  text = text.replace(/^([ \t]*)\\?-\s+\\?\[([xX ])\\?\]\s*/, (_, indent, checked) => {
    return `${indent}- [${checked}] `;
  });
  return text.replace(/^([ \t]*)\\-\s+/, "$1- ");
}

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

    const total = Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
    return total > 0 ? total : null;
  } catch {
    return null;
  }
}

function applyYouTubeStartTime(iframeHtml, startSeconds) {
  if (!iframeHtml || !startSeconds || startSeconds <= 0) return iframeHtml;

  return iframeHtml.replace(/src="([^"]+)"/i, (whole, src) => {
    if (/[?&]start=\d+/i.test(src)) return whole;
    return `src="${src}${src.includes("?") ? "&" : "?"}start=${startSeconds}"`;
  });
}

function cleanMarkdown(markdown) {
  return markdown
    .replace(/\u200b/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/^([ \t]*[-*+] .+)\n{2,}(?=[ \t]*[-*+] )/gm, "$1\n")
    .replace(/^([ \t]*\d+\. .+)\n{2,}(?=[ \t]*\d+\. )/gm, "$1\n")
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
    const allowed = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".avif"];
    if (allowed.includes(ext)) return ext === ".jpeg" ? ".jpg" : ext;
  } catch {}

  return ".jpg";
}

function normalizePostImageUrl(src) {
  if (!src || src.startsWith("data:") || src.startsWith("blob:")) return null;
  if (src.startsWith("//")) src = `https:${src}`;

  try {
    const url = new URL(src);
    url.searchParams.set("type", "w2000");
    return url.toString();
  } catch {
    return src;
  }
}

function normalizeThumbnailUrl(src) {
  if (!src || src.startsWith("data:") || src.startsWith("blob:")) return null;
  return src.startsWith("//") ? `https:${src}` : src;
}

async function downloadImage(imageUrl, outputDir, number, type) {
  const headers = { "User-Agent": USER_AGENT, Referer: "https://blog.naver.com/" };
  const response = await fetch(imageUrl, { headers });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);

  const extension = getImageExtension(response.headers.get("content-type") || "", imageUrl);
  const prefix = type === "thumbnail" ? "thumb" : "image";
  const filename = `${prefix}-${String(number).padStart(3, "0")}${extension}`;
  const buffer = Buffer.from(await response.arrayBuffer());

  fs.writeFileSync(path.join(outputDir, filename), buffer);
  return { filename, size: buffer.length };
}

async function getNaverVideoSource(vid, inkey) {
  const id = encodeURIComponent(vid), key = encodeURIComponent(inkey);
  const apiUrl = `https://apis.naver.com/rmcnmv/rmcnmv/vod/play/v2.0/${id}?key=${key}`;
  const headers = { "User-Agent": USER_AGENT, Referer: "https://blog.naver.com/" };
  const response = await fetch(apiUrl, { headers });

  if (!response.ok) throw new Error(`VOD API HTTP ${response.status} ${response.statusText}`);

  const data = await response.json();
  const videos = data.videos?.list || [];
  if (!videos.length) throw new Error("재생 가능한 MP4를 찾지 못했습니다.");

  const sorted = [...videos].sort((a, b) => {
    const aw = Number(a.encodingOption?.width || 0), ah = Number(a.encodingOption?.height || 0);
    const bw = Number(b.encodingOption?.width || 0), bh = Number(b.encodingOption?.height || 0);
    return bw * bh - aw * ah;
  });

  const best = sorted[0];

  return {
    url: best.source,
    width: Number(best.encodingOption?.width || 0),
    height: Number(best.encodingOption?.height || 0),
    size: Number(best.size || 0),
  };
}

async function downloadVideo(videoUrl, outputDir, number) {
  const filename = `video-${String(number).padStart(3, "0")}.mp4`;
  const headers = { "User-Agent": USER_AGENT, Referer: "https://blog.naver.com/" };
  const response = await fetch(videoUrl, { headers });

  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(path.join(outputDir, filename), buffer);

  return { filename, size: buffer.length };
}

async function downloadVideoThumbnail(thumbnailUrl, outputDir, number) {
  const headers = { "User-Agent": USER_AGENT, Referer: "https://blog.naver.com/" };
  const response = await fetch(thumbnailUrl, { headers });

  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);

  const extension = getImageExtension(response.headers.get("content-type") || "", thumbnailUrl);
  const filename = `video-thumb-${String(number).padStart(3, "0")}${extension}`;
  const buffer = Buffer.from(await response.arrayBuffer());

  fs.writeFileSync(path.join(outputDir, filename), buffer);
  return { filename, size: buffer.length };
}

function normalizeNaverHtml($, content) {
  const images = [], videos = [];

  content.find(".se-component.se-oembed").each((_, el) => {
    const $component = $(el), $data = $component.find("script.__se_module_data").first();
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

    let iframeHtml = data.html || "";
    if (!iframeHtml) return;

    iframeHtml = applyYouTubeStartTime(iframeHtml, getYouTubeStartSeconds(data.inputUrl || ""));
    const encodedIframe = Buffer.from(iframeHtml, "utf8").toString("base64");

    $component.replaceWith(`NAVEROEMBEDSTART${encodedIframe}NAVEROEMBEDEND`);
  });

  content.find(".se-component.se-video").each((_, el) => {
    const $component = $(el), $data = $component.find("script.__se_module_data").first();
    if (!$data.length) return;

    const raw = $data.attr("data-module-v2") || $data.attr("data-module");
    if (!raw) return;

    let moduleData;

    try {
      moduleData = JSON.parse(raw);
    } catch (error) {
      console.warn("동영상 데이터 파싱 실패:", error.message);
      return;
    }

    const data = moduleData.data || moduleData;
    if (!data.vid || !data.inkey) return;

    const index = videos.length, token = `NAVERVIDEO${index}END`;

    videos.push({
      token,
      vid: data.vid,
      inkey: data.inkey,
      thumbnail: normalizeThumbnailUrl(data.thumbnail || ""),
      title: data.title || "",
      originalWidth: Number(data.originalWidth || 0),
      originalHeight: Number(data.originalHeight || 0),
    });

    $component.replaceWith(token);
  });

  content.find(".se-component.se-oglink").each((_, el) => {
    const $component = $(el), $link = $component.find("a[href]").first(), href = $link.attr("href");

    if (!href) {
      $component.remove();
      return;
    }

    const title = $component.find(".se-oglink-title").first().text().trim()
      || $component.find("strong").first().text().trim() || href;

    const description = $component.find(".se-oglink-summary").first().text().trim()
      || $component.find(".se-oglink-description").first().text().trim() || "";

    let domain = $component.find(".se-oglink-url").first().text().trim()
      || $component.find(".se-oglink-domain").first().text().trim();

    if (!domain) {
      try {
        domain = new URL(href).hostname.replace(/^www\./, "");
      } catch {
        domain = "";
      }
    }

    const $img = $component.find("img").first();
    let imageSrc = $img.attr("data-lazy-src") || $img.attr("data-src") || $img.attr("src");
    let imageToken = null;

    imageSrc = normalizeThumbnailUrl(imageSrc);

    if (imageSrc) {
      const index = images.length;
      imageToken = `NAVERIMAGE${index}END`;
      images.push({ token: imageToken, url: imageSrc, type: "thumbnail" });
    }

    const safeHref = escapeHtmlAttribute(href), safeTitle = escapeHtmlText(title);
    const safeDescription = escapeHtmlText(description), safeDomain = escapeHtmlText(domain);

    let infoHtml = `<a href="${safeHref}" target="_blank"><strong>${safeTitle}</strong></a>`;
    if (safeDescription) infoHtml += `<br><br><span>${safeDescription}</span>`;
    if (safeDomain) infoHtml += `<br><br><small>${safeDomain}</small>`;

    const cardHtml = imageToken
      ? `<table><tbody><tr><td width="180" valign="middle"><a href="${safeHref}" target="_blank">`
        + `<img src="${imageToken}" width="180"></a></td><td valign="middle">${infoHtml}</td></tr></tbody></table>`
      : `<table><tbody><tr><td>${infoHtml}</td></tr></tbody></table>`;

    const encodedCard = Buffer.from(cardHtml, "utf8").toString("base64");
    $component.replaceWith(`NAVEROGCARDSTART${encodedCard}NAVEROGCARDEND`);
  });

  content.find("script, style, noscript").remove();

  content.find("img").each((_, img) => {
    const $img = $(img);
    let src = $img.attr("data-lazy-src") || $img.attr("data-src") || $img.attr("src");

    src = normalizePostImageUrl(src);
    if (!src) return;

    const index = images.length, token = `NAVERIMAGE${index}END`;
    const width = Number($img.attr("data-width")) || null;
    const height = Number($img.attr("data-height")) || null;

    images.push({ token, url: src, type: "image", width, height });

    $img.attr("src", token);
    if (width) $img.attr("width", String(width));
    if (height) $img.attr("height", String(height));

    $img.removeAttr("data-lazy-src");
    $img.removeAttr("data-src");
  });

  content.find("a").each((_, a) => {
    const $a = $(a), href = $a.attr("href");
    if ((!href || href === "#") && $a.find("img").length) $a.replaceWith($a.contents());
  });

  return { images, videos };
}

function createTurndown() {
  const turndown = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    strongDelimiter: "**",
  });

  turndown.addRule("preserveLinks", {
    filter: "a",
    replacement(content, node) {
      const href = node.getAttribute("href");
      if (!href) return content;

      let attrs = `href="${escapeHtmlAttribute(href)}"`;
      const target = node.getAttribute("target"), title = node.getAttribute("title");

      if (target) attrs += ` target="${escapeHtmlAttribute(target)}"`;
      if (title) attrs += ` title="${escapeHtmlAttribute(title)}"`;

      return `<a ${attrs}>${content}</a>`;
    },
  });

  turndown.addRule("underline", {
    filter: "u",
    replacement(content) {
      return content ? `<u>${content}</u>` : "";
    },
  });

  turndown.addRule("strikethrough", {
    filter: ["s", "strike", "del"],
    replacement(content, node) {
      const raw = (node.textContent || "").replace(/\u200b/g, "").replace(/\u00a0/g, " ");

      // 들여쓰기 있는 취소선 체크박스
      const indented = raw.match(/^NAVERLEADINGSPACE(\d+)END-\s+\[([xX ])\]\s*(.*)$/);

      if (indented) {
        const indent = " ".repeat(Number(indented[1]));
        return `${indent}- [${indented[2]}] ~~${indented[3].trimEnd()}~~`;
      }

      // 들여쓰기 없는 취소선 체크박스
      const checkbox = raw.match(/^-\s+\[([xX ])\]\s*(.*)$/);
      if (checkbox) return `- [${checkbox[1]}] ~~${checkbox[2].trimEnd()}~~`;

      return content ? `~~${content}~~` : "";
    },
  });

  turndown.addRule("bold", {
    filter: ["strong", "b"],
    replacement(content) {
      return content ? `**${content}**` : "";
    },
  });

  turndown.addRule("italic", {
    filter: ["em", "i"],
    replacement(content) {
      return content ? `*${content}*` : "";
    },
  });

  turndown.addRule("naverTextSpan", {
    filter(node) {
      if (node.nodeName !== "SPAN") return false;

      const className = node.getAttribute("class") || "", style = node.getAttribute("style") || "";

      return /\bse-fs-fs\d+\b/.test(className)
        || Boolean(getStyleProperty(style, "color"))
        || Boolean(getStyleProperty(style, "background-color"));
    },

    replacement(content, node) {
      let text = content.replace(/\u200b/g, "").trimEnd();
      if (!text.trim()) return "";

      const className = node.getAttribute("class") || "", style = node.getAttribute("style") || "";
      const sizeMatch = className.match(/\bse-fs-fs(\d+)\b/), size = sizeMatch ? Number(sizeMatch[1]) : null;
      const color = getStyleProperty(style, "color");
      const backgroundColor = getStyleProperty(style, "background-color");
      const styles = [];

      if (color) styles.push(`color:${color}`);
      if (backgroundColor) styles.push(`background-color:${backgroundColor}`);

      if (size === 13 || size === null) {
        if (styles.length) return `<span style="${styles.join(";")}">${text}</span>`;
        return text;
      }

      if (styles.length) text = `<span style="${styles.join(";")}">${text}</span>`;

      switch (size) {
        case 15: return `\n\n#### ${text}\n\n`;
        case 16: return `\n\n### ${text}\n\n`;
        case 19: return `\n\n## ${text}\n\n`;
        case 24: return `\n\n# ${text}\n\n`;

        default: {
          const fallbackStyles = [`font-size:${size}px`];

          if (color) fallbackStyles.push(`color:${color}`);
          if (backgroundColor) fallbackStyles.push(`background-color:${backgroundColor}`);

          return `<span style="${fallbackStyles.join(";")}">${content.replace(/\u200b/g, "").trimEnd()}</span>`;
        }
      }
    },
  });

  turndown.addRule("naverImage", {
    filter: "img",
    replacement(content, node) {
      const src = node.getAttribute("src"), width = node.getAttribute("width");
      if (!src) return "";

      if (width) return `\n\n<img src="${src}" width="${width}" style="max-width:100%; height:auto;">\n\n`;
      return `\n\n![](${src})\n\n`;
    },
  });

  turndown.addRule("naverParagraph", {
    filter(node) {
      return node.nodeName === "P"
        && (node.getAttribute("class") || "").includes("se-text-paragraph")
        && node.parentNode?.nodeName !== "LI";
    },

    replacement(content) {
      let text = content.replace(/\u200b/g, "").trimEnd();
      if (!text.trim()) return "\nNAVEREMPTYLINE\n";

      text = restoreLeadingSpaces(text);
      text = normalizeNaverCheckbox(text);
      text = text.replace(/^([ \t]*)\\(-{3,})$/, "$1$2");

      return `${text}\n`;
    },
  });

  return turndown;
}

function restoreEmptyLines(markdown) {
  return markdown.replace(/(?:\s*NAVEREMPTYLINE\s*)+/g, (match) => {
    const count = (match.match(/NAVEREMPTYLINE/g) || []).length;

    if (count === 1) return "\n\n";
    if (count === 2) return "\n\n<br>\n\n";
    return "\n\n<br>\n<br>\n\n";
  });
}

function restoreOEmbed(markdown) {
  return markdown.replace(/NAVEROEMBEDSTART([A-Za-z0-9+/=]+)NAVEROEMBEDEND/g, (_, encoded) => {
    try {
      return `\n\n${Buffer.from(encoded, "base64").toString("utf8")}\n\n`;
    } catch (error) {
      console.warn("oEmbed 복원 실패:", error.message);
      return "";
    }
  });
}

function restoreOgCards(markdown) {
  return markdown.replace(/NAVEROGCARDSTART([A-Za-z0-9+/=]+)NAVEROGCARDEND/g, (_, encoded) => {
    try {
      return `\n\n${Buffer.from(encoded, "base64").toString("utf8")}\n\n`;
    } catch (error) {
      console.warn("OG 카드 복원 실패:", error.message);
      return "";
    }
  });
}

async function localizeImages(markdown, images, outputDir) {
  let result = markdown, imageNumber = 0, thumbnailNumber = 0;

  for (const image of images) {
    const number = image.type === "thumbnail" ? ++thumbnailNumber : ++imageNumber;

    try {
      const downloaded = await downloadImage(image.url, outputDir, number, image.type);
      const label = image.type === "thumbnail" ? "썸네일" : "이미지";

      console.log(`${label}: ${downloaded.filename} (${downloaded.size} bytes)`);
      result = result.replaceAll(image.token, downloaded.filename);
    } catch (error) {
      const label = image.type === "thumbnail" ? "썸네일" : "이미지";

      console.warn(`${label} 다운로드 실패: ${image.url}`);
      console.warn(`  ${error.message}`);

      result = result.replaceAll(image.token, image.url);
    }
  }

  return result;
}

async function localizeVideos(markdown, videos, outputDir) {
  let result = markdown;

  for (let i = 0; i < videos.length; i++) {
    const video = videos[i], number = i + 1;

    try {
      console.log(`동영상 ${number}/${videos.length}: 재생정보 가져오는 중...`);

      const source = await getNaverVideoSource(video.vid, video.inkey);
      console.log(`동영상 ${number}: 최고화질 ${source.width}x${source.height}`);

      const downloaded = await downloadVideo(source.url, outputDir, number);
      console.log(`동영상 ${number}: ${downloaded.filename} (${downloaded.size} bytes)`);

      let poster = "";

      if (video.thumbnail) {
        try {
          const thumbnail = await downloadVideoThumbnail(video.thumbnail, outputDir, number);
          poster = thumbnail.filename;
          console.log(`동영상 썸네일 ${number}: ${thumbnail.filename} (${thumbnail.size} bytes)`);
        } catch (error) {
          console.warn(`동영상 썸네일 다운로드 실패: ${error.message}`);
        }
      }

      const posterAttr = poster ? ` poster="${escapeHtmlAttribute(poster)}"` : "";
      const src = escapeHtmlAttribute(downloaded.filename);
      const videoHtml = `<video controls style="width:100%; height:auto;"${posterAttr}>`
        + `<source src="${src}" type="video/mp4"></video>`;

      result = result.replaceAll(video.token, `\n\n${videoHtml}\n\n`);
    } catch (error) {
      console.warn(`동영상 ${number} 다운로드 실패: ${error.message}`);

      const fallback = video.thumbnail
        ? `<img src="${escapeHtmlAttribute(video.thumbnail)}" alt="${escapeHtmlAttribute(video.title || "video")}">`
        : "[동영상 다운로드 실패]";

      result = result.replaceAll(video.token, `\n\n${fallback}\n\n`);
    }
  }

  return result;
}

async function getPost(inputUrl) {
  const { blogId, logNo } = parsePostUrl(inputUrl);
  const id = encodeURIComponent(blogId), no = encodeURIComponent(logNo);
  const postUrl = `https://blog.naver.com/PostView.naver?blogId=${id}&logNo=${no}`;

  console.log(`가져오는 중: ${postUrl}`);

  const headers = { "User-Agent": USER_AGENT, Referer: "https://blog.naver.com/" };
  const response = await fetch(postUrl, { headers });

  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);

  let html = await response.text();
  html = protectLeadingSpaces(html);

  const $ = cheerio.load(html);

  let title = $('meta[property="og:title"]').attr("content")
    || $(".se-title-text").text().trim()
    || $("title").text().trim()
    || `${blogId}-${logNo}`;

  title = title.replace(/\s*:\s*네이버 블로그\s*$/, "").trim();

  const categoryLink = $(".blog2_series a").first();
  let categoryName = categoryLink.text().trim(), categoryNo = null;
  const categoryHref = categoryLink.attr("href");

  if (categoryHref) {
    try {
      categoryNo = new URL(categoryHref, "https://blog.naver.com").searchParams.get("categoryNo");
    } catch {}
  }

  if (!categoryName) categoryName = "미분류";

  console.log(`카테고리: ${categoryName}${categoryNo ? ` (${categoryNo})` : ""}`);

  let content = $(".se-main-container").first();
  if (!content.length) content = $("#postViewArea").first();
  if (!content.length) content = $(".se3_view").first();
  if (!content.length) throw new Error("본문 영역을 찾지 못했습니다.");

  const { images, videos } = normalizeNaverHtml($, content);

  console.log(`본문 이미지: ${images.filter((x) => x.type === "image").length}개`);
  console.log(`링크 썸네일: ${images.filter((x) => x.type === "thumbnail").length}개`);
  console.log(`네이버 동영상: ${videos.length}개`);

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

  return { title, blogId, logNo, categoryName, categoryNo, markdown, images, videos };
}

async function main() {
  const inputUrl = process.argv[2], dest = process.argv[3] || "output";

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
  post.markdown = await localizeVideos(post.markdown, post.videos, postDir);
  post.markdown = cleanMarkdown(post.markdown) + "\n";

  const outputPath = path.join(postDir, "index.md");
  fs.writeFileSync(outputPath, post.markdown, "utf8");

  console.log("");
  console.log(`완료: ${outputPath}`);
  console.log(`이미지: ${post.images.filter((x) => x.type === "image").length}개`);
  console.log(`링크 썸네일: ${post.images.filter((x) => x.type === "thumbnail").length}개`);
  console.log(`동영상: ${post.videos.length}개`);
  console.log(`글자 수: ${post.markdown.length}`);
}

main().catch((error) => {
  console.error("");
  console.error("실패:", error.message);
  console.error(error.stack);
  process.exit(1);
});