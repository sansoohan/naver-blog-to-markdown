function getSpan(cell, name) {
  const value = Number(cell.attr(name) || 1);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function getCellBackgroundColor(cell) {
  const style = cell.attr("style") || "";

  /*
   * 1. background-color
   *
   * CSS가 존재하면 bgcolor보다 우선한다.
   * transparent도 명시적인 CSS 값이므로
   * bgcolor까지 내려가지 않고 투명으로 처리한다.
   */
  const backgroundColorMatch = style.match(/(?:^|;)\s*background-color\s*:\s*([^;]+)/i);

  if (backgroundColorMatch) {
    const color = backgroundColorMatch[1].trim();

    return normalizeStyleColor(color) === "transparent"
      ? ""
      : color;
  }

  /*
   * 2. background shorthand
   *
   * background:transparent 역시 bgcolor보다 우선한다.
   */
  const backgroundMatch = style.match(
    /(?:^|;)\s*background\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^)]+\)|[a-z]+)(?:\s|;|$)/i
  );

  if (backgroundMatch) {
    const color = backgroundMatch[1].trim();

    return normalizeStyleColor(color) === "transparent"
      ? ""
      : color;
  }

  /*
   * 3. CSS background가 아예 지정되지 않은 경우에만
   * 구형 HTML bgcolor를 사용한다.
   */
  const bgcolor = cell.attr("bgcolor");

  if (bgcolor) return String(bgcolor).trim();

  return "";
}

function getActualText(node) {
  return node.text().replace(/\u200b/g, "").replace(/\u00a0/g, " ").trim();
}

function normalizeStyleColor(value) {
  return String(value || "").trim().replace(/\s+/g, "").toLowerCase();
}

/*
 * 표 전체를 투명화할 수 있는지 판정한다.
 *
 * 이 함수에서는 DOM을 절대로 수정하지 않는다.
 * 원본의 배경색 / 폰트색 / 글자 배경색만 검사한다.
 */
function shouldMakeTableTransparent($, table) {
  /*
   * 1단계:
   *
   * 모든 셀의 실제 배경색을 검사한다.
   *
   * CSS background/background-color가 있으면
   * bgcolor보다 CSS가 우선한다.
   *
   * 투명 또는 배경 미지정은 __none__으로 취급한다.
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
   * 2단계:
   *
   * 글자 서식을 검사한다.
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
    const colorMatch = style.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);

    if (colorMatch) {
      fontColors.add(normalizeStyleColor(colorMatch[1]));
    }

    /*
     * 실제 글자 span 자체에 배경색이 지정되어 있으면
     * 표 전체 투명화 대상에서 제외한다.
     */
    const backgroundColorMatch = style.match(/(?:^|;)\s*background-color\s*:\s*([^;]+)/i);

    if (backgroundColorMatch && normalizeStyleColor(backgroundColorMatch[1]) !== "transparent") {
      hasTextBackgroundColor = true;
    }

    const backgroundMatch = style.match(
      /(?:^|;)\s*background\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^)]+\)|[a-z]+)(?:\s|;|$)/i
    );

    if (backgroundMatch && normalizeStyleColor(backgroundMatch[1]) !== "transparent") {
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
      fontColors.add(normalizeStyleColor(color));
    }
  });

  /*
   * 최종 조건:
   *
   * 1. 모든 셀의 실제 배경색이 동일함
   * 2. 지정된 폰트색이 없거나 전부 동일함
   * 3. 실제 글자 자체에 별도 배경색이 없음
   */
  return (
    cellBackgroundColors.size <= 1
    && fontColors.size <= 1
    && !hasTextBackgroundColor
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
 * 구형 표 자체에 기본 폰트색이 없으면 검은색을 기본값으로 지정한다.
 *
 * table 자체에 지정된 color만 확인한다.
 * 셀 / span / font의 개별 폰트색은 부분 서식이므로 건드리지 않는다.
 */
function ensureLegacyTableFontColor(table) {
  const style = table.attr("style") || "";

  if (/(?:^|;)\s*color\s*:\s*[^;]+/i.test(style)) return;
  if (table.attr("color")) return;

  table.attr("style", `${style}${style.trim() && !style.trim().endsWith(";") ? ";" : ""}color:#000;`);
}

module.exports = {
  getCellBackgroundColor,
  shouldMakeTableTransparent,
  makeTableBackgroundTransparent,
  fillTransparentCellBackgrounds,
  normalizeLegacyTableWidths,
  ensureLegacyTableFontColor,
};