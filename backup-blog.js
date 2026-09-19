const { convertPost } = require("./backup-page");
const { getAllPosts } = require("./backup-category");

const ALL_CATEGORIES = 0;

function parseBlogUrl(url) {
  const parsed = new URL(url);
  const parts = parsed.pathname.split("/").filter(Boolean);
  const blogId = parsed.searchParams.get("blogId") || parts[0];

  if (!blogId) throw new Error("네이버 블로그 URL에서 blogId를 확인할 수 없습니다.");

  return { blogId };
}

async function backupBlog(url) {
  const { blogId } = parseBlogUrl(url);

  console.log(`블로그: ${blogId}`);
  console.log("전체 게시글 목록을 가져오는 중...");

  const posts = await getAllPosts(blogId, ALL_CATEGORIES);

  if (!posts.length) {
    console.log("백업할 게시글이 없습니다.");
    return;
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  console.log("전체 백업을 시작합니다.");
  console.log("");

  for (let index = 0; index < posts.length; index++) {
    const post = posts[index];

    console.log(`[${index + 1}/${posts.length}] ${post.title || post.logNo}`);

    const postUrl = `https://blog.naver.com/${blogId}/${post.logNo}`;

    try {
      const result = await convertPost(postUrl, { skipUnchanged: true });

      if (result.status === "new") created++;
      else if (result.status === "updated") updated++;
      else if (result.status === "skipped") skipped++;
    } catch (error) {
      failed++;
      console.error(`실패: ${post.logNo} - ${error.message}`);
    }

    console.log("");
  }

  console.log("전체 백업 완료");
  console.log(`전체: ${posts.length}`);
  console.log(`신규: ${created}`);
  console.log(`업데이트: ${updated}`);
  console.log(`변경 없음: ${skipped}`);
  console.log(`실패: ${failed}`);
}

async function main() {
  const url = process.argv[2];

  if (!url) {
    console.error('사용법: npm run blog -- "네이버 블로그 URL"');
    process.exit(1);
  }

  try {
    await backupBlog(url);
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}

module.exports = {
  backupBlog,
};

if (require.main === module) main();
