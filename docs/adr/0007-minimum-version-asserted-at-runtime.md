# ADR-0007: The minimum client version is asserted at runtime, not declared in `plugin.json`

**Status:** Accepted · 2026-09-01

## Context

Design §13 lists `plugin.json`'s field-level schema as unverified and says to
check it against the plugins reference before the first build. The first draft
of this repository's `plugin.json` carried `minimumClaudeCodeVersion`.

That field name appears nowhere in client 2.1.247, nor do
`minClaudeCodeVersion` or `requiredClaudeCodeVersion`. It was a plausible
invention — which is the specific thing operating rule 4 forbids.

## Decision

`plugin.json` carries only fields that can be justified: `name`, `version`,
`description`, `author`.

The minimum supported client version lives in the generated event map
(ADR-0006), where it is recorded as the version the map was audited against —
which is the honest statement, since the map's validity is exactly what is
version-dependent. It is asserted at `SessionStart` and by `harness doctor`.

## Rationale

The assertion was always the load-bearing half. A declared field that the client
may or may not honour is a claim; a `SessionStart` check that warns loudly is a
mechanism. M17 already specified the mechanism.

## Consequence

If the plugins reference later confirms a real field, adding it is additive and
the runtime assertion stays. Recorded in the deferred register as unverified.
