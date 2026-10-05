const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const {makeHtml, detectEditorVersion} = require("./make-html");
const {makeMarkdown} = require("./make-markdown");
const {createContentHash} = require("./content-hash");
const {
  setBackupBlogRoot,
  loadBackupCache,
  loadBackupCacheUnlocked,
  saveBackupCacheUnlocked,
  acquireBackupLock,
  releaseBackupLock,
} = require("./cache-html");
const {
  setResourceContext,
  clearResourceContext,
  finalizeResources,
} = require("./cache-resource");
const {fixHtmlIndentation} = require("./indent-html");
const {
  getPost,
  getPostRoot,
} = require("./post-parser");
const {
  extractPostCategoryNo,
  resolvePostCategoryPath,
  resolvePostOpenType,
} = require("./post-metadata");
const {
  normalizeText,
  decodeHtmlEntities,
  safeFilename,
  removeDirectory,
  copyDirectory,
  renameDirectory,
  backupExists,
} = require("./backup-file");

const PostVisibility = {
  "0": "private",
  "1": "neighbor",
  "2": "public",
  "3": "mutual",
};

function getPreviousCache(cache, blogId, logNo) {
  const cacheKey = `${blogId}/${logNo}`;

  if (cache[cacheKey]) return {cacheKey, previous: cache[cacheKey]};
  if (cache[logNo]) return {cacheKey, previous: cache[logNo], legacyKey: logNo};

  return {cacheKey, previous: null};
}

async function convertPostUnlocked(blogId, logNo, options = {}) {
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
  const blogRoot = outputDir ? path.resolve(outputDir) : path.join(process.cwd(), "output");
  const outputRoot = path.dirname(blogRoot);

  setBackupBlogRoot(blogRoot);

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
  const finalOutputDir = path.join(blogRoot, ...normalizedCategoryParts.map(safeFilename), folderName);
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
  const tempOutputDir = path.join(blogRoot,".tmp",`${blogId}_${logNo}_${process.pid}_${Date.now()}`);

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
      outputRoot,
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

module.exports = {
  convertPostUnlocked,
};