const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const TurndownService = require("turndown");

const { protectTextComponents } = require("./src/paragraph");
const { localizeImages } = require("./src/image");
const { protectTables } = require("./src/table");
const { protectYouTube, protectNaverVideos } = require("./src/video");
const { protectQuotes } = require("./src/quote");
const { protectHorizontalLines, getHorizontalLineCss } = require("./src/horizontal-line");
const { protectCodeBlocks } = require("./src/code");

function parsePostUrl(url) {
  const parsed = new URL(url);

  let blogId = parsed.searchParams.get("blogId");
  let logNo = parsed.searchParams.get("logNo");

  if (!blogId || !logNo) {
    const parts = parsed.pathname.split("/").filter(Boolean);

    if (parts.length >= 2) {
      blogId = parts[0];
      logNo = parts[1];
    }
  }

  if (!blogId || !logNo) throw new Error("네이버 블로그 글 URL을 확인할 수 없습니다.");

  return { blogId, logNo };
}

function safeFilename(value) {
  return String(value)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim() || "untitled";
}

function escapeHtmlText(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlAttribute(value) {
  return escapeHtmlText(value)
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function getExtension(url, fallback = ".jpg") {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname);

    if (ext && ext.length <= 6) return ext.toLowerCase();
  } catch {}

  return fallback;
}

function createTurndown() {
  const turndown = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    strongDelimiter: "**",
  });

  turndown.addRule("protected", {
    filter(node) {
      return node.nodeName === "DIV" && node.classList.contains("naver-protected");
    },

    replacement(content, node) {
      return `\n\n${node.textContent}\n\n`;
    },
  });

  turndown.addRule("lineBreak", {
    filter: "br",
    replacement() {
      return "<br>";
    },
  });

  return turndown;
}

function restoreEmptyLines(markdown) {
  return String(markdown)
    .replace(/(?:NAVEREMPTYLINE\s*){3,}/g, "<br>\n<br>\n")
    .replace(/(?:NAVEREMPTYLINE\s*){2}/g, "<br>\n<br>\n")
    .replace(/NAVEREMPTYLINE/g, "<br>")
    .replace(/<br>[ \t]*\n(?=```)/g, "<br>\n\n");
}

function cleanMarkdown(markdown) {
  return String(markdown)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

async function downloadFile(url, destination) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: "https://blog.naver.com/",
    },
  });

  if (!response.ok) throw new Error(`다운로드 실패: ${response.status} ${url}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(destination, buffer);
}

async function protectOgCards($, root, outputDir, store) {
  let thumbIndex = 0;
  const cards = root.find(".se-component.se-oglink").toArray();

  for (const element of cards) {
    const component = $(element);
    const link = component.find("a").first();
    const href = link.attr("href") || "";

    const title = component.find(".se-oglink-title").first().text().trim();
    const summary = component.find(".se-oglink-summary").first().text().trim();
    const domain = component.find(".se-oglink-url").first().text().trim();

    const image = component.find("img").first();
    const imageSource = image.length ? image.attr("data-lazy-src") || image.attr("data-src") || image.attr("src") || "" : "";

    let thumbnail = "";

    if (imageSource) {
      thumbIndex++;

      const ext = getExtension(imageSource);
      const filename = `thumb-${String(thumbIndex).padStart(3, "0")}${ext}`;
      const destination = path.join(outputDir, filename);

      try {
        await downloadFile(imageSource, destination);
        thumbnail = `./${filename}`;
      } catch {
        thumbIndex--;
      }
    }

    const imageHtml = thumbnail
      ? `<td style="width:120px;padding:0 12px 0 0;vertical-align:middle;"><img src="${escapeHtmlAttribute(thumbnail)}" style="width:120px;height:auto;"></td>`
      : "";

    const titleHtml = title ? `<div style="font-weight:700;margin-bottom:4px;">${escapeHtmlText(title)}</div>` : "";
    const summaryHtml = summary ? `<div style="margin-bottom:4px;">${escapeHtmlText(summary)}</div>` : "";
    const domainHtml = domain ? `<div style="font-size:0.9em;">${escapeHtmlText(domain)}</div>` : "";

    const content = `<table style="width:100%;border-collapse:collapse;background:transparent;"><tr>${imageHtml}<td style="vertical-align:middle;"><a href="${escapeHtmlAttribute(href)}" target="_blank" style="text-decoration:none;">${titleHtml}${summaryHtml}${domainHtml}</a></td></tr></table>`;

    component.replaceWith(`<div class="naver-protected">${store.add(content)}</div>`);
  }
}

function getPostTitle($) {
  return $(".se-title-text").first().text().trim()
    || $(".pcol1").first().text().trim()
    || $("meta[property='og:title']").attr("content")?.trim()
    || $("title").text().replace(/\s*:\s*네이버 블로그\s*$/, "").trim()
    || "untitled";
}

function getPostCategory($) {
  return $(".blog2_series").first().text().trim()
    || $(".post-category").first().text().trim()
    || "uncategorized";
}

function getPostRoot($) {
  const smartEditor = $(".se-main-container").first();
  if (smartEditor.length) return smartEditor;

  const postView = $("#postViewArea").first();
  if (postView.length) return postView;

  const legacy = $(".se3_view").first();
  if (legacy.length) return legacy;

  throw new Error("본문 영역을 찾을 수 없습니다.");
}

async function getPost(blogId, logNo) {
  const url = `https://blog.naver.com/PostView.naver?blogId=${encodeURIComponent(blogId)}&logNo=${encodeURIComponent(logNo)}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: `https://blog.naver.com/${blogId}`,
    },
  });

  if (!response.ok) throw new Error(`게시글 요청 실패: ${response.status}`);

  return response.text();
}

async function convertPost(url) {
  const { blogId, logNo } = parsePostUrl(url);

  console.log(`가져오는 중: ${blogId}/${logNo}`);

  const html = await getPost(blogId, logNo);
  const $ = cheerio.load(html, { decodeEntities: false });

  const title = getPostTitle($);
  const category = getPostCategory($);

  const outputDir = path.join(process.cwd(), "output", safeFilename(category), safeFilename(title));
  fs.mkdirSync(outputDir, { recursive: true });

  const root = getPostRoot($);
  const store = createStore();

  await protectNaverVideos($, root, outputDir, store);
  await protectOgCards($, root, outputDir, store);
  await localizeImages($, root, outputDir);

  protectYouTube($, root, store);
  protectTables($, root, store);
  protectQuotes($, root, store);

  const horizontalLineTypes = protectHorizontalLines($, root, store);

  protectCodeBlocks($, root, store);
  protectTextComponents($, root, store);

  const turndown = createTurndown();

  let markdown = turndown.turndown(root.html() || "");
  markdown = store.restore(markdown);
  markdown = restoreEmptyLines(markdown);
  markdown = cleanMarkdown(markdown);

  const header = `# ${title}\n\n> 원본: https://blog.naver.com/${blogId}/${logNo}`;
  const horizontalLineCss = getHorizontalLineCss(horizontalLineTypes);

  const finalMarkdown = `${header}${horizontalLineCss ? `\n\n${horizontalLineCss}` : ""}\n\n${markdown}\n`;

  const outputFile = path.join(outputDir, "index.md");
  fs.writeFileSync(outputFile, finalMarkdown, "utf8");

  console.log(`완료: ${outputFile}`);
}

async function main() {
  const url = process.argv[2];

  if (!url) {
    console.error("사용법: node main.js <네이버 블로그 글 URL>");
    process.exit(1);
  }

  try {
    await convertPost(url);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

main();
