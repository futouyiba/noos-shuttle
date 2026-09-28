#!/usr/bin/env node
/**
 * Behavioral verification for #130 (Hub per-pane scrolling).
 *
 * Loads the BUILT Hub stylesheet against a minimal skeleton of the real shell
 * (body > #app > .sidebar + .workspace > tall .content) and scrolls the
 * workspace. Before the fix the page itself scrolled and the sidebar rode out
 * of view; after it, the sidebar must stay pinned (its viewport top unchanged)
 * and the document must not scroll.
 *
 * Usage: node scripts/verify-hub-shell-scroll.mjs [path-to-built.css]
 *   (defaults to the newest apps/noos-hub/dist/assets/*.css)
 * Exit 0 = pinned (fix present); exit 1 = sidebar scrolled away (regression).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const cssDir = "apps/noos-hub/dist/assets";
const arg = process.argv[2];
const cssPath =
  arg ?? join(cssDir, readdirSync(cssDir).filter(f => f.endsWith(".css")).sort().pop());
const css = readFileSync(cssPath, "utf8");

const html = `<!doctype html><html><head><style>${css}</style></head><body>
  <div id="app">
    <nav class="sidebar"><div>NAV-1</div><div>NAV-2</div></nav>
    <main class="workspace"><div class="content" style="flex:none; height:4000px">tall</div></main>
  </div></body></html>`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.setContent(html, { waitUntil: "load" });

const before = await page.evaluate(() => {
  const sidebar = document.querySelector(".sidebar").getBoundingClientRect();
  return { sidebarTop: sidebar.top, docScrollHeight: document.documentElement.scrollHeight };
});
await page.evaluate(() => {
  const workspace = document.querySelector(".workspace");
  workspace.scrollTop = 800;
});
const after = await page.evaluate(() => ({
  workspaceScrollTop: document.querySelector(".workspace").scrollTop,
  sidebarTop: document.querySelector(".sidebar").getBoundingClientRect().top,
  bodyScrollTop: document.documentElement.scrollTop || document.body.scrollTop
}));

await browser.close();

const pinned = before.sidebarTop === after.sidebarTop && after.workspaceScrollTop === 800;
console.log(JSON.stringify({ cssPath, before, after, pinned }, null, 2));
process.exit(pinned ? 0 : 1);
