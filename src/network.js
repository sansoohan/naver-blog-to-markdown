function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isNetworkError(error) {
  if (!error) return false;

  if (error.name === "AbortError" || error.name === "TimeoutError") {
    return true;
  }

  if (error instanceof TypeError && error.message === "fetch failed") {
    return true;
  }

  const message = String(error.message || error);

  if (
    message.includes("ERR_INTERNET_DISCONNECTED")
    || message.includes("ERR_NETWORK_CHANGED")
    || message.includes("ERR_CONNECTION_RESET")
    || message.includes("ERR_CONNECTION_REFUSED")
    || message.includes("ERR_CONNECTION_TIMED_OUT")
    || message.includes("ERR_NAME_NOT_RESOLVED")
    || message.includes("Failed to fetch")
    || message.includes("NetworkError")
  ) {
    return true;
  }

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
  while (true) {
    try {
      return await request();
    } catch (error) {
      if (!isNetworkError(error)) throw error;

      const disconnected = await isInternetDisconnected();

      if (!disconnected) {
        throw error;
      }

      console.error("");
      console.error("인터넷 연결이 끊어졌습니다.");
      console.error("연결이 복구될 때까지 기다립니다.");

      while (true) {
        await sleep(5000);

        if (await isInternetDisconnected()) continue;

        try {
          const result = await request();

          console.error("인터넷 연결이 복구되었습니다.");
          console.error("");

          return result;
        } catch (retryError) {
          if (!isNetworkError(retryError)) throw retryError;

          if (!await isInternetDisconnected()) {
            throw retryError;
          }
        }
      }
    }
  }
}

module.exports = {
  isNetworkError,
  withConnectionRetry,
};