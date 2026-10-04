// paragraph/index.js
const {
  escapeHtmlText,
  getStyleProperty,
  getParagraphAlignment,
  getNaverFontSize,
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
  renderHtmlFormatting,
  needsHtml,
  renderMarkdownLink,
  renderHtmlLink,
  shouldPreserveRunFontSize,
  stripLink,
  groupRunsByLink,
  preserveMultipleSpaces,
} = require("./render");
const {
  protectLegacyAutosourcingBlocks,
  protectLegacyParagraphs,
} = require("./legacy");

function createStyleState() {
  return {
    fontSize: null,
    color: "",
    backgroundColor: "",
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    link: null,
  };
}

function cloneStyle(style) {
  return {
    ...style,
    link: style.link ? { ...style.link } : null,
  };
}

function sameStyle(a, b) {
  return a.fontSize === b.fontSize
    && a.color === b.color
    && a.backgroundColor === b.backgroundColor
    && a.bold === b.bold
    && a.italic === b.italic
    && a.underline === b.underline
    && a.strike === b.strike
    && sameLink(a.link, b.link);
}

function collectStyleRuns(node, inherited = createStyleState(), runs = []) {
  if (!node) return runs;

  if (node.type === "text") {
    const text = normalizeSourceText(node.data || "");
    if (text) runs.push({ type: "text", text, style: cloneStyle(inherited) });
    return runs;
  }

  if (node.type !== "tag") return runs;

  const name = String(node.name || "").toLowerCase();

  if (name === "br") {
    runs.push({ type: "break" });
    return runs;
  }

  const state = cloneStyle(inherited);

  if (name === "span" || name === "font") {
    const size = getNaverFontSize(node);
    const css = node.attribs?.style || "";
    const color = getStyleProperty(css, "color") || node.attribs?.color || "";
    const backgroundColor = getStyleProperty(css, "background-color");

    if (size !== null) state.fontSize = size;
    if (color) state.color = color;
    if (backgroundColor) state.backgroundColor = backgroundColor;
  }

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

  for (const child of node.children || []) collectStyleRuns(child, state, runs);

  return runs;
}

function mergeRuns(runs) {
  const result = [];

  for (const run of runs) {
    const previous = result[result.length - 1];

    if (run.type === "text" && previous?.type === "text" && sameStyle(previous.style, run.style)) {
      previous.text += run.text;
    } else {
      result.push(run.type === "text" ? { ...run, style: cloneStyle(run.style) } : run);
    }
  }

  return result;
}

function paragraphNeedsHtml(runs, context) {
  return runs.some((run) => {
    if (run.type !== "text") return false;

    return needsHtml(stripLink(run.style), shouldPreserveRunFontSize(run, context));
  });
}

function renderMarkdownGroupRuns(runs) {
  return runs.map((run) => renderMarkdownFormatting(run.text, stripLink(run.style))).join("");
}

function renderHtmlGroupRuns(runs, context) {
  return runs.map((run) => {
    const style = stripLink(run.style);

    return renderHtmlFormatting(
      run.text,
      style,
      shouldPreserveRunFontSize(run, context)
    );
  }).join("");
}

function renderGroups(runs, context) {
  const groups = groupRunsByLink(runs);
  const useHtmlFormatting = paragraphNeedsHtml(runs, context);

  return groups.map((group) => {
    if (group.type === "break") return "<br>";

    if (group.type === "plain") {
      return useHtmlFormatting
        ? renderHtmlGroupRuns(group.runs, context)
        : renderMarkdownGroupRuns(group.runs);
    }

    if (useHtmlFormatting) {
      return renderHtmlLink(renderHtmlGroupRuns(group.runs, context), group.link);
    }

    return renderMarkdownLink(renderMarkdownGroupRuns(group.runs), group.link);
  }).join("");
}

function renderParagraph(node) {
  let runs = mergeRuns(collectStyleRuns(node));

  const plainText = runs.filter((run) => run.type === "text").map((run) => run.text).join("");
  const hasBreak = runs.some((run) => run.type === "break");

  if (!plainText.trim() && (!hasBreak || runs.every((run) => run.type === "break" || !run.text?.trim()))) {
    return { empty: true, text: "" };
  }

  const alignment = getParagraphAlignment(node);
  const paragraphSize = getParagraphFontSize(runs);
  const mixed = hasMixedFontSizes(runs);
  const checkbox = parseCheckbox(runs);
  const listItem = !checkbox ? parseListItem(runs) : null;
  const heading = !checkbox && !listItem && !mixed ? getHeadingLevel(paragraphSize) : 0;

  /*
   * Markdown에는 문단 정렬 문법이 없으므로
   * 정렬이 지정된 문단은 전체 문단을 HTML <p>로 보존한다.
   *
   * left는 Markdown 기본 정렬과 같으므로 별도로 보존하지 않는다.
   */
  if (alignment && alignment !== "left") {
    const content = renderParagraphHtml(node);
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

  let content = renderGroups(runs, context);

  if (!checkbox && !listItem && !heading) {
    content = preserveMultipleSpaces(content);
  }

  if (checkbox) return { empty: false, text: `${checkbox.indent}- [${checkbox.checked}] ${content}` };
  if (listItem) return { empty: false, text: `${listItem.indent}- ${content}` };
  if (heading) return { empty: false, text: `${"#".repeat(heading)} ${content}` };

  return { empty: false, text: content };
}

function renderParagraphHtml(node) {
  let runs = mergeRuns(collectStyleRuns(node));
  const checkbox = parseCheckbox(runs);

  if (checkbox) runs = removeTextPrefix(runs, checkbox.length);

  const groups = groupRunsByLink(runs);

  const content = groups.map((group) => {
    if (group.type === "break") return "<br>";

    const rendered = group.runs.map((run) => {
      const style = stripLink(run.style);
      const preserveFontSize = style.fontSize !== null && !isBodyFontSize(style.fontSize);

      return renderHtmlFormatting(run.text, style, preserveFontSize);
    }).join("");

    return group.type === "link"
      ? renderHtmlLink(rendered, group.link)
      : rendered;
  }).join("");

  if (!checkbox) return content;

  return `${escapeHtmlText(`${checkbox.indent}- [${checkbox.checked}] `)}${content}`;
}

function renderTextList($, list, indentSize = 0) {
  const lines = [];
  const tagName = String(list[0]?.tagName || list[0]?.name || "").toLowerCase();
  const ordered = tagName === "ol";
  const items = list.children("li").toArray();
  const indent = " ".repeat(indentSize);

  for (let index = 0; index < items.length; index++) {
    const item = $(items[index]);
    const paragraphs = item.children("p.se-text-paragraph").toArray();
    const marker = ordered ? `${index + 1}.` : "-";

    const contents = paragraphs.map((paragraph) => {
      const rendered = renderParagraph(paragraph);
      return rendered.empty ? "" : rendered.text;
    }).filter(Boolean);

    const content = contents.join("<br>");
    lines.push(`${indent}${marker}${content ? ` ${content}` : ""}`);

    const childLists = item.children("ul.se-text-list,ol.se-text-list").toArray();
    const childIndentSize = indentSize + (ordered ? 4 : 2);

    for (const childList of childLists) {
      const nested = renderTextList($, $(childList), childIndentSize);
      if (nested) lines.push(nested);
    }
  }

  return lines.join("\n");
}

function protectTextLists($, root, store) {
  const lists = root.find("ul.se-text-list,ol.se-text-list").toArray();

  for (const element of lists) {
    const list = $(element);

    if (!list.parent().length) continue;
    if (list.parents("ul.se-text-list,ol.se-text-list").length) continue;

    const markdown = renderTextList($, list);
    if (!markdown) continue;

    /*
     * protectTextComponents()가 .se-component.se-text 내부의 p만 순서대로
     * 수집하므로 목록을 먼저 placeholder 문단으로 바꿔 둔다.
     *
     * 이후 renderParagraph()가 placeholder 문자열을 그대로 통과시키고,
     * 최종 store.restore()에서 실제 Markdown 목록으로 복구된다.
     */
    const token = store.add(markdown);
    list.replaceWith(`<p class="se-text-paragraph">${token}</p>`);
  }
}

function protectTextComponents($, root, store, editorVersion) {
  /*
   * SmartEditor 3.x 이상
   *
   * 목록은 일반 문단과 같은 .se-component.se-text 안에
   * <ul>/<li> 구조로 들어간다. 기존처럼 p만 수집하면 목록 구조가 사라지므로
   * 문단 처리 전에 목록을 Markdown으로 보호한다.
   */
  protectTextLists($, root, store);

  root.find(".se-component.se-text").each((_, element) => {
    const component = $(element);
    const paragraphs = component.find("p.se-text-paragraph").toArray();

    if (!paragraphs.length) return;

    const blocks = paragraphs.map((paragraph) => {
      const rendered = renderParagraph(paragraph);
      return rendered.empty ? "NAVEREMPTYLINE" : rendered.text;
    });

    const token = store.add(blocks.join("\n\n"));
    component.replaceWith(`<div class="naver-protected">${token}</div>`);
  });

  root.find("p.se-text-paragraph").each((_, element) => {
    const rendered = renderParagraph(element);
    const value = rendered.empty ? "NAVEREMPTYLINE" : rendered.text;
    const token = store.add(value);

    $(element).replaceWith(`<div class="naver-protected">${token}</div>`);
  });

  /*
   * SmartEditor 1.x / 2.x
   */
  if (editorVersion === 1 || editorVersion === 2) {
    protectLegacyAutosourcingBlocks($, root, store);
    protectLegacyParagraphs($, root, store);
  }
}

module.exports = {
  protectTextComponents,
  renderParagraph,
  renderParagraphHtml,
  escapeHtmlText,
};