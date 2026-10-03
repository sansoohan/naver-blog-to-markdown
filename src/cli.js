const fs = require("fs");
const path = require("path");
const {closeNaverRequest} = require("./naver-request");

function parseArgs(argv) {
  const args = argv.slice(2);
  const positional = [];

  let includePrivate = false;
  let update = false;
  let useCache = false;
  let outputDir = "";

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];

    if (arg === "--private" || arg === "-p") {
      includePrivate = true;
      continue;
    }

    if (arg === "--update" || arg === "-u") {
      update = true;
      continue;
    }

    if (arg === "--cache" || arg === "-c") {
      useCache = true;
      continue;
    }

    if (arg === "--output" || arg === "-o") {
      outputDir = args[++index] || "";

      if (!outputDir) throw new Error(`${arg} 뒤에 출력 폴더를 지정해주세요.`);
      continue;
    }

    if (arg.startsWith("-")) throw new Error(`알 수 없는 옵션: ${arg}`);

    positional.push(arg);
  }

  return {
    positional,
    includePrivate,
    update,
    useCache,
    outputDir,
  };
}

function getUsage(command, positional) {
  return `사용법: npm run ${command} -- ${positional} `
    + '[-p|--private] [-u|--update] [-c|--cache] [-o|--output "폴더"]';
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function cleanupDeadTempDirectories(outputRoot) {
  const tempRoot = path.join(outputRoot, ".tmp");

  if (!fs.existsSync(tempRoot)) return;

  for (const entry of fs.readdirSync(tempRoot, {withFileTypes: true})) {
    if (!entry.isDirectory()) continue;

    const match = entry.name.match(/_(\d+)_(\d+)$/);

    if (!match) continue;

    const pid = Number(match[1]);

    if (isProcessRunning(pid)) continue;

    fs.rmSync(path.join(tempRoot, entry.name), {
      recursive: true,
      force: true,
    });
  }
}

function cleanupCurrentProcessTempDirectories(outputRoot) {
  const tempRoot = path.join(outputRoot, ".tmp");

  if (!fs.existsSync(tempRoot)) return;

  for (const entry of fs.readdirSync(tempRoot, {withFileTypes: true})) {
    if (!entry.isDirectory()) continue;

    const match = entry.name.match(/_(\d+)_(\d+)$/);

    if (!match || Number(match[1]) !== process.pid) continue;

    fs.rmSync(path.join(tempRoot, entry.name), {
      recursive: true,
      force: true,
    });
  }
}

async function runCli(options) {
  const {
    command,
    positional,
    validate,
    getBlogId,
    run,
  } = options;

  let includePrivate = false;
  let outputRoot = "";

  const cleanup = () => {
    if (!outputRoot) return;

    try {
      cleanupCurrentProcessTempDirectories(outputRoot);
    } catch {}
  };

  const handleSignal = signal => {
    cleanup();

    process.removeListener("SIGINT", handleSigint);
    process.removeListener("SIGTERM", handleSigterm);

    process.kill(process.pid, signal);
  };

  const handleSigint = () => handleSignal("SIGINT");
  const handleSigterm = () => handleSignal("SIGTERM");

  process.on("SIGINT", handleSigint);
  process.on("SIGTERM", handleSigterm);

  try {
    const args = parseArgs(process.argv);

    includePrivate = args.includePrivate;
    outputRoot = args.outputDir
      ? path.resolve(args.outputDir)
      : path.join(process.cwd(), "output");

    cleanupDeadTempDirectories(outputRoot);

    if (validate && !validate(args.positional)) {
      throw new Error(getUsage(command, positional));
    }

    if (includePrivate) {
      const blogId = getBlogId(args.positional);
      const {ensureLogin} = require("./auth");

      await ensureLogin(blogId);
    }

    await run(args);
  } catch (error) {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  } finally {
    cleanup();

    process.removeListener("SIGINT", handleSigint);
    process.removeListener("SIGTERM", handleSigterm);

    await closeNaverRequest();

    if (includePrivate) {
      const {closeAuth} = require("./auth");
      await closeAuth();
    }
  }
}

module.exports = {
  parseArgs,
  runCli,
};