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

      for (const [token, value] of values) {
        result = result.split(token).join(value);
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

function getPostRoot($) {
  const root = $(".se-main-container").first();

  if (root.length) return root;

  const postView = $("#postViewArea").first();

  if (postView.length) return postView;

  const legacy = $(".se3_view").first();

  if (legacy.length) return legacy;

  throw new Error("original.html에서 본문 영역을 찾을 수 없습니다.");
}

function restoreEmptyLines(markdown) {
  return String(markdown)
    .replace(/(?:NAVEREMPTYLINE\s*){3,}/g, "<br>\n<br>\n")
    .replace(/(?:NAVEREMPTYLINE\s*){2}/g, "<br>\n<br>\n")
    .replace(/NAVEREMPTYLINE/g, "<br>")
    .replace(/<br>[ \t]*\n(?=```)/g, "<br>\n\n");
}

function cleanMarkdown(markdown) {
  return String(markdown)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+\n/g, "\n\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
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
      const alt = image.attr("alt") || "";

      if (!src) continue;

      const escapedAlt = alt
        .replace(/\\/g, "\\\\")
        .replace(/\[/g, "\\[")
        .replace(/\]/g, "\\]");

      parts.push(`![${escapedAlt}](${src})`);
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

    const alt = (image.attr("alt") || "")
      .replace(/\\/g, "\\\\")
      .replace(/\[/g, "\\[")
      .replace(/\]/g, "\\]");

    image.replaceWith(`<div class="naver-protected">${store.add(`![${alt}](${src})`)}</div>`);
  });
}

function protectOgCards($, root, store) {
  const components = root.find(".se-component.se-oglink").toArray();

  for (const element of components) {
    const component = $(element);
    const link = component.find("a[href]").first();

    if (!link.length) continue;

    const href = link.attr("href") || "";
    const title = component.find(".se-oglink-title").first().text().trim()
      || link.attr("title")
      || href;

    const summary = component.find(".se-oglink-summary").first().text().trim();
    const domain = component.find(".se-oglink-url").first().text().trim();
    const image = component.find("img").first();
    const imageSrc = image.attr("src") || "";

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
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlAttribute(value) {
  return escapeHtmlText(value)
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function removeArchiveOnlyElements(root) {
  root.find("script").remove();
  root.find("style").remove();
}

function makeMarkdown(originalHtml, options = {}) {
  const { title = "untitled", blogId = "", logNo = "" } = options;

  const $ = cheerio.load(originalHtml, { decodeEntities: false });
  const root = getPostRoot($);
  const store = createStore();

  /*
   * 중요:
   * original.html은 이미 모든 다운로드/로컬화가 끝난 canonical source다.
   * 여기서는 네트워크 요청이나 다운로드를 절대 하지 않는다.
   */

  protectAttachments($, root, store);
  protectNaverVideos($, root, store);
  protectYouTube($, root, store);

  protectOgCards($, root, store);
  protectImages($, root, store);

  protectTables($, root, store);
  protectQuotes($, root, store);

  const horizontalLineTypes = protectHorizontalLines($, root, store);

  /*
   * code는 text보다 반드시 먼저.
   * code 내부 텍스트가 일반 paragraph 처리에 먹히면 안 된다.
   */
  protectCodeBlocks($, root, store);
  protectTextComponents($, root, store);

  protectStandaloneImages($, root, store);

  removeArchiveOnlyElements(root);

  const turndown = createTurndown();

  let markdown = turndown.turndown(root.html() || "");

  markdown = store.restore(markdown);
  markdown = restoreEmptyLines(markdown);
  markdown = cleanMarkdown(markdown);

  const originalUrl = blogId && logNo
    ? `https://blog.naver.com/${blogId}/${logNo}`
    : "";

  const header = originalUrl
    ? `# ${title}\n\n> 원본: ${originalUrl}`
    : `# ${title}`;

  const horizontalLineCss = getHorizontalLineCss(horizontalLineTypes);

  return `${header}${horizontalLineCss ? `\n\n${horizontalLineCss}` : ""}\n\n${markdown}\n`;
}

module.exports = {
  makeMarkdown,
};
