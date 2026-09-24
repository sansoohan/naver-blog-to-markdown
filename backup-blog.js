const {backupAllCategories, parseBlogUrl} = require("./backup-category");

async function backupBlog(blogUrl, options = {}) {
  return backupAllCategories(blogUrl, options);
}

async function main() {
  const args = process.argv.slice(2);
  const includePrivate = args.includes("--private");
  const update = args.includes("--update");
  const noDownload = args.includes("--no-download");
  const positional = args.filter(arg => !["--private", "--update", "--no-download"].includes(arg));
  const blogUrl = positional[0];

  if (!blogUrl) {
    console.error('사용법: npm run blog -- "블로그 URL" [--private] [--update] [--no-download]');
    process.exitCode = 1;
    return;
  }

  try {
    if (includePrivate) {
      const {ensureLogin} = require("./src/auth");
      await ensureLogin(parseBlogUrl(blogUrl).blogId);
    }

    await backupBlog(blogUrl, {includePrivate, update, noDownload});
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    if (includePrivate) {
      const {closeAuth} = require("./src/auth");
      await closeAuth();
    }
  }
}

module.exports = {
  backupBlog,
};

if (require.main === module) main();
