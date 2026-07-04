# Review Intake Reporter

`review-intake` is a read-only Git intake reporter. It turns the repetitive first pass of branch/worktree review into a Markdown report: source location, commit state, ahead/behind relation, changed areas, risk flags, merge feasibility, suggested checks, and a conservative recommendation.

It does not fetch, checkout, merge, commit, or push.

## Use In This Repository

```sh
npm run review:intake -- --source codex/some-branch --base main
```

The package also exposes a local bin:

```sh
npx --no-install review-intake --source codex/some-branch --base main
```

## Install In Another Repository

The simplest path is to copy `scripts/review-intake.mjs` into the target repository and add:

```json
{
  "scripts": {
    "review:intake": "node scripts/review-intake.mjs"
  }
}
```

Then run:

```sh
npm run review:intake -- --source feature/my-change --base origin/main
```

If this package is installed or linked as a tool, use:

```sh
review-intake --repo /path/to/repo --source feature/my-change --base origin/main
```

## Configure

Configuration is optional. By default the reporter uses built-in generic and NOOS-oriented heuristics. A target repository can add its own rules with one of:

- `.review-intake.json`
- `.review-intake.config.json`
- `review-intake.config.json`

or by passing:

```sh
review-intake --config path/to/review-intake.config.json --source feature/my-change
```

Use `review-intake.config.example.json` as a starting point. The supported top-level fields are:

- `projectName`: shown in the report header.
- `defaultBase`: fallback base ref before `origin/main` / `main`.
- `maxListedFiles`: maximum changed files shown in the Markdown table.
- `areaRules`: extra changed-area classifications.
- `riskRules`: extra risk flags.
- `checkRules`: extra suggested verification commands.
- `manifestPermissionFiles`: manifest-like files whose permission keys should be inspected.
- `manifestPermissionKeys`: JSON keys that represent permission boundaries.

Path patterns use simple glob syntax: `*`, `**`, and `?`. Prefix a pattern with `regex:` to use a JavaScript regular expression.
