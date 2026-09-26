const {
  renderParagraph,
  renderParagraphHtml,
  escapeHtmlText,
} = require("./paragraph");

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
  return cell.find("p.se-text-paragraph").toArray().some((element) => {
    return Boolean(getParagraphAlignment(cell.find(element)));
  });
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
    return escapeMarkdownTableCell(
      cell.text().replace(/\u200b/g, "").replace(/\u00a0/g, " ").trim(),
    );
  }

  return paragraphs.map((paragraph) => {
    const rendered = renderParagraph(paragraph);
    return rendered.empty ? "" : escapeMarkdownTableCell(rendered.text);
  }).filter(Boolean).join("<br>");
}

function renderSimpleTable($, table) {
  const rows = table.find("tr").toArray().map((row) => {
    return $(row).children("th, td").toArray().map((cell) => {
      return renderMarkdownCell($(cell));
    });
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

      parts.push(
        `<img src="${src}" alt="${alt}" style="${widthStyle}max-width:100%;height:auto;">`
      );
    });

    if (parts.length) {
      const paragraph = images.first().closest("p");
      const align = getParagraphAlignment(paragraph);
      const content = parts.join("<br>");

      return align
        ? `<div style="text-align:${align};">${content}</div>`
        : content;
    }
  }

  const paragraphs = cell.find("p.se-text-paragraph").toArray();

  if (!paragraphs.length) {
    return escapeHtmlText(
      cell.text().replace(/\u200b/g, "").replace(/\u00a0/g, " ").trim(),
    );
  }

  return paragraphs.map((element) => {
    const paragraph = cell.find(element);
    const content = renderParagraphHtml(element);

    if (!content.trim()) return "";

    const align = getParagraphAlignment(paragraph);

    return align
      ? `<div style="text-align:${align};">${content}</div>`
      : `<div>${content}</div>`;
  }).filter(Boolean).join("");
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

      attrs += ` style="border:1px solid #d0d7de;padding:6px 10px;${heightStyle}background:transparent;vertical-align:top;"`;

      html += `<${tag}${attrs}>${renderHtmlCell(cell)}</${tag}>`;
    }

    html += "</tr>";
  }

  html += "</table>";

  return html;
}

/*
 * 구형 SmartEditor 표의 width를 읽는다.
 *
 * 구형 표에는 WIDTH: 146.5pt 같은 값이 들어 있는 경우가 많다.
 * px도 같은 비율 계산에 사용할 수 있도록 pt 기준 값으로 환산한다.
 */
function getLegacyWidth(cell) {
  const style = cell.attr("style") || "";
  const match = style.match(
    /(?:^|;)\s*width\s*:\s*([\d.]+)\s*(pt|px|%)/i
  );

  if (!match) return null;

  const value = Number(match[1]);
  const unit = match[2].toLowerCase();

  if (!Number.isFinite(value) || value <= 0) return null;

  if (unit === "pt") return value;

  /*
   * CSS 기준:
   * 1pt = 96 / 72 px
   *
   * 절대값 자체가 목적이 아니라 열 사이의 비율 계산이 목적이다.
   */
  if (unit === "px") return value * 72 / 96;

  /*
   * %는 이미 상대 폭이므로 별도로 표시한다.
   */
  return {
    percent: value,
  };
}

/*
 * rowspan을 포함한 실제 표 grid를 만든다.
 *
 * 각 셀이 어느 열에서 시작하고 몇 개의 열을 차지하는지 기록한다.
 */
function buildLegacyTableGrid($, table) {
  const rows = table.find("tr").toArray();
  const occupied = [];
  const cells = [];
  let columnCount = 0;

  rows.forEach((row, rowIndex) => {
    if (!occupied[rowIndex]) occupied[rowIndex] = [];

    let column = 0;

    for (const element of $(row).children("th, td").toArray()) {
      const cell = $(element);
      const rowspan = getSpan(cell, "rowspan");
      const colspan = getSpan(cell, "colspan");

      while (occupied[rowIndex][column]) {
        column++;
      }

      cells.push({
        cell,
        row: rowIndex,
        column,
        rowspan,
        colspan,
        width: getLegacyWidth(cell),
      });

      for (let rowOffset = 0; rowOffset < rowspan; rowOffset++) {
        const targetRow = rowIndex + rowOffset;

        if (!occupied[targetRow]) occupied[targetRow] = [];

        for (let columnOffset = 0; columnOffset < colspan; columnOffset++) {
          occupied[targetRow][column + columnOffset] = true;
        }
      }

      column += colspan;
      columnCount = Math.max(columnCount, column);
    }

    columnCount = Math.max(columnCount, occupied[rowIndex].length);
  });

  return {
    cells,
    columnCount,
  };
}

/*
 * 구형 표의 각 실제 열 폭을 추정한다.
 *
 * colspan이 없는 셀의 width를 가장 우선해서 사용한다.
 * colspan 셀밖에 없는 열은 해당 셀의 폭을 colspan 수로 나누어 추정한다.
 */
function getLegacyColumnWidths(grid) {
  const widths = Array(grid.columnCount).fill(null);
  const confidence = Array(grid.columnCount).fill(0);

  /*
   * 1단계:
   * colspan=1 셀은 해당 열의 직접적인 폭 정보이므로 가장 신뢰한다.
   */
  for (const item of grid.cells) {
    if (
      item.colspan !== 1
      || item.width === null
      || typeof item.width === "object"
    ) {
      continue;
    }

    if (confidence[item.column] < 2) {
      widths[item.column] = item.width;
      confidence[item.column] = 2;
    }
  }

  /*
   * 2단계:
   * colspan 셀의 폭에서 이미 알고 있는 열 폭을 빼고,
   * 아직 모르는 열에 나누어 배분한다.
   *
   * 여러 번 반복하면
   * 일부 열만 알고 있는 colspan도 점차 풀 수 있다.
   */
  let changed = true;

  while (changed) {
    changed = false;

    for (const item of grid.cells) {
      if (
        item.width === null
        || typeof item.width === "object"
        || item.colspan <= 1
      ) {
        continue;
      }

      const columns = [];

      for (let offset = 0; offset < item.colspan; offset++) {
        columns.push(item.column + offset);
      }

      const known = columns.filter((column) => widths[column] !== null);
      const unknown = columns.filter((column) => widths[column] === null);

      if (!unknown.length) continue;

      const knownWidth = known.reduce(
        (sum, column) => sum + widths[column],
        0
      );

      const remaining = item.width - knownWidth;

      if (!(remaining > 0)) continue;

      const each = remaining / unknown.length;

      for (const column of unknown) {
        widths[column] = each;
        confidence[column] = 1;
        changed = true;
      }
    }
  }

  /*
   * 3단계:
   * 아직 폭을 모르는 열이 있으면 colspan 셀의 평균값을 사용한다.
   */
  for (const item of grid.cells) {
    if (
      item.width === null
      || typeof item.width === "object"
    ) {
      continue;
    }

    const each = item.width / item.colspan;

    for (let offset = 0; offset < item.colspan; offset++) {
      const column = item.column + offset;

      if (widths[column] === null) {
        widths[column] = each;
        confidence[column] = 1;
      }
    }
  }

  /*
   * 폭 정보가 전혀 없는 열이 있다면
   * 이미 알고 있는 열들의 평균값으로 채운다.
   */
  const knownWidths = widths.filter((width) => width !== null && width > 0);

  if (knownWidths.length) {
    const average = knownWidths.reduce((sum, width) => sum + width, 0)
      / knownWidths.length;

    for (let column = 0; column < widths.length; column++) {
      if (widths[column] === null) {
        widths[column] = average;
      }
    }
  }

  return widths;
}

function formatLegacyPercent(value) {
  return Number(value.toFixed(4)).toString();
}

function replaceLegacyWidth(cell, percent) {
  const style = cell.attr("style") || "";

  const nextStyle = style.replace(
    /((?:^|;)\s*width\s*:\s*)[\d.]+\s*(?:pt|px|%)/i,
    `$1${formatLegacyPercent(percent)}%`
  );

  cell.attr("style", nextStyle);
}

/*
 * 구형 표의 절대 width를 실제 열 비율에 따른 %로 바꾼다.
 *
 * 셀의 colspan에 포함되는 열들의 %를 모두 합산하므로
 * colspan 셀도 정확한 상대 폭을 갖는다.
 */
function normalizeLegacyTableWidths($, table) {
  const grid = buildLegacyTableGrid($, table);

  if (!grid.columnCount) return;

  const columnWidths = getLegacyColumnWidths(grid);

  if (
    !columnWidths.length
    || columnWidths.some((width) => !(width > 0))
  ) {
    return;
  }

  const totalWidth = columnWidths.reduce((sum, width) => sum + width, 0);

  if (!(totalWidth > 0)) return;

  const percentages = columnWidths.map((width) => {
    return width / totalWidth * 100;
  });

  for (const item of grid.cells) {
    if (item.width === null) continue;

    let percent = 0;

    for (let offset = 0; offset < item.colspan; offset++) {
      percent += percentages[item.column + offset] || 0;
    }

    if (percent > 0) {
      replaceLegacyWidth(item.cell, percent);
    }
  }

  /*
   * 표 자체는 Markdown 뷰어의 가용 폭을 사용한다.
   *
   * 원본 셀들의 비율은 위에서 %로 변환했으므로
   * 표 크기가 달라져도 열 비율은 유지된다.
   */
  const style = table.attr("style") || "";

  if (/(?:^|;)\s*width\s*:/i.test(style)) {
    table.attr(
      "style",
      style.replace(
        /((?:^|;)\s*width\s*:\s*)[^;]+/i,
        "$1100%"
      )
    );
  } else {
    table.attr(
      "style",
      `${style}${style.trim() && !style.trim().endsWith(";") ? ";" : ""}width:100%;`
    );
  }
}

const LEGACY_TABLE_STYLE = `
<style>
table.naver-legacy-table {
  width: 100% !important;
  margin: revert !important;
  padding: revert !important;
}

table.naver-legacy-table th,
table.naver-legacy-table td {
  padding: 1px !important;
  vertical-align: middle;
}

table.naver-legacy-table p {
  margin: 0 !important;
  padding: 0 !important;
}
</style>
`.trim();

function protectTables($, root, store) {
  /*
   * SmartEditor 3/4 신형 표.
   *
   * 기존 처리 그대로 유지한다.
   */
  root.find(".se-component.se-table").each((_, element) => {
    const component = $(element);
    const table = component.find("table").first();

    if (!table.length) return;

    const output = isSimpleTable($, table)
      ? renderSimpleTable($, table)
      : renderComplexTable($, table);

    component.replaceWith(
      `<div class="naver-protected">${store.add(output)}</div>`
    );
  });

  /*
   * SmartEditor 1/2 구형 표.
   *
   * 표를 새로 만들지 않고 원본 table HTML을 그대로 보존한다.
   */
  let legacyTableStyleAdded = false;

  root.find("table").each((_, element) => {
    const table = $(element);

    /*
     * 실제 게시글 본문 안의 표만 처리한다.
     *
     * printPost1 같은 네이버 페이지 레이아웃용 표는 제외한다.
     */
    if (!table.closest(".post-view").length) return;
    if (table.closest(".naver-protected").length) return;

    const cloned = table.clone();

    cloned.addClass("naver-legacy-table");

    /*
     * 구형 표의 절대 폭을
     * 현재 Markdown 뷰어 폭에 맞는 상대 폭으로 바꾼다.
     */
    normalizeLegacyTableWidths($, cloned);

    let output = $.html(cloned);

    /*
     * 구형 표용 CSS는 첫 번째 구형 표 앞에 한 번만 넣는다.
     */
    if (!legacyTableStyleAdded) {
      output = `${LEGACY_TABLE_STYLE}

${output}`;

      legacyTableStyleAdded = true;
    }

    table.replaceWith(
      `<div class="naver-protected">${store.add(output)}</div>`
    );
  });
}

module.exports = {
  protectTables,
};
