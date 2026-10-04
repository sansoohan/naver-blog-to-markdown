const {fetchNaver} = require("./naver-request");
const {getVersion12PostRoot} = require("./make-html");

function parsePostUrl(url) {
  const value = String(url || "").trim();

  let match = value.match(/blog\.naver\.com\/([^/?#]+)\/(\d+)/i);

  if (match) {
    return {
      blogId: match[1],
      logNo: match[2],
    };
  }

  match = value.match(/[?&]blogId=([^&#]+).*?[?&]logNo=(\d+)/i);

  if (match) {
    return {
      blogId: decodeURIComponent(match[1]),
      logNo: match[2],
    };
  }

  throw new Error("네이버 블로그 글 URL 형식이 아닙니다.");
}

async function getPost(blogId, logNo, options = {}) {
  const {includePrivate = false} = options;

  const url = `https://blog.naver.com/PostView.naver?blogId=${encodeURIComponent(blogId)}`
    + `&logNo=${encodeURIComponent(logNo)}`;

  const response = await fetchNaver(url, {
    private: includePrivate,
    browser: includePrivate,
    headers: {
      Referer: `https://blog.naver.com/${blogId}/${logNo}`,
    },
  });

  if (!response.ok) {
    throw new Error(`게시글 요청 실패: HTTP ${response.status}`);
  }

  return response.text();
}

function getPostRoot($, editorVersion) {
  /*
   * 버전 1·2:
   * #postViewArea만 빼면 PostView.css의 .post, .post-back, .post-body,
   * .bcc 관련 구조가 끊긴다. 따라서 글 전체 .post 래퍼를 보존한다.
   */
  if (editorVersion === 1 || editorVersion === 2) {
    const version12 = getVersion12PostRoot($);
    if (version12.length) return version12;
  }

  /*
   * 버전 3·4:
   * .se-main-container를 본문으로 사용하고 실제 원본 조상 래퍼는
   * prepareWrapperPath()에서 그대로 복원한다.
   */
  const smartEditor = $(".se-viewer .se-main-container").first();
  if (smartEditor.length) return smartEditor;

  const mainContainer = $(".se-main-container").first();
  if (mainContainer.length) return mainContainer;

  /*
   * 초기 SmartEditor 3:
   * data-post-editor-version="3"이지만 .se-main-container가 아니라
   * .se_doc_viewer와 .__se_component_area 구조를 사용하는 글이 있다.
   *
   * .se_doc_viewer 전체에는 제목, 작성자, 작성일 등의 헤더가 포함되므로
   * 실제 게시글 내용이 들어 있는 컴포넌트 영역만 root로 사용한다.
   */
  if (editorVersion === 3) {
    const contentsStart = $(".se_doc_contents_start").first();

    if (contentsStart.length) {
      const version3 = contentsStart.nextAll(".__se_component_area").first();

      if (version3.length) return version3;
    }
  }

  const version12 = getVersion12PostRoot($);
  if (version12.length) return version12;

  throw new Error("본문 영역을 찾을 수 없습니다.");
}

module.exports = {
  parsePostUrl,
  getPost,
  getPostRoot,
};