import type { PostInfo } from "../types/post";

export const SEARCH_PAGE_SIZE_OPTIONS = [
  5,
  10,
  20,
  30,
  50,
] as const;

export type SearchPageSize =
  typeof SEARCH_PAGE_SIZE_OPTIONS[number];

export function getSearchRoute(
  query: string,
  page = 1,
  pageSize?: number
) {
  const params = new URLSearchParams();

  params.set("q", query);

  if (page > 1) {
    params.set("page", String(page));
  }

  if (pageSize) {
    params.set("size", String(pageSize));
  }

  return `/search?${params.toString()}`;
}

export function searchPosts(
  posts: PostInfo[],
  query: string
) {
  const normalizedQuery =
    query.trim().toLowerCase();

  if (!normalizedQuery) return [];

  return posts.filter(post =>
    post.folderName
      .toLowerCase()
      .includes(normalizedQuery)
  );
}

export function getSearchPage(
  page: string | null,
  totalPages: number
) {
  const parsed = Number(page);

  if (
    !Number.isInteger(parsed) ||
    parsed < 1
  ) {
    return 1;
  }

  if (
    totalPages > 0 &&
    parsed > totalPages
  ) {
    return totalPages;
  }

  return parsed;
}

export function getSearchPageSize(
  value: string | null
): SearchPageSize | null {
  const parsed = Number(value);

  if (
    SEARCH_PAGE_SIZE_OPTIONS.includes(
      parsed as SearchPageSize
    )
  ) {
    return parsed as SearchPageSize;
  }

  return null;
}

export function getAutomaticSearchPageSize(
  availableRows: number
): SearchPageSize {
  let selected: SearchPageSize = 5;

  for (const size of SEARCH_PAGE_SIZE_OPTIONS) {
    if (size > availableRows) break;

    selected = size;
  }

  return selected;
}
