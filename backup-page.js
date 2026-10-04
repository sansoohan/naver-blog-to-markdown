const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const prettifyHtml = require("html-prettify");
const {fetchNaver} = require("./src/naver-request");
const {makeHtml, detectEditorVersion, getVersion12PostRoot} = require("./src/make-html");
const {makeMarkdown} = require("./src/make-markdown");
const {createContentHash} = require("./src/content-hash");
const {
  getCategoryList,
  getCategoryPathParts,
  getAllPosts,
  updateCategories,
} = require("./src/category");
const {
  setBackupOutputRoot,
  loadBackupCache,
  loadBackupCacheUnlocked,
  saveBackupCacheUnlocked,
  acquireBackupLock,
  releaseBackupLock,
} = require("./src/cache-html");
const {
  setResourceContext,
  clearResourceContext,
  finalizeResources,
} = require("./src/cache-resource");
const {runCli} = require("./src/cli");
const {fixHtmlIndentation} = require("./src/indent-html");

const PostVisibility = {
  "0": "private",
  "1": "neighbor",
  "2": "public",
  "3": "mutual",
};

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

function getPostRoot($, editorVersion) {
  /*
   * 버전 1·2:
   * #postViewArea만 빼면 PostView.css의 .post, .post-back, .post-body,
   * .bcc 관련 구조가 끊긴다. 따라서 글 전체 .post 래퍼를 보존한다.
   */
  if (editorVersion === 1 || editorVersion === 2) {
    const version12 = getVersion12PostRoot($);
    if (version12.length) return version12;
  }

  /*
   * 버전 3·4:
   * .se-main-container를 본문으로 사용하고 실제 원본 조상 래퍼는
   * prepareWrapperPath()에서 그대로 복원한다.
   */
  const smartEditor = $(".se-viewer .se-main-container").first();
  if (smartEditor.length) return smartEditor;

  const mainContainer = $(".se-main-container").first();
  if (mainContainer.length) return mainContainer;

  /*
   * 초기 SmartEditor 3:
   * data-post-editor-version="3"이지만 .se-main-container가 아니라
   * .se_doc_viewer와 .__se_component_area 구조를 사용하는 글이 있다.
   *
   * .se_doc_viewer 전체에는 제목, 작성자, 작성일 등의 헤더가 포함되므로
   * 실제 게시글 내용이 들어 있는 컴포넌트 영역만 root로 사용한다.
   */
  if (editorVersion === 3) {
    const contentsStart = $(".se_doc_contents_start").first();

    if (contentsStart.length) {
      const version3 = contentsStart.nextAll(".__se_component_area").first();

      if (version3.length) return version3;
    }
  }

  const version12 = getVersion12PostRoot($);
  if (version12.length) return version12;

  throw new Error("본문 영역을 찾을 수 없습니다.");
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
  const {
    includePrivate = false,
    categoryUpdated = false,
    outputDir = "",
  } = options;
  const categoryNo = extractPostCategoryNo($);

  const categories = await getCategoryList(blogId, {includePrivate});

  if (!categoryUpdated) updateCategories(categories, outputDir, blogId);

  const currentCategory = categories.find(category => String(category.categoryNo) === String(categoryNo));

  if (!currentCategory) {
    throw new Error(`게시글 ${logNo}의 ${categoryNo}번 카테고리를 카테고리 목록에서 찾을 수 없습니다.`);
  }

  const categoryPath = getCategoryPathParts(currentCategory, categories).map(normalizeText).filter(Boolean);

  if (!categoryPath.length) throw new Error(`게시글 ${logNo}의 카테고리 경로를 만들 수 없습니다.`);

  return categoryPath;
}

async function resolvePostOpenType($, blogId, logNo, options = {}) {
  const {includePrivate = false} = options;
  const categoryNo = extractPostCategoryNo($);
  const posts = await getAllPosts(blogId, categoryNo, {
    quiet: true,
    includePrivate,
  });

  const post = posts.find(post => String(post.logNo) === String(logNo));

  if (!post) throw new Error(`게시글 ${logNo}의 공개 설정을 찾을 수 없습니다.`);

  return post.openType;
}

async function convertPost(blogId, logNo, options = {}) {
  const {
    skipUnchanged = false,
    categoryPath = null,
    categoryNo: suppliedCategoryNo = null,
    title: suppliedTitle = "",
    openType: suppliedOpenType = null,
    includePrivate = false,
    categoryUpdated = false,
    existingBackup = false,
    update = false,
    useCache = false,
    outputDir = "",
  } = options;

  const reuseResources = update || useCache;
  const outputRoot = outputDir ? path.resolve(outputDir) : path.join(process.cwd(), "output");

  setBackupOutputRoot(outputRoot);

  blogId = String(blogId);
  logNo = String(logNo);

  console.log(`가져오는 중: https://blog.naver.com/${blogId}/${logNo}`);

  const rawHtml = await getPost(blogId, logNo, {includePrivate});

  const $ = cheerio.load(rawHtml, {decodeEntities: false});
  const editorVersion = detectEditorVersion($);
  const root = getPostRoot($, editorVersion);

  const categoryNo = suppliedCategoryNo === null || suppliedCategoryNo === undefined
    ? extractPostCategoryNo($)
    : String(suppliedCategoryNo);

  const openType = suppliedOpenType === null || suppliedOpenType === undefined
    ? await resolvePostOpenType($, blogId, logNo, {includePrivate})
    : suppliedOpenType;

  const visibility = PostVisibility[String(openType)];

  if (!visibility) throw new Error(`알 수 없는 게시글 공개 설정입니다: ${openType}`);

  root.attr("data-naver-open-type", String(openType));

  const {hash: contentHash, source: hashSource} = createContentHash(root);

  console.log(`에디터 버전: ${editorVersion || "알 수 없음"}`);

  let cache = loadBackupCache();
  let {cacheKey, previous, legacyKey} = getPreviousCache(cache, blogId, logNo);

  const detectedTitle = normalizeText($("meta[property='og:title']").attr("content"))
    || normalizeText($(".se-title-text").first().text())
    || normalizeText($(".itemSubjectBoldfont").first().text());

  const rawTitle = normalizeText(suppliedTitle) || detectedTitle || normalizeText(previous?.title) || String(logNo);
  const title = normalizeText(decodeHtmlEntities(rawTitle));

  let normalizedCategoryParts = [];

  if (Array.isArray(categoryPath) && categoryPath.length) {
    normalizedCategoryParts = categoryPath.map(normalizeText).filter(Boolean);
  } else {
    normalizedCategoryParts = await resolvePostCategoryPath($, blogId, logNo, {
      includePrivate,
      categoryUpdated,
      outputDir,
    });
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
    console.log(`변경없음: ${title}`);

    return {
      status: "skipped",
      blogId,
      logNo,
      title,
      categoryNo,
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

  /*
   * PID까지 포함해 서로 다른 프로세스가 같은 글을 동시에 처리해도
   * 임시 폴더 이름이 충돌하지 않게 한다.
   */
  const tempOutputDir = path.join(
    outputRoot,
    ".tmp",
    `${blogId}_${logNo}_${process.pid}_${Date.now()}`
  );

  removeDirectory(tempOutputDir);
  fs.mkdirSync(tempOutputDir, {recursive: true});

  let previousHtml = "";

  try {
    if (resourceSourceDir) {
      const previousHtmlPath = path.join(resourceSourceDir, "original.html");

      if (fs.existsSync(previousHtmlPath)) {
        previousHtml = fs.readFileSync(previousHtmlPath, "utf8");
      }

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

    if (!fs.existsSync(hashSourcePath)) {
      fs.writeFileSync(hashSourcePath, hashSource, "utf8");
    }

    fs.writeFileSync(
      path.join(tempOutputDir, "original.html"),
      fixHtmlIndentation(originalHtml),
      "utf8"
    );

    console.log("Markdown 생성 중...");

    const markdown = makeMarkdown(originalHtml, {
      sourceUrl: `https://blog.naver.com/${blogId}/${logNo}`,
      title,
      editorVersion,
    });

    fs.writeFileSync(
      path.join(tempOutputDir, "index.md"),
      markdown,
      "utf8"
    );

    fs.writeFileSync(
      path.join(tempOutputDir, "metadata.json"),
      `${JSON.stringify({
        title,
        url: `https://blog.naver.com/${blogId}/${logNo}`,
        visibility,
      }, null, 2)}\n`,
      "utf8"
    );

    /*
     * 여기부터 output 폴더와 backup-cache.json은 하나의 상태로 취급한다.
     *
     * 다른 프로세스의 checkBackupCache(), resource cache 갱신,
     * 게시글 최종 반영은 이 구간이 끝날 때까지 기다린다.
     */
    const lock = acquireBackupLock();

    try {
      cache = loadBackupCacheUnlocked();

      /*
       * 작업을 시작한 뒤 다른 프로세스가 cache를 변경했을 수 있으므로
       * 최종 반영 직전에 반드시 최신 cache를 다시 읽는다.
       */
      const latest = getPreviousCache(cache, blogId, logNo);

      cacheKey = latest.cacheKey;
      previous = latest.previous;
      legacyKey = latest.legacyKey;

      const latestPreviousOutputDir = previous?.path
        ? path.resolve(process.cwd(), previous.path)
        : null;

      const currentEntry = cache[cacheKey] && typeof cache[cacheKey] === "object"
        ? cache[cacheKey]
        : {};

      const currentResources = currentEntry.resources && typeof currentEntry.resources === "object"
        ? currentEntry.resources
        : {};

      const resources = finalizeResources(currentResources, originalHtml);

      const resourceErrors = currentEntry.resourceErrors && typeof currentEntry.resourceErrors === "object"
        ? currentEntry.resourceErrors
        : {};

      /*
       * 같은 글을 다른 프로세스가 먼저 완료했더라도,
       * 이 프로세스가 만든 결과를 최종 상태로 반영한다.
       *
       * 폴더 삭제/배치와 cache 변경 사이에는 다른 프로세스가
       * checkBackupCache()를 실행할 수 없다.
       */
      if (
        latestPreviousOutputDir
        && path.resolve(latestPreviousOutputDir) !== path.resolve(finalOutputDir)
      ) {
        console.log(`저장 경로 변경: ${previous.path} → ${relativePath}`);

        removeDirectory(latestPreviousOutputDir);
      }

      removeDirectory(finalOutputDir);
      fs.mkdirSync(path.dirname(finalOutputDir), {recursive: true});

      await renameDirectory(tempOutputDir, finalOutputDir);

      cache[cacheKey] = {
        ...currentEntry,
        hash: contentHash,
        modifiedAt: null,
        title,
        categoryNo,
        category,
        categoryPath: normalizedCategoryParts,
        openType,
        editorVersion,
        path: relativePath,
        backedUpAt: new Date().toISOString(),
        resources,
        resourceErrors,
      };

      if (legacyKey && legacyKey !== cacheKey) {
        delete cache[legacyKey];
      }

      saveBackupCacheUnlocked(cache);
    } finally {
      releaseBackupLock(lock);
    }

    console.log(`${existingBackup ? "업데이트" : "완료"}: ${relativePath}`);

    return {
      status: existingBackup ? "updated" : "new",
      blogId,
      logNo,
      title,
      categoryNo,
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