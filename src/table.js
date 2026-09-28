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

  const modules = cell.find(".se-module.se-module-text").toArray();

  if (!modules.length) {
    return escapeHtmlText(
      cell.text().replace(/\u200b/g, "").replace(/\u00a0/g, " ").trim(),
    );
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

      if (tagName !== "p" || !node.hasClass("se-text-paragraph")) {
        continue;
      }

      /*
       * 실패한 inline image의 원래 <p>에는 parse5 처리 후
       * 빈 .se-inline-image <a>만 남는다.
       *
       * 실제 error box는 바로 뒤의 .se-state-error에서 처리하므로
       * 이 빈 paragraph는 출력하지 않는다.
       */
      if (node.find(".se-inline-image").length) {
        const text = node
          .text()
          .replace(/\u200b/g, "")
          .replace(/\u00a0/g, " ")
          .trim();

        if (!text) continue;
      }

      const content = renderParagraphHtml(element)
        .replace(/\r?\n[ \t]*/g, "")
        .trim();

      if (!content) continue;

      const align = getParagraphAlignment(node);

      output.push(
        align
          ? `<div style="text-align:${align};">${content}</div>`
          : `<div>${content}</div>`
      );
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
          if (widths[column + offset] === null) {
            widths[column + offset] = each;
          }
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

  return match
    ? `${Number(match[1])}${match[2].toLowerCase()}`
    : "";
}

function getCellBackgroundColor(cell) {
  const style = cell.attr("style") || "";

  /*
   * 1. background-color
   */
  const backgroundColorMatch = style.match(
    /(?:^|;)\s*background-color\s*:\s*([^;]+)/i
  );

  if (backgroundColorMatch) {
    return backgroundColorMatch[1].trim();
  }

  /*
   * 2. 구형 HTML bgcolor
   */
  const bgcolor = cell.attr("bgcolor");

  if (bgcolor) {
    return String(bgcolor).trim();
  }

  /*
   * 3. background shorthand
   *
   * 단순 색상값만 안전하게 가져온다.
   */
  const backgroundMatch = style.match(
    /(?:^|;)\s*background\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^)]+\)|[a-z]+)(?:\s|;|$)/i
  );

  if (backgroundMatch) {
    return backgroundMatch[1].trim();
  }

  return "";
}

function getActualText(node) {
  return node
    .text()
    .replace(/\u200b/g, "")
    .replace(/\u00a0/g, " ")
    .trim();
}

function normalizeStyleColor(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
}

/*
 * 표 안에 background-color가 지정된 셀이
 * 하나라도 있는지 검사한다.
 */
function hasAnyCellBackgroundColor($, table) {
  return table.find("th, td").toArray().some((element) => {
    return Boolean(getCellBackgroundColor($(element)));
  });
}

/*
 * 셀 배경색 처리는 투명화 판정보다 먼저 한다.
 *
 * 표 안에 background-color가 지정된 셀이 하나라도 있으면
 * 배경색이 지정되지 않은 나머지 셀을 #ffffff로 채운다.
 *
 * 모든 셀이 배경색 미지정이라면 아무것도 하지 않는다.
 */
function fillMissingCellBackgrounds($, table) {
  if (!hasAnyCellBackgroundColor($, table)) return;

  table.find("th, td").each((_, element) => {
    const cell = $(element);

    if (getCellBackgroundColor(cell)) return;

    const style = cell.attr("style") || "";

    cell.attr(
      "style",
      `${style}${style.trim() && !style.trim().endsWith(";") ? ";" : ""}background-color:#ffffff;`
    );
  });
}

function shouldMakeTableTransparent($, table) {
  /*
   * 1단계:
   *
   * 셀 배경색부터 처리한다.
   *
   * 일부 셀에만 배경색이 있으면
   * 나머지 미지정 셀을 먼저 흰색으로 채운다.
   */
  fillMissingCellBackgrounds($, table);

  /*
   * 2단계:
   *
   * 보정이 끝난 셀들의 배경색을 검사한다.
   */
  const cellBackgroundColors = new Set();

  table.find("th, td").each((_, element) => {
    const cell = $(element);
    const backgroundColor = getCellBackgroundColor(cell);

    cellBackgroundColors.add(
      backgroundColor
        ? normalizeStyleColor(backgroundColor)
        : "__none__"
    );
  });

  /*
   * 3단계:
   *
   * 아래에서 글자 서식을 검사한다.
   */
  const fontColors = new Set();
  let hasTextBackgroundColor = false;

  /*
   * td / th / p / div 같은 부모 요소의 background-color를
   * 글자 배경색으로 오인하지 않는다.
   *
   * 실제 글자가 있는 span만 검사한다.
   */
  table.find("span").each((_, element) => {
    const node = $(element);

    if (!getActualText(node)) return;

    const style = node.attr("style") || "";

    const colorMatch = style.match(
      /(?:^|;)\s*color\s*:\s*([^;]+)/i
    );

    if (colorMatch) {
      fontColors.add(
        normalizeStyleColor(colorMatch[1])
      );
    }

    /*
     * 실제 글자 span 자체에 background-color가 있으면
     * 투명화하지 않는다.
     */
    if (
      /(?:^|;)\s*background-color\s*:\s*[^;]+/i.test(style)
    ) {
      hasTextBackgroundColor = true;
    }
  });

  /*
   * 구형 HTML의 <font color="...">도
   * 폰트색 판정에 포함한다.
   */
  table.find("font[color]").each((_, element) => {
    const node = $(element);

    if (!getActualText(node)) return;

    const color = node.attr("color");

    if (color) {
      fontColors.add(
        normalizeStyleColor(color)
      );
    }
  });

  /*
   * 최종 조건:
   *
   * 1. 보정 후 모든 셀의 배경색이 동일함
   * 2. 지정된 폰트색이 없거나 전부 동일함
   * 3. 실제 글자 자체에 배경색이 하나도 없음
   */
  return cellBackgroundColors.size <= 1
    && fontColors.size <= 1
    && !hasTextBackgroundColor;
}

/*
 * 투명화 조건을 만족한 구형 HTML 표의
 * 고정 서식을 제거한다.
 *
 * - table / cell 배경 제거
 * - table / cell border 제거
 * - 동일한 font color 제거
 */
function makeTableBackgroundTransparent($, table) {
  table.find("th, td").each((_, element) => {
    const cell = $(element);
    const style = cell.attr("style") || "";

    let nextStyle = style
      .replace(
        /(?:^|;)\s*background-color\s*:\s*[^;]+/ig,
        ""
      )
      .replace(
        /(?:^|;)\s*background\s*:\s*[^;]+/ig,
        ""
      )
      .replace(
        /(?:^|;)\s*border(?:-(?:top|right|bottom|left))?\s*:\s*[^;]+/ig,
        ""
      );

    nextStyle = nextStyle.trim();

    cell.attr(
      "style",
      `${nextStyle}${nextStyle && !nextStyle.endsWith(";") ? ";" : ""}background-color:transparent;`
    );

    cell.removeAttr("bgcolor");
    cell.removeAttr("border");
  });

  /*
   * 실제 텍스트가 있는 span에서
   * 동일한 고정 폰트색을 제거한다.
   */
  table.find("span[style]").each((_, element) => {
    const node = $(element);

    if (!getActualText(node)) return;

    const style = node.attr("style") || "";

    let nextStyle = style.replace(
      /(?:^|;)\s*color\s*:\s*[^;]+/ig,
      ""
    );

    nextStyle = nextStyle.trim();

    if (nextStyle) {
      node.attr("style", nextStyle);
    } else {
      node.removeAttr("style");
    }
  });

  /*
   * 구형 <font color="..."> 제거.
   */
  table.find("font[color]").each((_, element) => {
    const node = $(element);

    if (!getActualText(node)) return;

    node.removeAttr("color");
  });

  /*
   * table 자체의 배경과 border도 제거한다.
   */
  const style = table.attr("style") || "";

  let nextStyle = style
    .replace(
      /(?:^|;)\s*background-color\s*:\s*[^;]+/ig,
      ""
    )
    .replace(
      /(?:^|;)\s*background\s*:\s*[^;]+/ig,
      ""
    )
    .replace(
      /(?:^|;)\s*border(?:-(?:top|right|bottom|left))?\s*:\s*[^;]+/ig,
      ""
    );

  nextStyle = nextStyle.trim();

  table.attr(
    "style",
    `${nextStyle}${nextStyle && !nextStyle.endsWith(";") ? ";" : ""}background:transparent;`
  );

  table.removeAttr("bgcolor");
  table.removeAttr("border");
}

function hasCellFontStyle(cell) {
  return cell.find("[style]").toArray().some((element) => {
    const style = cell.find(element).attr("style") || "";

    return /(?:^|;)\s*(?:color|background-color)\s*:\s*[^;]+/i.test(style);
  });
}

function isWhiteBackground(color) {
  const value = String(color || "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();

  return value === "#fff"
    || value === "#ffffff"
    || value === "white"
    || value === "rgb(255,255,255)"
    || value === "rgba(255,255,255,1)"
    || value === "rgba(255,255,255,1.0)";
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
      const borderStyle = transparentTable
        ? ""
        : "border:1px solid #d0d7de;";

      attrs += ` style="${borderStyle}padding:6px 10px;${heightStyle}${backgroundStyle}vertical-align:top;"`;

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
   */
  let legacyTableStyleAdded = false;

  root.find("table").each((_, element) => {
    const table = $(element);

    /*
     * 실제 게시글 본문 안의 표만 처리한다.
     */
    if (!table.closest(".post-view").length) return;
    if (table.closest(".naver-protected").length) return;

    const cloned = table.clone();

    cloned.addClass("naver-legacy-table");

    /*
     * shouldMakeTableTransparent() 내부에서
     *
     * 1. 셀 배경색 보정
     * 2. 보정된 셀 배경색 비교
     * 3. 폰트색 / 글자 배경 검사
     *
     * 순서로 처리한다.
     *
     * 조건을 통과하면 그때 전체 투명화한다.
     */
    if (shouldMakeTableTransparent($, cloned)) {
      makeTableBackgroundTransparent($, cloned);
    }

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
