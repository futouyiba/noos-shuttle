import {
  NOOS_HTML_BEGIN_MARKER,
  NOOS_HTML_END_MARKER,
  type NoosOverview,
  type OverviewCaptureResult,
  type OverviewProvenance
} from "./noos-html";

/**
 * Capture predicate for `OVERVIEW_HTML` artifacts (issue #61 slice 4, proposal
 * §6 Q10). It is the third instance of the same marker-capture shape as
 * `captureNoosThreads` / `captureNoosCrystals`: find a begin marker, find the
 * matching end marker, keep the exact bytes in between.
 *
 * The captured document is returned as an inert string. It is never parsed with
 * `innerHTML`, inserted into the page, or evaluated: the only consumer writes it
 * to a Blob and downloads it (proposal §6 Q9/Q11).
 */
export function captureNoosOverviews(source: string, detectedAt = new Date().toISOString()): OverviewCaptureResult {
  const overviews: NoosOverview[] = [];
  const errors: string[] = [];
  let searchFrom = 0;

  while (searchFrom < source.length) {
    const begin = source.indexOf(NOOS_HTML_BEGIN_MARKER, searchFrom);
    if (begin === -1) {
      break;
    }

    const bodyStart = begin + NOOS_HTML_BEGIN_MARKER.length;
    const endMarkerStart = source.indexOf(NOOS_HTML_END_MARKER, bodyStart);
    if (endMarkerStart === -1) {
      errors.push("Found a NOOS HTML begin marker without a matching end marker.");
      break;
    }

    const end = endMarkerStart + NOOS_HTML_END_MARKER.length;
    const html = source.slice(bodyStart, endMarkerStart).trim();
    searchFrom = end;

    if (!html || isPlaceholderOverview(html)) {
      continue;
    }

    const provenance = parseOverviewProvenance(source.slice(begin, end));
    const warnings = validateOverview(html, provenance);
    overviews.push({
      id: `${detectedAt}-${begin}`,
      html,
      markerRange: { begin, end },
      detectedAt,
      provenance,
      warnings
    });
  }

  return { overviews, errors };
}

/**
 * Read the provenance meta the payload asked the assistant to embed. Absence is
 * a warning rather than a capture failure: the submission ledger already holds
 * the durable provenance, and this line is the artifact-level copy that
 * proposal §5.5 requires.
 */
export function parseOverviewProvenance(capture: string): OverviewProvenance | undefined {
  const metaTag = capture.match(/<meta\b[^>]*\bname\s*=\s*["']noos-provenance["'][^>]*>/i)?.[0];
  const content = metaTag?.match(/\bcontent\s*=\s*(["'])([\s\S]*?)\1/i)?.[2];
  if (!content) {
    return undefined;
  }

  const provenance: OverviewProvenance = {};
  // Split only before the next `key=` field. A plain `;` also appears inside
  // escaped entities (`&quot;`, `&amp;`), so an unconditional split would cut
  // a value in half before it is decoded.
  for (const rawPart of content.split(/;\s*(?=[A-Za-z_]+\s*=)/)) {
    const separator = rawPart.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = rawPart.slice(0, separator).trim();
    const value = decodeHtmlEntities(rawPart.slice(separator + 1).trim());
    if (key === "action") provenance.action = value;
    else if (key === "conversation") provenance.conversation = value;
    else if (key === "created_at") provenance.createdAt = value;
  }

  return Object.keys(provenance).length > 0 ? provenance : undefined;
}

/** Best-effort human filename source; the caller still slugifies it. */
export function deriveOverviewTitle(html: string): string {
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const heading = title ?? html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  if (!heading) {
    return "";
  }

  return decodeHtmlEntities(heading.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function validateOverview(html: string, provenance: OverviewProvenance | undefined): string[] {
  const warnings: string[] = [];
  if (!provenance) {
    warnings.push("Missing noos-provenance meta; artifact-level provenance is unavailable.");
  }
  if (!/<[a-z][^>]*>/i.test(html)) {
    warnings.push("Captured overview does not look like an HTML document.");
  }
  return warnings;
}

function isPlaceholderOverview(html: string): boolean {
  // A bare instruction echo (the marker names without a document) is not an
  // artifact. Real content always carries at least one HTML tag.
  return /^NOOS:HTML:(BEGIN|END)$/.test(html);
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
