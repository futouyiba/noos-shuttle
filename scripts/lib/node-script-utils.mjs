import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const isWindows = process.platform === "win32";

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    shell: options.shell ?? false,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
  }
}

export function runNpm(args, options = {}) {
  const npmCliPath =
    process.env.npm_execpath ||
    (isWindows ? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js") : "");

  if (npmCliPath && fs.existsSync(npmCliPath)) {
    run(process.execPath, [npmCliPath, ...args], options);
    return;
  }

  run(isWindows ? "npm.cmd" : "npm", args, { ...options, shell: isWindows });
}
