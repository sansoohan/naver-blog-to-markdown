import fs from "node:fs/promises";
import path from "node:path";

export type PostInfo = {
  blogId: string;
  postId: string;
  category: string;
  folderName: string;
  relativePath: string;
  title: string;
  sourceUrl: string;
  hasHtml: boolean;
  hasMarkdown: boolean;
};

type BackupCacheEntry = {
  hash?: string;
  modifiedAt?: string | null;
  title?: string;
  category?: string;
  categoryPath?: string[];
  editorVersion?: number;
  path?: string;
  backedUpAt?: string;
  resources?: Record<string, unknown>;
  videos?: Record<string, unknown>;
};

type BackupCache = Record<string, BackupCacheEntry>;

function normalizeRelativePath(outputRoot: string, blogId: string, cachedPath: string): string {
  const normalizedCachedPath = cachedPath.replaceAll("\\", "/");
  const normalizedOutputRoot = outputRoot.replaceAll("\\", "/");
  const outputFolderName = path.basename(normalizedOutputRoot);
  const blogOutputRoot = path.join(outputRoot, blogId);
  const normalizedBlogOutputRoot = blogOutputRoot.replaceAll("\\", "/");

  if (path.isAbsolute(cachedPath)) {
    return path.relative(outputRoot, cachedPath).replaceAll("\\", "/");
  }

  if (normalizedCachedPath.startsWith(`${outputFolderName}/${blogId}/`)) {
    return normalizedCachedPath.slice(outputFolderName.length + 1);
  }

  if (normalizedCachedPath.startsWith(`${blogId}/`)) {
    return normalizedCachedPath;
  }

  if (normalizedCachedPath.startsWith(`${normalizedBlogOutputRoot}/`)) {
    return path.relative(outputRoot, cachedPath).replaceAll("\\", "/");
  }

  return `${blogId}/${normalizedCachedPath}`;
}

function getPostId(cacheKey: string): string {
  const parts = cacheKey.split("/");

  return parts.at(-1) || "";
}

export async function scanBlogIds(outputRoot: string): Promise<string[]> {
  let entries;

  try {
    entries = await fs.readdir(outputRoot, {withFileTypes: true});
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }

    throw error;
  }

  const blogIds: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === ".tmp") continue;

    const cachePath = path.join(outputRoot, entry.name, "backup-cache.json");

    try {
      const stat = await fs.stat(cachePath);

      if (stat.isFile()) {
        blogIds.push(entry.name);
      }
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        continue;
      }

      throw error;
    }
  }

  return blogIds.sort((a, b) =>
    a.localeCompare(b, "ko", {
      numeric: true,
    }),
  );
}

export async function scanPosts(outputRoot: string, blogId: string): Promise<PostInfo[]> {
  const cachePath = path.join(outputRoot, blogId, "backup-cache.json");

  let cache: BackupCache;

  try {
    const source = await fs.readFile(cachePath, "utf8");
    cache = JSON.parse(source) as BackupCache;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }

    if (error instanceof SyntaxError) {
      console.warn(`backup-cache.json 파싱 실패: ${cachePath}`);
      return [];
    }

    throw error;
  }

  const posts: PostInfo[] = [];

  for (const [cacheKey, entry] of Object.entries(cache)) {
    if (!entry || typeof entry !== "object") continue;
    if (typeof entry.path !== "string" || !entry.path) continue;

    const postId = getPostId(cacheKey);

    if (!postId) continue;

    const relativePath = normalizeRelativePath(outputRoot, blogId, entry.path);

    if (!relativePath) continue;
    if (relativePath === ".." || relativePath.startsWith("../")) continue;

    const parts = relativePath.split("/");
    const folderName = parts.at(-1) ?? "";

    if (!folderName) continue;

    const category =
      Array.isArray(entry.categoryPath) && entry.categoryPath.length > 0
        ? entry.categoryPath.join("/")
        : typeof entry.category === "string"
          ? entry.category
          : parts.slice(1, -1).join("/");

    posts.push({
      blogId,
      postId,
      category,
      folderName,
      relativePath,
      title: typeof entry.title === "string" && entry.title ? entry.title : folderName,
      sourceUrl: `https://blog.naver.com/${blogId}/${postId}`,
      hasHtml: true,
      hasMarkdown: true,
    });
  }

  return posts.sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath, "ko", {
      numeric: true,
    }),
  );
}