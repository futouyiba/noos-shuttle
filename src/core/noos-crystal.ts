export const NOOS_CRYSTAL_BEGIN_MARKER = "<!-- NOOS:CRYSTAL:BEGIN -->";
export const NOOS_CRYSTAL_END_MARKER = "<!-- NOOS:CRYSTAL:END -->";

export interface NoosCrystalFrontmatter {
  type?: string;
  version?: string;
  source_app?: string;
  source_url?: string;
  status?: string;
  created_at?: string;
  crystal_key?: string;
  title?: string;
  summary?: string;
  tags?: string[];
  preferred_path?: string;
}

export interface NoosCrystal {
  id: string;
  title: string;
  key: string;
  summary: string;
  rawMarkdown: string;
  bodyMarkdown: string;
  frontmatter?: NoosCrystalFrontmatter;
  markerRange: {
    begin: number;
    end: number;
  };
  detectedAt: string;
  warnings: string[];
}

export interface CrystalCaptureResult {
  crystals: NoosCrystal[];
  errors: string[];
}
