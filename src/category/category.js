const CategoryVisibility = {
  PUBLIC: "public",
  PRIVATE: "private",
};

function parseBlogUrl(url) {
  const parsed = new URL(url);
  const parts = parsed.pathname.split("/").filter(Boolean);
  const blogId = parsed.searchParams.get("blogId") || parts[0];

  if (!blogId) throw new Error("네이버 블로그 URL에서 blogId를 확인할 수 없습니다.");

  return {blogId};
}

function getCategoryPathParts(category, categories) {
  const parts = [];
  const visited = new Set();
  let current = category;

  while (current) {
    if (visited.has(current.categoryNo)) break;

    visited.add(current.categoryNo);
    parts.unshift(current.name);

    if (!current.parentCategoryNo) break;

    current = categories.find(item => item.categoryNo === current.parentCategoryNo);
  }

  return parts;
}

function getCategoryPath(category, categories) {
  return getCategoryPathParts(category, categories).join(" > ");
}

function formatCategory(category, categories) {
  return getCategoryPath(category, categories);
}

function getChildren(category, categories) {
  return categories.filter(item => item.parentCategoryNo === category.categoryNo);
}

function getDescendantCategories(category, categories) {
  const result = [];
  const visited = new Set();

  function visit(current) {
    if (visited.has(current.categoryNo)) return;

    visited.add(current.categoryNo);

    for (const child of getChildren(current, categories)) {
      result.push(child);
      visit(child);
    }
  }

  visit(category);
  return result;
}

function getDescendantLeafCategories(category, categories) {
  return getDescendantCategories(category, categories).filter(
    item => !getChildren(item, categories).length
  );
}

function getLeafCategories(categories) {
  return categories.filter(
    category => !categories.some(item => item.parentCategoryNo === category.categoryNo)
  );
}

function getPostCategories(categories) {
  return categories;
}

module.exports = {
  CategoryVisibility,
  parseBlogUrl,
  getCategoryPathParts,
  getCategoryPath,
  formatCategory,
  getChildren,
  getDescendantCategories,
  getDescendantLeafCategories,
  getLeafCategories,
  getPostCategories,
};