/** Type declarations for the scripts/noos-watch-state.mjs pure module (consumed by tests). */

export type ClaimState = "CLAIMED" | "ROUTED" | "UNROUTED" | "DISMISSED";
export type DismissalRule = "D1" | "D2" | "D3" | "D4" | "D5";
export type CommentKind = "delegation-record" | "known-no-wakeup" | "routable" | "unclassified";

export declare const CLAIM_STATES: ClaimState[];
export declare const TERMINAL_CLAIM_STATES: ClaimState[];
export declare const TERMINATABLE_CLAIM_STATES: ClaimState[];
export declare const DISMISSAL_RULES: Record<DismissalRule, string>;
export declare const SPEC_OUTPUT_MARKERS: string[];
export declare const SPEC_VERDICTS: Record<string, string[]>;
export declare const ROUTABLE_MARKERS: Record<string, string[] | null>;
export declare const KNOWN_MARKERS_WITHOUT_WAKEUP: string[];
export declare const ROLE_PREFIXES: string[];

export interface ParsedMarker {
  raw: string;
  role: string | null;
  head: string | null;
  value: string | null;
  verdict: string | null;
  sha: string | null;
  isDelegationRecord: boolean;
  hasProvenance: boolean;
}

export interface Classification {
  kind: CommentKind;
  marker: ParsedMarker;
  criterion?: string;
}

export interface DismissalDecision {
  rule: DismissalRule;
  reason: string;
  evidence: Record<string, unknown>;
}

export interface ThreadComment {
  id: number | string;
  thread: number | string | null;
  body: string;
}

/** 待判条目：`commentId` 是被判的那条，`thread` 是它所在的 issue/PR 号。 */
export interface DismissalCandidate {
  commentId: number | string;
  thread: number | string | null;
  body: string;
}

export interface ClaimEntry {
  state: ClaimState;
  action?: string;
  note?: string;
  claimedAt?: string;
  routedAt?: string;
  deliveredVia?: string;
  dismissRule?: DismissalRule;
  dismissedAt?: string;
  dismissReason?: string;
  dismissEvidence?: Record<string, unknown>;
}

export interface PendingEntry {
  type?: string;
  comment: number | string | null;
  status?: ClaimState;
  marker?: string;
  reason?: string;
  action?: string;
  issue?: number | string | null;
  url?: string;
  recipient?: string | null;
  recipientNote?: string;
  pendingUndelivered?: number;
  dismissRule?: DismissalRule;
  dismissedAt?: string;
  dismissReason?: string;
  dismissEvidence?: Record<string, unknown>;
}

export interface WatcherState {
  schemaVersion?: number;
  watermark: string;
  claims: Record<string, ClaimEntry>;
  pending: PendingEntry[];
  stages?: unknown[];
  health?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface BriefingProjection {
  undelivered: (ClaimEntry & { commentId: string })[];
  unclassified: PendingEntry[];
  channelBlocked: PendingEntry | null;
  dismissed: {
    count: number;
    byRule: Record<string, number>;
    entries: (ClaimEntry & { commentId: string })[];
  };
}

export declare function firstLine(body: unknown): string;
export declare function parseMarker(body: unknown): ParsedMarker;
export declare function isRoutable(marker: ParsedMarker): boolean;
export declare function isSpecVerdict(marker: ParsedMarker): boolean;
export declare function classifyComment(body: unknown): Classification;
export declare function evaluateDismissal(
  candidate: DismissalCandidate,
  threads?: ThreadComment[],
  options?: { confirmedNoRecipient?: boolean }
): DismissalDecision | null;
export declare function evaluateNoRecipientDismissal(
  entry: PendingEntry | null | undefined,
  options?: { confirmedNoRecipient?: boolean }
): DismissalDecision | null;
export declare function applyDismissals(
  state: WatcherState,
  decisions: (DismissalDecision & { commentId: string | number })[],
  now?: string
): WatcherState;
export declare function projectBriefing(state: WatcherState): BriefingProjection;
export declare function renderUndelivered(projection: BriefingProjection): string[];
export declare function renderUnclassified(projection: BriefingProjection): string[];
export declare function renderDismissed(projection: BriefingProjection): string[];
