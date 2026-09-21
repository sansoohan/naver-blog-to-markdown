const readline = require("readline");
const cheerio = require("cheerio");
const { convertPost, getPost } = require("./backup-page");
const { fetchNaver } = require("./src/naver-request");

function parseBlogUrl(url) {
  const parsed = new URL(url);
  const parts = parsed.pathname.split("/").filter(Boolean);
  const blogId = parsed.searchParams.get("blogId") || parts[0];

  if (!blogId) throw new Error("네이버 블로그 URL에서 blogId를 확인할 수 없습니다.");

  return { blogId };
}

async function fetchText(url, blogId, options = {}) {
  const { includePrivate = false } = options;

  const response = await fetchNaver(url, {
    private: includePrivate,
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: `https://blog.naver.com/${blogId}`,
    },
  });

  if (!response.ok) throw new Error(`요청 실패: ${response.status} ${url}`);

  return response.text();
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function decodeTitle(value) {
  try {
    return decodeURIComponent(String(value).replace(/\+/g, " "));
  } catch {
    return String(value);
  }
}

function extractCategoryContent(text) {
  const categoryIndex = text.indexOf("category");
  if (categoryIndex === -1) throw new Error("카테고리 데이터를 찾을 수 없습니다.");

  const contentIndex = text.indexOf("content", categoryIndex);
  if (contentIndex === -1) throw new Error("카테고리 content를 찾을 수 없습니다.");

  const colonIndex = text.indexOf(":", contentIndex);
  if (colonIndex === -1) throw new Error("카테고리 content 형식을 확인할 수 없습니다.");

  let index = colonIndex + 1;
  while (index < text.length && /\s/.test(text[index])) index++;

  const quote = text[index];
  if (quote !== "'" && quote !== '"') throw new Error("카테고리 content 문자열을 찾을 수 없습니다.");

  index++;

  let result = "";
  let escaped = false;

  while (index < text.length) {
    const char = text[index];

    if (escaped) {
      if (char === "n") result += "\n";
      else if (char === "r") result += "\r";
      else if (char === "t") result += "\t";
      else result += char;

      escaped = false;
      index++;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      index++;
      continue;
    }

    if (char === quote) return result;

    result += char;
    index++;
  }

  throw new Error("카테고리 content 문자열이 정상적으로 끝나지 않았습니다.");
}

function parseCategoriesFromHtml(html) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const categories = [];
  const seen = new Set();

  $('a[id^="category"]').each((_, element) => {
    const link = $(element);
    const id = link.attr("id") || "";
    const categoryNo = id.replace(/^category/, "");

    if (!/^\d+$/.test(categoryNo) || categoryNo === "0" || seen.has(categoryNo)) return;

    const item = link.closest("li");
    const name = link.text().replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

    if (!name) return;

    const countText = item.find(".num").first().text().trim();
    const postCount = Number(countText.replace(/[^\d]/g, "")) || 0;
    const className = item.attr("class") || "";
    const parentMatch = className.match(/parentcategoryno_(\d+)/i);
    const parentCategoryNo = parentMatch && parentMatch[1] !== "0" ? parentMatch[1] : null;

    seen.add(categoryNo);
    categories.push({ categoryNo, name, postCount, parentCategoryNo });
  });

  return categories;
}

async function getPrivateCategoryList(blogId) {
  const { getAuthPage, forceLogin } = require("./src/auth");
  const page = await getAuthPage();
  const url = `https://blog.naver.com/PostList.naver?blogId=${encodeURIComponent(blogId)}&categoryNo=0`;

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});

  if (page.url().includes("nid.naver.com/nidlogin")) {
    console.log("네이버 로그인 세션이 만료되었습니다.");
    await forceLogin(blogId);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  }

  const html = await page.content();
  const categories = parseCategoriesFromHtml(html);

  if (!categories.length) throw new Error("로그인된 블로그 페이지에서 카테고리를 찾을 수 없습니다.");

  return categories;
}

async function getPublicCategoryList(blogId) {
  const params = new URLSearchParams({
    blogId,
    listNumVisitor: "5",
    isVisitorOpen: "false",
    isBuddyOpen: "false",
    selectCategoryNo: "0",
    skinId: "0",
    skinType: "C",
    isCategoryOpen: "true",
    isEnglish: "true",
    listNumComment: "7",
    areaCode: "11B10101",
    weatherType: "0",
    currencySign: "ALL",
    enableWidgetKeys: "category",
    writingMaterialListType: "1",
    calType: "",
  });

  const url = `https://blog.naver.com/mylog/WidgetListAsync.naver?${params}`;
  const text = await fetchText(url, blogId);
  const content = extractCategoryContent(text);
  const categories = parseCategoriesFromHtml(content);

  if (!categories.length) throw new Error("카테고리를 찾을 수 없습니다.");

  return categories;
}

async function getCategoryList(blogId, options = {}) {
  const { includePrivate = false } = options;
  return includePrivate ? getPrivateCategoryList(blogId) : getPublicCategoryList(blogId);
}

function getCategoryPathParts(category, categories) {
  const parts = [];
  const visited = new Set();
  let current = category;

  while (current) {
    if (visited.has(current.categoryNo)) break;

    visited.add(current.categoryNo);
    parts.unshift(current.name);

    if (!current.parentCategoryNo) break;

    current = categories.find(item => item.categoryNo === current.parentCategoryNo);
  }

  return parts;
}

function getCategoryPath(category, categories) {
  return getCategoryPathParts(category, categories).join(" > ");
}

function formatCategory(category, categories) {
  return `${getCategoryPath(category, categories)} (${category.postCount}개)`;
}

async function selectCategory(categories, inputName = "") {
  const name = inputName || await ask("백업할 카테고리 이름: ");
  if (!name) throw new Error("카테고리 이름을 입력해주세요.");

  const exactMatches = categories.filter(category => category.name === name);

  if (exactMatches.length === 1) return exactMatches[0];

  if (exactMatches.length > 1) {
    console.log("");
    console.log(`'${name}' 카테고리가 여러 개 있습니다.`);
    console.log("");

    exactMatches.forEach((category, index) => console.log(`${index + 1}. ${formatCategory(category, categories)}`));

    console.log("");

    const selected = await ask("선택: ");
    const index = Number(selected) - 1;

    if (!Number.isInteger(index) || index < 0 || index >= exactMatches.length) throw new Error("올바른 번호를 선택해주세요.");

    return exactMatches[index];
  }

  const partialMatches = categories.filter(category => category.name.includes(name));

  if (!partialMatches.length) throw new Error(`'${name}' 카테고리를 찾을 수 없습니다.`);

  console.log("");
  console.log(`'${name}'이 포함된 카테고리:`);
  console.log("");

  partialMatches.forEach((category, index) => console.log(`${index + 1}. ${formatCategory(category, categories)}`));

  console.log("");

  const selected = await ask("선택: ");
  const index = Number(selected) - 1;

  if (!Number.isInteger(index) || index < 0 || index >= partialMatches.length) throw new Error("올바른 번호를 선택해주세요.");

  return partialMatches[index];
}

async function getPrivatePostList(blogId, categoryNo, pageNumber) {
  const { getAuthPage } = require("./src/auth");
  const page = await getAuthPage();

  const params = new URLSearchParams({
    blogId,
    categoryNo: String(categoryNo),
    currentPage: String(pageNumber),
    countPerPage: "30",
    parentCategoryNo: "0",
    logCode: "0",
  });

  const url = `https://blog.naver.com/PostTitleListAsync.naver?${params}`;

  const result = await page.evaluate(async targetUrl => {
    const response = await fetch(targetUrl, { method: "GET", credentials: "include" });

    return {
      status: response.status,
      url: response.url,
      text: await response.text(),
    };
  }, url);

  if (result.status < 200 || result.status >= 300) throw new Error(`게시글 목록 요청 실패: ${result.status} ${result.url}`);

  return result.text;
}

async function getPostList(blogId, categoryNo, page, options = {}) {
  const { includePrivate = false } = options;
  let text;

  if (includePrivate) {
    text = await getPrivatePostList(blogId, categoryNo, page);
  } else {
    const params = new URLSearchParams({
      blogId,
      categoryNo: String(categoryNo),
      currentPage: String(page),
      countPerPage: "30",
      parentCategoryNo: "0",
      logCode: "0",
    });

    const url = `https://blog.naver.com/PostTitleListAsync.naver?${params}`;
    text = await fetchText(url, blogId);
  }

  let data;

  try {
    data = JSON.parse(text.replace(/\\'/g, "'"));
  } catch {
    throw new Error(`게시글 목록 ${page}페이지 응답을 읽을 수 없습니다.`);
  }

  if (data.resultCode && data.resultCode !== "S") throw new Error(`게시글 목록 요청 실패: ${data.resultMessage || data.resultCode}`);

  return data;
}

async function getAllPosts(blogId, categoryNo, options = {}) {
  const { quiet = false, includePrivate = false } = options;
  const posts = [];
  let page = 1;
  let totalCount = null;

  while (true) {
    const data = await getPostList(blogId, categoryNo, page, { includePrivate });
    const postList = Array.isArray(data.postList) ? data.postList : [];

    if (totalCount === null) {
      totalCount = Number(data.totalCount) || 0;

      if (!quiet) {
        console.log("");
        console.log(`게시글 ${totalCount}개를 찾았습니다.`);
        console.log("");
      }
    }

    for (const post of postList) {
      if (!post.logNo) continue;

      posts.push({
        logNo: String(post.logNo),
        title: decodeTitle(post.title || post.filteredEncodedTitle || ""),
      });
    }

    if (!postList.length || posts.length >= totalCount) break;

    page++;
  }

  return posts;
}

function getDescendantLeafCategories(category, categories) {
  const result = [];
  const visited = new Set();

  function visit(current) {
    if (visited.has(current.categoryNo)) return;

    visited.add(current.categoryNo);

    const children = categories.filter(item => item.parentCategoryNo === current.categoryNo);

    if (!children.length) {
      result.push(current);
      return;
    }

    for (const child of children) visit(child);
  }

  visit(category);

  return result;
}

async function getCategoryPosts(blogId, category, categories, options = {}) {
  const { includePrivate = false } = options;
  const children = categories.filter(item => item.parentCategoryNo === category.categoryNo);

  if (!children.length) {
    const categoryPath = getCategoryPathParts(category, categories);
    const posts = await getAllPosts(blogId, category.categoryNo, { includePrivate });

    return posts.map(post => ({ ...post, categoryPath }));
  }

  const targetCategories = getDescendantLeafCategories(category, categories);

  console.log("");
  console.log(`하위 카테고리 ${targetCategories.length}개를 찾았습니다.`);
  console.log("");

  const posts = [];
  const seen = new Set();

  for (const targetCategory of targetCategories) {
    const categoryPath = getCategoryPathParts(targetCategory, categories);

    console.log(`${categoryPath.join(" > ")} (${targetCategory.postCount}개)`);

    const categoryPosts = await getAllPosts(blogId, targetCategory.categoryNo, { quiet: true, includePrivate });

    for (const post of categoryPosts) {
      if (seen.has(post.logNo)) continue;

      seen.add(post.logNo);
      posts.push({ ...post, categoryPath });
    }
  }

  console.log("");
  console.log(`게시글 ${posts.length}개를 찾았습니다.`);
  console.log("");

  return posts;
}

async function findPostCategory(blogId, logNo, options = {}) {
  const { includePrivate = false } = options;
  const rawHtml = await getPost(blogId, logNo, { includePrivate });
  const $ = cheerio.load(rawHtml, { decodeEntities: false });
  const categories = await getCategoryList(blogId, { includePrivate });
  let categoryNo = "";

  const patterns = [
    /\bvar\s+categoryNo\s*=\s*["'](\d+)["']/i,
    /["']categoryNo["']\s*:\s*["']?(\d+)/i,
    /\bcategoryNo\s*:\s*["'](\d+)["']/i,
  ];

  for (const pattern of patterns) {
    const match = rawHtml.match(pattern);

    if (match && match[1] !== "0") {
      categoryNo = match[1];
      break;
    }
  }

  const category = categories.find(item => item.categoryNo === categoryNo);

  if (!category) throw new Error(`게시글 ${logNo}의 카테고리 번호를 확인할 수 없습니다.`);

  const title = decodeTitle(
    $("meta[property='og:title']").attr("content")
      || $(".se-title-text").first().text()
      || $(".itemSubjectBoldfont").first().text()
      || ""
  ).replace(/\s+/g, " ").trim();

  return {
    logNo: String(logNo),
    title,
    category,
    categoryPath: getCategoryPathParts(category, categories),
  };
}

async function backupPosts(blogId, posts, options = {}) {
  const { includePrivate = false } = options;

  if (!posts.length) {
    console.log("백업할 게시글이 없습니다.");
    return { total: 0, created: 0, updated: 0, skipped: 0, failed: 0, updatedPosts: [] };
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const updatedPosts = [];

  console.log("백업을 시작합니다.");
  console.log("");

  for (let index = 0; index < posts.length; index++) {
    const post = posts[index];

    console.log(`[${index + 1}/${posts.length}] ${post.title || post.logNo}`);
    console.log(`카테고리: ${post.categoryPath.join(" > ")}`);

    try {
      const result = await convertPost(blogId, post.logNo, {
        skipUnchanged: true,
        categoryPath: post.categoryPath,
        title: post.title,
        includePrivate,
      });

      if (result.status === "new") created++;
      else if (result.status === "updated") {
        updated++;
        updatedPosts.push(post);
        console.log(`업데이트됨: ${post.logNo} ${post.title}`);
      } else if (result.status === "skipped") skipped++;
    } catch (error) {
      failed++;
      console.error(`실패: ${post.logNo} - ${error.message}`);
    }

    console.log("");
  }

  return { total: posts.length, created, updated, skipped, failed, updatedPosts };
}

function printBackupSummary(label, result) {
  console.log(`${label} 백업 완료`);
  console.log(`전체: ${result.total}`);
  console.log(`신규: ${result.created}`);
  console.log(`업데이트: ${result.updated}`);
  console.log(`변경 없음: ${result.skipped}`);
  console.log(`실패: ${result.failed}`);

  if (result.updatedPosts.length) {
    console.log("");
    console.log("업데이트된 글:");
    for (const post of result.updatedPosts) console.log(`${post.logNo} ${post.title}`);
  }
}

async function backupAllCategories(url, options = {}) {
  const { includePrivate = false } = options;
  const { blogId } = parseBlogUrl(url);

  console.log(`블로그: ${blogId}`);
  console.log("카테고리 목록을 가져오는 중...");

  const categories = await getCategoryList(blogId, { includePrivate });
  const leafCategories = categories.filter(category =>
    !categories.some(item => item.parentCategoryNo === category.categoryNo)
  );
  const posts = [];
  const seen = new Set();

  for (let index = 0; index < leafCategories.length; index++) {
    const category = leafCategories[index];
    const categoryPath = getCategoryPathParts(category, categories);

    console.log(`글 목록 확인 중: ${index + 1}/${leafCategories.length} ${categoryPath.join(" > ")}`);

    const categoryPosts = await getAllPosts(blogId, category.categoryNo, { quiet: true, includePrivate });

    for (const post of categoryPosts) {
      if (seen.has(post.logNo)) continue;
      seen.add(post.logNo);
      posts.push({ ...post, categoryPath });
    }
  }

  console.log(`전체 글 수: ${posts.length}`);

  const result = await backupPosts(blogId, posts, { includePrivate });
  printBackupSummary("블로그", result);
  return result;
}

async function backupCategory(url, categoryName = "", options = {}) {
  const { includePrivate = false } = options;
  const { blogId } = parseBlogUrl(url);

  console.log(`블로그: ${blogId}`);
  console.log("카테고리 목록을 가져오는 중...");

  const categories = await getCategoryList(blogId, { includePrivate });
  const category = await selectCategory(categories, categoryName);

  console.log("");
  console.log(`선택: ${formatCategory(category, categories)}`);
  console.log("게시글 목록을 가져오는 중...");

  const posts = await getCategoryPosts(blogId, category, categories, { includePrivate });

  const result = await backupPosts(blogId, posts, { includePrivate });
  printBackupSummary("카테고리", result);
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const includePrivate = args.includes("--private");
  const positionalArgs = args.filter(arg => arg !== "--private");
  const url = positionalArgs[0];
  const categoryName = positionalArgs[1] || "";

  if (!url) {
    console.error('사용법: npm run category -- "네이버 블로그 URL" "카테고리명" [--private]');
    process.exitCode = 1;
    return;
  }

  try {
    if (includePrivate) {
      const { blogId } = parseBlogUrl(url);
      const { ensureLogin } = require("./src/auth");
      await ensureLogin(blogId);
    }

    await backupCategory(url, categoryName, { includePrivate });
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  } finally {
    if (includePrivate) {
      const { closeAuth } = require("./src/auth");
      await closeAuth();
    }
  }
}

module.exports = {
  backupCategory,
  parseBlogUrl,
  getCategoryList,
  getAllPosts,
  getCategoryPathParts,
  findPostCategory,
  backupAllCategories,
};

if (require.main === module) main();
