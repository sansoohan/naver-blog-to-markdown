const {
  withConnectionRetry,
} = require("./network");
const { chromium } = require("playwright");

let crawlBrowser = null;
let crawlContext = null;
let crawlPage = null;
let crawlPageUseCount = 0;

const CRAWL_PAGE_MAX_USES = 100;

async function fetchPublic(url, options = {}) {
  return withConnectionRetry(() => fetch(url, options));
}

function makeResponse({ ok, status, url, text }) {
  return {
    ok,
    status,
    url,
    text: async () => text,
  };
}

async function fetchPrivateRequest(url, options = {}) {
  const { getAuthPage, forceLogin } = require("./auth");

  async function request() {
    return withConnectionRetry(async () => {
      const page = await getAuthPage();

      const result = await page.evaluate(async ({ url, method, headers, body }) => {
        try {
          const response = await fetch(url, {
            method,
            headers,
            body,
            credentials: "include",
            redirect: "follow",
          });

          return {
            ok: response.ok,
            status: response.status,
            url: response.url,
            text: await response.text(),
          };
        } catch (error) {
          return {
            ok: false,
            status: 0,
            url,
            text: "",
            error: error.message,
          };
        }
      }, {
        url,
        method: options.method || "GET",
        headers: options.headers || {},
        body: options.body || null,
      });

      if (result.error) throw new Error(`네이버 요청 실패: ${result.error}`);

      return result;
    });
  }

  let result = await request();

  if (isLoginResponse(result)) {
    console.log("");
    console.log("네이버 로그인 세션이 만료되었습니다.");
    console.log("다시 로그인합니다.");
    console.log("");

    await forceLogin();

    result = await request();

    if (isLoginResponse(result)) throw new Error("로그인 후에도 네이버 인증 요청에 실패했습니다.");
  }

  return makeResponse(result);
}

function isLoginResponse(result) {
  if (!result) return true;

  if (result.url && result.url.includes("nid.naver.com/nidlogin")) return true;

  const text = result.text || "";

  if (text.includes("nid.naver.com/nidlogin.login")) return true;
  if (text.includes("NAVER 로그인")) return true;
  if (text.includes("로그인이 필요합니다")) return true;

  return false;
}

async function syncCrawlCookies() {
  const { getAuthContext } = require("./auth");

  const authContext = await getAuthContext();
  const cookies = await authContext.cookies();

  if (cookies.length) {
    await crawlContext.addCookies(cookies);
  }
}

async function ensureCrawlContext() {
  if (crawlBrowser && crawlContext) return;

  crawlBrowser = await chromium.launch({
    headless: true,
  });

  crawlContext = await crawlBrowser.newContext();

  await syncCrawlCookies();
}

async function closeCrawlPage() {
  if (crawlPage && !crawlPage.isClosed()) {
    await crawlPage.close().catch(() => {});
  }

  crawlPage = null;
  crawlPageUseCount = 0;
}

async function closeNaverRequest() {
  await closeCrawlPage();

  if (crawlContext) {
    await crawlContext.close().catch(() => {});
    crawlContext = null;
  }

  if (crawlBrowser) {
    await crawlBrowser.close().catch(() => {});
    crawlBrowser = null;
  }
}

async function getCrawlPage() {
  await ensureCrawlContext();

  if (
    !crawlPage
    || crawlPage.isClosed()
    || crawlPageUseCount >= CRAWL_PAGE_MAX_USES
  ) {
    await closeCrawlPage();

    crawlPage = await crawlContext.newPage();
    crawlPageUseCount = 0;
  }

  crawlPageUseCount++;

  return crawlPage;
}

async function resetCrawlAuth() {
  await closeCrawlPage();
  await ensureCrawlContext();
  await syncCrawlCookies();
}

async function fetchPrivatePage(url, options = {}) {
  const { forceLogin } = require("./auth");

  async function load() {
    return withConnectionRetry(async () => {
      const page = await getCrawlPage();

      if (options.headers) await page.setExtraHTTPHeaders(options.headers);

      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });

      if (!response) throw new Error(`페이지 요청 실패: ${url}`);

      const html = await page.content();

      return {
        page,
        html,
      };
    });
  }

  let result = await load();

  if (isPrivatePageDenied(result.page, result.html)) {
    console.log("");
    console.log("네이버 로그인 세션이 만료되었습니다.");
    console.log("다시 로그인합니다.");
    console.log("");

    await forceLogin();

    await resetCrawlAuth();

    result = await load();

    if (isPrivatePageDenied(result.page, result.html)) {
      throw new Error("네이버 로그인 후에도 비공개 게시글에 접근할 수 없습니다.");
    }
  }

  return makeResponse({
    ok: true,
    status: 200,
    url,
    text: result.html,
  });
}

function isPrivatePageDenied(page, html) {
  const url = page.url();

  if (url.includes("nid.naver.com/nidlogin")) return true;
  if (html.includes("비공개 글 입니다.") && html.includes("nid.naver.com/nidlogin.login")) return true;
  if (html.includes("NAVER 로그인")) return true;

  return false;
}

function shouldUseBrowserPage(url) {
  return /\/PostView\.naver(?:\?|$)/i.test(url);
}

async function fetchNaver(url, options = {}) {
  const { private: includePrivate = false, browser: forceBrowser = false, ...fetchOptions } = options;

  if (!includePrivate) return fetchPublic(url, fetchOptions);

  if (forceBrowser || shouldUseBrowserPage(url)) return fetchPrivatePage(url, fetchOptions);

  return fetchPrivateRequest(url, fetchOptions);
}

module.exports = {
  fetchNaver,
  closeNaverRequest,
};