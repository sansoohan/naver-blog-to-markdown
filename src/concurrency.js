const fs = require("fs");
const path = require("path");

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function createSessionId(date = new Date()) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");

  return `${year}${month}${day}-${hour}${minute}${second}`;
}

function validateSessionId(sessionId) {
  return /^\d{8}-\d{6}$/.test(String(sessionId || ""));
}

function getSessionDir(outputRoot, sessionId) {
  return path.join(outputRoot, ".concurrency", sessionId);
}

function createSessionDirectory(outputRoot, sessionId) {
  if (!validateSessionId(sessionId)) {
    throw new Error(`올바르지 않은 세션 ID입니다: ${sessionId}`);
  }

  const sessionDir = getSessionDir(outputRoot, sessionId);

  fs.mkdirSync(sessionDir, {recursive: true});

  return sessionDir;
}

function getPostPaths(outputRoot, sessionId, logNo) {
  const sessionDir = getSessionDir(outputRoot, sessionId);

  return {
    sessionDir,
    lockPath: path.join(sessionDir, `${logNo}.lock`),
    completedPath: path.join(sessionDir, `${logNo}.completed`),
  };
}

function acquirePostLock(outputRoot, sessionId, blogId, logNo) {
  if (!validateSessionId(sessionId)) {
    throw new Error(`올바르지 않은 세션 ID입니다: ${sessionId}`);
  }

  blogId = String(blogId);
  logNo = String(logNo);

  const {
    sessionDir,
    lockPath,
    completedPath,
  } = getPostPaths(outputRoot, sessionId, logNo);

  fs.mkdirSync(sessionDir, {recursive: true});

  while (true) {
    /*
     * 같은 세션에서 이미 처리가 끝난 글이면 다시 작업하지 않는다.
     */
    if (fs.existsSync(completedPath)) {
      return {
        status: "completed",
        sessionId,
        blogId,
        logNo,
        completedPath,
      };
    }

    try {
      /*
       * wx로 생성해서 여러 프로세스가 동시에 같은 글의 lock을
       * 획득할 수 없도록 한다.
       */
      const fd = fs.openSync(lockPath, "wx");

      try {
        fs.writeFileSync(
          fd,
          `${JSON.stringify({
            pid: process.pid,
            blogId,
            logNo,
            startedAt: new Date().toISOString(),
          }, null, 2)}\n`,
          "utf8"
        );
      } catch (error) {
        try {
          fs.closeSync(fd);
        } catch {}

        try {
          fs.unlinkSync(lockPath);
        } catch {}

        throw error;
      }

      /*
       * completed 확인과 lock 생성 사이에 다른 프로세스가 작업을
       * 완료했을 수 있으므로 lock 획득 후 다시 확인한다.
       */
      if (fs.existsSync(completedPath)) {
        try {
          fs.closeSync(fd);
        } catch {}

        try {
          fs.unlinkSync(lockPath);
        } catch {}

        return {
          status: "completed",
          sessionId,
          blogId,
          logNo,
          completedPath,
        };
      }

      return {
        status: "acquired",
        fd,
        sessionId,
        blogId,
        logNo,
        lockPath,
        completedPath,
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;

      /*
       * lock 생성 시도 직전에 다른 프로세스가 작업을 완료했을 수 있다.
       */
      if (fs.existsSync(completedPath)) {
        return {
          status: "completed",
          sessionId,
          blogId,
          logNo,
          completedPath,
        };
      }

      let pid = null;
      let lockStat = null;

      try {
        lockStat = fs.statSync(lockPath);
      } catch (statError) {
        /*
         * 확인하는 사이 다른 프로세스가 lock을 제거했다면
         * 처음부터 다시 시도한다.
         */
        if (statError.code === "ENOENT") continue;
        throw statError;
      }

      try {
        const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
        pid = Number(lock.pid);
      } catch {
        /*
         * openSync("wx") 직후 writeFileSync()가 끝나기 전에
         * 다른 프로세스가 파일을 읽을 수 있다.
         *
         * 이 경우 빈 파일 또는 불완전한 JSON을 stale lock으로
         * 오인해서 삭제하면 안 된다.
         */
        if (Date.now() - lockStat.mtimeMs < 30000) {
          return {
            status: "locked",
            sessionId,
            blogId,
            logNo,
            lockPath,
          };
        }
      }

      /*
       * lock을 만든 프로세스가 살아 있으면 현재 작업 중이다.
       */
      if (isProcessAlive(pid)) {
        return {
          status: "locked",
          sessionId,
          blogId,
          logNo,
          lockPath,
        };
      }

      /*
       * 프로세스가 죽었거나 오래된 잘못된 lock이면 제거하고
       * 다시 lock 획득을 시도한다.
       */
      try {
        fs.unlinkSync(lockPath);
      } catch (unlinkError) {
        if (unlinkError.code !== "ENOENT") throw unlinkError;
      }
    }
  }
}

function completePost(lock) {
  if (!lock || lock.status !== "acquired") return;

  /*
   * 작업 성공 표시를 lock 제거보다 먼저 남긴다.
   *
   * 그래야 느린 프로세스가 lock이 사라진 직후 같은 글을
   * 다시 획득하는 것을 막을 수 있다.
   */
  try {
    const fd = fs.openSync(lock.completedPath, "wx");
    fs.closeSync(fd);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
}

function releasePostLock(lock) {
  if (!lock || lock.status !== "acquired") return;

  try {
    fs.closeSync(lock.fd);
  } catch {
    // 이미 닫힌 경우 무시한다.
  }

  try {
    fs.unlinkSync(lock.lockPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

module.exports = {
  createSessionId,
  createSessionDirectory,
  validateSessionId,
  acquirePostLock,
  completePost,
  releasePostLock,
};