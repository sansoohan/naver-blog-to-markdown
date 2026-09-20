const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cheerio = require("cheerio");

const { makeHtml, getPostRoot } = require("./make-html");
const { makeMarkdown } = require("./make-markdown");

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

  if (!blogId || !logNo) {
    throw new Error("네이버 블로그 글 URL을 확인할 수 없습니다.");
  }

  return { blogId, logNo };
}

function safeFilename(value) {
  return String(value)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim() || "untitled";
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

async function getPost(blogId, logNo) {
  const url = `https://blog.naver.com/PostView.naver?blogId=${encodeURIComponent(blogId)}&logNo=${encodeURIComponent(logNo)}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: `https://blog.naver.com/${blogId}`,
    },
  });

  if (!response.ok) {
    throw new Error(`게시글 요청 실패: ${response.status}`);
  }

  return response.text();
}

function createContentHash(root) {
  const clone = root.clone();

  clone.find(".se-component.se-file a.se-file-save-button")
    .removeAttr("href")
    .removeAttr("data-linkdata");

  clone.find(".se-component.se-file script.__se_module_data")
    .removeAttr("data-module")
    .removeAttr("data-module-v2");

  clone.find("pzp-pc-layout._naverVideo")
    .removeAttr("key");

  clone.find("a.videoplayer_popup_link").each((_, element) => {
    const link = clone.find(element);
    const href = link.attr("href");

    if (href) {
      link.attr("href", href.replace(/([?&]hashKey=)[^&"]*/i, "$1"));
    }
  });

  return crypto.createHash("sha256").update(clone.html() || "").digest("hex");
}

function getCacheFile() {
  return path.join(process.cwd(), "output", "backup-cache.json");
}

function loadCache() {
  const file = getCacheFile();

  if (!fs.existsSync(file)) {
    return {};
  }

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
  if (!directory || !fs.existsSync(directory)) {
    return;
  }

  fs.rmSync(directory, {
    recursive: true,
    force: true,
  });
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

      if (error.code !== "EPERM" && error.code !== "EBUSY") {
        throw error;
      }

      await sleep(200 * (attempt + 1));
    }
  }

  throw lastError;
}

function saveDebugRaw(html) {
  fs.writeFileSync(path.join(process.cwd(), "debug-raw.html"), html, "utf8");
}

async function convertPost(url, options = {}) {
  const { skipUnchanged = false } = options;
  const { blogId, logNo } = parsePostUrl(url);

  console.log(`가져오는 중: ${blogId}/${logNo}`);

  const rawHtml = await getPost(blogId, logNo);

  saveDebugRaw(rawHtml);

  const $ = cheerio.load(rawHtml, { decodeEntities: false });

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
    console.log("HTML 만드는 중...");

    const originalHtml = await makeHtml(rawHtml, tempOutputDir);

    fs.writeFileSync(
      path.join(tempOutputDir, "original.html"),
      originalHtml,
      "utf8"
    );

    console.log("Markdown 만드는 중...");

    const markdown = makeMarkdown(originalHtml, {
      title,
      blogId,
      logNo,
    });

    fs.writeFileSync(
      path.join(tempOutputDir, "index.md"),
      markdown,
      "utf8"
    );

    if (previous?.path) {
      const previousDir = path.resolve(process.cwd(), previous.path);

      if (previousDir !== path.resolve(finalOutputDir)) {
        removeDirectory(previousDir);
      }
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

    const finalHtmlFile = path.join(finalOutputDir, "original.html");
    const finalMarkdownFile = path.join(finalOutputDir, "index.md");

    console.log(`HTML 완료: ${finalHtmlFile}`);
    console.log(`Markdown 완료: ${finalMarkdownFile}`);

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

if (require.main === module) {
  main();
}
