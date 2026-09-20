const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const { html: beautifyHtml } = require("js-beautify");

const { createImageManager, localizeImages } = require("./src/image");
const { restoreYouTubeEmbeds, localizeNaverVideos } = require("./src/video");
const { localizeAttachments } = require("./src/attachment");

function getPostRoot($) {
  const smartEditor = $(".se-main-container").first();

  if (smartEditor.length) {
    return smartEditor;
  }

  const postView = $("#postViewArea").first();

  if (postView.length) {
    return postView;
  }

  const legacy = $(".se3_view").first();

  if (legacy.length) {
    return legacy;
  }

  throw new Error("본문 영역을 찾을 수 없습니다.");
}

function getViewerCssUrl($) {
  let result = "";

  $("link[rel~='stylesheet'][href]").each((_, element) => {
    const href = $(element).attr("href") || "";

    if (/se\.viewer\.desktop(?:\.min)?\.css/i.test(href)) {
      result = new URL(href, "https://blog.naver.com/").href;
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
  return String(css).replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (match, quote, value) => {
    const url = value.trim();

    if (!url || /^(?:data:|https?:|\/\/|#)/i.test(url)) {
      return match;
    }

    return `url("${resolveUrl(url, cssUrl)}")`;
  });
}

function rewriteCssImports(css, cssUrl) {
  return String(css).replace(/@import\s+(?:url\(\s*)?(['"])(.*?)\1\s*\)?/gi, (match, quote, value) => {
    const url = value.trim();

    if (!url || /^(?:data:|https?:|\/\/)/i.test(url)) {
      return match;
    }

    return match.replace(value, resolveUrl(value, cssUrl));
  });
}

async function downloadViewerCss($, outputDir) {
  const cssUrl = getViewerCssUrl($);

  if (!cssUrl) {
    console.warn("SmartEditor Viewer CSS를 찾지 못함");
    return "";
  }

  console.log(`SmartEditor Viewer CSS: ${cssUrl}`);

  const response = await fetch(cssUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: "https://blog.naver.com/",
      Accept: "text/css,*/*;q=0.1",
    },
  });

  if (!response.ok) {
    throw new Error(`SmartEditor Viewer CSS 다운로드 실패: ${response.status} ${cssUrl}`);
  }

  let css = await response.text();

  css = rewriteCssImports(css, cssUrl);
  css = rewriteCssUrls(css, cssUrl);

  const filename = "se.viewer.desktop.css";

  fs.writeFileSync(path.join(outputDir, filename), css, "utf8");

  console.log(`SmartEditor Viewer CSS 저장: ${filename}`);

  return filename;
}

function getContentAreaWidth($) {
  const contentArea = $("#content-area").first();
  const inlineStyle = contentArea.attr("style") || "";
  const inlineMatch = inlineStyle.match(/\bwidth\s*:\s*([^;]+)/i);

  if (inlineMatch) {
    return inlineMatch[1].trim();
  }

  let result = "";

  $("style").each((_, element) => {
    const css = $(element).html() || "";
    const rules = css.match(/#content-area\s*\{[^}]*\}/gi) || [];

    for (const rule of rules) {
      const widthMatch = rule.match(/\bwidth\s*:\s*([^;}]+)/i);

      if (widthMatch) {
        result = widthMatch[1].trim();
      }
    }
  });

  if (result) {
    return result;
  }

  const bodyClass = $("body").attr("class") || "";
  const bodyWidthMatch = bodyClass.match(/\bcontw-(\d+(?:\.\d+)?)\b/i);

  if (bodyWidthMatch) {
    return `${bodyWidthMatch[1]}px`;
  }

  return "";
}

function getWrapperPath(root) {
  const wrappers = [];
  let current = root.parent();

  while (current.length && current[0].tagName !== "body" && current[0].tagName !== "html") {
    const element = current[0];
    const tagName = String(element.tagName || "").toLowerCase();

    if (!tagName) {
      break;
    }

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

    if (lowerName.startsWith("on")) {
      continue;
    }

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

  if (!entries.length) {
    return "";
  }

  return entries
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join("");
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

  if (!body.length) {
    return {};
  }

  return sanitizeWrapperAttributes(body[0].attribs);
}

function removeUnsafeWrapperIds(wrappers) {
  return wrappers.map(wrapper => {
    const attributes = { ...wrapper.attributes };

    if (attributes.id && attributes.id !== "content-area") {
      delete attributes.id;
    }

    return {
      ...wrapper,
      attributes,
    };
  });
}

function trimWrapperPath(wrappers) {
  const contentAreaIndex = wrappers.findIndex(wrapper => wrapper.attributes?.id === "content-area");

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

  if (viewerIndex >= 0) {
    return wrappers.slice(viewerIndex);
  }

  if (contentAreaIndex >= 0) {
    return [wrappers[contentAreaIndex]];
  }

  return [];
}

function prepareWrapperPath(root) {
  const wrappers = getWrapperPath(root);
  const trimmed = trimWrapperPath(wrappers);

  return removeUnsafeWrapperIds(trimmed);
}

function setStyleProperty(style, property, value) {
  const declarations = String(style || "")
    .split(";")
    .map(item => item.trim())
    .filter(Boolean);

  const filtered = declarations.filter(declaration => {
    const index = declaration.indexOf(":");

    if (index < 0) {
      return true;
    }

    const name = declaration.slice(0, index).trim();

    return name.toLowerCase() !== property.toLowerCase();
  });

  filtered.push(`${property}:${value}`);

  return `${filtered.join(";")};`;
}

function applyContentAreaWidth(wrappers, width) {
  if (!width) {
    return wrappers;
  }

  return wrappers.map(wrapper => {
    if (wrapper.attributes?.id !== "content-area") {
      return wrapper;
    }

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

/*
 * 중요:
 *
 * 코드 내용을 HTML 문자열로 직렬화하기 전에 빼놓는다.
 *
 * 이렇게 해야:
 *
 *   Cheerio $.html()
 *   js-beautify
 *
 * 어느 쪽도 실제 코드의 공백/줄바꿈/들여쓰기를
 * 건드릴 수 없다.
 */
function protectCodeContentsInDom($, root) {
  const codes = [];

  root.find(".__se_code_view").each((_, element) => {
    const code = $(element);
    const content = code.html() || "";

    const token = `NAVERCODEPLACEHOLDER${String(codes.length).padStart(8, "0")}END`;

    codes.push({
      token,
      content,
    });

    code.html(token);
  });

  return codes;
}

/*
 * 모든 HTML 직렬화 + beautify가 끝난 다음
 * 코드 원문을 그대로 복구한다.
 */
function restoreCodeContents(html, codes) {
  let result = html;

  for (const { token, content } of codes) {
    result = result.replace(token, () => content);
  }

  return result;
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

async function makeHtml(rawHtml, outputDir) {
  const $ = cheerio.load(rawHtml, { decodeEntities: false });
  const root = getPostRoot($);
  const contentAreaWidth = getContentAreaWidth($);
  const bodyAttributes = getBodyAttributes($);
  const imageManager = createImageManager(outputDir);

  let wrappers = prepareWrapperPath(root);

  if (contentAreaWidth) {
    console.log(`콘텐츠 영역 가로폭: ${contentAreaWidth}`);
    wrappers = applyContentAreaWidth(wrappers, contentAreaWidth);
  } else {
    console.warn("콘텐츠 영역 가로폭을 찾지 못함");
  }

  const viewerCssFilename = await downloadViewerCss($, outputDir);

  /*
   * 이 단계에서는 아직 실제 코드 내용이 DOM 안에 있다.
   */
  await localizeImages($, root, imageManager);
  await localizeNaverVideos($, root, outputDir, imageManager);
  await localizeAttachments($, root, outputDir);

  restoreYouTubeEmbeds($, root);

  cleanArchivedRoot(root);

  /*
   * 반드시 $.html(root)보다 먼저 실행한다.
   *
   * 코드 내용을 placeholder로 바꾼 뒤부터는
   * Cheerio/beautifier가 코드 본문을 건드릴 수 없다.
   */
  const protectedCodes = protectCodeContentsInDom($, root);

  /*
   * 여기서부터 DOM → HTML 문자열 변환.
   * 실제 코드 대신 placeholder만 들어 있다.
   */
  const postBody = $.html(root);
  const body = wrapPostBody(postBody, wrappers);

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
    ${body}
  </body>
</html>`;

  /*
   * HTML 전체 beautify.
   *
   * 이 시점에도 실제 코드 내용은 없으므로
   * 코드 들여쓰기가 추가될 수 없다.
   */
  const beautified = beautifyArchivedHtml(html);

  /*
   * 가장 마지막에 코드 원문 복구.
   *
   * 복구 이후에는 Cheerio나 js-beautify를
   * 절대 다시 거치지 않는다.
   */
  return restoreCodeContents(beautified, protectedCodes);
}

module.exports = {
  makeHtml,
  getPostRoot,
};
