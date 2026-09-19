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

  if (filename) return safeFilename(filename, `attachment-${String(index).padStart(3, "0")}`);

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

  if (!response.ok) throw new Error(`첨부파일 다운로드 실패: ${response.status} ${url}`);

  const disposition = response.headers.get("content-disposition") || "";
  const dispositionName = getFilenameFromDisposition(disposition);

  let filename = dispositionName || preferredName || getFilenameFromUrl(response.url || url, fallbackName);

  filename = safeFilename(filename, fallbackName);
  filename = getUniqueFilename(downloadDir, filename);

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(path.join(downloadDir, filename), buffer);

  return filename;
}

function makeAttachmentCard(filename, size) {
  const name = escapeHtmlText(filename);
  const href = escapeHtmlAttribute(`./download/${encodeURI(filename).replace(/#/g, "%23")}`);
  const sizeHtml = size ? `<span style="font-size:13px;opacity:0.6;margin-left:auto;">${escapeHtmlText(size)}</span>` : "";

  return `<a href="${href}" style="display:flex;align-items:center;gap:10px;margin:12px 0;padding:14px 16px;border:1px solid #ddd;border-radius:6px;text-decoration:none;color:inherit;"><span>📎</span><strong>${name}</strong>${sizeHtml}</a>`;
}

async function protectAttachments($, root, outputDir, store) {
  const downloadDir = path.join(outputDir, "download");
  const downloaded = new Map();

  let index = 0;

  for (const element of root.find("a").toArray()) {
    const link = $(element);
    const url = getAttachmentUrl(link);

    if (!isAttachmentLink(link, url)) continue;

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

        filename = await downloadAttachment(url, downloadDir, preferredName, fallbackName);
        downloaded.set(url, filename);
      }
    } catch {
      console.warn(`첨부파일 다운로드 실패: ${url}`);
      continue;
    }

    const card = makeAttachmentCard(filename, size);
    const component = link.closest(".se-component.se-file, .se-file");

    if (component.length) {
      component.replaceWith(`<div class="naver-protected">${store.add(card)}</div>`);
    } else {
      link.replaceWith(`<div class="naver-protected">${store.add(card)}</div>`);
    }
  }
}

module.exports = {
  protectAttachments,
};
