const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const TurndownService = require("turndown");

const { protectTextComponents } = require("./src/paragraph");
const { protectTables } = require("./src/table");
const { protectYouTube, protectNaverVideos } = require("./src/video");

function parsePostUrl(input) {
  const value = input.trim();
  const match = value.match(/blog\.naver\.com\/([^/?#]+)\/(\d+)/i);
  if (match) return { blogId: match[1], logNo: match[2] };

  try {
    const url = new URL(value);
    const blogId = url.searchParams.get("blogId");
    const logNo = url.searchParams.get("logNo");
    if (blogId && logNo) return { blogId, logNo };
  } catch {}

  throw new Error("네이버 블로그 글 주소를 인식할 수 없습니다.");
}

function safeFilename(value) {
  return String(value).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/[. ]+$/g, "").trim().slice(0, 180) || "untitled";
}

function escapeHtmlText(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlAttribute(value) {
  return escapeHtmlText(value).replace(/"/g, "&quot;");
}

function createStore() {
  let index = 0;
  const values = new Map();

  return {
    add(value) {
      const token = `NAVERPLACEHOLDER${String(++index).padStart(8, "0")}END`;
      values.set(token, String(value));
      return token;
    },

    restore(text) {
      let result = String(text);
      for (const [token, value] of values) result = result.split(token).join(value);
      return result;
    },
  };
}

function getExtension(url, contentType = "") {
  const ext = path.extname(String(url).split("?")[0]).toLowerCase();

  if (/^\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(ext)) return ext === ".jpeg" ? ".jpg" : ext;
  if (/video\/mp4/i.test(contentType)) return ".mp4";
  if (/image\/png/i.test(contentType)) return ".png";
  if (/image\/gif/i.test(contentType)) return ".gif";
  if (/image\/webp/i.test(contentType)) return ".webp";

  return ".jpg";
}

function createTurndown() {
  const turndown = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    strongDelimiter: "**",
  });

  turndown.keep(["iframe", "video", "source", "table", "tr", "td"]);

  turndown.addRule("protected", {
    filter(node) {
      return node.nodeName === "DIV" && node.classList.contains("naver-protected");
    },

    replacement(content, node) {
      return `\n\n${node.textContent}\n\n`;
    },
  });

  turndown.addRule("image", {
    filter: "img",

    replacement(content, node) {
      const src = node.getAttribute("src");
      if (!src) return "";

      const width = node.getAttribute("data-width") || node.getAttribute("width");

      if (width) return `\n\n<img src="${src}" width="${width}" style="max-width:100%; height:auto;">\n\n`;
      return `\n\n![](${src})\n\n`;
    },
  });

  return turndown;
}

function restoreEmptyLines(text) {
  return text
    .replace(/(?:\s*NAVEREMPTYLINE\s*){3,}/g, "\n\n<br>\n<br>\n\n")
    .replace(/(?:\s*NAVEREMPTYLINE\s*){2}/g, "\n\n<br>\n<br>\n\n")
    .replace(/\s*NAVEREMPTYLINE\s*/g, "\n\n<br>\n\n");
}

function cleanMarkdown(text, store) {
  let result = String(text);

  result = result.replace(/\u200b/g, "").replace(/\u00a0/g, " ");
  result = result.replace(/[ \t]+\n/g, "\n");
  result = result.replace(/\n{4,}/g, "\n\n\n").trim();

  result = store.restore(result);
  result = restoreEmptyLines(result);

  return result.trim();
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

  return {
    contentType: response.headers.get("content-type") || "",
    size: buffer.length,
  };
}

function getImageSource(img) {
  return img.attr("data-lazy-src") || img.attr("data-src") || img.attr("src") || "";
}

function highResolutionImageUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("type", "w2000");
    return parsed.toString();
  } catch {
    return `${url}${url.includes("?") ? "&" : "?"}type=w2000`;
  }
}

async function localizeImages($, root, outputDir) {
  let index = 1;

  for (const element of root.find("img").toArray()) {
    const img = $(element);

    if (img.closest(".se-oglink").length || img.closest(".se-video").length) continue;

    const src = getImageSource(img);
    if (!src || src.startsWith("data:")) continue;

    const number = String(index).padStart(3, "0");
    const temp = path.join(outputDir, `image-${number}.tmp`);

    try {
      const result = await downloadFile(highResolutionImageUrl(src), temp);
      const filename = `image-${number}${getExtension(src, result.contentType)}`;

      fs.renameSync(temp, path.join(outputDir, filename));
      img.attr("src", filename).removeAttr("data-lazy-src").removeAttr("data-src");
      index++;
    } catch {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
      console.warn(`이미지 다운로드 실패: ${src}`);
    }
  }
}

async function protectOgCards($, root, outputDir, store) {
  let index = 1;

  for (const element of root.find(".se-oglink").toArray()) {
    const component = $(element);
    const title = component.find(".se-oglink-title").first().text().trim();
    const description = component.find(".se-oglink-summary").first().text().trim();
    const url = component.find("a").first().attr("href") || "";
    const img = component.find("img").first();

    if (!title && !url) continue;

    let thumbnail = "";

    if (img.length) {
      const src = getImageSource(img);

      if (src) {
        const number = String(index).padStart(3, "0");
        const temp = path.join(outputDir, `thumb-${number}.tmp`);

        try {
          const result = await downloadFile(src, temp);
          thumbnail = `thumb-${number}${getExtension(src, result.contentType)}`;

          fs.renameSync(temp, path.join(outputDir, thumbnail));
          index++;
        } catch {
          if (fs.existsSync(temp)) fs.unlinkSync(temp);
        }
      }
    }

    const image = thumbnail
      ? `<td style="width:120px"><img src="${thumbnail}" style="width:120px; height:auto;"></td>`
      : "";

    const summary = description ? `<br><small>${escapeHtmlText(description)}</small>` : "";

    const html = `<table><tr>${image}<td><a href="${escapeHtmlAttribute(url)}" target="_blank">`
      + `${escapeHtmlText(title || url)}</a>${summary}</td></tr></table>`;

    component.replaceWith(`<div class="naver-protected">${store.add(html)}</div>`);
  }
}

function getPostTitle($) {
  const selectors = [
    ".se-title-text",
    ".se-title-text span",
    ".pcol1 .itemSubjectBoldfont",
    ".htitle",
  ];

  for (const selector of selectors) {
    const value = $(selector).first().text().trim();
    if (value) return value;
  }

  return $("meta[property='og:title']").attr("content")?.trim() || "untitled";
}

function getPostCategory($) {
  return $(".blog2_series a").first().text().trim() || "uncategorized";
}

function getPostRoot($) {
  let root = $(".se-main-container").first();

  if (!root.length) root = $("#postViewArea").first();
  if (!root.length) root = $(".se3_view").first();

  return root;
}

async function getPost(blogId, logNo) {
  const url = `https://blog.naver.com/PostView.naver?blogId=${encodeURIComponent(blogId)}&logNo=${encodeURIComponent(logNo)}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: `https://blog.naver.com/${blogId}/${logNo}`,
    },
  });

  if (!response.ok) throw new Error(`글 가져오기 실패: HTTP ${response.status}`);

  const html = await response.text();

  fs.writeFileSync("debug-raw.html", html, "utf8");

  const $ = cheerio.load(html);
  const root = getPostRoot($);

  if (!root.length) throw new Error("본문 영역을 찾을 수 없습니다.");

  return {
    $,
    root,
    title: getPostTitle($),
    category: getPostCategory($),
    url: `https://blog.naver.com/${blogId}/${logNo}`,
  };
}

async function convertPost(blogId, logNo) {
  const post = await getPost(blogId, logNo);
  const { $, root } = post;

  const outputDir = path.join(
    "output",
    safeFilename(post.category),
    safeFilename(post.title),
  );

  const store = createStore();

  fs.mkdirSync(outputDir, { recursive: true });

  await protectNaverVideos($, root, outputDir, store);
  await protectOgCards($, root, outputDir, store);
  await localizeImages($, root, outputDir);

  protectYouTube($, root, store);

  // 표 안의 문단이 먼저 처리되면 표 구조를 잃기 때문에
  // 반드시 표 → 일반 문단 순서로 처리한다.
  protectTables($, root, store);
  protectTextComponents($, root, store);

  const turndown = createTurndown();

  let body = turndown.turndown(root.html() || "");
  body = cleanMarkdown(body, store);

  const markdown = `# ${post.title}\n\n> 원본: ${post.url}\n\n${body}\n`;
  const outputPath = path.join(outputDir, "index.md");

  fs.writeFileSync(outputPath, markdown, "utf8");

  return {
    outputPath,
    title: post.title,
    category: post.category,
  };
}

async function main() {
  const input = process.argv.slice(2).join(" ").trim();

  if (!input) {
    console.log("사용법: node main.js https://blog.naver.com/블로그ID/글번호");
    process.exit(1);
  }

  try {
    const { blogId, logNo } = parsePostUrl(input);

    console.log(`blogId: ${blogId}`);
    console.log(`logNo: ${logNo}`);

    const result = await convertPost(blogId, logNo);

    console.log(`제목: ${result.title}`);
    console.log(`카테고리: ${result.category}`);
    console.log(`저장 완료: ${path.resolve(result.outputPath)}`);
  } catch (error) {
    console.error(error.stack || error.message);
    process.exit(1);
  }
}

main();