const fs=require("fs");
const path=require("path");

function decodeLegacyEucKr(value) {
  const source=String(value||"");
  const bytes=[];

  for(let index=0;index<source.length;index++) {
    if(source[index]==="%"&&/^[0-9a-f]{2}$/i.test(source.slice(index+1,index+3))) {
      bytes.push(parseInt(source.slice(index+1,index+3),16));
      index+=2;
    } else {
      bytes.push(source.charCodeAt(index));
    }
  }

  return new TextDecoder("euc-kr",{fatal:true}).decode(Buffer.from(bytes));
}

function decodeFilename(value) {
  const source=String(value||"");

  try {
    return decodeURIComponent(source);
  } catch {}

  return decodeLegacyEucKr(source);
}

function safeFilename(value,fallback) {
  let filename;

  try {
    filename=decodeFilename(value);
  } catch {
    return fallback;
  }

  filename=filename.replace(/[<>:"/\\|?*\x00-\x1F]/g,"_").replace(/[. ]+$/g,"").trim();
  return filename||fallback;
}

function escapeHtmlText(value) {
  return String(value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function escapeHtmlAttribute(value) {
  return escapeHtmlText(value).replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

function getFilenameFromUrl(url,fallback) {
  try {
    return safeFilename(path.posix.basename(new URL(url).pathname),fallback);
  } catch {
    return fallback;
  }
}

function getUniqueFilename(downloadDir,filename) {
  const ext=path.extname(filename);
  const base=path.basename(filename,ext);
  let result=filename;
  let index=2;

  while(fs.existsSync(path.join(downloadDir,result))) {
    result=`${base}_${index}${ext}`;
    index++;
  }

  return result;
}

function getFilenameFromDisposition(value) {
  if(!value) return "";

  const utf8=value.match(/filename\*=UTF-8''([^;]+)/i);

  if(utf8) {
    try {
      return decodeFilename(utf8[1]);
    } catch {
      return "";
    }
  }

  const normal=value.match(/filename="?([^";]+)"?/i);
  return normal?normal[1]:"";
}

function getAttachmentUrl(link) {
  return link.attr("href")||link.attr("data-link")||link.attr("data-url")||link.attr("data-href")||"";
}

function getAttachmentName(link,url,index) {
  const fallback=`attachment-${String(index).padStart(3,"0")}`;
  const filename=link.attr("download")
    ||link.attr("data-file-name")
    ||link.attr("data-filename")
    ||link.find(".se-file-name").first().text().trim()
    ||link.find(".se-file-name-text").first().text().trim()
    ||link.text().trim();

  if(filename) return safeFilename(filename,fallback);
  return getFilenameFromUrl(url,fallback);
}

function getAttachmentSize(link) {
  return link.attr("data-file-size")
    ||link.find(".se-file-size").first().text().trim()
    ||link.find(".se-file-size-text").first().text().trim()
    ||"";
}

function isAttachmentLink(link,url) {
  if(!url) return false;
  if(link.closest(".se-component.se-file, .se-file").length) return true;

  const className=link.attr("class")||"";

  if(/se-file/i.test(className)) return true;
  if(/AttachFile|FileDownload/i.test(url)) return true;
  if(/download/i.test(url)&&/naver/i.test(url)) return true;

  return false;
}

async function downloadAttachment(url,downloadDir,preferredName,fallbackName) {
  const response=await fetch(url,{
    headers:{"User-Agent":"Mozilla/5.0",Referer:"https://blog.naver.com/"},
    redirect:"follow",
  });

  if(!response.ok) throw new Error(`첨부파일 다운로드 실패: ${response.status} ${url}`);

  const disposition=response.headers.get("content-disposition")||"";
  const dispositionName=getFilenameFromDisposition(disposition);
  let filename=dispositionName||preferredName||getFilenameFromUrl(response.url||url,fallbackName);

  filename=safeFilename(filename,fallbackName);
  filename=getUniqueFilename(downloadDir,filename);

  const buffer=Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(path.join(downloadDir,filename),buffer);

  return filename;
}

function makeAttachmentHref(filename) {
  return `./download/${encodeURI(filename).replace(/#/g,"%23")}`;
}

/*
 * SmartEditor 3.0
 */
function makeAttachmentCard(filename,size="") {
  const name=escapeHtmlText(filename);
  const href=escapeHtmlAttribute(makeAttachmentHref(filename));
  const sizeHtml=size
    ?`<span style="font-size:13px;opacity:0.6;margin-left:auto;">${escapeHtmlText(size)}</span>`
    :"";

  return `<a class="naver-local-attachment" href="${href}" `
    +`data-file-name="${escapeHtmlAttribute(filename)}" data-file-size="${escapeHtmlAttribute(size)}" `
    +`style="display:flex;align-items:center;gap:10px;margin:12px 0;padding:14px 16px;`
    +`border:1px solid #ddd;border-radius:6px;text-decoration:none;color:inherit;">`
    +`<span>📎</span><strong>${name}</strong>${sizeHtml}</a>`;
}

/*
 * SmartEditor 1.x / 2.0
 *
 * 3.0의 makeAttachmentCard()와 별도로 사용한다.
 */
function makeLegacyAttachmentCard(filename,size="") {
  const name=escapeHtmlText(filename);
  const href=escapeHtmlAttribute(makeAttachmentHref(filename));
  const safeName=escapeHtmlAttribute(filename);
  const safeSize=escapeHtmlAttribute(size);

  const sizeHtml=size
    ?`<span class="naver-legacy-attachment-size" style="font-size:12px;color:#888;">`
      +`${escapeHtmlText(size)}</span>`
    :"";

  return `<div class="naver-legacy-local-attachment" data-file-name="${safeName}" data-file-size="${safeSize}" `
    +`style="display:flex;align-items:center;gap:12px;margin:12px 0;padding:14px 16px;`
    +`border:1px solid #ddd;border-radius:6px;">`
    +`<span style="font-size:18px;flex:0 0 auto;">📎</span>`
    +`<div style="display:flex;flex-direction:column;gap:4px;min-width:0;flex:1;">`
    +`<a class="naver-legacy-attachment-name" href="${href}" download="${safeName}" `
    +`style="font-weight:bold;text-decoration:none;color:inherit;overflow-wrap:anywhere;">${name}</a>`
    +`${sizeHtml}</div>`
    +`<a class="naver-legacy-attachment-download" href="${href}" download="${safeName}" `
    +`style="flex:0 0 auto;padding:7px 12px;border:1px solid #ccc;border-radius:5px;`
    +`text-decoration:none;color:inherit;font-size:13px;white-space:nowrap;">다운로드</a>`
    +`</div>`;
}

function getLegacyAttachmentEntries($) {
  const entries=[];
  const seen=new Set();
  const html=$.html()||"";

  /*
   * SmartEditor 1.x / 2.0:
   *
   * aPostFiles[1] = JSON.parse('[{...}]'.replace(/\\'/g, ''));
   */
  const pattern=/aPostFiles\[\d+\]\s*=\s*JSON\.parse\(\s*'((?:\\.|[^'])*)'/g;
  let match;

  while((match=pattern.exec(html))) {
    let files;

    try {
      files=JSON.parse(match[1].replace(/\\'/g,"'"));
    } catch {
      continue;
    }

    if(!Array.isArray(files)) continue;

    for(const file of files) {
      const url=String(
        file.encodedAttachFileUrl||file.encodedAttachFileUrlByMS949||file.attachFileUrl||""
      ).trim();

      if(!url||seen.has(url)) continue;

      seen.add(url);

      entries.push({
        url,
        name:String(
          file.encodedAttachFileName
          ||file.encodedAttachFileNameByTruncate
          ||file.encodedAttachFileNameByUTF8
          ||""
        ).trim(),
        size:String(file.attachFileSize||"").trim(),
      });
    }
  }

  return entries;
}

async function getDownloadedAttachment(url,downloadDir,preferredName,fallbackName,downloaded) {
  if(downloaded.has(url)) return downloaded.get(url);

  fs.mkdirSync(downloadDir,{recursive:true});

  const filename=await downloadAttachment(url,downloadDir,preferredName,fallbackName);
  downloaded.set(url,filename);

  return filename;
}

/*
 * SmartEditor 1.x / 2.0
 *
 * aPostFiles[]에서 파일을 찾아 다운로드한 뒤
 * original.html의 실제 본문 root 안에 넣는다.
 */
async function localizeLegacyAttachments($,root,downloadDir,downloaded,handledUrls,indexStart) {
  const cards=[];
  let index=indexStart;

  for(const entry of getLegacyAttachmentEntries($)) {
    if(handledUrls.has(entry.url)) continue;

    index++;

    const fallbackName=`attachment-${String(index).padStart(3,"0")}`;
    const preferredName=safeFilename(entry.name,fallbackName);
    let filename;

    try {
      filename=await getDownloadedAttachment(entry.url,downloadDir,preferredName,fallbackName,downloaded);
    } catch(error) {
      console.warn(`구형 첨부파일 다운로드 실패: ${entry.url} - ${error.message}`);
      continue;
    }

    handledUrls.add(entry.url);
    cards.push(makeLegacyAttachmentCard(filename,entry.size));

    console.log(`구형 첨부파일 로컬화 완료: ${filename}`);
  }

  /*
   * 중요:
   *
   * aPostFiles[] 자체는 script에 있지만 Markdown 생성 시 script는 제거된다.
   * 따라서 여기서 반드시 실제 본문 root 안에 첨부파일 HTML을 삽입한다.
   */
  if(cards.length) {
    root.prepend(`<div class="naver-legacy-attachments">${cards.join("")}</div>`);
    console.log(`구형 첨부파일 ${cards.length}개를 본문에 삽입했습니다.`);
  }

  return index;
}

/*
 * SmartEditor 3.0 + SmartEditor 1.x / 2.0
 */
async function localizeAttachments($,root,outputDir) {
  const downloadDir=path.join(outputDir,"download");
  const downloaded=new Map();
  const handledUrls=new Set();
  let index=0;

  /*
   * SmartEditor 3.0
   */
  for(const element of root.find("a").toArray()) {
    const link=$(element);
    const url=getAttachmentUrl(link);

    if(!isAttachmentLink(link,url)) continue;
    if(/^(?:\.\/)?download\//i.test(url)) continue;

    index++;

    const fallbackName=`attachment-${String(index).padStart(3,"0")}`;
    const preferredName=getAttachmentName(link,url,index);
    const size=getAttachmentSize(link);
    let filename;

    try {
      filename=await getDownloadedAttachment(url,downloadDir,preferredName,fallbackName,downloaded);
    } catch(error) {
      console.warn(`첨부파일 다운로드 실패: ${url} - ${error.message}`);
      continue;
    }

    handledUrls.add(url);

    const card=makeAttachmentCard(filename,size);
    const component=link.closest(".se-component.se-file, .se-file");

    if(component.length) component.replaceWith(card);
    else link.replaceWith(card);

    console.log(`첨부파일 로컬화 완료: ${filename}`);
  }

  /*
   * SmartEditor 1.x / 2.0
   */
  await localizeLegacyAttachments($,root,downloadDir,downloaded,handledUrls,index);
}

function normalizeLocalPath(value) {
  const href=String(value||"").trim();

  if(!href) return "";
  if(/^\.\/download\//i.test(href)) return href;
  if(/^download\//i.test(href)) return `./${href}`;

  return href;
}

function getLocalizedAttachmentName(link,href) {
  const dataName=link.attr("data-file-name");

  if(dataName) return dataName.trim();

  const selectors=[
    ".se-file-name",
    ".se-file-name-text",
    ".se-file-title",
    ".naver-legacy-attachment-name",
    "strong",
  ];

  for(const selector of selectors) {
    const value=link.find(selector).first().text().trim();
    if(value) return value;
  }

  const text=link.text().replace(/📎/g,"").replace(/다운로드/g,"").trim();

  if(text) return text;

  try {
    const pathname=new URL(href,"https://local.invalid/").pathname;
    const filename=pathname.split("/").filter(Boolean).pop()||"";

    return decodeFilename(filename);
  } catch {
    const filename=href.split(/[\\/]/).pop()||"";

    try {
      return decodeFilename(filename);
    } catch {
      return filename;
    }
  }
}

function getLocalizedAttachmentSize(link) {
  const dataSize=link.attr("data-file-size");

  if(dataSize) return dataSize.trim();

  return link.find(".se-file-size, .se-file-size-text, .naver-legacy-attachment-size").first().text().trim();
}

/*
 * SmartEditor 3.0 Markdown 보호
 */
function protectAttachmentLink($,link,store) {
  const href=normalizeLocalPath(link.attr("href"));

  if(!/^\.\/download\//i.test(href)) return false;

  const filename=getLocalizedAttachmentName(link,href);
  const size=getLocalizedAttachmentSize(link);
  const card=makeAttachmentCard(filename,size);
  const component=link.closest(".se-component.se-file, .se-file");

  if(component.length) component.replaceWith(`<div class="naver-protected">${store.add(card)}</div>`);
  else link.replaceWith(`<div class="naver-protected">${store.add(card)}</div>`);

  return true;
}

/*
 * SmartEditor 1.x / 2.0 Markdown 보호
 *
 * 구형 첨부파일 영역 전체를 하나의 HTML 블록으로 보호한다.
 * 내부 다운로드 링크를 Turndown에 넘기지 않는다.
 */
function protectLegacyAttachments($,root,store) {
  const containers=root.find(".naver-legacy-attachments").toArray();

  for(const element of containers) {
    const container=$(element);

    if(container.closest(".naver-protected").length) continue;

    const html=$.html(element);

    container.replaceWith(
      `<div class="naver-protected">${store.add(html)}</div>`
    );
  }
}

function protectAttachments($,root,store) {
  /*
   * 반드시 구형 첨부파일부터 보호한다.
   *
   * 그렇지 않으면 내부의 ./download/... 링크를
   * SmartEditor 3.0 첨부파일로 다시 처리할 수 있다.
   */
  protectLegacyAttachments($,root,store);

  /*
   * SmartEditor 3.0
   */
  const links=root.find([
    "a.naver-local-attachment",
    "a[href^='./download/']",
    "a[href^='download/']",
  ].join(", ")).toArray();

  for(const element of links) {
    const link=$(element);

    if(link.closest(".naver-protected").length) continue;
    if(link.closest(".naver-legacy-attachments").length) continue;

    protectAttachmentLink($,link,store);
  }
}

module.exports={
  localizeAttachments,
  protectAttachments,
};
