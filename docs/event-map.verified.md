# Verified hook event map

**Audited client version: 2.1.247** (`~/.local/share/claude/versions/2.1.247`)
**Audit date: 2026-09-01**

This table is the contract every later phase reads. The version guard consumes
its generated form at `plugins/harness/src/generated/event-map.json`; this file
is the source of truth and the human-readable artefact (ADR-0006).

## Method, and what each column is worth

**`exists`** is high confidence. The client bundle declares its hook events as a
quoted string array, which was extracted whole. A name present in that array
exists; a name absent from it does not, and twenty-four of the design
document's twenty-six names appear there, so the naming convention is
established and an absence is meaningful rather than merely unfound.

**`blocks on exit 2`** is *not* client-verified. It is taken from design
document §8, which states it reflects documented per-event semantics. String
presence in a binary proves an event exists; it says nothing about exit-code
handling. Extracting per-event blocking semantics from a 233 MB minified bundle
was attempted and abandoned as unreliable — the runtime path found
(`blockingError || preventContinuation`) is not decomposable per event by
inspection.

**Consequence, stated plainly:** every gate built in Phases 1–4 rests on a
documented claim, not on an executed one. The empirical probe — a fixture gate
per event returning exit 2, observing whether the action proceeds — belongs in
the Phase 2 canary suite, which is the only place it can run honestly. Until it
does, `blocks` carries the provenance `design-§8` and no stronger claim is made
for it anywhere in this repository.

Provenance values: `client-2.1.247` (read from the bundle) · `design-§8`
(documented, not executed).

## Events

| Event | Exists | Blocks on exit 2 | Decision shape | Provenance (blocks) | First seen | Verified |
|---|---|---|---|---|---|---|
| `PreToolUse` | yes | yes | `hookSpecificOutput.permissionDecision: "deny"` + `permissionDecisionReason` | design-§8 | ≤2.1.247 | 2026-09-01 |
| `PostToolUse` | yes | no (stderr surfaced) | stderr | design-§8 | ≤2.1.247 | 2026-09-01 |
| `PostToolUseFailure` | yes | no (stderr surfaced) | stderr | design-§8 | ≤2.1.247 | 2026-09-01 |
| `PostToolBatch` | yes | yes | `decision: "block"` + `reason` | design-§8 | ≤2.1.247 | 2026-09-01 |
| `Notification` | yes | no | `terminalSequence` | design-§8 | ≤2.1.247 | 2026-09-01 |
| `UserPromptSubmit` | yes | yes | `decision: "block"` + `reason` | design-§8 | ≤2.1.247 | 2026-09-01 |
| `UserPromptExpansion` | yes | unverified | unverified | none | ≤2.1.247 | 2026-09-01 |
| `SessionStart` | yes | no | `hookSpecificOutput.additionalContext` | design-§8 | ≤2.1.247 | 2026-09-01 |
| `SessionEnd` | yes | no | — (1.5s shared budget) | design-§8 | ≤2.1.247 | 2026-09-01 |
| `Stop` | yes | yes | `decision: "block"` + `reason` | design-§8 | ≤2.1.247 | 2026-09-01 |
| `StopFailure` | yes | no (output ignored) | — | design-§8 | ≤2.1.247 | 2026-09-01 |
| `SubagentStart` | yes | no | context injection | design-§8 | ≤2.1.247 | 2026-09-01 |
| `SubagentStop` | yes | yes | `decision: "block"` + `reason` | design-§8 | ≤2.1.247 | 2026-09-01 |
| `PreCompact` | yes | yes | `decision: "block"` + `reason` | design-§8 | ≤2.1.247 | 2026-09-01 |
| `PostCompact` | yes | no | context injection | design-§8 | ≤2.1.247 | 2026-09-01 |
| `PermissionRequest` | yes | via decision object | decision object | design-§8 | ≤2.1.247 | 2026-09-01 |
| `PermissionDenied` | yes | unverified | unverified | none | ≤2.1.247 | 2026-09-01 |
| `Setup` | yes | no | — | design-§8 | ≤2.1.247 | 2026-09-01 |
| `TeammateIdle` | yes | yes | `continue: false` + `stopReason` on escalation | design-§8 | ≤2.1.247 | 2026-09-01 |
| `TaskCreated` | yes | yes | `decision: "block"` + `reason` | design-§8 | ≤2.1.247 | 2026-09-01 |
| `TaskCompleted` | yes | yes | `continue: false` + `stopReason` on escalation | design-§8 | ≤2.1.247 | 2026-09-01 |
| `Elicitation` | yes | unverified | unverified | none | ≤2.1.247 | 2026-09-01 |
| `ElicitationResult` | yes | unverified | unverified | none | ≤2.1.247 | 2026-09-01 |
| `ConfigChange` | yes | yes | `decision: "block"` + `reason` | design-§8 | ≤2.1.247 | 2026-09-01 |
| `WorktreeCreate` | yes | yes (any non-zero) | none — stdout is read as the worktree path | design-§8 | ≤2.1.247 | 2026-09-01 |
| `WorktreeRemove` | yes | no | — | design-§8 | ≤2.1.247 | 2026-09-01 |
| `InstructionsLoaded` | yes | no | — | design-§8 | ≤2.1.247 | 2026-09-01 |
| `CwdChanged` | yes | unverified | unverified | none | ≤2.1.247 | 2026-09-01 |
| `FileChanged` | yes | no | — | design-§8 | ≤2.1.247 | 2026-09-01 |
| `DirectoryAdded` | yes | unverified | unverified | none | ≤2.1.247 | 2026-09-01 |
| `MessageDisplay` | yes | unverified | unverified | none | ≤2.1.247 | 2026-09-01 |

## Named in design §8, absent from the client

| Event | Status | Consequence |
|---|---|---|
| `PreModelSwitch` | **absent in 2.1.247** | R-G6.2 and R-G6.4 are unbuildable. No model floor can be enforced on protected-path work by a hook. |
| `PostModelSwitch` | **absent in 2.1.247** | The design's "stamp model into event log" row has no event to hang on. |

`ModelSwitch` occurs in the bundle only as internal identifiers —
`injectModelSwitchBreadcrumbs`, `keepOwnModelSwitchBreadcrumb`,
`pendingModelSwitchIds` — none of which is a hook event name. See ADR-0003.

## Related fields confirmed present in 2.1.247

Confirmed by direct string inspection of the client bundle. Three of these were
listed as open or high-confidence-not-certain in design §13, and are now
settled: `stop_hook_active` (§13.1), `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` (§13.2),
and `CLAUDE_EFFORT` (R-G6.1).

`stop_hook_active` · `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` · `permissionDecision` ·
`permissionDecisionReason` · `hookSpecificOutput` · `additionalContext` ·
`systemMessage` · `terminalSequence` · `updatedInput` · `asyncRewake` ·
`stopReason` · `agent_id` · `agent_type` · `CLAUDE_PLUGIN_ROOT` ·
`CLAUDE_PROJECT_DIR` · `CLAUDE_EFFORT` · `disableAllHooks` ·
`allowManagedHooksOnly`

Presence of a field name is not proof of its semantics. These are recorded so a
later version bump can diff against them, which is the standing rule in §13.
