const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const { html: beautifyHtml } = require("js-beautify");

const { createImageManager, localizeImages } = require("./src/image");
const { restoreYouTubeEmbeds, localizeNaverVideos } = require("./src/video");
const { localizeAttachments } = require("./src/attachment");

function getPostRoot($, editorVersion) {
  /*
   * SmartEditor 1.0:
   * PostView.css가 #postViewArea > .post-view > .view 구조를 기준으로 적용되므로
   * .view만 떼지 않고 #postViewArea 전체를 본문 루트로 사용한다.
   */
  if (editorVersion === 1) {
    const postViewArea = $("#postViewArea").first();

    if (postViewArea.length) return postViewArea;
  }

  /*
   * SmartEditor 2.0:
   * 1.0과 마찬가지로 원본 PostView.css가 적용될 수 있게 #postViewArea 구조를 유지한다.
   */
  if (editorVersion === 2) {
    const postViewArea = $("#postViewArea").first();

    if (postViewArea.length) return postViewArea;

    const legacy = $(".se3_view").first();

    if (legacy.length) return legacy;
  }

  const smartEditor = $(".se-main-container").first();

  if (smartEditor.length) return smartEditor;

  const postView = $("#postViewArea").first();

  if (postView.length) return postView;

  const legacy = $(".se3_view").first();

  if (legacy.length) return legacy;

  throw new Error("본문 영역을 찾을 수 없습니다.");
}

function normalizeEditorVersion(value) {
  const version = Number(value);

  if (!Number.isInteger(version) || version < 1) return 0;

  /*
   * 네이버 메타데이터에는 4 이상의 값이 들어올 수 있지만,
   * 별도의 SmartEditor 4 문서 구조가 아니라 SmartEditor ONE 계열이다.
   * 따라서 SmartEditor 3으로 통합해서 처리한다.
   */
  return version >= 3 ? 3 : version;
}

function detectEditorVersion($) {
  const html = $.html();
  const socialPluginInfo = $("#socialPluginInfoJson").text();
  const socialMatch = socialPluginInfo.match(
    /\bsmartEditorVersion["']?\s*:\s*["']?(\d+)["']?/i
  );

  if (socialMatch) return normalizeEditorVersion(socialMatch[1]);

  const match = html.match(
    /\bsmartEditorVersion(?:&(?:quot|#034);|["'])?\s*:\s*["']?(\d+)["']?/i
  );

  if (match) return normalizeEditorVersion(match[1]);

  const baseInfoMatch = html.match(
    /aPostBaseInfo\s*\[\s*\d+\s*]\s*=\s*["']([^"']+)["']/i
  );

  if (baseInfoMatch) {
    const fields = baseInfoMatch[1].split("|");
    const version = Number(fields[7]);

    if (Number.isInteger(version) && version > 0) {
      return normalizeEditorVersion(version);
    }
  }

  /* SmartEditor 1.0: 초기 에디터의 .post-view > .view 본문 구조를 확인한다. */
  if ($("#postViewArea .post-view > .view").length) return 1;

  /* SmartEditor ONE: .se-main-container 본문 구조를 사용한다. */
  if ($(".se-main-container").length) return 3;

  /* SmartEditor 2.0: 구형 #postViewArea 또는 .se3_view 구조를 사용한다. */
  if ($("#postViewArea, .se3_view").length) return 2;

  return 0;
}

function getViewerCssInfo($, editorVersion) {
  let result = null;

  $("link[rel~='stylesheet'][href]").each((_, element) => {
    const href = $(element).attr("href") || "";

    /*
     * SmartEditor ONE:
     * se.viewer.desktop.css 또는 압축된 변형을 사용한다.
     */
    if (editorVersion === 3 && /se\.viewer\.desktop(?:\.min)?\.css/i.test(href)) {
      result = {
        url: href,
        filename: "se.viewer.desktop.css",
      };

      return false;
    }

    /*
     * SmartEditor 2.0:
     * PostView.css 또는 postview 계열 CSS를 사용한다.
     */
    if (
      editorVersion === 2
      && /(?:PostView|postview|smart_editor2).*\.css/i.test(href)
    ) {
      result = {
        url: href,
        filename: "PostView.css",
      };

      return false;
    }

    /*
     * SmartEditor 1.0:
     * 초기 글의 PostView.css를 사용한다.
     */
    if (
      editorVersion === 1
      && /(?:PostView|postview|smart_editor).*\.css/i.test(href)
    ) {
      result = {
        url: href,
        filename: "PostView.css",
      };

      return false;
    }

    return undefined;
  });

  if (result) return result;

  const html = $.html();

  if (editorVersion === 3) {
    const match = html.match(
      /https?:\/\/[^"'\\\s<>]+\/se\.viewer\.desktop(?:\.min)?\.css[^"'\\\s<>]*/i
    );

    if (match) {
      return {
        url: match[0].replace(/&amp;/g, "&"),
        filename: "se.viewer.desktop.css",
      };
    }
  }

  if (editorVersion === 1 || editorVersion === 2) {
    const match = html.match(
      /https?:\/\/[^"'\\\s<>]+\/(?:PostView|postview)[^"'\\\s<>]*\.css[^"'\\\s<>]*/i
    );

    if (match) {
      return {
        url: match[0].replace(/&amp;/g, "&"),
        filename: "PostView.css",
      };
    }
  }

  return null;
}

function normalizeUrl(url) {
  const value = String(url || "").replace(/&amp;/g, "&").trim();

  if (!value) return "";
  if (value.startsWith("//")) return `https:${value}`;

  return value;
}

async function downloadViewerCss($, outputDir, editorVersion) {
  const info = getViewerCssInfo($, editorVersion);

  if (!info) {
    console.warn(`에디터 v${editorVersion} CSS 주소를 찾지 못함`);
    return "";
  }

  const url = normalizeUrl(info.url);

  console.log(`에디터 v${editorVersion} CSS: ${url}`);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: "https://blog.naver.com/",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    let css = await response.text();

    /*
     * CSS 안의 상대 URL이 로컬 HTML에서도 동작하도록
     * CSS 원본 주소를 기준으로 절대 URL로 변경한다.
     */
    css = css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, quote, value) => {
      const source = String(value).trim();

      if (
        !source
        || source.startsWith("data:")
        || source.startsWith("blob:")
        || source.startsWith("#")
      ) {
        return match;
      }

      try {
        return `url("${new URL(source, url)}")`;
      } catch {
        return match;
      }
    });

    fs.writeFileSync(path.join(outputDir, info.filename), css, "utf8");
    console.log(`에디터 v${editorVersion} CSS 저장: ${info.filename}`);

    return info.filename;
  } catch (error) {
    console.warn(`에디터 CSS 다운로드 실패: ${error.message}`);
    return "";
  }
}

function getContentAreaWidth($) {
  const selectors = [
    "#content-area",
    "#post-area",
    ".post-area",
    ".se-main-container",
    "#postViewArea",
  ];

  for (const selector of selectors) {
    const element = $(selector).first();

    if (!element.length) continue;

    const style = element.attr("style") || "";
    const styleMatch = style.match(/(?:^|;)\s*width\s*:\s*(\d+(?:\.\d+)?)px/i);

    if (styleMatch) return `${styleMatch[1]}px`;

    const width = element.attr("data-width") || element.attr("width");

    if (/^\d+(?:\.\d+)?$/.test(String(width || ""))) {
      return `${width}px`;
    }
  }

  const html = $.html();

  const patterns = [
    /contentAreaWidth\s*[:=]\s*["']?(\d+(?:\.\d+)?)/i,
    /contentWidth\s*[:=]\s*["']?(\d+(?:\.\d+)?)/i,
    /postWidth\s*[:=]\s*["']?(\d+(?:\.\d+)?)/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (match) return `${match[1]}px`;
  }

  return "";
}

function getBodyAttributes($) {
  const body = $("body").first();

  if (!body.length) return {};

  const result = {};

  for (const [name, value] of Object.entries(body.attr() || {})) {
    if (name === "class" || name === "style" || name.startsWith("data-")) {
      result[name] = value;
    }
  }

  return result;
}

function getElementDescriptor(element) {
  if (!element || element.type !== "tag") return null;

  const attributes = {};

  for (const [name, value] of Object.entries(element.attribs || {})) {
    if (
      name === "id"
      || name === "class"
      || name === "style"
      || name.startsWith("data-")
    ) {
      attributes[name] = value;
    }
  }

  return {
    tagName: element.tagName || element.name || "div",
    attributes,
  };
}

function prepareWrapperPath(root, editorVersion) {
  const wrappers = [];
  let current = root.get(0)?.parent;

  while (current && current.type === "tag") {
    const descriptor = getElementDescriptor(current);

    if (descriptor) wrappers.unshift(descriptor);

    if (
      current.tagName === "body"
      || current.name === "body"
      || wrappers.length >= 8
    ) {
      break;
    }

    current = current.parent;
  }

  /*
   * SmartEditor 1.0과 2.0은 getPostRoot()가 #postViewArea 자체를 반환한다.
   * 따라서 wrapper에 #postViewArea를 다시 추가하지 않는다.
   */
  if (editorVersion === 1 || editorVersion === 2) {
    return wrappers.filter(wrapper => wrapper.attributes.id !== "postViewArea");
  }

  return wrappers;
}

function makeAttributeString(attributes) {
  return Object.entries(attributes)
    .map(([name, value]) => {
      const escaped = String(value)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;");

      return ` ${name}="${escaped}"`;
    })
    .join("");
}

function wrapPostBody(body, wrappers) {
  let result = body;

  for (let index = wrappers.length - 1; index >= 0; index--) {
    const wrapper = wrappers[index];
    const attributes = makeAttributeString(wrapper.attributes);

    result = `<${wrapper.tagName}${attributes}>${result}</${wrapper.tagName}>`;
  }

  return `<main id="content-area">${result}</main>`;
}

function applyContentAreaWidth(wrappers, width) {
  const result = wrappers.map(wrapper => ({
    tagName: wrapper.tagName,
    attributes: { ...wrapper.attributes },
  }));

  if (!result.length) return result;

  const target = result.find(wrapper =>
    wrapper.attributes.id === "post-area"
    || wrapper.attributes.id === "postViewArea"
    || String(wrapper.attributes.class || "").split(/\s+/).includes("post-area")
  ) || result[result.length - 1];

  const style = String(target.attributes.style || "").trim();
  const separator = style && !style.endsWith(";") ? ";" : "";

  target.attributes.style = `${style}${separator}width:${width};max-width:100%;`;

  return result;
}

function cleanArchivedRoot(root) {
  root.find("script").remove();

  root.find("style").each((_, element) => {
    const style = root.find(element);
    const text = style.text();

    /*
     * 본문 내부에 직접 삽입된 사용자 서식은 유지한다.
     * 실행용 또는 비어 있는 스타일만 제거한다.
     */
    if (!text.trim() || /__se_module_data|display\s*:\s*none/i.test(text)) {
      style.remove();
    }
  });

  root.find("[contenteditable]").removeAttr("contenteditable");
  root.find("[draggable]").removeAttr("draggable");
}

function beautifyArchivedHtml(html) {
  return beautifyHtml(html, {
    indent_size: 2,
    indent_char: " ",
    max_preserve_newlines: 1,
    preserve_newlines: true,
    wrap_line_length: 0,
    end_with_newline: true,
  });
}

function protectPostBody(html) {
  return {
    token: "NAVERPOSTBODYPLACEHOLDER00000000END",
    content: String(html),
  };
}

function restorePostBody(html, protectedBody) {
  return String(html).replace(protectedBody.token, () => protectedBody.content);
}

async function makeHtml(rawHtml, outputDir, options = {}) {
  const $ = cheerio.load(rawHtml, { decodeEntities: false });
  const editorVersion = options.editorVersion ?? detectEditorVersion($);
  const root = getPostRoot($, editorVersion);
  const contentAreaWidth = getContentAreaWidth($);
  const bodyAttributes = getBodyAttributes($);
  const imageManager = createImageManager(outputDir);

  console.log(`에디터 버전: ${editorVersion || "알 수 없음"}`);

  let wrappers = prepareWrapperPath(root, editorVersion);

  if (contentAreaWidth) {
    console.log(`콘텐츠 영역 가로폭: ${contentAreaWidth}`);
    wrappers = applyContentAreaWidth(wrappers, contentAreaWidth);
  } else {
    console.warn("콘텐츠 영역 가로폭을 찾지 못함");
  }

  const viewerCssFilename = await downloadViewerCss($, outputDir, editorVersion);

  /*
   * editorVersion은 각 처리기에 전달한다.
   * 실제 구조 차이가 발견된 기능만 처리기 내부에서 버전별로 분기한다.
   */
  await localizeImages($, root, imageManager, { editorVersion });
  await localizeNaverVideos($, root, outputDir, imageManager, { editorVersion });
  await localizeAttachments($, root, outputDir, { editorVersion });

  restoreYouTubeEmbeds($, root);
  cleanArchivedRoot(root);

  /*
   * 본문 전체를 placeholder로 보호한다.
   * 외부 에디터나 웹에서 붙여 넣은 HTML의 공백, 들여쓰기, 인라인 스타일을
   * js-beautify가 변경하지 못하게 한다.
   */
  const postBody = $.html(root);
  const body = wrapPostBody(postBody, wrappers);
  const protectedBody = protectPostBody(body);

  const viewerCssLink = viewerCssFilename
    ? `<link rel="stylesheet" href="./${viewerCssFilename}">`
    : "";

  const html = `
    <!doctype html>
    <html lang="ko">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Naver Blog Post</title>
        ${viewerCssLink}
        <style>
          html {
            width: 100%;
          }

          body {
            width: 100%;
            margin: 0;
          }

          #content-area {
            margin-left: auto;
            margin-right: auto;
          }

          .naver-local-video video {
            max-width: 100%;
            height: auto;
          }

          .naver-local-youtube iframe {
            max-width: 100%;
          }
        </style>
      </head>
      <body${makeAttributeString(bodyAttributes)}>
        ${protectedBody.token}
      </body>
    </html>
  `;

  const beautified = beautifyArchivedHtml(html);

  return restorePostBody(beautified, protectedBody);
}

module.exports = {
  makeHtml,
  getPostRoot,
  detectEditorVersion,
};
