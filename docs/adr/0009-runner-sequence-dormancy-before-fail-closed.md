# ADR-0009: Dormancy is resolved before fail-closed, using the environment fallback

**Status:** Accepted · 2026-09-01

## Context

Moat §3.2 orders the runner: (1) read stdin, and on a truncated read exit 2 for
any `failClosed` gate; (2) dormancy check.

That order blocks tool calls in repositories where the harness is not installed.
It contradicts M11 and the build's own definition of done — "installing the
plugin at user scope changes nothing in a repo without a manifest".

The spec's concern is correct and must be preserved: the read-failure path must
not become an unconditional bypass sitting above the fail-closed logic.

## Decision

Sequence: read stdin → resolve dormancy → apply fail-closed.

On a successful read, dormancy resolves from `event.cwd` as specified. On a
failed read there is no `event.cwd`, so it resolves from `CLAUDE_PROJECT_DIR` —
an environment variable, already `repo.mjs`'s documented fallback under M9, and
available without stdin.

If neither resolves a `.harness/manifest.yaml`, the harness is not installed:
exit 0, write no event record, exactly as M11 requires.

If dormancy *does* resolve — the harness is installed here — the fail-closed
logic applies unchanged, and a truncated read on a `failClosed` gate exits 2.

## Rationale

This is not a bypass. A bypass would let a read failure skip enforcement in a
repository that opted in. Here, enforcement is skipped only where there is
nothing to enforce, which is the same condition every other dormant exit tests.

## Consequence

`repo.resolveRepoRoot` takes an optional event and must behave correctly when
given none. Two tests: truncated read in a repo with a manifest exits 2;
truncated read in a repo without one exits 0 silently and writes no record.
