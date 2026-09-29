const { isSimpleTable, renderSimpleTable, renderComplexTable } = require("./render");
const {
  shouldMakeTableTransparent,
  makeTableBackgroundTransparent,
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

    /*
     * 표 자체에 기본 폰트색이 없으면
     * 다크모드에서도 읽을 수 있도록 검은색을 기본값으로 지정한다.
     */
    ensureLegacyTableFontColor(cloned);

    /*
     * 원본 구형 HTML에는 table 내부에
     * 탭 / 개행 들여쓰기가 많이 들어 있다.
     *
     * Markdown에서는 탭 또는 4칸 들여쓰기가
     * 코드블럭으로 해석될 수 있으므로
     * 태그 사이의 whitespace만 제거한다.
     *
     * 실제 텍스트가 들어 있는 구간은 건드리지 않는다.
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
