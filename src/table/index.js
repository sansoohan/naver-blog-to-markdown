const { isSimpleTable, renderSimpleTable, renderComplexTable } = require("./render");
const {
  shouldMakeTableTransparent,
  makeTableBackgroundTransparent,
  fillTransparentCellBackgrounds,
  normalizeLegacyTableWidths,
  ensureLegacyTableFontColor,
} = require("./legacy");

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

    const output = isSimpleTable($, table) ? renderSimpleTable($, table) : renderComplexTable($, table);

    component.replaceWith(`<div class="naver-protected">${store.add(output)}</div>`);
  });

  /*
   * SmartEditor 1/2 구형 표.
   */
  let legacyTableStyleAdded = false;

  root.find("table").each((_, element) => {
    const table = $(element);

    if (!table.closest(".post-view").length) return;
    if (table.closest(".naver-protected").length) return;

    const cloned = table.clone();

    cloned.addClass("naver-legacy-table");

    /*
     * 1단계:
     * 전체 투명화 대상이면 투명화하고 색상 처리를 종료한다.
     *
     * 2단계:
     * 전체 투명화 대상이 아니면 투명한 셀만 흰색으로 채운다.
     */
    const transparentTable = shouldMakeTableTransparent($, cloned);

    if (transparentTable) {
      makeTableBackgroundTransparent($, cloned);
    } else {
      fillTransparentCellBackgrounds($, cloned);
      ensureLegacyTableFontColor(cloned);
    }

    /*
     * 색상 처리 이후에는 폭만 정규화한다.
     */
    normalizeLegacyTableWidths($, cloned);

    /*
     * Markdown에서 들여쓰기가 코드블럭으로 해석되지 않도록
     * 태그 사이의 개행과 whitespace만 제거한다.
     */
    let output = $.html(cloned).replace(/\r?\n[ \t]*/g, "");

    /*
     * 구형 표용 CSS는 첫 번째 구형 표 앞에 한 번만 넣는다.
     */
    if (!legacyTableStyleAdded) {
      output = `${LEGACY_TABLE_STYLE}

${output}`;

      legacyTableStyleAdded = true;
    }

    table.replaceWith(`<div class="naver-protected">${store.add(output)}</div>`);
  });
}

module.exports = { protectTables };