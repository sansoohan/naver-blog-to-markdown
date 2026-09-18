const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const TurndownService = require("turndown");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/152.0.0.0 Safari/537.36";

function parsePostUrl(input) {
  const url = new URL(input);
  const parts = url.pathname.split("/").filter(Boolean);

  if (parts.length >= 2 && /^\d+$/.test(parts[1])) {
    return { blogId: parts[0], logNo: parts[1] };
  }

  const blogId = url.searchParams.get("blogId");
  const logNo = url.searchParams.get("logNo");

  if (blogId && logNo) return { blogId, logNo };

  throw new Error(`지원하지 않는 네이버 블로그 URL: ${input}`);
}

function safeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 180);
}

function escapeHtmlAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// YouTube URL에서 시작 시간 추출
// t=65 / t=65s / t=1m5s / t=1h2m3s / start=65 지원
function getYouTubeStartSeconds(inputUrl) {
  if (!inputUrl) return null;

  try {
    const url = new URL(inputUrl);

    const start = url.searchParams.get("start");
    if (start && /^\d+$/.test(start)) {
      return Number(start);
    }

    const t = url.searchParams.get("t");
    if (!t) return null;

    if (/^\d+s?$/.test(t)) {
      return Number(t.replace(/s$/, ""));
    }

    const match = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    if (!match) return null;

    const hours = Number(match[1] || 0);
    const minutes = Number(match[2] || 0);
    const seconds = Number(match[3] || 0);
    const total = hours * 3600 + minutes * 60 + seconds;

    return total > 0 ? total : null;
  } catch {
    return null;
  }
}

// iframe에 start=초 추가
function applyYouTubeStartTime(iframeHtml, startSeconds) {
  if (!iframeHtml || !startSeconds || startSeconds <= 0) {
    return iframeHtml;
  }

  return iframeHtml.replace(/src="([^"]+)"/i, (whole, src) => {
    // 이미 start가 있으면 그대로 유지
    if (/[?&]start=\d+/i.test(src)) {
      return whole;
    }

    const separator = src.includes("?") ? "&" : "?";
    return `src="${src}${separator}start=${startSeconds}"`;
  });
}

function cleanMarkdown(markdown) {
  return markdown
    .replace(/\u200b/g, "")
    .replace(/[ \t]+\n/g, "\n")

    // bullet list 사이 불필요한 빈 줄 제거
    .replace(/^([ \t]*[-*+] .+)\n{2,}(?=[ \t]*[-*+] )/gm, "$1\n")
    .replace(/^([ \t]*\\[-*+] .+)\n{2,}(?=[ \t]*\\[-*+] )/gm, "$1\n")

    // 숫자 list 사이 불필요한 빈 줄 제거
    .replace(/^([ \t]*\d+\\?\. .+)\n{2,}(?=[ \t]*\d+\\?\. )/gm, "$1\n")

    // 3개 이상의 연속 개행 → 2개로
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeNaverHtml($, content) {
  // YouTube oEmbed 처리
  content.find(".se-component.se-oembed").each((_, el) => {
    const $component = $(el);
    const $data = $component.find("script.__se_module_data").first();

    if (!$data.length) return;

    const raw =
      $data.attr("data-module-v2") ||
      $data.attr("data-module");

    if (!raw) return;

    let moduleData;

    try {
      moduleData = JSON.parse(raw);
    } catch (error) {
      console.warn("oEmbed 데이터 파싱 실패:", error.message);
      return;
    }

    const data = moduleData.data;
    if (!data || data.providerName !== "YouTube") return;

    // inputUrl은 시작 시간 확인용으로만 사용
    // 실제 링크는 본문에 원래 존재하는 <a>를 보존
    const inputUrl = data.inputUrl || "";

    let iframeHtml = data.html || "";
    if (!iframeHtml) return;

    // t=65s 등이 있으면 iframe에 start=65 적용
    const startSeconds = getYouTubeStartSeconds(inputUrl);
    iframeHtml = applyYouTubeStartTime(iframeHtml, startSeconds);

    // Turndown으로부터 iframe 보호
    const encodedIframe = Buffer.from(iframeHtml, "utf8").toString("base64");

    $component.replaceWith(
      `NAVEROEMBEDSTART${encodedIframe}NAVEROEMBEDEND`
    );
  });

  // oEmbed 처리 후 불필요 요소 제거
  content.find("script, style, noscript").remove();

  // 이미지 원본 URL 정리
  content.find("img").each((_, img) => {
    const $img = $(img);

    let src =
      $img.attr("data-lazy-src") ||
      $img.attr("data-src") ||
      $img.attr("src");

    if (!src) return;

    src = src.replace(/\?type=[^&]+.*$/, "");

    $img.attr("src", src);
    $img.removeAttr("data-lazy-src");
    $img.removeAttr("data-src");
  });

  // href 없는 의미 없는 이미지 링크만 제거
  content.find("a").each((_, a) => {
    const $a = $(a);
    const href = $a.attr("href");

    if ((!href || href === "#") && $a.find("img").length) {
      $a.replaceWith($a.contents());
    }
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

  // 원래 본문의 <a> 링크 보존
  turndown.addRule("preserveLinks", {
    filter: "a",

    replacement(content, node) {
      const href = node.getAttribute("href");
      if (!href) return content;

      let attrs = `href="${escapeHtmlAttribute(href)}"`;

      const target = node.getAttribute("target");
      const title = node.getAttribute("title");

      if (target) {
        attrs += ` target="${escapeHtmlAttribute(target)}"`;
      }

      if (title) {
        attrs += ` title="${escapeHtmlAttribute(title)}"`;
      }

      return `<a ${attrs}>${content}</a>`;
    },
  });

  // 네이버 글자 크기
  turndown.addRule("naverFontSize", {
    filter(node) {
      if (node.nodeName !== "SPAN") return false;

      const className = node.getAttribute("class") || "";
      return /\bse-fs-fs\d+\b/.test(className);
    },

    replacement(content, node) {
      const className = node.getAttribute("class") || "";
      const match = className.match(/\bse-fs-fs(\d+)\b/);

      if (!match) return content;

      const size = Number(match[1]);
      const text = content.replace(/\u200b/g, "").trim();

      if (!text) return "";

      switch (size) {
        case 13:
          return text;
        case 15:
          return `\n\n#### ${text}\n\n`;
        case 16:
          return `\n\n### ${text}\n\n`;
        case 19:
          return `\n\n## ${text}\n\n`;
        case 24:
          return `\n\n# ${text}\n\n`;
        default:
          return `<span style="font-size:${size}px">${text}</span>`;
      }
    },
  });

  // 이미지
  turndown.addRule("naverImage", {
    filter: "img",

    replacement(content, node) {
      let src =
        node.getAttribute("data-lazy-src") ||
        node.getAttribute("data-src") ||
        node.getAttribute("src");

      if (!src) return "";

      src = src.replace(/\?type=[^&]+.*$/, "");
      src += "?type=w2000";

      return `\n\n![](${src})\n\n`;
    },
  });

  // 네이버 문단
  turndown.addRule("naverParagraph", {
    filter(node) {
      return (
        node.nodeName === "P" &&
        (node.getAttribute("class") || "").includes("se-text-paragraph") &&
        node.parentNode?.nodeName !== "LI"
      );
    },

    replacement(content) {
      const text = content.replace(/\u200b/g, "").trim();

      if (!text) {
        return "\nNAVEREMPTYLINE\n";
      }

      return `${text}\n`;
    },
  });

  return turndown;
}

// 네이버 빈 문단 복원
function restoreEmptyLines(markdown) {
  return markdown.replace(
    /(?:\s*NAVEREMPTYLINE\s*)+/g,
    (match) => {
      const count = (match.match(/NAVEREMPTYLINE/g) || []).length;

      if (count === 1) {
        return "\n\n";
      }

      if (count === 2) {
        return "\n\n<br>\n\n";
      }

      if (count === 3) {
        return "\n\n<br>\n<br>\n<br>\n\n";
      }

      return "\n\n" + "<br>\n".repeat(count) + "\n";
    }
  );
}

// oEmbed에서는 iframe만 복원
// 링크는 원래 본문의 <a> 사용
function restoreOEmbed(markdown) {
  return markdown.replace(
    /NAVEROEMBEDSTART([A-Za-z0-9+/=]+)NAVEROEMBEDEND/g,
    (_, encodedIframe) => {
      try {
        const iframeHtml = Buffer.from(encodedIframe, "base64").toString("utf8");
        return `\n\n${iframeHtml}\n\n`;
      } catch (error) {
        console.warn("oEmbed 복원 실패:", error.message);
        return "";
      }
    }
  );
}

async function getPost(inputUrl) {
  const { blogId, logNo } = parsePostUrl(inputUrl);

  const postUrl =
    "https://blog.naver.com/PostView.naver" +
    `?blogId=${encodeURIComponent(blogId)}` +
    `&logNo=${encodeURIComponent(logNo)}`;

  console.log(`가져오는 중: ${postUrl}`);

  const response = await fetch(postUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      Referer: "https://blog.naver.com/",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  // 제목
  let title =
    $('meta[property="og:title"]').attr("content") ||
    $(".se-title-text").text().trim() ||
    $("title").text().trim() ||
    `${blogId}-${logNo}`;

  title = title.replace(/\s*:\s*네이버 블로그\s*$/, "").trim();

  // 본문
  let content = $(".se-main-container").first();

  if (!content.length) {
    content = $("#postViewArea").first();
  }

  if (!content.length) {
    content = $(".se3_view").first();
  }

  if (!content.length) {
    throw new Error("본문 영역을 찾지 못했습니다.");
  }

  normalizeNaverHtml($, content);

  const turndown = createTurndown();
  let bodyMarkdown = turndown.turndown(content.html() || "");

  // 1차 정리
  bodyMarkdown = restoreEmptyLines(bodyMarkdown);
  bodyMarkdown = cleanMarkdown(bodyMarkdown);

  // iframe 복원
  bodyMarkdown = restoreOEmbed(bodyMarkdown);

  // 2차 정리
  // iframe 복원 과정에서 생긴 3개 이상의 연속 개행도 제거
  bodyMarkdown = cleanMarkdown(bodyMarkdown);

  const markdown = [
    `# ${title}`,
    "",
    `> 원본: https://blog.naver.com/${blogId}/${logNo}`,
    "",
    bodyMarkdown,
    "",
  ].join("\n");

  return {
    title,
    blogId,
    logNo,
    markdown,
  };
}

async function main() {
  const inputUrl = process.argv[2];
  const dest = process.argv[3] || "output";

  if (!inputUrl) {
    console.log("사용법:\nnode main.js <네이버 블로그 글 URL> [저장폴더]");
    process.exit(1);
  }

  fs.mkdirSync(dest, { recursive: true });

  const post = await getPost(inputUrl);
  const filename = safeFilename(post.title) || `${post.blogId}-${post.logNo}`;
  const outputPath = path.join(dest, `${filename}.md`);

  fs.writeFileSync(outputPath, post.markdown, "utf8");

  console.log("");
  console.log(`완료: ${outputPath}`);
  console.log(`글자 수: ${post.markdown.length}`);
}

main().catch((error) => {
  console.error("");
  console.error("실패:", error.message);
  console.error(error.stack);
  process.exit(1);
});