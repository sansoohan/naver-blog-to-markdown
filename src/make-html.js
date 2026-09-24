const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const {html: beautifyHtml} = require("js-beautify");
const {createImageManager, localizeImages} = require("./image");
const {restoreYoutubeVideos, localizeNaverVideos} = require("./video");
const {localizeAttachments} = require("./attachment");
const {download} = require("./downloader");

function normalizeEditorVersion(value) {
  const version = Number(value);
  return [1, 2, 3, 4].includes(version) ? version : 0;
}

function detectEditorVersion($) {
  const html = $.html();
  const socialMatch = $("#socialPluginInfoJson").text().match(/\bsmartEditorVersion["']?\s*:\s*["']?(\d+)["']?/i);
  if (socialMatch) return normalizeEditorVersion(socialMatch[1]);

  const match = html.match(/\bsmartEditorVersion(?:&(?:quot|#034);|["'])?\s*:\s*["']?(\d+)["']?/i);
  if (match) return normalizeEditorVersion(match[1]);

  const baseInfoMatch = html.match(/aPostBaseInfo\s*\[\s*\d+\s*]\s*=\s*["']([^"']+)["']/i);

  if (baseInfoMatch) {
    const version = Number(baseInfoMatch[1].split("|")[7]);
    if (normalizeEditorVersion(version)) return version;
  }

  const editorVersion = $("[data-post-editor-version]").first().attr("data-post-editor-version");
  if (normalizeEditorVersion(editorVersion)) return Number(editorVersion);

  /* 버전 1 */
  if ($("#postViewArea .post-view > .view").length) return 1;

  /* 버전 2 */
  if ($("#postViewArea .post-view,.post-view,.se3_view,.view").length) return 2;

  /* 버전 4 */
  if ($(".wrap_rabbit .se-viewer .se-main-container").length) return 4;

  /* 버전 3 */
  if ($(".se-viewer .se-main-container,.se-main-container").length) return 3;

  return 0;
}

function getVersion12PostRoot($) {
  const content = $("#postViewArea,.se3_view,.post-view,.post-view > .view,.view").first();

  if (content.length) {
    const post = content.closest(".post._post_wrap,.post").first();
    if (post.length) return post;
    return content;
  }

  return $(".post._post_wrap,.post").first();
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

  const version12 = getVersion12PostRoot($);
  if (version12.length) return version12;

  throw new Error("본문 영역을 찾을 수 없습니다.");
}

function getStylesheetInfo($, pattern, filename) {
  let result = null;

  $("link[rel~='stylesheet'][href]").each((_, element) => {
    const href = $(element).attr("href") || "";
    if (!pattern.test(href)) return undefined;

    result = {url: href, filename};
    return false;
  });

  if (result) return result;

  for (const url of $.html().match(/https?:\/\/[^"'\\\s<>]+/gi) || []) {
    const normalized = url.replace(/&amp;/g, "&");
    if (pattern.test(normalized)) return {url: normalized, filename};
  }

  return null;
}

function getLayoutCssInfo($) {
  return getStylesheetInfo($, /(?:LayoutTopCommon|PostTopCommon|PostViewCommon|PostListCommon).*\.css/i, "blog-layout.css");
}

function getPostViewCssInfo($) {
  return getStylesheetInfo($, /\/PostView-[^/]*\.css/i, "PostView.css");
}

function getViewerCssInfo($, editorVersion) {
  if (editorVersion === 3 || editorVersion === 4) {
    return getStylesheetInfo($, /se\.viewer\.desktop(?:\.min)?\.css/i, "se.viewer.desktop.css");
  }

  if (editorVersion === 1 || editorVersion === 2) return getPostViewCssInfo($);
  return null;
}

function normalizeUrl(url) {
  const value = String(url || "").replace(/&amp;/g, "&").trim();
  return value.startsWith("//") ? `https:${value}` : value;
}

function rewriteCssUrls(css, cssUrl) {
  return String(css).replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, quote, value) => {
    const source = String(value).trim();
    if (!source || source.startsWith("data:") || source.startsWith("blob:") || source.startsWith("#")) return match;

    try {
      return `url("${new URL(source, cssUrl)}")`;
    } catch {
      return match;
    }
  });
}

async function downloadCss(info, outputDir, label, noDownload = false) {
  if (!info) return "";

  const url = normalizeUrl(info.url);
  console.log(`${label} CSS: ${url}`);

  try {
    const result = await download(url, {
      outputDir,
      filename: info.filename,
      overwrite: true,
      noDownload,
      logLabel: `${label} CSS`,
      headers: {"User-Agent": "Mozilla/5.0", Referer: "https://blog.naver.com/"},
      transform: buffer => rewriteCssUrls(buffer.toString("utf8"), url),
    });

    return result.filename;
  } catch (error) {
    if (noDownload) {
      const existingPath = path.join(outputDir, info.filename);

      if (fs.existsSync(existingPath)) {
        try {
          if (fs.statSync(existingPath).isFile()) {
            console.log(`${label} CSS 기존 파일 재사용: ${info.filename}`);
            return info.filename;
          }
        } catch {}
      }

      throw error;
    }

    console.warn(`${label} CSS 다운로드 실패: ${error.message}`);
    return "";
  }
}

async function downloadLayoutCss($, outputDir, noDownload = false) {
  const info = getLayoutCssInfo($);
  if (!info) return "";
  return downloadCss(info, outputDir, "블로그 레이아웃", noDownload);
}

async function downloadPostViewCss($, outputDir, editorVersion, noDownload = false) {
  if (editorVersion !== 1 && editorVersion !== 2) return "";

  const info = getPostViewCssInfo($);
  if (!info) return "";

  return downloadCss(info, outputDir, "PostView", noDownload);
}

async function downloadViewerCss($, outputDir, editorVersion, noDownload = false) {
  if (editorVersion !== 3 && editorVersion !== 4) return "";

  const info = getViewerCssInfo($, editorVersion);
  if (!info) return "";

  return downloadCss(info, outputDir, `에디터 v${editorVersion}`, noDownload);
}

function getBodyAttributes($) {
  const attributes = {};

  for (const [name, value] of Object.entries($("body").first().attr() || {})) {
    if (name === "class" || name === "style" || name.startsWith("data-")) attributes[name] = value;
  }

  return attributes;
}

function getElementDescriptor(element) {
  if (!element || element.type !== "tag") return null;

  const attributes = {};

  for (const [name, value] of Object.entries(element.attribs || {})) {
    if (/^on/i.test(name) || name === "contenteditable" || name === "draggable") continue;
    attributes[name] = value;
  }

  return {tagName: element.tagName || element.name || "div", attributes};
}

function prepareWrapperPath(root, editorVersion) {
  const wrappers = [];
  let current = root.parent();

  while (current.length && !current.is("body,html")) {
    if (current.attr("id") === "twocols") {
      current = current.parent();
      continue;
    }

    const descriptor = getElementDescriptor(current.get(0));
    if (descriptor) wrappers.unshift(descriptor);
    current = current.parent();
  }

  if ((editorVersion === 3 || editorVersion === 4)
      && !wrappers.some(wrapper => String(wrapper.attributes.class || "").split(/\s+/).includes("se-viewer"))) {
    wrappers.push({tagName: "div", attributes: {class: "se-viewer se-theme-default", lang: "ko-KR"}});
  }

  return wrappers;
}

function makeAttributeString(attributes = {}) {
  return Object.entries(attributes).map(([name, value]) => {
    const escaped = String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    return ` ${name}="${escaped}"`;
  }).join("");
}

function wrapPostBody(body, wrappers) {
  let result = body;

  for (let index = wrappers.length - 1; index >= 0; index--) {
    const wrapper = wrappers[index];
    result = `<${wrapper.tagName}${makeAttributeString(wrapper.attributes)}>${result}</${wrapper.tagName}>`;
  }

  return result;
}

function isNaverGnbCss(css) {
  return /NTS UIT Development Office|sp_gnb_|\.gnb_|#gnb\b|gnb_notice|gnb_svc/i.test(String(css));
}

function getInlineHeadCss($) {
  return $("head style").toArray().map(element => $(element).html() || "").filter(css => {
    return css.trim() && !isNaverGnbCss(css);
  }).join("\n");
}

function getArchiveOverrideCss(editorVersion) {
  if (editorVersion !== 1 && editorVersion !== 2 && editorVersion !== 3 && editorVersion !== 4) return "";

  const rules = [
    `#body{width:100%;max-width:none;margin:0 auto;}`,
    `#wrapper{width:100%;max-width:none;margin:0 auto;box-sizing:border-box;}`,
    `#content-area{width:580px;display:block;float:none;margin:0 auto;}`,
  ];

  if (editorVersion === 3 || editorVersion === 4) {
    rules.push(`#post-area .bcc>[id^="post-view"].wrap_rabbit{width:100%;margin:auto;}`);
  }

  return rules.join("");
}

function cleanRuntimeClasses($, root) {
  const runtimeClasses = new Set([
    "__se-component",
    "se-image-loaded",
    "egjs-visible",
    "se-is-progress",
    "se-section-oembed-video",
  ]);

  root.find("*").each((_, element) => {
    const item = $(element);
    const className = item.attr("class");
    if (!className) return;

    const classes = className.split(/\s+/).filter(Boolean).filter(name => !runtimeClasses.has(name));

    if (classes.length) item.attr("class", classes.join(" "));
    else item.removeAttr("class");
  });
}

function cleanArchivedRoot($, root) {
  root.find("script").remove();
  root.find(".post-top,.post_footer_contents,.bottom_adpost,.post-btn").remove();
  root.find("[id^='naverComment_'][id$='_ct']").remove();

  root.find("style").each((_, element) => {
    const style = $(element);
    const text = style.text();
    if (!text.trim() || /__se_module_data|display\s*:\s*none/i.test(text)) style.remove();
  });

  root.find("[contenteditable]").removeAttr("contenteditable");
  root.find("[draggable]").removeAttr("draggable");
  cleanRuntimeClasses($, root);
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
  return {token: "NAVERPOSTBODYPLACEHOLDER00000000END", content: String(html)};
}

function restorePostBody(html, protectedBody) {
  return String(html).replace(protectedBody.token, () => protectedBody.content);
}

async function makeHtml(rawHtml, outputDir, options = {}) {
  const $ = cheerio.load(rawHtml, {decodeEntities: false});
  const editorVersion = options.editorVersion ?? detectEditorVersion($);
  const root = getPostRoot($, editorVersion);
  const bodyAttributes = getBodyAttributes($);
  const inlineHeadCss = getInlineHeadCss($);
  const archiveOverrideCss = getArchiveOverrideCss(editorVersion);
  const noDownload = Boolean(options.noDownload);
  const previousHtml = String(options.previousHtml || "");
  let previous$ = null;
  let previousRoot = null;

  if (noDownload && previousHtml) {
    previous$ = cheerio.load(previousHtml, {decodeEntities: false});

    try {
      previousRoot = getPostRoot(previous$, editorVersion);
    } catch {
      previousRoot = previous$("body");
    }
  }

  const imageManager = createImageManager(outputDir, {noDownload});

  console.log(`에디터 버전: ${editorVersion || "알 수 없음"}`);

  const wrappers = prepareWrapperPath(root, editorVersion);
  const layoutCssFilename = await downloadLayoutCss($, outputDir, noDownload);
  const postViewCssFilename = await downloadPostViewCss($, outputDir, editorVersion, noDownload);
  const viewerCssFilename = await downloadViewerCss($, outputDir, editorVersion, noDownload);

  await localizeImages($, root, imageManager, {editorVersion, noDownload, previous$, previousRoot});
  await localizeNaverVideos($, root, imageManager, {editorVersion, noDownload, previous$, previousRoot});
  await localizeAttachments($, root, outputDir, {editorVersion, noDownload, previous$, previousRoot});

  restoreYoutubeVideos($, root);
  cleanArchivedRoot($, root);

  const protectedBody = protectPostBody(wrapPostBody($.html(root), wrappers));
  const layoutCssLink = layoutCssFilename ? `<link rel="stylesheet" href="./${layoutCssFilename}">` : "";
  const postViewCssLink = postViewCssFilename ? `<link rel="stylesheet" href="./${postViewCssFilename}">` : "";
  const viewerCssLink = viewerCssFilename ? `<link rel="stylesheet" href="./${viewerCssFilename}">` : "";

  const html = `
    <!doctype html>
    <html lang="ko">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <title>Naver Blog Post</title>

        ${layoutCssLink}
        ${postViewCssLink}
        ${viewerCssLink}

        <style>${inlineHeadCss}</style>
        <style>${archiveOverrideCss}</style>

        <style>
          html,body{margin:0}
          .naver-local-video video{max-width:100%;height:auto}
          .naver-local-youtube iframe{max-width:100%}
        </style>
      </head>

      <body${makeAttributeString(bodyAttributes)}>
        ${protectedBody.token}
      </body>
    </html>
  `;

  return restorePostBody(beautifyArchivedHtml(html), protectedBody);
}

module.exports = {makeHtml, getPostRoot, detectEditorVersion};
