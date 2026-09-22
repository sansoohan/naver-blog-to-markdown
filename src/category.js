const cheerio = require("cheerio");
const {fetchNaver} = require("./naver-request");

const POST_LIST_COUNT = 80;
const POST_LIST_MIN_INTERVAL = 50;
const POST_LIST_MAX_INTERVAL = 2000;
const postListStates = new Map();

function parseBlogUrl(url) {
  const parsed = new URL(url);
  const parts = parsed.pathname.split("/").filter(Boolean);
  const blogId = parsed.searchParams.get("blogId") || parts[0];

  if (!blogId) throw new Error("네이버 블로그 URL에서 blogId를 확인할 수 없습니다.");

  return {blogId};
}

function decodeTitle(value) {
  try {
    return decodeURIComponent(String(value).replace(/\+/g, " "));
  } catch {
    return String(value);
  }
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function randomBetween(minimum, maximum) {
  return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum;
}

function getPostListState(categoryNo) {
  const key = String(categoryNo);

  if (!postListStates.has(key)) {
    postListStates.set(key, {interval: POST_LIST_MIN_INTERVAL, nextRequestAt: 0});
  }

  return postListStates.get(key);
}

async function fetchText(url, blogId, options = {}) {
  const {includePrivate = false} = options;

  const response = await fetchNaver(url, {
    private: includePrivate,
    headers: {"User-Agent": "Mozilla/5.0", Referer: `https://blog.naver.com/${blogId}`},
  });

  if (!response.ok) {
    const error = new Error(`요청 실패: ${response.status} ${url}`);
    const retryAfter = Number(response.headers.get("retry-after"));

    error.status = response.status;
    error.retryAfter = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0;
    throw error;
  }

  return response.text();
}

async function waitForPostListRequest(categoryNo) {
  const state = getPostListState(categoryNo);
  const waitMilliseconds = state.nextRequestAt - Date.now();

  if (waitMilliseconds > 0) await delay(waitMilliseconds);

  const jitter = randomBetween(0, Math.max(30, Math.floor(state.interval * 0.2)));
  state.nextRequestAt = Date.now() + state.interval + jitter;
}

function increasePostListInterval(categoryNo) {
  const state = getPostListState(categoryNo);

  state.interval = Math.min(Math.max(state.interval * 2, 200), POST_LIST_MAX_INTERVAL);
  return state.interval;
}

function isTemporaryPostListError(error) {
  const message = String(error?.message || error);

  return /일시적으로 목록보기 기능에 장애/i.test(message)
    || /게시글 목록 요청 실패/i.test(message)
    || /응답을 읽을 수 없습니다/i.test(message)
    || /\b(?:408|425|429|500|502|503|504)\b/.test(message)
    || /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR/i.test(message);
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
  const $ = cheerio.load(html, {decodeEntities: false});
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
    const postCount = countText ? Number(countText.replace(/[^\d]/g, "")) || 0 : null;
    const className = item.attr("class") || "";
    const parentMatch = className.match(/parentcategoryno_(\d+)/i);
    const parentCategoryNo = parentMatch && parentMatch[1] !== "0" ? parentMatch[1] : null;

    seen.add(categoryNo);
    categories.push({categoryNo, name, postCount, parentCategoryNo});
  });

  return categories;
}

async function getPrivateCategoryList(blogId) {
  const {getAuthPage, forceLogin} = require("./auth");
  const page = await getAuthPage();
  const url = `https://blog.naver.com/PostList.naver?blogId=${encodeURIComponent(blogId)}&categoryNo=0`;

  await page.goto(url, {waitUntil: "domcontentloaded", timeout: 60000});
  await page.waitForLoadState("networkidle", {timeout: 10000}).catch(() => {});

  if (page.url().includes("nid.naver.com/nidlogin")) {
    console.log("네이버 로그인 세션이 만료되었습니다.");
    await forceLogin(blogId);
    await page.goto(url, {waitUntil: "domcontentloaded", timeout: 60000});
    await page.waitForLoadState("networkidle", {timeout: 10000}).catch(() => {});
  }

  const html = await page.content();
  const categories = parseCategoriesFromHtml(html);

  if (!categories.length) {
    throw new Error("로그인된 블로그 페이지에서 카테고리를 찾을 수 없습니다.");
  }

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
  const {includePrivate = false} = options;
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
  const postCount = category.postCount === null ? "?" : category.postCount;
  return `${getCategoryPath(category, categories)} (${postCount}개)`;
}

async function getPrivatePostList(blogId, categoryNo, pageNumber) {
  const {getAuthPage} = require("./auth");
  const page = await getAuthPage();

  const params = new URLSearchParams({
    blogId,
    categoryNo: String(categoryNo),
    currentPage: String(pageNumber),
    countPerPage: String(POST_LIST_COUNT),
    parentCategoryNo: "0",
    logCode: "0",
  });

  const url = `https://blog.naver.com/PostTitleListAsync.naver?${params}`;

  const result = await page.evaluate(async targetUrl => {
    const response = await fetch(targetUrl, {method: "GET", credentials: "include"});

    return {
      status: response.status,
      url: response.url,
      retryAfter: response.headers.get("retry-after"),
      text: await response.text(),
    };
  }, url);

  if (result.status < 200 || result.status >= 300) {
    const error = new Error(`게시글 목록 요청 실패: ${result.status} ${result.url}`);
    const retryAfter = Number(result.retryAfter);

    error.status = result.status;
    error.retryAfter = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0;
    throw error;
  }

  return result.text;
}

async function getPostList(blogId, categoryNo, page, options = {}) {
  const {includePrivate = false} = options;
  let text;

  await waitForPostListRequest(categoryNo);

  if (includePrivate) {
    text = await getPrivatePostList(blogId, categoryNo, page);
  } else {
    const params = new URLSearchParams({
      blogId,
      categoryNo: String(categoryNo),
      currentPage: String(page),
      countPerPage: String(POST_LIST_COUNT),
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

  if (data.resultCode && data.resultCode !== "S") {
    throw new Error(`게시글 목록 요청 실패: ${data.resultMessage || data.resultCode}`);
  }

  return data;
}

async function getPostListWithRetry(blogId, categoryNo, page, options = {}) {
  const {includePrivate = false, maxAttempts = 5} = options;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await getPostList(blogId, categoryNo, page, {includePrivate});
    } catch (error) {
      lastError = error;

      if (!isTemporaryPostListError(error) || attempt === maxAttempts) throw error;

      const message = String(error?.message || error);
      const isRateLimited = error?.status === 429 || /\b429\b/.test(message);
      const interval = isRateLimited ? increasePostListInterval(categoryNo) : null;
      const defaultWait = isRateLimited ? 2000 * 2 ** (attempt - 1) : 1000 * 2 ** (attempt - 1);
      const maximumWait = isRateLimited ? 60000 : 8000;
      const waitMilliseconds = Math.min(error?.retryAfter || defaultWait, maximumWait);
      const waitSeconds = Math.ceil(waitMilliseconds / 1000);

      console.warn(
        `${isRateLimited ? "요청이 너무 빨라 제한되었습니다." : "게시글 목록 요청 실패."} `
        + `${waitSeconds}초 후 재시도합니다. `
        + `(${attempt}/${maxAttempts}, categoryNo=${categoryNo}, page=${page})`
      );

      if (isRateLimited) console.warn(`categoryNo=${categoryNo}의 이후 요청 간격: 약 ${interval}ms`);

      await delay(waitMilliseconds);
    }
  }

  throw lastError;
}

async function getAllPosts(blogId, categoryNo, options = {}) {
  const {quiet = false, includePrivate = false} = options;
  const posts = [];
  let page = 1;
  let totalCount = null;

  while (true) {
    const data = await getPostListWithRetry(blogId, categoryNo, page, {includePrivate});
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
  const {includePrivate = false} = options;
  const children = categories.filter(item => item.parentCategoryNo === category.categoryNo);

  if (!children.length) {
    if(category.postCount===0) {
      console.log("게시글이 없거나 구분용인 카테고리입니다.");
      return [];
    }

    const categoryPath = getCategoryPathParts(category, categories);
    const posts = await getAllPosts(blogId, category.categoryNo, {includePrivate});

    return posts.map(post => ({...post, categoryPath}));
  }

  const leafCategories = getDescendantLeafCategories(category, categories);
  const targetCategories=leafCategories.filter(category=>category.postCount!==0);
  const skippedCategoryCount = leafCategories.length - targetCategories.length;

  console.log("");
  console.log(`글이 있는 하위 카테고리 ${targetCategories.length}개를 찾았습니다.`);

  if (skippedCategoryCount) {
    console.log(`게시글이 없거나 구분용인 하위 카테고리 ${skippedCategoryCount}개는 건너뜁니다.`);
  }

  console.log("");

  const posts = [];
  const seen = new Set();

  for (const targetCategory of targetCategories) {
    const categoryPath = getCategoryPathParts(targetCategory, categories);

    console.log(`${categoryPath.join(" > ")} (${targetCategory.postCount}개)`);

    const categoryPosts = await getAllPosts(blogId, targetCategory.categoryNo, {
      quiet: true,
      includePrivate,
    });

    for (const post of categoryPosts) {
      if (seen.has(post.logNo)) continue;

      seen.add(post.logNo);
      posts.push({...post, categoryPath});
    }
  }

  console.log("");
  console.log(`게시글 ${posts.length}개를 찾았습니다.`);
  console.log("");

  return posts;
}

function getLeafCategories(categories) {
  return categories.filter(category =>
    !categories.some(item => item.parentCategoryNo === category.categoryNo)
  );
}

function getPostCategories(categories) {
  return getLeafCategories(categories).filter(category => category.postCount > 0);
}

module.exports = {
  parseBlogUrl,
  getCategoryList,
  getCategoryPathParts,
  getCategoryPath,
  formatCategory,
  getAllPosts,
  getCategoryPosts,
  getLeafCategories,
  getPostCategories,
};
