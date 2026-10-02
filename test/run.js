import {spawn} from "node:child_process";

const args = process.argv.slice(2);

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