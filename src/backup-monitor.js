const fs = require("fs");
const path = require("path");

let logFile = "";
let currentPost = null;
let completed = true;
let handlersInstalled = false;
let outputLoggingInstalled = false;

const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);

function getTimestamp() {
  const now = new Date();
  const offset = -now.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
  const minutes = String(Math.abs(offset) % 60).padStart(2, "0");

  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}.${String(now.getMilliseconds()).padStart(3, "0")}${sign}${hours}:${minutes}`;
}

function getLogFilename() {
  const now = new Date();

  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");

  return `backup-${timestamp}.log`;
}

function getCommand() {
  return [
    process.execPath,
    ...process.argv.slice(1),
  ].map(value => {
    if (!/\s/.test(value)) return value;

    return `"${value.replace(/"/g, '\\"')}"`;
  }).join(" ");
}

function writeOutput(chunk) {
  if (!logFile) return;

  try {
    fs.appendFileSync(logFile, chunk, "utf8");
  } catch (error) {
    originalStderrWrite(`백업 로그 기록 실패: ${error.message}\n`);
  }
}

function installOutputLogging() {
  if (outputLoggingInstalled) return;

  outputLoggingInstalled = true;

  process.stdout.write = function(chunk, encoding, callback) {
    writeOutput(chunk);
    return originalStdoutWrite(chunk, encoding, callback);
  };

  process.stderr.write = function(chunk, encoding, callback) {
    writeOutput(chunk);
    return originalStderrWrite(chunk, encoding, callback);
  };
}

function formatCurrentPost() {
  if (!currentPost) return "";

  return `[${currentPost.index}/${currentPost.total}] ${currentPost.logNo} ${currentPost.title || ""}`.trim();
}

function logCurrentPost() {
  const post = formatCurrentPost();

  if (!post) return;

  console.error(`처리 중이던 글: ${post}`);
}

function installHandlers() {
  if (handlersInstalled) return;

  handlersInstalled = true;

  process.on("beforeExit", code => {
    if (completed) return;

    const message = `예상하지 못한 종료: beforeExit (${code})`;

    console.error(`\n${message}`);
    logCurrentPost();
  });

  process.on("uncaughtException", error => {
    console.error("\n처리되지 않은 예외:", error);

    logCurrentPost();

    process.exitCode = 1;
  });

  process.on("unhandledRejection", reason => {
    console.error("\n처리되지 않은 Promise 오류:", reason);

    logCurrentPost();

    process.exitCode = 1;
  });
}

function start(outputDir, blogId, total) {
  const outputRoot = outputDir
    ? path.resolve(outputDir)
    : path.join(process.cwd(), "output");

  fs.mkdirSync(outputRoot, {recursive: true});

  logFile = path.join(outputRoot, getLogFilename());
  currentPost = null;
  completed = false;

  installOutputLogging();
  installHandlers();

  console.log(`COMMAND ${getCommand()}`);
  console.log(`백업 시작: ${blogId} / 전체 ${total}개`);
}

function startPost(index, total, post) {
  currentPost = {
    index,
    total,
    logNo: post.logNo,
    title: post.title,
  };

  console.log(`START ${formatCurrentPost()}`);
}

function completePost() {
  console.log(`COMPLETE ${formatCurrentPost()}`);
  currentPost = null;
}

function failPost(error) {
  const post = formatCurrentPost();
  const detail = error instanceof Error
    ? error.stack || error.message
    : String(error);

  console.error(`FAILED ${post}`);
  console.error(detail);

  currentPost = null;
}

function complete(blogId, result) {
  currentPost = null;
  completed = true;

  console.log(
    `백업 완료: ${blogId} / 전체 ${result.total}개 / 신규 ${result.created} / 업데이트 ${result.updated} / 건너뜀 ${result.skipped} / 실패 ${result.failed}`
  );
}

module.exports = {
  start,
  startPost,
  completePost,
  failPost,
  complete,
};