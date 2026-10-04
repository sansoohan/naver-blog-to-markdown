const fs = require("fs");
const path = require("path");

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function getLockFile(outputDir, blogId) {
  const outputRoot = outputDir ? path.resolve(outputDir) : path.join(process.cwd(), "output");
  const blogDir = path.join(outputRoot, String(blogId));

  fs.mkdirSync(blogDir, {recursive: true});

  return path.join(blogDir, ".category-search.lock");
}

function removeStaleLock(lockFile) {
  if (!fs.existsSync(lockFile)) return;

  try {
    const pid = Number(fs.readFileSync(lockFile, "utf8").trim());

    if (isProcessAlive(pid)) return;

    fs.unlinkSync(lockFile);
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "EPERM" && error.code !== "EBUSY") throw error;
  }
}

async function acquireCategorySearchLock(outputDir, blogId) {
  const lockFile = getLockFile(outputDir, blogId);
  let waiting = false;

  while (true) {
    try {
      const fd = fs.openSync(lockFile, "wx");

      fs.writeFileSync(fd, String(process.pid), "utf8");

      if (waiting) {
        console.log("카테고리 서칭 락을 획득했습니다.");
        console.log("");
      }

      return {fd, lockFile};
    } catch (error) {
      if (error.code !== "EEXIST" && error.code !== "EPERM" && error.code !== "EBUSY") throw error;

      removeStaleLock(lockFile);

      if (!waiting) {
        console.log("다른 프로세스가 카테고리를 검색 중입니다.");
        console.log("카테고리 서칭이 끝날 때까지 기다립니다.");
        waiting = true;
      }

      await sleep(500);
    }
  }
}

async function releaseCategorySearchLock(lock) {
  if (!lock) return;

  try {
    fs.closeSync(lock.fd);
  } catch (error) {
    if (error.code !== "EBADF") throw error;
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.unlinkSync(lock.lockFile);
      return;
    } catch (error) {
      if (error.code === "ENOENT") return;
      if (error.code !== "EPERM" && error.code !== "EBUSY") throw error;

      await sleep(50 * (attempt + 1));
    }
  }

  throw new Error(`카테고리 서칭 락을 해제하지 못했습니다: ${lock.lockFile}`);
}

async function withCategorySearchLock(outputDir, blogId, callback) {
  const lock = await acquireCategorySearchLock(outputDir, blogId);

  try {
    return await callback();
  } finally {
    await releaseCategorySearchLock(lock);
  }
}

module.exports = {
  withCategorySearchLock,
};