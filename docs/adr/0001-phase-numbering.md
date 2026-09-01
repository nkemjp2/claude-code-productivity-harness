# ADR-0001: The work order's phase numbering governs this build

**Status:** Accepted · 2026-09-01

## Context

Two numbering schemes exist for the same work. Design §11 runs phases 0–9,
where phase 4 is L5 assertion integrity and phase 9 is governance. The work
order runs phases 0–8 with different content, where Phase 4 is completion gates
and evidence capture.

The work order's precedence rule says the document wins where the two disagree.
Applied literally to phase numbers, "build Phases 0 through 4" would mean
design §11's phase 4, silently redefining the scope statement into a different
body of work.

## Decision

The work order's numbering governs **scope**. Design §11 remains the strategic
roadmap and is not renumbered.

The precedence rule is about substance — requirements, semantics, constraints —
not about labels. A label collision is not a disagreement about what is true.

## Consequence

The deferred register uses work-order numbering throughout. Design §11 phases
are referenced by their content, never by their number.
