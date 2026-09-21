const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const AUTH_DIR = path.join(process.cwd(), ".auth");
const PROFILE_DIR = path.join(AUTH_DIR, "naver-profile");
const NAVER_URL = "https://www.naver.com/";
const LOGIN_URL = "https://nid.naver.com/nidlogin.login";

let context = null;
let page = null;
let cdpSession = null;
let windowId = null;

function ensureAuthDirectory() {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

function hasSavedProfile() {
  if (!fs.existsSync(PROFILE_DIR)) return false;

  try {
    return fs.readdirSync(PROFILE_DIR).length > 0;
  } catch {
    return false;
  }
}

async function launchBrowser() {
  if (context) return context;

  ensureAuthDirectory();

  try {
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: false,
      viewport: null,
      args: [
        "--start-minimized",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
      ],
    });
  } catch (error) {
    if (/Executable doesn't exist|browserType\.launchPersistentContext/i.test(error.message)) {
      throw new Error("Playwright Chromium이 설치되어 있지 않습니다.\n먼저 다음 명령을 실행해주세요:\n\nnpx playwright install chromium");
    }

    throw error;
  }

  const pages = context.pages();
  page = pages[0] || await context.newPage();

  await setupWindowControl();

  return context;
}

async function setupWindowControl() {
  if (!context || !page) return;

  try {
    cdpSession = await context.newCDPSession(page);
    const result = await cdpSession.send("Browser.getWindowForTarget");
    windowId = result.windowId;
  } catch {
    cdpSession = null;
    windowId = null;
  }
}

async function minimizeBrowser() {
  if (!cdpSession || windowId === null) return;

  try {
    await cdpSession.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "minimized" },
    });
  } catch {}
}

async function showBrowser() {
  if (!page || page.isClosed()) return;

  if (cdpSession && windowId !== null) {
    try {
      await cdpSession.send("Browser.setWindowBounds", {
        windowId,
        bounds: { windowState: "normal" },
      });
    } catch {}
  }

  try {
    await page.bringToFront();
  } catch {}
}

function isLoginUrl(url) {
  return String(url || "").includes("nid.naver.com/nidlogin");
}

async function verifyNaverLogin() {
  if (!page || page.isClosed()) return false;

  try {
    await page.goto(NAVER_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});

    if (isLoginUrl(page.url())) return false;

    const loginLink = await page.locator('a[href*="nidlogin.login"]').count().catch(() => 0);
    const logoutLink = await page.locator('a[href*="nidlogin.logout"]').count().catch(() => 0);

    if (logoutLink > 0) return true;
    if (loginLink > 0) return false;

    return false;
  } catch {
    return false;
  }
}

async function verifyBlogOwner(blogId) {
  if (!page || page.isClosed() || !blogId) return false;

  const writeUrl = `https://blog.naver.com/PostWriteForm.naver?blogId=${encodeURIComponent(blogId)}`;

  try {
    await page.goto(writeUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});

    const finalUrl = page.url();

    if (isLoginUrl(finalUrl)) return false;

    const html = await page.content();

    if (/로그인이 필요|로그인 후 이용|권한이 없|접근 권한/i.test(html)) return false;

    if (finalUrl.includes("PostWriteForm.naver")) return true;

    return /PostWriteForm|글쓰기|publish|editor/i.test(html);
  } catch {
    return false;
  }
}

async function verifyAuth(blogId = null) {
  if (blogId) return verifyBlogOwner(blogId);
  return verifyNaverLogin();
}

async function waitForLogin(blogId = null) {
  console.log("브라우저에서 네이버에 로그인해주세요.");

  if (blogId) console.log("로그인 후 실제 블로그 소유자 권한까지 확인합니다.");

  await showBrowser();

  await page.goto(LOGIN_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  const startedAt = Date.now();
  const timeout = 10 * 60 * 1000;

  while (Date.now() - startedAt < timeout) {
    await page.waitForTimeout(1500);

    if (isLoginUrl(page.url())) continue;

    if (blogId) {
      console.log("로그인 상태를 확인합니다...");
      console.log("블로그 소유자 권한을 확인합니다...");

      const owner = await verifyBlogOwner(blogId);

      if (owner) {
        console.log("블로그 소유자 권한 확인 완료");
        await minimizeBrowser();
        return;
      }

      console.log("블로그 소유자 권한을 확인하지 못했습니다.");
      console.log("브라우저에서 추가 인증이 필요한지 확인해주세요.");

      await showBrowser();
      continue;
    }

    const loggedIn = await verifyNaverLogin();

    if (loggedIn) {
      console.log("네이버 로그인 확인");
      await minimizeBrowser();
      return;
    }

    await showBrowser();
  }

  throw new Error("네이버 로그인 확인 시간이 초과되었습니다.");
}

async function ensureLogin(blogId = null) {
  const savedProfile = hasSavedProfile();

  if (savedProfile) {
    console.log("저장된 네이버 로그인 프로필을 불러옵니다.");
  } else {
    console.log("저장된 네이버 로그인 프로필이 없습니다.");
  }

  await launchBrowser();

  if (savedProfile) {
    if (blogId) {
      console.log("저장된 블로그 소유자 세션을 확인합니다...");

      const owner = await verifyBlogOwner(blogId);

      if (owner) {
        console.log("저장된 블로그 소유자 세션을 사용합니다.");
        await minimizeBrowser();
        return;
      }

      console.log("저장된 블로그 소유자 세션이 유효하지 않습니다.");
    } else {
      console.log("저장된 네이버 로그인 상태를 확인합니다...");

      const loggedIn = await verifyNaverLogin();

      if (loggedIn) {
        console.log("저장된 네이버 로그인 세션을 사용합니다.");
        await minimizeBrowser();
        return;
      }

      console.log("저장된 네이버 로그인 세션이 유효하지 않습니다.");
    }
  }

  console.log("네이버 로그인이 필요합니다.");

  await waitForLogin(blogId);
}

async function forceLogin(blogId = null) {
  await launchBrowser();

  console.log("네이버 로그인을 다시 진행합니다.");

  await showBrowser();

  await page.goto(LOGIN_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await waitForLogin(blogId);
}

async function getAuthContext() {
  if (!context) await ensureLogin();
  return context;
}

async function getAuthPage() {
  if (!context || !page) await ensureLogin();

  if (page.isClosed()) {
    page = await context.newPage();
    await setupWindowControl();
  }

  return page;
}

async function closeAuth() {
  if (!context) return;

  try {
    await context.close();
  } catch {}

  context = null;
  page = null;
  cdpSession = null;
  windowId = null;
}

module.exports = {
  ensureLogin,
  forceLogin,
  verifyNaverLogin,
  verifyBlogOwner,
  getAuthContext,
  getAuthPage,
  minimizeBrowser,
  showBrowser,
  closeAuth,
};
