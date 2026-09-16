export const UI_IMPACT_SCHEMA = "noos.ui-impact.v0";
export const UI_IMPACT_DETECTOR_VERSION = "0.1";

const LEVEL_RANK = { U0: 0, U1: 1, U2: 2, U3: 3 };

const REVIEW_EVIDENCE_PREFIXES = [".review-assets/"];
const HUB_ASSET_PREFIX = "apps/noos-hub/src/assets/";
const HUB_PAGE_PREFIX = "apps/noos-hub/src/pages/";
const HUB_UI_PREFIX = "apps/noos-hub/src/ui/";
const HUB_TEST_PREFIXES = ["tests/noos-hub", "apps/noos-hub/src/"];

const HUB_UI_EXACT = new Set([
  "apps/noos-hub/src/main.ts",
  "apps/noos-hub/src/routes.ts",
  "apps/noos-hub/src/styles.css",
]);

const GLOBAL_STYLE_PATTERN = /(^|\n)[+-](?![+-])[^\n]*(?:\:root\b|#app\b|\.sidebar\b|\.topbar\b|\.workspace\b|\.content\b|\.brand\b|\.nav-|\bnav\s*\{|\bnav\s+button)/m;
const SHELL_PATTERN = /(?:sectionMeta|navItems|renderShell|navButton|data-section=|class=["'][^"']*(?:sidebar|topbar|brand))/;
const USER_ACTION_PATTERN = /(^|\n)[+-](?![+-])[^\n]*(?:<button\b|<a\b|data-run=|data-action=|href=["']#|invoke\s*\()/m;
const RESPONSIVE_PATTERN = /(^|\n)[+-](?![+-])[^\n]*@media\b/m;
const COPY_PATTERN = /(?:apps\/noos-hub\/src\/ui\/copy\.|locales?|i18n)/i;

function maxLevel(a, b) {
  return LEVEL_RANK[b] > LEVEL_RANK[a] ? b : a;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function fileDiff(diffByFile, file) {
  if (!diffByFile) return "";
  if (diffByFile instanceof Map) return diffByFile.get(file) ?? "";
  return diffByFile[file] ?? "";
}

function isHubUiSource(file) {
  return (
    HUB_UI_EXACT.has(file) ||
    file.startsWith(HUB_PAGE_PREFIX) ||
    file.startsWith(HUB_UI_PREFIX) ||
    file.startsWith(HUB_ASSET_PREFIX)
  );
}

function isReviewEvidence(file) {
  return REVIEW_EVIDENCE_PREFIXES.some((prefix) => file.startsWith(prefix));
}

function isHubUiTest(file) {
  return file.startsWith("tests/noos-hub") || file.includes("/noos-hub/") && /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
}

function surfaceFor(file) {
  if (file === "apps/noos-hub/src/main.ts") return "Shell";
  if (file === "apps/noos-hub/src/routes.ts") return "Routing";
  if (file === "apps/noos-hub/src/styles.css") return "Shared styles";
  if (file.startsWith(HUB_PAGE_PREFIX)) {
    return `Page:${file.slice(HUB_PAGE_PREFIX.length).replace(/\.[^.]+$/, "")}`;
  }
  if (file.startsWith(HUB_UI_PREFIX)) {
    return `UI:${file.slice(HUB_UI_PREFIX.length).replace(/\.[^.]+$/, "")}`;
  }
  if (file.startsWith(HUB_ASSET_PREFIX)) return "Assets";
  if (isReviewEvidence(file)) return "Review evidence";
  if (isHubUiTest(file)) return "UI tests";
  return null;
}

export function classifyUiImpact({ baseSha, headSha, changedFiles, diffByFile = {} }) {
  if (!Array.isArray(changedFiles)) throw new Error("changedFiles must be an array");

  const files = uniqueSorted(changedFiles.filter(Boolean));
  const relevantFiles = files.filter((file) => isHubUiSource(file) || isReviewEvidence(file) || isHubUiTest(file));
  const uiFiles = relevantFiles.filter(isHubUiSource);
  const evidenceFiles = relevantFiles.filter((file) => isReviewEvidence(file) || isHubUiTest(file));
  const surfaces = uniqueSorted(relevantFiles.map(surfaceFor).filter(Boolean));

  const flags = {
    navigation_changed: false,
    shell_changed: false,
    global_styles_changed: false,
    user_action_surface_changed: false,
    responsive_changed: false,
    copy_surface_changed: false,
    review_evidence_only: false,
  };

  let level = "U0";
  const reasons = [];

  if (relevantFiles.length === 0) {
    reasons.push("No NOOS Hub UI, UI-test, asset, or review-evidence paths changed.");
  } else if (uiFiles.length === 0) {
    level = "U1";
    flags.review_evidence_only = true;
    reasons.push("Only UI tests and/or durable review evidence changed.");
  } else {
    const onlyAssets = uiFiles.every((file) => file.startsWith(HUB_ASSET_PREFIX));
    if (onlyAssets) {
      level = "U1";
      reasons.push("Only Hub UI assets changed; no executable UI surface changed.");
    } else {
      level = "U2";
      reasons.push("Executable NOOS Hub UI surface changed; local UI governance is required by default.");
    }
  }

  for (const file of uiFiles) {
    const diff = fileDiff(diffByFile, file);

    if (file === "apps/noos-hub/src/routes.ts") {
      flags.navigation_changed = true;
      level = maxLevel(level, "U3");
      reasons.push("Hub route topology changed (hard U3 trigger).");
    }

    if (file === "apps/noos-hub/src/main.ts" && SHELL_PATTERN.test(diff)) {
      flags.shell_changed = true;
      level = maxLevel(level, "U3");
      reasons.push("Hub shell / primary navigation structure changed (hard U3 trigger).");
    }

    if (file === "apps/noos-hub/src/styles.css" && GLOBAL_STYLE_PATTERN.test(diff)) {
      flags.global_styles_changed = true;
      level = maxLevel(level, "U3");
      reasons.push("Global shell/style selectors changed (hard U3 trigger).");
    }

    if (USER_ACTION_PATTERN.test(diff)) {
      flags.user_action_surface_changed = true;
      level = maxLevel(level, "U2");
      reasons.push(`User-action surface changed in ${file}.`);
    }

    if (RESPONSIVE_PATTERN.test(diff)) {
      flags.responsive_changed = true;
      level = maxLevel(level, "U2");
      reasons.push(`Responsive rules changed in ${file}.`);
    }

    if (COPY_PATTERN.test(file) || COPY_PATTERN.test(diff)) {
      flags.copy_surface_changed = true;
      level = maxLevel(level, "U2");
      reasons.push(`Shared copy / locale surface changed in ${file}.`);
    }
  }

  if (level === "U1" && evidenceFiles.length > 0 && uiFiles.length === 0) {
    flags.review_evidence_only = true;
  }

  return {
    schema: UI_IMPACT_SCHEMA,
    detector_version: UI_IMPACT_DETECTOR_VERSION,
    base_sha: baseSha ?? null,
    head_sha: headSha ?? null,
    level,
    changed_files: files,
    ui_files: uniqueSorted(uiFiles),
    surfaces,
    risk_flags: flags,
    reasons: uniqueSorted(reasons),
  };
}

export function renderUiImpactMarkdown(report) {
  const flagLines = Object.entries(report.risk_flags)
    .filter(([, value]) => value)
    .map(([key]) => `- \`${key}\``);

  const fileLines = report.ui_files.length ? report.ui_files.map((file) => `- \`${file}\``) : ["- none"];
  const reasonLines = report.reasons.length ? report.reasons.map((reason) => `- ${reason}`) : ["- none"];

  return [
    `<!-- noos-ui-impact:v0 head=${report.head_sha ?? "unknown"} -->`,
    "## NOOS UI Impact Report",
    "",
    `- Schema: \`${report.schema}\``,
    `- Detector: \`${report.detector_version}\``,
    `- Base: \`${report.base_sha ?? "unknown"}\``,
    `- Head: \`${report.head_sha ?? "unknown"}\``,
    `- Minimum impact: **${report.level}**`,
    "",
    "### Reasons",
    ...reasonLines,
    "",
    "### UI files",
    ...fileLines,
    "",
    "### Active risk flags",
    ...(flagLines.length ? flagLines : ["- none"]),
    "",
    "This report is deterministic routing evidence only. It is not semantic authority, review approval, or merge authorization.",
    "",
    "```json",
    JSON.stringify(report, null, 2),
    "```",
    "",
  ].join("\n");
}
