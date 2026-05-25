# NOOS and LLM Wiki Bridge

## Decision

NOOS should connect to LLM Wiki through the LLM Wiki source layer first:

```text
NOOS Vault object
  -> LLM Wiki raw/sources/noos/<object-kind>/
  -> LLM Wiki ingest
  -> LLM Wiki wiki/ pages, wikilinks, graph, search, and source traceability
```

NOOS should not write directly into LLM Wiki's generated `wiki/` directory in v0.

## Why Not Reuse One Directory Directly

NOOS Vault and LLM Wiki have different ownership boundaries:

- NOOS Vault stores operational objects: Handoff, Crystal, Result, Artifact, Brief, Pack, and Runtime Projection.
- LLM Wiki stores a curated knowledge graph generated from source documents.
- LLM Wiki already has a source lifecycle: `raw/sources/` is the immutable input, `wiki/` is generated/maintained output.

If NOOS directly writes Crystal or Handoff files into `wiki/`, it bypasses LLM Wiki's ingest pipeline, weakens source traceability, and can confuse cleanup, graph, embeddings, and incremental cache behavior.

The safer bridge is to project durable NOOS objects into `raw/sources/noos/`. LLM Wiki then treats them like any other source and creates linked wiki pages through its own rules.

## Object Semantics

- Handoff = what to do next.
- Crystal = what has been distilled.
- Result = what this run produced.
- Artifact = the concrete file, image, table, or payload.

Only durable knowledge should flow into LLM Wiki automatically.

Recommended default:

| NOOS object | Default bridge behavior | Reason |
| --- | --- | --- |
| Crystal | Project to LLM Wiki by default | It is already a durable knowledge object. |
| Handoff | Do not project by default | Most handoffs are task-state and short-lived. |
| Result | Do not project by default | Results need review before becoming knowledge. |
| Artifact | Metadata first, binary later | LLM Wiki source ingest is document-centric. |
| Brief | Project when explicit | Briefs can become durable source material. |

Handoff and Result become bridgeable when frontmatter marks them as durable:

```yaml
noos_wiki: true
permanence: permanent
tags: [noos, wiki]
```

Temporary objects can be forced through the bridge with `--include-temporary`, but that should be treated as a debugging or migration option.

## v0 Bridge Command

```sh
scripts/noos-sync-llm-wiki.sh --wiki-project /path/to/my-wiki
```

This writes projected source files to:

```text
/path/to/my-wiki/raw/sources/noos/crystals/
/path/to/my-wiki/raw/sources/noos/handoffs/
/path/to/my-wiki/raw/sources/noos/results/
```

Then use LLM Wiki's normal ingest path:

- enable source folder auto-watch, or
- open LLM Wiki and ingest the new source files manually.

Dry run:

```sh
scripts/noos-sync-llm-wiki.sh --wiki-project /path/to/my-wiki --dry-run
```

Project only crystals:

```sh
scripts/noos-sync-llm-wiki.sh --wiki-project /path/to/my-wiki --kind crystal
```

## Projected Source Shape

NOOS wraps each projected object in a small source envelope:

```yaml
---
type: noos_llm_wiki_source
version: 0.1
title: "NOOS as AI Work Context Hub"
noos_object_type: crystal
noos_lookup_key: "20260521-noos-ai-64e4"
noos_source_path: "/Users/me/.noos/vault/crystals/active/20260521-noos-ai-64e4.md"
noos_bridge_version: 0.1
projected_at: "2026-05-23T00:00:00Z"
tags: [noos, crystal]
---
```

The original NOOS object follows below the envelope. LLM Wiki can cite this wrapper as the source while preserving the original NOOS lookup key.

## Permanent vs Temporary Classification

The long-term design should let Hub ask a configured lightweight model to classify objects before projection:

```json
{
  "decision": "permanent | temporary | needs_review",
  "confidence": "low | medium | high",
  "reason": "Why this should or should not enter the wiki.",
  "suggested_tags": ["noos", "architecture"],
  "suggested_wiki_scope": "concept | source | synthesis | reference"
}
```

v0 uses deterministic rules:

- Crystal is permanent unless marked temporary.
- Handoff is temporary unless marked `noos_wiki: true`, `wiki: true`, or `permanence: permanent`.
- Result is temporary unless accepted/curated or explicitly marked permanent.

This keeps the core path model-free and avoids blocking save-to-vault on a provider configuration.

## Bidirectional Links

The first bridge stage creates one-way provenance:

```text
LLM Wiki source file -> original NOOS file path + lookup key
```

The next stage should add an index edge in NOOS:

```json
{
  "from": "noos lookup key",
  "to": "llm-wiki raw/sources/noos/...",
  "relation": "projected_to_llm_wiki"
}
```

After LLM Wiki ingest, NOOS can later store returned wiki page refs:

```json
{
  "from": "noos lookup key",
  "to": "wiki/concepts/context-broker.md",
  "relation": "ingested_as_wiki_page"
}
```

## Product Flow

1. Shuttle captures Handoff or Crystal.
2. Hub saves it to NOOS Vault and indexes it.
3. Hub decides whether it is durable:
   - deterministic v0 rules now,
   - model classification later.
4. Durable objects are projected to LLM Wiki `raw/sources/noos/`.
5. LLM Wiki source watcher or manual ingest builds wiki pages.
6. Hub records bridge receipts and graph edges.

## Open Questions

- Whether NOOS Hub should own the model classification call or delegate it to LLM Wiki.
- Whether LLM Wiki should expose a local ingest endpoint for Hub instead of relying on file watch.
- Whether projected NOOS sources should be copied, hard-linked, or content-addressed.
- How to display LLM Wiki page refs inside NOOS Hub after ingest.

## Near-Term Recommendation

Use copied source projections in v0. It is boring, observable, and compatible with LLM Wiki's existing design. Add model classification and returned wiki page refs only after the file bridge is reliable.
