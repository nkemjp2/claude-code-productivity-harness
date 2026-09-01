# ADR-0008: A strict YAML subset parser, failing closed on anything outside the subset

**Status:** Accepted · 2026-09-01

## Context

`src/lib/manifest.mjs` and `src/lib/policy.mjs` must read `.harness/manifest.yaml`
and `.harness/policy.yaml`. The work order requires zero runtime dependencies in
`src/runner.mjs` and `src/lib/`. Node ships no YAML parser.

Three options: move machine-read files to JSON; vendor a permissive YAML parser;
or write a subset parser.

## Decision

Write a strict subset parser that supports exactly what the templates use —
nested maps, sequences, scalars, quoted strings, comments, booleans, integers —
and **throws on any construct outside that subset**: anchors, aliases, tags,
multi-line scalars, flow mappings, multiple documents.

## Rationale

JSON was rejected because `contract.yaml` is hand-authored per task, and a
format people write by hand should be pleasant to write by hand.

The danger is a subset parser that *guesses* at an unsupported construct. An
anchor silently mis-read is exactly the M25 failure — an adapter returning `pass`
for output it did not understand — reproduced inside our own config loader,
where it would corrupt the blast radius or the protected-path list rather than a
gate verdict.

So the parser fails closed. Unsupported input is an error, never a best effort.
This is the same stance M25 imposes on adapters, applied inward.

## Consequence

The parser needs its own fixture suite, including one fixture per rejected
construct asserting it throws rather than returns something plausible. A
template using an unsupported construct is a build failure, which is the correct
outcome — the templates and the parser evolve together.
