const fs = require("fs");
const path = require("path");

function safeFilename(value, fallback) {
  let filename;

  try {
    filename = decodeURIComponent(String(value));
  } catch {
    filename = String(value);
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

function getFilenameFromUrl(url, fallback) {
  try {
    const filename = path.posix.basename(new URL(url).pathname);
    return safeFilename(filename, fallback);
  } catch {
    return fallback;
  }
}

function getUniqueFilename(downloadDir, filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);

  let result = filename;
  let index = 2;

  while (fs.existsSync(path.join(downloadDir, result))) {
    result = `${base}_${index}${ext}`;
    index++;
  }

  return result;
}

function getFilenameFromDisposition(value) {
  if (!value) return "";

  const utf8 = value.match(/filename\*=UTF-8''([^;]+)/i);

  if (utf8) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      return utf8[1];
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
  const filename = link.attr("download")
    || link.attr("data-file-name")
    || link.attr("data-filename")
    || link.find(".se-file-name").first().text().trim()
    || link.find(".se-file-name-text").first().text().trim()
    || link.text().trim();

  if (filename) {
    return safeFilename(filename, `attachment-${String(index).padStart(3, "0")}`);
  }

  return getFilenameFromUrl(url, `attachment-${String(index).padStart(3, "0")}`);
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
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: "https://blog.naver.com/",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`첨부파일 다운로드 실패: ${response.status} ${url}`);
  }

  const disposition = response.headers.get("content-disposition") || "";
  const dispositionName = getFilenameFromDisposition(disposition);

  let filename = dispositionName
    || preferredName
    || getFilenameFromUrl(response.url || url, fallbackName);

  filename = safeFilename(filename, fallbackName);
  filename = getUniqueFilename(downloadDir, filename);

  const buffer = Buffer.from(await response.arrayBuffer());

  fs.writeFileSync(path.join(downloadDir, filename), buffer);

  return filename;
}

function makeAttachmentHref(filename) {
  return `./download/${encodeURI(filename).replace(/#/g, "%23")}`;
}

function makeAttachmentCard(filename, size = "") {
  const name = escapeHtmlText(filename);
  const href = escapeHtmlAttribute(makeAttachmentHref(filename));

  const sizeHtml = size
    ? `<span style="font-size:13px;opacity:0.6;margin-left:auto;">${escapeHtmlText(size)}</span>`
    : "";

  return `<a class="naver-local-attachment" href="${href}" data-file-name="${escapeHtmlAttribute(filename)}" data-file-size="${escapeHtmlAttribute(size)}" style="display:flex;align-items:center;gap:10px;margin:12px 0;padding:14px 16px;border:1px solid #ddd;border-radius:6px;text-decoration:none;color:inherit;"><span>📎</span><strong>${name}</strong>${sizeHtml}</a>`;
}

async function localizeAttachments($, root, outputDir) {
  const downloadDir = path.join(outputDir, "download");
  const downloaded = new Map();

  let index = 0;

  for (const element of root.find("a").toArray()) {
    const link = $(element);
    const url = getAttachmentUrl(link);

    if (!isAttachmentLink(link, url)) continue;

    /*
     * 이미 로컬화된 첨부파일이면 다시 다운로드하지 않는다.
     */
    if (/^(?:\.\/)?download\//i.test(url)) continue;

    index++;

    const fallbackName = `attachment-${String(index).padStart(3, "0")}`;
    const preferredName = getAttachmentName(link, url, index);
    const size = getAttachmentSize(link);

    let filename;

    try {
      if (downloaded.has(url)) {
        filename = downloaded.get(url);
      } else {
        fs.mkdirSync(downloadDir, { recursive: true });

        filename = await downloadAttachment(
          url,
          downloadDir,
          preferredName,
          fallbackName
        );

        downloaded.set(url, filename);
      }
    } catch (error) {
      console.warn(`첨부파일 다운로드 실패: ${url} - ${error.message}`);
      continue;
    }

    const card = makeAttachmentCard(filename, size);
    const component = link.closest(".se-component.se-file, .se-file");

    /*
     * original.html에는 naver-protected를 넣지 않는다.
     * 이 파일이 canonical HTML이므로 실제 로컬 첨부파일 카드를 저장한다.
     */
    if (component.length) {
      component.replaceWith(card);
    } else {
      link.replaceWith(card);
    }

    console.log(`첨부파일 로컬화 완료: ${filename}`);
  }
}

function normalizeLocalPath(value) {
  const href = String(value || "").trim();

  if (!href) return "";

  if (/^\.\/download\//i.test(href)) return href;
  if (/^download\//i.test(href)) return `./${href}`;

  return href;
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

  const text = link.text()
    .replace(/📎/g, "")
    .trim();

  if (text) return text;

  try {
    const pathname = new URL(href, "https://local.invalid/").pathname;
    const filename = pathname.split("/").filter(Boolean).pop() || "";

    return decodeURIComponent(filename);
  } catch {
    const filename = href.split(/[\\/]/).pop() || "";

    try {
      return decodeURIComponent(filename);
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

function protectAttachmentLink($, link, store) {
  const href = normalizeLocalPath(link.attr("href"));

  if (!/^\.\/download\//i.test(href)) return false;

  const filename = getLocalizedAttachmentName(link, href);
  const size = getLocalizedAttachmentSize(link);
  const card = makeAttachmentCard(filename, size);

  const component = link.closest(".se-component.se-file, .se-file");

  if (component.length) {
    component.replaceWith(`<div class="naver-protected">${store.add(card)}</div>`);
  } else {
    link.replaceWith(`<div class="naver-protected">${store.add(card)}</div>`);
  }

  return true;
}

function protectAttachments($, root, store) {
  /*
   * Markdown 단계.
   *
   * 여기서는 다운로드하지 않는다.
   * original.html에 이미 존재하는 ./download/... 링크만 읽는다.
   */

  const links = root.find([
    "a.naver-local-attachment",
    "a[href^='./download/']",
    "a[href^='download/']",
  ].join(", ")).toArray();

  for (const element of links) {
    const link = $(element);

    if (link.closest(".naver-protected").length) continue;

    protectAttachmentLink($, link, store);
  }
}

module.exports = {
  localizeAttachments,
  protectAttachments,
};
