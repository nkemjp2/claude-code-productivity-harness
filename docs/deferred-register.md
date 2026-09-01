# Deferred register

Everything out of scope, with the reason. A requirement leaves this register by
being built, or by being deleted with an ADR — never by being quietly forgotten.

**All eight phases are built.** The sections that once held Phases 5–8 are gone
because the work is done, not because it was reclassified. What remains is what
the platform cannot support and what stays genuinely unverifiable from here.

## Struck, because the platform does not support them

| Requirement | Reason |
|---|---|
| R-G6.2 | `PreModelSwitch` is absent from the client, so no hook can block a model switch and a model floor on protected-path work is unbuildable. ADR-0003. |
| R-G6.4 | Same. The stated asymmetry between a timed-out `PreModelSwitch` and a timed-out `PreToolUse` cannot be relied on, because the former event does not exist. |
| design §8 `PostModelSwitch` row | Absent from the client. ADR-0003. |

R-G6.1 and R-G6.3 survive in the honest form available: the `effort-routing`
gate reads `CLAUDE_EFFORT` — confirmed present in a spawned environment — and
**warns** when a protected path is edited at low effort. Its message says
explicitly that nothing enforced a floor, because a gate implying otherwise
would be exactly the overclaim this harness exists to prevent.

## Not built, and deliberately

| Item | Reason |
|---|---|
| A vendored adapter | The adapter *boundary* is built and enforced: upstream version range asserted at load, licence checked against the allowlist, process-boundary invocation required, and `pass` from an unparsed response structurally prevented. No third-party tool is vendored yet because each needs its own upstream verification (design §13), and vendoring one unverified would be the M25 failure on day one. |
| A populated eval set | The two-track scorer is built and tested — adversarial cases gate, outcome measures never do. The cases themselves are repo-specific by design (moat §8), and a generic set would measure nothing about the repository adopting it. |

## Still unverifiable from here

| Item | What would settle it |
|---|---|
| `plugin.json` minimum-version field | `minimumClaudeCodeVersion` appears nowhere in the client. Version assertion happens at runtime instead (ADR-0007), which was always the load-bearing half. Settled by the plugins reference, not by inspection. |
| `AI_AGENT` as a version contract | It is the only source carrying the client version into a child process, and its shape is undocumented. Detection degrades to `assumed` rather than guessing if it changes, and `doctor` reports which source was used. |
| Audited version vs running version | The event map is audited against 2.1.247; the client observed here reports 2.1.251. `doctor` warns on the mismatch. Re-audit on every client upgrade — the standing rule in design §13. |
| Private marketplace auth in automated contexts | design §13, unchanged. |
| Third-party tooling behaviour | Verified per tool when its adapter is built. |
| `UserPromptExpansion`, `PermissionDenied`, `CwdChanged`, `DirectoryAdded`, `MessageDisplay` | Five events that exist in the client and are undocumented in design §8. No gate registers on any of them, so nothing rests on the gap. `CwdChanged` may eventually be a cheaper worktree signal than walking up from `event.cwd`. |

## Resolved since the previous revision

- **The blocking column.** Every row was `design-§8` — documented, not executed.
  All 26 events that have one are now `client-2.1.247`, read from the client's
  own hook-execution path. Exit 2 sets `blockingError` uniformly; what differs
  per event is the consumer, and each consumer was located. Every gate this
  harness ships now rests on an executed claim.
- **The fork discriminator (M7).** The moat spec left it open and said to verify
  before planning assertion integrity. `SessionStart` carries
  `source ∈ startup | resume | clear | compact | fork`, so the check is promoted
  to a gate: `session-provenance` records it and `authoring-provenance` refuses
  a test written in a forked session.
- **Verb probing and `node_modules/.bin`.** Resolved by recording the absolute
  path rather than the shim name, which keeps M10's Windows trap closed.
- **Mutation ratchet, assertion density, corpus lint, escalation routing,
  budgets, thrash breaking, session replay, classification.** All built.

## Answered after the build, as mechanisms rather than reassurances

Five objections were raised once the build was complete. Each is now a command
or a policy field rather than a note.

| Objection | Mechanism |
|---|---|
| Gates unproven in the loop; nobody knows which are noisy | `harness dry-run` replays real commits and reports a would-block rate per gate, before anything enforces |
| Fifteen gates promote together, so one noisy gate poisons the set | Per-gate mode in `policy.yaml`; a gate is promoted or demoted individually (R-F2.5) |
| Latency unmeasured, and most likely to end an adoption | `harness latency` — p50/p95 per gate from durations already on every record |
| `test:affected` is absent from most repositories | `test` satisfies the requirement and the bundle records `scope: "full suite"`, so a whole-suite run never reads as affected-test evidence |
| Escape rate — the primary objective — is unmeasurable | `harness defect <id> --commits <shas>` supplies R-L7.3a's missing half; `metrics` computes it once both halves exist, and still refuses to report zero from an empty table |

Escape rate therefore moves off the unverifiable list. It is not yet *measured*
here — that needs defects recorded against real commits over real time — but it
is no longer unmeasurable, which was the criticism.

## Standing hardening

| Item | Reason |
|---|---|
| AST-based lint rules | The nine prohibition rules are line-and-token structural checks (ADR-0005), each with a negative fixture proving it fires. The threat model is accident, not evasion. |
| Prohibition 6 as originally stated | Not statically decidable; enforced as a structural proxy (ADR-0004), and the residual is covered by the recorded-fixture canary each adapter must carry. |
