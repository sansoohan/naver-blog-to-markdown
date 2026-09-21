const fs=require("fs");
const path=require("path");
const {chromium}=require("playwright");

const AUTH_DIR=path.join(process.cwd(),".auth");
const PROFILE_DIR=path.join(AUTH_DIR,"naver-profile");
const AUTH_STATE_FILE=path.join(AUTH_DIR,"naver-storage-state.json");
const NAVER_URL="https://www.naver.com/";
const LOGIN_URL="https://nid.naver.com/nidlogin.login";
const LOGIN_TIMEOUT=10*60*1000;

let browser=null;
let context=null;
let page=null;
let cdpSession=null;
let windowId=null;

function ensureAuthDirectory() {
  fs.mkdirSync(AUTH_DIR,{recursive:true});
}

function hasSavedAuthState() {
  try {
    return fs.statSync(AUTH_STATE_FILE).size>0;
  } catch {
    return false;
  }
}

function hasSavedProfile() {
  if(!fs.existsSync(PROFILE_DIR)) return false;

  try {
    return fs.readdirSync(PROFILE_DIR).length>0;
  } catch {
    return false;
  }
}

function isLoginUrl(url) {
  return String(url||"").includes("nid.naver.com/nidlogin");
}

function delay(milliseconds) {
  return new Promise(resolve=>setTimeout(resolve,milliseconds));
}

async function launchBrowser() {
  if(context) return context;

  ensureAuthDirectory();

  try {
    browser=await chromium.launch({
      headless:false,
      args:[
        "--start-minimized",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
      ],
    });

    const options={viewport:null};

    if(hasSavedAuthState()) options.storageState=AUTH_STATE_FILE;

    context=await browser.newContext(options);
  } catch(error) {
    if(/Executable doesn't exist|chromium\.launch/i.test(error.message)) {
      throw new Error(
        "Playwright Chromium이 설치되어 있지 않습니다.\n\nnpx playwright install chromium"
      );
    }

    throw error;
  }

  page=await context.newPage();
  await setupWindowControl();

  return context;
}

async function setupWindowControl() {
  if(!context||!page) return;

  try {
    cdpSession=await context.newCDPSession(page);
    const result=await cdpSession.send("Browser.getWindowForTarget");
    windowId=result.windowId;
  } catch {
    cdpSession=null;
    windowId=null;
  }
}

async function minimizeBrowser() {
  if(!cdpSession||windowId===null) return;

  try {
    await cdpSession.send("Browser.setWindowBounds",{
      windowId,
      bounds:{windowState:"minimized"},
    });
  } catch {}
}

async function showBrowser() {
  if(!page||page.isClosed()) return;

  if(cdpSession&&windowId!==null) {
    try {
      await cdpSession.send("Browser.setWindowBounds",{
        windowId,
        bounds:{windowState:"normal"},
      });
    } catch {}
  }

  try {
    await page.bringToFront();
  } catch {}
}

async function getNaverCookies() {
  if(!context) return [];

  try {
    return await context.cookies([
      "https://www.naver.com/",
      "https://nid.naver.com/",
      "https://blog.naver.com/",
    ]);
  } catch {
    return [];
  }
}

async function hasLoginCookie() {
  const cookies=await getNaverCookies();

  return cookies.some(cookie=>{
    return ["NID_AUT","NID_SES"].includes(cookie.name)&&cookie.value;
  });
}

async function saveAuthState() {
  if(!context) return;

  ensureAuthDirectory();

  try {
    await context.storageState({path:AUTH_STATE_FILE});
  } catch {}
}

async function registerDeviceIfAvailable() {
  if(!page||page.isClosed()) return false;

  const selectors=[
    'button:has-text("기기 등록")',
    'button:has-text("이 기기 등록")',
    'a:has-text("기기 등록")',
    'a:has-text("이 기기 등록")',
    'input[value*="기기 등록"]',
  ];

  for(const selector of selectors) {
    const target=page.locator(selector).first();

    try {
      if(!await target.isVisible()) continue;

      await target.click({timeout:3000});
      console.log("기기 등록 버튼을 자동으로 눌렀습니다.");
      await page.waitForTimeout(500);

      return true;
    } catch {}
  }

  return false;
}

async function verifyNaverLogin() {
  if(!page||page.isClosed()) return false;

  if(await hasLoginCookie()) return true;

  try {
    await page.goto(NAVER_URL,{waitUntil:"domcontentloaded",timeout:60000});

    if(isLoginUrl(page.url())) return false;

    const logoutLink=await page.locator('a[href*="nidlogin.logout"]').count().catch(()=>0);
    const loggedIn=logoutLink>0||await hasLoginCookie();

    if(loggedIn) await saveAuthState();

    return loggedIn;
  } catch {
    return false;
  }
}

async function verifyBlogOwner(blogId) {
  if(!page||page.isClosed()||!blogId) return false;
  if(!await verifyNaverLogin()) return false;

  const writeUrl=`https://blog.naver.com/PostWriteForm.naver?blogId=${encodeURIComponent(blogId)}`;

  try {
    await page.goto(writeUrl,{waitUntil:"domcontentloaded",timeout:60000});

    if(isLoginUrl(page.url())) return false;

    const html=await page.content();

    return !/로그인이 필요|로그인 후 이용|권한이 없|접근 권한/i.test(html);
  } catch {
    return false;
  }
}

async function verifyAuth() {
  return verifyNaverLogin();
}

async function waitForLogin() {
  console.log("브라우저에서 네이버에 로그인해주세요.");

  await showBrowser();
  await page.goto(LOGIN_URL,{waitUntil:"domcontentloaded",timeout:60000});

  const startedAt=Date.now();

  while(Date.now()-startedAt<LOGIN_TIMEOUT) {
    await delay(1500);

    if(isLoginUrl(page.url())) continue;

    if(await verifyNaverLogin()) {
      await registerDeviceIfAvailable();
      await saveAuthState();
      console.log("네이버 로그인 정보 저장 완료");
      await minimizeBrowser();
      return;
    }

    await showBrowser();
  }

  throw new Error("네이버 로그인 확인 시간이 초과되었습니다.");
}

async function ensureLogin() {
  const savedState=hasSavedAuthState();
  const savedProfile=hasSavedProfile();

  if(savedState) {
    console.log("저장된 네이버 로그인 정보를 불러옵니다.");
  } else if(savedProfile) {
    console.log("기존 네이버 프로필이 있지만 로그인 정보 파일은 없습니다.");
  } else {
    console.log("저장된 네이버 로그인 정보가 없습니다.");
  }

  await launchBrowser();

  if(savedState) {
    console.log("저장된 네이버 로그인 상태를 확인합니다...");

    if(await verifyNaverLogin()) {
      console.log("저장된 네이버 로그인 세션을 사용합니다.");
      await minimizeBrowser();
      return;
    }

    console.log("저장된 네이버 로그인 세션이 만료되었습니다.");

    try {
      fs.unlinkSync(AUTH_STATE_FILE);
    } catch {}
  }

  console.log("네이버 로그인이 필요합니다.");
  await waitForLogin();
}

async function forceLogin() {
  await launchBrowser();

  console.log("네이버 로그인을 다시 진행합니다.");
  await showBrowser();
  await page.goto(LOGIN_URL,{waitUntil:"domcontentloaded",timeout:60000});

  await waitForLogin();
}

async function getAuthContext() {
  if(!context) await ensureLogin();

  return context;
}

async function getAuthPage() {
  if(!context||!page) await ensureLogin();

  if(page.isClosed()) {
    page=await context.newPage();
    await setupWindowControl();
  }

  return page;
}

async function closeAuth() {
  await saveAuthState();

  if(context) {
    try {
      await context.close();
    } catch {}
  }

  if(browser) {
    try {
      await browser.close();
    } catch {}
  }

  browser=null;
  context=null;
  page=null;
  cdpSession=null;
  windowId=null;
}

module.exports={
  ensureLogin,
  forceLogin,
  verifyNaverLogin,
  verifyBlogOwner,
  getAuthContext,
  getAuthPage,
  minimizeBrowser,
  showBrowser,
  registerDeviceIfAvailable,
  closeAuth,
};
