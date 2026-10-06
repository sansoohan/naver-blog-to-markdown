// paragraph/legacy.js
const {
  escapeHtmlText,
  escapeHtmlAttribute,
  getStyleProperty,
  normalizeFontSize,
  scaleMarkdownFontSize,
  getParagraphFontSize,
  hasMixedFontSizes,
  getHeadingLevel,
  isBodyFontSize,
  normalizeSourceText,
  sameLink,
  parseListItem,
  parseCheckbox,
  removeTextPrefix,
  renderMarkdownFormatting,
  renderMarkdownLink,
  renderHtmlLink,
  shouldPreserveRunFontSize,
  stripLink,
  groupRunsByLink,
  preserveMultipleSpaces,
} = require("./render");

function getLegacyParagraphAlignment(node) {
  if (!node || node.type !== "tag") return "";

  const style = node.attribs?.style || "";
  const align = String(node.attribs?.align || "").trim().toLowerCase();

  /*
   * SmartEditor 1.x / 2.x
   */
  const styleAlign = getStyleProperty(style, "text-align").toLowerCase();

  if (/^(?:left|center|right|justify)$/.test(styleAlign)) return styleAlign;
  if (/^(?:left|center|right|justify)$/.test(align)) return align;

  return "";
}

function getLegacyFontSize(node) {
  if (!node || node.type !== "tag") return null;

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

function parseInlineStyle(style) {
  const result = {};
  const source = String(style || "");
  let start = 0;
  let quote = "";
  let depth = 0;

  const addDeclaration = (declaration) => {
    let separator = -1;
    let localQuote = "";
    let localDepth = 0;

    for (let index = 0; index < declaration.length; index++) {
      const char = declaration[index];

      if (localQuote) {
        if (char === "\\") {
          index++;
          continue;
        }

        if (char === localQuote) localQuote = "";
        continue;
      }

      if (char === '"' || char === "'") {
        localQuote = char;
        continue;
      }

      if (char === "(") {
        localDepth++;
        continue;
      }

      if (char === ")") {
        if (localDepth > 0) localDepth--;
        continue;
      }

      if (char === ":" && localDepth === 0) {
        separator = index;
        break;
      }
    }

    if (separator === -1) return;

    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();

    if (!property || !value) return;

    result[property] = value;
  };

  for (let index = 0; index < source.length; index++) {
    const char = source[index];

    if (quote) {
      if (char === "\\") {
        index++;
        continue;
      }

      if (char === quote) quote = "";
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === "(") {
      depth++;
      continue;
    }

    if (char === ")") {
      if (depth > 0) depth--;
      continue;
    }

    if (char === ";" && depth === 0) {
      addDeclaration(source.slice(start, index));
      start = index + 1;
    }
  }

  addDeclaration(source.slice(start));

  return result;
}

function mergeInlineStyle(base, extra) {
  return {
    ...base,
    ...extra,
  };
}

function sameLegacyStyle(a, b) {
  const aEntries = Object.entries(a || {});
  const bEntries = Object.entries(b || {});

  if (aEntries.length !== bEntries.length) return false;

  return aEntries.every(([property, value]) => b[property] === value);
}

function renderInlineStyle(style) {
  return Object.entries(style || {}).map(([property, value]) => `${property}:${value}`).join(";");
}

function createLegacyStyleState() {
  return {
    fontSize: null,
    color: "",
    backgroundColor: "",
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    css: {},
    link: null,
  };
}

function cloneLegacyStyle(style) {
  return {
    ...style,
    css: { ...style.css },
    link: style.link ? { ...style.link } : null,
  };
}

function sameLegacyRunStyle(a, b) {
  return a.fontSize === b.fontSize
    && a.color === b.color
    && a.backgroundColor === b.backgroundColor
    && a.bold === b.bold
    && a.italic === b.italic
    && a.underline === b.underline
    && a.strike === b.strike
    && sameLegacyStyle(a.css, b.css)
    && sameLink(a.link, b.link);
}

function applyLegacyCssFormattingState(state, css) {
  const fontWeight = String(css["font-weight"] || "").trim().toLowerCase();
  const fontStyle = String(css["font-style"] || "").trim().toLowerCase();
  const textDecoration = [
    css["text-decoration"],
    css["text-decoration-line"],
  ].filter(Boolean).join(" ").toLowerCase();

  if (fontWeight) {
    if (fontWeight === "normal" || fontWeight === "400") {
      state.bold = false;
    } else if (fontWeight === "bold" || fontWeight === "bolder" || Number(fontWeight) >= 600) {
      state.bold = true;
    }
  }

  if (fontStyle) {
    if (fontStyle === "normal") {
      state.italic = false;
    } else if (fontStyle === "italic" || fontStyle === "oblique") {
      state.italic = true;
    }
  }

  if (textDecoration) {
    if (/\bnone\b/.test(textDecoration)) {
      state.underline = false;
      state.strike = false;
    }

    if (/\bunderline\b/.test(textDecoration)) state.underline = true;
    if (/\bline-through\b/.test(textDecoration)) state.strike = true;
  }
}

function getLegacyPreservedCss(css) {
  const result = {};

  for (const [property, value] of Object.entries(css || {})) {
    if (
      property === "font-size"
      || property === "font-family"
      || property === "line-height"           // Markdown에서 적용할 수 없는 줄 간격은 보존하지 않는다.
      || property === "letter-spacing"
      || property === "font-weight"
      || property === "font-style"
      || property === "text-decoration"
      || property === "text-decoration-line"
      || property === "color"
      || property === "background-color"
    ) {
      continue;
    }

    result[property] = value;
  }

  return result;
}

function applyLegacyStyle(node, state) {
  if (!node || node.type !== "tag") return;

  const name = String(node.name || "").toLowerCase();
  const css = parseInlineStyle(node.attribs?.style || "");

  /*
   * SmartEditor 1.x / 2.x
   *
   * 구형 <font>의 color/face 속성도 CSS와 같은 방식으로 보존한다.
   * size 속성은 실제 px/pt 크기를 알 수 없으므로 임의로 추정하지 않는다.
   */
  if (name === "font") {
    if (!css.color && node.attribs?.color) css.color = node.attribs.color;
    if (!css["font-family"] && node.attribs?.face) css["font-family"] = node.attribs.face;
  }

  if (Object.keys(css).length) {
    state.css = mergeInlineStyle(state.css, getLegacyPreservedCss(css));
    applyLegacyCssFormattingState(state, css);
  }

  const size = getLegacyFontSize(node);

  if (size !== null) state.fontSize = size;

  if (css.color) state.color = css.color;
  if (css["background-color"]) state.backgroundColor = css["background-color"];

  if (name === "b" || name === "strong") state.bold = true;
  if (name === "i" || name === "em") state.italic = true;
  if (name === "u") state.underline = true;
  if (name === "s" || name === "strike" || name === "del") state.strike = true;

  if (name === "a") {
    state.link = {
      href: node.attribs?.href || "",
      target: node.attribs?.target || "",
      title: node.attribs?.title || "",
    };
  }
}

function collectLegacyStyleRuns(node, inherited = createLegacyStyleState(), runs = []) {
  if (!node) return runs;

  if (node.type === "text") {
    const text = normalizeSourceText(node.data || "");

    if (text) {
      runs.push({
        type: "text",
        text,
        style: cloneLegacyStyle(inherited),
      });
    }

    return runs;
  }

  if (node.type !== "tag") return runs;

  const name = String(node.name || "").toLowerCase();

  if (name === "br") {
    runs.push({ type: "break" });
    return runs;
  }

  const state = cloneLegacyStyle(inherited);

  applyLegacyStyle(node, state);

  for (const child of node.children || []) {
    collectLegacyStyleRuns(child, state, runs);
  }

  return runs;
}

function mergeLegacyRuns(runs) {
  const result = [];

  for (const run of runs) {
    const previous = result[result.length - 1];

    if (run.type === "text" && previous?.type === "text" && sameLegacyRunStyle(previous.style, run.style)) {
      previous.text += run.text;
    } else {
      result.push(run.type === "text" ? { ...run, style: cloneLegacyStyle(run.style) } : run);
    }
  }

  return result;
}

function renderLegacyStyle(style, preserveFontSize) {
  const css = { ...style.css };

  if (preserveFontSize && style.fontSize !== null) {
    css["font-size"] = scaleMarkdownFontSize(style.fontSize);
  }

  if (style.color) css.color = style.color;
  if (style.backgroundColor) css["background-color"] = style.backgroundColor;

  return renderInlineStyle(css);
}

function renderLegacyHtmlFormatting(text, style, preserveFontSize) {
  let result = escapeHtmlText(text).replace(/`/g, "&#96;");

  if (style.strike) result = `<s>${result}</s>`;
  if (style.italic) result = `<em>${result}</em>`;
  if (style.bold) result = `<strong>${result}</strong>`;
  if (style.underline) result = `<u>${result}</u>`;

  const renderedStyle = renderLegacyStyle(style, preserveFontSize);

  if (renderedStyle) {
    result = `<span style="${escapeHtmlAttribute(renderedStyle)}">${result}</span>`;
  }

  return result;
}

function legacyNeedsHtml(style, preserveFontSize) {
  return Boolean(
    preserveFontSize
    || style.color
    || style.backgroundColor
    || style.underline
    || Object.keys(style.css).length
  );
}

function renderLegacyMarkdownGroupRuns(runs, context) {
  return runs.map((run) => {
    const style = stripLink(run.style);
    const preserveFontSize = shouldPreserveRunFontSize(run, context);

    if (legacyNeedsHtml(style, preserveFontSize)) {
      return renderLegacyHtmlFormatting(run.text, style, preserveFontSize);
    }

    return renderMarkdownFormatting(run.text, style);
  }).join("");
}

function renderLegacyGroups(runs, context) {
  const groups = groupRunsByLink(runs);

  return groups.map((group) => {
    if (group.type === "break") return "<br>";

    if (group.type === "plain") {
      return renderLegacyMarkdownGroupRuns(group.runs, context);
    }

    const needsHtmlLink = group.runs.some((run) => {
      const style = stripLink(run.style);
      return legacyNeedsHtml(style, shouldPreserveRunFontSize(run, context));
    });

    const content = renderLegacyMarkdownGroupRuns(group.runs, context);

    if (needsHtmlLink) {
      return renderHtmlLink(content, group.link);
    }

    return renderMarkdownLink(content, group.link);
  }).join("");
}

function renderLegacyParagraph(node) {
  let runs = mergeLegacyRuns(collectLegacyStyleRuns(node));

  const plainText = runs.filter((run) => run.type === "text").map((run) => run.text).join("");
  const hasBreak = runs.some((run) => run.type === "break");

  if (!plainText.trim() && (!hasBreak || runs.every((run) => run.type === "break" || !run.text?.trim()))) {
    return { empty: true, text: "" };
  }

  const alignment = getLegacyParagraphAlignment(node);
  const paragraphSize = getParagraphFontSize(runs);
  const mixed = hasMixedFontSizes(runs);
  const checkbox = parseCheckbox(runs);
  const listItem = !checkbox ? parseListItem(runs) : null;
  const heading = !checkbox && !listItem && !mixed ? getHeadingLevel(paragraphSize) : 0;

  /*
   * SmartEditor 1.x / 2.x
   *
   * Markdown에는 문단 정렬 문법이 없으므로
   * 정렬이 지정된 문단은 전체 문단을 HTML <p>로 보존한다.
   *
   * left는 Markdown 기본 정렬과 같으므로 별도로 보존하지 않는다.
   */
  if (alignment && alignment !== "left") {
    const content = renderLegacyParagraphHtml(node);
    return { empty: false, text: `<p style="text-align:${alignment}">${content}</p>` };
  }

  if (checkbox) runs = removeTextPrefix(runs, checkbox.length);
  if (listItem) runs = removeTextPrefix(runs, listItem.length);

  const context = {
    paragraphSize,
    mixed,
    checkbox: Boolean(checkbox),
    heading,
  };

  let content = renderLegacyGroups(runs, context);

  if (!checkbox && !listItem && !heading) {
    content = preserveMultipleSpaces(content);
  }

  if (checkbox) return { empty: false, text: `${checkbox.indent}- [${checkbox.checked}] ${content}` };
  if (listItem) return { empty: false, text: `${listItem.indent}- ${content}` };
  if (heading) return { empty: false, text: `${"#".repeat(heading)} ${content}` };

  return { empty: false, text: content };
}

function renderLegacyParagraphHtml(node) {
  let runs = mergeLegacyRuns(collectLegacyStyleRuns(node));
  const checkbox = parseCheckbox(runs);

  if (checkbox) runs = removeTextPrefix(runs, checkbox.length);

  const groups = groupRunsByLink(runs);

  const content = groups.map((group) => {
    if (group.type === "break") return "<br>";

    const rendered = group.runs.map((run) => {
      const style = stripLink(run.style);
      const preserveFontSize = style.fontSize !== null && !isBodyFontSize(style.fontSize);

      return renderLegacyHtmlFormatting(run.text, style, preserveFontSize);
    }).join("");

    return group.type === "link"
      ? renderHtmlLink(rendered, group.link)
      : rendered;
  }).join("");

  if (!checkbox) return content;

  return `${escapeHtmlText(`${checkbox.indent}- [${checkbox.checked}] `)}${content}`;
}

/*
 * SmartEditor 1.x / 2.x 구형 <p>의 margin-left는 에디터에서 적용한
 * 문단 들여쓰기를 나타낸다.
 *
 * 확인된 구형 문서에서는 40px 단위로 단계가 증가하므로
 * 40px당 non-breaking space 4개로 변환한다.
 */
function getLegacyParagraphIndent(paragraph) {
  const style = paragraph.attr("style") || "";
  const marginLeft = getStyleProperty(style, "margin-left");
  const match = marginLeft.match(/^(\d+(?:\.\d+)?)px$/i);

  if (!match) return "";

  const pixels = Number(match[1]);
  if (!Number.isFinite(pixels) || pixels <= 0) return "";

  const spaces = Math.round(pixels / 40) * 4;

  return "&nbsp;".repeat(spaces);
}

/*
 * SmartEditor 1.x / 2.x의 autosourcing 블록 처리.
 */
function protectLegacyAutosourcingBlocks($, root, store) {
  const blocks = root.find(".autosourcing-stub-saved").toArray();

  for (const element of blocks) {
    const block = $(element);

    if (block.closest(".naver-protected").length) continue;

    const rendered = renderLegacyParagraph(element);
    const value = rendered.empty ? "NAVEREMPTYLINE" : rendered.text;
    const token = store.add(value);

    block.replaceWith(`<div class="naver-protected">${token}</div>`);
  }
}

/*
 * SmartEditor 1.x / 2.x에서 스타일이 적용된 문단이
 * <p>가 아닌 <div> 구조로 생성되는 경우가 있다.
 *
 * 이 구조를 일반 Markdown으로 변환하면 내부 <span>의 스타일이
 * 사라질 수 있으므로 해당 블록은 HTML 그대로 보존한다.
 */
function protectLegacyStyledDivBlocks($, root, store) {
  const blocks = root.find("div").toArray();

  for (const element of blocks) {
    const block = $(element);

    if (block.closest(".naver-protected").length) continue;

    const children = block.children();

    if (!children.length) continue;
    if (!children.toArray().every(child => String(child.name || "").toLowerCase() === "div")) continue;

    const hasStyledSpan = children.toArray().some((child) => {
      const span = $(child).children("span[style]");

      return span.length === 1 && span.parent()[0] === child;
    });

    if (!hasStyledSpan) continue;

    const valid = children.toArray().every((child) => {
      const contents = $(child).contents().toArray().filter((node) => {
        return node.type !== "text" || String(node.data || "").trim();
      });

      if (!contents.length) return true;

      return contents.every((node) => {
        if (node.type !== "tag") return false;

        const name = String(node.name || "").toLowerCase();

        if (name === "br") return true;
        if (name !== "span") return false;

        return Boolean(node.attribs?.style);
      });
    });

    if (!valid) continue;

    const token = store.add($.html(element));

    block.replaceWith(`<div class="naver-protected">${token}</div>`);
  }
}

/*
 * SmartEditor 1.x / 2.x의 구형 본문은 SmartEditor 3.x 이상처럼
 * .se-component.se-text / p.se-text-paragraph 구조를 사용하지 않고
 * 일반 <p>를 사용하는 경우가 있다.
 *
 * 이 문단들을 Turndown에 그대로 넘기면 빈 <p>가 사라질 수 있으므로
 * 일반 텍스트 <p>를 미리 보호한다.
 */
function protectLegacyParagraphs($, root, store) {
  protectLegacyStyledDivBlocks($, root, store);

  const paragraphs = root.find("p").toArray();
  let previousWasNbspEmpty = false;

  for (const element of paragraphs) {
    const paragraph = $(element);

    /*
     * SmartEditor 3.x 이상 문단은 신형 로직이 담당한다.
     */
    if (paragraph.hasClass("se-text-paragraph")) {
      previousWasNbspEmpty = false;
      continue;
    }

    /*
     * 다른 변환기가 이미 보호한 영역은 건드리지 않는다.
     */
    if (paragraph.closest(".naver-protected").length) {
      previousWasNbspEmpty = false;
      continue;
    }

    /*
     * 단순 텍스트 문단만 처리한다.
     *
     * 이미지, 표, 영상, 목록, 코드, 인용문 등의 블록 구조가 들어 있는
     * <p>는 다른 변환 로직이나 Turndown이 처리하도록 그대로 둔다.
     */
    if (paragraph.find("img,table,iframe,video,ul,ol,pre,blockquote").length) {
      previousWasNbspEmpty = false;
      continue;
    }

    const html = paragraph.html() || "";
    const isNbspEmpty = /^(?:&nbsp;|\u00a0)$/.test(html.trim());
    const isCompletelyEmpty = html.trim() === "";

    /*
     * SmartEditor 1.x / 2.x에서 &nbsp; 빈 문단 뒤에
     * 완전히 빈 <p></p>가 연속으로 생성되는 경우가 있다.
     *
     * 이 빈 <p>들은 별도의 빈 줄로 취급하지 않고
     * 앞의 &nbsp; 빈 문단 하나로 합친다.
     */
    if (previousWasNbspEmpty && isCompletelyEmpty) continue;

    const rendered = renderLegacyParagraph(element);
    const indent = rendered.empty ? "" : getLegacyParagraphIndent(paragraph);
    const value = rendered.empty ? "NAVEREMPTYLINE" : `${indent}${rendered.text}`;
    const token = store.add(value);

    paragraph.replaceWith(`<div class="naver-protected">${token}</div>`);

    previousWasNbspEmpty = isNbspEmpty;
  }
}

module.exports = {
  protectLegacyAutosourcingBlocks,
  protectLegacyParagraphs,
  renderLegacyParagraph,
  renderLegacyParagraphHtml,
};