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

**`blocks on exit 2`** is now client-verified too. The earlier revision of this
file recorded it as documented-not-executed; that was resolved by reading the
client's hook-execution path rather than by running a live session.

The mechanism turns out to be simpler than the design assumed. Exit code 2 sets
`blockingError` **uniformly, for every event**, at the hook execution layer:

```js
if (he.status === 2) { yield { blockingError: {...}, outcome: "blocking" } }
```

What differs per event is what the *consumer* does with that flag, and that is
where the real answer lives:

| Event | Consumer behaviour in 2.1.247 |
|---|---|
| `PreToolUse` | `{ behavior: "deny", decisionReason: { type: "hook" } }` — prevents the call |
| `PostToolUse`, `PostToolUseFailure` | yields a `hook_blocking_error` *message*; the tool already ran |
| `Stop`, `PostToolBatch` | `if (blockingError \|\| preventContinuation)` → the end-turn path |
| `SubagentStop` | "whether any prevented continuation" |
| `TaskCreated`, `TaskCompleted`, `TeammateIdle` | collected through the shared `Koe(<event>, blockingError)` formatter, the same family as `Stop` |
| `UserPromptSubmit` | emits telemetry named `cmd_prompt_submit_hook_blocked` |
| `PreCompact` | throws on `blockedBy`; "compaction blocked by PreCompact hook" |
| `ConfigChange` | "ConfigChange hook blocked change to ${path}" |
| `Elicitation`, `ElicitationResult` | "Elicitation blocked by hook" / "Elicitation result blocked by hook" |
| `WorktreeCreate` | "Provides the absolute path to the created worktree directory. Command hooks print the path on stdout" — confirming no JSON may be emitted |

**Consequence:** every gate this harness ships now rests on an executed claim
rather than a documented one. The seven gates register on `PreToolUse`, `Stop`,
`TaskCreated`, `TaskCompleted` and `PostToolBatch`, and all five are confirmed
above.

Provenance: `client-2.1.247` throughout — every row below was read from the
installed client bundle, both for existence and for blocking behaviour.

## Events

| Event | Exists | Blocks on exit 2 | Decision shape | Provenance (blocks) | First seen | Verified |
|---|---|---|---|---|---|---|
| `PreToolUse` | yes | yes | `hookSpecificOutput.permissionDecision: "deny"` + `permissionDecisionReason` | client-2.1.247 | ≤2.1.247 | 2026-09-01 |
| `PostToolUse` | yes | no (stderr surfaced) | stderr | client-2.1.247 | ≤2.1.247 | 2026-09-01 |
| `PostToolUseFailure` | yes | no (stderr surfaced) | stderr | client-2.1.247 | ≤2.1.247 | 2026-09-01 |
| `PostToolBatch` | yes | yes | `decision: "block"` + `reason` | client-2.1.247 | ≤2.1.247 | 2026-09-01 |
| `Notification` | yes | no | `terminalSequence` | client-2.1.247 | ≤2.1.247 | 2026-09-01 |
| `UserPromptSubmit` | yes | yes | `decision: "block"` + `reason` | client-2.1.247 | ≤2.1.247 | 2026-09-01 |
| `UserPromptExpansion` | yes | unverified | unverified | none | ≤2.1.247 | 2026-09-01 |
| `SessionStart` | yes | no | `hookSpecificOutput.additionalContext` | client-2.1.247 | ≤2.1.247 | 2026-09-01 |
| `SessionEnd` | yes | no | — (1.5s shared budget) | client-2.1.247 | ≤2.1.247 | 2026-09-01 |
| `Stop` | yes | yes | `decision: "block"` + `reason` | client-2.1.247 | ≤2.1.247 | 2026-09-01 |
| `StopFailure` | yes | no (output ignored) | — | client-2.1.247 | ≤2.1.247 | 2026-09-01 |
| `SubagentStart` | yes | no | context injection | client-2.1.247 | ≤2.1.247 | 2026-09-01 |
| `SubagentStop` | yes | yes | `decision: "block"` + `reason` | client-2.1.247 | ≤2.1.247 | 2026-09-01 |
| `PreCompact` | yes | yes | `decision: "block"` + `reason` | client-2.1.247 | ≤2.1.247 | 2026-09-01 |
| `PostCompact` | yes | no | context injection | client-2.1.247 | ≤2.1.247 | 2026-09-01 |
| `PermissionRequest` | yes | via decision object | decision object | client-2.1.247 | ≤2.1.247 | 2026-09-01 |
| `PermissionDenied` | yes | unverified | unverified | none | ≤2.1.247 | 2026-09-01 |
| `Setup` | yes | no | — | client-2.1.247 | ≤2.1.247 | 2026-09-01 |
| `TeammateIdle` | yes | yes | `continue: false` + `stopReason` on escalation | client-2.1.247 | ≤2.1.247 | 2026-09-01 |
| `TaskCreated` | yes | yes | `decision: "block"` + `reason` | client-2.1.247 | ≤2.1.247 | 2026-09-01 |
| `TaskCompleted` | yes | yes | `continue: false` + `stopReason` on escalation | client-2.1.247 | ≤2.1.247 | 2026-09-01 |
| `Elicitation` | yes | yes | unverified | client-2.1.247 | ≤2.1.247 | 2026-09-01 |
| `ElicitationResult` | yes | yes | unverified | client-2.1.247 | ≤2.1.247 | 2026-09-01 |
| `ConfigChange` | yes | yes | `decision: "block"` + `reason` | client-2.1.247 | ≤2.1.247 | 2026-09-01 |
| `WorktreeCreate` | yes | yes (any non-zero) | none — stdout is read as the worktree path | client-2.1.247 | ≤2.1.247 | 2026-09-01 |
| `WorktreeRemove` | yes | no | — | client-2.1.247 | ≤2.1.247 | 2026-09-01 |
| `InstructionsLoaded` | yes | no | — | client-2.1.247 | ≤2.1.247 | 2026-09-01 |
| `CwdChanged` | yes | unverified | unverified | none | ≤2.1.247 | 2026-09-01 |
| `FileChanged` | yes | no | — | client-2.1.247 | ≤2.1.247 | 2026-09-01 |
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
