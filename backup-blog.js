const {backupAllCategories, parseBlogUrl} = require("./backup-category");
const {runCli} = require("./src/cli");

async function backupBlog(blogUrl, options = {}) {
  return backupAllCategories(blogUrl, options);
}

if (require.main === module) {
  runCli({
    command: "b",
    positional: '"블로그 URL"',

    validate: positional => Boolean(positional[0]),

    getBlogId: positional => {
      return parseBlogUrl(positional[0]).blogId;
    },

    run: async args => {
      await backupBlog(args.positional[0], {
        includePrivate: args.includePrivate,
        update: args.update,
        useCache: args.useCache,
        outputDir: args.outputDir,
      });
    },
  });
}

module.exports = {
  backupBlog,
};