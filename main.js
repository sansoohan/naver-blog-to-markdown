const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const TurndownService = require("turndown");

function parsePostUrl(input) {
  const value = input.trim();
  const match = value.match(/blog\.naver\.com\/([^/?#]+)\/(\d+)/i);
  if (match) return { blogId: match[1], logNo: match[2] };

  try {
    const url = new URL(value);
    const blogId = url.searchParams.get("blogId");
    const logNo = url.searchParams.get("logNo");
    if (blogId && logNo) return { blogId, logNo };
  } catch {}

  throw new Error("네이버 블로그 글 주소를 인식할 수 없습니다.");
}

function safeFilename(value) {
  return String(value).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/[. ]+$/g, "").trim().slice(0, 180) || "untitled";
}

function escapeHtmlText(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlAttribute(value) {
  return escapeHtmlText(value).replace(/"/g, "&quot;");
}

function escapeMarkdownUrl(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function escapeMarkdownTitle(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function getStyleProperty(style, property) {
  const match = String(style || "").match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "i"));
  return match ? match[1].trim() : "";
}

function createStore() {
  let index = 0;
  const values = new Map();

  return {
    add(value) {
      const token = `NAVERPLACEHOLDER${String(++index).padStart(8, "0")}END`;
      values.set(token, String(value));
      return token;
    },

    restore(text) {
      let result = String(text);
      for (const [token, value] of values) result = result.split(token).join(value);
      return result;
    },
  };
}

function getExtension(url, contentType = "") {
  const ext = path.extname(String(url).split("?")[0]).toLowerCase();

  if (/^\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(ext)) return ext === ".jpeg" ? ".jpg" : ext;
  if (/video\/mp4/i.test(contentType)) return ".mp4";
  if (/image\/png/i.test(contentType)) return ".png";
  if (/image\/gif/i.test(contentType)) return ".gif";
  if (/image\/webp/i.test(contentType)) return ".webp";

  return ".jpg";
}

function getNaverFontSize(node) {
  if (!node || node.type !== "tag") return null;

  const className = node.attribs?.class || "";

  if (/(?:^|\s)se-fs-(?:\s|$)/.test(className)) return 15;

  const match = className.match(/(?:^|\s)se-fs-fs(\d+)(?:\s|$)/);
  return match ? Number(match[1]) : null;
}

function createStyleState() {
  return {
    fontSize: null,
    color: "",
    backgroundColor: "",
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    link: null,
  };
}

function cloneStyle(style) {
  return {
    ...style,
    link: style.link ? { ...style.link } : null,
  };
}

function sameLink(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;

  return a.href === b.href
    && a.target === b.target
    && a.title === b.title;
}

function sameStyle(a, b) {
  return a.fontSize === b.fontSize
    && a.color === b.color
    && a.backgroundColor === b.backgroundColor
    && a.bold === b.bold
    && a.italic === b.italic
    && a.underline === b.underline
    && a.strike === b.strike
    && sameLink(a.link, b.link);
}

function normalizeSourceText(text) {
  return String(text).replace(/\u200b/g, "").replace(/\u00a0/g, " ");
}

function collectStyleRuns(node, inherited = createStyleState(), runs = []) {
  if (!node) return runs;

  if (node.type === "text") {
    const text = normalizeSourceText(node.data || "");
    if (text) runs.push({ type: "text", text, style: cloneStyle(inherited) });
    return runs;
  }

  if (node.type !== "tag") return runs;

  const name = String(node.name || "").toLowerCase();

  if (name === "br") {
    runs.push({ type: "break" });
    return runs;
  }

  const state = cloneStyle(inherited);

  if (name === "span") {
    const size = getNaverFontSize(node);
    const css = node.attribs?.style || "";
    const color = getStyleProperty(css, "color");
    const backgroundColor = getStyleProperty(css, "background-color");

    if (size !== null) state.fontSize = size;
    if (color) state.color = color;
    if (backgroundColor) state.backgroundColor = backgroundColor;
  }

  if (name === "b" || name === "strong") state.bold = true;
  if (name === "i" || name === "em") state.italic = true;
  if (name === "u") state.underline = true;
  if (name === "s" || name === "strike" || name === "del") state.strike = true;

  if (name === "a") {
    state.link = {
      href: node.attribs?.href || "",
      target: node.attribs?.target || "",
      title: node.attribs?.title || "",
    };
  }

  for (const child of node.children || []) collectStyleRuns(child, state, runs);

  return runs;
}

function mergeRuns(runs) {
  const result = [];

  for (const run of runs) {
    const previous = result[result.length - 1];

    if (run.type === "text" && previous?.type === "text" && sameStyle(previous.style, run.style)) {
      previous.text += run.text;
    } else {
      result.push(run.type === "text" ? { ...run, style: cloneStyle(run.style) } : run);
    }
  }

  return result;
}

function meaningfulRuns(runs) {
  return runs.filter((run) => run.type === "text" && run.text.trim());
}

function getParagraphFontSize(runs) {
  const meaningful = meaningfulRuns(runs);
  if (!meaningful.length) return null;

  const sizes = [...new Set(meaningful.map((run) => run.style.fontSize))];
  return sizes.length === 1 ? sizes[0] : null;
}

function hasMixedFontSizes(runs) {
  return new Set(meaningfulRuns(runs).map((run) => run.style.fontSize)).size > 1;
}

function getHeadingLevel(size) {
  if (size === 30) return 1;
  if (size === 28) return 2;
  if (size === 24) return 3;
  if (size === 19) return 4;
  if (size === 16) return 5;
  if (size === 15) return 6;
  return 0;
}

function parseCheckbox(runs) {
  let text = "";

  for (const run of runs) {
    if (run.type === "break") break;
    text += run.text || "";
  }

  const match = text.match(/^([ \t]*)-\s+\[([xX ])\]\s*/);
  if (!match) return null;

  return {
    indent: match[1],
    checked: match[2].toLowerCase() === "x" ? "x" : " ",
    length: match[0].length,
  };
}

function removeTextPrefix(runs, length) {
  let remaining = length;

  for (const run of runs) {
    if (remaining <= 0) break;
    if (run.type !== "text") continue;

    if (run.text.length <= remaining) {
      remaining -= run.text.length;
      run.text = "";
    } else {
      run.text = run.text.slice(remaining);
      remaining = 0;
    }
  }

  return runs.filter((run) => run.type !== "text" || run.text);
}

function escapeMarkdownText(text) {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/([`*_[\]<>~])/g, "\\$1")
    .replace(/^([ \t]*)(#{1,6}|>|[-+])(?=\s)/gm, "$1\\$2")
    .replace(/^([ \t]*)(\d+)\.(?=\s)/gm, "$1$2\\.");
}

function renderMarkdownFormatting(text, style) {
  let result = escapeMarkdownText(text);

  if (style.strike) result = `~~${result}~~`;
  if (style.italic) result = `*${result}*`;
  if (style.bold) result = `**${result}**`;

  return result;
}

function renderHtmlFormatting(text, style, preserveFontSize) {
  let result = escapeHtmlText(text);

  if (style.strike) result = `<s>${result}</s>`;
  if (style.italic) result = `<em>${result}</em>`;
  if (style.bold) result = `<strong>${result}</strong>`;
  if (style.underline) result = `<u>${result}</u>`;

  const css = [];

  if (preserveFontSize && style.fontSize !== null) css.push(`font-size:${style.fontSize}px`);
  if (style.color) css.push(`color:${style.color}`);
  if (style.backgroundColor) css.push(`background-color:${style.backgroundColor}`);

  if (css.length) result = `<span style="${css.join(";")}">${result}</span>`;

  return result;
}

function needsHtml(style, preserveFontSize) {
  return Boolean(
    preserveFontSize
    || style.color
    || style.backgroundColor
    || style.underline
  );
}

function renderMarkdownLink(content, link) {
  const href = escapeMarkdownUrl(link.href);
  const title = link.title ? ` "${escapeMarkdownTitle(link.title)}"` : "";

  return `[${content}](${href}${title})`;
}

function renderHtmlLink(content, link) {
  let attrs = `href="${escapeHtmlAttribute(link.href)}"`;

  if (link.target) attrs += ` target="${escapeHtmlAttribute(link.target)}"`;
  if (link.title) attrs += ` title="${escapeHtmlAttribute(link.title)}"`;

  return `<a ${attrs}>${content}</a>`;
}

function shouldPreserveRunFontSize(run, context) {
  if (run.type !== "text" || run.style.fontSize === null) return false;
  if (context.heading) return false;

  if (context.checkbox) return run.style.fontSize !== 13;
  if (context.mixed) return true;

  return [11, 34, 38].includes(run.style.fontSize);
}

function stripLink(style) {
  return { ...style, link: null };
}

function paragraphNeedsHtml(runs, context) {
  return runs.some((run) => {
    if (run.type !== "text") return false;
    return needsHtml(stripLink(run.style), shouldPreserveRunFontSize(run, context));
  });
}

function groupRunsByLink(runs) {
  const groups = [];
  let current = null;

  for (const run of runs) {
    if (run.type === "break") {
      groups.push({ type: "break" });
      current = null;
      continue;
    }

    const link = run.style.link;

    if (!link?.href) {
      if (current?.type === "plain") {
        current.runs.push(run);
      } else {
        current = { type: "plain", runs: [run] };
        groups.push(current);
      }

      continue;
    }

    if (current?.type === "link" && sameLink(current.link, link)) {
      current.runs.push(run);
      continue;
    }

    current = {
      type: "link",
      link: { ...link },
      runs: [run],
    };

    groups.push(current);
  }

  return groups;
}

function renderMarkdownGroupRuns(runs) {
  return runs.map((run) => renderMarkdownFormatting(run.text, stripLink(run.style))).join("");
}

function renderHtmlGroupRuns(runs, context) {
  return runs.map((run) => {
    const style = stripLink(run.style);
    return renderHtmlFormatting(run.text, style, shouldPreserveRunFontSize(run, context));
  }).join("");
}

function renderGroups(runs, context) {
  const groups = groupRunsByLink(runs);
  const useHtmlFormatting = paragraphNeedsHtml(runs, context);

  return groups.map((group) => {
    if (group.type === "break") return "<br>";

    if (group.type === "plain") {
      return useHtmlFormatting
        ? renderHtmlGroupRuns(group.runs, context)
        : renderMarkdownGroupRuns(group.runs);
    }

    if (useHtmlFormatting) {
      return renderHtmlLink(renderHtmlGroupRuns(group.runs, context), group.link);
    }

    return renderMarkdownLink(renderMarkdownGroupRuns(group.runs), group.link);
  }).join("");
}

function renderParagraph(node) {
  let runs = mergeRuns(collectStyleRuns(node));

  const plainText = runs.filter((run) => run.type === "text").map((run) => run.text).join("");
  const hasBreak = runs.some((run) => run.type === "break");

  if (!plainText.trim() && !hasBreak) return { empty: true, text: "" };

  const paragraphSize = getParagraphFontSize(runs);
  const mixed = hasMixedFontSizes(runs);
  const checkbox = parseCheckbox(runs);
  const heading = !checkbox && !mixed ? getHeadingLevel(paragraphSize) : 0;

  if (checkbox) runs = removeTextPrefix(runs, checkbox.length);

  const context = {
    paragraphSize,
    mixed,
    checkbox: Boolean(checkbox),
    heading,
  };

  const content = renderGroups(runs, context);

  if (checkbox) return { empty: false, text: `${checkbox.indent}- [${checkbox.checked}] ${content}` };
  if (heading) return { empty: false, text: `${"#".repeat(heading)} ${content}` };

  return { empty: false, text: content };
}

function protectTextComponents($, root, store) {
  root.find(".se-component.se-text").each((_, element) => {
    const component = $(element);
    const paragraphs = component.find("p.se-text-paragraph").toArray();

    if (!paragraphs.length) return;

    const blocks = paragraphs.map((paragraph) => {
      const rendered = renderParagraph(paragraph);
      return rendered.empty ? "NAVEREMPTYLINE" : rendered.text;
    });

    const token = store.add(blocks.join("\n\n"));
    component.replaceWith(`<div class="naver-protected">${token}</div>`);
  });

  root.find("p.se-text-paragraph").each((_, element) => {
    const rendered = renderParagraph(element);
    const value = rendered.empty ? "NAVEREMPTYLINE" : rendered.text;
    const token = store.add(value);

    $(element).replaceWith(`<div class="naver-protected">${token}</div>`);
  });
}

function parseYouTubeStart(value) {
  if (!value) return 0;
  if (/^\d+$/.test(String(value))) return Number(value);

  const text = String(value);
  let seconds = 0;

  const h = text.match(/(\d+)h/i);
  const m = text.match(/(\d+)m/i);
  const s = text.match(/(\d+)s/i);

  if (h) seconds += Number(h[1]) * 3600;
  if (m) seconds += Number(m[1]) * 60;
  if (s) seconds += Number(s[1]);

  return seconds;
}

function getYouTubeId(value) {
  const text = String(value || "");

  let match = text.match(/youtube\.com\/watch\?.*?v=([A-Za-z0-9_-]{6,})/i);
  if (match) return match[1];

  match = text.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/i);
  if (match) return match[1];

  match = text.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/i);
  return match ? match[1] : null;
}

function makeYouTubeIframe(id, start = 0) {
  const src = `https://www.youtube.com/embed/${id}${start ? `?start=${start}` : ""}`;

  return `<iframe width="560" height="315" src="${src}" title="YouTube video player" frameborder="0" `
    + `allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" `
    + `allowfullscreen></iframe>`;
}

function protectYouTube($, root, store) {
  root.find("script.__se_module_data").each((_, element) => {
    const script = $(element);
    const raw = script.attr("data-module-v2") || script.attr("data-module");

    if (!raw) return;

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    const serialized = JSON.stringify(data);
    const id = getYouTubeId(serialized);

    if (!id) return;

    const startMatch = serialized.match(/"(?:start|startTime|start_time)"\s*:\s*"?([^",}]+)"?/i);
    const iframe = makeYouTubeIframe(id, startMatch ? parseYouTubeStart(startMatch[1]) : 0);
    const token = store.add(iframe);
    const component = script.closest(".se-component");

    if (component.length) component.replaceWith(`<div class="naver-protected">${token}</div>`);
    else script.replaceWith(`<div class="naver-protected">${token}</div>`);
  });
}

function createTurndown() {
  const turndown = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    strongDelimiter: "**",
  });

  turndown.keep(["iframe", "video", "source", "table", "tr", "td"]);

  turndown.addRule("protected", {
    filter(node) {
      return node.nodeName === "DIV" && node.classList.contains("naver-protected");
    },

    replacement(content, node) {
      return `\n\n${node.textContent}\n\n`;
    },
  });

  turndown.addRule("image", {
    filter: "img",

    replacement(content, node) {
      const src = node.getAttribute("src");
      if (!src) return "";

      const width = node.getAttribute("data-width") || node.getAttribute("width");

      if (width) return `\n\n<img src="${src}" width="${width}" style="max-width:100%; height:auto;">\n\n`;
      return `\n\n![](${src})\n\n`;
    },
  });

  return turndown;
}

function restoreEmptyLines(text) {
  return text
    .replace(/(?:\s*NAVEREMPTYLINE\s*){3,}/g, "\n\n<br>\n<br>\n\n")
    .replace(/(?:\s*NAVEREMPTYLINE\s*){2}/g, "\n\n<br>\n<br>\n\n")
    .replace(/\s*NAVEREMPTYLINE\s*/g, "\n\n<br>\n\n");
}

function cleanMarkdown(text, store) {
  let result = String(text);

  result = result.replace(/\u200b/g, "").replace(/\u00a0/g, " ");
  result = result.replace(/[ \t]+\n/g, "\n");
  result = result.replace(/\n{4,}/g, "\n\n\n").trim();

  result = store.restore(result);
  result = restoreEmptyLines(result);

  return result.trim();
}

async function downloadFile(url, outputPath) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: "https://blog.naver.com/",
    },
  });

  if (!response.ok) throw new Error(`다운로드 실패: ${response.status} ${url}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);

  return {
    contentType: response.headers.get("content-type") || "",
    size: buffer.length,
  };
}

function getImageSource(img) {
  return img.attr("data-lazy-src") || img.attr("data-src") || img.attr("src") || "";
}

function highResolutionImageUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("type", "w2000");
    return parsed.toString();
  } catch {
    return `${url}${url.includes("?") ? "&" : "?"}type=w2000`;
  }
}

async function localizeImages($, root, outputDir) {
  let index = 1;

  for (const element of root.find("img").toArray()) {
    const img = $(element);

    if (img.closest(".se-oglink").length || img.closest(".se-video").length) continue;

    const src = getImageSource(img);
    if (!src || src.startsWith("data:")) continue;

    const number = String(index).padStart(3, "0");
    const temp = path.join(outputDir, `image-${number}.tmp`);

    try {
      const result = await downloadFile(highResolutionImageUrl(src), temp);
      const filename = `image-${number}${getExtension(src, result.contentType)}`;

      fs.renameSync(temp, path.join(outputDir, filename));
      img.attr("src", filename).removeAttr("data-lazy-src").removeAttr("data-src");
      index++;
    } catch {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
      console.warn(`이미지 다운로드 실패: ${src}`);
    }
  }
}

async function protectOgCards($, root, outputDir, store) {
  let index = 1;

  for (const element of root.find(".se-oglink").toArray()) {
    const component = $(element);
    const title = component.find(".se-oglink-title").first().text().trim();
    const description = component.find(".se-oglink-summary").first().text().trim();
    const url = component.find("a").first().attr("href") || "";
    const img = component.find("img").first();

    if (!title && !url) continue;

    let thumbnail = "";

    if (img.length) {
      const src = getImageSource(img);

      if (src) {
        const number = String(index).padStart(3, "0");
        const temp = path.join(outputDir, `thumb-${number}.tmp`);

        try {
          const result = await downloadFile(src, temp);
          thumbnail = `thumb-${number}${getExtension(src, result.contentType)}`;

          fs.renameSync(temp, path.join(outputDir, thumbnail));
          index++;
        } catch {
          if (fs.existsSync(temp)) fs.unlinkSync(temp);
        }
      }
    }

    const image = thumbnail
      ? `<td style="width:120px"><img src="${thumbnail}" style="width:120px; height:auto;"></td>`
      : "";

    const summary = description ? `<br><small>${escapeHtmlText(description)}</small>` : "";

    const html = `<table><tr>${image}<td><a href="${escapeHtmlAttribute(url)}" target="_blank">`
      + `${escapeHtmlText(title || url)}</a>${summary}</td></tr></table>`;

    component.replaceWith(`<div class="naver-protected">${store.add(html)}</div>`);
  }
}

function findVideoMetadata(value) {
  const text = String(value || "");
  const vid = text.match(/"(?:vid|videoId|video_id)"\s*:\s*"([^"]+)"/i);
  const inKey = text.match(/"(?:inKey|inkey|in_key)"\s*:\s*"([^"]+)"/i);

  return vid ? { vid: vid[1], inKey: inKey ? inKey[1] : "" } : null;
}

async function fetchVideoInfo(vid, inKey) {
  const params = new URLSearchParams({ vid });
  if (inKey) params.set("inKey", inKey);

  const response = await fetch(
    `https://apis.naver.com/rmcnmv/rmcnmv/vod/play/v2.0/${vid}?${params}`,
    { headers: { "User-Agent": "Mozilla/5.0", Referer: "https://blog.naver.com/" } },
  );

  if (!response.ok) throw new Error(`Naver VOD API 실패: ${response.status}`);

  return response.json();
}

function findBestMp4(data) {
  const results = [];

  function walk(value) {
    if (!value) return;

    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    if (typeof value !== "object") return;

    const src = value.source || value.url || value.src || "";
    const type = value.type || value.mimeType || value.mime || "";

    if (
      typeof src === "string"
      && src.startsWith("http")
      && (/\.mp4(?:\?|$)/i.test(src) || /video\/mp4/i.test(type))
    ) {
      const width = Number(value.width || value.encodingWidth || value.videoWidth || 0);
      const height = Number(value.height || value.encodingHeight || value.videoHeight || 0);
      const bitrate = Number(value.bitrate || value.videoBitrate || 0);

      results.push({ src, score: width * height * 1000000 + bitrate });
    }

    Object.values(value).forEach(walk);
  }

  walk(data);
  results.sort((a, b) => b.score - a.score);

  return results[0]?.src || "";
}

function findPoster(data) {
  let result = "";

  function walk(value) {
    if (result || !value) return;

    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    if (typeof value !== "object") return;

    for (const [key, child] of Object.entries(value)) {
      if (
        typeof child === "string"
        && child.startsWith("http")
        && /thumbnail|poster|cover/i.test(key)
        && /\.(jpg|jpeg|png|webp)(?:\?|$)/i.test(child)
      ) {
        result = child;
        return;
      }

      walk(child);
    }
  }

  walk(data);
  return result;
}

async function protectNaverVideos($, root, outputDir, store) {
  let index = 1;

  for (const element of root.find(".se-video, .se-component.se-video").toArray()) {
    const component = $(element);
    let metadata = null;

    for (const script of component.find("script").toArray()) {
      const node = $(script);
      const raw = node.attr("data-module-v2") || node.attr("data-module") || node.html() || "";

      metadata = findVideoMetadata(raw);
      if (metadata) break;
    }

    if (!metadata) metadata = findVideoMetadata(component.html() || "");
    if (!metadata) continue;

    try {
      const info = await fetchVideoInfo(metadata.vid, metadata.inKey);
      const videoUrl = findBestMp4(info);

      if (!videoUrl) continue;

      const number = String(index).padStart(3, "0");
      const videoFilename = `video-${number}.mp4`;

      await downloadFile(videoUrl, path.join(outputDir, videoFilename));

      let poster = "";
      const posterUrl = findPoster(info);

      if (posterUrl) {
        const temp = path.join(outputDir, `video-thumb-${number}.tmp`);

        try {
          const result = await downloadFile(posterUrl, temp);
          const filename = `video-thumb-${number}${getExtension(posterUrl, result.contentType)}`;

          fs.renameSync(temp, path.join(outputDir, filename));
          poster = ` poster="${filename}"`;
        } catch {
          if (fs.existsSync(temp)) fs.unlinkSync(temp);
        }
      }

      const html = `<video controls style="width:100%; height:auto;"${poster}>`
        + `<source src="${videoFilename}" type="video/mp4"></video>`;

      component.replaceWith(`<div class="naver-protected">${store.add(html)}</div>`);
      index++;
    } catch {
      console.warn(`동영상 다운로드 실패: ${metadata.vid}`);
    }
  }
}

function getPostTitle($) {
  const selectors = [".se-title-text", ".se-title-text span", ".pcol1 .itemSubjectBoldfont", ".htitle"];

  for (const selector of selectors) {
    const value = $(selector).first().text().trim();
    if (value) return value;
  }

  return $("meta[property='og:title']").attr("content")?.trim() || "untitled";
}

function getPostCategory($) {
  return $(".blog2_series a").first().text().trim() || "uncategorized";
}

function getPostRoot($) {
  let root = $(".se-main-container").first();

  if (!root.length) root = $("#postViewArea").first();
  if (!root.length) root = $(".se3_view").first();

  return root;
}

async function getPost(blogId, logNo) {
  const url = `https://blog.naver.com/PostView.naver?blogId=${encodeURIComponent(blogId)}&logNo=${encodeURIComponent(logNo)}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: `https://blog.naver.com/${blogId}/${logNo}`,
    },
  });

  if (!response.ok) throw new Error(`글 가져오기 실패: HTTP ${response.status}`);

  const html = await response.text();

  fs.writeFileSync("debug-raw.html", html, "utf8");

  const $ = cheerio.load(html);
  const root = getPostRoot($);

  if (!root.length) throw new Error("본문 영역을 찾을 수 없습니다.");

  return {
    $,
    root,
    title: getPostTitle($),
    category: getPostCategory($),
    url: `https://blog.naver.com/${blogId}/${logNo}`,
  };
}

async function convertPost(blogId, logNo) {
  const post = await getPost(blogId, logNo);
  const { $, root } = post;

  const outputDir = path.join("output", safeFilename(post.category), safeFilename(post.title));
  const store = createStore();

  fs.mkdirSync(outputDir, { recursive: true });

  await protectNaverVideos($, root, outputDir, store);
  await protectOgCards($, root, outputDir, store);
  await localizeImages($, root, outputDir);

  protectYouTube($, root, store);
  protectTextComponents($, root, store);

  const turndown = createTurndown();

  let body = turndown.turndown(root.html() || "");
  body = cleanMarkdown(body, store);

  const markdown = `# ${post.title}\n\n> 원본: ${post.url}\n\n${body}\n`;
  const outputPath = path.join(outputDir, "index.md");

  fs.writeFileSync(outputPath, markdown, "utf8");

  return {
    outputPath,
    title: post.title,
    category: post.category,
  };
}

async function main() {
  const input = process.argv.slice(2).join(" ").trim();

  if (!input) {
    console.log("사용법: node main.js https://blog.naver.com/블로그ID/글번호");
    process.exit(1);
  }

  try {
    const { blogId, logNo } = parsePostUrl(input);

    console.log(`blogId: ${blogId}`);
    console.log(`logNo: ${logNo}`);

    const result = await convertPost(blogId, logNo);

    console.log(`제목: ${result.title}`);
    console.log(`카테고리: ${result.category}`);
    console.log(`저장 완료: ${path.resolve(result.outputPath)}`);
  } catch (error) {
    console.error(error.stack || error.message);
    process.exit(1);
  }
}

main();