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
   * 원본 PostView.css가 적용될 수 있도록 #postViewArea 구조를 유지한다.
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

function detectEditorVersion($) {
  const html = $.html();
  const socialPluginInfo = $("#socialPluginInfoJson").text();
  const socialMatch = socialPluginInfo.match(/\bsmartEditorVersion["']?\s*:\s*["']?(\d+)["']?/i);

  if (socialMatch) return Number(socialMatch[1]);

  const htmlMatch = html.match(
    /\bsmartEditorVersion(?:&(?:quot|#034);|["'])?\s*:\s*["']?(\d+)["']?/i,
  );

  if (htmlMatch) return Number(htmlMatch[1]);

  const baseInfoMatch = html.match(
    /aPostBaseInfo\s*\[\s*\d+\s*]\s*=\s*["']([^"']+)["']/i,
  );

  if (baseInfoMatch) {
    const fields = baseInfoMatch[1].split("|");
    const version = Number(fields[7]);

    if (Number.isInteger(version) && version > 0) return version;
  }

  /*
   * SmartEditor 1.0:
   * 명시적인 버전 정보가 없을 때 초기 에디터의 본문 구조를 확인한다.
   */
  if ($("#postViewArea .post-view > .view").length) return 1;

  if ($(".se-main-container").length) return 3;

  /*
   * SmartEditor 2.0:
   * 명시적인 버전 정보 없이 기존 PostView 구조만 확인되는 경우다.
   */
  if ($("#postViewArea, .se3_view").length) return 2;

  return 0;
}

function getViewerCssInfo($, editorVersion) {
  let result = null;

  $("link[rel~='stylesheet'][href]").each((_, element) => {
    const href = $(element).attr("href") || "";

    if (
      (editorVersion === 3 || editorVersion === 4)
      && /se\.viewer\.desktop(?:\.min)?\.css/i.test(href)
    ) {
      result = {
        url: new URL(href, "https://blog.naver.com/").href,
        filename: "se.viewer.desktop.css",
      };

      return false;
    }

    /*
     * SmartEditor 1.0:
     * 원문에 연결된 버전별 PostView CSS를 그대로 사용한다.
     */
    if (editorVersion === 1 && /\/PostView-[^/?#]+\.css(?:[?#]|$)/i.test(href)) {
      result = {
        url: new URL(href, "https://blog.naver.com/").href,
        filename: "PostView.css",
      };

      return false;
    }

    /*
     * SmartEditor 2.0:
     * 원문에 연결된 버전별 PostView CSS를 그대로 사용한다.
     */
    if (editorVersion === 2 && /\/PostView-[^/?#]+\.css(?:[?#]|$)/i.test(href)) {
      result = {
        url: new URL(href, "https://blog.naver.com/").href,
        filename: "PostView.css",
      };

      return false;
    }
  });

  return result;
}

function resolveUrl(value, baseUrl) {
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return value;
  }
}

function rewriteCssUrls(css, cssUrl) {
  return String(css).replace(
    /url\(\s*(['"]?)(.*?)\1\s*\)/gi,
    (match, quote, value) => {
      const url = value.trim();

      if (!url || /^(?:data:|https?:|\/\/|#)/i.test(url)) return match;

      return `url("${resolveUrl(url, cssUrl)}")`;
    },
  );
}

function rewriteCssImports(css, cssUrl) {
  return String(css).replace(
    /@import\s+(?:url\(\s*)?(['"])(.*?)\1\s*\)?/gi,
    (match, quote, value) => {
      const url = value.trim();

      if (!url || /^(?:data:|https?:|\/\/)/i.test(url)) return match;

      return match.replace(value, resolveUrl(value, cssUrl));
    },
  );
}

async function downloadViewerCss($, outputDir, editorVersion) {
  const cssInfo = getViewerCssInfo($, editorVersion);

  if (!cssInfo) {
    console.warn(`에디터 v${editorVersion || "?"} CSS를 찾지 못함`);
    return "";
  }

  console.log(`에디터 v${editorVersion} CSS: ${cssInfo.url}`);

  const response = await fetch(cssInfo.url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: "https://blog.naver.com/",
      Accept: "text/css,*/*;q=0.1",
    },
  });

  if (!response.ok) {
    throw new Error(
      `에디터 v${editorVersion} CSS 다운로드 실패: ${response.status} ${cssInfo.url}`,
    );
  }

  let css = await response.text();

  css = rewriteCssImports(css, cssInfo.url);
  css = rewriteCssUrls(css, cssInfo.url);

  fs.writeFileSync(path.join(outputDir, cssInfo.filename), css, "utf8");

  console.log(`에디터 v${editorVersion} CSS 저장: ${cssInfo.filename}`);

  return cssInfo.filename;
}

function getContentAreaWidth($) {
  const contentArea = $("#content-area").first();
  const inlineStyle = contentArea.attr("style") || "";
  const inlineMatch = inlineStyle.match(/\bwidth\s*:\s*([^;]+)/i);

  if (inlineMatch) return inlineMatch[1].trim();

  let result = "";

  $("style").each((_, element) => {
    const css = $(element).html() || "";
    const rules = css.match(/#content-area\s*\{[^}]*\}/gi) || [];

    for (const rule of rules) {
      const widthMatch = rule.match(/\bwidth\s*:\s*([^;}]+)/i);
      if (widthMatch) result = widthMatch[1].trim();
    }
  });

  if (result) return result;

  const bodyClass = $("body").attr("class") || "";
  const bodyWidthMatch = bodyClass.match(/\bcontw-(\d+(?:\.\d+)?)\b/i);

  if (bodyWidthMatch) return `${bodyWidthMatch[1]}px`;

  return "";
}

function getWrapperPath(root) {
  const wrappers = [];
  let current = root.parent();

  while (
    current.length
    && current[0].tagName !== "body"
    && current[0].tagName !== "html"
  ) {
    const element = current[0];
    const tagName = String(element.tagName || "").toLowerCase();

    if (!tagName) break;

    wrappers.unshift({
      tagName,
      attributes: { ...element.attribs },
    });

    current = current.parent();
  }

  return wrappers;
}

function sanitizeWrapperAttributes(attributes) {
  const result = {};

  for (const [name, value] of Object.entries(attributes || {})) {
    const lowerName = name.toLowerCase();

    if (lowerName.startsWith("on")) continue;

    if (
      lowerName === "style"
      || lowerName === "class"
      || lowerName === "id"
      || lowerName.startsWith("data-")
    ) {
      result[name] = value;
    }
  }

  return result;
}

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function makeAttributeString(attributes) {
  const entries = Object.entries(attributes || {});

  if (!entries.length) return "";

  return entries.map(([name, value]) => {
    return ` ${name}="${escapeAttribute(value)}"`;
  }).join("");
}

function wrapPostBody(body, wrappers) {
  let result = body;

  for (let i = wrappers.length - 1; i >= 0; i--) {
    const wrapper = wrappers[i];
    const attributes = sanitizeWrapperAttributes(wrapper.attributes);

    result = `<${wrapper.tagName}${makeAttributeString(attributes)}>
      ${result}
    </${wrapper.tagName}>`;
  }

  return result;
}

function getBodyAttributes($) {
  const body = $("body").first();

  if (!body.length) return {};

  return sanitizeWrapperAttributes(body[0].attribs);
}

function removeUnsafeWrapperIds(wrappers, editorVersion) {
  const allowedIds = new Set(["content-area"]);

  /*
   * SmartEditor 1.0:
   * PostView.css의 #post-area 선택자가 작동하도록 ID를 보존한다.
   */
  if (editorVersion === 1) allowedIds.add("post-area");

  /*
   * SmartEditor 2.0:
   * PostView.css의 #post-area 선택자가 작동하도록 ID를 보존한다.
   */
  if (editorVersion === 2) allowedIds.add("post-area");

  return wrappers.map(wrapper => {
    const attributes = { ...wrapper.attributes };

    if (attributes.id && !allowedIds.has(attributes.id)) {
      delete attributes.id;
    }

    return {
      ...wrapper,
      attributes,
    };
  });
}

function trimWrapperPath(wrappers, editorVersion) {
  const contentAreaIndex = wrappers.findIndex(wrapper => {
    return wrapper.attributes?.id === "content-area";
  });

  const postAreaIndex = wrappers.findIndex(wrapper => {
    return wrapper.attributes?.id === "post-area";
  });

  /*
   * SmartEditor 1.0:
   * PostView.css에는 #post-area 등 조상 요소를 포함한 선택자가 있으므로
   * #content-area부터 #postViewArea 직전까지 실제 래퍼 경로를 유지한다.
   */
  if (editorVersion === 1) {
    if (contentAreaIndex >= 0) return wrappers.slice(contentAreaIndex);
    if (postAreaIndex >= 0) return wrappers.slice(postAreaIndex);

    return wrappers;
  }

  /*
   * SmartEditor 2.0:
   * PostView.css가 #post-area 등 기존 블로그 래퍼를 기준으로 적용되므로
   * #content-area부터 #postViewArea 직전까지 실제 래퍼 경로를 유지한다.
   */
  if (editorVersion === 2) {
    if (contentAreaIndex >= 0) return wrappers.slice(contentAreaIndex);
    if (postAreaIndex >= 0) return wrappers.slice(postAreaIndex);

    return wrappers;
  }

  const viewerIndex = wrappers.findIndex(wrapper => {
    const className = wrapper.attributes?.class || "";

    return /\bse-viewer\b/i.test(className);
  });

  if (contentAreaIndex >= 0 && viewerIndex >= 0) {
    return [
      wrappers[contentAreaIndex],
      ...wrappers.slice(viewerIndex),
    ];
  }

  if (viewerIndex >= 0) return wrappers.slice(viewerIndex);
  if (contentAreaIndex >= 0) return [wrappers[contentAreaIndex]];

  return [];
}

function prepareWrapperPath(root, editorVersion) {
  const wrappers = getWrapperPath(root);
  const trimmed = trimWrapperPath(wrappers, editorVersion);

  return removeUnsafeWrapperIds(trimmed, editorVersion);
}

function setStyleProperty(style, property, value) {
  const declarations = String(style || "")
    .split(";")
    .map(item => item.trim())
    .filter(Boolean);

  const filtered = declarations.filter(declaration => {
    const index = declaration.indexOf(":");

    if (index < 0) return true;

    const name = declaration.slice(0, index).trim();

    return name.toLowerCase() !== property.toLowerCase();
  });

  filtered.push(`${property}:${value}`);

  return `${filtered.join(";")};`;
}

function applyContentAreaWidth(wrappers, width) {
  if (!width) return wrappers;

  return wrappers.map(wrapper => {
    if (wrapper.attributes?.id !== "content-area") return wrapper;

    const attributes = { ...wrapper.attributes };

    attributes.style = setStyleProperty(attributes.style, "width", width);

    return {
      ...wrapper,
      attributes,
    };
  });
}

function removeScripts(root) {
  root.find("script").remove();
}

function removeEventHandlers(root) {
  root.find("*").each((_, element) => {
    const attributes = { ...element.attribs };

    for (const name of Object.keys(attributes)) {
      if (name.toLowerCase().startsWith("on")) {
        delete element.attribs[name];
      }
    }
  });
}

function cleanArchivedRoot(root) {
  removeScripts(root);
  removeEventHandlers(root);
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
  return String(html).replace(
    protectedBody.token,
    () => protectedBody.content,
  );
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

  const viewerCssFilename = await downloadViewerCss(
    $,
    outputDir,
    editorVersion,
  );

  await localizeImages($, root, imageManager, { editorVersion });
  await localizeNaverVideos(
    $,
    root,
    outputDir,
    imageManager,
    { editorVersion },
  );

  await localizeAttachments($, root, outputDir, { editorVersion });

  restoreYouTubeEmbeds($, root);
  cleanArchivedRoot(root);

  /*
   * 전 에디터 공통:
   * 본문 전체를 placeholder로 보호한다.
   *
   * 외부 에디터나 웹에서 붙여 넣은 HTML의 공백, 들여쓰기,
   * 인라인 스타일을 js-beautify가 변경하지 못하게 한다.
   */
  const postBody = $.html(root);
  const body = wrapPostBody(postBody, wrappers);
  const protectedBody = protectPostBody(body);

  const viewerCssLink = viewerCssFilename
    ? `<link rel="stylesheet" href="./${viewerCssFilename}">`
    : "";

  const html = `<!doctype html>
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
</html>`;

  /*
   * 본문은 placeholder 상태로 두고 문서 외곽만 beautify한다.
   */
  const beautified = beautifyArchivedHtml(html);

  /*
   * 본문 복구 이후에는 Cheerio나 js-beautify를 다시 거치지 않는다.
   */
  return restorePostBody(beautified, protectedBody);
}

module.exports = {
  makeHtml,
  getPostRoot,
  detectEditorVersion,
};
