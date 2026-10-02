const readline = require("readline");
const {convertPost} = require("./backup-page");
const {setBackupOutputRoot, checkBackupCache} = require("./src/backup-cache");
const backupMonitor = require("./src/backup-monitor");
const {runCli} = require("./src/cli");
const {
  parseBlogUrl,
  getCategoryList,
  getCategoryPathParts,
  formatCategory,
  getAllPosts,
  getAllCategoryPosts,
  getCategoryPosts,
  getPostCategories,
  updateCategories,
} = require("./src/category");

function ask(question) {
  const rl = readline.createInterface({input: process.stdin, output: process.stdout});

  return new Promise(resolve => rl.question(question, answer => {
    rl.close();
    resolve(answer.trim());
  }));
}

async function selectCategory(categories, inputName = "") {
  const name = inputName || await ask("백업할 카테고리 이름: ");
  if (!name) throw new Error("카테고리 이름을 입력해주세요.");

  const exactMatches = categories.filter(category => category.name === name);
  if (exactMatches.length === 1) return exactMatches[0];

  if (exactMatches.length > 1) {
    console.log(`\n'${name}' 카테고리가 여러 개 있습니다.\n`);

    exactMatches.forEach((category, index) => {
      console.log(`${index + 1}. ${formatCategory(category, categories)}`);
    });

    const index = Number(await ask("\n선택: ")) - 1;

    if (!Number.isInteger(index) || index < 0 || index >= exactMatches.length) {
      throw new Error("올바른 번호를 선택해주세요.");
    }

    return exactMatches[index];
  }

  const partialMatches = categories.filter(category => category.name.includes(name));
  if (!partialMatches.length) throw new Error(`'${name}' 카테고리를 찾을 수 없습니다.`);

  console.log(`\n'${name}'이 포함된 카테고리:\n`);

  partialMatches.forEach((category, index) => {
    console.log(`${index + 1}. ${formatCategory(category, categories)}`);
  });

  const index = Number(await ask("\n선택: ")) - 1;

  if (!Number.isInteger(index) || index < 0 || index >= partialMatches.length) {
    throw new Error("올바른 번호를 선택해주세요.");
  }

  return partialMatches[index];
}

async function backupPosts(blogId, posts, options = {}) {
  const {
    includePrivate = false,
    update = false,
    useCache = false,
    outputDir = "",
  } = options;

  setBackupOutputRoot(outputDir);
  backupMonitor.start(outputDir, blogId, posts.length);

  if (!posts.length) {
    console.log("백업할 게시글이 없습니다.");

    const result = {
      total: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      updatedPosts: [],
      failedPosts: [],
    };

    backupMonitor.complete(blogId, result);

    return result;
  }

  const cache = checkBackupCache();
  const cachedPostKeys = new Set(Object.keys(cache));

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const updatedPosts = [];
  const failedPosts = [];

  if (update) {
    console.log("업데이트 확인 모드로 백업을 시작합니다.\n");
  } else if (useCache) {
    console.log("리소스 캐시 재사용 모드로 백업을 시작합니다.\n");
  } else {
    console.log("백업을 시작합니다.\n");
  }

  for (let index = 0; index < posts.length; index++) {
    const post = posts[index];
    const cacheKey = `${blogId}/${post.logNo}`;
    const legacyKey = String(post.logNo);
    const cached = cachedPostKeys.has(cacheKey) || cachedPostKeys.has(legacyKey);

    console.log(`[${index + 1}/${posts.length}] ${post.title || post.logNo}`);
    console.log(`카테고리: ${post.categoryPath.join(" > ")}`);

    if (!update && !useCache && cached) {
      skipped++;
      console.log(`이미 백업됨: ${post.logNo}\n`);
      continue;
    }

    backupMonitor.startPost(index + 1, posts.length, post);

    try {
      const result = await convertPost(blogId, post.logNo, {
        skipUnchanged: update,
        categoryPath: post.categoryPath,
        categoryNo: post.categoryNo,
        title: post.title,
        openType: post.openType,
        includePrivate,
        categoryUpdated: true,
        update,
        useCache,
        outputDir,
      });

      if (result.status === "new") {
        created++;
      } else if (result.status === "updated") {
        updated++;
        updatedPosts.push(post);
        console.log(`업데이트됨: ${post.logNo} ${post.title}`);
      } else if (result.status === "skipped") {
        skipped++;
      }

      cachedPostKeys.add(cacheKey);
      cachedPostKeys.delete(legacyKey);

      backupMonitor.completePost();
    } catch (error) {
      failed++;

      failedPosts.push({
        logNo: post.logNo,
        title: post.title,
        error: error.message,
      });

      console.error(`실패: ${post.logNo} - ${error.message}`);
      backupMonitor.failPost(error);
    }

    console.log("");
  }

  const result = {
    total: posts.length,
    created,
    updated,
    skipped,
    failed,
    updatedPosts,
    failedPosts,
  };

  backupMonitor.complete(blogId, result);

  return result;
}

function printBackupSummary(label, result, options = {}) {
  const {update = false, useCache = false} = options;

  console.log(`${label} 백업 완료`);
  console.log(`전체: ${result.total}`);
  console.log(`신규: ${result.created}`);
  console.log(`업데이트: ${result.updated}`);

  if (update) {
    console.log(`변경 없음: ${result.skipped}`);
  } else if (useCache) {
    console.log(`건너뜀: ${result.skipped}`);
  } else {
    console.log(`이미 백업됨: ${result.skipped}`);
  }

  console.log(`실패: ${result.failed}`);

  if (result.updatedPosts.length) {
    console.log("\n업데이트된 글:");

    for (const post of result.updatedPosts) {
      console.log(`${post.logNo} ${post.title}`);
    }
  }

  if (result.failedPosts.length) {
    console.log("\n실패한 글:");

    for (const post of result.failedPosts) {
      console.log(`${post.logNo} ${post.title || ""}`);
      console.log(`  ${post.error}`);
    }
  }
}

async function backupAllCategories(url, options = {}) {
  const {
    includePrivate = false,
    update = false,
    useCache = false,
    outputDir = "",
  } = options;

  const {blogId} = parseBlogUrl(url);

  console.log(`블로그: ${blogId}`);
  console.log("카테고리 목록을 가져오는 중...");

  const categories = await getCategoryList(blogId, {includePrivate});
  updateCategories(categories, outputDir, blogId);
  const targetCategories = getPostCategories(categories);

  console.log(`확인할 카테고리: ${targetCategories.length}개`);

  const posts = await getAllCategoryPosts(blogId, targetCategories, {
    includePrivate,
    quiet: false,
  });

  console.log(`전체 글 수: ${posts.length}`);

  const result = await backupPosts(blogId, posts, {
    includePrivate,
    update,
    useCache,
    outputDir,
  });

  printBackupSummary("블로그", result, {update, useCache});

  return result;
}

async function backupCategory(url, categoryName = "", options = {}) {
  const {
    includePrivate = false,
    update = false,
    useCache = false,
    outputDir = "",
  } = options;

  const {blogId} = parseBlogUrl(url);

  console.log(`블로그: ${blogId}`);
  console.log("카테고리 목록을 가져오는 중...");

  const categories = await getCategoryList(blogId, {includePrivate});
  updateCategories(categories, outputDir, blogId);
  const category = await selectCategory(categories, categoryName);

  console.log(`\n선택: ${formatCategory(category, categories)}`);
  console.log("게시글 목록을 가져오는 중...");

  const posts = await getCategoryPosts(blogId, category, categories, {includePrivate});

  const result = await backupPosts(blogId, posts, {
    includePrivate,
    update,
    useCache,
    outputDir,
  });

  printBackupSummary("카테고리", result, {update, useCache});

  return result;
}

if (require.main === module) {
  runCli({
    command: "c",
    positional: '"네이버 블로그 URL" "카테고리명"',

    validate: positional => Boolean(positional[0]),

    getBlogId: positional => {
      return parseBlogUrl(positional[0]).blogId;
    },

    run: async args => {
      await backupCategory(args.positional[0], args.positional[1] || "", {
        includePrivate: args.includePrivate,
        update: args.update,
        useCache: args.useCache,
        outputDir: args.outputDir,
      });
    },
  });
}

module.exports = {
  backupCategory,
  backupAllCategories,
  parseBlogUrl,
  getCategoryList,
  getAllPosts,
  getCategoryPathParts,
  updateCategories,
};