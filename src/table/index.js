const { isSimpleTable, renderSimpleTable, renderComplexTable } = require("./render");
const {
  shouldMakeTableTransparent,
  makeTableBackgroundTransparent,
  fillTransparentCellBackgrounds,
  normalizeLegacyTableWidths,
  ensureLegacyTableFontColor,
} = require("./legacy");

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
  const legacyTables = root.find("table").filter((_, element) => {
    const table = $(element);

    /*
     * 실제 게시글 본문 안의 표만 처리한다.
     */
    if (!table.closest(".post-view").length) return false;
    if (table.closest(".naver-protected").length) return false;

    return true;
  });

  legacyTables.each((_, element) => {
    const table = $(element);

    const cloned = table.clone();

    cloned.addClass("naver-legacy-table");

    /*
     * 먼저 표 전체를 투명화할 수 있는지 판정한다.
     *
     * 투명화 대상이면 고정 시각 서식을 제거하고,
     * 투명화 대상이 아니면 실제 배경이 투명한 셀만 흰색으로 채운다.
     */
    const transparentTable = shouldMakeTableTransparent($, cloned);

    if (transparentTable) {
      makeTableBackgroundTransparent($, cloned);
      cloned.addClass("naver-legacy-table-transparent");
    } else {
      fillTransparentCellBackgrounds($, cloned);
    }

    /*
     * 구형 표의 절대 폭을
     * 현재 Markdown 뷰어 폭에 맞는 상대 폭으로 바꾼다.
     */
    normalizeLegacyTableWidths($, cloned);

    /*
     * 투명화하지 않은 표에만 기본 폰트색을 지정한다.
     *
     * 투명화한 표는 원래의 고정 폰트색까지 제거한 상태이므로
     * table에 color:#000을 다시 추가하면 안 된다.
     */
    if (!transparentTable) ensureLegacyTableFontColor(table, cloned);

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
    const output = $.html(cloned).replace(/\r?\n[ \t]*/g, "");

    table.replaceWith(`<div class="naver-protected">${store.add(output)}</div>`);
  });
}

module.exports = { protectTables };