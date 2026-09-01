# ADR-0011: The seven events absent from design §8 are recorded, not adopted

**Status:** Accepted · 2026-09-01

## Context

Client 2.1.247 declares thirty-one hook events. Design §8 covers twenty-four of
them, names two that do not exist (ADR-0003), and is silent on seven:
`UserPromptExpansion`, `PermissionDenied`, `Elicitation`, `ElicitationResult`,
`CwdChanged`, `DirectoryAdded`, `MessageDisplay`.

## Decision

All seven are recorded in the event map with `blocks` and `decision shape` as
`unverified`, and no harness use. No gate registers on any of them in this
build.

Two are flagged in the deferred register for verification before they are used:

- **`Elicitation` / `ElicitationResult`** appear to be a prompt-for-input path.
  M4 establishes that hooks run without a controlling terminal, so a gate that
  triggers an elicitation would hang until its timeout — and under M5 a timed-out
  `PreToolUse` gate does not block, so the failure is silent.
- **`CwdChanged`** bears directly on M9. It may be a cheaper and more reliable
  worktree signal than walking up from `event.cwd`.

## Rationale

Recording them costs nothing and closes the gap that made this discovery
necessary: design §8 was written from documentation, and the client had moved.
An event map that lists only the events someone thought to look for cannot show
that it is incomplete.

## Consequence

The event map is now a full enumeration of the client's declared events, so a
future audit diffs cleanly against it and a newly added event is visible as an
addition rather than an absence nobody noticed.
