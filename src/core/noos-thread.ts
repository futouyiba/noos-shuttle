export const NOOS_BEGIN_MARKER = "<!-- NOOS:THREAD:BEGIN -->";
export const NOOS_END_MARKER = "<!-- NOOS:THREAD:END -->";

export type NoosThreadStatus = "active" | "done" | "draft";

export interface NoosThreadFrontmatter {
  type?: string;
  version?: string;
  source_app?: string;
  source_url?: string;
  target_agent?: string;
  status?: NoosThreadStatus | string;
  created_at?: string;
  handoff_revision?: string;
  title?: string;
  handoff_key?: string;
  filename_slug?: string;
  tags?: string[];
  preferred_path?: string;
}

export interface NoosThread {
  id: string;
  title: string;
  rawMarkdown: string;
  frontmatter?: NoosThreadFrontmatter;
  bodyMarkdown: string;
  markerRange: {
    begin: number;
    end: number;
  };
  detectedAt: string;
  warnings: string[];
}

export interface CaptureResult {
  threads: NoosThread[];
  errors: string[];
}
