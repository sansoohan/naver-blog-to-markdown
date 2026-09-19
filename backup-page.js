const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cheerio = require("cheerio");
const TurndownService = require("turndown");

const { protectAttachments } = require("./src/attachment");
const { protectTextComponents } = require("./src/paragraph");
const { protectTables } = require("./src/table");
const { protectYouTube, protectNaverVideos } = require("./src/video");
const { protectQuotes } = require("./src/quote");
const { protectHorizontalLines, getHorizontalLineCss } = require("./src/horizontal-line");
const { protectCodeBlocks } = require("./src/code");
const { createImageManager, localizeImages, getImageSource } = require("./src/image");

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

async function protectOgCards($, root, imageManager, store) {
  const cards = root.find(".se-component.se-oglink").toArray();

  for (const element of cards) {
    const component = $(element);
    const link = component.find("a").first();
    const href = link.attr("href") || "";
    const title = component.find(".se-oglink-title").first().text().trim();
    const summary = component.find(".se-oglink-summary").first().text().trim();
    const domain = component.find(".se-oglink-url").first().text().trim();
    const image = component.find("img").first();
    const imageSource = image.length ? getImageSource(image) : "";

    let thumbnail = "";

    if (imageSource) {
      try {
        const filename = await imageManager.download(imageSource, { fallbackPrefix: "thumb" });
        if (filename) thumbnail = `./${filename}`;
      } catch {}
    }

    const imageHtml = thumbnail ? `<td style="width:120px;padding:0 12px 0 0;vertical-align:middle;"><img src="${escapeHtmlAttribute(thumbnail)}" style="width:120px;height:auto;"></td>` : "";
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

function createContentHash(root) {
  const clone = root.clone();

  clone.find(".se-component.se-file a.se-file-save-button").removeAttr("href").removeAttr("data-linkdata");
  clone.find(".se-component.se-file script.__se_module_data").removeAttr("data-module").removeAttr("data-module-v2");
  clone.find("pzp-pc-layout._naverVideo").removeAttr("key");

  clone.find("a.videoplayer_popup_link").each((_, element) => {
    const link = clone.find(element);
    const href = link.attr("href");

    if (href) link.attr("href", href.replace(/([?&]hashKey=)[^&"]*/i, "$1"));
  });

  return crypto.createHash("sha256").update(clone.html() || "").digest("hex");
}

function getCacheFile() {
  return path.join(process.cwd(), "output", "backup-cache.json");
}

function loadCache() {
  const file = getCacheFile();

  if (!fs.existsSync(file)) return {};

  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  const file = getCacheFile();
  const tempFile = `${file}.tmp`;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tempFile, JSON.stringify(cache, null, 2), "utf8");
  fs.renameSync(tempFile, file);
}

function removeDirectory(directory) {
  if (!directory || !fs.existsSync(directory)) return;
  fs.rmSync(directory, { recursive: true, force: true });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function renameDirectory(source, destination) {
  let lastError;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.renameSync(source, destination);
      return;
    } catch (error) {
      lastError = error;

      if (error.code !== "EPERM" && error.code !== "EBUSY") throw error;

      await sleep(200 * (attempt + 1));
    }
  }

  throw lastError;
}

async function convertPost(url, options = {}) {
  const { skipUnchanged = false } = options;
  const { blogId, logNo } = parsePostUrl(url);

  console.log(`가져오는 중: ${blogId}/${logNo}`);

  const html = await getPost(blogId, logNo);
  const $ = cheerio.load(html, { decodeEntities: false });

  const title = getPostTitle($);
  const category = getPostCategory($);
  const root = getPostRoot($);
  const contentHash = createContentHash(root);

  const cache = loadCache();
  const cacheKey = `${blogId}/${logNo}`;
  const previous = cache[cacheKey];

  if (skipUnchanged && previous && previous.hash === contentHash) {
    console.log("변경 없음: 건너뜀");

    return {
      status: "skipped",
      blogId,
      logNo,
      title,
      hash: contentHash,
    };
  }

  const folderName = `${logNo}_${safeFilename(title)}`;
  const finalOutputDir = path.join(process.cwd(), "output", safeFilename(category), folderName);
  const tempOutputDir = path.join(process.cwd(), "output", ".tmp", `${blogId}_${logNo}_${Date.now()}`);

  removeDirectory(tempOutputDir);
  fs.mkdirSync(tempOutputDir, { recursive: true });

  try {
    const store = createStore();
    const imageManager = createImageManager(tempOutputDir);

    await protectAttachments($, root, tempOutputDir, store);
    await protectNaverVideos($, root, tempOutputDir, store, imageManager);
    await protectOgCards($, root, imageManager, store);
    await localizeImages($, root, imageManager);

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

    fs.writeFileSync(path.join(tempOutputDir, "index.md"), finalMarkdown, "utf8");

    if (previous?.path) {
      const previousDir = path.resolve(process.cwd(), previous.path);
      if (previousDir !== path.resolve(finalOutputDir)) removeDirectory(previousDir);
    }

    removeDirectory(finalOutputDir);
    fs.mkdirSync(path.dirname(finalOutputDir), { recursive: true });
    await renameDirectory(tempOutputDir, finalOutputDir);

    const relativePath = path.relative(process.cwd(), finalOutputDir);

    cache[cacheKey] = {
      hash: contentHash,
      modifiedAt: null,
      title,
      category,
      path: relativePath,
      backedUpAt: new Date().toISOString(),
    };

    saveCache(cache);

    const finalOutputFile = path.join(finalOutputDir, "index.md");

    console.log(`완료: ${finalOutputFile}`);

    return {
      status: previous ? "updated" : "new",
      blogId,
      logNo,
      title,
      category,
      hash: contentHash,
      path: relativePath,
    };
  } catch (error) {
    removeDirectory(tempOutputDir);
    throw error;
  }
}

async function main() {
  const url = process.argv[2];

  if (!url) {
    console.error('사용법: npm run page -- "네이버 블로그 글 URL"');
    process.exitCode = 1;
    return;
  }

  try {
    await convertPost(url, { skipUnchanged: false });
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

module.exports = {
  convertPost,
  parsePostUrl,
  getPost,
  getPostRoot,
};

if (require.main === module) main();
