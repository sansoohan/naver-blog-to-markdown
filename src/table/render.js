const { renderParagraph, renderParagraphHtml, escapeHtmlText } = require("../paragraph");
const { getCellBackgroundColor, shouldMakeTableTransparent } = require("./legacy");

const LEGACY_TABLE_STYLE = `
<style>
table.naver-legacy-table {
  width: 100% !important;
}

table.naver-legacy-table:not([style*="margin" i]),
table.naver-legacy-table table:not([style*="margin" i]) {
  margin: 0 !important;
}

table.naver-legacy-table:not([style*="padding" i]),
table.naver-legacy-table table:not([style*="padding" i]) {
  padding: 0 !important;
}

table.naver-legacy-table th:not([style*="margin" i]),
table.naver-legacy-table td:not([style*="margin" i]) {
  margin: 0 !important;
}

table.naver-legacy-table th:not([style*="padding" i]),
table.naver-legacy-table td:not([style*="padding" i]) {
  padding: 1px !important;
}

table.naver-legacy-table:not(.naver-legacy-table-transparent):not([style*="border" i]),
table.naver-legacy-table:not(.naver-legacy-table-transparent) table:not([style*="border" i]) {
  border: none !important;
}

table.naver-legacy-table:not(.naver-legacy-table-transparent) th:not([style*="border" i]),
table.naver-legacy-table:not(.naver-legacy-table-transparent) td:not([style*="border" i]) {
  border: none !important;
}

table.naver-legacy-table th,
table.naver-legacy-table td {
  vertical-align: middle;
}

table.naver-legacy-table p {
  margin: 0 !important;
  padding: 0 !important;
}
</style>
`.trim();

function getSpan(cell, name) {
  const value = Number(cell.attr(name) || 1);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function isEmptyCell(cell) {
  const text = cell.text().replace(/\u200b/g, "").replace(/\u00a0/g, " ").trim();
  return !text && !cell.find("img, video, iframe").length;
}

function getParagraphAlignment(paragraph) {
  const className = paragraph.attr("class") || "";

  if (className.includes("se-text-paragraph-align-center")) return "center";
  if (className.includes("se-text-paragraph-align-right")) return "right";
  if (className.includes("se-text-paragraph-align-left")) return "left";
  if (className.includes("se-text-paragraph-align-justify")) return "justify";

  const style = paragraph.attr("style") || "";
  const match = style.match(/(?:^|;)\s*text-align\s*:\s*(left|center|right|justify)/i);

  return match ? match[1].toLowerCase() : "";
}

function hasAlignment(cell) {
  return cell.find("p.se-text-paragraph").toArray().some((element) => Boolean(getParagraphAlignment(cell.find(element))));
}

function isSimpleTable($, table) {
  return table.find("tr").toArray().every((row) => {
    return $(row).children("th, td").toArray().every((element) => {
      const cell = $(element);
      const style = cell.attr("style") || "";

      return getSpan(cell, "rowspan") === 1
        && getSpan(cell, "colspan") === 1
        && !hasAlignment(cell)
        && !/(?:^|;)\s*(?:width|height)\s*:/i.test(style);
    });
  });
}

function escapeMarkdownTableCell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n+/g, "<br>");
}

function renderMarkdownCell(cell) {
  const paragraphs = cell.find("p.se-text-paragraph").toArray();

  if (!paragraphs.length) {
    return escapeMarkdownTableCell(cell.text().replace(/\u200b/g, "").replace(/\u00a0/g, " ").trim());
  }

  return paragraphs.map((paragraph) => {
    const rendered = renderParagraph(paragraph);
    return rendered.empty ? "" : escapeMarkdownTableCell(rendered.text);
  }).filter(Boolean).join("<br>");
}

function renderSimpleTable($, table) {
  const rows = table.find("tr").toArray().map((row) => {
    return $(row).children("th, td").toArray().map((cell) => renderMarkdownCell($(cell)));
  });

  if (!rows.length) return "";

  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalizeRow = (row) => [...row, ...Array(Math.max(0, columnCount - row.length)).fill("")];
  const output = [];

  output.push(`| ${normalizeRow(rows[0]).join(" | ")} |`);
  output.push(`| ${Array(columnCount).fill("---").join(" | ")} |`);

  for (const row of rows.slice(1)) {
    output.push(`| ${normalizeRow(row).join(" | ")} |`);
  }

  return output.join("\n");
}

function renderHtmlCell(cell) {
  if (isEmptyCell(cell)) return "&nbsp;";

  const images = cell.find("img");

  if (images.length) {
    const parts = [];

    images.each((_, element) => {
      const image = cell.find(element);
      const src = image.attr("src") || "";

      if (!src) return;

      const alt = escapeHtmlText(image.attr("alt") || "");
      const width = image.attr("width");
      const widthStyle = width ? `width:${width}px;` : "";

      parts.push(`<img src="${src}" alt="${alt}" style="${widthStyle}max-width:100%;height:auto;">`);
    });

    if (parts.length) {
      const paragraph = images.first().closest("p");
      const align = getParagraphAlignment(paragraph);
      const content = parts.join("<br>");

      return align ? `<div style="text-align:${align};">${content}</div>` : content;
    }
  }

  const modules = cell.find(".se-module.se-module-text").toArray();

  if (!modules.length) {
    return escapeHtmlText(cell.text().replace(/\u200b/g, "").replace(/\u00a0/g, " ").trim());
  }

  const output = [];

  for (const moduleElement of modules) {
    const module = cell.find(moduleElement);
    const children = module.children().toArray();

    for (const element of children) {
      const node = cell.find(element);
      const tagName = String(element.name || "").toLowerCase();

      /*
       * Cheerio/parse5가 inline image 안의 block-level
       * .se-state-error를 <p> 밖으로 이동시킨다.
       *
       * 이동된 error block 자체를 여기서 직접 처리한다.
       */
      if (node.hasClass("se-state-error")) {
        const error = node.find(".se-state-error-text").first();
        const link = error.find("a").first();

        if (!error.length) continue;

        if (link.length) {
          link.attr(
            "style",
            "color:#ccc !important;"
            + "text-decoration:underline;"
            + "text-decoration-skip-ink:none;"
            + "word-break:break-all;"
            + "font-size:16px;"
            + "line-height:1.38;"
          );
        }

        const content = error.html().trim();

        if (!content) continue;

        output.push(
          `<div style="text-align:left;">`
          + `<span style="display:inline-flex;width:200px;height:112px;max-width:100%;`
          + `background:#fcfcfc;border:1px solid #e9e9e9;box-sizing:border-box;`
          + `align-items:center;justify-content:center;`
          + `font-size:16px;line-height:1.38;color:#ccc;text-align:center;`
          + `white-space:normal;">`
          + `${content}</span>`
          + `</div>`
        );

        continue;
      }

      if (tagName !== "p" || !node.hasClass("se-text-paragraph")) continue;

      /*
       * 실패한 inline image의 원래 <p>에는 parse5 처리 후
       * 빈 .se-inline-image <a>만 남는다.
       *
       * 실제 error box는 바로 뒤의 .se-state-error에서 처리하므로
       * 이 빈 paragraph는 출력하지 않는다.
       */
      if (node.find(".se-inline-image").length) {
        const text = node.text().replace(/\u200b/g, "").replace(/\u00a0/g, " ").trim();

        if (!text) continue;
      }

      const content = renderParagraphHtml(element).replace(/\r?\n[ \t]*/g, "").trim();

      if (!content) continue;

      const align = getParagraphAlignment(node);

      output.push(align ? `<div style="text-align:${align};">${content}</div>` : `<div>${content}</div>`);
    }
  }

  return output.length ? output.join("") : "&nbsp;";
}

function getColumnCount($, table) {
  let max = 0;

  for (const row of table.find("tr").toArray()) {
    let count = 0;

    for (const element of $(row).children("th, td").toArray()) {
      count += getSpan($(element), "colspan");
    }

    max = Math.max(max, count);
  }

  return max;
}

function getCellWidth(cell) {
  const style = cell.attr("style") || "";
  const match = style.match(/(?:^|;)\s*width\s*:\s*([\d.]+)%/i);

  return match ? Number(match[1]) : null;
}

function getColumnWidths($, table, columnCount) {
  const widths = Array(columnCount).fill(null);

  for (const row of table.find("tr").toArray()) {
    let column = 0;

    for (const element of $(row).children("th, td").toArray()) {
      const cell = $(element);
      const colspan = getSpan(cell, "colspan");
      const width = getCellWidth(cell);

      if (width !== null) {
        const each = width / colspan;

        for (let offset = 0; offset < colspan; offset++) {
          if (widths[column + offset] === null) widths[column + offset] = each;
        }
      }

      column += colspan;
    }
  }

  return widths;
}

function renderColgroup(widths) {
  if (!widths.some((width) => width !== null)) return "";

  return `<colgroup>${widths.map((width) => (
    width === null ? "<col>" : `<col style="width:${width}%">`
  )).join("")}</colgroup>`;
}

function getCellHeight(cell) {
  const style = cell.attr("style") || "";
  const match = style.match(/(?:^|;)\s*height\s*:\s*([\d.]+)(px|pt)/i);

  return match ? `${Number(match[1])}${match[2].toLowerCase()}` : "";
}

function renderComplexTable($, table) {
  /*
   * shouldMakeTableTransparent 안에서
   * 미지정 셀의 배경색 보정이 먼저 실행된다.
   *
   * 따라서 아래에서 읽는 backgroundColor는
   * 이미 보정이 끝난 상태다.
   */
  const transparentTable = shouldMakeTableTransparent($, table);
  const columnCount = getColumnCount($, table);
  const widths = getColumnWidths($, table, columnCount);

  let html = '<table style="border-collapse:collapse;width:100%;background:transparent;">';
  html += renderColgroup(widths);

  for (const row of table.find("tr").toArray()) {
    html += "<tr>";

    for (const element of $(row).children("th, td").toArray()) {
      const cell = $(element);
      const tag = String(element.name || "").toLowerCase() === "th" ? "th" : "td";
      const rowspan = getSpan(cell, "rowspan");
      const colspan = getSpan(cell, "colspan");

      let attrs = "";

      if (rowspan > 1) attrs += ` rowspan="${rowspan}"`;
      if (colspan > 1) attrs += ` colspan="${colspan}"`;

      const height = getCellHeight(cell);
      const heightStyle = height ? `height:${height};` : "";
      const backgroundColor = getCellBackgroundColor(cell);

      /*
       * 투명화 조건 통과:
       * → 셀 배경 투명
       *
       * 투명화 조건 실패:
       * → 위에서 보정된 실제 셀 배경색 사용
       */
      const backgroundStyle = transparentTable
        ? "background:transparent;"
        : backgroundColor
          ? `background-color:${backgroundColor};`
          : "background:transparent;";

      /*
       * 투명화 조건을 만족한 신형 표는
       * border도 생성하지 않는다.
       */
      const borderStyle = transparentTable ? "" : "border:1px solid #d0d7de;";

      attrs += ` style="${borderStyle}padding:6px 10px;${heightStyle}${backgroundStyle}vertical-align:top;"`;

      html += `<${tag}${attrs}>${renderHtmlCell(cell)}</${tag}>`;
    }

    html += "</tr>";
  }

  html += "</table>";

  return html;
}

function getLegacyTableCss(markdown) {
  if (!String(markdown).includes("naver-legacy-table")) return "";

  return LEGACY_TABLE_STYLE;
}

module.exports = {
  isSimpleTable,
  renderSimpleTable,
  renderComplexTable,
  getLegacyTableCss,
};