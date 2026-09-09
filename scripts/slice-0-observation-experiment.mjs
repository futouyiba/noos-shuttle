// Bounded Slice 0 evidence. Fixtures exercise the real MV3 extension; they are
// never provider evidence. --provider probes a fresh unauthenticated browser only.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const providerMode = process.argv.includes("--provider");
const output = resolve(".tmp/slice-0", providerMode ? "provider-attempt.json" : "extension-fixture.json");
const evidence = {
  at: new Date().toISOString(),
  kind: providerMode ? "provider-access-probe" : "real-extension-mocked-provider",
  promptSent: false,
  scenarios: {},
  traces: {}
};
let context;
try {
  context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    executablePath: process.env.NOOS_TEST_EXTENSION_BROWSER_EXECUTABLE || undefined,
    headless: true,
    args: providerMode ? [] : [
      `--disable-extensions-except=${resolve("dist")}`,
      `--load-extension=${resolve("dist")}`,
      // Fixture pages are fulfilled below. Prevent unrelated Hub pairing/network.
      "--proxy-server=http://127.0.0.1:9", "--proxy-bypass-list=<-loopback>"
    ]
  });
  evidence.browser = context.browser().version();
  if (providerMode) {
    const page = await context.newPage();
    const response = await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(3000);
    evidence.httpStatus = response?.status();
    evidence.route = new URL(page.url()).pathname;
    evidence.title = await page.title();
    evidence.visibleComposerCount = await page.locator("textarea:visible, #prompt-textarea:visible").count();
    evidence.scenarios.authenticatedProviderExperiments = "NOT_VERIFIED";
  } else {
    let worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker", { timeout: 10_000 });
    evidence.extensionVersion = await worker.evaluate(() => chrome.runtime.getManifest().version);
    await context.addInitScript(() => {
      window.slice0Trace = [];
      window.addEventListener("noos:runtime-observation", event => {
        const item = JSON.parse(JSON.stringify(event.detail));
        window.slice0Latest = item;
        const previous = window.slice0Trace.at(-1);
        if (!previous || ["state", "sourceEpoch", "carrierRef", "executionInstanceRef", "composerInteractive"]
          .some(key => previous[key] !== item[key])) window.slice0Trace.push(item);
      });
    });
    await context.route("https://chatgpt.com/**", route => route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><main><div data-message-author-role="assistant">fixture</div><textarea id="prompt-textarea"></textarea></main>'
    }));
    const latest = page => page.evaluate(() => window.slice0Latest);
    const waitState = (page, state) => page.waitForFunction(state => window.slice0Latest?.state === state, state, { timeout: 12_000 });
    const trace = async (page, label) => { evidence.traces[label] = await page.evaluate(() => window.slice0Trace); };
    const page = await context.newPage();
    await page.goto("https://chatgpt.com/c/fixture-c1");
    await waitState(page, "READY");
    const before = await latest(page);
    assert.equal(before.carrierIdentityState, "browser-tab");
    assert.equal(before.providerConversationRef, "fixture-c1");
    assert.equal(await page.evaluate(() => window.slice0Trace.some(item => item.state === "GENERATING")), false);
    evidence.scenarios.existingAttach = "PASS";

    await page.evaluate(() => {
      const stop = document.createElement("button");
      stop.dataset.testid = "stop-button";
      stop.textContent = "Stop";
      document.querySelector("main").append(stop);
    });
    await waitState(page, "GENERATING");
    await page.evaluate(() => {
      document.querySelector("button[data-testid='stop-button']").remove();
      document.querySelector("[data-message-author-role='assistant']").textContent = "fixture output";
    });
    await waitState(page, "STABILIZING");
    await waitState(page, "READY");
    evidence.scenarios.generation = "PASS";
    await trace(page, "attach-generation");

    await page.reload();
    await waitState(page, "READY");
    const reloaded = await latest(page);
    assert.equal(reloaded.carrierRef, before.carrierRef);
    assert.equal(reloaded.providerConversationRef, before.providerConversationRef);
    assert.notEqual(reloaded.executionInstanceRef, before.executionInstanceRef);
    evidence.scenarios.reload = "PASS";
    await trace(page, "reload");

    await page.evaluate(() => history.pushState({}, "", "/c/fixture-c2"));
    await page.waitForFunction(() => window.slice0Latest?.providerConversationRef === "fixture-c2");
    assert.notEqual((await latest(page)).state, "READY");
    await waitState(page, "READY");
    assert.equal((await latest(page)).carrierRef, before.carrierRef);
    const changedEpoch = (await latest(page)).sourceEpoch;
    await page.evaluate(old => {
      window.dispatchEvent(new CustomEvent("noos:runtime-observation", { detail: old }));
      document.querySelector("[data-message-author-role='assistant']").textContent = "late DOM work";
    }, before);
    await page.waitForFunction(epoch => window.slice0Latest?.sourceEpoch === epoch, changedEpoch);
    assert.equal((await latest(page)).providerConversationRef, "fixture-c2");
    await waitState(page, "READY");
    evidence.scenarios.sameTabNavigationAndStaleDebugEvent = "PASS";
    // The deliberately forged event is present in the raw debug trace. The
    // following fresh observation proves it did not write back to the ledger.
    await trace(page, "navigation-including-forged-debug-event");

    const duplicate = await context.newPage();
    await duplicate.goto("https://chatgpt.com/c/fixture-c2");
    await waitState(duplicate, "READY");
    assert.notEqual((await latest(duplicate)).carrierRef, (await latest(page)).carrierRef);
    assert.equal((await latest(duplicate)).providerConversationRef, (await latest(page)).providerConversationRef);
    evidence.scenarios.duplicateTab = "PASS";
    await trace(duplicate, "duplicate");

    await worker.evaluate(() => { globalThis.__noosSlice0RestartProbe = "volatile-before-stop"; });
    const session = await context.newCDPSession(page);
    const waitVersion = predicate => new Promise((resolve, reject) => {
      const listener = event => {
        const version = event.versions.find(predicate);
        if (version) { cleanup(); resolve(version); }
      };
      const timer = setTimeout(() => { cleanup(); reject(new Error("worker lifecycle confirmation timed out")); }, 12_000);
      const cleanup = () => { clearTimeout(timer); session.off("ServiceWorker.workerVersionUpdated", listener); };
      session.on("ServiceWorker.workerVersionUpdated", listener);
    });
    const running = waitVersion(item => item.scriptURL === worker.url() && item.runningStatus === "running");
    await session.send("ServiceWorker.enable");
    const originalWorker = await running;
    const stopped = waitVersion(item => item.versionId === originalWorker.versionId && item.runningStatus === "stopped");
    await session.send("ServiceWorker.stopWorker", { versionId: originalWorker.versionId });
    await stopped;
    const restarted = waitVersion(item => item.scriptURL === worker.url() && item.runningStatus === "running");
    await page.reload();
    const newWorker = await restarted;
    assert.ok(newWorker.targetId);
    const markerAfterRestart = await worker.evaluate(() => globalThis.__noosSlice0RestartProbe ?? null);
    assert.equal(markerAfterRestart, null, "worker restart must discard volatile JS state");
    evidence.workerLifecycle = {
      stopConfirmed: true, volatileMarkerCleared: true,
      beforeTarget: originalWorker.targetId, afterTarget: newWorker.targetId
    };
    await waitState(page, "READY");
    assert.equal((await latest(page)).carrierRef, before.carrierRef);
    assert.equal((await latest(page)).providerConversationRef, "fixture-c2");
    assert.notEqual((await latest(page)).executionInstanceRef, reloaded.executionInstanceRef);
    evidence.scenarios.workerRestartAndPageReattach = "PASS";
    await trace(page, "worker-restart");
    await session.detach();

    const fresh = await context.newPage();
    await fresh.goto("https://chatgpt.com/");
    await waitState(fresh, "ATTACHING");
    assert.equal((await latest(fresh)).conversationIdentityState, "unresolved");
    await fresh.evaluate(() => {
      document.querySelector("[data-message-author-role='assistant']").textContent = "fixture generation before identity";
    });
    await waitState(fresh, "GENERATING");
    assert.equal((await latest(fresh)).conversationIdentityState, "unresolved");
    await fresh.evaluate(() => history.pushState({}, "", "/c/fixture-new"));
    await waitState(fresh, "READY");
    evidence.scenarios.unresolvedIdentityToRouteFixture = "PASS";
    evidence.scenarios.realNewConversationIdentityTiming = "NOT_VERIFIED";
    await trace(fresh, "new-identity-fixture");
  }
} catch (error) {
  evidence.error = error.message;
  process.exitCode = 1;
} finally {
  await context?.close();
  await mkdir(resolve(".tmp/slice-0"), { recursive: true });
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ output, ...evidence, traces: Object.keys(evidence.traces) }, null, 2));
}
