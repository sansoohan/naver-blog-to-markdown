const fs = require("fs");
const path = require("path");
const {download} = require("./downloader");

function decodeLegacyEucKr(value) {
  const source = String(value || "");
  const bytes = [];

  for (let index = 0; index < source.length; index++) {
    if (source[index] === "%" && /^[0-9a-f]{2}$/i.test(source.slice(index + 1, index + 3))) {
      bytes.push(parseInt(source.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(source.charCodeAt(index));
    }
  }

  return new TextDecoder("euc-kr", {fatal: true}).decode(Buffer.from(bytes));
}

function decodeFilename(value) {
  const source = String(value || "");

  try {
    return decodeURIComponent(source);
  } catch {}

  return decodeLegacyEucKr(source);
}

function safeFilename(value, fallback) {
  let filename;

  try {
    filename = decodeFilename(value);
  } catch {
    return fallback;
  }

  filename = filename
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();

  return filename || fallback;
}

function escapeHtmlText(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlAttribute(value) {
  return escapeHtmlText(value)
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatAttachmentSize(value) {
  const source = String(value || "").trim();
  if (!source) return "";

  const normalized = source.replace(/,/g, "").trim();

  /*
   * 버전 1·2의 attachFileSize처럼
   * 파일 크기가 byte 숫자로만 들어온 경우.
   *
   * 예:
   * 9479 -> 9.3 KB
   */
  if (/^\d+(?:\.\d+)?$/.test(normalized)) {
    const bytes = Number(normalized);

    if (!Number.isFinite(bytes)) return source;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  return source;
}

function getFilenameFromUrl(url, fallback) {
  try {
    const filename = path.posix.basename(new URL(url).pathname);
    return safeFilename(filename, fallback);
  } catch {
    return fallback;
  }
}

function getFilenameFromDisposition(value) {
  if (!value) return "";

  const utf8 = value.match(/filename\*=UTF-8''([^;]+)/i);

  if (utf8) {
    try {
      return decodeFilename(utf8[1]);
    } catch {
      return "";
    }
  }

  const normal = value.match(/filename="?([^";]+)"?/i);

  return normal ? normal[1] : "";
}

function getAttachmentUrl(link) {
  return link.attr("href")
    || link.attr("data-link")
    || link.attr("data-url")
    || link.attr("data-href")
    || "";
}

function getAttachmentName(link, url, index) {
  const fallback = `attachment-${String(index).padStart(3, "0")}`;
  const filename = link.attr("download")
    || link.attr("data-file-name")
    || link.attr("data-filename")
    || link.find(".se-file-name").first().text().trim()
    || link.find(".se-file-name-text").first().text().trim()
    || link.text().trim();

  if (filename) return safeFilename(filename, fallback);

  return getFilenameFromUrl(url, fallback);
}

function getAttachmentSize(link) {
  return link.attr("data-file-size")
    || link.find(".se-file-size").first().text().trim()
    || link.find(".se-file-size-text").first().text().trim()
    || "";
}

function isAttachmentLink(link, url) {
  if (!url) return false;
  if (link.closest(".se-component.se-file, .se-file").length) return true;

  const className = link.attr("class") || "";

  if (/se-file/i.test(className)) return true;
  if (/AttachFile|FileDownload/i.test(url)) return true;
  if (/download/i.test(url) && /naver/i.test(url)) return true;

  return false;
}

async function downloadAttachment(url, downloadDir, preferredName, fallbackName) {
  const result = await download(url, {
    outputDir: downloadDir,
    fallbackFilename: fallbackName,
    logLabel: "첨부파일",
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: "https://blog.naver.com/",
    },
    redirect: "follow",
    resolveFilename: ({response}) => {
      const disposition = response.headers.get("content-disposition") || "";
      const dispositionName = getFilenameFromDisposition(disposition);
      const filename = dispositionName
        || preferredName
        || getFilenameFromUrl(response.url || url, fallbackName);

      return safeFilename(filename, fallbackName);
    },
  });

  return result.filename;
}

function makeAttachmentHref(filename) {
  return `./download/${encodeURI(filename).replace(/#/g, "%23")}`;
}

function makeAttachmentCard(filename, size = "", source = "") {
  const name = escapeHtmlText(filename);
  const href = escapeHtmlAttribute(makeAttachmentHref(filename));
  const formattedSize = formatAttachmentSize(size);
  const sizeHtml = formattedSize
    ? `<span style="font-size:13px;opacity:0.6;margin-left:auto;">${escapeHtmlText(formattedSize)}</span>`
    : "";

  const sourceAttr = source ? `data-naver-source="${escapeHtmlAttribute(source)}" ` : "";

  return `<a class="naver-local-attachment" href="${href}" download `
    + `data-file-name="${escapeHtmlAttribute(filename)}" `
    + `data-file-size="${escapeHtmlAttribute(formattedSize)}" `
    + sourceAttr
    + `style="display:flex;align-items:center;gap:10px;margin:12px 0;padding:14px 16px;`
    + `border:1px solid #ddd;border-radius:6px;text-decoration:none;color:inherit;">`
    + `<span>⬇️</span><strong>${name}</strong>${sizeHtml}</a>`;
}

function normalizeLocalPath(value) {
  const href = String(value || "").trim();

  if (!href) return "";
  if (/^\.\/download\//i.test(href)) return href;
  if (/^download\//i.test(href)) return `./${href}`;

  return href;
}

function makeAttachmentMarkdown(filename, href, size = "") {
  const name = escapeHtmlText(filename);
  const url = escapeHtmlAttribute(normalizeLocalPath(href));
  const formattedSize = formatAttachmentSize(size);

  return `⬇️ <a href="${url}" download>${name}</a>${formattedSize ? ` · ${formattedSize}` : ""}`;
}

function makeAttachmentMarkdownBlock(items) {
  return [
    "---",
    "",
    items
      .map(item => makeAttachmentMarkdown(item.filename, item.href, item.size))
      .join("\n\n"),
    "",
    "---",
  ].join("\n");
}

function getVersion12AttachmentEntries($) {
  const entries = [];
  const seen = new Set();
  const html = $.html() || "";

  /*
   * 버전 1·2:
   *
   * 첨부파일 다운로드 버튼이 본문 안에 존재하지 않는다.
   * aPostFiles script 데이터에서 첨부파일 정보를 얻는다.
   */
  const pattern = /aPostFiles\[\d+\]\s*=\s*JSON\.parse\(\s*'((?:\\.|[^'])*)'/g;
  let match;

  while ((match = pattern.exec(html))) {
    let files;

    try {
      files = JSON.parse(match[1].replace(/\\'/g, "'"));
    } catch {
      continue;
    }

    if (!Array.isArray(files)) continue;

    for (const file of files) {
      const url = String(
        file.encodedAttachFileUrl
        || file.encodedAttachFileUrlByMS949
        || file.attachFileUrl
        || ""
      ).trim();

      if (!url || seen.has(url)) continue;

      seen.add(url);

      entries.push({
        url,
        name: String(
          file.encodedAttachFileName
          || file.encodedAttachFileNameByTruncate
          || file.encodedAttachFileNameByUTF8
          || ""
        ).trim(),
        size: String(file.attachFileSize || "").trim(),
      });
    }
  }

  return entries;
}

async function getDownloadedAttachment(url, downloadDir, preferredName, fallbackName, downloaded) {
  if (downloaded.has(url)) return downloaded.get(url);

  fs.mkdirSync(downloadDir, {recursive: true});

  const filename = await downloadAttachment(url, downloadDir, preferredName, fallbackName);
  downloaded.set(url, filename);

  return filename;
}

async function localizeVersion12Attachments($, root, downloadDir, downloaded, handledUrls, indexStart) {
  const cards = [];
  let index = indexStart;

  for (const entry of getVersion12AttachmentEntries($)) {
    if (handledUrls.has(entry.url)) continue;

    index++;

    const fallbackName = `attachment-${String(index).padStart(3, "0")}`;
    const preferredName = safeFilename(entry.name, fallbackName);
    let filename;

    try {
      filename = await getDownloadedAttachment(
        entry.url,
        downloadDir,
        preferredName,
        fallbackName,
        downloaded
      );
    } catch (error) {
      console.warn(`첨부파일 다운로드 실패: ${entry.url} - ${error.message}`);
      continue;
    }

    handledUrls.add(entry.url);
    cards.push(makeAttachmentCard(filename, entry.size, entry.url));

    console.log(`버전 1·2 첨부파일 로컬화 완료: ${filename}`);
  }

  if (cards.length) root.prepend(`<div class="naver-version12-attachments">${cards.join("")}</div>`);

  return index;
}

async function localizeVersion34Attachments($, root, downloadDir, downloaded, handledUrls) {
  let index = 0;

  /*
   * 버전 3·4:
   *
   * 원래 다운로드 버튼이 있던 위치에서
   * 로컬 다운로드 카드로 교체한다.
   */
  for (const element of root.find("a").toArray()) {
    const link = $(element);
    const url = getAttachmentUrl(link);

    if (!isAttachmentLink(link, url)) continue;
    if (/^(?:\.\/)?download\//i.test(url)) continue;

    index++;

    const fallbackName = `attachment-${String(index).padStart(3, "0")}`;
    const preferredName = getAttachmentName(link, url, index);
    const size = getAttachmentSize(link);
    let filename;

    try {
      filename = await getDownloadedAttachment(
        url,
        downloadDir,
        preferredName,
        fallbackName,
        downloaded
      );
    } catch (error) {
      console.warn(`첨부파일 다운로드 실패: ${url} - ${error.message}`);
      continue;
    }

    handledUrls.add(url);

    const card = makeAttachmentCard(filename, size, url);
    const component = link.closest(".se-component.se-file, .se-file");

    if (component.length) component.replaceWith(card);
    else link.replaceWith(card);

    console.log(`버전 3·4 첨부파일 로컬화 완료: ${filename}`);
  }
}

function getLocalizedAttachmentName(link, href) {
  const dataName = link.attr("data-file-name");
  if (dataName) return dataName.trim();

  const selectors = [
    ".se-file-name",
    ".se-file-name-text",
    ".se-file-title",
    "strong",
  ];

  for (const selector of selectors) {
    const value = link.find(selector).first().text().trim();
    if (value) return value;
  }

  const text = link.text().replace(/⬇️/g, "").trim();
  if (text) return text;

  try {
    const pathname = new URL(href, "https://local.invalid/").pathname;
    const filename = pathname.split("/").filter(Boolean).pop() || "";

    return decodeFilename(filename);
  } catch {
    const filename = href.split(/[\\/]/).pop() || "";

    try {
      return decodeFilename(filename);
    } catch {
      return filename;
    }
  }
}

function getLocalizedAttachmentSize(link) {
  const dataSize = link.attr("data-file-size");
  if (dataSize) return dataSize.trim();

  return link.find(".se-file-size, .se-file-size-text").first().text().trim();
}

function getLocalizedAttachment(link) {
  const href = normalizeLocalPath(link.attr("href"));
  if (!/^\.\/download\//i.test(href)) return null;

  return {
    href,
    filename: getLocalizedAttachmentName(link, href),
    size: getLocalizedAttachmentSize(link),
    source: String(link.attr("data-naver-source") || "").trim(),
  };
}

async function localizeAttachments($, root, outputDir, options = {}) {
  const editorVersion = Number(options.editorVersion) || 0;

  const downloadDir = path.join(outputDir, "download");
  const downloaded = new Map();
  const handledUrls = new Set();

  /*
   * 버전 1·2:
   *
   * 본문 안의 다운로드 버튼을 처리하지 않는다.
   * aPostFiles script 데이터에서 첨부파일을 추출하고
   * 본문 맨 위에 별도의 첨부파일 영역을 만든다.
   */
  if (editorVersion === 1 || editorVersion === 2) {
    await localizeVersion12Attachments($, root, downloadDir, downloaded, handledUrls, 0);
    return;
  }

  /*
   * 버전 3·4:
   *
   * aPostFiles를 사용하지 않는다.
   * 본문 맨 위에 첨부파일 영역을 만들지 않는다.
   *
   * 본문 중간에 원래 존재하는 다운로드 버튼만
   * 그 위치에서 로컬 다운로드 카드로 교체한다.
   */
  if (editorVersion === 3 || editorVersion === 4) {
    await localizeVersion34Attachments($, root, downloadDir, downloaded, handledUrls);
    return;
  }

  console.warn("첨부파일 로컬화 건너뜀: 에디터 버전을 확인할 수 없습니다.");
}

function protectVersion12Attachments($, root, store) {
  /*
   * 버전 1·2:
   *
   * localizeVersion12Attachments()에서 본문 맨 위에 만든
   * .naver-version12-attachments 전체를
   * 하나의 Markdown 첨부파일 영역으로 바꾼다.
   */
  for (const element of root.find(".naver-version12-attachments").toArray()) {
    const group = $(element);
    const links = group.find("a.naver-local-attachment").toArray();
    const items = [];
    const seen = new Set();

    for (const linkElement of links) {
      const link = $(linkElement);
      const item = getLocalizedAttachment(link);

      if (!item) continue;
      if (seen.has(item.href)) continue;

      seen.add(item.href);
      items.push(item);
    }

    if (!items.length) continue;

    const markdown = makeAttachmentMarkdownBlock(items);
    group.replaceWith(`<div class="naver-protected">${store.add(markdown)}</div>`);
  }
}

function protectVersion34Attachments($, root, store) {
  /*
   * 버전 3·4:
   *
   * original.html에서 원본 다운로드 버튼과 같은 위치에
   * a.naver-local-attachment가 존재한다.
   *
   * 따라서 위치를 전혀 변경하지 않고,
   * 각각의 다운로드 버튼이 있던 바로 그 위치에서
   * Markdown 첨부파일 영역으로 치환한다.
   */
  const links = root.find("a.naver-local-attachment").toArray();

  for (const element of links) {
    const link = $(element);

    if (link.closest(".naver-version12-attachments").length) continue;
    if (link.closest(".naver-protected").length) continue;

    const item = getLocalizedAttachment(link);
    if (!item) continue;

    const markdown = makeAttachmentMarkdownBlock([item]);
    link.replaceWith(`<div class="naver-protected">${store.add(markdown)}</div>`);
  }
}

function protectAttachments($, root, store) {
  protectVersion12Attachments($, root, store);
  protectVersion34Attachments($, root, store);
}

module.exports = {
  localizeAttachments,
  protectAttachments,
};
