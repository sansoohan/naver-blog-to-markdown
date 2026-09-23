const cheerio = require("cheerio");
const TurndownService = require("turndown");

const { protectTextComponents } = require("./src/paragraph");
const { protectTables } = require("./src/table");
const { protectQuotes } = require("./src/quote");
const { protectHorizontalLines, getHorizontalLineCss } = require("./src/horizontal-line");
const { protectCodeBlocks } = require("./src/code");
const { protectAttachments } = require("./src/attachment");
const { protectYouTube, protectNaverVideos } = require("./src/video");

function createStore() {
  let index = 0;
  const values = new Map();

  return {
    add(value) {
      const token = `NAVERPLACEHOLDER${String(++index).padStart(8, "0")}END`;
      values.set(token, String(value));
      return token;
    },

    restore(text) {
      let result = String(text);

      /*
       * 보호된 HTML 안에 다른 placeholder가 들어갈 수 있으므로
       * 변경이 없어질 때까지 반복해서 복구한다.
       */
      for (let pass = 0; pass <= values.size; pass++) {
        const previous = result;

        for (const [token, value] of values) result = result.split(token).join(value);
        if (result === previous) break;
      }

      return result;
    },
  };
}

function createTurndown() {
  const turndown = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    strongDelimiter: "**",
  });

  turndown.addRule("protected", {
    filter(node) {
      return node.nodeName === "DIV" && node.classList.contains("naver-protected");
    },

    replacement(content, node) {
      return `\n\n${node.textContent}\n\n`;
    },
  });

  turndown.addRule("lineBreak", {
    filter: "br",

    replacement() {
      return "<br>";
    },
  });

  return turndown;
}

function getLegacyPostRoot($) {
  const content = $("#postViewArea,.se3_view,.post-view,.post-view > .view,.view").first();

  if (content.length) {
    const post = content.closest(".post._post_wrap,.post").first();
    if (post.length) return post;
    return content;
  }

  return $(".post._post_wrap,.post").first();
}

function getPostRoot($, editorVersion = 0) {
  /*
   * SmartEditor 1.x / 2.x:
   * make-html.js와 동일하게 글 전체 .post 래퍼를 사용한다.
   *
   * 구형 첨부파일은 .post 안에 삽입되므로 #postViewArea만 선택하면
   * Markdown 변환 시 첨부파일 영역이 빠질 수 있다.
   */
  if (editorVersion === 1 || editorVersion === 2) {
    const legacy = getLegacyPostRoot($);
    if (legacy.length) return legacy;
  }

  /*
   * SmartEditor 3.x 이상
   */
  const root = $(".se-main-container").first();
  if (root.length) return root;

  /*
   * fallback
   */
  const legacy = getLegacyPostRoot($);
  if (legacy.length) return legacy;

  throw new Error("original.html에서 본문 영역을 찾을 수 없습니다.");
}

function restoreEmptyLines(markdown) {
  return String(markdown)
    .replace(/(?:NAVEREMPTYLINE\s*){3,}/g, "<br>\n<br>\n")
    .replace(/(?:NAVEREMPTYLINE\s*){2}/g, "<br>\n<br>\n")
    .replace(/NAVEREMPTYLINE/g, "<br>");
}

function normalizeBreakSpacing(markdown) {
  const lines = String(markdown).replace(/\r\n?/g, "\n").split("\n");
  const result = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];

    if (line.trim().toLowerCase() !== "<br>") {
      result.push(line);
      continue;
    }

    let count = 1;

    while (index + count < lines.length && lines[index + count].trim().toLowerCase() === "<br>") count++;

    /*
     * <br>이 3개 이상 연속되면 2개까지만 남긴다.
     */
    const preservedCount = Math.min(count, 2);

    for (let offset = 0; offset < preservedCount; offset++) result.push("<br>");

    index += count - 1;

    /*
     * 마지막 <br> 아래에는 반드시 빈 줄을 하나 둔다.
     *
     * 이미지, 목록, 표, 코드블록, 인용문 등 다음 Markdown 블록이
     * HTML 블록에 먹히지 않고 정상적으로 해석되게 하기 위한 처리다.
     */
    const nextLine = lines[index + 1];

    if (nextLine !== undefined && nextLine.trim() !== "") result.push("");
  }

  return result.join("\n");
}

function cleanMarkdown(markdown) {
  return String(markdown)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+\n/g, "\n\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function escapeMarkdownAlt(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

function protectImages($, root, store) {
  const components = root.find(".se-component.se-image").toArray();

  for (const element of components) {
    const component = $(element);
    const images = component.find("img").toArray();

    if (!images.length) continue;

    const parts = [];

    for (const imageElement of images) {
      const image = $(imageElement);
      const src = image.attr("src") || "";

      if (!src) continue;

      const alt = escapeMarkdownAlt(image.attr("alt") || "");
      parts.push(`![${alt}](${src})`);
    }

    if (!parts.length) continue;

    component.replaceWith(`<div class="naver-protected">${store.add(parts.join("\n\n"))}</div>`);
  }
}

function protectStandaloneImages($, root, store) {
  root.find("img").each((_, element) => {
    const image = $(element);

    if (image.closest(".naver-protected").length) return;

    const src = image.attr("src") || "";
    if (!src) return;

    const alt = escapeMarkdownAlt(image.attr("alt") || "");
    const markdown = `![${alt}](${src})`;

    image.replaceWith(`<div class="naver-protected">${store.add(markdown)}</div>`);
  });
}

function protectOgCards($, root, store) {
  const components = root.find(".se-component.se-oglink").toArray();

  for (const element of components) {
    const component = $(element);
    const link = component.find("a[href]").first();

    if (!link.length) continue;

    const href = link.attr("href") || "";
    const title = component.find(".se-oglink-title").first().text().trim() || link.attr("title") || href;
    const summary = component.find(".se-oglink-summary").first().text().trim();
    const domain = component.find(".se-oglink-url").first().text().trim();
    const imageSrc = component.find("img").first().attr("src") || "";
    const parts = [];

    if (imageSrc) parts.push(`<img src="${escapeHtmlAttribute(imageSrc)}" style="max-width:120px;height:auto;">`);

    const text = [
      title ? `<strong>${escapeHtmlText(title)}</strong>` : "",
      summary ? escapeHtmlText(summary) : "",
      domain ? `<small>${escapeHtmlText(domain)}</small>` : "",
    ].filter(Boolean).join("<br>");

    parts.push(`<a href="${escapeHtmlAttribute(href)}">${text}</a>`);

    const html = `<div class="naver-og-card">${parts.join("")}</div>`;
    component.replaceWith(`<div class="naver-protected">${store.add(html)}</div>`);
  }
}

function escapeHtmlText(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlAttribute(value) {
  return escapeHtmlText(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function removeArchiveOnlyElements(root) {
  root.find("script, style").remove();
  root.find(".post-top,.post_footer_contents,.bottom_adpost,.post-btn").remove();
}

function isForeignFormattedBlock($, element) {
  const node = $(element);
  const tagName = String(element.tagName || "").toLowerCase();
  const className = node.attr("class") || "";
  const style = node.attr("style") || "";

  if (tagName === "pre") return true;
  if (/\b(?:hljs|highlight|codehilite|syntaxhighlighter|prettyprint)\b/i.test(className)) return true;
  if (/\blanguage-[\w-]+\b/i.test(className)) return true;
  if (/\bwhite-space\s*:\s*pre(?:-wrap)?\b/i.test(style)) return true;

  if (!/^(?:div|section|article|aside)$/i.test(tagName)) return false;

  const hasComplexBoxStyle = (
    /(?:background(?:-color)?|border|display\s*:\s*(?:flex|grid)|font-family)\s*:/i.test(style)
  );

  const styledChildren = node.find("[style]").length;

  return hasComplexBoxStyle && styledChildren >= 2;
}

function protectForeignFormattedBlocks($, root, store) {
  const selector = [
    "pre",
    ".hljs",
    ".highlight",
    ".codehilite",
    ".syntaxhighlighter",
    ".prettyprint",
    "[class*='language-']",
    "[style]",
  ].join(", ");

  const candidates = root.find(selector).add(root.filter(selector)).toArray();

  for (const element of candidates) {
    const node = $(element);

    if (!node.parent().length) continue;
    if (node.closest(".naver-protected").length) continue;
    if (!isForeignFormattedBlock($, element)) continue;

    const formattedParent = node.parents().toArray().find(parent => {
      if (parent === root[0]) return false;
      return isForeignFormattedBlock($, parent);
    });

    if (formattedParent) continue;

    const html = $.html(element);
    node.replaceWith(`<div class="naver-protected">${store.add(html)}</div>`);
  }
}

function makeMarkdown(originalHtml, options = {}) {
  const { title = "untitled", blogId = "", logNo = "", editorVersion = 0 } = options;

  const $ = cheerio.load(originalHtml, { decodeEntities: false });
  const root = getPostRoot($, editorVersion);
  const store = createStore();

  /*
   * original.html은 모든 다운로드와 로컬화가 끝난 canonical source다.
   * 여기서는 네트워크 요청이나 다운로드를 하지 않는다.
   */
  removeArchiveOnlyElements(root);

  protectAttachments($, root, store);
  protectNaverVideos($, root, store);
  protectYouTube($, root, store);
  protectOgCards($, root, store);
  protectImages($, root, store);
  protectTables($, root, store);
  protectQuotes($, root, store);

  const horizontalLineTypes = protectHorizontalLines($, root, store);

  /*
   * 네이버 고유 코드블록은 Markdown fenced code로 변환한다.
   */
  protectCodeBlocks($, root, store);

  /*
   * 외부 에디터나 웹에서 붙여 넣은 복잡한 서식은 HTML로 보존한다.
   */
  protectForeignFormattedBlocks($, root, store);

  protectTextComponents($, root, store);
  protectStandaloneImages($, root, store);

  const turndown = createTurndown();

  let markdown = turndown.turndown(root.html() || "");

  markdown = store.restore(markdown);
  markdown = restoreEmptyLines(markdown);

  /*
   * 모든 placeholder가 실제 Markdown과 HTML로 복구된 다음
   * <br> 묶음 바로 아래에 빈 줄을 보장한다.
   */
  markdown = normalizeBreakSpacing(markdown);
  markdown = cleanMarkdown(markdown);

  const originalUrl = blogId && logNo ? `https://blog.naver.com/${blogId}/${logNo}` : "";
  const header = originalUrl ? `# ${title}\n\n> 원본: ${originalUrl}` : `# ${title}`;
  const horizontalLineCss = getHorizontalLineCss(horizontalLineTypes);

  return `${header}${horizontalLineCss ? `\n\n${horizontalLineCss}` : ""}\n\n${markdown}\n`;
}

module.exports = {
  makeMarkdown,
};
