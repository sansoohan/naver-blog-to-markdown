const readline = require("readline");
const {convertPost} = require("./backup-page");
const {setBackupBlogRoot, checkBackupCache} = require("./src/cache-html");
const backupMonitor = require("./src/backup-monitor");
const {runCli} = require("./src/cli");
const {withCategorySearchLock} = require("./src/category-search-lock");
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
    session = "",
  } = options;

  setBackupBlogRoot(outputDir);
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
      console.log(`변경없음: ${post.logNo} ${post.title}\n`);
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
        existingBackup: cached,
        update,
        useCache,
        outputDir,
        session,
      });

      if (
        result.status === "skipped"
        || result.status === "locked"
        || result.status === "completed"
      ) {
        skipped++;
      } else if (cached) {
        updated++;
        updatedPosts.push(post);
      } else {
        created++;
      }

      /*
       * 작업 중인 글은 아직 이 프로세스에서 완료 여부를 알 수 없으므로
       * 로컬 cache key 목록에는 반영하지 않는다.
       *
       * completed는 같은 세션의 다른 프로세스가 이미 성공한 글이므로
       * cache에 존재하는 것으로 취급해도 된다.
       */
      if (result.status !== "locked") {
        cachedPostKeys.add(cacheKey);
        cachedPostKeys.delete(legacyKey);
      }
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

function printBackupSummary(label, result) {
  if (result.updatedPosts.length) {
    console.log("업데이트된 글:");

    for (const post of result.updatedPosts) {
      console.log(`${post.logNo} ${post.title}`);
    }

    console.log("");
  }

  if (result.failedPosts.length) {
    console.log("실패한 글:");

    for (const post of result.failedPosts) {
      console.log(`${post.logNo} ${post.title || ""}`);
      console.log(`  ${post.error}`);
    }

    console.log("");
  }

  console.log(`${label} 백업 완료`);
  console.log(`전체: ${result.total}`);
  console.log(`신규: ${result.created}`);
  console.log(`업데이트: ${result.updated}`);
  console.log(`변경없음: ${result.skipped}`);
  console.log(`실패: ${result.failed}`);
}

async function backupAllCategories(url, options = {}) {
  const {
    includePrivate = false,
    privateOnly = false,
    update = false,
    useCache = false,
    outputDir = "",
    session = "",
  } = options;

  const {blogId} = parseBlogUrl(url);

  console.log(`블로그: ${blogId}`);

  let posts = await withCategorySearchLock(outputDir, blogId, async () => {
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

    return posts;
  });

  if (privateOnly) {
    posts = posts.filter(post => String(post.openType) !== "2");
  }

  const result = await backupPosts(blogId, posts, {
    includePrivate,
    update,
    useCache,
    outputDir,
    session,
  });

  printBackupSummary("블로그", result);

  return result;
}

async function backupCategory(url, categoryName = "", options = {}) {
  const {
    includePrivate = false,
    privateOnly = false,
    update = false,
    useCache = false,
    outputDir = "",
    session = "",
  } = options;

  const {blogId} = parseBlogUrl(url);

  console.log(`블로그: ${blogId}`);

  const categories = await withCategorySearchLock(outputDir, blogId, async () => {
    console.log("카테고리 목록을 가져오는 중...");

    const categories = await getCategoryList(blogId, {includePrivate});
    updateCategories(categories, outputDir, blogId);

    return categories;
  });

  const category = await selectCategory(categories, categoryName);

  console.log(`\n선택: ${formatCategory(category, categories)}`);

  let posts = await withCategorySearchLock(outputDir, blogId, async () => {
    console.log("게시글 목록을 가져오는 중...");

    return await getCategoryPosts(blogId, category, categories, {includePrivate});
  });

  if (privateOnly) {
    posts = posts.filter(post => String(post.openType) !== "2");
  }

  const result = await backupPosts(blogId, posts, {
    includePrivate,
    update,
    useCache,
    outputDir,
    session,
  });

  printBackupSummary("카테고리", result);

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
        privateOnly: args.privateOnly,
        update: args.update,
        useCache: args.useCache,
        outputDir: args.outputDir,
        session: args.session,
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