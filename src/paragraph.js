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

function getNaverFontSize(node) {
  if (!node || node.type !== "tag") return null;

  const className = node.attribs?.class || "";

  if (/(?:^|\s)se-fs-(?:\s|$)/.test(className)) return 15;

  const match = className.match(/(?:^|\s)se-fs-fs(\d+)(?:\s|$)/);
  return match ? Number(match[1]) : null;
}

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

function sameLink(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;

  return a.href === b.href
    && a.target === b.target
    && a.title === b.title;
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

function normalizeSourceText(text) {
  return String(text).replace(/\u200b/g, "").replace(/\u00a0/g, " ");
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

  if (name === "span") {
    const size = getNaverFontSize(node);
    const css = node.attribs?.style || "";
    const color = getStyleProperty(css, "color");
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

function getHeadingLevel(size) {
  if (size === 30) return 1;
  if (size === 28) return 2;
  if (size === 24) return 3;
  if (size === 19) return 4;
  if (size === 16) return 5;
  if (size === 15) return 6;
  return 0;
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
    .replace(/\\/g, "\\\\")
    .replace(/([`*_[\]<>~])/g, "\\$1")
    .replace(/^([ \t]*)(#{1,6}|>|[-+])(?=\s)/gm, "$1\\$2")
    .replace(/^([ \t]*)(\d+)\.(?=\s)/gm, "$1$2\\.");
}

function renderMarkdownFormatting(text, style) {
  let result = escapeMarkdownText(text);

  if (style.strike) result = `~~${result}~~`;
  if (style.italic) result = `*${result}*`;
  if (style.bold) result = `**${result}**`;

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
  let result = escapeHtmlText(text);

  if (style.strike) result = `<s>${result}</s>`;
  if (style.italic) result = `<em>${result}</em>`;
  if (style.bold) result = `<strong>${result}</strong>`;
  if (style.underline) result = `<u>${result}</u>`;

  const css = [];

  if (preserveFontSize && style.fontSize !== null) css.push(`font-size:${style.fontSize}px`);

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

  if (context.checkbox) return run.style.fontSize !== 13;
  if (context.mixed) return true;

  return [11, 34, 38].includes(run.style.fontSize);
}

function stripLink(style) {
  return { ...style, link: null };
}

function paragraphNeedsHtml(runs, context) {
  return runs.some((run) => {
    if (run.type !== "text") return false;
    return needsHtml(stripLink(run.style), shouldPreserveRunFontSize(run, context));
  });
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

function renderMarkdownGroupRuns(runs) {
  return runs.map((run) => renderMarkdownFormatting(run.text, stripLink(run.style))).join("");
}

function renderHtmlGroupRuns(runs, context) {
  return runs.map((run) => {
    const style = stripLink(run.style);
    return renderHtmlFormatting(run.text, style, shouldPreserveRunFontSize(run, context));
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

  if (!plainText.trim() && !hasBreak) return { empty: true, text: "" };

  const paragraphSize = getParagraphFontSize(runs);
  const mixed = hasMixedFontSizes(runs);
  const checkbox = parseCheckbox(runs);
  const heading = !checkbox && !mixed ? getHeadingLevel(paragraphSize) : 0;

  if (checkbox) runs = removeTextPrefix(runs, checkbox.length);

  const context = {
    paragraphSize,
    mixed,
    checkbox: Boolean(checkbox),
    heading,
  };

  const content = renderGroups(runs, context);

  if (checkbox) return { empty: false, text: `${checkbox.indent}- [${checkbox.checked}] ${content}` };
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
      const preserveFontSize = style.fontSize !== null && style.fontSize !== 13;

      return renderHtmlFormatting(run.text, style, preserveFontSize);
    }).join("");

    return group.type === "link"
      ? renderHtmlLink(rendered, group.link)
      : rendered;
  }).join("");

  if (!checkbox) return content;

  return `${escapeHtmlText(`${checkbox.indent}- [${checkbox.checked}] `)}${content}`;
}

function renderTextList($, list, depth = 0) {
  const lines = [];
  const tagName = String(list[0]?.tagName || list[0]?.name || "").toLowerCase();
  const ordered = tagName === "ol";
  const items = list.children("li").toArray();

  for (let index = 0; index < items.length; index++) {
    const item = $(items[index]);
    const paragraphs = item.children("p.se-text-paragraph").toArray();
    const indent = "  ".repeat(depth);
    const marker = ordered ? `${index + 1}.` : "-";

    const contents = paragraphs.map((paragraph) => {
      const rendered = renderParagraph(paragraph);
      return rendered.empty ? "" : rendered.text;
    }).filter(Boolean);

    const content = contents.join("<br>");
    lines.push(`${indent}${marker}${content ? ` ${content}` : ""}`);

    const childLists = item.children("ul.se-text-list,ol.se-text-list").toArray();

    for (const childList of childLists) {
      const nested = renderTextList($, $(childList), depth + 1);
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

function protectTextComponents($, root, store) {
  /*
   * 네이버 SmartEditor의 목록은 일반 문단과 같은 .se-component.se-text 안에
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
}

module.exports = {
  protectTextComponents,
  renderParagraph,
  renderParagraphHtml,
  escapeHtmlText,
};
