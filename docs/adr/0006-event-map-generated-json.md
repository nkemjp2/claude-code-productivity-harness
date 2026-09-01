# ADR-0006: The runner reads a generated JSON event map, not the markdown

**Status:** Accepted · 2026-09-01

## Context

Phase 0 writes `docs/event-map.verified.md` as a checked-in human-readable
table. The Phase 1 version guard reads the event map on every hook invocation.
Two problems: which `docs/` directory the runner resolves at runtime, and the
cost of parsing a markdown table in the hot path of every tool call.

## Decision

`docs/event-map.verified.md` is the source of truth and the artefact humans
review. A build step generates `plugins/harness/src/generated/event-map.json`
from it, and the runner reads only the JSON, resolved relative to the plugin
root.

The generated file is committed, and CI regenerates it and fails on a diff — the
same discipline `hooks.json` gets under M2, for the same reason.

## Consequence

The runner never resolves an adopting repository's `docs/` directory, so the
ambiguity disappears. Markdown parsing never happens at hook latency. The
minimum supported client version travels in the generated JSON, which is what
the version guard needs anyway (ADR-0007).
