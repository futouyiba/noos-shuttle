export const NOOS_HTML_BEGIN_MARKER = "<!-- NOOS:HTML:BEGIN -->";
export const NOOS_HTML_END_MARKER = "<!-- NOOS:HTML:END -->";

/**
 * Machine-readable provenance the `OVERVIEW_HTML` payload asks the assistant to
 * embed in the document head. It is read back from the captured bytes; it is
 * never used to render or execute the document.
 */
export interface OverviewProvenance {
  action?: string;
  conversation?: string;
  createdAt?: string;
}

export interface NoosOverview {
  id: string;
  /** The exact HTML document bytes between the markers. Never injected into the page. */
  html: string;
  markerRange: {
    begin: number;
    end: number;
  };
  detectedAt: string;
  provenance?: OverviewProvenance;
  warnings: string[];
}

export interface OverviewCaptureResult {
  overviews: NoosOverview[];
  errors: string[];
}
