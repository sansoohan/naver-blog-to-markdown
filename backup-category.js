const readline = require("readline");
const {convertPost} = require("./backup-page");
const {
  parseBlogUrl,
  getCategoryList,
  getCategoryPathParts,
  formatCategory,
  getAllPosts,
  getCategoryPosts,
  getLeafCategories,
  getPostCategories,
} = require("./src/category");

function ask(question) {
  const rl = readline.createInterface({input: process.stdin, output: process.stdout});

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
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

    if (!Number.isInteger(index) || index < 0 || index >= exactMatches.length) {
      throw new Error("올바른 번호를 선택해주세요.");
    }

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

  if (!Number.isInteger(index) || index < 0 || index >= partialMatches.length) {
    throw new Error("올바른 번호를 선택해주세요.");
  }

  return partialMatches[index];
}

async function backupPosts(blogId, posts, options = {}) {
  const {includePrivate = false} = options;

  if (!posts.length) {
    console.log("백업할 게시글이 없습니다.");
    return {total: 0, created: 0, updated: 0, skipped: 0, failed: 0, updatedPosts: []};
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

  return {total: posts.length, created, updated, skipped, failed, updatedPosts};
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
  const {includePrivate = false} = options;
  const {blogId} = parseBlogUrl(url);

  console.log(`블로그: ${blogId}`);
  console.log("카테고리 목록을 가져오는 중...");

  const categories = await getCategoryList(blogId, {includePrivate});
  const leafCategories = getLeafCategories(categories);
  const targetCategories = getPostCategories(categories);
  const skippedCategoryCount = leafCategories.length - targetCategories.length;
  const posts = [];
  const seen = new Set();

  console.log(`글이 있는 카테고리: ${targetCategories.length}개`);

  if (skippedCategoryCount) {
    console.log(`게시글이 없거나 구분용인 카테고리: ${skippedCategoryCount}개 (건너뜀)`);
  }

  for (let index = 0; index < targetCategories.length; index++) {
    const category = targetCategories[index];
    const categoryPath = getCategoryPathParts(category, categories);

    console.log(
      `글 목록 확인 중: ${index + 1}/${targetCategories.length} `
      + `${categoryPath.join(" > ")} (${category.postCount}개)`
    );

    const categoryPosts = await getAllPosts(blogId, category.categoryNo, {quiet: true, includePrivate});

    for (const post of categoryPosts) {
      if (seen.has(post.logNo)) continue;

      seen.add(post.logNo);
      posts.push({...post, categoryPath});
    }
  }

  console.log(`전체 글 수: ${posts.length}`);

  const result = await backupPosts(blogId, posts, {includePrivate});

  printBackupSummary("블로그", result);
  return result;
}

async function backupCategory(url, categoryName = "", options = {}) {
  const {includePrivate = false} = options;
  const {blogId} = parseBlogUrl(url);

  console.log(`블로그: ${blogId}`);
  console.log("카테고리 목록을 가져오는 중...");

  const categories = await getCategoryList(blogId, {includePrivate});
  const category = await selectCategory(categories, categoryName);

  console.log("");
  console.log(`선택: ${formatCategory(category, categories)}`);
  console.log("게시글 목록을 가져오는 중...");

  const posts = await getCategoryPosts(blogId, category, categories, {includePrivate});
  const result = await backupPosts(blogId, posts, {includePrivate});

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
      const {blogId} = parseBlogUrl(url);
      const {ensureLogin} = require("./src/auth");

      await ensureLogin(blogId);
    }

    await backupCategory(url, categoryName, {includePrivate});
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
  backupCategory,
  backupAllCategories,
  parseBlogUrl,
  getCategoryList,
  getAllPosts,
  getCategoryPathParts,
};

if (require.main === module) main();
