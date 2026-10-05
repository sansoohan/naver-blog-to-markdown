import express, {type Request, type Response} from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scanBlogIds, scanPosts } from "./src/post-scanner.js";
import markdown from "./src/markdown/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

function getOutputRoot(): string {
  const args = process.argv.slice(2);

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];

    if (arg === "--output" || arg === "-o") {
      const outputDir = args[index + 1];

      if (!outputDir) {
        throw new Error(`${arg} 뒤에 output 경로가 필요합니다.`);
      }

      return path.resolve(outputDir);
    }

    if (arg.startsWith("--output=")) {
      const outputDir = arg.slice("--output=".length);

      if (!outputDir) {
        throw new Error("--output 뒤에 output 경로가 필요합니다.");
      }

      return path.resolve(outputDir);
    }
  }

  return path.join(PROJECT_ROOT, "output");
}

const OUTPUT_ROOT = getOutputRoot();

const PORT = 3001;

const app = express();
app.use(express.json());

/*
 * output 폴더의 파일을 브라우저에서 직접 접근할 수 있게 한다.
 *
 * 예:
 * /output/네이버ID/카테고리/게시글/original.html
 * /output/네이버ID/카테고리/게시글/se.viewer.desktop.css
 * /output/네이버ID/카테고리/게시글/image.jpg
 * /output/네이버ID/카테고리/게시글/video.mp4
 */
app.use("/output", express.static(OUTPUT_ROOT));

app.use("/fonts", express.static(path.join(OUTPUT_ROOT, ".font")));

/*
 * SmartEditor V1 예외
 *
 * 구형 블로그의 blog-layout.css는 WOFF2 파일명과
 * 실제 font-family 이름이 일치하지 않는 폰트가 있다.
 */
const V1_FONT_FACE_INFO: Record<string, {family: string; weight: number}> = {
  "blogCommonIconFont12.woff2": {family: "blogCommonIconFont", weight: 400},
  "NanumSquareEB.woff2": {family: "NanumSquareWebFont", weight: 800},
  "NanumGothic-Regular.woff2": {family: "NanumGothicWebFont", weight: 400},
  "NanumGothic-Bold.woff2": {family: "NanumGothicWebFont", weight: 700},
  "nanummyeongjo-regular.woff2": {family: "NanumMyeongjoWebFont", weight: 400},
  "nanummyeongjo-bold.woff2": {family: "NanumMyeongjoWebFont", weight: 700},
  "nanumbarungothic-regular.woff2": {family: "NanumBarunGothicWebFont", weight: 400},
  "nanumbarungothic-blod.woff2": {family: "NanumBarunGothicWebFont", weight: 700},
};

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

function deferYouTubeIframes(html: string): string {
  return html.replace(
    /<iframe\b([^>]*?)\bsrc=(["'])(https?:\/\/(?:www\.)?(?:youtube\.com\/embed\/|youtube-nocookie\.com\/embed\/)[^"']+)\2([^>]*)>/gi,
    (_match, before, quote, src, after) => {
      return `<iframe${before}data-youtube-src=${quote}${src}${quote}${after}>`;
    },
  );
}

function getYouTubeDeferredLoaderScript(): string {
  return `
<script>
(function () {
  function restoreYouTubeIframes() {
    var iframes = document.querySelectorAll("iframe[data-youtube-src]");

    iframes.forEach(function (iframe, index) {
      var src = iframe.getAttribute("data-youtube-src");

      if (!src) return;

      window.setTimeout(function () {
        iframe.setAttribute("src", src);
        iframe.removeAttribute("data-youtube-src");
      }, index * 150);
    });
  }

  window.addEventListener("load", function () {
    window.setTimeout(restoreYouTubeIframes, 0);
  });
})();
</script>`;
}

function getFontFaceInfo(filename: string) {
  const v1 = V1_FONT_FACE_INFO[filename];

  if (v1) {
    return v1;
  }

  const basename = filename.replace(/\.woff2$/i, "");
  const match = basename.match(/^(.*)-(regular|semibold|bold)$/i);

  if (!match) {
    return {family: basename, weight: 400};
  }

  const weight = match[2].toLowerCase() === "bold" ? 700 : match[2].toLowerCase() === "semibold" ? 600 : 400;
  return {family: match[1], weight};
}

app.get("/api/fonts.css", async (_request: Request, response: Response) => {
  try {
    const fontDir = path.join(OUTPUT_ROOT, ".font");
    let entries;

    try {
      entries = await fs.readdir(fontDir, {withFileTypes: true});
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        response.type("text/css").send("");
        return;
      }

      throw error;
    }

    const rules = entries
      .filter(entry => entry.isFile() && /\.woff2$/i.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(entry => {
        const {family, weight} = getFontFaceInfo(entry.name);
        const encodedFilename = encodeURIComponent(entry.name);

        return `@font-face{font-family:${JSON.stringify(family)};font-style:normal;font-weight:${weight};src:url("/fonts/${encodedFilename}") format("woff2");}`;
      });

    response.type("text/css").send(rules.join("\n"));
  } catch (error) {
    console.error(error);
    response.status(500).type("text/css").send("");
  }
});

app.get("/api/health", (_request: Request, response: Response) => {
  response.json({
    status: "ok",
    outputRoot: OUTPUT_ROOT,
  });
});

app.get("/api/blogs", async (_request: Request, response: Response) => {
  try {
    const blogIds = await scanBlogIds(OUTPUT_ROOT);

    response.json(blogIds);
  } catch (error) {
    console.error(error);

    response.status(500).json({
      error: "블로그 ID 목록을 읽는 중 오류가 발생했습니다.",
    });
  }
});

app.get("/api/posts", async (request: Request, response: Response) => {
  try {
    const blogId = request.query.blogId;

    if (typeof blogId !== "string" || !blogId.trim()) {
      response.status(400).json({
        error: "blogId가 필요합니다.",
      });
      return;
    }

    const blogIds = await scanBlogIds(OUTPUT_ROOT);

    if (!blogIds.includes(blogId)) {
      response.status(404).json({
        error: "블로그 ID를 찾을 수 없습니다.",
      });
      return;
    }

    const posts = await scanPosts(OUTPUT_ROOT, blogId);

    response.json(posts);
  } catch (error) {
    console.error(error);

    response.status(500).json({
      error: "output 폴더를 읽는 중 오류가 발생했습니다.",
    });
  }
});

app.post("/api/post/open-folder", async (request: Request, response: Response) => {
  try {
    const relativePath = request.body?.path;

    if (typeof relativePath !== "string") {
      response.status(400).json({
        error: "path가 필요합니다.",
      });
      return;
    }

    const postDirectory = resolvePostDirectory(relativePath);

    if (!postDirectory) {
      response.status(400).json({
        error: "잘못된 경로입니다.",
      });
      return;
    }

    const stat = await fs.stat(postDirectory);

    if (!stat.isDirectory()) {
      response.status(404).json({
        error: "게시글 폴더를 찾을 수 없습니다.",
      });
      return;
    }

    if (process.platform !== "win32") {
      response.status(501).json({
        error: "현재 폴더 열기는 Windows에서만 지원합니다.",
      });
      return;
    }

    const explorer = spawn("explorer.exe", [postDirectory], {
      detached: true,
      stdio: "ignore",
    });

    explorer.unref();

    response.json({
      success: true,
    });
  } catch (error) {
    console.error(error);

    response.status(500).json({
      error: "게시글 폴더를 여는 중 오류가 발생했습니다.",
    });
  }
});

/*
 * original.html
 *
 * 생성된 original.html로 이동한다.
 * CSS / 이미지 / 비디오 등의 상대경로는
 * 게시글 폴더를 기준으로 그대로 로드된다.
 *
 * YouTube 지연 로딩은 original.html 자체에서 처리한다.
 */
app.get("/api/post/original", async (request: Request, response: Response) => {
  try {
    const relativePath = request.query.path;
    const applyFonts = request.query.applyFonts === "1";

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
    let html = await fs.readFile(filePath, "utf8");

    const encodedPath = encodeRelativePath(relativePath);
    const baseUrl = `/output/${encodedPath}/`;

    const fontHead = applyFonts
      ? `<link id="viewer-fonts" rel="stylesheet" href="/api/fonts.css">`
      : `<style id="viewer-font-override">
  .se-viewer,
  .se-viewer *,
  .post,
  .post * {
    font-family: Arial, "Noto Sans KR", sans-serif !important;
  }

  body {
    font-family: Arial, "Noto Sans KR", sans-serif !important;
  }
</style>`;

    html = html.replace(
      /<head(\s[^>]*)?>/i,
      match => `${match}\n<base href="${baseUrl}">\n${fontHead}`,
    );

    response.type("html").send(html);
  } catch (error) {
    console.error(error);
    response.status(404).send("original.html을 찾을 수 없습니다.");
  }
});

/*
 * index.md
 *
 * Markdown을 HTML로 변환해서 브라우저에서 렌더링한다.
 *
 * YouTube iframe의 src는 먼저 data-youtube-src로 옮겨 두고,
 * 본문이 로드된 뒤 실제 src를 복구해서 순차적으로 로드한다.
 */
app.get("/api/post/markdown", async (request: Request, response: Response) => {
  try {
    const relativePath = request.query.path;
    const applyFonts = request.query.applyFonts === "1";

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
    const renderedContent = markdown.render(source);
    const content = deferYouTubeIframes(renderedContent);

    const encodedPath = encodeRelativePath(relativePath);
    const baseUrl = `/output/${encodedPath}/`;

    const fontHead = applyFonts
      ? `
  <link id="viewer-fonts" rel="stylesheet" href="/api/fonts.css">

  <style>
    body {
      font-family: se-nanumgothic, Arial, "나눔고딕", NanumGothic, sans-serif, Meiryo !important;
    }
  </style>`
      : "";

    response.type("html").send(`<!doctype html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <base href="${baseUrl}">

  <title>Markdown Preview</title>
${fontHead}

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

${getYouTubeDeferredLoaderScript()}
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