import { spawn } from "node:child_process";
import process from "node:process";

try {
  process.loadEnvFile(".env");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const child = spawn(executable, process.argv.slice(2), {
  env: process.env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.once("error", (error) => {
  console.error(`Could not start pnpm: ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
