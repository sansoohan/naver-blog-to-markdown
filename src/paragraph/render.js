// paragraph/render.js
const fontSizeRules = require("../../font-size-rules.json");

function escapeHtmlText(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlAttribute(value) {
  return escapeHtmlText(value).replace(/"/g, "&quot;");
}

function escapeMarkdownUrl(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function escapeMarkdownTitle(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function getStyleProperty(style, property) {
  const match = String(style || "").match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "i"));
  return match ? match[1].trim() : "";
}

function normalizeFontSize(size) {
  const match = String(size || "").trim().match(/^(\d+(?:\.\d+)?)(px|pt)$/i);

  if (!match) return null;

  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  const pixels = unit === "pt" ? value * 96 / 72 : value;

  return `${Math.round(pixels)}px`;
}

function scaleMarkdownFontSize(size) {
  const pixels = getFontSizePixels(size);

  if (pixels === null) return size;

  return `${Math.round(pixels * 16 / 13)}px`;
}

function getParagraphAlignment(node) {
  if (!node || node.type !== "tag") return "";

  const className = node.attribs?.class || "";
  const style = node.attribs?.style || "";
  const align = String(node.attribs?.align || "").trim().toLowerCase();

  /*
   * SmartEditor 3.x 이상
   */
  const classMatch = className.match(/(?:^|\s)se-text-paragraph-align-(left|center|right|justify)(?:\s|$)/);

  if (classMatch) return classMatch[1];

  /*
   * SmartEditor 1.x / 2.x
   */
  const styleAlign = getStyleProperty(style, "text-align").toLowerCase();

  if (/^(?:left|center|right|justify)$/.test(styleAlign)) return styleAlign;
  if (/^(?:left|center|right|justify)$/.test(align)) return align;

  return "";
}

function getNaverFontSize(node) {
  if (!node || node.type !== "tag") return null;

  const className = node.attribs?.class || "";

  /*
   * SmartEditor 3.x 이상
   */
  if (/(?:^|\s)se-fs-(?:\s|$)/.test(className)) return "15px";

  const classMatch = className.match(/(?:^|\s)se-fs-fs(\d+)(?:\s|$)/);

  if (classMatch) return `${classMatch[1]}px`;

  /*
   * SmartEditor 1.x / 2.x
   *
   * CSS에 실제 크기가 명시된 경우 px로 정규화한다.
   * pt는 96dpi 기준으로 px로 변환한 뒤 정수로 반올림한다.
   * <font size="2"> 같은 구형 HTML size 속성은 추정하지 않는다.
   */
  const css = node.attribs?.style || "";
  const styleSize = getStyleProperty(css, "font-size");

  return normalizeFontSize(styleSize);
}

function getFontSizePixels(size) {
  const match = String(size || "").match(/^(\d+(?:\.\d+)?)px$/i);

  return match ? Number(match[1]) : null;
}

function isInFontSizeRange(size, range) {
  const pixels = getFontSizePixels(size);
  if (pixels === null) return false;

  return pixels >= range.min && pixels <= range.max;
}

function getHeadingLevel(size) {
  if (size === null) return 0;

  const range = fontSizeRules.headingRanges.find((item) => isInFontSizeRange(size, item));

  return range?.level || 0;
}

function isBodyFontSize(size) {
  if (size === null) return false;

  return fontSizeRules.bodyRanges.some((range) => isInFontSizeRange(size, range));
}

function normalizeSourceText(text) {
  return String(text).replace(/\u200b/g, "").replace(/\u00a0/g, " ");
}

function sameLink(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;

  return a.href === b.href && a.target === b.target && a.title === b.title;
}

function meaningfulRuns(runs) {
  return runs.filter((run) => run.type === "text" && run.text.trim());
}

function getParagraphFontSize(runs) {
  const meaningful = meaningfulRuns(runs);
  if (!meaningful.length) return null;

  const sizes = [...new Set(meaningful.map((run) => run.style.fontSize))];

  return sizes.length === 1 ? sizes[0] : null;
}

function hasMixedFontSizes(runs) {
  return new Set(meaningfulRuns(runs).map((run) => run.style.fontSize)).size > 1;
}

function parseListItem(runs) {
  let text = "";

  for (const run of runs) {
    if (run.type === "break") break;
    text += run.text || "";
  }

  const match = text.match(/^([ \t]*)[-*]\s+/);
  if (!match) return null;

  return {
    indent: match[1],
    length: match[0].length,
  };
}

function parseCheckbox(runs) {
  let text = "";

  for (const run of runs) {
    if (run.type === "break") break;
    text += run.text || "";
  }

  const match = text.match(/^([ \t]*)-\s+\[([xX ])\]\s*/);
  if (!match) return null;

  return {
    indent: match[1],
    checked: match[2].toLowerCase() === "x" ? "x" : " ",
    length: match[0].length,
  };
}

function removeTextPrefix(runs, length) {
  let remaining = length;

  for (const run of runs) {
    if (remaining <= 0) break;
    if (run.type !== "text") continue;

    if (run.text.length <= remaining) {
      remaining -= run.text.length;
      run.text = "";
    } else {
      run.text = run.text.slice(remaining);
      remaining = 0;
    }
  }

  return runs.filter((run) => run.type !== "text" || run.text);
}

function escapeMarkdownText(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\\/g, "\\\\")
    .replace(/\+/g, "\\+")
    .replace(/([`*_[\]~])/g, "\\$1")
    .replace(/^([ \t]*)(#{1,6}|>|[-+])(?=\s)/gm, "$1\\$2")
    .replace(/^([ \t]*)(\d+)\.(?=\s)/gm, "$1$2\\.");
}

function renderMarkdownFormatting(text, style) {
  let result = escapeMarkdownText(text);
  const hasEdgeSpace = /^\s|\s$/.test(text);

  if (style.strike) {
    result = hasEdgeSpace ? `<s>${result}</s>` : `~~${result}~~`;
  }

  if (style.italic) {
    result = hasEdgeSpace ? `<em>${result}</em>` : `*${result}*`;
  }

  if (style.bold) {
    result = hasEdgeSpace ? `<strong>${result}</strong>` : `**${result}**`;
  }

  return result;
}

function isBlackColor(color) {
  const value = String(color || "").trim().replace(/\s+/g, "").toLowerCase();

  return value === "#000"
    || value === "#000000"
    || value === "black"
    || value === "rgb(0,0,0)"
    || value === "rgba(0,0,0,1)"
    || value === "rgba(0,0,0,1.0)";
}

function renderHtmlFormatting(text, style, preserveFontSize) {
  let result = escapeHtmlText(text).replace(/`/g, "&#96;");

  if (style.strike) result = `<s>${result}</s>`;
  if (style.italic) result = `<em>${result}</em>`;
  if (style.bold) result = `<strong>${result}</strong>`;
  if (style.underline) result = `<u>${result}</u>`;

  const css = [];

  if (preserveFontSize && style.fontSize !== null) css.push(`font-size:${scaleMarkdownFontSize(style.fontSize)}`);

  if (style.color && (!isBlackColor(style.color) || style.backgroundColor)) {
    css.push(`color:${style.color}`);
  }

  if (style.backgroundColor) css.push(`background-color:${style.backgroundColor}`);

  if (css.length) result = `<span style="${css.join(";")}">${result}</span>`;

  return result;
}

function needsHtml(style, preserveFontSize) {
  const meaningfulColor = style.color && (!isBlackColor(style.color) || style.backgroundColor);

  return Boolean(
    preserveFontSize
    || meaningfulColor
    || style.backgroundColor
    || style.underline
  );
}

function renderMarkdownLink(content, link) {
  const href = escapeMarkdownUrl(link.href);
  const title = link.title ? ` "${escapeMarkdownTitle(link.title)}"` : "";

  return `[${content}](${href}${title})`;
}

function renderHtmlLink(content, link) {
  let attrs = `href="${escapeHtmlAttribute(link.href)}"`;

  if (link.target) attrs += ` target="${escapeHtmlAttribute(link.target)}"`;
  if (link.title) attrs += ` title="${escapeHtmlAttribute(link.title)}"`;

  return `<a ${attrs}>${content}</a>`;
}

function shouldPreserveRunFontSize(run, context) {
  if (run.type !== "text" || run.style.fontSize === null) return false;
  if (context.heading) return false;

  /*
   * SmartEditor 3.x는 se_fs_T* 클래스에 지정된 본문 크기를 보존한다.
   */
  if (context.editorVersion === 3) return true;

  /*
   * 서로 다른 폰트 크기가 한 문단에 섞여 있으면 Markdown heading으로
   * 표현할 수 없으므로 각 run의 원래 크기를 그대로 보존한다.
   */
  if (context.mixed) return true;

  /*
   * 체크박스는 heading으로 변환하지 않는다.
   * 본문 크기만 일반 텍스트로 처리하고 나머지는 실제 크기를 보존한다.
   */
  if (context.checkbox) return !isBodyFontSize(run.style.fontSize);

  /*
   * 단일 크기 문단에서 heading 범위는 이미 context.heading으로 처리됐다.
   * 따라서 여기까지 왔다면 본문 범위 또는 커스텀 크기다.
   */
  return !isBodyFontSize(run.style.fontSize);
}

function stripLink(style) {
  return { ...style, link: null };
}

function groupRunsByLink(runs) {
  const groups = [];
  let current = null;

  for (const run of runs) {
    if (run.type === "break") {
      groups.push({ type: "break" });
      current = null;
      continue;
    }

    const link = run.style.link;

    if (!link?.href) {
      if (current?.type === "plain") {
        current.runs.push(run);
      } else {
        current = { type: "plain", runs: [run] };
        groups.push(current);
      }

      continue;
    }

    if (current?.type === "link" && sameLink(current.link, link)) {
      current.runs.push(run);
      continue;
    }

    current = {
      type: "link",
      link: { ...link },
      runs: [run],
    };

    groups.push(current);
  }

  return groups;
}

/*
 * !!! REGRESSION WARNING !!!
 *
 * 기존 기능 절대 누락/삭제/되돌리지 말 것.
 * 이 함수는 문단 맨 앞 공백까지 &nbsp;로 보존해야 한다.
 *
 * 전체 코드 수정 시 과거 버전으로 덮어쓰지 말고,
 * 반드시 현재 최신 코드를 기준으로 필요한 부분만 수정할 것.
 *
 * 기능누락 또 하면 뒤진다.
 */
function preserveMultipleSpaces(text) {
  return String(text)
    .replace(/^ +/, spaces => "&nbsp;".repeat(spaces.length))
    .replace(/ {2,}/g, spaces => "&nbsp;".repeat(spaces.length));
}

module.exports = {
  escapeHtmlText,
  escapeHtmlAttribute,
  getStyleProperty,
  normalizeFontSize,
  scaleMarkdownFontSize,
  getParagraphAlignment,
  getNaverFontSize,
  getHeadingLevel,
  isBodyFontSize,
  normalizeSourceText,
  sameLink,
  getParagraphFontSize,
  hasMixedFontSizes,
  parseListItem,
  parseCheckbox,
  removeTextPrefix,
  renderMarkdownFormatting,
  renderHtmlFormatting,
  needsHtml,
  renderMarkdownLink,
  renderHtmlLink,
  shouldPreserveRunFontSize,
  stripLink,
  groupRunsByLink,
  preserveMultipleSpaces,
};