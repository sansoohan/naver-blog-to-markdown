import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";
import { scanPosts } from "./src/post-scanner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const OUTPUT_ROOT = path.join(PROJECT_ROOT, "output");

const PORT = 3001;

const app = express();
const markdown = new MarkdownIt({
  html: true,
  linkify: true,
});

app.use(express.json());

/*
 * output 폴더의 파일을 브라우저에서 직접 접근할 수 있게 한다.
 *
 * 예:
 * /output/카테고리/게시글/original.html
 * /output/카테고리/게시글/se.viewer.desktop.css
 * /output/카테고리/게시글/image.jpg
 * /output/카테고리/게시글/video.mp4
 */
app.use("/output", express.static(OUTPUT_ROOT));

function resolvePostDirectory(relativePath: string): string | null {
  const postDirectory = path.resolve(OUTPUT_ROOT, relativePath);
  const relative = path.relative(OUTPUT_ROOT, postDirectory);

  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;

  return postDirectory;
}

function encodeRelativePath(relativePath: string): string {
  return relativePath
    .replaceAll("\\", "/")
    .split("/")
    .map(segment => encodeURIComponent(segment))
    .join("/");
}

app.get("/api/health", (_request, response) => {
  response.json({
    status: "ok",
    outputRoot: OUTPUT_ROOT,
  });
});

app.get("/api/posts", async (_request, response) => {
  try {
    const posts = await scanPosts(OUTPUT_ROOT);
    response.json(posts);
  } catch (error) {
    console.error(error);

    response.status(500).json({
      error: "output 폴더를 읽는 중 오류가 발생했습니다.",
    });
  }
});

/*
 * original.html
 *
 * HTML 내용을 API에서 직접 보내지 않고 실제 output 파일로 이동시킨다.
 * 그래야 original.html 안의 상대경로 CSS / 이미지 / 비디오가
 * 게시글 폴더를 기준으로 정상적으로 로드된다.
 */
app.get("/api/post/original", async (request, response) => {
  try {
    const relativePath = request.query.path;

    if (typeof relativePath !== "string") {
      response.status(400).send("path가 필요합니다.");
      return;
    }

    const postDirectory = resolvePostDirectory(relativePath);

    if (!postDirectory) {
      response.status(400).send("잘못된 경로입니다.");
      return;
    }

    const filePath = path.join(postDirectory, "original.html");

    await fs.access(filePath);

    const encodedPath = encodeRelativePath(relativePath);

    response.redirect(`/output/${encodedPath}/original.html`);
  } catch (error) {
    console.error(error);
    response.status(404).send("original.html을 찾을 수 없습니다.");
  }
});

/*
 * index.md
 *
 * Markdown을 HTML로 변환해서 브라우저에서 렌더링한다.
 */
app.get("/api/post/markdown", async (request, response) => {
  try {
    const relativePath = request.query.path;

    if (typeof relativePath !== "string") {
      response.status(400).send("path가 필요합니다.");
      return;
    }

    const postDirectory = resolvePostDirectory(relativePath);

    if (!postDirectory) {
      response.status(400).send("잘못된 경로입니다.");
      return;
    }

    const filePath = path.join(postDirectory, "index.md");
    const source = await fs.readFile(filePath, "utf8");
    const content = markdown.render(source);

    const encodedPath = encodeRelativePath(relativePath);
    const baseUrl = `/output/${encodedPath}/`;

    response.type("html").send(`<!doctype html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <base href="${baseUrl}">

  <title>Markdown Preview</title>

  <style>
    * {
      box-sizing: border-box;
    }

    html {
      background: #fff;
    }

    body {
      max-width: 980px;
      margin: 0 auto;
      padding: 32px;
      color: #212529;
      font-family: Arial, "Noto Sans KR", sans-serif;
      line-height: 1.6;
    }

    img,
    video {
      max-width: 100%;
      height: auto;
    }

    table {
      border-collapse: collapse;
    }

    th,
    td {
      padding: 6px 12px;
      border: 1px solid #dee2e6;
    }

    pre {
      overflow: auto;
      padding: 16px;
      background: #f6f8fa;
    }

    code {
      font-family: Consolas, monospace;
    }

    blockquote {
      margin-left: 0;
      padding-left: 16px;
      border-left: 4px solid #dee2e6;
    }
  </style>
</head>

<body>
${content}
</body>
</html>`);
  } catch (error) {
    console.error(error);
    response.status(404).send("index.md를 찾을 수 없습니다.");
  }
});

app.listen(PORT, () => {
  console.log(`Test server running at http://localhost:${PORT}`);
  console.log(`Output directory: ${OUTPUT_ROOT}`);
});
