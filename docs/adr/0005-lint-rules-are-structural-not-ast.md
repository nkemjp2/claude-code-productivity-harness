# ADR-0005: The prohibition rules are structural checks over source text

**Status:** Accepted · 2026-09-01

## Context

The nine prohibitions need enforcement at build time. Node ships no JavaScript
parser in its standard library, so AST analysis means a dev dependency.

## Decision

Implement the rules as line-and-token structural checks over source text, with
comments and string literals stripped before matching. No parser dependency.

Each rule ships with a negative fixture that provably fires it, and the fixtures
live outside the type-check and test include paths so a deliberate violation
does not fail the build for the wrong reason.

## Rationale

The threat model is **accident, not evasion**. These rules exist so a tired
evening does not put a `process.exit()` in a gate. Nobody is obfuscating source
to defeat their own linter, and a rule that catches the accidental case is worth
more today than a parser dependency is worth.

Comment and string stripping is the part that actually matters: without it, the
word `process.exit` inside a doc comment fires the rule, the author adds an
exception, and the exception is what the next real violation hides behind.

## Consequence

False negatives are possible on deliberately unusual source. Recorded in the
deferred register as hardening. If a real violation ever slips past a rule, that
is the trigger to adopt a parser — and per M3, the incident and the rule change
are recorded together.
