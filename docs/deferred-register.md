# Deferred register

Everything out of scope for this build, with the reason. A requirement leaves
this register by being built, or by being deleted with an ADR — never by being
quietly forgotten.

Scope of this build: work-order Phases 0–4, plus the event writer from Phase 7.
Phase numbering is the work order's, not design §11's (ADR-0001).

## Deferred by scope

| Phase | Requirement IDs | Reason |
|---|---|---|
| 5 | R-L3.1, R-L3.2, R-L3.3, R-L3.4, R-L3.5 | Inner-loop typecheck, format and per-batch diff lint. Deferred by the chosen cut; the completion gate in Phase 4 is the higher-yield half. |
| 5 | R-L6.3 (licence enforcement) | The allowlist exists at `.harness/licence-allowlist.json`; the gate that reads it does not. |
| 5 | adapter layer (moat §5.2, §5.3) | No adapter ships in this build, so M25 has nothing to guard yet. |
| 6 | R-L5.1 (mutation ratchet) | Minutes-long runs; needs the `TaskCompleted`/pre-push execution point, not `Stop`. The Phase 4 bundle records mutation's absence rather than faking a score. |
| 6 | R-L5.3 (red-green capture) | Depends on the role separation in R-L5.2, deferred with it. |
| 6 | R-L5.6 (assertion density) | Cheap, but belongs with the rest of L5 so the ratchet and the density check calibrate together. |
| 6 | R-L5.2 (role-level provenance) | **Blocked on verification.** See "Verify before planning" below. |
| 7 (remainder) | R-M1.4 (session replay) | The event writer ships in Phase 4; replay addressing does not. |
| 7 (remainder) | R-M2.1, R-M2.2, R-M3.1, R-M3.2, R-M3.3 | Classification and codification are a weekly human workflow, not code. |
| 7 (remainder) | `harness status` full reporting | Skeleton only; ratchets and escalations need Phases 5–6 data to report on. |
| 8 | R-G3.1, R-G3.2, R-G3.3 | Eval-set harness. |
| 8 | R-G2.1, R-G2.2, R-G2.3 | Corpus lint and rule hygiene. |
| 8 | R-G4.1–R-G4.5 | Escalation routing. |
| 8 | R-G5.1, R-G5.2 | Budget and thrash breakers. |
| 8 | R-G6.3 | Effort routing policy — and see ADR-0003, its enforcement point does not exist. |

## Deferred because the platform does not support them

| Requirement | Reason |
|---|---|
| R-G6.2 | `PreModelSwitch` is absent from client 2.1.247. No hook can block a model switch. ADR-0003. |
| R-G6.4 | Same. The stated asymmetry between a timed-out `PreModelSwitch` and a timed-out `PreToolUse` cannot be relied on, because the former event does not exist. |
| design §8 `PostModelSwitch` row | Absent from client 2.1.247. ADR-0003. |

## Deferred pending verification

| Item | What must be established first |
|---|---|
| Blocking semantics for all 25 in-scope events | `blocks on exit 2` is documented, not executed. **Correction:** this was expected to land in the Phase 2 canary suite, and it cannot. Canaries execute a gate module directly under a forced enforce context, which proves the gate's *logic* still refuses — it says nothing about whether the client honours exit 2 on that event, because no client is involved. Establishing that needs a live session per event: register a gate that always exits 2, perform the triggering action, observe whether it proceeds. That is a manual protocol against a real client, not a CI job. Until it runs, no gate may claim client-verified blocking. |
| `Elicitation`, `ElicitationResult` | Exist in 2.1.247, undocumented in design §8. `Elicitation` looks like a prompt-for-input path, which bears on M4's no-TTY stance — a gate that triggers one would hang. Verify before any gate is registered near it. |
| `CwdChanged` | Exists, undocumented. Bears on M9 worktree resolution; may be a cheaper signal than walking up from `event.cwd`. |
| `UserPromptExpansion`, `PermissionDenied`, `DirectoryAdded`, `MessageDisplay` | Exist, undocumented, no established harness use. |
| Client version reporting | `CLAUDE_CODE_VERSION` is **not set** in processes the client spawns — observed by dumping a spawned process's environment. The working source is `AI_AGENT` (`claude-code_2-1-251_agent`), whose shape is not a documented contract. If it changes, detection degrades to `assumed` rather than guessing. |
| Audited version vs running version | The event map is audited against **2.1.247** (the CLI binary on PATH) while the VS Code extension observed here reports **2.1.251**. Re-audit against the client actually in use before trusting any `minVersion` guard; `harness doctor` warns when the two differ. |
| `plugin.json` minimum-version field | The field name is unverified — `minimumClaudeCodeVersion` was a plausible guess and appears nowhere in the client. ADR-0007. Version assertion is done at runtime instead. |
| Fork discriminator (M7) | Before Phase 6 is planned, verify against a real payload from inside a fork whether anything distinguishes a fork from its parent. `agent_type` names the role, not the isolation mode, so a provenance-only gate returns `pass` for the fork case. If no discriminator exists, no fork-specific gate ships. |
| Private marketplace auth in automated contexts | design §13, still unverified. |
| Third-party tooling behaviour | design §13. Mutation runners, architecture linters, SAST. Each verified against its own documentation when its adapter is built. |

## Found during Phase 4

| Item | Reason |
|---|---|
| Verb probing does not look in `node_modules/.bin` | Running `harness init` against this repository resolved `lint` and `test` but reported `typecheck` unconfigured, because `tsc` lives in `node_modules/.bin` rather than on PATH. Most JavaScript repositories are in that position, so init is less useful than it should be. The fix is not simply to add that directory: on Windows those entries are `.cmd` shims, which are not real executables and cannot be spawned in exec form (M10), so resolving them by name is the trap the moat already names. Doing it half-right is worse than deferring it, so it goes to Phase 5 with the adapter and verb-resolution work. |
| The blocking-semantics probe still has not run | Restated here because Phase 4 shipped seven gates that all rest on design §8's documented `blocks` column. The canary suite proves each gate's logic still refuses; nothing yet proves the client honours exit 2 on `Stop`, `TaskCreated`, `TaskCompleted` or `PostToolBatch`. That remains a manual protocol against a live session. |

## Deferred hardening of this build's own tooling

| Item | Reason |
|---|---|
| AST-based lint rules | The nine prohibition rules are line-and-token structural checks, not AST analyses (ADR-0005). Each has a negative fixture proving it fires. An AST pass would reduce false negatives on deliberately obfuscated source; the threat model here is accident, not evasion. |
| Prohibition 6 as originally stated | "No adapter returning `pass` for output it did not parse" is not statically decidable. Enforced as a structural proxy instead — ADR-0004. |
