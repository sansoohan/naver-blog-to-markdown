const readline = require("readline");
const cheerio = require("cheerio");
const { convertPost } = require("./backup-page");

function parseBlogUrl(url) {
  const parsed = new URL(url);
  const parts = parsed.pathname.split("/").filter(Boolean);
  const blogId = parsed.searchParams.get("blogId") || parts[0];

  if (!blogId) throw new Error("네이버 블로그 URL에서 blogId를 확인할 수 없습니다.");

  return { blogId };
}

async function fetchText(url, blogId) {
  const response = await fetch(url, {
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

async function getCategoryList(blogId) {
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
  const $ = cheerio.load(content, { decodeEntities: false });
  const categories = [];

  $('a[id^="category"]').each((_, element) => {
    const link = $(element);
    const id = link.attr("id") || "";
    const categoryNo = id.replace(/^category/, "");

    if (!categoryNo || categoryNo === "0") return;

    const item = link.closest("li");
    const name = link.text().replace(/\u00a0/g, " ").trim();
    const countText = item.find(".num").first().text().trim();
    const postCount = Number(countText.replace(/[^\d]/g, "")) || 0;
    const className = item.attr("class") || "";
    const parentMatch = className.match(/parentcategoryno_(\d+)/);
    const parentCategoryNo = parentMatch ? parentMatch[1] : null;

    categories.push({ categoryNo, name, postCount, parentCategoryNo });
  });

  if (!categories.length) throw new Error("카테고리를 찾을 수 없습니다.");

  return categories;
}

function getCategoryPath(category, categories) {
  if (!category.parentCategoryNo) return category.name;

  const parent = categories.find(item => item.categoryNo === category.parentCategoryNo);

  return parent ? `${parent.name} > ${category.name}` : category.name;
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

    exactMatches.forEach((category, index) => {
      console.log(`${index + 1}. ${formatCategory(category, categories)}`);
    });

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

  partialMatches.forEach((category, index) => {
    console.log(`${index + 1}. ${formatCategory(category, categories)}`);
  });

  console.log("");

  const selected = await ask("선택: ");
  const index = Number(selected) - 1;

  if (!Number.isInteger(index) || index < 0 || index >= partialMatches.length) throw new Error("올바른 번호를 선택해주세요.");

  return partialMatches[index];
}

async function getPostList(blogId, categoryNo, page) {
  const params = new URLSearchParams({
    blogId,
    categoryNo: String(categoryNo),
    currentPage: String(page),
    countPerPage: "30",
    parentCategoryNo: "0",
    logCode: "0",
  });

  const url = `https://blog.naver.com/PostTitleListAsync.naver?${params}`;
  const text = await fetchText(url, blogId);

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
  const { quiet = false } = options;
  const posts = [];
  let page = 1;
  let totalCount = null;

  while (true) {
    const data = await getPostList(blogId, categoryNo, page);
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

async function getCategoryPosts(blogId, category, categories) {
  const children = categories.filter(item => item.parentCategoryNo === category.categoryNo);

  if (!children.length) return getAllPosts(blogId, category.categoryNo);

  console.log("");
  console.log(`하위 카테고리 ${children.length}개를 찾았습니다.`);
  console.log("");

  const posts = [];
  const seen = new Set();

  for (const child of children) {
    console.log(`${child.name} (${child.postCount}개)`);

    const childPosts = await getAllPosts(blogId, child.categoryNo, { quiet: true });

    for (const post of childPosts) {
      if (seen.has(post.logNo)) continue;

      seen.add(post.logNo);
      posts.push(post);
    }
  }

  console.log("");
  console.log(`게시글 ${posts.length}개를 찾았습니다.`);
  console.log("");

  return posts;
}

async function backupCategory(url, categoryName = "") {
  const { blogId } = parseBlogUrl(url);

  console.log(`블로그: ${blogId}`);
  console.log("카테고리 목록을 가져오는 중...");

  const categories = await getCategoryList(blogId);
  const category = await selectCategory(categories, categoryName);

  console.log("");
  console.log(`선택: ${formatCategory(category, categories)}`);
  console.log("게시글 목록을 가져오는 중...");

  const posts = await getCategoryPosts(blogId, category, categories);

  if (!posts.length) {
    console.log("백업할 게시글이 없습니다.");
    return;
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

    const postUrl = `https://blog.naver.com/${blogId}/${post.logNo}`;

    try {
      const result = await convertPost(postUrl, { skipUnchanged: true });

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

  console.log("카테고리 백업 완료");
  console.log(`전체: ${posts.length}`);
  console.log(`신규: ${created}`);
  console.log(`업데이트: ${updated}`);
  console.log(`변경 없음: ${skipped}`);
  console.log(`실패: ${failed}`);

  if (updatedPosts.length) {
    console.log("");
    console.log("업데이트된 글:");

    for (const post of updatedPosts) console.log(`${post.logNo} ${post.title}`);
  }
}

async function main() {
  const url = process.argv[2];
  const categoryName = process.argv[3] || "";

  if (!url) {
    console.error('사용법: npm run category -- "네이버 블로그 URL" "카테고리명"');
    process.exitCode = 1;
    return;
  }

  try {
    await backupCategory(url, categoryName);
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

module.exports = {
  backupCategory,
  getCategoryList,
  getAllPosts,
};

if (require.main === module) main();
