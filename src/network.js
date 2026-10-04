function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isNetworkError(error) {
  if (!error) return false;

  if (error instanceof TypeError && error.message === "fetch failed") {
    return true;
  }

  /*
   * Chromium / 브라우저 네트워크 오류는 error.code가 아니라
   * Playwright가 전달하는 error.message 안에 오류 이름이 들어간다.
   */
  const message = String(error.message || error);

  if (
    message.includes("ERR_INTERNET_DISCONNECTED")
    || message.includes("ERR_NETWORK_CHANGED")
    || message.includes("ERR_NETWORK_IO_SUSPENDED")
    || message.includes("ERR_CONNECTION_RESET")
    || message.includes("ERR_CONNECTION_REFUSED")
    || message.includes("ERR_CONNECTION_TIMED_OUT")
    || message.includes("ERR_NAME_NOT_RESOLVED")
    || message.includes("Failed to fetch")
    || message.includes("NetworkError")
  ) {
    return true;
  }

  /*
   * Node.js / OS 네트워크 오류는 error.code 또는
   * error.cause.code에 시스템 오류 코드가 들어간다.
   */
  const code = error.code || error.cause?.code;

  return [
    "ECONNRESET",
    "ECONNREFUSED",
    "ENETDOWN",
    "ENETUNREACH",
    "EHOSTUNREACH",
    "ETIMEDOUT",
    "EAI_AGAIN",
    "ENOTFOUND",
  ].includes(code);
}

async function isInternetDisconnected() {
  try {
    const response = await fetch("https://www.google.com/generate_204", {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });

    return !response.ok;
  } catch {
    return true;
  }
}

async function withConnectionRetry(request) {
  let disconnected = false;

  while (true) {
    try {
      const result = await request();

      if (disconnected) {
        console.error("인터넷 연결이 복구되었습니다.");
        console.error("");
      }

      return result;
    } catch (error) {
      if (!isNetworkError(error)) throw error;

      if (!await isInternetDisconnected()) {
        await sleep(5000);
        throw error;
      }

      if (!disconnected) {
        console.error("");
        console.error("인터넷 연결이 끊어졌습니다.");
        console.error("연결이 복구될 때까지 기다립니다.");
        disconnected = true;
      }

      await sleep(5000);
    }
  }
}

module.exports = {
  isNetworkError,
  withConnectionRetry,
};