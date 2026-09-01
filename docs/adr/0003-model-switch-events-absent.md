# ADR-0003: `PreModelSwitch` and `PostModelSwitch` do not exist; R-G6.2 and R-G6.4 are struck

**Status:** Accepted · 2026-09-01

## Context

Design §8 lists both events, and R-G6.2 depends on `PreModelSwitch` being able
to block a model switch in order to enforce a model floor on protected-path
work. R-G6.4 depends on its timeout semantics.

The Phase 0 audit read the hook event enum directly from client 2.1.247.
Neither name appears. `ModelSwitch` occurs only inside internal identifiers —
`injectModelSwitchBreadcrumbs`, `keepOwnModelSwitchBreadcrumb`,
`pendingModelSwitchIds` — none of which is a hook event.

Twenty-four of the design's other twenty-six event names appear in that enum as
quoted literals, so the convention is established and the absence is evidence
rather than a failed search.

## Decision

Both events are struck from the event map. R-G6.2 and R-G6.4 move to the
deferred register under "platform does not support them", not under "not yet
built" — the distinction matters, because the second implies a later phase will
deliver it and nothing will.

No substitute is invented. A model floor could in principle be approximated by
reading `CLAUDE_EFFORT` (confirmed present) inside a `PreToolUse` gate, but that
gates the *tool call*, not the switch, and claiming otherwise would be exactly
the overclaim this harness exists to prevent.

## Consequence

R-G6.1 survives — `CLAUDE_EFFORT` is confirmed present and usable as a policy
input. R-G6.3's routing policy loses its enforcement point and becomes advice
until a discriminating event exists.

Re-check on every version bump. This is the standing rule in design §13, and
this ADR is the first thing that rule should be applied to.
