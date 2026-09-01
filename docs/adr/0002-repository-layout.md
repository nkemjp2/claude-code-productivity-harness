# ADR-0002: Moat §2 governs the plugin repository; design §9 governs an adopting repository

**Status:** Accepted · 2026-09-01

## Context

Design §9 places gate code at `.claude/hooks/{lib,gates,tests}/`. Moat §2 places
it at `plugins/harness/src/`. Both describe "where the harness lives".

## Decision

They describe different trees, and both are correct for their own tree.

- **Moat §2 is this repository.** The harness is a distributable plugin; its
  implementation lives in `plugins/harness/src/`.
- **Design §9 is an adopting repository** after `harness init` — specifically
  its `.harness/` subtree (manifest, policy, tasks, events, eval) and its
  `.claude/` subtree (settings, rules, agents, skills).

Design §9's `.claude/hooks/{lib,gates,tests}/` is superseded. It describes the
pre-plugin design, where the harness was copied into each repo. Under the plugin
distribution model no gate code lives in an adopting repository at all, which is
the entire point of M12 and the dormancy rule.

## Consequence

`harness init` never writes gate code into a target repo. It writes
configuration and task scaffolding only. Any future instruction to place a gate
under a target repo's `.claude/hooks/` contradicts this ADR and M19.
