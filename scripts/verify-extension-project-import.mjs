#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const extensionDir = join(repoRoot, "dist");
const hubBase = "http://127.0.0.1:17642";

if (!existsSync(join(extensionDir, "manifest.json"))) {
  fail("dist/manifest.json is missing. Run npm run build first.");
}

const token = await getHubToken();
const recent = await getJson(`${hubBase}/v1/vault/recent`, token);
const first = recent.objects?.find((object) => object.lookup_key || object.key);
if (!first) {
  fail("NOOS Hub returned no recent Vault objects. Save a Handoff or Crystal first.");
}

const userDataDir = await mkdtemp(join(tmpdir(), "noos-shuttle-extension-"));
let context;
try {
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      "--no-first-run",
      "--no-default-browser-check"
    ]
  });

  const existingPages = context.pages();
  const page = await context.newPage();
  await Promise.all(existingPages.map((existingPage) => existingPage.close().catch(() => undefined)));
  await page.route("**/*", (route) => {
    if (route.request().isNavigationRequest() && route.request().frame() === page.mainFrame()) {
      return route.fulfill({
        contentType: "text/html",
        body: projectFixtureHtml()
      });
    }
    return route.abort();
  });

  await page.goto("https://chatgpt.com/g/g-noos-e2e/project", {
    waitUntil: "domcontentloaded",
    timeout: 15_000
  });
  await page.waitForFunction(
    () => Boolean(document.querySelector("#noos-shuttle-root")?.shadowRoot?.querySelector(".shuttle")),
    null,
    { timeout: 10_000 }
  );
  const floatingControls = await page.evaluate(() => {
    const root = document.querySelector("#noos-shuttle-root")?.shadowRoot;
    const primary = root?.querySelector(".fab");
    const surface = root?.querySelector(".surface-fab.surface-fab--chatgpt");
    if (!(primary instanceof HTMLElement) || !(surface instanceof HTMLElement)) {
      return {
        primaryVisible: false,
        surfaceVisible: false,
        surfaceLabel: surface?.textContent?.trim() ?? ""
      };
    }
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    return {
      primaryVisible: isVisible(primary),
      surfaceVisible: isVisible(surface),
      surfaceLabel: surface.textContent?.trim() ?? ""
    };
  });
  if (!floatingControls.primaryVisible || !floatingControls.surfaceVisible || floatingControls.surfaceLabel !== "AI") {
    fail(`NOOS floating controls are incomplete: ${JSON.stringify(floatingControls)}`);
  }
  await page.waitForSelector(".noos-project-import-button", { timeout: 10_000 });
  await page.locator(".noos-project-import-button").click();

  try {
    await page.waitForFunction(
      () => {
        const root = document.querySelector("#noos-shuttle-root")?.shadowRoot;
        const button = root?.querySelector("button[data-action='feed-selected-vault-object']");
        return button instanceof HTMLButtonElement && !button.disabled;
      },
      null,
      { timeout: 10_000 }
    );
  } catch (error) {
    const debug = await page.evaluate(() => {
      const root = document.querySelector("#noos-shuttle-root")?.shadowRoot;
      const button = root?.querySelector("button[data-action='feed-selected-vault-object']");
      return {
        shadowText: root?.querySelector(".shuttle")?.textContent ?? "",
        feedButtonFound: button instanceof HTMLButtonElement,
        feedButtonDisabled: button instanceof HTMLButtonElement ? button.disabled : null
      };
    });
    console.error(JSON.stringify({ ok: false, stage: "vault-selection", debug }, null, 2));
    throw error;
  }

  await page.evaluate(() => {
    const root = document.querySelector("#noos-shuttle-root")?.shadowRoot;
    const button = root?.querySelector("button[data-action='feed-selected-vault-object']");
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("NOOS feed button was not found.");
    }
    button.click();
  });

  try {
    await page.waitForFunction(
      () => {
        const input = document.querySelector("#project-source-input");
        return Boolean(input?.files?.length && input.files[0]?.name.endsWith(".md"));
      },
      null,
      { timeout: 10_000 }
    );
  } catch (error) {
    const debug = await page.evaluate(() => ({
      shadowText: document.querySelector("#noos-shuttle-root")?.shadowRoot?.querySelector(".shuttle")?.textContent ?? "",
      fileCount: document.querySelector("#project-source-input")?.files?.length ?? 0,
      fileName: document.querySelector("#project-source-input")?.files?.[0]?.name ?? "",
      modalText: document.querySelector("#noos-shuttle-root")?.shadowRoot?.querySelector(".modal")?.textContent ?? ""
    }));
    console.error(JSON.stringify({ ok: false, debug }, null, 2));
    throw error;
  }

  const result = await page.$eval("#project-source-input", (input) => {
    return {
      count: input.files?.length ?? 0,
      name: input.files?.[0]?.name ?? ""
    };
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        verified: "extension_project_import",
        floatingControls,
        sourceObject: {
          type: first.object_type,
          key: first.lookup_key ?? first.key,
          title: first.title
        },
        attachedFile: result
      },
      null,
      2
    )
  );
} finally {
  await context?.close().catch(() => undefined);
  await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
}

async function getHubToken() {
  const response = await fetch(`${hubBase}/pair`, {
    headers: {
      Origin: "chrome-extension://noos-shuttle-verify"
    }
  }).catch((error) => fail(`NOOS Hub is not reachable at ${hubBase}: ${error.message}`));
  if (!response.ok) {
    fail(`NOOS Hub /pair failed: HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (!payload.token) {
    fail("NOOS Hub /pair did not return a token.");
  }
  return payload.token;
}

async function getJson(url, token) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  if (!response.ok) {
    fail(`${url} failed: HTTP ${response.status}`);
  }
  return response.json();
}

function projectFixtureHtml() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>NOOS Project Import Fixture</title>
    <style>
      body { margin: 0; font-family: system-ui, sans-serif; }
      main { padding: 32px; }
      section { max-width: 720px; border: 1px solid #d7ded9; border-radius: 8px; padding: 18px; }
    </style>
  </head>
  <body>
    <main>
      <section>
        <h2>Project sources</h2>
        <p>This fixture mimics a ChatGPT Project source area with a local file input.</p>
        <input id="project-source-input" type="file" />
      </section>
    </main>
  </body>
</html>`;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
