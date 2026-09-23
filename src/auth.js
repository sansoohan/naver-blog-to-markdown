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

function deleteSavedAuthState() {
  try {
    fs.unlinkSync(AUTH_STATE_FILE);
  } catch {}
}

async function isDeviceRegistrationPromptVisible() {
  if(!context) return false;

  const selectors=[
    'text=이 기기 등록',
    'text=이 기기를 등록',
    'text=기기 등록',
    'text=새로운 기기',
    'text=새 기기',
  ];

  for(const currentPage of context.pages()) {
    if(currentPage.isClosed()) continue;

    for(const scope of [currentPage,...currentPage.frames()]) {
      for(const selector of selectors) {
        try {
          if(await scope.locator(selector).first().isVisible()) return true;
        } catch {}
      }
    }
  }

  return false;
}

async function waitForDeviceRegistrationChoice(startedAt) {
  if(!await isDeviceRegistrationPromptVisible()) return false;

  console.log("이 기기 등록 화면이 표시되었습니다.");
  console.log("브라우저에서 직접 등록 또는 건너뛰기를 선택해주세요.");

  await showBrowser();

  while(Date.now()-startedAt<LOGIN_TIMEOUT) {
    await delay(500);

    /*
     * 사용자가 등록 또는 건너뛰기를 선택하기 전에는
     * 다른 페이지로 이동하거나 소유자 권한을 확인하지 않는다.
     */
    if(!await isDeviceRegistrationPromptVisible()) return true;

    await showBrowser();
  }

  throw new Error("이 기기 등록 선택 시간이 초과되었습니다.");
}

/*
 * 기존 로그인 흐름에서 사용하는 함수.
 *
 * 원래 코드의 동작을 그대로 유지한다.
 * 쿠키가 있으면 로그인 상태로 판단하고 페이지를 이동시키지 않는다.
 */
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

/*
 * 기존 로그인 완료 후 블로그 소유자 권한 확인.
 *
 * 원래 코드의 흐름을 그대로 유지한다.
 */
async function verifyBlogOwner(blogId) {
  if(!page||page.isClosed()||!blogId) return false;

  if(!await verifyNaverLogin()) return false;

  const writeUrl="https://blog.naver.com/PostWriteForm.naver?blogId="+encodeURIComponent(blogId);

  try {
    await page.goto(writeUrl,{waitUntil:"domcontentloaded",timeout:60000});

    const finalUrl=page.url();
    const html=await page.content();

    if(isLoginUrl(finalUrl)) return false;

    if(/로그인이 필요|로그인 후 이용|권한이 없|접근 권한/i.test(html)) return false;

    return finalUrl.includes("PostWriteForm.naver")||/글쓰기|publish|editor/i.test(html);
  } catch {
    return false;
  }
}

async function verifyAuth(blogId="") {
  return blogId?verifyBlogOwner(blogId):verifyNaverLogin();
}

/*
 * 저장된 세션을 처음 불러왔을 때만 사용하는 검사.
 *
 * blogId가 있으면 PostWriteForm을 직접 요청한다.
 * 여기서는 hasLoginCookie()만으로 성공 처리하지 않는다.
 *
 * 이 함수는 waitForLogin()에서는 절대 호출하지 않는다.
 */
async function verifySavedAuth(blogId="") {
  if(!page||page.isClosed()) return false;

  if(blogId) {
    const writeUrl="https://blog.naver.com/PostWriteForm.naver?blogId="+encodeURIComponent(blogId);

    try {
      await page.goto(writeUrl,{waitUntil:"domcontentloaded",timeout:60000});

      const finalUrl=page.url();
      const html=await page.content();

      if(isLoginUrl(finalUrl)) return false;

      if(/로그인이 필요|로그인 후 이용|권한이 없|접근 권한/i.test(html)) return false;

      const owner=finalUrl.includes("PostWriteForm.naver")||/글쓰기|publish|editor/i.test(html);

      if(owner) await saveAuthState();

      return owner;
    } catch {
      return false;
    }
  }

  /*
   * blogId 없이 ensureLogin()을 호출한 경우에만 사용한다.
   */
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

/*
 * 여기부터는 처음 사용하던 로그인 흐름을 그대로 유지한다.
 */
async function waitForLogin(blogId="") {
  console.log("브라우저에서 네이버에 로그인해주세요.");

  if(blogId) console.log("로그인 후 블로그 소유자 권한까지 확인합니다.");

  await showBrowser();
  await page.goto(LOGIN_URL,{waitUntil:"domcontentloaded",timeout:60000});

  const startedAt=Date.now();

  while(Date.now()-startedAt<LOGIN_TIMEOUT) {
    await delay(1000);

    /*
     * 로그인 URL 위에 기기 등록 화면이 뜰 수 있다.
     * 선택하기 전에는 continue나 page.goto를 실행하지 않는다.
     */
    await waitForDeviceRegistrationChoice(startedAt);

    if(isLoginUrl(page.url())) {
      await showBrowser();
      continue;
    }

    if(!await verifyNaverLogin()) {
      await showBrowser();
      continue;
    }

    /*
     * 로그인 완료 직후 늦게 표시되는 등록 화면도 먼저 처리한다.
     * 이 함수가 끝날 때까지 verifyBlogOwner()가 다른 주소로 이동하지 않는다.
     */
    const deviceChoiceMade=await waitForDeviceRegistrationChoice(startedAt);

    if(deviceChoiceMade) await minimizeBrowser();

    if(blogId&&!await verifyBlogOwner(blogId)) {
      console.log("로그인한 계정에 이 블로그의 관리 권한이 없습니다.");
      console.log("브라우저에서 올바른 계정으로 다시 로그인해주세요.");

      await showBrowser();
      await page.goto(LOGIN_URL,{waitUntil:"domcontentloaded",timeout:60000});

      continue;
    }

    await saveAuthState();

    console.log("네이버 로그인 정보 저장 완료");

    await minimizeBrowser();

    return;
  }

  throw new Error("네이버 로그인 확인 시간이 초과되었습니다.");
}

async function ensureLogin(blogId="") {
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
    const label=blogId?"저장된 블로그 소유자 세션":"저장된 네이버 로그인 상태";

    console.log(`${label}을 확인합니다...`);

    /*
     * 변경된 부분.
     *
     * 저장된 세션에 대해서만 별도의 서버 검증을 한다.
     * waitForLogin()의 기존 로그인 흐름에는 영향을 주지 않는다.
     */
    if(await verifySavedAuth(blogId)) {
      console.log("저장된 네이버 로그인 세션을 사용합니다.");

      await minimizeBrowser();

      return;
    }

    console.log("저장된 네이버 로그인 세션이 만료되었거나 블로그 관리 권한이 없습니다.");

    deleteSavedAuthState();
  }

  console.log("네이버 로그인이 필요합니다.");

  await waitForLogin(blogId);
}

async function forceLogin(blogId="") {
  await launchBrowser();

  console.log("네이버 로그인을 다시 진행합니다.");

  await showBrowser();
  await page.goto(LOGIN_URL,{waitUntil:"domcontentloaded",timeout:60000});

  await waitForLogin(blogId);
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
  isDeviceRegistrationPromptVisible,
  closeAuth,
};
