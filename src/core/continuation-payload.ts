import type { ShuttleLocale } from "../shared/i18n";

/**
 * Canonical provider-facing continuation payload registry (issue #60).
 *
 * This is the single definition site for the literals the harness sends to the
 * provider as a continuation turn. It is deliberately separate from the UI
 * `COPY` table in `src/shared/i18n.ts`: those strings are read by humans in the
 * Shuttle panel, these are read by the assistant and are part of the
 * continuation contract.
 *
 * Internal identities do not change here. `SubmissionOperationKind="GO"` and the
 * `PLAIN_GO | REANCHOR_GO` continuation modes stay internal ledger/evaluator
 * contracts; only the dispatched literal varies by locale. Acceptance still
 * matches on the exact dispatched bytes, so the payload built here is what the
 * submission ledger fingerprints.
 */

export type ContinuationPayloadMode = "PLAIN_GO" | "REANCHOR_GO";

export interface ContinuationPayloadDefinition {
  /** Provider-facing token for a plain continuation round. */
  readonly continuationToken: string;
  /** Goal restatement used when the run carries no frozen goal text. */
  readonly defaultGoal: string;
  /**
   * Re-anchor wrapper. Semantically equivalent across locales — the wording may
   * differ, the contract may not. Do not add fields here to expand re-anchor.
   */
  readonly reanchor: {
    readonly header: string;
    readonly footer: string;
    readonly goalLabel: string;
    readonly instruction: string;
  };
}

export const CONTINUATION_PAYLOADS: Readonly<Record<ShuttleLocale, ContinuationPayloadDefinition>> = {
  zh: {
    continuationToken: "继续",
    defaultGoal: "继续执行你自己声明的下一步；不要展开可选支线",
    reanchor: {
      header: "[NOOS Re-anchor]",
      footer: "[/NOOS Re-anchor]",
      goalLabel: "Current Goal",
      instruction: "保持当前范围；不要展开可选支线。在完成、或到达 Human/review/evidence 边界时停止。"
    }
  },
  en: {
    continuationToken: "go on",
    defaultGoal: "Continue your own stated next step; do not expand optional follow-ups",
    reanchor: {
      header: "[NOOS Re-anchor]",
      footer: "[/NOOS Re-anchor]",
      goalLabel: "Current Goal",
      instruction: "Keep current scope; do not expand optional follow-ups. Stop if completion or a Human/review/evidence boundary is reached."
    }
  }
};

export function continuationPayloadDefinition(locale: ShuttleLocale): ContinuationPayloadDefinition {
  return CONTINUATION_PAYLOADS[locale];
}

/**
 * Build the exact provider-facing payload for one continuation round. This is
 * the only production site that produces these literals; consumers reference it
 * rather than re-typing the token.
 */
export function buildContinuationPayload(locale: ShuttleLocale, mode: ContinuationPayloadMode, goalText?: string): string {
  const definition = continuationPayloadDefinition(locale);
  if (mode === "PLAIN_GO") return definition.continuationToken;
  const goal = goalText?.trim() || definition.defaultGoal;
  return [
    definition.continuationToken,
    "",
    definition.reanchor.header,
    `${definition.reanchor.goalLabel}: ${goal}`,
    definition.reanchor.instruction,
    definition.reanchor.footer
  ].join("\n");
}
