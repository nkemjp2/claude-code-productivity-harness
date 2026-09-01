# ADR-0004: Prohibition 6 is enforced as a structural proxy

**Status:** Accepted · 2026-09-01

## Context

The work order states nine prohibitions and asserts each is "enforced by a lint
rule that fails the build". Prohibition 6 is "no adapter returning `pass` for
output it did not parse" (M25).

No lint rule can enforce that as written. Whether a parser understood its input
is a semantic property of a computation, not a syntactic property of source. A
rule claiming to check it would pass every adapter and look like enforcement,
which is precisely the silently-disabled-gate failure M2 exists to prevent —
arriving through the rule written to prevent it.

## Decision

Prohibition 6 is restated as two decidable structural properties:

1. Every `parse` export has an exhaustive terminal path returning
   `verdict: 'error'` — no code path may fall off the end returning `undefined`.
2. No `verdict: 'pass'` is returned from a position not dominated by a
   successful-match branch. In practice: a `pass` at the top level of `parse`,
   or in an `else`/`catch` with no match test, is a violation.

Neither is the original property. Both are checkable, and together they make the
original failure mode hard to reach by accident.

## Consequence

The rule's own documentation states what it does not catch: an adapter that
tests the wrong condition and returns `pass` on a genuine match failure. That
residual is covered by M25's other countermeasure — a recorded upstream fixture
per adapter in CI — not by the lint rule.

The registry-completeness test tracks prohibition 6 against this restatement, so
the count of nine still holds.
