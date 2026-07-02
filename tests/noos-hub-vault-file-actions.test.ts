import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { setVaultFileActionDataRuns } from "../apps/noos-hub/src/vault-file-actions";

describe("NOOS Hub vault file action binding", () => {
  it("keeps vault paths out of rendered HTML and sets data-run through the DOM", () => {
    const path = `/Users/me/.noos/vault/handoffs/active/quote-"x"-and-equals=.md`;
    const dom = new JSDOM(`
      <button type="button" data-vault-group="handoffs" data-vault-index="0" data-vault-file-action="open-vault-file">
        Open
      </button>
    `);
    const button = dom.window.document.querySelector<HTMLButtonElement>("button");

    expect(dom.window.document.body.innerHTML).not.toContain(path);
    expect(button?.dataset.run).toBeUndefined();

    setVaultFileActionDataRuns(dom.window.document, [{ id: "handoffs", files: [{ path }] }]);

    expect(button?.dataset.run).toBe(`open-vault-file:${path}`);
    expect(button?.disabled).toBe(false);
  });

  it("disables unresolved vault action buttons", () => {
    const dom = new JSDOM(`
      <button type="button" data-vault-group="handoffs" data-vault-index="3" data-vault-file-action="project-runtime">
        Project
      </button>
    `);
    const button = dom.window.document.querySelector<HTMLButtonElement>("button");

    setVaultFileActionDataRuns(dom.window.document, [{ id: "handoffs", files: [{ path: "/tmp/one.md" }] }]);

    expect(button?.dataset.run).toBeUndefined();
    expect(button?.disabled).toBe(true);
  });

  it("uses direct vault paths without resolving mixed-list indexes", () => {
    const directPath = "/Users/me/.noos/vault/crystals/archived/right.md";
    const dom = new JSDOM(`
      <button
        type="button"
        data-vault-path="${directPath}"
        data-vault-group="crystals"
        data-vault-index="4"
        data-vault-file-action="open-vault-file"
      >
        Open
      </button>
    `);
    const button = dom.window.document.querySelector<HTMLButtonElement>("button");

    setVaultFileActionDataRuns(dom.window.document, [{ id: "crystals", files: [{ path: "/wrong.md" }] }]);

    expect(button?.dataset.run).toBe(`open-vault-file:${directPath}`);
    expect(button?.disabled).toBe(false);
  });
});
