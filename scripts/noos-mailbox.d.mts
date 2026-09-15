/** Type declarations for the scripts/noos-mailbox.mjs CLI module (consumed by tests). */
export interface ParsedCliArgs {
  command: string;
  values: Map<string, string | string[]>;
  flags: Set<string>;
}

export interface ParsedMailboxProvenance {
  repository: string;
  issueRef?: string;
  pullRequestRef?: string;
  pullRequestHeadSha?: string;
  commitSha?: string;
  pathRefs: string[];
  blobRefs: string[];
}

export interface ParsedMailboxComment {
  commentRef: string;
  author: string;
  updatedAt: string;
  body: string;
}

export declare function parseArgs(argv: string[]): ParsedCliArgs;
export declare function defaultLedgerPath(issueRef: string): string;
export declare function parseProvenanceInput(value: string): ParsedMailboxProvenance;
export declare function parsePaginatedComments(raw: string, issueRef: string): ParsedMailboxComment[];
export declare class FileMailboxStore {
  constructor(filePath: string);
  read(): Promise<unknown>;
  compareAndSet(expectedRevision: number, next: unknown): Promise<boolean>;
}
