const fs = require("fs");
const path = require("path");
const {
  setBackupOutputRoot,
  loadBackupCacheUnlocked,
  saveBackupCacheUnlocked,
  acquireBackupLock,
  releaseBackupLock,
} = require("../backup-cache");
const {getCategoryPathParts} = require("./category");

function safeFilename(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 150);
}

function getStoredCategories(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];

  return Object.entries(data).map(([categoryNo, category]) => ({
    categoryNo: String(categoryNo),
    name: category?.name || "",
    parentCategoryNo: category?.parentCategoryNo === null || category?.parentCategoryNo === undefined
      ? null
      : String(category.parentCategoryNo),
    visibility: category?.visibility,
  }));
}

function getCategoryByPath(categoryPath, categories) {
  if (!Array.isArray(categoryPath) || !categoryPath.length) return null;

  return categories.find(category => {
    const parts = getCategoryPathParts(category, categories);

    return parts.length === categoryPath.length
      && parts.every((part, index) => part === categoryPath[index]);
  }) || null;
}

function removeEmptyDirectories(directory, stopDirectory) {
  let current = directory;
  const stop = path.resolve(stopDirectory);

  while (
    current
    && path.resolve(current) !== stop
    && path.resolve(current).startsWith(`${stop}${path.sep}`)
  ) {
    if (!fs.existsSync(current)) {
      current = path.dirname(current);
      continue;
    }

    if (fs.readdirSync(current).length) break;

    fs.rmdirSync(current);
    current = path.dirname(current);
  }
}

function reorganizeCategoryBackups(categories, outputDir, blogId) {
  const outputRoot = outputDir ? path.resolve(outputDir) : path.join(process.cwd(), "output");
  const categoriesPath = path.join(outputRoot, "categories.json");

  if (!blogId || !fs.existsSync(categoriesPath)) return;

  let previousData;

  try {
    previousData = JSON.parse(fs.readFileSync(categoriesPath, "utf8"));
  } catch {
    return;
  }

  const previousCategories = getStoredCategories(previousData);

  if (!previousCategories.length) return;

  setBackupOutputRoot(outputRoot);

  const lock = acquireBackupLock();

  try {
    const cache = loadBackupCacheUnlocked();
    const moves = [];

    for (const [cacheKey, entry] of Object.entries(cache)) {
      if (!entry || typeof entry !== "object") continue;

      const separatorIndex = cacheKey.indexOf("/");
      const cacheBlogId = separatorIndex === -1 ? "" : cacheKey.slice(0, separatorIndex);

      if (cacheBlogId && cacheBlogId !== String(blogId)) continue;
      if (!entry.path) continue;

      let categoryNo = entry.categoryNo ? String(entry.categoryNo) : null;

      if (!categoryNo && Array.isArray(entry.categoryPath)) {
        const previousCategory = getCategoryByPath(entry.categoryPath, previousCategories);

        if (previousCategory) categoryNo = String(previousCategory.categoryNo);
      }

      if (!categoryNo) continue;

      const currentCategory = categories.find(
        category => String(category.categoryNo) === categoryNo
      );

      if (!currentCategory) continue;

      const currentCategoryPath = getCategoryPathParts(currentCategory, categories);

      if (!currentCategoryPath.length) continue;

      const previousPath = path.resolve(process.cwd(), entry.path);
      const folderName = path.basename(previousPath);
      const currentPath = path.join(
        outputRoot,
        ...currentCategoryPath.map(safeFilename),
        folderName
      );
      const relativePath = path.relative(process.cwd(), currentPath);
      const category = currentCategoryPath.join(" > ");

      entry.categoryNo = categoryNo;

      if (path.resolve(previousPath) === path.resolve(currentPath)) {
        entry.category = category;
        entry.categoryPath = currentCategoryPath;
        entry.path = relativePath;
        continue;
      }

      if (!fs.existsSync(previousPath)) continue;

      moves.push({
        entry,
        previousPath,
        currentPath,
        relativePath,
        categoryNo,
        category,
        categoryPath: currentCategoryPath,
      });
    }

    if (moves.length) {
      console.log(`카테고리 구조 변경: ${moves.length}개 게시글 재배치`);

      const moveRoot = path.join(
        outputRoot,
        ".tmp",
        `category-move-${process.pid}-${Date.now()}`
      );

      fs.mkdirSync(moveRoot, {recursive: true});

      try {
        for (let index = 0; index < moves.length; index++) {
          const move = moves[index];
          const temporaryPath = path.join(moveRoot, String(index));

          fs.renameSync(move.previousPath, temporaryPath);
          move.temporaryPath = temporaryPath;
        }

        for (const move of moves) {
          fs.mkdirSync(path.dirname(move.currentPath), {recursive: true});

          if (fs.existsSync(move.currentPath)) {
            throw new Error(`카테고리 이동 대상 경로가 이미 존재합니다: ${move.currentPath}`);
          }

          fs.renameSync(move.temporaryPath, move.currentPath);

          move.entry.categoryNo = move.categoryNo;
          move.entry.category = move.category;
          move.entry.categoryPath = move.categoryPath;
          move.entry.path = move.relativePath;

          console.log(
            `카테고리 경로 변경: ${path.relative(process.cwd(), move.previousPath)}`
            + ` → ${move.relativePath}`
          );
        }

        for (const move of moves) {
          removeEmptyDirectories(path.dirname(move.previousPath), outputRoot);
        }

        fs.rmSync(moveRoot, {recursive: true, force: true});
      } catch (error) {
        for (const move of moves) {
          if (
            move.temporaryPath
            && fs.existsSync(move.temporaryPath)
            && !fs.existsSync(move.previousPath)
          ) {
            fs.mkdirSync(path.dirname(move.previousPath), {recursive: true});
            fs.renameSync(move.temporaryPath, move.previousPath);
          } else if (
            fs.existsSync(move.currentPath)
            && !fs.existsSync(move.previousPath)
          ) {
            fs.mkdirSync(path.dirname(move.previousPath), {recursive: true});
            fs.renameSync(move.currentPath, move.previousPath);
          }
        }

        fs.rmSync(moveRoot, {recursive: true, force: true});
        throw error;
      }
    }

    saveBackupCacheUnlocked(cache);
  } finally {
    releaseBackupLock(lock);
  }
}

function updateCategories(categories, outputDir, blogId = "") {
  const outputRoot = outputDir ? path.resolve(outputDir) : path.join(process.cwd(), "output");
  const data = {};

  reorganizeCategoryBackups(categories, outputDir, blogId);

  for (const category of categories) {
    data[category.categoryNo] = {
      name: category.name,
      parentCategoryNo: category.parentCategoryNo,
      visibility: category.visibility,
    };
  }

  fs.mkdirSync(outputRoot, {recursive: true});

  fs.writeFileSync(
    path.join(outputRoot, "categories.json"),
    `${JSON.stringify(data, null, 2)}\n`,
    "utf8"
  );
}

module.exports = {
  reorganizeCategoryBackups,
  updateCategories,
};