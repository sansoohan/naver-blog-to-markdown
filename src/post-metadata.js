const {
  getCategoryList,
  getCategoryPathParts,
  getAllPosts,
  updateCategories,
} = require("./category");
const {normalizeText} = require("./backup-file");

function extractPostCategoryNo($) {
  /*
   * SmartEditor 1/2 구형 게시글.
   *
   * categoryNo=0은 실제 게시글 카테고리가 아니므로 무시한다.
   */
  const selectors = [
    ".blog2_series a[href*='categoryNo=']",
    "span.cate a[href*='categoryNo=']",
  ];

  for (const selector of selectors) {
    const href = $(selector).first().attr("href") || "";
    const match = href.match(/[?&]categoryNo=(\d+)/i);

    if (match && match[1] !== "0") return match[1];
  }

  /*
   * 신형 게시글 및 메타데이터.
   */
  const candidates = [
    $("#postListBody .post-view").attr("data-categoryno"),
    $("meta[property='naverblog:categoryNo']").attr("content"),
    $("meta[name='naverblog:categoryNo']").attr("content"),
  ];

  for (const candidate of candidates) {
    const value = String(candidate || "").trim();

    if (/^\d+$/.test(value) && value !== "0") return value;
  }

  /*
   * 마지막 fallback.
   *
   * HTML 안에 들어 있는 categoryNo를 찾되
   * categoryNo=0은 무시한다.
   */
  const html = $.html();

  const patterns = [
    /categoryNo["']?\s*[:=]\s*["']?(\d+)/i,
    /categoryNo=(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (match && match[1] !== "0") return match[1];
  }

  throw new Error("게시글 카테고리 번호를 찾을 수 없습니다.");
}

async function resolvePostCategoryPath($, blogId, logNo, options = {}) {
  const {
    includePrivate = false,
    categoryUpdated = false,
    outputDir = "",
  } = options;
  const categoryNo = extractPostCategoryNo($);

  const categories = await getCategoryList(blogId, {includePrivate});

  if (!categoryUpdated) updateCategories(categories, outputDir, blogId);

  const currentCategory = categories.find(category => String(category.categoryNo) === String(categoryNo));

  if (!currentCategory) {
    throw new Error(`게시글 ${logNo}의 ${categoryNo}번 카테고리를 카테고리 목록에서 찾을 수 없습니다.`);
  }

  const categoryPath = getCategoryPathParts(currentCategory, categories).map(normalizeText).filter(Boolean);

  if (!categoryPath.length) throw new Error(`게시글 ${logNo}의 카테고리 경로를 만들 수 없습니다.`);

  return categoryPath;
}

async function resolvePostOpenType($, blogId, logNo, options = {}) {
  const {includePrivate = false} = options;
  const categoryNo = extractPostCategoryNo($);
  const posts = await getAllPosts(blogId, categoryNo, {
    quiet: true,
    includePrivate,
  });

  const post = posts.find(post => String(post.logNo) === String(logNo));

  if (!post) throw new Error(`게시글 ${logNo}의 공개 설정을 찾을 수 없습니다.`);

  return post.openType;
}

module.exports = {
  extractPostCategoryNo,
  resolvePostCategoryPath,
  resolvePostOpenType,
};