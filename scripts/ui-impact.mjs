#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { classifyUiImpact, renderUiImpactMarkdown } from "./ui-impact-core.mjs";

main();

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
      return;
    }

    if (!options.base || !options.head) {
      throw new Error("Both --base <ref> and --head <ref> are required.");
    }

    const baseSha = git(["rev-parse", options.base]).stdout.trim();
    const headSha = git(["rev-parse", options.head]).stdout.trim();
    const changedFiles = git([
      "diff",
      "--name-only",
      "--diff-filter=ACDMRTUXB",
      `${baseSha}...${headSha}`,
    ]).stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const diffByFile = {};
    for (const file of changedFiles) {
      diffByFile[file] = git([
        "diff",
        "--no-ext-diff",
        "--unified=0",
        `${baseSha}...${headSha}`,
        "--",
        file,
      ], { allowFailure: true }).stdout;
    }

    const report = classifyUiImpact({ baseSha, headSha, changedFiles, diffByFile });
    const json = `${JSON.stringify(report, null, 2)}\n`;
    const markdown = renderUiImpactMarkdown(report);

    if (options.jsonOutput) fs.writeFileSync(options.jsonOutput, json, "utf8");
    if (options.markdownOutput) fs.writeFileSync(options.markdownOutput, markdown, "utf8");

    if (options.githubOutput) {
      appendGithubOutput(options.githubOutput, {
        level: report.level,
        head_sha: report.head_sha ?? "",
        needs_governance: String(report.level === "U2" || report.level === "U3"),
        needs_design_gate: String(report.level === "U3"),
      });
    }

    if (options.format === "json") process.stdout.write(json);
    else if (options.format === "both") process.stdout.write(`${markdown}\n${json}`);
    else process.stdout.write(markdown);
  } catch (error) {
    process.stderr.write(`ui-impact: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

function parseArgs(argv) {
  const options = {
    base: null,
    head: null,
    format: "markdown",
    jsonOutput: null,
    markdownOutput: null,
    githubOutput: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}.`);
      index += 1;
      return value;
    };

    if (arg === "--base") options.base = next();
    else if (arg === "--head") options.head = next();
    else if (arg === "--format") options.format = next();
    else if (arg === "--json-output") options.jsonOutput = next();
    else if (arg === "--markdown-output") options.markdownOutput = next();
    else if (arg === "--github-output") options.githubOutput = next();
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!["markdown", "json", "both"].includes(options.format)) {
    throw new Error(`Unsupported --format ${options.format}; expected markdown, json, or both.`);
  }

  return options;
}

function git(args, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || "unknown error").trim()}`);
  }
  return {
    status: result.status ?? 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function appendGithubOutput(file, values) {
  for (const [key, value] of Object.entries(values)) {
    fs.appendFileSync(file, `${key}=${value}\n`, "utf8");
  }
}

function printHelp() {
  process.stdout.write(`Usage:\n  node scripts/ui-impact.mjs --base <ref> --head <ref> [options]\n\nOptions:\n  --format markdown|json|both      stdout format (default: markdown)\n  --json-output <path>             write JSON report\n  --markdown-output <path>         write Markdown report\n  --github-output <path>           append level/head/gate fields in GitHub Actions output format\n  -h, --help                       show this help\n\nThe report is deterministic routing evidence only; it does not authorize merge or semantic continuation.\n`);
}
