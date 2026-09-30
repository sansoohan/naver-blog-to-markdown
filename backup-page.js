const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const {fetchNaver} = require("./src/naver-request");
const {makeHtml, detectEditorVersion} = require("./src/make-html");
const {makeMarkdown} = require("./src/make-markdown");
const {createContentHash} = require("./src/content-hash");
const {
  loadBackupCache,
  saveBackupCache,
  setResourceContext,
  clearResourceContext,
} = require("./src/backup-cache");
const {runCli} = require("./src/cli");

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value) {
  return cheerio.load(`<body>${String(value || "")}</body>`).text();
}

function safeFilename(value) {
  return normalizeText(value)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 150);
}

function parsePostUrl(url) {
  const value = String(url || "").trim();

  let match = value.match(/blog\.naver\.com\/([^/?#]+)\/(\d+)/i);

  if (match) {
    return {
      blogId: match[1],
      logNo: match[2],
    };
  }

  match = value.match(/[?&]blogId=([^&#]+).*?[?&]logNo=(\d+)/i);

  if (match) {
    return {
      blogId: decodeURIComponent(match[1]),
      logNo: match[2],
    };
  }

  throw new Error("네이버 블로그 글 URL 형식이 아닙니다.");
}

async function getPost(blogId, logNo, options = {}) {
  const {includePrivate = false} = options;

  const url = `https://blog.naver.com/PostView.naver?blogId=${encodeURIComponent(blogId)}`
    + `&logNo=${encodeURIComponent(logNo)}`;

  const response = await fetchNaver(url, {
    private: includePrivate,
    browser: includePrivate,
    headers: {
      Referer: `https://blog.naver.com/${blogId}/${logNo}`,
    },
  });

  if (!response.ok) {
    throw new Error(`게시글 요청 실패: HTTP ${response.status}`);
  }

  return response.text();
}

function getPostRoot($) {
  const selectors = [
    "#postListBody",
    ".se-main-container",
    "#postViewArea",
    ".post-view",
  ];

  for (const selector of selectors) {
    const element = $(selector).first();

    if (element.length) return element;
  }

  throw new Error("게시글 본문을 찾을 수 없습니다.");
}

function extractPostCategoryNo($) {
  /*
   * SmartEditor 1/2 구형 게시글.
   *
   * categoryNo=0은 실제 게시글 카테고리가 아니므로 무시한다.
   */
  const selectors = [
    ".blog2_series a[href*='categoryNo=']",
    "span.cate a[href*='categoryNo=']",
  ];

  for (const selector of selectors) {
    const href = $(selector).first().attr("href") || "";
    const match = href.match(/[?&]categoryNo=(\d+)/i);

    if (match && match[1] !== "0") return match[1];
  }

  /*
   * 신형 게시글 및 메타데이터.
   */
  const candidates = [
    $("#postListBody .post-view").attr("data-categoryno"),
    $("meta[property='naverblog:categoryNo']").attr("content"),
    $("meta[name='naverblog:categoryNo']").attr("content"),
  ];

  for (const candidate of candidates) {
    const value = String(candidate || "").trim();

    if (/^\d+$/.test(value) && value !== "0") return value;
  }

  /*
   * 마지막 fallback.
   *
   * HTML 안에 들어 있는 categoryNo를 찾되
   * categoryNo=0은 무시한다.
   */
  const html = $.html();

  const patterns = [
    /categoryNo["']?\s*[:=]\s*["']?(\d+)/i,
    /categoryNo=(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (match && match[1] !== "0") return match[1];
  }

  throw new Error("게시글 카테고리 번호를 찾을 수 없습니다.");
}

function removeDirectory(directory) {
  if (!directory || !fs.existsSync(directory)) return;

  fs.rmSync(directory, {
    recursive: true,
    force: true,
  });
}

function copyDirectory(source, destination) {
  if (!source || !fs.existsSync(source)) return;

  fs.mkdirSync(destination, {recursive: true});

  for (const entry of fs.readdirSync(source, {withFileTypes: true})) {
    if (entry.name === "metadata.json") continue;

    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }
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

function backupExists(outputDir) {
  if (!outputDir || !fs.existsSync(outputDir)) return false;
  if (!fs.existsSync(path.join(outputDir, "original.html"))) return false;
  if (!fs.existsSync(path.join(outputDir, "index.md"))) return false;

  return true;
}

function getPreviousCache(cache, blogId, logNo) {
  const cacheKey = `${blogId}/${logNo}`;

  if (cache[cacheKey]) return {cacheKey, previous: cache[cacheKey]};
  if (cache[logNo]) return {cacheKey, previous: cache[logNo], legacyKey: logNo};

  return {cacheKey, previous: null};
}

async function resolvePostCategoryPath($, blogId, logNo, options = {}) {
  const {includePrivate = false} = options;
  const categoryNo = extractPostCategoryNo($);

  /*
   * backup-category.js가 backup-page.js를 불러오므로 파일 위쪽에서 불러오지 않는다.
   * convertPost()가 실행되는 시점에는 backup-page.js의 export가 끝난 상태라
   * 순환 참조가 발생하지 않는다.
   */
  const {getCategoryList, getCategoryPathParts} = require("./backup-category");
  const categories = await getCategoryList(blogId, {includePrivate});

  const currentCategory = categories.find(category => String(category.categoryNo) === String(categoryNo));

  if (!currentCategory) {
    throw new Error(`게시글 ${logNo}의 ${categoryNo}번 카테고리를 카테고리 목록에서 찾을 수 없습니다.`);
  }

  const categoryPath = getCategoryPathParts(currentCategory, categories).map(normalizeText).filter(Boolean);

  if (!categoryPath.length) throw new Error(`게시글 ${logNo}의 카테고리 경로를 만들 수 없습니다.`);

  return categoryPath;
}

async function convertPost(blogId, logNo, options = {}) {
  const {
    skipUnchanged = false,
    categoryPath = null,
    title: suppliedTitle = "",
    includePrivate = false,
    update = false,
    useCache = false,
    outputDir = "",
  } = options;

  const reuseResources = update || useCache;
  const outputRoot = outputDir ? path.resolve(outputDir) : path.join(process.cwd(), "output");

  blogId = String(blogId);
  logNo = String(logNo);

  console.log(`가져오는 중: https://blog.naver.com/${blogId}/${logNo}`);

  const rawHtml = await getPost(blogId, logNo, {includePrivate});

  const $ = cheerio.load(rawHtml, {decodeEntities: false});
  const root = getPostRoot($);
  const editorVersion = detectEditorVersion($);
  const {hash: contentHash, source: hashSource} = createContentHash(root);

  console.log(`에디터 버전: ${editorVersion || "알 수 없음"}`);

  let cache = loadBackupCache();
  const {cacheKey, previous, legacyKey} = getPreviousCache(cache, blogId, logNo);

  const detectedTitle = normalizeText($("meta[property='og:title']").attr("content"))
    || normalizeText($(".se-title-text").first().text())
    || normalizeText($(".itemSubjectBoldfont").first().text());

  const rawTitle = normalizeText(suppliedTitle) || detectedTitle || normalizeText(previous?.title) || String(logNo);
  const title = normalizeText(decodeHtmlEntities(rawTitle));

  let normalizedCategoryParts = [];

  if (Array.isArray(categoryPath) && categoryPath.length) {
    normalizedCategoryParts = categoryPath.map(normalizeText).filter(Boolean);
  } else {
    normalizedCategoryParts = await resolvePostCategoryPath($, blogId, logNo, {includePrivate});
  }

  if (!normalizedCategoryParts.length) throw new Error(`게시글 ${logNo}의 카테고리 경로를 찾을 수 없습니다.`);

  const category = normalizedCategoryParts.join(" > ");
  const folderName = `${logNo}_${safeFilename(title)}`;
  const finalOutputDir = path.join(outputRoot, ...normalizedCategoryParts.map(safeFilename), folderName);
  const relativePath = path.relative(process.cwd(), finalOutputDir);
  const previousOutputDir = previous?.path ? path.resolve(process.cwd(), previous.path) : null;

  const sameOutputPath = previousOutputDir !== null
    && path.resolve(previousOutputDir) === path.resolve(finalOutputDir);

  const filesExist = backupExists(finalOutputDir);

  if (skipUnchanged && previous && previous.hash === contentHash && sameOutputPath && filesExist) {
    console.log(`변경 없음: ${title}`);

    return {
      status: "skipped",
      blogId,
      logNo,
      title,
      category,
      categoryPath: normalizedCategoryParts,
      editorVersion,
      hash: contentHash,
      path: relativePath,
    };
  }

  let resourceSourceDir = "";

  if (reuseResources) {
    if (previousOutputDir && fs.existsSync(previousOutputDir)) {
      resourceSourceDir = previousOutputDir;
    } else if (fs.existsSync(finalOutputDir)) {
      resourceSourceDir = finalOutputDir;
    }
  }

  const tempOutputDir = path.join(outputRoot, ".tmp", `${blogId}_${logNo}_${Date.now()}`);

  removeDirectory(tempOutputDir);
  fs.mkdirSync(tempOutputDir, {recursive: true});

  let previousHtml = "";

  try {
    if (resourceSourceDir) {
      const previousHtmlPath = path.join(resourceSourceDir, "original.html");

      if (fs.existsSync(previousHtmlPath)) previousHtml = fs.readFileSync(previousHtmlPath, "utf8");

      copyDirectory(resourceSourceDir, tempOutputDir);
    }

    setResourceContext(cacheKey, tempOutputDir, reuseResources);

    console.log(`HTML 생성 중: ${title}`);

    const originalHtml = await makeHtml(rawHtml, tempOutputDir, {
      blogId,
      logNo,
      editorVersion,
      previousHtml,
    });

    const hashSourceFilename = `.hash-source-${contentHash.slice(0, 16)}.html`;
    const hashSourcePath = path.join(tempOutputDir, hashSourceFilename);

    if (!fs.existsSync(hashSourcePath)) fs.writeFileSync(hashSourcePath, hashSource, "utf8");

    fs.writeFileSync(path.join(tempOutputDir, "original.html"), originalHtml, "utf8");

    console.log("Markdown 생성 중...");

    const markdown = makeMarkdown(originalHtml, {
      sourceUrl: `https://blog.naver.com/${blogId}/${logNo}`,
      title,
      editorVersion,
    });

    fs.writeFileSync(path.join(tempOutputDir, "index.md"), markdown, "utf8");

    fs.writeFileSync(
      path.join(tempOutputDir, "metadata.json"),
      `${JSON.stringify({
        title,
        url: `https://blog.naver.com/${blogId}/${logNo}`,
      }, null, 2)}\n`,
      "utf8"
    );

    cache = loadBackupCache();

    const currentEntry = cache[cacheKey] && typeof cache[cacheKey] === "object" ? cache[cacheKey] : {};

    const resources = currentEntry.resources && typeof currentEntry.resources === "object"
      ? currentEntry.resources
      : {};

    const resourceErrors = currentEntry.resourceErrors && typeof currentEntry.resourceErrors === "object"
      ? currentEntry.resourceErrors
      : {};

    if (previousOutputDir && path.resolve(previousOutputDir) !== path.resolve(finalOutputDir)) {
      console.log(`저장 경로 변경: ${previous.path} → ${relativePath}`);
      removeDirectory(previousOutputDir);
    }

    removeDirectory(finalOutputDir);
    fs.mkdirSync(path.dirname(finalOutputDir), {recursive: true});
    await renameDirectory(tempOutputDir, finalOutputDir);

    cache[cacheKey] = {
      ...currentEntry,
      hash: contentHash,
      modifiedAt: null,
      title,
      category,
      categoryPath: normalizedCategoryParts,
      editorVersion,
      path: relativePath,
      backedUpAt: new Date().toISOString(),
      resources,
      resourceErrors,
    };

    if (legacyKey && legacyKey !== cacheKey) delete cache[legacyKey];

    saveBackupCache(cache);

    console.log(`완료: ${relativePath}`);

    return {
      status: previous ? "updated" : "new",
      blogId,
      logNo,
      title,
      category,
      categoryPath: normalizedCategoryParts,
      editorVersion,
      hash: contentHash,
      path: relativePath,
    };
  } catch (error) {
    removeDirectory(tempOutputDir);
    throw error;
  } finally {
    clearResourceContext();
  }
}

if (require.main === module) {
  runCli({
    command: "p",
    positional: '"네이버 블로그 글 URL"',

    validate: positional => Boolean(positional[0]),

    getBlogId: positional => {
      return parsePostUrl(positional[0]).blogId;
    },

    run: async args => {
      const {blogId, logNo} = parsePostUrl(args.positional[0]);

      await convertPost(blogId, logNo, {
        skipUnchanged: args.update,
        includePrivate: args.includePrivate,
        update: args.update,
        useCache: args.useCache,
        outputDir: args.outputDir,
      });
    },
  });
}

module.exports = {
  convertPost,
  parsePostUrl,
  getPost,
  getPostRoot,
  extractPostCategoryNo,
  resolvePostCategoryPath,
};