import fs from "node:fs/promises";
import path from "node:path";

export type PostInfo = {
  id: string;
  category: string;
  folderName: string;
  relativePath: string;
  hasHtml: boolean;
  hasMarkdown: boolean;
};

export async function scanPosts(outputRoot: string): Promise<PostInfo[]> {
  const posts: PostInfo[] = [];

  async function scan(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });

    const files = new Set(
      entries
        .filter(entry => entry.isFile())
        .map(entry => entry.name),
    );

    const hasHtml = files.has("original.html");
    const hasMarkdown = files.has("index.md");

    if (hasHtml || hasMarkdown) {
      const relativePath = path.relative(outputRoot, directory);
      const normalizedPath = relativePath.replaceAll("\\", "/");
      const parts = normalizedPath.split("/");

      posts.push({
        id: normalizedPath,
        category: parts.slice(0, -1).join("/"),
        folderName: parts.at(-1) ?? "",
        relativePath: normalizedPath,
        hasHtml,
        hasMarkdown,
      });

      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === ".tmp") continue;

      await scan(path.join(directory, entry.name));
    }
  }

  try {
    await scan(outputRoot);
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

  return posts.sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath, "ko", {
      numeric: true,
    }),
  );
}
