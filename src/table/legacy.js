// table/legacy.js
function getSpan(cell, name) {
  const value = Number(cell.attr(name) || 1);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function normalizeStyleColor(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}

function getCellBackgroundColor(cell) {
  let node = cell;

  while (node && node.length) {
    const style = node.attr("style") || "";

    /*
     * background-color
     */
    const backgroundColorMatch = style.match(/(?:^|;)\s*background-color\s*:\s*([^;]+)/i);

    if (backgroundColorMatch) {
      const color = backgroundColorMatch[1].trim();

      if (normalizeStyleColor(color) !== "transparent") {
        return color;
      }
    } else {
      /*
       * background shorthand
       */
      const backgroundMatch = style.match(
        /(?:^|;)\s*background\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^)]+\)|[a-z]+)(?:\s|;|$)/i
      );

      if (backgroundMatch) {
        const color = backgroundMatch[1].trim();

        if (normalizeStyleColor(color) !== "transparent") {
          return color;
        }
      } else {
        /*
         * CSS background가 지정되지 않은 경우에만
         * 구형 HTML bgcolor를 사용한다.
         */
        const bgcolor = node.attr("bgcolor");

        if (bgcolor) {
          const color = String(bgcolor).trim();

          if (normalizeStyleColor(color) !== "transparent") {
            return color;
          }
        }
      }
    }

    /*
     * 현재 셀이 속한 table까지만 역방향으로 추적한다.
     *
     * td/th
     * → tr
     * → tbody/thead/tfoot
     * → table
     */
    const tagName = String(node[0]?.name || "").toLowerCase();

    if (tagName === "table") break;

    node = node.parent();
  }

  return "";
}

/*
 * 표 전체를 투명화할 수 있는지 판정한다.
 *
 * table 자체와 내부의 모든 요소를 검사한다.
 *
 * 배경색이 두 종류 이상이거나
 * 폰트색이 두 종류 이상이면
 * 원본의 색상 구분에 의미가 있다고 보고 투명화하지 않는다.
 *
 * 이 함수에서는 DOM을 절대로 수정하지 않는다.
 */
function shouldMakeTableTransparent($, table) {
  const backgroundColors = new Set();
  const fontColors = new Set();

  table.find("*").addBack().each((_, element) => {
    const node = $(element);
    const style = node.attr("style") || "";

    /*
     * background-color
     */
    const backgroundColorMatch = style.match(/(?:^|;)\s*background-color\s*:\s*([^;]+)/i);

    if (backgroundColorMatch) {
      const color = normalizeStyleColor(backgroundColorMatch[1]);

      if (color && color !== "transparent") {
        backgroundColors.add(color);
      }
    } else {
      /*
       * background shorthand
       */
      const backgroundMatch = style.match(
        /(?:^|;)\s*background\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^)]+\)|[a-z]+)(?:\s|;|$)/i
      );

      if (backgroundMatch) {
        const color = normalizeStyleColor(backgroundMatch[1]);

        if (color && color !== "transparent") {
          backgroundColors.add(color);
        }
      } else {
        /*
         * CSS background가 지정되지 않은 경우에만
         * 구형 HTML bgcolor를 사용한다.
         */
        const bgcolor = node.attr("bgcolor");

        if (bgcolor) {
          const color = normalizeStyleColor(bgcolor);

          if (color && color !== "transparent") {
            backgroundColors.add(color);
          }
        }
      }
    }

    /*
     * CSS color
     */
    const colorMatch = style.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);

    if (colorMatch) {
      const color = normalizeStyleColor(colorMatch[1]);

      if (color) {
        fontColors.add(color);
      }
    } else {
      /*
       * 구형 HTML의 color 속성도 검사한다.
       */
      const color = node.attr("color");

      if (color) {
        fontColors.add(normalizeStyleColor(color));
      }
    }
  });

  /*
   * 최종 조건:
   *
   * 1. 명시된 배경색이 없거나 전부 동일함
   * 2. 명시된 폰트색이 없거나 전부 동일함
   */
  return (
    backgroundColors.size <= 1
    && fontColors.size <= 1
  );
}

/*
 * 1단계:
 *
 * 투명화 대상으로 판정된 표는
 * table부터 내부의 모든 요소까지
 * 고정 시각 서식을 전부 제거한다.
 *
 * 실제 투명화 처리는 이 함수에서만 한다.
 */
function makeTableBackgroundTransparent($, table) {
  table.find("*").addBack().each((_, element) => {
    const node = $(element);
    const style = node.attr("style") || "";

    let nextStyle = style
      .replace(/(?:^|;)\s*color\s*:\s*[^;]+/ig, "")
      .replace(/(?:^|;)\s*background-color\s*:\s*[^;]+/ig, "")
      .replace(/(?:^|;)\s*background\s*:\s*[^;]+/ig, "")
      .replace(/(?:^|;)\s*border(?:-(?:top|right|bottom|left))?(?:-(?:width|style|color))?\s*:\s*[^;]+/ig, "")
      .trim();

    if (nextStyle) {
      node.attr("style", nextStyle);
    } else {
      node.removeAttr("style");
    }

    node.removeAttr("color");
    node.removeAttr("bgcolor");
    node.removeAttr("border");
    node.removeAttr("bordercolor");
  });
}

/*
 * 2단계:
 *
 * 표 전체가 투명화 대상이 아닌 경우
 * 실제 배경이 투명한 셀만 흰색으로 채운다.
 *
 * 기존 배경색 / 폰트색 / border는 건드리지 않는다.
 */
function fillTransparentCellBackgrounds($, table) {
  table.find("th, td").each((_, element) => {
    const cell = $(element);

    /*
     * 실제 배경색이 있으면 그대로 유지한다.
     */
    if (getCellBackgroundColor(cell)) return;

    const style = cell.attr("style") || "";

    /*
     * 기존 transparent 선언을 제거한 뒤
     * 흰색을 명시한다.
     */
    let nextStyle = style
      .replace(/(?:^|;)\s*background-color\s*:\s*transparent\s*;?/ig, "")
      .replace(/(?:^|;)\s*background\s*:\s*transparent\s*;?/ig, "")
      .trim();

    if (nextStyle && !nextStyle.endsWith(";")) {
      nextStyle += ";";
    }

    cell.attr("style", `${nextStyle}background-color:#ffffff;`);
  });
}

/*
 * 구형 SmartEditor 표의 width를 읽는다.
 *
 * 구형 표에는 WIDTH: 146.5pt 같은 값이 들어 있는 경우가 많다.
 * px도 같은 비율 계산에 사용할 수 있도록 pt 기준 값으로 환산한다.
 */
function getLegacyWidth(cell) {
  const style = cell.attr("style") || "";
  const match = style.match(/(?:^|;)\s*width\s*:\s*([\d.]+)\s*(pt|px|%)/i);

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
  return { percent: value };
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

      while (occupied[rowIndex][column]) column++;

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

    columnCount = Math.max(
      columnCount,
      occupied[rowIndex].length
    );
  });

  return { cells, columnCount };
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

      const knownWidth = known.reduce((sum, column) => sum + widths[column], 0);
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
    const average = knownWidths.reduce((sum, width) => sum + width, 0) / knownWidths.length;

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

  const percentages = columnWidths.map((width) => width / totalWidth * 100);

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
    table.attr("style", style.replace(/((?:^|;)\s*width\s*:\s*)[^;]+/i, "$1100%"));
  } else {
    table.attr("style", `${style}${style.trim() && !style.trim().endsWith(";") ? ";" : ""}width:100%;`);
  }
}

/*
 * 구형 SmartEditor 표가 부모 요소에서 상속받는 폰트색이 있는지 확인한다.
 *
 * table부터 .post-body까지 올라가며 color를 확인한다.
 * color가 확인되면 더 이상 부모를 거슬러 올라가지 않는다.
 */
function hasInheritedLegacyTableFontColor(table) {
  let node = table;

  while (node && node.length) {
    const style = node.attr("style") || "";

    if (/(?:^|;)\s*color\s*:\s*[^;]+/i.test(style)) return true;
    if (node.attr("color")) return true;

    if (node.hasClass("post-body")) break;

    node = node.parent();
  }

  return false;
}

/*
 * 구형 표 자체와 부모 요소에 기본 폰트색이 없으면 검은색을 기본값으로 지정한다.
 */
function ensureLegacyTableFontColor(table, cloned) {
  if (hasInheritedLegacyTableFontColor(table)) return;

  const style = cloned.attr("style") || "";

  cloned.attr("style", `${style}${style.trim() && !style.trim().endsWith(";") ? ";" : ""}color:#000;`);
}

module.exports = {
  getCellBackgroundColor,
  shouldMakeTableTransparent,
  makeTableBackgroundTransparent,
  fillTransparentCellBackgrounds,
  normalizeLegacyTableWidths,
  ensureLegacyTableFontColor,
};