/**
 * Marker and shape for chatbot-returned `NOOS:RESULT` objects (issue #152).
 *
 * This is the chatbot-side counterpart of the coding-agent result channel in
 * `result-delivery.ts` / `deliver-child-result.ts`; the two are unrelated and
 * the Harness channel is deliberately untouched. Results land in
 * `vault/results/inbox` through Hub's existing `/v1/ingest` validation.
 */
export const NOOS_RESULT_BEGIN_MARKER = "<!-- NOOS:RESULT:BEGIN -->";
export const NOOS_RESULT_END_MARKER = "<!-- NOOS:RESULT:END -->";

export interface NoosResultFrontmatter {
  type?: string;
  version?: string;
  source_app?: string;
  source_url?: string;
  status?: string;
  created_at?: string;
  result_key?: string;
  title?: string;
  summary?: string;
  producer?: string;
  input_refs?: string[];
  review_status?: string;
  promotes_to?: string;
  tags?: string[];
  preferred_path?: string;
}

export interface NoosResult {
  id: string;
  title: string;
  key: string;
  summary: string;
  rawMarkdown: string;
  bodyMarkdown: string;
  frontmatter?: NoosResultFrontmatter;
  markerRange: {
    begin: number;
    end: number;
  };
  detectedAt: string;
  warnings: string[];
}

export interface ResultCaptureResult {
  results: NoosResult[];
  errors: string[];
}
