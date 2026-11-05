import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defaultHubStatusForObject, hubVaultRelativePath } from "../src/core/hub-object-path";

/**
 * Issue #152 finding F1: the browser-side mapping must agree with the real Hub
 * handler, not with a mocked receipt. These tests mirror Hub's
 * `object_vault_path` / `status_dir` / `default_status_for_object` and also
 * assert the Hub source still declares the same defaults and reads inbox.
 */
describe("Hub vault path mapping", () => {
  it("defaults a result to results/inbox", () => {
    expect(defaultHubStatusForObject("result")).toBe("inbox");
    expect(defaultHubStatusForObject("crystal")).toBe("active");
    expect(defaultHubStatusForObject("handoff")).toBe("active");
    expect(hubVaultRelativePath("result")).toBe("vault/results/inbox");
  });

  it("honors a known explicit status exactly as Hub's status_dir does", () => {
    expect(hubVaultRelativePath("result", "active")).toBe("vault/results/active");
    expect(hubVaultRelativePath("result", "inbox")).toBe("vault/results/inbox");
    expect(hubVaultRelativePath("result", "accepted")).toBe("vault/results/accepted");
    expect(hubVaultRelativePath("crystal", "archived")).toBe("vault/crystals/archived");
    expect(hubVaultRelativePath("handoff", "sent")).toBe("vault/handoffs/sent");
  });

  it("falls back on an unknown status", () => {
    expect(hubVaultRelativePath("result", "bogus")).toBe("vault/results/inbox");
    expect(hubVaultRelativePath("crystal", "bogus")).toBe("vault/crystals/active");
  });

  it("agrees with the Hub source mapping and its inbox enumerators", () => {
    const hubSource = readFileSync(resolve("apps/noos-hub/src-tauri/src/main.rs"), "utf8").replace(/\s+/g, " ");

    expect(hubSource).toContain('"result" => format!("vault/results/{}", status_dir(status, "inbox"))');
    expect(hubSource).toContain('"result" => "inbox",');
    // Recent reads inbox, and the `results` browse folder enumerates inbox.
    const inboxReads = hubSource.match(/vault\/results\/inbox/g) ?? [];
    expect(inboxReads.length).toBeGreaterThanOrEqual(2);
  });
});
