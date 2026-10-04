/*
 * 중요:
 * 기존 주석은 절대 임의로 삭제하거나 수정하지 않는다.
 *
 * 병신같은 ChatGPT가 기능 수정과 관계없는 기존 코드를 멋대로 재구성하면서
 * 중요한 주석들을 대량으로 삭제하는 치명적인 실수를 했다.
 *
 * 이후 코드를 수정할 때는 반드시 현재 원본을 기준으로 필요한 부분만 변경하고,
 * 기존 주석은 명시적으로 삭제 요청을 받은 경우가 아니면 그대로 보존한다.
 */

const path = require("path");
const {
  acquirePostLock,
  completePost,
  releasePostLock,
} = require("./src/concurrency");
const {runCli} = require("./src/cli");
const {
  parsePostUrl,
  getPost,
  getPostRoot,
} = require("./src/post-parser");
const {
  extractPostCategoryNo,
  resolvePostCategoryPath,
} = require("./src/post-metadata");
const {convertPostUnlocked} = require("./src/backup-post");

async function convertPost(blogId, logNo, options = {}) {
  blogId = String(blogId);
  logNo = String(logNo);

  const outputRoot = options.outputDir
    ? path.resolve(options.outputDir)
    : path.join(process.cwd(), "output");

  const session = String(options.session || "");

  if (!session) {
    throw new Error("세션 ID가 지정되지 않았습니다.");
  }

  const lock = acquirePostLock(outputRoot, session, blogId, logNo);

  if (lock.status === "completed") {
    console.log(`처리완료: https://blog.naver.com/${blogId}/${logNo}`);

    return {
      status: "completed",
      blogId,
      logNo,
    };
  }

  if (lock.status === "locked") {
    console.log(`작업중: https://blog.naver.com/${blogId}/${logNo}`);

    return {
      status: "locked",
      blogId,
      logNo,
    };
  }

  try {
    const result = await convertPostUnlocked(blogId, logNo, options);

    completePost(lock);

    return result;
  } finally {
    releasePostLock(lock);
  }
}

if (require.main === module) {
  runCli({
    command: "p",
    positional: '"네이버 블로그 글 URL"',

    validate: positional => Boolean(positional[0]),

    getBlogId: positional => {
      return parsePostUrl(positional[0]).blogId;
    },

    run: async args => {
      const {blogId, logNo} = parsePostUrl(args.positional[0]);

      await convertPost(blogId, logNo, {
        skipUnchanged: args.update,
        includePrivate: args.includePrivate,
        update: args.update,
        useCache: args.useCache,
        outputDir: args.outputDir,
        session: args.session,
      });
    },
  });
}

module.exports = {
  convertPost,
  parsePostUrl,
  getPost,
  getPostRoot,
  extractPostCategoryNo,
  resolvePostCategoryPath,
};