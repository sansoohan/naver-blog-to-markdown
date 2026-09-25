const crypto = require("crypto");

function createContentHash(root) {
  const clone = root.clone();

  /*
   * [해시 제외 - HTML id 속성]
   *
   * 네이버가 페이지 렌더링 과정에서 동적으로 생성하는 id가 포함될 수 있다.
   * 같은 게시글을 다시 불러와도 값이 달라질 수 있으므로 해시에서 제외한다.
   *
   * 중요:
   * 이 처리를 삭제하면 실제 게시글 내용이 바뀌지 않아도 동적 id 때문에 해시가 달라질 수 있다.
   * 반대로 id 자체가 실제 게시글 내용인지 확인하지 않고 이 제외 범위를 더 넓히지 말 것.
   */
  clone.find("*").each((_, element) => {
    const $el = clone.find(element);
    const attrs = element.attribs || {};

    for (const name of Object.keys(attrs)) {
      if (name === "id") {
        $el.removeAttr(name);
        continue;
      }

      /*
       * [해시 제외 - data-* 속성]
       *
       * 네이버 내부 동작과 렌더링 상태에 사용되는 data-* 속성은 실행 시 달라질 수 있으므로 제외한다.
       *
       * data-linktype은 링크 종류를 나타내는 콘텐츠 구조 정보이므로 예외적으로 유지한다.
       *
       * 중요:
       * data-*를 무조건 제거하는 현재 규칙을 수정할 때는 실제 콘텐츠 식별정보가 들어가는지 먼저 확인할 것.
       * 유지해야 할 data-*가 발견되면 data-linktype처럼 반드시 예외 목록에 추가할 것.
       */
      if (name.startsWith("data-") && name !== "data-linktype") $el.removeAttr(name);
    }
  });

  /*
   * [해시 제외 - script / style]
   *
   * 실행용 JavaScript와 스타일 정의는 게시글의 실제 텍스트/미디어 내용과 별개이며
   * 네이버가 내부 코드를 변경하면 게시글을 수정하지 않아도 내용이 달라질 수 있으므로 제외한다.
   *
   * 중요:
   * 이 처리를 삭제하면 네이버 내부 script/style 변경만으로 게시글 해시가 달라질 수 있다.
   */
  clone.find("script, style").remove();

  /*
   * [해시 제외 - 현대 에디터 이미지 / 동영상 / oEmbed 컴포넌트]
   *
   * 현대 네이버 에디터의 미디어 컴포넌트는 페이지를 불러오는 시점의 네트워크 상태와
   * JavaScript 실행 상태에 따라 같은 게시글에서도 서로 다른 HTML이 생성될 수 있다.
   *
   * 실제 확인된 차이:
   *
   *   이미지:
   *     정상 로딩 -> <img src="...">
   *     로딩 실패 -> "존재하지 않는 이미지입니다."
   *
   *   동영상:
   *     정상 로딩 -> __se-component, se-media-meta 등의 DOM 생성
   *     로딩 전   -> 빈 .se-module-video
   *
   *   oEmbed:
   *     정상 로딩 -> iframe 등의 실제 임베드 DOM 생성
   *     로딩 전   -> se-is-progress 등의 로딩 상태 DOM
   *
   * 일부 로딩 실패 상태에서는 실제 미디어 URL이나 식별정보 자체가 DOM에 존재하지 않으므로
   * 런타임 DOM만 선택적으로 제거해서 두 상태를 항상 동일하게 만드는 것이 불가능하다.
   *
   * 따라서 이미지, 동영상, oEmbed 컴포넌트 전체를 해시에서 제외한다.
   *
   * 중요:
   * 이 규칙 때문에 이미지/동영상/oEmbed만 교체하고 다른 본문 내용은 전혀 수정하지 않은 경우
   * 콘텐츠 해시는 변경되지 않는다.
   *
   * 대신 외부 리소스의 일시적인 로딩 성공/실패만으로 게시글이 수정된 것으로 판단되는 문제를 방지한다.
   */
  clone.find(".se-component.se-image, .se-component.se-video, .se-component.se-oembed").remove();

  /*
   * [해시 정규화 - 구형 네이버 동영상 플레이어]
   *
   * 구형 게시글의 ._naverVideo 내부에는 페이지를 불러올 때마다 새로 생성되는
   * 플레이어 UUID, SVG ID 등 대량의 런타임 DOM이 포함된다.
   *
   * 실제 동영상 식별자인 vid는 유지하고 플레이어 DOM 전체를 고정된 형태로 정규화한다.
   *
   * 중요:
   * ._naverVideo를 단순히 삭제하지 말 것.
   * 실제 동영상이 교체되어 vid가 변경되면 해시도 변경되어야 한다.
   */
  clone.find("._naverVideo").each((_, element) => {
    const $el = clone.find(element);
    const vid = $el.attr("vid") || "";

    $el.replaceWith(`<div class="_naverVideo" vid="${vid}"></div>`);
  });

  /*
   * [해시 제외 - 네이버 플레이어 플러그인 런타임 ID]
   *
   * 네이버 동영상/플레이어 주변 DOM에 splugin-id="<숫자>"가 생성될 수 있으며
   * 같은 게시글에서도 페이지를 다시 열 때 값이 달라지는 것이 확인되었다.
   *
   * 예:
   *   splugin-id="5539367842"
   *   splugin-id="2724968757"
   *
   * 중요:
   * 게시글 내용과 관계없는 런타임 식별자이므로 이 제거 처리를 삭제하지 말 것.
   */
  clone.find("[splugin-id]").removeAttr("splugin-id");

  /*
   * [해시 제외 - 공감 UI]
   *
   * .area_sympathy는 게시글 본문이 아니라 네이버가 동적으로 생성하는 공감/리액션 UI다.
   * 페이지를 읽는 시점에 따라 초기 HTML과 렌더링 완료 HTML의 구조 및 속성이 달라지는 것이 확인되었다.
   *
   * 실제 변동 예:
   *   style="visibility: visible;" 존재 여부
   *   aria-expanded 존재 여부
   *   role="none" / role="menuitem"
   *   role="menuitem" / role="button"
   *   tabindex 존재 여부
   *   __reaction__zeroface 클래스 존재 여부
   *   숨겨진 reaction icon 개수
   *
   * 중요:
   * 공감 수 및 공감 UI의 변화는 게시글 본문 수정이 아니므로 이 영역 전체를 해시에서 제외한다.
   * 이 처리를 삭제하면 네이버 UI의 로딩 상태만 달라져도 게시글이 변경된 것으로 판단될 수 있다.
   */
  clone.find(".area_sympathy").remove();

  /*
   * [해시 제외 - 네이버 공유 플러그인]
   *
   * .naver-splugin은 카페 보내기, Keep, 메모 보내기 등의 네이버 공유 UI다.
   * 게시글 본문과 관계없이 JavaScript 실행 상태에 따라 내부 DOM 전체가 생성되거나 비어 있을 수 있다.
   *
   * 실제로 같은 게시글에서:
   *
   *   <div class="naver-splugin">...</div>
   *
   * 처럼 공유 UI 전체가 생성되는 경우와:
   *
   *   <div class="naver-splugin"></div>
   *
   * 처럼 비어 있는 경우가 모두 확인되었다.
   *
   * 중요:
   * 게시글 콘텐츠가 아니므로 속성만 제거하지 말고 .naver-splugin 전체를 해시에서 제외한다.
   * 이 처리를 삭제하면 공유 플러그인의 로딩 여부만으로 해시가 변경될 수 있다.
   */
  clone.find(".naver-splugin").remove();

  /*
   * [해시 제외 - 첨부파일 다운로드 URL]
   *
   * 네이버 첨부파일의 .se-file-save-button href에는 같은 파일이어도 페이지를 다시 불러올 때
   * 변경될 수 있는 동적 다운로드 식별자가 포함된다.
   *
   * 파일명, 확장자 및 첨부파일 컴포넌트 자체는 유지하고 다운로드 href만 해시에서 제외한다.
   *
   * 중요:
   * .se-component.se-file 전체를 제거하지 말 것.
   * 실제 첨부파일이 추가/삭제되거나 파일명이 변경되면 해시가 달라져야 한다.
   */
  clone.find(".se-component.se-file a.se-file-save-button").removeAttr("href");

  /*
   * [해시 제외 - 구형 에디터 공감/댓글 UI]
   *
   * 구형 네이버 블로그의 .post-btn 영역은 게시글 본문이 아니라
   * 공감, 댓글 등 게시글 하단의 상호작용 UI다.
   *
   * 같은 게시글을 다시 불러와도 네이버 JavaScript의 로딩 상태에 따라
   * 공감 UI의 DOM 구조, class, role, aria-* 속성 등이 달라지는 것이 확인되었다.
   *
   * 실제 변동 예:
   *   style="visibility: visible;" 존재 여부
   *   __reaction__zeroface 클래스 존재 여부
   *   aria-expanded / aria-hidden 존재 여부
   *   role="menuitem" / role="button" / role="none"
   *   tabindex 존재 여부
   *   공감 카운트 표시 DOM 차이
   *
   * 중요:
   * 공감 및 댓글 변화는 게시글 본문 수정으로 취급하지 않는다.
   * 따라서 .post-btn 전체를 해시에서 제외한다.
   *
   * 실제 게시글 본문인 .post-view는 그대로 유지되므로
   * 글 내용이 수정되면 해시는 정상적으로 변경된다.
   */
  clone.find(".post-btn").remove();

  /*
   * [해시 제외 - URL의 일회성/동적 query parameter]
   *
   * 링크 자체는 실제 콘텐츠이므로 href 전체를 제거하지 않는다.
   * 대신 요청 시점이나 세션에 따라 달라질 수 있는 아래 query parameter의 값만 제거한다.
   *
   *   hashKey
   *   timestamp
   *   ts
   *   t
   *   rnd
   *   random
   *   nonce
   *
   * 중요:
   * URL 전체를 제거하지 말 것.
   * 실제 링크 주소가 변경된 경우에는 해시도 변경되어야 한다.
   *
   * 새로운 query parameter를 여기에 추가할 때도 실제 콘텐츠와 관계없는 동적 값인지 확인할 것.
   */
  clone.find("a").each((_, element) => {
    const $el = clone.find(element);
    const href = $el.attr("href");

    if (!href) return;

    try {
      const url = new URL(href, "https://blog.naver.com");

      for (const key of [...url.searchParams.keys()]) {
        if (/^(hashKey|timestamp|ts|t|rnd|random|nonce)$/i.test(key)) url.searchParams.delete(key);
      }

      $el.attr("href", url.toString());
    } catch {}
  });

  /*
   * [해시 제외 - HTML 주석]
   *
   * HTML 주석은 화면에 표시되는 게시글 내용이 아니며 네이버 내부 처리에 의해 달라질 수 있으므로 제외한다.
   *
   * 중요:
   * 실제 게시글 내용 변경 감지에는 필요하지 않으므로 이 제거 처리를 유지할 것.
   */
  const html = (clone.html() || "")
    .replace(/<!--[\s\S]*?-->/g, "")

    /*
     * [해시 정규화 - 공백]
     *
     * HTML 직렬화나 렌더링 과정에서 의미 없는 공백/줄바꿈 차이가 생겨도
     * 동일한 게시글을 다른 내용으로 판단하지 않도록 연속 공백을 하나로 합친다.
     *
     * 중요:
     * 이것은 텍스트를 삭제하는 것이 아니라 HTML 소스상의 연속 공백 차이를 정규화하는 처리다.
     */
    .replace(/\s+/g, " ")
    .trim();

  const hash = crypto.createHash("sha256").update(html).digest("hex");

  return {hash, source: html};
}

module.exports = {
  createContentHash,
};
