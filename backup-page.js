const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

const {makeHtml, getPostRoot, detectEditorVersion} = require("./src/make-html");
const {makeMarkdown} = require("./src/make-markdown");
const {fetchNaver} = require("./src/naver-request");
const {loadBackupCache, saveBackupCache, setResourceContext, clearResourceContext} = require("./src/backup-cache");
const {createContentHash} = require("./src/content-hash");

const OUTPUT_ROOT = path.join(process.cwd(), "output");

function safeFilename(value) {
  return String(value || "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "") || "untitled";
}

function normalizeText(value) {
  return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function extractPostCategoryNo($) {
  const selectors = [".blog2_series a[href*='categoryNo=']", "span.cate a[href*='categoryNo=']"];

  for (const selector of selectors) {
    const href = $(selector).first().attr("href") || "";
    const match = href.match(/[?&]categoryNo=(\d+)/i);
    if (match && match[1] !== "0") return match[1];
  }

  throw new Error("게시글 HTML에서 현재 카테고리 번호를 찾을 수 없습니다.");
}

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

  return {blogId, logNo: String(logNo)};
}

async function getPost(blogId, logNo, options = {}) {
  const {includePrivate = false} = options;
  const url = `https://blog.naver.com/PostView.naver?blogId=${encodeURIComponent(blogId)}`
    + `&logNo=${encodeURIComponent(logNo)}`;

  const response = await fetchNaver(url, {
    private: includePrivate,
    browser: includePrivate,
    headers: {"User-Agent": "Mozilla/5.0", Referer: `https://blog.naver.com/${blogId}`},
  });

  if (response.status >= 300 && response.status < 400) {
    throw new Error(`게시글이 리다이렉트되었습니다: ${response.status} ${response.url}`);
  }

  if (!response.ok) throw new Error(`게시글 요청 실패: ${response.status}`);

  return response.text();
}

function removeDirectory(directory) {
  if (!directory || !fs.existsSync(directory)) return;
  fs.rmSync(directory, {recursive: true, force: true});
}

function copyDirectory(source, destination) {
  if (!source || !fs.existsSync(source)) return;

  fs.mkdirSync(destination, {recursive: true});

  for (const entry of fs.readdirSync(source, {withFileTypes: true})) {
    if (entry.name === "original.html" || entry.name === "index.md") continue;

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
  } = options;

  const useCache = update;

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

  const title = normalizeText(suppliedTitle) || detectedTitle || normalizeText(previous?.title) || String(logNo);

  let normalizedCategoryParts = [];

  if (Array.isArray(categoryPath) && categoryPath.length) {
    normalizedCategoryParts = categoryPath.map(normalizeText).filter(Boolean);
  } else {
    normalizedCategoryParts = await resolvePostCategoryPath($, blogId, logNo, {includePrivate});
  }

  if (!normalizedCategoryParts.length) throw new Error(`게시글 ${logNo}의 카테고리 경로를 찾을 수 없습니다.`);

  const category = normalizedCategoryParts.join(" > ");
  const folderName = `${logNo}_${safeFilename(title)}`;
  const finalOutputDir = path.join(OUTPUT_ROOT, ...normalizedCategoryParts.map(safeFilename), folderName);
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

  /*
   * 일반 실행:
   * 기존 리소스를 복사하지 않고 빈 temp에서 시작한다.
   * downloader의 캐시도 비활성화되므로 모든 리소스를 새로 다운로드한다.
   *
   * --update:
   * 기존 게시글 폴더 전체를 temp로 복사한 다음
   * original.html / index.md만 삭제하고 다시 만든다.
   */
  let resourceSourceDir = "";

  if (update) {
    if (previousOutputDir && fs.existsSync(previousOutputDir)) {
      resourceSourceDir = previousOutputDir;
    } else if (fs.existsSync(finalOutputDir)) {
      resourceSourceDir = finalOutputDir;
    }
  }

  const tempOutputDir = path.join(OUTPUT_ROOT, ".tmp", `${blogId}_${logNo}_${Date.now()}`);

  removeDirectory(tempOutputDir);
  fs.mkdirSync(tempOutputDir, {recursive: true});

  let previousHtml = "";

  try {
    if (resourceSourceDir) {
      const previousHtmlPath = path.join(resourceSourceDir, "original.html");

      if (fs.existsSync(previousHtmlPath)) previousHtml = fs.readFileSync(previousHtmlPath, "utf8");

      copyDirectory(resourceSourceDir, tempOutputDir);

      fs.rmSync(path.join(tempOutputDir, "original.html"), {force: true});
      fs.rmSync(path.join(tempOutputDir, "index.md"), {force: true});
    }

    setResourceContext(cacheKey, tempOutputDir, useCache);

    console.log(`HTML 생성 중: ${title}`);

    const originalHtml = await makeHtml(rawHtml, tempOutputDir, {
      blogId,
      logNo,
      title,
      editorVersion,
      previousHtml,
    });

    const hashSourceFilename = `.hash-source-${contentHash.slice(0, 16)}.html`;
    const hashSourcePath = path.join(tempOutputDir, hashSourceFilename);

    if (!fs.existsSync(hashSourcePath)) fs.writeFileSync(hashSourcePath, hashSource, "utf8");

    fs.writeFileSync(path.join(tempOutputDir, "original.html"), originalHtml, "utf8");

    console.log("Markdown 생성 중...");

    const markdown = await makeMarkdown(originalHtml, {title, blogId, logNo, editorVersion});

    fs.writeFileSync(path.join(tempOutputDir, "index.md"), markdown, "utf8");

    if (!backupExists(tempOutputDir)) {
      throw new Error("임시 백업 폴더에 original.html 또는 index.md가 생성되지 않았습니다.");
    }

    /*
     * HTML 생성 중 downloader가 backup-cache.json을 갱신할 수 있으므로
     * 저장 직전에 최신 cache를 다시 읽는다.
     */
    cache = loadBackupCache();

    const currentEntry = cache[cacheKey] && typeof cache[cacheKey] === "object" ? cache[cacheKey] : {};

    const resources = currentEntry.resources && typeof currentEntry.resources === "object"
      ? currentEntry.resources
      : {};

    const videos = currentEntry.videos && typeof currentEntry.videos === "object" ? currentEntry.videos : {};

    /*
     * temp → 최종 게시글 폴더.
     *
     * resources/videos에는 게시글 루트 기준 상대경로만 들어 있으므로
     * temp 폴더가 final 폴더로 이동해도 캐시 수정은 필요 없다.
     */
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
      videos,
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

function parseArgs(argv) {
  const args = argv.slice(2);
  const includePrivate = args.includes("--private");
  const update = args.includes("--update");
  const positional = args.filter(arg => !["--private", "--update"].includes(arg));

  if (!positional.length) {
    throw new Error('사용법: npm run page -- "네이버 블로그 글 URL" [--private] [--update]');
  }

  return {url: positional[0], includePrivate, update};
}

async function main() {
  let includePrivate = false;

  try {
    const args = parseArgs(process.argv);

    includePrivate = args.includePrivate;

    const {blogId, logNo} = parsePostUrl(args.url);

    if (includePrivate) {
      const {ensureLogin} = require("./src/auth");
      await ensureLogin(blogId);
    }

    await convertPost(blogId, logNo, {
      skipUnchanged: args.update,
      includePrivate,
      update: args.update,
    });
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  } finally {
    if (includePrivate) {
      const {closeAuth} = require("./src/auth");
      await closeAuth();
    }
  }
}

module.exports = {
  convertPost,
  parsePostUrl,
  getPost,
  getPostRoot,
  extractPostCategoryNo,
  resolvePostCategoryPath,
};

if (require.main === module) main();
