/**
 * Vault directory mapping for objects the Shuttle writes through Hub's
 * `/v1/ingest` (issue #152 finding F1).
 *
 * This mirrors the Hub's own `object_vault_path` / `status_dir` /
 * `default_status_for_object` in `apps/noos-hub/src-tauri/src/main.rs`.
 * Result is the one object type whose default status is `inbox`; every other
 * type defaults to `active`. A caller that sends an explicit `suggested.status`
 * overrides that default, so the Result payload must omit it (or send `inbox`)
 * to land where browse and recent actually read.
 *
 * The Downloads mirror uses the same mapping so the two recovery paths cannot
 * drift apart.
 */

const KNOWN_STATUSES = new Set(["active", "done", "archived", "curated", "accepted", "inbox", "sent"]);

export function defaultHubStatusForObject(objectType: string): "inbox" | "active" {
  return objectType === "result" ? "inbox" : "active";
}

/** Rust `status_dir`: only known statuses are honored; anything else falls back. */
function statusDir(suggestedStatus: string | undefined, fallback: string): string {
  return suggestedStatus && KNOWN_STATUSES.has(suggestedStatus) ? suggestedStatus : fallback;
}

/** Rust `object_vault_path`, returning a path relative to the NOOS home. */
export function hubVaultRelativePath(objectType: string, suggestedStatus?: string): string {
  switch (objectType) {
    case "crystal":
      return `vault/crystals/${statusDir(suggestedStatus, "active")}`;
    case "result":
      return `vault/results/${statusDir(suggestedStatus, "inbox")}`;
    case "artifact":
      return "vault/artifacts/sidecars";
    case "context_pack_file":
      return "vault/context-packs";
    case "context_pack":
      return `vault/packs/context/${statusDir(suggestedStatus, "active")}`;
    case "prompt_pack":
      return `vault/packs/prompt/${statusDir(suggestedStatus, "active")}`;
    case "brief":
      return `vault/briefs/${statusDir(suggestedStatus, "active")}`;
    case "reference":
      return "vault/references/briefs";
    case "thread":
      return `vault/threads/${statusDir(suggestedStatus, "active")}`;
    default:
      return `vault/handoffs/${statusDir(suggestedStatus, "active")}`;
  }
}
