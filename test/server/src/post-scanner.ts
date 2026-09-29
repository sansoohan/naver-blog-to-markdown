import fs from "node:fs/promises";
import path from "node:path";

export type PostInfo = {
  id: string;
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

function normalizeRelativePath(outputRoot: string, cachedPath: string): string {
  const normalizedCachedPath = cachedPath.replaceAll("\\", "/");
  const normalizedOutputRoot = outputRoot.replaceAll("\\", "/");
  const outputFolderName = path.basename(normalizedOutputRoot);

  if (normalizedCachedPath === outputFolderName) {
    return "";
  }

  if (normalizedCachedPath.startsWith(`${outputFolderName}/`)) {
    return normalizedCachedPath.slice(outputFolderName.length + 1);
  }

  if (path.isAbsolute(cachedPath)) {
    return path.relative(outputRoot, cachedPath).replaceAll("\\", "/");
  }

  return normalizedCachedPath;
}

function getSourceUrl(cacheKey: string): string {
  const parts = cacheKey.split("/");

  if (parts.length < 2) return "";

  const blogId = parts[0];
  const logNo = parts[1];

  if (!blogId || !logNo) return "";

  return `https://blog.naver.com/${blogId}/${logNo}`;
}

export async function scanPosts(outputRoot: string): Promise<PostInfo[]> {
  const cachePath = path.join(outputRoot, "backup-cache.json");

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

    const relativePath = normalizeRelativePath(outputRoot, entry.path);

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
          : parts.slice(0, -1).join("/");

    posts.push({
      id: relativePath,
      category,
      folderName,
      relativePath,
      title: typeof entry.title === "string" && entry.title ? entry.title : folderName,
      sourceUrl: getSourceUrl(cacheKey),
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
