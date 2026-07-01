import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";
import { chromium, type Browser, type Page } from "playwright";
import { readFile } from "node:fs/promises";

let browser: Browser;
let contentScript: string;

beforeAll(async () => {
  await build({ configFile: "vite.config.ts", logLevel: "silent" });
  contentScript = await readFile("dist/assets/content.js", "utf8");
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
});

describe("content script smoke flow", () => {
  it("scans handoffs, prefers the latest candidate, and saves through the vault action", async () => {
    const page = await newMockChatPage();

    await clickShuttle(page, ".surface-fab");
    await clickShuttle(page, "[data-action='capture']");
    await waitForShuttleText(page, "选择交接稿");

    const chooserText = await shuttleText(page);
    expect(chooserText).toContain("Latest Browser Capture");
    expect(chooserText).toContain("Older Browser Capture");
    expect(chooserText).not.toContain("Untitled NOOS Thread");

    await clickShuttle(page, "[data-action='choose-thread-0']");
    await waitForShuttleText(page, "Latest Browser Capture");

    const previewText = await shuttleText(page);
    expect(previewText).toContain("复制文本");
    expect(previewText).toContain("下载文件");
    expect(previewText).toContain("存入库");
    expect(previewText).not.toContain("Frontmatter should include");
    expect(previewText).not.toContain("Thread title was not found");

    await clickShuttle(page, "[data-action='vault']");
    await waitForShuttleText(page, "Saved to local NOOS Vault");

    expect(await shuttleText(page)).toContain("Saved to local NOOS Vault: /tmp/latest-browser-capture.md");
    await page.close();
  });

  it("waits for chatbot generation to finish before auto-saving a generated handoff", async () => {
    const page = await newMockChatPage({ autoVault: true, startWithHandoffs: false });

    await page.evaluate((generatedHandoff) => {
      document.querySelector("button")?.addEventListener("click", () => {
        const stopButton = document.createElement("button");
        stopButton.setAttribute("aria-label", "停止生成");
        stopButton.textContent = "stop";
        document.body.append(stopButton);

        window.setTimeout(() => {
          stopButton.remove();
          const article = document.createElement("article");
          const pre = document.createElement("pre");
          pre.textContent = generatedHandoff;
          article.append(pre);
          document.querySelector("main")?.append(article);
        }, 120);
      });
    }, createThread("Generated Async Capture", "generated-async-capture"));

    await clickShuttle(page, ".surface-fab");
    await clickShuttle(page, "[data-action='generate-capture']");
    await waitForShuttleText(page, "Saved to local NOOS Vault");

    const text = await shuttleText(page);
    expect(text).toContain("Generated Async Capture");
    expect(text).toContain("Saved to local NOOS Vault: /tmp/latest-browser-capture.md");
    expect(text).not.toContain("Untitled NOOS Thread");
    await page.close();
  }, 10_000);

  it("captures a crystal and saves its key-oriented artifact", async () => {
    const page = await newMockChatPage({ startWithHandoffs: false, startWithCrystals: true });

    await clickShuttle(page, ".surface-fab");
    await clickShuttle(page, "[data-action='capture-crystal']");
    await waitForShuttleText(page, "选择结晶");

    const chooserText = await shuttleText(page);
    expect(chooserText).toContain("Reusable Product Principle");
    expect(chooserText).toContain("reusable-product-principle");

    await clickShuttle(page, "[data-action='choose-crystal-0']");
    await waitForShuttleText(page, "reusable-product-principle");

    const text = await shuttleText(page);
    expect(text).toContain("结晶已保存");
    expect(text).toContain("reusable-product-principle");
    await page.close();
  });

  it("shows Browser Vault Mirror fallback when Hub is unavailable", async () => {
    const page = await newMockChatPage({ vaultBackend: "downloads_mirror" });

    await clickShuttle(page, ".fab");
    await waitForShuttleText(page, "Browser Vault Mirror");
    expect(await shuttleText(page)).toContain("Hub 未运行，将保存到 Browser Vault Mirror");
    await clickShuttle(page, ".surface-fab");
    await clickShuttle(page, "[data-action='capture']");
    await waitForShuttleText(page, "选择交接稿");
    await clickShuttle(page, "[data-action='choose-thread-0']");
    await waitForShuttleText(page, "存入库");
    await clickShuttle(page, "[data-action='vault']");
    await waitForShuttleText(page, "Saved to Downloads/NOOS/vault/handoffs/active/latest-browser-capture.md");

    await page.close();
  });

  it("downloads generated ChatGPT images only from the selected reply scope", async () => {
    const page = await newMockChatPage({ startWithHandoffs: false });
    await page.evaluate(() => {
      const firstArticle = document.createElement("article");
      firstArticle.innerHTML = `
        <p id="target-reply-text">selected reply</p>
        <img
          alt="Blue character concept"
          width="512"
          height="512"
          src="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='512'%20height='512'%3E%3Crect%20width='512'%20height='512'%20fill='blue'/%3E%3C/svg%3E"
        />
        <img alt="tiny icon" width="32" height="32" src="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='32'%20height='32'%3E%3C/svg%3E" />
      `;
      const secondArticle = document.createElement("article");
      secondArticle.innerHTML = `
        <p>another reply</p>
        <img
          alt="Red environment concept"
          width="512"
          height="512"
          src="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='512'%20height='512'%3E%3Crect%20width='512'%20height='512'%20fill='red'/%3E%3C/svg%3E"
        />
      `;
      document.querySelector("main")?.append(firstArticle, secondArticle);
      const range = document.createRange();
      range.selectNodeContents(document.querySelector("#target-reply-text")!);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });

    await clickShuttle(page, ".surface-fab");
    await clickShuttle(page, "[data-action='download-images']");
    await waitForShuttleText(page, "已下载 1 张图片到 Downloads/NOOS/vault/artifacts/files/chatgpt-images/");

    const request = await page.evaluate(() => (globalThis as unknown as { lastArtifactDownload?: unknown }).lastArtifactDownload);
    expect(request).toMatchObject({
      type: "NOOS_DOWNLOAD_ARTIFACTS",
      directory: expect.stringContaining("chatgpt-images/"),
      files: [{ filename: "01-blue-character-concept.svg" }]
    });
    expect(JSON.stringify(request)).not.toContain("red-environment-concept");
    await page.close();
  });

  it("lists recent Vault objects and attaches a selected object to the current chat", async () => {
    const page = await newMockChatPage({ startWithHandoffs: false, withFileInput: true });

    await clickShuttle(page, ".fab");
    await waitForShuttleText(page, "从 NOOS 导入");

    const openedText = await shuttleText(page);
    expect(openedText).toContain("Latest Handoff From Vault");
    expect(openedText).toContain("Latest Crystal From Vault");

    await clickShuttle(page, "[data-action='select-vault-object-20260521-latest-crystal-b2']");
    await clickShuttle(page, "[data-action='feed-selected-vault-object']");
    await waitForShuttleText(page, "已附加 NOOS 对象");

    const composerText = await page.locator("[role='textbox']").innerText();
    expect(composerText).toContain("请读取我刚刚附上的 NOOS Markdown 文件");
    expect(composerText).toContain("20260521-latest-crystal-b2");

    const fileInputState = await page.locator("input[type='file']").evaluate((input) => {
      const fileInput = input as HTMLInputElement;
      return {
        count: fileInput.files?.length ?? 0,
        names: Array.from(fileInput.files ?? []).map((file) => file.name)
      };
    });
    expect(fileInputState).toEqual({
      count: 2,
      names: ["20260521-latest-handoff-a1.md", "20260521-latest-crystal-b2.md"]
    });
    await page.close();
  });

  it("falls back to inserting Vault object content when the page cannot accept attachments", async () => {
    const page = await newMockChatPage({ startWithHandoffs: false });

    await clickShuttle(page, ".fab");
    await waitForShuttleText(page, "Latest Handoff From Vault");
    await clickShuttle(page, "[data-action='feed-selected-vault-object']");
    await waitForShuttleText(page, "已写入 NOOS 对象正文");

    const composerText = await page.locator("[role='textbox']").innerText();
    expect(composerText).toContain("请基于下面这些 NOOS 对象继续当前对话");
    expect(composerText).toContain("# Latest Handoff From Vault");
    await page.close();
  });

  it("supports multi-selecting Vault objects and browsing them in a larger picker", async () => {
    const page = await newMockChatPage({ startWithHandoffs: false, withFileInput: true });

    await clickShuttle(page, ".fab");
    await waitForShuttleText(page, "从 NOOS 导入");
    await clickShuttle(page, "[data-action='open-vault-picker']");
    await waitForShuttleText(page, "浏览文件库");
    await waitForShuttleText(page, "搜索 Vault");
    await waitForShuttleText(page, "文件夹");
    await waitForShuttleText(page, "匹配对象");

    await clickShuttle(page, "[data-action='set-vault-folder-crystals']");
    await setShuttleInputValue(page, "input[data-action='vault-search']", "crystal");
    await waitForShuttleText(page, "Latest Crystal From Vault");

    await clickShuttle(page, "[data-action='select-vault-object-20260521-latest-crystal-b2']");
    await clickShuttle(page, "[data-action='feed-selected-vault-object']");
    await waitForShuttleText(page, "已附加 NOOS 对象");

    const composerText = await page.locator("[role='textbox']").innerText();
    expect(composerText).toContain("20260521-latest-handoff-a1");
    expect(composerText).toContain("20260521-latest-crystal-b2");

    const fileInputState = await page.locator("input[type='file']").evaluate((input) => {
      const fileInput = input as HTMLInputElement;
      return {
        count: fileInput.files?.length ?? 0,
        names: Array.from(fileInput.files ?? []).map((file) => file.name)
      };
    });
    expect(fileInputState).toEqual({
      count: 2,
      names: ["20260521-latest-handoff-a1.md", "20260521-latest-crystal-b2.md"]
    });
    await page.close();
  });

  it("adds a NOOS import entry near ChatGPT project source areas", async () => {
    const page = await newMockProjectPage();

    await page.locator(".noos-project-import-button").click();
    await waitForShuttleText(page, "从 NOOS 导入");

    const text = await shuttleText(page);
    expect(text).toContain("附加到 Project 源");
    expect(text).toContain("Latest Handoff From Vault");
    expect(text).toContain("Latest Crystal From Vault");

    await clickShuttle(page, "[data-action='feed-selected-vault-object']");
    await waitForShuttleText(page, "已附加到 Project 源");

    const fileInputState = await page.locator("input[type='file']").evaluate((input) => {
      const fileInput = input as HTMLInputElement;
      return {
        count: fileInput.files?.length ?? 0,
        name: fileInput.files?.[0]?.name ?? ""
      };
    });
    expect(fileInputState).toEqual({ count: 1, name: "20260521-latest-handoff-a1.md" });
    expect(await page.locator("nav .noos-project-import-button").count()).toBe(0);
    await page.close();
  });

  it("exports visible ChatGPT Project sources into a NOOS package", async () => {
    const page = await newMockProjectPage();

    await page.locator(".noos-project-export-sources-button").click();
    await waitForShuttleText(page, "已导出 2 个 Project 源条目到 NOOS");

    const saveRequest = await page.evaluate(() => (globalThis as unknown as { lastContextPackSave?: unknown }).lastContextPackSave);
    expect(saveRequest).toMatchObject({
      type: "NOOS_SAVE_CONTEXT_PACK_TO_VAULT",
      directory: expect.stringContaining("chatgpt-project-sources/")
    });
    expect((saveRequest as { files: Array<{ path: string; content: string }> }).files.map((file) => file.path)).toEqual([
      "README.md",
      "manifest.md",
      "sources/001-combat-rules-md.md",
      "sources/002-economy-sheet-xlsx.md"
    ]);
    expect(JSON.stringify(saveRequest)).toContain("Combat Rules.md");
    expect(JSON.stringify(saveRequest)).toContain("Economy Sheet.xlsx");
    await page.close();
  });

  it("adds the Project import entry after ChatGPT SPA navigation", async () => {
    const page = await newMockChatPage({ startWithHandoffs: false });

    await page.evaluate(() => {
      window.history.pushState({}, "", "/g/g-test/project");
      const section = document.createElement("section");
      section.innerHTML = `<h2>Project sources</h2><input type="file" /><ul><li>Design Brief.md</li></ul>`;
      document.querySelector("main")?.append(section);
    });

    await page.locator(".noos-project-import-button").click();
    await waitForShuttleText(page, "附加到 Project 源");
    await page.close();
  });

  it("downloads the selected NOOS object instead of polluting chat when Project upload input is missing", async () => {
    const page = await newMockProjectPage({ withFileInput: false });

    await page.locator(".noos-project-import-button").click();
    await waitForShuttleText(page, "附加到 Project 源");
    await clickShuttle(page, "[data-action='feed-selected-vault-object']");
    await waitForShuttleText(page, "没有找到 Project 源上传入口");

    const textboxes = await page.locator("[role='textbox']").count();
    expect(textboxes).toBe(0);
    await page.close();
  });

  it("shows a Feishu Surface and sends Markdown/Wiki actions to Hub", async () => {
    const page = await newMockFeishuPage();

    await clickShuttle(page, ".surface-fab");
    await waitForShuttleText(page, "飞书文档");
    await waitForShuttleText(page, "导出 MD 并整理 Wiki");
    await waitForShuttleText(page, "仅导出 MD");
    await waitForShuttleText(page, "打开 MD 源目录");
    await waitForShuttleText(page, "打开 Wiki 项目目录");
    await waitForShuttleText(page, "NOOS 到飞书");
    await waitForShuttleText(page, "选择 NOOS Markdown");
    await waitForShuttleText(page, "/tmp/noos/wiki/work");

    await clickShuttle(page, "[data-action='feishu-export-organize']");
    await waitForShuttleText(page, "queued");

    const request = await page.evaluate(() => (globalThis as unknown as { lastFeishuAction?: unknown }).lastFeishuAction);
    expect(request).toMatchObject({
      type: "NOOS_FEISHU_WIKI_ACTION",
      action: "export_md_and_organize",
      url: "https://team.feishu.cn/docx/ABC123"
    });
    expect(request).toHaveProperty("title", "Quarterly Plan");
    expect(request).toHaveProperty("wikiProjectPath", "/tmp/noos/wiki/work");

    await clickShuttle(page, "[data-action='feishu-open-markdown-folder']");
    await waitForShuttleText(page, "opened");
    const openMarkdownRequest = await page.evaluate(() => (globalThis as unknown as { lastFeishuAction?: unknown }).lastFeishuAction);
    expect(openMarkdownRequest).toMatchObject({
      type: "NOOS_FEISHU_WIKI_ACTION",
      action: "open_markdown_folder",
      url: "https://team.feishu.cn/docx/ABC123"
    });

    await clickShuttle(page, "[data-action='feishu-open-wiki-folder']");
    const openWikiRequest = await page.evaluate(() => (globalThis as unknown as { lastFeishuAction?: unknown }).lastFeishuAction);
    expect(openWikiRequest).toMatchObject({
      type: "NOOS_FEISHU_WIKI_ACTION",
      action: "open_wiki_folder",
      url: "https://team.feishu.cn/docx/ABC123"
    });

    await clickShuttle(page, "[data-action='feishu-select-markdown']");
    await waitForShuttleText(page, "用于发布到飞书");
    await clickShuttle(page, "[data-action='feed-selected-vault-object']");
    await waitForShuttleText(page, "已选 Markdown");
    await waitForShuttleText(page, "发布为新文档");
    await waitForShuttleText(page, "覆盖当前文档");

    await clickShuttle(page, "[data-action='feishu-publish-new']");
    await waitForShuttleText(page, "published");
    const publishRequest = await page.evaluate(() => (globalThis as unknown as { lastFeishuPublish?: unknown }).lastFeishuPublish);
    expect(publishRequest).toMatchObject({
      type: "NOOS_FEISHU_PUBLISH_MARKDOWN",
      action: "publish_markdown",
      sourceKey: "20260601-plan-md",
      mode: "create",
      destinationKind: "current_doc",
      url: "https://team.feishu.cn/docx/ABC123"
    });

    await clickShuttle(page, "[data-action='feishu-overwrite-current']");
    await waitForShuttleText(page, "确认覆盖当前飞书文档？");
    await clickShuttle(page, "[data-action='confirm-feishu-overwrite']");
    const overwriteRequest = await page.evaluate(() => (globalThis as unknown as { lastFeishuPublish?: unknown }).lastFeishuPublish);
    expect(overwriteRequest).toMatchObject({
      action: "publish_markdown",
      sourceKey: "20260601-plan-md",
      mode: "overwrite",
      destinationKind: "current_doc"
    });
    await page.close();
  });

  it("shows Feishu publish targets for root and child folders", async () => {
    const rootPage = await newMockFeishuPage({
      url: "https://team.feishu.cn/drive/home",
      title: "飞书文档"
    });

    await clickShuttle(rootPage, ".surface-fab");
    await clickShuttle(rootPage, "[data-action='feishu-select-markdown']");
    await waitForShuttleText(rootPage, "用于发布到飞书");
    await clickShuttle(rootPage, "[data-action='feed-selected-vault-object']");
    await waitForShuttleText(rootPage, "发布到主文件夹");
    expect(await rootPage.locator("[data-action='feishu-overwrite-current']").count()).toBe(0);
    await rootPage.close();

    const folderPage = await newMockFeishuPage({
      url: "https://team.feishu.cn/drive/folder/fldABC123",
      title: "Campaign Docs - 飞书云文档",
      body: "<main><h1 data-noos-folder-title>Campaign Docs</h1></main>"
    });

    await clickShuttle(folderPage, ".surface-fab");
    await clickShuttle(folderPage, "[data-action='feishu-select-markdown']");
    await waitForShuttleText(folderPage, "用于发布到飞书");
    await clickShuttle(folderPage, "[data-action='feed-selected-vault-object']");
    await waitForShuttleText(folderPage, "Campaign Docs");
    await waitForShuttleText(folderPage, "发布到当前文件夹");
    expect(await folderPage.locator("[data-action='feishu-overwrite-current']").count()).toBe(0);
    await folderPage.close();
  });
});

async function newMockChatPage(
  options: {
    autoVault?: boolean;
    startWithHandoffs?: boolean;
    startWithCrystals?: boolean;
    vaultBackend?: "hub_local" | "downloads_mirror";
    withFileInput?: boolean;
  } = {}
): Promise<Page> {
  const page = await browser.newPage();
  await page.addInitScript(({ autoVault, vaultBackend }) => {
    window.localStorage.setItem("noos-shuttle-locale", "zh");
    if (autoVault) {
      window.localStorage.setItem("noos-shuttle-delivery-modes", JSON.stringify(["vault"]));
    }
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        getURL: (path: string) => `chrome-extension://mock/${path}`,
        sendMessage: async (message: { type?: string; lookupKey?: string }) => {
          if (message.type === "NOOS_GET_VAULT_STATUS") {
            return vaultBackend === "downloads_mirror"
              ? { ok: true, hubAvailable: false, paired: false }
              : { ok: true, hubAvailable: true, paired: true };
          }

          if (message.type === "NOOS_GET_VAULT_RECENT" || message.type === "NOOS_BROWSE_VAULT") {
            return {
              ok: true,
              folders: [
                { id: "latest", label: "Latest", kind: "system" },
                { id: "handoffs", label: "Handoffs", kind: "group" },
                { id: "crystals", label: "Crystals", kind: "group" }
              ],
              objects: [
                {
                  object_type: "handoff",
                  lookup_key: "20260521-latest-handoff-a1",
                  title: "Latest Handoff From Vault",
                  path: "/tmp/noos/handoffs/active/20260521-latest-handoff-a1.md",
                  modified_epoch: 1779350000
                },
                {
                  object_type: "crystal",
                  lookup_key: "20260521-latest-crystal-b2",
                  title: "Latest Crystal From Vault",
                  path: "/tmp/noos/crystals/active/20260521-latest-crystal-b2.md",
                  modified_epoch: 1779350100
                }
              ]
            };
          }

          if (message.type === "NOOS_GET_VAULT_OBJECT") {
            const lookupKey = message.lookupKey ?? "20260521-latest-handoff-a1";
            const isCrystal = lookupKey.includes("crystal");
            return {
              ok: true,
              object: {
                object_type: isCrystal ? "crystal" : "handoff",
                lookup_key: lookupKey,
                title: isCrystal ? "Latest Crystal From Vault" : "Latest Handoff From Vault",
                path: `/tmp/noos/${isCrystal ? "crystals" : "handoffs"}/active/${lookupKey}.md`,
                content: isCrystal
                  ? `<!-- NOOS:CRYSTAL:BEGIN -->\n---\ntype: noos_crystal\nlookup_key: ${lookupKey}\ntitle: Latest Crystal From Vault\n---\n\n# Latest Crystal From Vault\n\nKnowledge that should be fed back to ChatGPT.\n\n<!-- NOOS:CRYSTAL:END -->`
                  : `<!-- NOOS:THREAD:BEGIN -->\n---\ntype: noos_thread\nlookup_key: ${lookupKey}\ntitle: Latest Handoff From Vault\n---\n\n# Latest Handoff From Vault\n\nTask context that should be fed back to ChatGPT.\n\n<!-- NOOS:THREAD:END -->`
              }
            };
          }

          if (message.type === "NOOS_DOWNLOAD_ARTIFACTS") {
            (globalThis as unknown as { lastArtifactDownload?: unknown }).lastArtifactDownload = message;
            return {
              ok: true,
              backend: "downloads_mirror",
              count: (message as { files?: unknown[] }).files?.length ?? 0,
              location: `Downloads/NOOS/vault/artifacts/files/${(message as { directory?: string }).directory ?? "chatgpt-images"}`,
              message: "Downloaded artifacts"
            };
          }

          if (vaultBackend === "downloads_mirror") {
            return {
              ok: true,
              backend: "downloads_mirror",
              location: "Downloads/NOOS/vault/handoffs/active/latest-browser-capture.md",
              message: "Saved to Downloads/NOOS/vault/handoffs/active/latest-browser-capture.md. Import it in NOOS Hub."
            };
          }

          return message.type === "NOOS_SAVE_CRYSTAL_TO_VAULT"
            ? {
                ok: true,
                backend: "hub_local",
                location: "/tmp/reusable-product-principle.md",
                message: "Saved to local NOOS Vault: /tmp/reusable-product-principle.md"
              }
            : {
                ok: true,
                backend: "hub_local",
                location: "/tmp/latest-browser-capture.md",
                message: "Saved to local NOOS Vault: /tmp/latest-browser-capture.md"
              };
        },
        lastError: undefined,
        onInstalled: { addListener: () => undefined },
        onMessage: { addListener: () => undefined }
      },
      downloads: { download: async () => 1 },
      storage: { local: { get: async () => ({}), set: async () => undefined, remove: async () => undefined } }
    };
  }, { autoVault: Boolean(options.autoVault), vaultBackend: options.vaultBackend ?? "hub_local" });

  await page.route("https://chatgpt.com/c/noos-content-smoke", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: createMockChatHtml(options.startWithHandoffs ?? true, Boolean(options.startWithCrystals), Boolean(options.withFileInput))
    })
  );
  await page.goto("https://chatgpt.com/c/noos-content-smoke");
  await page.addScriptTag({ content: contentScript });
  return page;
}

async function newMockProjectPage(options: { withFileInput?: boolean } = {}): Promise<Page> {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.localStorage.setItem("noos-shuttle-locale", "zh");
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        getURL: (path: string) => `chrome-extension://mock/${path}`,
        sendMessage: async (message: { type?: string; lookupKey?: string }) => {
          if (message.type === "NOOS_GET_VAULT_STATUS") {
            return { ok: true, hubAvailable: true, paired: true };
          }
          if (message.type === "NOOS_GET_VAULT_RECENT" || message.type === "NOOS_BROWSE_VAULT") {
            return {
              ok: true,
              folders: [
                { id: "latest", label: "Latest", kind: "system" },
                { id: "handoffs", label: "Handoffs", kind: "group" },
                { id: "crystals", label: "Crystals", kind: "group" }
              ],
              objects: [
                {
                  object_type: "handoff",
                  lookup_key: "20260521-latest-handoff-a1",
                  title: "Latest Handoff From Vault",
                  modified_epoch: 1779350000
                },
                {
                  object_type: "crystal",
                  lookup_key: "20260521-latest-crystal-b2",
                  title: "Latest Crystal From Vault",
                  modified_epoch: 1779350100
                }
              ]
            };
          }
          if (message.type === "NOOS_GET_VAULT_OBJECT") {
            const lookupKey = message.lookupKey ?? "20260521-latest-handoff-a1";
            return {
              ok: true,
              object: {
                object_type: "handoff",
                lookup_key: lookupKey,
                title: "Latest Handoff From Vault",
                path: `/tmp/noos/handoffs/active/${lookupKey}.md`,
                content: `<!-- NOOS:THREAD:BEGIN -->\n---\ntype: noos_thread\nlookup_key: ${lookupKey}\ntitle: Latest Handoff From Vault\n---\n\n# Latest Handoff From Vault\n\nTask context for project sources.\n\n<!-- NOOS:THREAD:END -->`
              }
            };
          }
          if (message.type === "NOOS_SAVE_CONTEXT_PACK_TO_VAULT") {
            (globalThis as unknown as { lastContextPackSave?: unknown }).lastContextPackSave = message;
            return {
              ok: true,
              backend: "hub_local",
              location: "/tmp/noos/vault/context-packs/chatgpt-project-sources/mock",
              message: "Context Pack saved to local NOOS Vault"
            };
          }
          return { ok: true };
        },
        lastError: undefined,
        onInstalled: { addListener: () => undefined },
        onMessage: { addListener: () => undefined }
      },
      downloads: { download: async () => 1 },
      storage: { local: { get: async () => ({}), set: async () => undefined, remove: async () => undefined } }
    };
  });

  await page.route("https://chatgpt.com/g/g-test/project", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html>
<html>
  <body>
    <nav aria-label="历史聊天记录">
      <a href="/c/file-sidebar">xlsb文件介绍</a>
    </nav>
    <main>
      <section>
        <h2>Project sources</h2>
        ${options.withFileInput === false ? "" : `<input type="file" />`}
        <ul>
          <li><a href="/project/source/combat-rules">Combat Rules.md</a></li>
          <li><button type="button">Economy Sheet.xlsx</button></li>
        </ul>
      </section>
    </main>
  </body>
</html>`
    })
  );
  await page.goto("https://chatgpt.com/g/g-test/project");
  await page.addScriptTag({ content: contentScript });
  return page;
}

async function newMockFeishuPage(
  options: {
    url?: string;
    title?: string;
    body?: string;
  } = {}
): Promise<Page> {
  const url = options.url ?? "https://team.feishu.cn/docx/ABC123";
  const title = options.title ?? "Quarterly Plan - 飞书云文档";
  const body = options.body ?? "<main><h1>Quarterly Plan</h1></main>";
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.localStorage.setItem("noos-shuttle-locale", "zh");
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        getURL: (path: string) => `chrome-extension://mock/${path}`,
        sendMessage: async (message: { type?: string }) => {
          if (message.type === "NOOS_GET_VAULT_STATUS") {
            return { ok: true, hubAvailable: true, paired: true };
          }
          if (message.type === "NOOS_GET_WIKI_TARGET") {
            return { ok: true, projectPath: "/tmp/noos/wiki/work", message: "Default Wiki project loaded." };
          }
          if (message.type === "NOOS_GET_VAULT_RECENT" || message.type === "NOOS_BROWSE_VAULT") {
            return {
              ok: true,
              objects: [
                {
                  object_type: "result",
                  lookup_key: "20260601-plan-md",
                  key: "20260601-plan-md",
                  title: "NOOS Plan Markdown",
                  path: "/tmp/noos/vault/results/inbox/20260601-plan-md.md"
                }
              ],
              folders: [{ id: "latest", label: "Latest", kind: "system" }]
            };
          }
          if (message.type === "NOOS_GET_VAULT_OBJECT") {
            return {
              ok: true,
              object: {
                object_type: "result",
                lookup_key: "20260601-plan-md",
                key: "20260601-plan-md",
                title: "NOOS Plan Markdown",
                path: "/tmp/noos/vault/results/inbox/20260601-plan-md.md",
                content: "# NOOS Plan Markdown\n\nBody"
              }
            };
          }
          if (message.type === "NOOS_FEISHU_WIKI_ACTION") {
            (globalThis as unknown as { lastFeishuAction?: unknown }).lastFeishuAction = message;
            const action = (message as { action?: string }).action;
            return {
              ok: true,
              status: action?.startsWith("open_") ? "opened" : "queued",
              message: action?.startsWith("open_") ? "Opened folder." : "Feishu MD exported and Wiki organization queued.",
              sourcePath: "/tmp/noos/wiki/work/raw/sources/feishu/feishu-abc123.md",
              wikiProjectPath: "/tmp/noos/wiki/work"
            };
          }
          if (message.type === "NOOS_FEISHU_PUBLISH_MARKDOWN") {
            (globalThis as unknown as { lastFeishuPublish?: unknown }).lastFeishuPublish = message;
            const mode = (message as { mode?: string }).mode;
            return {
              ok: true,
              status: mode === "overwrite" ? "overwritten" : "published",
              message: mode === "overwrite" ? "Current Feishu document overwritten." : "NOOS Markdown published.",
              documentUrl: "https://team.feishu.cn/docx/PUBLISHED"
            };
          }
          return { ok: true };
        },
        lastError: undefined,
        onInstalled: { addListener: () => undefined },
        onMessage: { addListener: () => undefined }
      },
      downloads: { download: async () => 1 },
      storage: { local: { get: async () => ({}), set: async () => undefined, remove: async () => undefined } }
    };
  });

  await page.route("**/*", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>${title}</title></head>
  <body>${body}</body>
</html>`
    })
  );
  await page.goto(url);
  await page.addScriptTag({ content: contentScript });
  return page;
}

function createMockChatHtml(startWithHandoffs: boolean, startWithCrystals: boolean, withFileInput = false): string {
  return `<!doctype html>
<html>
  <body>
    <main>
      ${
        startWithHandoffs
          ? `<article><pre>${escapeHtml(`<!-- NOOS:THREAD:BEGIN -->
\`...\`
<!-- NOOS:THREAD:END -->`)}</pre></article>
      <article><pre>${escapeHtml(createThread("Older Browser Capture", "older-browser-capture"))}</pre></article>
      <article><pre>${escapeHtml(createCollapsedFrontmatterThread())}</pre></article>`
          : ""
      }
      ${startWithCrystals ? `<article><pre>${escapeHtml(createCrystal())}</pre></article>` : ""}
    </main>
    <div role="textbox" contenteditable="true"></div>
    ${withFileInput ? `<input type="file" />` : ""}
    <button aria-label="发送">send</button>
  </body>
</html>`;
}

function createCrystal(): string {
  return `<!-- NOOS:CRYSTAL:BEGIN -->
---
type: noos_crystal
version: 0.1
source_app: chatgpt
source_url: https://chatgpt.com/c/noos-content-smoke
status: active
created_at: 2026-05-20
crystal_key: reusable-product-principle
title: Reusable Product Principle
summary: Handoff is for execution, Crystal is for durable knowledge.
tags:
- noos
- product
preferred_path: .noos/crystals/active/2026-05-20-reusable-product-principle.md
---

# Crystal: Reusable Product Principle

## Confirmed Conclusions
Handoff is for execution; Crystal is for durable knowledge.

## Reasonable Inferences
The UI should keep Handoff primary.

## Open Questions
None.

## 3 Best Entry Points for the Next Round
- Vault file list

<!-- NOOS:CRYSTAL:END -->`;
}

function createThread(title: string, slug: string): string {
  return `<!-- NOOS:THREAD:BEGIN -->
---
type: noos_thread
version: 0.1
source_app: chatgpt
source_url: https://chatgpt.com/c/noos-content-smoke
target_agent: codex
status: active
created_at: 2026-05-20
title: ${title}
filename_slug: ${slug}
tags:
- noos
- shuttle
preferred_path: .noos/handoffs/active/2026-05-20-${slug}.md
---

# Thread: ${title}

## Intent
Validate content-script scanning.

## Context Summary
The test page contains prompt placeholder markers and multiple handoffs.

## Task
Select and save the newest valid handoff.

## Constraints
Ignore placeholder marker examples.

## Acceptance Criteria
- [ ] The newest handoff appears first.

## Suggested Next-Agent Instructions
Continue from the selected handoff.

## Open Questions
None.

<!-- NOOS:THREAD:END -->`;
}

function createCollapsedFrontmatterThread(): string {
  return createThread("Latest Browser Capture", "latest-browser-capture").replace(
    `type: noos_thread
version: 0.1
source_app: chatgpt
source_url: https://chatgpt.com/c/noos-content-smoke
target_agent: codex
status: active
created_at: 2026-05-20
title: Latest Browser Capture
filename_slug: latest-browser-capture`,
    "type: noos_thread version: 0.1 source_app: chatgpt source_url: https://chatgpt.com/c/noos-content-smoke target_agent: codex status: active created_at: 2026-05-20 title: Latest Browser Capture filename_slug: latest-browser-capture"
  );
}

async function clickShuttle(page: Page, selector: string): Promise<void> {
  await page.evaluate((targetSelector) => {
    const button = document.querySelector("#noos-shuttle-root")?.shadowRoot?.querySelector<HTMLElement>(targetSelector);
    button?.click();
  }, selector);
}

async function setShuttleInputValue(page: Page, selector: string, value: string): Promise<void> {
  await page.evaluate(
    ({ targetSelector, inputValue }) => {
      const input = document.querySelector("#noos-shuttle-root")?.shadowRoot?.querySelector<HTMLInputElement>(targetSelector);
      if (!input) {
        return;
      }
      input.value = inputValue;
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: inputValue }));
    },
    { targetSelector: selector, inputValue: value }
  );
}

async function waitForShuttleText(page: Page, text: string): Promise<void> {
  await page.waitForFunction(
    (expectedText) => document.querySelector("#noos-shuttle-root")?.shadowRoot?.querySelector(".shuttle")?.textContent?.includes(expectedText),
    text
  );
}

async function shuttleText(page: Page): Promise<string> {
  return page.evaluate(() => document.querySelector("#noos-shuttle-root")?.shadowRoot?.querySelector(".shuttle")?.textContent ?? "");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
