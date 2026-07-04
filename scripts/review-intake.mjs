#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

let repoRoot = process.cwd();
let maxListedFiles = 120;
let packageScripts = {};
let activeAreaRules = [];
let activeRiskRules = [];
let activeCheckRules = [];
let activeManifestPermissionFiles = [];
let activeManifestPermissionKeys = [];

const defaultAreaRules = [
  {
    id: "hub",
    label: "NOOS Hub",
    matches: (file) =>
      file.startsWith("apps/noos-hub/") ||
      file.startsWith("scripts/noos-hub-") ||
      file.startsWith("scripts/noos-post-wake-") ||
      file.startsWith("docs/noos-hub-"),
  },
  {
    id: "extension",
    label: "Browser extension",
    matches: (file) =>
      file.startsWith("src/") ||
      file.startsWith("public/") ||
      file === "vite.config.ts" ||
      file === "tsconfig.json" ||
      file === "scripts/package-extension.mjs" ||
      file === "scripts/package-extension.sh" ||
      file === "scripts/verify-extension-project-import.mjs",
  },
  {
    id: "wiki",
    label: "LLM Wiki",
    matches: (file) =>
      file.startsWith("apps/llm-wiki/") ||
      file.startsWith("scripts/llm-wiki-") ||
      file === "scripts/noos-sync-llm-wiki.sh" ||
      file.startsWith("docs/llm-wiki-") ||
      file.startsWith("docs/noos-llm-wiki-"),
  },
  {
    id: "docs",
    label: "Docs",
    matches: (file) =>
      file.startsWith("docs/") ||
      file.endsWith(".md") ||
      file === "AGENTS.md" ||
      file === "CLAUDE.md",
  },
  {
    id: "scripts",
    label: "Scripts",
    matches: (file) => file.startsWith("scripts/"),
  },
  {
    id: "tests",
    label: "Tests",
    matches: (file) =>
      file.startsWith("tests/") ||
      file.includes("/tests/") ||
      file.endsWith(".test.ts") ||
      file.endsWith(".test.tsx") ||
      file.endsWith(".spec.ts") ||
      file.endsWith(".spec.tsx"),
  },
  {
    id: "handoff",
    label: "NOOS handoffs",
    matches: (file) => file.startsWith(".noos/handoffs/"),
  },
  {
    id: "release",
    label: "Release / packaging",
    matches: (file) =>
      file.startsWith(".github/workflows/") ||
      file.startsWith("release/") ||
      file === "scripts/package-release-artifacts.mjs" ||
      file === "scripts/package-release-artifacts.sh" ||
      file === "scripts/noos-hub-bundle.mjs" ||
      file === "scripts/noos-hub-bundle.sh" ||
      file === "apps/noos-hub/src-tauri/tauri.conf.json" ||
      file === "docs/noos-hub-updater-signing.md",
  },
  {
    id: "agent-skills",
    label: "Agent skills",
    matches: (file) => file.startsWith(".noos/skills/"),
  },
  {
    id: "noos-runtime",
    label: "NOOS runtime / metadata",
    matches: (file) => file.startsWith(".noos/") && !file.startsWith(".noos/handoffs/"),
  },
  {
    id: "config",
    label: "Project config / dependencies",
    matches: (file) =>
      file === "package.json" ||
      file === "package-lock.json" ||
      file.endsWith("/package.json") ||
      file.endsWith("/package-lock.json") ||
      file.endsWith("tsconfig.json") ||
      file.endsWith("vite.config.ts") ||
      file.endsWith("Cargo.toml") ||
      file.endsWith("Cargo.lock"),
  },
];

const defaultRiskRules = [
  {
    id: "active-handoff",
    severity: "high",
    label: "Active handoff changes",
    matches: (file) => file.startsWith(".noos/handoffs/active/"),
    detail: "Active handoffs are often transfer material; confirm they are intentionally part of intake.",
  },
  {
    id: "generated-build-output",
    severity: "high",
    label: "Generated build output",
    matches: (file) =>
      file === "dist" ||
      file.startsWith("dist/") ||
      file.includes("/dist/") ||
      file.startsWith("release/") ||
      file.includes("/target/") ||
      file.includes("/target-"),
    detail: "Generated artifacts should usually stay out of source intake unless release packaging is intentional.",
  },
  {
    id: "release-flow",
    severity: "high",
    label: "Release or packaging flow",
    matches: (file) =>
      file.startsWith(".github/workflows/") ||
      file === "scripts/package-release-artifacts.mjs" ||
      file === "scripts/package-release-artifacts.sh" ||
      file === "scripts/noos-hub-bundle.mjs" ||
      file === "scripts/noos-hub-bundle.sh" ||
      file.startsWith("release/"),
    detail: "Release flow changes need deeper review against actual package scripts and CI entrypoints.",
  },
  {
    id: "signing-config",
    severity: "high",
    label: "Updater signing configuration",
    matches: (file) =>
      file === "docs/noos-hub-updater-signing.md" ||
      file === "apps/noos-hub/src-tauri/tauri.conf.json" ||
      file.startsWith(".github/workflows/"),
    detail: "Do not print or commit signing private keys/passwords; verify only public config and secret names.",
  },
  {
    id: "vendored-content",
    severity: "medium",
    label: "Vendored or third-party content",
    matches: (file) =>
      file.includes("/vendor/") ||
      file.includes("/vendored/") ||
      file.includes("/third_party/") ||
      file.includes("/node_modules/") ||
      file.startsWith("apps/llm-wiki/extension/Readability.js") ||
      file.startsWith("apps/llm-wiki/extension/Turndown.js") ||
      file.startsWith("apps/llm-wiki/src-tauri/pdfium/"),
    detail: "Vendored changes should be reviewed for provenance, licensing, and accidental bulk churn.",
  },
  {
    id: "extension-manifest",
    severity: "medium",
    label: "Extension manifest",
    matches: (file) => file === "public/manifest.json" || file === "apps/llm-wiki/extension/manifest.json",
    detail: "Manifest changes can affect browser permissions, host access, or extension trust boundaries.",
  },
  {
    id: "tauri-capabilities",
    severity: "medium",
    label: "Tauri capabilities / permissions",
    matches: (file) => file.includes("/src-tauri/capabilities/") || file.endsWith("tauri.conf.json"),
    detail: "Capability changes can alter desktop app permissions and should be reviewed explicitly.",
  },
  {
    id: "possible-secret-material",
    severity: "high",
    label: "Possible secret material",
    matches: (file) =>
      /(^|\/)\.env($|[./-])/.test(file) ||
      /\.(pem|p12|pfx|key)$/i.test(file) ||
      /(^|\/)(secret|secrets|password|private-key|private_key)(\.|\/|$)/i.test(file),
    detail: "Inspect file names and diffs carefully without printing secret values.",
  },
];

const defaultManifestPermissionFiles = ["public/manifest.json", "apps/llm-wiki/extension/manifest.json"];

const defaultManifestPermissionKeys = [
  "permissions",
  "optional_permissions",
  "host_permissions",
  "optional_host_permissions",
  "content_security_policy",
  "externally_connectable",
  "web_accessible_resources",
];

main();

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
      return;
    }

    if (!options.source) {
      fail("Missing required --source <branch|worktree|commit>.");
    }

    repoRoot = resolveRepoRoot(options.repo);
    const config = loadConfig(options);
    const configValue = config.value;
    maxListedFiles = parsePositiveInteger(options.maxFiles ?? configValue.maxListedFiles, 120, "max listed files");
    packageScripts = readPackageScripts();
    activeAreaRules = [...defaultAreaRules, ...compileAreaRules(configValue.areaRules ?? [])];
    activeRiskRules = [...defaultRiskRules, ...compileRiskRules(configValue.riskRules ?? [])];
    activeCheckRules = compileCheckRules(configValue.checkRules ?? []);
    activeManifestPermissionFiles = unique([
      ...defaultManifestPermissionFiles,
      ...(configValue.manifestPermissionFiles ?? []),
    ]);
    activeManifestPermissionKeys = unique([
      ...defaultManifestPermissionKeys,
      ...(configValue.manifestPermissionKeys ?? []),
    ]);

    const worktrees = parseWorktrees(git(["worktree", "list", "--porcelain"]).stdout);
    const baseInput = options.base ?? configValue.defaultBase ?? defaultBaseRef();
    const base = resolveRef(baseInput, "base");
    const source = resolveSource(options.source, worktrees);
    const report = buildReport({
      source,
      base,
      baseInput,
      configPath: config.path,
      projectName: configValue.projectName ?? readPackageName() ?? path.basename(repoRoot),
    });

    process.stdout.write(renderMarkdown(report));
  } catch (error) {
    fail(error.message);
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--source") {
      options.source = requireValue(argv, (index += 1), arg);
      continue;
    }
    if (arg.startsWith("--source=")) {
      options.source = arg.slice("--source=".length);
      continue;
    }
    if (arg === "--base") {
      options.base = requireValue(argv, (index += 1), arg);
      continue;
    }
    if (arg.startsWith("--base=")) {
      options.base = arg.slice("--base=".length);
      continue;
    }
    if (arg === "--repo") {
      options.repo = requireValue(argv, (index += 1), arg);
      continue;
    }
    if (arg.startsWith("--repo=")) {
      options.repo = arg.slice("--repo=".length);
      continue;
    }
    if (arg === "--config") {
      options.config = requireValue(argv, (index += 1), arg);
      continue;
    }
    if (arg.startsWith("--config=")) {
      options.config = arg.slice("--config=".length);
      continue;
    }
    if (arg === "--no-config") {
      options.noConfig = true;
      continue;
    }
    if (arg === "--max-files") {
      options.maxFiles = requireValue(argv, (index += 1), arg);
      continue;
    }
    if (arg.startsWith("--max-files=")) {
      options.maxFiles = arg.slice("--max-files=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

function resolveRepoRoot(repoOption) {
  const startDir = repoOption ? path.resolve(repoOption) : process.cwd();
  const result = git(["rev-parse", "--show-toplevel"], { cwd: startDir, allowFailure: true });
  if (result.status !== 0) {
    throw new Error(`Could not resolve a Git repository from ${startDir}. Pass --repo <path> explicitly.`);
  }
  return result.stdout.trim();
}

function loadConfig(options) {
  if (options.noConfig) {
    return { path: null, value: {} };
  }

  const candidates = options.config
    ? [path.resolve(options.config)]
    : [
        path.join(repoRoot, ".review-intake.json"),
        path.join(repoRoot, ".review-intake.config.json"),
        path.join(repoRoot, "review-intake.config.json"),
      ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    const raw = fs.readFileSync(candidate, "utf8");
    try {
      return {
        path: candidate,
        value: JSON.parse(raw),
      };
    } catch (error) {
      throw new Error(`Could not parse review intake config ${candidate}: ${error.message}`);
    }
  }

  if (options.config) {
    throw new Error(`Review intake config was not found: ${candidates[0]}`);
  }
  return { path: null, value: {} };
}

function compileAreaRules(rules) {
  return rules.map((rule, index) => ({
    id: requireString(rule.id, `areaRules[${index}].id`),
    label: requireString(rule.label ?? rule.id, `areaRules[${index}].label`),
    matches: compilePatterns(rule.patterns, `areaRules[${index}].patterns`),
  }));
}

function compileRiskRules(rules) {
  return rules.map((rule, index) => ({
    id: requireString(rule.id, `riskRules[${index}].id`),
    severity: normalizeSeverity(rule.severity ?? "medium", `riskRules[${index}].severity`),
    label: requireString(rule.label ?? rule.id, `riskRules[${index}].label`),
    detail: requireString(rule.detail ?? "Review this path before merging.", `riskRules[${index}].detail`),
    matches: compilePatterns(rule.patterns, `riskRules[${index}].patterns`),
  }));
}

function compileCheckRules(rules) {
  return rules.map((rule, index) => ({
    command: requireString(rule.command, `checkRules[${index}].command`),
    reason: requireString(rule.reason ?? "Configured check matched changed paths.", `checkRules[${index}].reason`),
    matches: compilePatterns(rule.patterns, `checkRules[${index}].patterns`),
  }));
}

function compilePatterns(patterns, fieldName) {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    throw new Error(`${fieldName} must be a non-empty array.`);
  }
  const matchers = patterns.map((pattern, index) => compilePathPattern(pattern, `${fieldName}[${index}]`));
  return (file) => matchers.some((matcher) => matcher(file));
}

function compilePathPattern(pattern, fieldName) {
  const value = requireString(pattern, fieldName);
  if (value.startsWith("regex:")) {
    const regex = new RegExp(value.slice("regex:".length));
    return (file) => regex.test(file);
  }
  const regex = globToRegExp(value);
  return (file) => regex.test(file);
}

function globToRegExp(pattern) {
  let output = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === "*" && next === "*") {
      output += ".*";
      index += 1;
    } else if (char === "*") {
      output += "[^/]*";
    } else if (char === "?") {
      output += "[^/]";
    } else {
      output += escapeRegExp(char);
    }
  }
  return new RegExp(`${output}$`);
}

function requireString(value, fieldName) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return value;
}

function normalizeSeverity(value, fieldName) {
  const severity = requireString(value, fieldName);
  if (!["low", "medium", "high"].includes(severity)) {
    throw new Error(`${fieldName} must be one of: low, medium, high.`);
  }
  return severity;
}

function parsePositiveInteger(value, fallback, label) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function readPackageScripts() {
  const packageJson = readPackageJson();
  return packageJson?.scripts ?? {};
}

function readPackageName() {
  return readPackageJson()?.name ?? null;
}

function readPackageJson() {
  const packagePath = path.join(repoRoot, "package.json");
  if (!fs.existsSync(packagePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(packagePath, "utf8"));
  } catch {
    return null;
  }
}

function defaultBaseRef() {
  if (revParseCommit("origin/main")) {
    return "origin/main";
  }
  if (revParseCommit("main")) {
    return "main";
  }
  throw new Error("Could not find default base ref origin/main or main. Pass --base explicitly.");
}

function resolveRef(input, role) {
  const commit = revParseCommit(input);
  if (!commit) {
    throw new Error(`Could not resolve ${role} ref: ${input}`);
  }
  return {
    input,
    commit,
    shortCommit: shortSha(commit),
    subject: commitSubject(commit),
  };
}

function resolveSource(input, worktrees) {
  const asPath = resolveExistingWorktreePath(input);
  if (asPath) {
    const commit = git(["rev-parse", "HEAD"], { cwd: asPath }).stdout.trim();
    const branchName = git(["symbolic-ref", "--quiet", "--short", "HEAD"], {
      cwd: asPath,
      allowFailure: true,
    }).stdout.trim();
    return {
      input,
      type: "worktree",
      commit,
      shortCommit: shortSha(commit),
      subject: commitSubject(commit),
      branchName: branchName || null,
      branchRef: branchName ? `refs/heads/${branchName}` : null,
      remoteRef: branchName ? firstExistingRef([`origin/${branchName}`]) : null,
      worktree: findWorktreeForPath(worktrees, asPath) ?? {
        path: asPath,
        head: commit,
        branchRef: branchName ? `refs/heads/${branchName}` : null,
        detached: !branchName,
      },
    };
  }

  const localBranchCommit = revParseCommit(`refs/heads/${input}`);
  if (localBranchCommit) {
    const branchRef = `refs/heads/${input}`;
    const worktree = findWorktreeForBranch(worktrees, branchRef);
    return {
      input,
      type: "branch",
      commit: localBranchCommit,
      shortCommit: shortSha(localBranchCommit),
      subject: commitSubject(localBranchCommit),
      branchName: input,
      branchRef,
      remoteRef: firstExistingRef([`origin/${input}`]),
      worktree,
    };
  }

  if (input.startsWith("origin/")) {
    const remoteCommit = revParseCommit(input);
    if (remoteCommit) {
      const worktree = findWorktreeForCommit(worktrees, remoteCommit);
      return {
        input,
        type: "remote-branch",
        commit: remoteCommit,
        shortCommit: shortSha(remoteCommit),
        subject: commitSubject(remoteCommit),
        branchName: null,
        branchRef: null,
        remoteRef: input,
        worktree,
      };
    }
  }

  const commit = revParseCommit(input);
  if (commit) {
    return {
      input,
      type: "commit",
      commit,
      shortCommit: shortSha(commit),
      subject: commitSubject(commit),
      branchName: null,
      branchRef: null,
      remoteRef: null,
      worktree: findPreferredWorktreeForCommit(worktrees, commit, input),
    };
  }

  const remoteRef = `origin/${input}`;
  const remoteCommit = revParseCommit(remoteRef);
  if (remoteCommit) {
    const worktree = findWorktreeForCommit(worktrees, remoteCommit);
    return {
      input,
      type: "remote-branch",
      commit: remoteCommit,
      shortCommit: shortSha(remoteCommit),
      subject: commitSubject(remoteCommit),
      branchName: null,
      branchRef: null,
      remoteRef,
      worktree,
    };
  }

  throw new Error(`Could not resolve source as a worktree path, branch, remote branch, or commit: ${input}`);
}

function resolveExistingWorktreePath(input) {
  const candidate = path.resolve(input);
  if (!fs.existsSync(candidate)) {
    return null;
  }
  const stat = fs.statSync(candidate);
  if (!stat.isDirectory()) {
    return null;
  }
  const result = git(["rev-parse", "--show-toplevel"], { cwd: candidate, allowFailure: true });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim();
}

function buildReport({ source, base, baseInput, configPath, projectName }) {
  const mergeBase = getMergeBase(base.commit, source.commit);
  const diffBase = mergeBase ?? base.commit;
  const relation = getAheadBehind(base.commit, source.commit);
  const changedFiles = getChangedFiles(diffBase, source.commit);
  const stat = getDiffStat(diffBase, source.commit);
  const sourceStatus = getSourceStatus(source);
  const remote = getRemoteStatus(source);
  const areas = summarizeAreas(changedFiles);
  const riskFlags = detectRiskFlags(changedFiles, diffBase, source.commit);
  const mergeFeasibility = checkMergeFeasibility(base.commit, source.commit, mergeBase);
  const suggestedChecks = suggestChecks(changedFiles, riskFlags);
  const recommendation = recommend({
    changedFiles,
    mergeFeasibility,
    riskFlags,
    sourceStatus,
    suggestedChecks,
  });

  return {
    projectName,
    repoRoot,
    configPath,
    generatedAt: new Date().toISOString(),
    mode: "read-only local refs; no fetch, checkout, merge, or push",
    source,
    base: {
      ...base,
      input: baseInput,
    },
    relation,
    mergeBase,
    diffBase,
    sourceStatus,
    remote,
    stat,
    changedFiles,
    areas,
    riskFlags,
    mergeFeasibility,
    suggestedChecks,
    recommendation,
  };
}

function getSourceStatus(source) {
  if (!source.worktree?.path) {
    return {
      available: false,
      clean: null,
      summary: "No checked-out worktree found for this source.",
      lines: [],
    };
  }

  const result = git(["status", "--short", "--branch"], { cwd: source.worktree.path, allowFailure: true });
  if (result.status !== 0) {
    return {
      available: false,
      clean: null,
      summary: "Could not read source worktree status.",
      lines: [],
    };
  }
  const lines = result.stdout.trimEnd().split("\n").filter(Boolean);
  const changes = lines.filter((line) => !line.startsWith("## "));
  return {
    available: true,
    clean: changes.length === 0,
    summary: changes.length === 0 ? "clean" : `${changes.length} uncommitted item(s)`,
    lines,
  };
}

function getRemoteStatus(source) {
  if (!source.branchName && !source.remoteRef) {
    return {
      available: false,
      summary: "No branch or remote ref associated with source.",
    };
  }

  const upstream = source.branchName ? getUpstreamRef(source.branchName) : null;
  const remoteRef = upstream ?? source.remoteRef;
  if (!remoteRef) {
    return {
      available: false,
      summary: "No upstream or origin/<branch> ref found in local refs.",
    };
  }

  const remoteCommit = revParseCommit(remoteRef);
  if (!remoteCommit) {
    return {
      available: false,
      ref: remoteRef,
      summary: `${remoteRef} is not present in local refs.`,
    };
  }

  const relation = getAheadBehind(remoteCommit, source.commit);
  const pushed = relation.ahead === 0;
  const inRemote = isAncestor(source.commit, remoteCommit);
  let summary = `${remoteRef}: ${relation.ahead} ahead / ${relation.behind} behind local remote ref`;
  if (pushed && relation.behind === 0) {
    summary = `${remoteRef}: source matches local remote ref`;
  } else if (inRemote) {
    summary = `${remoteRef}: source commit is contained in local remote ref`;
  } else if (relation.ahead > 0) {
    summary = `${remoteRef}: source has ${relation.ahead} commit(s) not in local remote ref`;
  }

  return {
    available: true,
    ref: remoteRef,
    commit: remoteCommit,
    shortCommit: shortSha(remoteCommit),
    relation,
    pushed: pushed || inRemote,
    summary,
  };
}

function getUpstreamRef(branchName) {
  const result = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", `${branchName}@{upstream}`], {
    allowFailure: true,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function getAheadBehind(leftCommit, rightCommit) {
  const result = git(["rev-list", "--left-right", "--count", `${leftCommit}...${rightCommit}`], {
    allowFailure: true,
  });
  if (result.status !== 0) {
    return { ahead: null, behind: null };
  }
  const [behind, ahead] = result.stdout.trim().split(/\s+/).map((part) => Number.parseInt(part, 10));
  return { ahead, behind };
}

function getMergeBase(baseCommit, sourceCommit) {
  const result = git(["merge-base", baseCommit, sourceCommit], { allowFailure: true });
  return result.status === 0 ? result.stdout.trim() : null;
}

function getChangedFiles(diffBase, sourceCommit) {
  const result = git(["diff", "--name-status", "--find-renames", diffBase, sourceCommit]);
  return result.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      const status = parts[0];
      const file = parts.at(-1);
      const previousPath = parts.length > 2 ? parts[1] : null;
      return {
        status,
        path: file,
        previousPath,
        areas: classifyFile(file),
      };
    });
}

function getDiffStat(diffBase, sourceCommit) {
  const result = git(["diff", "--stat", "--find-renames", diffBase, sourceCommit]);
  return result.stdout.trim();
}

function summarizeAreas(changedFiles) {
  const map = new Map();
  for (const file of changedFiles) {
    for (const area of file.areas) {
      const current = map.get(area.id) ?? {
        id: area.id,
        label: area.label,
        files: [],
      };
      current.files.push(file.path);
      map.set(area.id, current);
    }
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function classifyFile(file) {
  const areas = activeAreaRules.filter((rule) => rule.matches(file)).map(({ id, label }) => ({ id, label }));
  if (areas.length === 0) {
    areas.push({ id: "other", label: "Other" });
  }
  return areas;
}

function detectRiskFlags(changedFiles, diffBase, sourceCommit) {
  const flags = new Map();

  for (const file of changedFiles) {
    for (const rule of activeRiskRules) {
      if (!rule.matches(file.path)) {
        continue;
      }
      const current = flags.get(rule.id) ?? {
        id: rule.id,
        severity: rule.severity,
        label: rule.label,
        detail: rule.detail,
        files: [],
      };
      current.files.push(file.path);
      flags.set(rule.id, current);
    }
  }

  const manifestFiles = changedFiles
    .map((file) => file.path)
    .filter((file) => activeManifestPermissionFiles.includes(file));
  for (const file of manifestFiles) {
    const diff = git(["diff", "--unified=0", diffBase, sourceCommit, "--", file]).stdout;
    const changedPermissionKeys = activeManifestPermissionKeys.filter((key) =>
      new RegExp(`^[+-]\\s*"${escapeRegExp(key)}"\\s*:`, "m").test(diff),
    );
    if (changedPermissionKeys.length === 0) {
      continue;
    }
    flags.set(`manifest-permissions:${file}`, {
      id: `manifest-permissions:${file}`,
      severity: "high",
      label: "Extension manifest permission boundary",
      detail: `Manifest permission-related keys changed: ${changedPermissionKeys.join(", ")}.`,
      files: [file],
    });
  }

  return [...flags.values()].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

function checkMergeFeasibility(baseCommit, sourceCommit, mergeBase) {
  if (baseCommit === sourceCommit) {
    return {
      status: "clean",
      summary: "Source and base point at the same commit.",
      checkedWith: "commit equality",
    };
  }
  if (!mergeBase) {
    return {
      status: "unknown",
      summary: "No merge-base found; histories may be unrelated.",
      checkedWith: "git merge-base",
    };
  }
  if (mergeBase === baseCommit) {
    return {
      status: "clean",
      summary: "Source is a fast-forward from base.",
      checkedWith: "git merge-base",
    };
  }
  if (mergeBase === sourceCommit) {
    return {
      status: "clean",
      summary: "Source is already contained in base.",
      checkedWith: "git merge-base",
    };
  }

  const result = git(["merge-tree", "--trivial-merge", mergeBase, baseCommit, sourceCommit], {
    allowFailure: true,
  });
  if (result.status !== 0) {
    return {
      status: "unknown",
      summary: `git merge-tree exited with ${result.status}.`,
      checkedWith: "git merge-tree --trivial-merge",
      stderr: result.stderr.trim(),
    };
  }

  const output = result.stdout;
  const conflictPatterns = [/<<<<<<< /, /^changed in both$/m, /^added in both$/m, /^removed in both$/m, /^CONFLICT\b/m];
  const hasConflict = conflictPatterns.some((pattern) => pattern.test(output));
  return {
    status: hasConflict ? "conflicts" : "clean",
    summary: hasConflict
      ? "Potential textual merge conflicts detected by merge-tree."
      : "No conflicts detected by merge-tree trivial merge check.",
    checkedWith: "git merge-tree --trivial-merge",
  };
}

function suggestChecks(changedFiles, riskFlags) {
  const files = changedFiles.map((file) => file.path);
  const checks = [];
  const add = (command, reason) => {
    if (!checks.some((check) => check.command === command)) {
      checks.push({ command, reason });
    }
  };

  const hasScript = (scriptName) => Object.prototype.hasOwnProperty.call(packageScripts, scriptName);
  const touchesExtension = files.some((file) =>
    ["src/", "public/", "tests/"].some((prefix) => file.startsWith(prefix)) ||
    file === "vite.config.ts" ||
    file === "tsconfig.json" ||
    file === "package.json" ||
    file === "package-lock.json",
  );
  const touchesHubWeb = files.some((file) => file.startsWith("apps/noos-hub/src/") || file.startsWith("apps/noos-hub/index.html"));
  const touchesHubRust = files.some((file) => file.startsWith("apps/noos-hub/src-tauri/"));
  const touchesWiki = files.some((file) => file.startsWith("apps/llm-wiki/src/") || file.startsWith("apps/llm-wiki/index.html"));
  const touchesWikiBuild = files.some((file) =>
    file.startsWith("apps/llm-wiki/") &&
    !file.startsWith("apps/llm-wiki/assets/") &&
    !file.endsWith(".md"),
  );
  const touchesWikiRust = files.some((file) => file.startsWith("apps/llm-wiki/src-tauri/"));
  const touchesRootMjs = files.filter((file) => file.startsWith("scripts/") && file.endsWith(".mjs"));
  const touchesShell = files.filter((file) => file.startsWith("scripts/") && file.endsWith(".sh"));
  const touchesRelease = riskFlags.some((flag) => flag.id === "release-flow" || flag.id === "signing-config");
  const touchesJsTs = files.some((file) => /\.(cjs|mjs|js|jsx|ts|tsx)$/.test(file));
  const touchesRootPackage = files.some((file) => file === "package.json" || file === "package-lock.json");
  const touchesTests = files.some((file) => file.startsWith("tests/") || /\.test\.(ts|tsx|js|jsx)$/.test(file));

  if ((touchesExtension || touchesJsTs || touchesRootPackage) && hasScript("typecheck")) {
    add("npm run typecheck", "TypeScript or package configuration changed.");
  }
  if ((touchesExtension || touchesJsTs || touchesTests || touchesRootPackage) && hasScript("test")) {
    add("npm test", "Code, tests, or package configuration changed.");
  }
  if ((touchesExtension || touchesJsTs || touchesRootPackage) && hasScript("build")) {
    add("npm run build", "Build inputs or package configuration changed.");
  }
  if (touchesHubWeb && hasScript("hub:web:build")) {
    add("npm run hub:web:build", "NOOS Hub frontend changed.");
  }
  if (touchesHubRust) {
    add("cargo test --manifest-path apps/noos-hub/src-tauri/Cargo.toml", "NOOS Hub Rust/Tauri backend changed.");
  }
  if ((touchesWiki || touchesWikiBuild) && hasScript("wiki:typecheck")) {
    add("npm run wiki:typecheck", "LLM Wiki TypeScript changed.");
  }
  if ((touchesWiki || touchesWikiBuild) && hasScript("wiki:test")) {
    add("npm run wiki:test", "LLM Wiki tests cover app logic and mocks.");
  }
  if ((touchesWiki || touchesWikiBuild) && hasScript("wiki:build")) {
    add("npm run wiki:build", "LLM Wiki app should still build.");
  }
  if (touchesWikiRust) {
    add("cargo test --manifest-path apps/llm-wiki/src-tauri/Cargo.toml", "LLM Wiki Rust/Tauri backend changed.");
  }
  for (const file of touchesRootMjs) {
    add(`node --check ${file}`, "Changed Node script should parse.");
  }
  for (const file of touchesShell) {
    add(`bash -n ${file}`, "Changed shell script should parse.");
  }
  if (touchesRelease && hasScript("package:release")) {
    add("npm run package:release", "Release packaging changed; run only when intentional and environment is ready.");
  }
  for (const rule of activeCheckRules) {
    if (files.some((file) => rule.matches(file))) {
      add(rule.command, rule.reason);
    }
  }

  return checks;
}

function recommend({ changedFiles, mergeFeasibility, riskFlags, sourceStatus, suggestedChecks }) {
  if (mergeFeasibility.status === "conflicts") {
    return {
      decision: "blocked",
      summary: "Resolve merge conflicts before intake.",
    };
  }
  if (sourceStatus.available && sourceStatus.clean === false) {
    return {
      decision: "manual_deep_review",
      summary: "Source worktree has uncommitted changes; decide whether those changes belong in the intake.",
    };
  }
  if (changedFiles.length === 0) {
    return {
      decision: "no_action",
      summary: "No changes relative to base.",
    };
  }
  const highRisk = riskFlags.filter((flag) => flag.severity === "high");
  if (highRisk.length > 0) {
    return {
      decision: "manual_deep_review",
      summary: "Sensitive areas changed; review flagged files before deciding to merge.",
    };
  }
  if (suggestedChecks.length > 0) {
    return {
      decision: "needs_checks",
      summary: "Run the suggested checks, then review the remaining diff before merge.",
    };
  }
  return {
    decision: "ready_after_review",
    summary: "No automated blockers detected; finish human/Codex review before merge.",
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# Review Intake Report");
  lines.push("");
  lines.push(`Project: ${report.projectName}`);
  lines.push(`Source: ${report.source.input}`);
  lines.push(`Base: ${report.base.input}`);
  lines.push(`Repo root: ${report.repoRoot}`);
  lines.push(`Config: ${report.configPath ?? "none"}`);
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Mode: ${report.mode}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Source type: ${report.source.type}`);
  lines.push(`- Source commit: ${report.source.shortCommit} ${report.source.subject}`);
  lines.push(`- Base commit: ${report.base.shortCommit} ${report.base.subject}`);
  lines.push(`- Merge base: ${report.mergeBase ? shortSha(report.mergeBase) : "not found"}`);
  lines.push(`- Relation to base: ${formatAheadBehind(report.relation)}`);
  lines.push(`- Source worktree: ${formatWorktree(report.source.worktree)}`);
  lines.push(`- Source status: ${report.sourceStatus.summary}`);
  lines.push(`- Remote: ${report.remote.summary}`);
  lines.push(`- Merge feasibility: ${report.mergeFeasibility.status} (${report.mergeFeasibility.summary})`);
  lines.push(`- Risk level: ${riskLevel(report)}`);
  lines.push(`- Recommendation: ${report.recommendation.decision} - ${report.recommendation.summary}`);
  lines.push("");

  lines.push("## Changed Areas");
  lines.push("");
  if (report.areas.length === 0) {
    lines.push("- No changed files.");
  } else {
    for (const area of report.areas) {
      lines.push(`- ${area.label}: ${area.files.length} file(s)`);
    }
  }
  lines.push("");

  lines.push("## Risk Flags");
  lines.push("");
  if (report.riskFlags.length === 0) {
    lines.push("- None detected by path/diff heuristics.");
  } else {
    for (const flag of report.riskFlags) {
      lines.push(`- [${flag.severity.toUpperCase()}] ${flag.label}: ${flag.detail}`);
      lines.push(`  Files: ${flag.files.join(", ")}`);
    }
  }
  lines.push("");

  lines.push("## Suggested Checks");
  lines.push("");
  if (report.suggestedChecks.length === 0) {
    lines.push("- No automated checks suggested by the path map. Still review the diff before merging.");
  } else {
    for (const check of report.suggestedChecks) {
      lines.push(`- \`${check.command}\` - ${check.reason}`);
    }
  }
  lines.push("");

  lines.push("## Changed Files");
  lines.push("");
  if (report.changedFiles.length === 0) {
    lines.push("- No changed files.");
  } else {
    lines.push("| Status | Areas | Path |");
    lines.push("| --- | --- | --- |");
    for (const file of report.changedFiles.slice(0, maxListedFiles)) {
      lines.push(`| ${escapeMarkdownCell(file.status)} | ${escapeMarkdownCell(file.areas.map((area) => area.label).join(", "))} | ${escapeMarkdownCell(file.path)} |`);
    }
    if (report.changedFiles.length > maxListedFiles) {
      lines.push(`| ... | ... | ${report.changedFiles.length - maxListedFiles} more file(s) omitted |`);
    }
  }
  lines.push("");

  lines.push("## Diff Stat");
  lines.push("");
  if (report.stat) {
    lines.push("```text");
    lines.push(report.stat);
    lines.push("```");
  } else {
    lines.push("- Empty diff.");
  }
  lines.push("");

  lines.push("## Notes");
  lines.push("");
  lines.push("- This report uses local refs only. Run `git fetch --prune` yourself first if remote freshness matters.");
  lines.push("- This report does not prove semantic correctness; it narrows the intake surface for review.");
  lines.push("- `merge-tree --trivial-merge` is conservative and does not replace an actual integration branch verification.");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function parseWorktrees(output) {
  const entries = [];
  let current = null;
  for (const line of output.split("\n")) {
    if (!line.trim()) {
      if (current) {
        entries.push(current);
        current = null;
      }
      continue;
    }
    if (line.startsWith("worktree ")) {
      current = {
        path: line.slice("worktree ".length),
        head: null,
        branchRef: null,
        detached: false,
      };
      continue;
    }
    if (!current) {
      continue;
    }
    if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      current.branchRef = line.slice("branch ".length);
    } else if (line === "detached") {
      current.detached = true;
    }
  }
  if (current) {
    entries.push(current);
  }
  return entries;
}

function findWorktreeForPath(worktrees, worktreePath) {
  const normalized = path.resolve(worktreePath);
  return worktrees.find((worktree) => path.resolve(worktree.path) === normalized) ?? null;
}

function findWorktreeForBranch(worktrees, branchRef) {
  return worktrees.find((worktree) => worktree.branchRef === branchRef) ?? null;
}

function findWorktreeForCommit(worktrees, commit) {
  return worktrees.find((worktree) => worktree.head === commit) ?? null;
}

function findPreferredWorktreeForCommit(worktrees, commit, input) {
  const current = findWorktreeForPath(worktrees, repoRoot);
  if ((input === "HEAD" || input === ".") && current?.head === commit) {
    return current;
  }
  return findWorktreeForCommit(worktrees, commit);
}

function firstExistingRef(candidates) {
  return candidates.find((candidate) => revParseCommit(candidate)) ?? null;
}

function revParseCommit(ref) {
  const result = git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { allowFailure: true });
  return result.status === 0 ? result.stdout.trim() : null;
}

function commitSubject(commit) {
  const result = git(["show", "-s", "--format=%s", commit], { allowFailure: true });
  return result.status === 0 ? result.stdout.trim() : "";
}

function isAncestor(maybeAncestor, commit) {
  return git(["merge-base", "--is-ancestor", maybeAncestor, commit], { allowFailure: true }).status === 0;
}

function git(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    shell: false,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0 && !options.allowFailure) {
    const stderr = result.stderr.trim();
    throw new Error(`git ${args.join(" ")} exited with ${result.status}${stderr ? `: ${stderr}` : ""}`);
  }
  return {
    status: result.status ?? 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function formatAheadBehind(relation) {
  if (relation.ahead === null || relation.behind === null) {
    return "unknown";
  }
  return `${relation.ahead} ahead / ${relation.behind} behind`;
}

function formatWorktree(worktree) {
  if (!worktree?.path) {
    return "not checked out";
  }
  const branch = worktree.branchRef ? worktree.branchRef.replace("refs/heads/", "") : "detached";
  return `${worktree.path} (${branch})`;
}

function riskLevel(report) {
  if (report.mergeFeasibility.status === "conflicts") {
    return "high";
  }
  if (report.sourceStatus.available && report.sourceStatus.clean === false) {
    return "high";
  }
  if (report.riskFlags.some((flag) => flag.severity === "high")) {
    return "high";
  }
  if (report.riskFlags.some((flag) => flag.severity === "medium")) {
    return "medium";
  }
  return "low";
}

function severityRank(severity) {
  return severity === "high" ? 2 : severity === "medium" ? 1 : 0;
}

function shortSha(commit) {
  return commit.slice(0, 7);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeMarkdownCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && value !== ""))];
}

function printHelp() {
  process.stdout.write(`Usage: review-intake --source <branch|worktree|commit> [--base <ref>]

Generates a read-only Markdown intake report for Git branch/worktree review work.

Options:
  --source <value>  Branch, worktree path, remote branch, or commit to inspect.
  --base <ref>      Base ref to compare against. Defaults to config defaultBase, origin/main, then main.
  --repo <path>     Git repository path. Defaults to the current working directory.
  --config <path>   JSON config path. Defaults to .review-intake.json, .review-intake.config.json, or review-intake.config.json.
  --no-config       Ignore config files and use built-in rules only.
  --max-files <n>   Maximum changed files to list in the Markdown table. Defaults to 120.
  -h, --help        Show this help.

The tool reads local Git refs and worktrees only. It does not fetch, checkout,
merge, commit, or push.

Config supports projectName, defaultBase, maxListedFiles, areaRules, riskRules,
checkRules, manifestPermissionFiles, and manifestPermissionKeys. Path patterns
use simple glob syntax (*, **, ?) or regex:<pattern>.
`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
