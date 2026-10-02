import {spawn} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, "..");

const args = process.argv.slice(2);

for (let index = 0; index < args.length; index++) {
  if (args[index] === "--output" || args[index] === "-o") {
    if (args[index + 1]) {
      args[index + 1] = path.resolve(PROJECT_ROOT, args[index + 1]);
    }

    break;
  }

  if (args[index].startsWith("--output=")) {
    const outputDir = args[index].slice("--output=".length);
    args[index] = `--output=${path.resolve(PROJECT_ROOT, outputDir)}`;
    break;
  }
}

const client = spawn("npx", ["vite"], {
  stdio: "inherit",
  shell: true,
});

const server = spawn(
  "npm",
  ["run", "dev", "--prefix", "server", "--", ...args],
  {
    stdio: "inherit",
    shell: true,
  }
);

function cleanup() {
  client.kill();
  server.kill();
}

client.on("exit", cleanup);
server.on("exit", cleanup);