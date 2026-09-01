# ADR-0010: The gate roster is written at `SessionStart` and evaluated at `SessionEnd`

**Status:** Accepted · 2026-09-01

## Context

M2 specifies that `SessionStart` writes the expected gate roster and "a periodic
check" compares it against gates that have actually logged, raising a
`systemMessage` naming any gate that never fired.

Nothing in a hook system ticks. There is no scheduler, so "periodic" has no
implementation.

## Decision

`SessionStart` writes the roster. `SessionEnd` evaluates it and records the
result to the event log.

## Rationale

`SessionEnd` is the only event that sees a whole session's gate activity, which
is the population the check is about. A mid-session evaluation would report
every gate that has not yet had cause to fire — noise, and under R-F2.5 a noisy
check is a retired check.

`SessionEnd` carries a 1.5 second shared budget, so the evaluation is a read of
the session's own log files and a comparison against an in-memory roster.
Nothing else fits in that budget, which is a constraint on the design rather
than an obstacle to it.

## Consequence

The `systemMessage` cannot reach the user at `SessionEnd` in a useful way, so
the finding is written to the event log and surfaced by `harness status`
instead. This is a deliberate departure from M2's wording: the mechanism M2
names does not fit the event M2 needs.
