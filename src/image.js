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

  filename=filename
    .replace(/[<>:"/\\|?*\x00-\x1F]/g,"_")
    .replace(/[. ]+$/g,"")
    .trim();

  return filename||fallback;
}

function getFilenameFromUrl(url,fallback) {
  try {
    const filename=path.posix.basename(new URL(url).pathname);

    return safeFilename(filename,fallback);
  } catch {
    return fallback;
  }
}

function getUniqueFilename(outputDir,filename) {
  const ext=path.extname(filename);
  const base=path.basename(filename,ext);
  let result=filename;
  let index=2;

  while(fs.existsSync(path.join(outputDir,result))) {
    result=`${base}_${index}${ext}`;
    index++;
  }

  return result;
}

function getExtensionFromContentType(contentType,fallback=".jpg") {
  if(/image\/jpeg/i.test(contentType)) return ".jpg";
  if(/image\/png/i.test(contentType)) return ".png";
  if(/image\/gif/i.test(contentType)) return ".gif";
  if(/image\/webp/i.test(contentType)) return ".webp";
  if(/image\/bmp/i.test(contentType)) return ".bmp";
  if(/image\/svg\+xml/i.test(contentType)) return ".svg";
  if(/image\/avif/i.test(contentType)) return ".avif";

  return fallback;
}

function getExtensionFromBuffer(buffer,contentType="",fallback=".jpg") {
  if(!buffer||buffer.length<4) {
    return getExtensionFromContentType(contentType,fallback);
  }

  const hex=buffer.subarray(0,16).toString("hex");
  const ascii=buffer.subarray(0,16).toString("ascii");

  if(hex.startsWith("ffd8ff")) return ".jpg";
  if(hex.startsWith("89504e470d0a1a0a")) return ".png";
  if(ascii.startsWith("GIF87a")||ascii.startsWith("GIF89a")) return ".gif";
  if(ascii.startsWith("BM")) return ".bmp";

  if(ascii.startsWith("RIFF")&&buffer.subarray(8,12).toString("ascii")==="WEBP") {
    return ".webp";
  }

  if(buffer.subarray(4,12).toString("ascii").includes("ftypavif")) {
    return ".avif";
  }

  const beginning=buffer.subarray(0,512).toString("utf8").trimStart();

  if(beginning.startsWith("<svg")||beginning.startsWith("<?xml")&&beginning.includes("<svg")) {
    return ".svg";
  }

  return getExtensionFromContentType(contentType,fallback);
}

function isImageBuffer(buffer,contentType="") {
  if(!buffer||buffer.length<4) return false;

  return Boolean(getExtensionFromBuffer(buffer,contentType,""));
}

function normalizeInputUrl(url) {
  return String(url||"").trim().replace(/&amp;/g,"&");
}

function removeWrappingQuotes(value) {
  return String(value||"").trim().replace(/^["']+|["']+$/g,"");
}

function addUniqueCandidate(candidates,value) {
  const candidate=normalizeInputUrl(value);

  if(!candidate||candidates.includes(candidate)) return;

  candidates.push(candidate);
}

function addProtocolCandidates(candidates,value) {
  try {
    const parsed=new URL(value.startsWith("//")?`https:${value}`:value);

    if(parsed.protocol==="http:") {
      const httpsUrl=new URL(parsed);
      httpsUrl.protocol="https:";
      addUniqueCandidate(candidates,httpsUrl.toString());
    } else if(parsed.protocol==="https:") {
      const httpUrl=new URL(parsed);
      httpUrl.protocol="http:";
      addUniqueCandidate(candidates,httpUrl.toString());
    }
  } catch {}
}

function addNestedImageCandidates(candidates,parsed) {
  const parameterNames=[
    "src",
    "url",
    "image",
    "imageUrl",
    "img",
    "original",
    "originalUrl",
  ];

  for(const parameterName of parameterNames) {
    const value=parsed.searchParams.get(parameterName);

    if(!value) continue;

    const nestedUrl=removeWrappingQuotes(value);

    if(!/^https?:\/\//i.test(nestedUrl)&&!nestedUrl.startsWith("//")) continue;

    addUniqueCandidate(candidates,nestedUrl);
    addProtocolCandidates(candidates,nestedUrl);
  }
}

function addHighResolutionCandidate(candidates,parsed) {
  if(!/(^|\.)pstatic\.net$/i.test(parsed.hostname)) return;
  if(!parsed.searchParams.has("type")) return;

  /*
   * 원래 URL을 먼저 시도한다.
   * 고해상도 type은 원본이 실패했을 때만 사용하는 대체 후보이다.
   */
  const highResolutionUrl=new URL(parsed);
  highResolutionUrl.searchParams.set("type","w2000");

  addUniqueCandidate(candidates,highResolutionUrl.toString());
}

function getImageCandidates(url,options={}) {
  const {highResolution=false}=options;
  const source=normalizeInputUrl(url);
  const candidates=[];

  if(!source) return candidates;

  if(
    source.startsWith("./")
    ||source.startsWith("../")
    ||source.startsWith("data:")
    ||source.startsWith("blob:")
  ) {
    addUniqueCandidate(candidates,source);
    return candidates;
  }

  addUniqueCandidate(candidates,source);

  try {
    const parsed=new URL(source.startsWith("//")?`https:${source}`:source);

    addNestedImageCandidates(candidates,parsed);

    if(highResolution) addHighResolutionCandidate(candidates,parsed);

    addProtocolCandidates(candidates,parsed.toString());
  } catch {}

  return candidates;
}

async function fetchImageCandidate(url,timeout=20000) {
  const response=await fetch(url,{
    headers:{
      "User-Agent":"Mozilla/5.0",
      Referer:"https://blog.naver.com/",
      Accept:"image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    },
    redirect:"follow",
    signal:AbortSignal.timeout(timeout),
  });

  if(!response.ok) throw new Error(`HTTP ${response.status}`);

  const contentType=response.headers.get("content-type")||"";
  const buffer=Buffer.from(await response.arrayBuffer());

  if(!buffer.length) throw new Error("빈 응답");

  if(!isImageBuffer(buffer,contentType)) {
    throw new Error(`이미지가 아닌 응답: ${contentType||"unknown"}`);
  }

  return {
    url,
    buffer,
    contentType,
  };
}

async function fetchFirstAvailableImage(candidates,options={}) {
  const {timeout=20000}=options;
  const failures=[];

  for(const candidate of candidates) {
    try {
      return await fetchImageCandidate(candidate,timeout);
    } catch(error) {
      failures.push(`${candidate} → ${error.message}`);
    }
  }

  const message=failures.length
    ?`모든 이미지 주소 실패:\n${failures.join("\n")}`
    :"사용 가능한 이미지 주소가 없음";

  throw new Error(message);
}

function getNestedFilenameUrl(url) {
  try {
    const parsed=new URL(normalizeInputUrl(url));
    const parameterNames=["src","url","image","imageUrl","img","original","originalUrl"];

    for(const parameterName of parameterNames) {
      const value=parsed.searchParams.get(parameterName);

      if(!value) continue;

      const nestedUrl=removeWrappingQuotes(value);

      if(/^https?:\/\//i.test(nestedUrl)||nestedUrl.startsWith("//")) return nestedUrl;
    }
  } catch {}

  return "";
}

function getFilenameSource(originalUrl,successfulUrl) {
  const successfulFilename=getFilenameFromUrl(successfulUrl,"");

  if(successfulFilename) return successfulUrl;

  const nestedUrl=getNestedFilenameUrl(originalUrl);

  return nestedUrl||successfulUrl||originalUrl;
}

function ensureImageExtension(filename,buffer,contentType) {
  if(path.extname(filename)) return filename;

  return `${filename}${getExtensionFromBuffer(buffer,contentType)}`;
}

function createImageManager(outputDir) {
  const cache=new Map();
  let fallbackIndex=0;

  async function download(url,options={}) {
    const {
      highResolution=false,
      fallbackPrefix="image",
      timeout=20000,
    }=options;

    if(!url) return "";

    if(url.startsWith("./")) return url.slice(2);

    const candidates=getImageCandidates(url,{highResolution});

    if(
      !candidates.length
      ||candidates[0].startsWith("data:")
      ||candidates[0].startsWith("blob:")
    ) {
      return "";
    }

    const cacheKey=JSON.stringify(candidates);

    if(cache.has(cacheKey)) return cache.get(cacheKey);

    const downloaded=await fetchFirstAvailableImage(candidates,{timeout});

    fallbackIndex++;

    const fallback=`${fallbackPrefix}-${String(fallbackIndex).padStart(3,"0")}`;
    const filenameSource=getFilenameSource(url,downloaded.url);
    let filename=getFilenameFromUrl(filenameSource,fallback);

    filename=ensureImageExtension(filename,downloaded.buffer,downloaded.contentType);
    filename=getUniqueFilename(outputDir,filename);

    fs.writeFileSync(path.join(outputDir,filename),downloaded.buffer);

    cache.set(cacheKey,filename);

    return filename;
  }

  return {
    download,
  };
}

function getImageSources(image) {
  const sources=[];
  const attributes=[
    "data-lazy-src",
    "data-original",
    "data-origin-src",
    "data-src",
    "src",
  ];

  for(const attribute of attributes) {
    const value=image.attr(attribute);

    if(value&&!sources.includes(value)) sources.push(value);
  }

  const srcset=image.attr("srcset")||"";

  for(const entry of srcset.split(",")) {
    const value=entry.trim().split(/\s+/)[0];

    if(value&&!sources.includes(value)) sources.push(value);
  }

  return sources;
}

function getImageSource(image) {
  return getImageSources(image)[0]||"";
}

async function downloadFromImageSources(imageManager,sources,options) {
  const failures=[];

  for(const source of sources) {
    if(
      source.startsWith("./")
      ||source.startsWith("../")
      ||source.startsWith("data:")
      ||source.startsWith("blob:")
    ) {
      continue;
    }

    try {
      const filename=await imageManager.download(source,options);

      if(filename) return {filename,source};
    } catch(error) {
      failures.push(`${source} → ${error.message}`);
    }
  }

  if(failures.length) throw new Error(failures.join("\n"));

  return {
    filename:"",
    source:"",
  };
}

async function localizeImages($,root,imageManager,options={}) {
  const {editorVersion=0}=options;
  const images=root.find("img").add(root.filter("img")).toArray();

  for(const element of images) {
    const image=$(element);

    if(image.closest(".se-component.se-video").length) continue;

    const sources=getImageSources(image);

    if(!sources.length) continue;

    const isOgImage=Boolean(image.closest(".se-oglink").length);
    let downloaded;

    try {
      downloaded=await downloadFromImageSources(imageManager,sources,{
        editorVersion,
        highResolution:!isOgImage,
        fallbackPrefix:isOgImage?"og-thumb":"image",
      });
    } catch(error) {
      console.warn(`이미지 다운로드 실패: ${sources.join(", ")}`);
      console.warn(error.message);
      continue;
    }

    if(!downloaded.filename) continue;

    const width=Number(image.attr("data-width")||image.attr("width"));

    image.attr("src",`./${downloaded.filename}`);
    image.removeAttr("data-lazy-src");
    image.removeAttr("data-original");
    image.removeAttr("data-origin-src");
    image.removeAttr("data-src");
    image.removeAttr("srcset");

    if(Number.isFinite(width)&&width>0) {
      image.attr("style",`width:${width}px;max-width:100%;height:auto;`);
    } else if(!image.attr("style")) {
      image.attr("style","max-width:100%;height:auto;");
    }
  }
}

module.exports={
  createImageManager,
  localizeImages,
  getImageSource,
  getImageSources,
  getImageCandidates,
};
