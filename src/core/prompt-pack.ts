/**
 * Shuttle-side *selection* helpers for the Hub-owned Prompt Pack (#154 slice B).
 *
 * The Hub owns the pack format, identity, persistence and lifecycle. This
 * module only normalizes what the Human picked in the Vault picker and names
 * the file used when the already-built pack is attached. It deliberately does
 * not render, parse, or store a pack: doing so would create the second
 * Shuttle-side Prompt Pack model the design ruling forbids.
 */

export interface PromptPackSelection {
  readonly lookupKeys: string[];
  readonly instruction?: string;
}

/**
 * Normalizes a picker selection for the Hub builder: trims keys, drops empty
 * ones, and de-duplicates while preserving picker order. The optional task is
 * sent only when it has visible text, so the Hub's default instruction applies
 * otherwise.
 */
export function buildPromptPackSelection(
  lookupKeys: ReadonlyArray<string | null | undefined>,
  instruction?: string | null
): PromptPackSelection {
  const normalizedKeys: string[] = [];
  for (const value of lookupKeys) {
    const key = (value ?? "").trim();
    if (!key || normalizedKeys.includes(key)) continue;
    normalizedKeys.push(key);
  }

  const trimmedInstruction = (instruction ?? "").trim();
  return trimmedInstruction
    ? { lookupKeys: normalizedKeys, instruction: trimmedInstruction }
    : { lookupKeys: normalizedKeys };
}

/** Attachment filename for a pack that already exists in the Hub. */
export function promptPackFilename(promptKey: string, lookupKey?: string | null): string {
  const base = (lookupKey || promptKey || "prompt-pack")
    .replace(/[\\/]/g, "-")
    .replace(/^\.+/, "")
    .trim();
  return `${base || "prompt-pack"}.md`;
}
