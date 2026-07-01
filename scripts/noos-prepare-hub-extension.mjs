import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const rootPackage = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
const distDir = join(rootDir, "dist");
const resourceDir = join(rootDir, "apps", "noos-hub", "src-tauri", "resources", "noos-shuttle-extension");

if (process.platform === "win32") {
  execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm run build"], {
    cwd: rootDir,
    stdio: "inherit",
  });
} else {
  execFileSync("npm", ["run", "build"], {
    cwd: rootDir,
    stdio: "inherit",
  });
}

rmSync(resourceDir, { recursive: true, force: true });
mkdirSync(resourceDir, { recursive: true });
cpSync(distDir, resourceDir, { recursive: true });
writeFileSync(join(resourceDir, ".noos-shuttle-version"), `${rootPackage.version}\n`);

console.log(resourceDir);
