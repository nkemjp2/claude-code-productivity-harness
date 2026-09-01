# Harness Plugin — Implementation and Defensive Moat

**Author:** Nkem Joseph-Palmer
**Status:** Draft for implementation
**Companion to:** `claude-code-harness-design.md` (layers, requirements, roadmap)
**Purpose:** Specify the distributable plugin, and turn every known platform gotcha into a structural countermeasure rather than a thing to remember.

---

## 1. Design stance

A gotcha you have to remember is a defect waiting for a tired evening. Every item in §4 is therefore converted into one of four kinds of countermeasure:

| Kind | Meaning |
|------|---------|
| **Structural** | The mistake is impossible to make, because the shape of the code forbids it |
| **Runtime** | The runner detects and neutralises the condition while it happens |
| **Preflight** | `harness doctor` proves the condition is absent before you rely on it |
| **CI** | The canary suite fails the build if the countermeasure regresses |

A gotcha with only a documentation countermeasure is treated as unmitigated.

---

## 2. Plugin structure

```
claude-harness/                          # one repo: marketplace + plugin
  .claude-plugin/
    marketplace.json                     # catalog entry pointing at plugins/harness
  plugins/harness/
    plugin.json                          # includes minimum supported Claude Code version
    hooks/
      hooks.json                         # GENERATED — never hand-edited
    src/
      runner.mjs                         # the single entry point for every gate
      lib/
        event.mjs                        # stdin parse, schema guard
        repo.mjs                         # repo root resolution (worktree-safe)
        manifest.mjs                      # toolchain adapter loader
        policy.mjs                        # thresholds, modes, protected paths
        exec.mjs                          # sanitised child process spawner
        log.mjs                           # JSONL event append
        emit.mjs                          # the ONLY writer to stdout
      gates/                              # one module per gate, pure functions
      adapters/                            # wrappers around vendored external tools
      build/
        generate-hooks.mjs                # builds hooks.json from gates/ registry
        validate-hooks.mjs                # CI validator
    agents/                               # implementer, test-author, adversarial-reviewer
    skills/
    commands/                             # harness:init, harness:doctor, harness:status, harness:mode
    templates/                            # manifest, policy, contract, CI workflow
    tests/
      gates/                              # unit tests: sample event JSON in, exit code out
      canary/                             # deliberate violations that MUST be blocked
```

Two rules govern the whole tree:

- **One entry point.** Every hook handler in `hooks.json` invokes `runner.mjs` with a gate ID. No gate script is ever named directly in configuration.
- **One writer.** Only `emit.mjs` writes to stdout. Everything else writes to stderr or the event log.

---

## 3. The gate runner

### 3.1 Gate contract

A gate is a pure-ish module exporting metadata and a check. It never calls `process.exit`, never writes to stdout, and never throws uncaught.

```js
export const meta = {
  id: 'blast-radius',
  events: ['PreToolUse'],
  matcher: 'Edit|Write|NotebookEdit',
  if: null,                    // permission-rule syntax, tool events only
  blocking: true,              // may this gate ever block?
  failClosed: true,            // on internal error: block, or pass?
  timeoutMs: 5000,             // internal watchdog, always < platform timeout
  minVersion: '2.1.195',
  handlerTimeoutMs: 30000,     // the timeout written into hooks.json; timeoutMs MUST be < this
  mutatesInput: false,         // at most one gate in the whole harness may set this (M14)
  securityRelevant: false,     // true forces registration on PreToolUse or permissions only (M20)
  retryCounter: null,          // required when blocking on TeammateIdle or TaskCompleted (M6)
  canaryCase: 'canary/blast-radius-escape',  // required; the generator refuses without it (M2)
  requires: [{ verb: 'typecheck', required: true }]  // manifest verbs, each required or optional
};

export async function check(ctx) {
  // returns one of:
  //   { verdict: 'pass' }
  //   { verdict: 'skip', why: 'harness dormant' }
  //   { verdict: 'block', reason: '<instruction to the agent>' }
  //   { verdict: 'warn',  message: '<shown to the user>' }
  //   { verdict: 'error', detail: '<diagnostic>' }
}
```

### 3.2 Runner sequence

1. Read stdin to completion under its own timeout, then parse. Two distinct failures, two distinct outcomes:
   - **Malformed JSON.** The client sent something unusable; there is no event to act on. Log and exit 0.
   - **Read timeout or truncated stdin.** The gate never saw its input. For a gate whose `meta.failClosed` is true, exit **2** with a reason naming the read failure. The gate ID arrives in `argv`, so `failClosed` is knowable without parsing stdin, and this path must not become an unconditional bypass sitting above the fail-closed logic in §3.3.
2. **Dormancy check.** Resolve repo root; look for `.harness/manifest.yaml`. Absent means the harness is not installed in this repo: exit 0 silently, **writing no event record**, because there is no initialised location to write one to. This is the first thing that happens after the read, before any gate loads.
3. **Kill switch.** `HARNESS_DISABLE=1` or `policy.enabled: false` exits 0.
4. **Mode.** `dormant` / `observe` / `enforce`. In `observe`, every `block` verdict is downgraded to a logged `warn`.
5. **Version guard.** Compare the session's Claude Code version against `meta.minVersion`; a gate above the running version is skipped with a logged warning, never a hard failure.
6. Run the gate under the internal watchdog.
7. Translate the verdict to the wire protocol (§3.3), write exactly one JSON object, exit with the mapped code.
8. Append one event record for every outcome **after** the dormancy check has passed. Dormant exits are the only unlogged path, per R-M1.1.

> **Amended by ADR-0009.** Steps 1 and 2 are reordered to read → dormancy → fail-closed, because the order above blocks tool calls in repositories that never installed the harness, contradicting M11. Dormancy resolves from `CLAUDE_PROJECT_DIR` when stdin was never read.

### 3.3 Verdict-to-exit mapping

This table is the structural answer to "exit 1 doesn't block."

| Verdict | Blocking event | Non-blocking event |
|---------|----------------|--------------------|
| `pass` | exit 0, no output | exit 0, no output |
| `skip` | exit 0, logged | exit 0, logged |
| `warn` | exit 0 + `systemMessage` | exit 0 + `systemMessage` |
| `block` | exit **2** + event-appropriate decision JSON | exit 2 (stderr surfaced to Claude) |
| `error`, `failClosed: true` | exit **2**, reason names the gate failure | exit 2, stderr surfaced |
| `error`, `failClosed: false` | exit 0 + `systemMessage` | exit 0 + `systemMessage` |
| watchdog fired, blocking gate | exit **2**, reason states the gate timed out | exit 2 |

Gate authors choose a verdict. They never choose an exit code. There is no code path in which a gate can accidentally return 1.

### 3.4 Decision payloads by event

The runner selects the correct decision shape per event, so gate authors never have to remember which event uses which field.

| Event | Decision shape the runner emits |
|-------|--------------------------------|
| `PreToolUse` | `hookSpecificOutput.permissionDecision: "deny"` plus `permissionDecisionReason` |
| `Stop`, `SubagentStop`, `PostToolUse`, `PostToolBatch`, `UserPromptSubmit`, `PreCompact`, `ConfigChange` | top-level `decision: "block"` plus `reason` |
| `TaskCreated` | top-level `decision: "block"` plus `reason` |
| `TaskCompleted`, `TeammateIdle` | exit 2, with `continue: false` and `stopReason` only on final escalation |
| `WorktreeCreate` | non-zero exit only; no JSON, because stdout is read as the worktree path |
| `SessionStart`, `SubagentStart`, `PostModelSwitch` | context injection only; these cannot block |

> **Amended by ADR-0003.** `PostModelSwitch` does not exist in client 2.1.247 and is struck from the final row.

---

## 4. Moat catalogue

Each row: the platform behaviour, what goes wrong if ignored, and the countermeasure.

### M1 — Only exit 2 blocks

Exit code 1 is treated as a non-blocking error and the action proceeds, which is the opposite of Unix convention.

**Structural.** Gates return verdicts; `emit.mjs` owns exit codes (§3.3). **CI.** A lint rule fails the build on any `process.exit` or `exit(` outside `emit.mjs`. **CI.** Canary case per blocking gate asserting a real block.

### M2 — Silently disabled gates

A mistyped script path in settings leaves a gate disabled, visible only as a transcript notice on first run.

**Structural.** `hooks.json` is generated from the gate registry, so a handler cannot reference a path that does not exist. **CI.** `validate-hooks.mjs` asserts every handler resolves to a real, executable file that has a unit test and a canary case. **Runtime.** `SessionStart` writes the expected gate roster for the session; a periodic check compares the roster against gates that have actually logged and raises a `systemMessage` naming any gate that has never fired. **Preflight.** `harness doctor` stages a violation per gate and asserts the block. Canaries execute the gate module **directly, with a forced enforce context**, never through the installed hook path — otherwise `doctor` fails on a freshly initialised repo, which `harness init` deliberately leaves in `observe`. That forced context is reachable only from the CLI, never from a hook, so it is not a bypass. **Structural.** Canary discovery is by explicit registry field: `meta.canaryCase` names the case, and the generator refuses to build a gate whose named case does not exist. Naming conventions are not used, because a convention that silently fails to match reproduces the exact failure M2 exists to prevent.

> **Amended by ADR-0010.** "A periodic check" has no scheduler in a hook system. The roster is written at `SessionStart` and evaluated at `SessionEnd`, with the finding written to the event log rather than a `systemMessage`.

### M3 — Shell profile output corrupts hook JSON

Shell-form hooks source the user profile; an unconditional `echo` in `.bashrc` or `.zshrc` prepends text to stdout and breaks JSON parsing.

**Structural.** Every handler uses exec form: `"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/src/runner.mjs", "<gate-id>"]`. Exec form spawns the executable directly with no shell, so no profile is sourced and no quoting is applied to placeholders. **Structural.** Single-writer discipline: diagnostics never touch stdout. **Preflight.** `doctor` pipes a sample event through the runner and asserts stdout parses as exactly one JSON object.

### M4 — No controlling terminal

Hooks run without a TTY, so anything interactive hangs or dies, and `/dev/tty` is unavailable.

**Runtime.** `exec.mjs` spawns every child with stdin from `/dev/null` and a sanitised environment: `CI=1`, `TERM=dumb`, `NO_COLOR=1`, `FORCE_COLOR=0`, `GIT_TERMINAL_PROMPT=0`, `GIT_PAGER=cat`, `PAGER=cat`, `npm_config_yes=true`, `DEBIAN_FRONTEND=noninteractive`. **Structural.** User-facing messages go through `systemMessage`; notifications go through `terminalSequence`, never a direct terminal write.

### M5 — Timeouts discard output and do not block

A timed-out `PreToolUse` command hook does **not** block the tool call, so a stalled gate silently fails open.

**Runtime.** Internal watchdog at 60% of the configured platform timeout. When it fires on a blocking gate, the runner returns a deterministic `block` rather than allowing cancellation. **Structural.** `meta.timeoutMs` must be strictly less than the handler's configured `timeout`; the generator enforces this and refuses to build otherwise. **Runtime.** Gate duration is recorded on every event so slow gates surface in the metrics before they start timing out.

### M6 — Stop-hook loops

A `Stop` gate that always blocks grinds. The platform caps consecutive blocks (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`, default 8) and ends the session with a warning.

**Runtime.** Read `stop_hook_active`; when true, allow the stop. **Runtime.** Independent retry counter keyed on session and task, persisted in the evidence bundle, with its ceiling set below the platform cap so the harness escalates deliberately instead of being killed. **Runtime.** On ceiling, return `continue: false` with a `stopReason` naming the unmet criteria, and write an escalation record. **Structural.** `TeammateIdle` and `TaskCompleted` have no built-in re-entrancy flag, so the runner applies the same counter to them by default; the generator refuses to register a blocking gate on those events without one.

### M7 — Role isolation, and what provenance can and cannot see

Subagents are genuinely isolated: fresh context, only the prompt string in, only the final response out. Forks are not: a fork inherits the whole conversation with identical system prompt and tools, and interactive sessions default to fork mode on recent versions.

**Verified.** When a subagent calls a tool, `PreToolUse` and `PostToolUse` fire the same hooks as in the main conversation and the input carries `agent_id` and `agent_type` identifying the subagent. Absence of those fields indicates the main conversation. So provenance *can* distinguish main-agent writes from subagent writes, and can distinguish one role from another.

**The limit.** `agent_type` names the **role**, not the **isolation mode**. A fork spawned as the test-author role reports `agent_type: test-author` while having inherited the implementation. Provenance is therefore blind to precisely the fork threat, and a provenance-only gate would return `pass` for the attack it was written to stop. The previous revision of this spec claimed independence from fork mode without establishing that; the claim was wrong.

**What actually holds.**

- **Structural, primary.** Red-green ordering. The failing test must be captured before the implementation exists, so a fork inheriting context inherits no implementation. This is sufficient for the threat, and it does not depend on identifying forks.
- **Structural, secondary.** The ordering-based tamper gate (R-L5.4): no test edit after the first implementation edit in the task. This covers the residual case of tests retrofitted once an implementation exists, which is what a fork would actually be used for.
- **Structural, role-level.** The provenance check is retained but **narrowed to role violations**: a bundle whose test files were written by the implementer role, or by the main conversation, is rejected. This catches a real and common failure and makes no claim about forks.
- **Runtime.** `agent_id`, `agent_type` and their absence are recorded on every write, so role substitution is visible in the metrics.
- **Open.** Whether `SubagentStart` or the tool-event payload exposes any fork discriminator is unverified. Verify against a real payload from inside a fork before Phase 6 is planned. If a discriminator exists, promote the fork check to a gate; if not, the three mechanisms above are the countermeasure and no fork-specific gate ships.

### M8 — `${CLAUDE_PLUGIN_ROOT}` moves on every update

Anything persisted under the plugin root is lost on upgrade.

**Structural.** The plugin root is resolved fresh at every invocation and never written to. Caches go in `${CLAUDE_PLUGIN_DATA}`; task state goes in the repo's `.harness/`. **CI.** A grep check fails the build if any template or generated file contains an absolute plugin path.

### M9 — Worktrees split the project directory

`${CLAUDE_PROJECT_DIR}` stays at the session's starting root; `cwd` in the hook payload follows the agent.

**Structural.** `repo.mjs` exposes one `resolveRepoRoot(event)` that walks up from `event.cwd` looking for `.harness/manifest.yaml` and falls back to `CLAUDE_PROJECT_DIR`. **CI.** Lint rule bans `process.cwd()` and bare `CLAUDE_PROJECT_DIR` reads outside `repo.mjs`. **CI.** Canary case runs a gate from inside a worktree.

### M10 — Windows shim executables

`.cmd` and `.bat` shims in `node_modules/.bin` are not real executables and cannot be spawned in exec form.

**Structural.** Handlers spawn `node` with a script path, which is a real binary on every platform. **Runtime.** `exec.mjs` resolves manifest verbs through a platform-aware spawner rather than invoking bin shims by name. **Preflight.** `doctor` reports the platform and resolves every manifest verb, naming any that fail.

### M11 — A user-scope install would fire in every repo

Installing globally means gates fire in projects that have no contracts, no manifest and no baseline.

**Structural.** Dormancy is step 2 of the runner, before any gate loads. No manifest, no harness. **Structural.** Three modes: `dormant`, `observe` (log only), `enforce`. `harness init` starts a repo in `observe`. **Structural.** Ratchets initialise at the repo's measured baseline, not at the target, and can only tighten.

### M12 — Cloud sessions differ

Repo `CLAUDE.md`, `.claude/settings.json` hooks, `.claude/rules/`, `.claude/skills|agents|commands` and `.mcp.json` reach cloud sessions. Plugins declared in the repo's `.claude/settings.json` are installed at session start from the declared marketplace, but that requires network access to reach the marketplace source. User `~/.claude/` content and user-scope `enabledPlugins` do not reach cloud sessions.

**Structural.** `harness init` writes both `extraKnownMarketplaces` and `enabledPlugins` into the repo's `.claude/settings.json`, so the plugin follows the repo rather than the machine. **Preflight.** `doctor` checks that the marketplace host is reachable under the environment's network level; a GitHub-hosted marketplace is covered by the Trusted default list, a self-hosted git host needs a Custom allowlist entry. **Runtime.** Gates branch on `CLAUDE_CODE_REMOTE` where cloud behaviour must differ, and the runner records the surface on every event. **CI.** The critical gates are mirrored as CI checks so nothing depends solely on the plugin loading.

### M13 — Missing runtime dependencies

Local machines vary. Cloud sessions ship Node 20/21/22 plus `jq`, `yq` and `ripgrep`; a laptop may have none of them.

**Structural.** The runner has zero external dependencies: pure Node, no `jq`, no shell pipelines. **Structural.** Every manifest verb is declared `required: true` or `required: false`. A missing **optional** tool produces `skip` with a logged warning, so it degrades instead of blocking work. A missing **required** tool produces `error`, which with `failClosed: true` blocks — a typechecker that quietly skips is exactly the silently disabled gate the moat exists to prevent, and R-F2.4 forbids it. **Preflight.** `doctor` reports every verb, its resolved binary, and its version.

### M14 — `updatedInput` replaces the whole tool input, last writer wins

Matching hooks run in parallel, so two gates mutating input silently clobber each other.

**Structural.** At most one gate in the entire harness may declare `mutatesInput: true`. The generator refuses to build a second one.

### M15 — Output capped at 10,000 characters

Longer values are written to a file and replaced with a path and preview.

**Runtime.** `emit.mjs` budgets output, truncates deliberately with a structured summary plus a path to the full artefact, and never allows the platform to truncate a JSON object mid-write.

### M16 — Plugins cost context on every turn

Every enabled plugin adds tokens per turn, and the `/plugin` detail pane shows the estimate.

**Structural.** Skills stay thin; all logic lives in scripts, which cost nothing until invoked. **Preflight.** `doctor` reports the measured size of the instruction corpus against the policy's context budget. **Governance.** Rule expiry dates enforced by `harness status`.

### M17 — Version drift

Hook field names, defaults and event coverage are version-gated and change between releases.

**Runtime.** `plugin.json` declares a minimum Claude Code version; `SessionStart` asserts it and warns loudly when unmet. **Structural.** Per-gate `meta.minVersion` lets a newer gate skip cleanly on an older client rather than erroring. **Governance.** Marketplace pinned to a tag; auto-update left off; a version bump is only merged after the canary suite and the eval set pass.

> **Amended by ADR-0007.** No such `plugin.json` field exists in client 2.1.247. The minimum version travels in the generated event map and is asserted at runtime, which was always the load-bearing half.

### M18 — Marketplace removal uninstalls everything

Removing a marketplace uninstalls every plugin obtained from it.

**Governance.** Use `/plugin disable` for temporary removal and `HARNESS_DISABLE=1` for a session-level kill switch. Marketplace removal is reserved for decommissioning.

### M19 — Trust rules differ by component

Frontmatter hooks in a project subagent run only after the workspace trust dialog has been accepted for that folder, and a `-p` run does not count as acceptance. Skill frontmatter hooks follow the settings-file rule instead.

**Structural.** Every mandatory gate lives in plugin `hooks/hooks.json`, never only in subagent frontmatter. Subagent frontmatter carries role-specific conveniences only, nothing load-bearing.

### M20 — Post-hoc events cannot prevent

`PostToolUse` cannot undo the tool; exit 2 only surfaces stderr to Claude.

**Structural.** The generator refuses to register a gate with `blocking: true` on an event that cannot block, and refuses to register anything security-relevant anywhere except `PreToolUse` or the permission system. **Governance.** Hard allow and deny live in permission rules, because the `if` filter is documented as best-effort and runs the hook anyway when a Bash command cannot be resolved.

### M21 — Model-based gates reintroduce nondeterminism

Prompt hooks and agent hooks are useful but probabilistic, and agent hooks are experimental.

**Structural.** No rule may be enforced solely by a prompt or agent hook; each must have a deterministic backstop in CI. **Runtime.** Model-gate verdicts are logged with the model used, so their disagreement rate with the deterministic backstop is measurable.

### M22 — Untrusted content reaching a privileged actor

Issue text, comments, dependency files, fetched pages and MCP output all arrive as ordinary context.

**Structural.** Injected context is written as factual statements, never as imperative instructions, which is both better behaved and less likely to trip prompt-injection defences. **Structural.** Secret scanning on `PreToolUse` write tools and a pre-push gate. **Structural.** Write-capable MCP tools gated by matcher, with the `mcp__<server>__.*` form required because a bare prefix is treated as an exact string and matches nothing. **CI.** Adversarial canary cases: an injection attempt in an issue body, and a vacuous test.

### M23 — Third-party hooks outside the runner

An external tool that registers its own hook handlers sits outside the verdict protocol: it chooses its own exit codes, writes its own stdout, and has no dormancy check, no watchdog, no event record. One such tool reintroduces every failure mode in §4.

**Structural.** No external tool is ever installed as a hook. Each is wrapped in an adapter under `src/adapters/` and invoked *by* a gate, so its output is translated into a verdict and its exit code is discarded. **Structural.** The generator refuses to build if `hooks.json` contains any handler not pointing at `runner.mjs`. **Preflight.** `doctor` reads the merged hook configuration and warns on any handler the harness did not generate, naming its source settings file.

### M24 — Licence contamination

Vendored or adapted code can carry copyleft terms into a plugin that is itself installed across every repo.

**Structural.** Adapters call external tools as processes across a text boundary, never by importing their source. **CI.** A licence check runs over every declared dependency and every vendored path, with an allowlist. Any copyleft result fails the build. **Governance.** Pattern extraction from a permissively licensed project is acceptable and recorded in an ADR naming the source; forking a copyleft project is not.

### M25 — Upstream drift in adapted tools

An external tool's output format changes on update and the adapter silently starts producing `pass` for everything.

**Structural.** Every adapter declares the upstream version range it parses and asserts it at load. **Structural.** Adapters return `error` on an unparseable response, never `pass`. With `failClosed: true` this blocks rather than waves through. **CI.** Each adapter has a canary case using a recorded upstream fixture, so a format change fails the build rather than the gate.

### M26 — Concurrent appends to one event log

Matching hooks run in parallel, which is why M14 exists. Several will append to the event log in the same instant. `O_APPEND` is atomic only up to `PIPE_BUF`; a record carrying a long block reason exceeds it, and Windows behaves differently again. Silent interleaving corrupts every metric in R-M1.3.

**Structural.** One log file per process, named by session and PID, merged at read time. No shared-handle appends anywhere in the harness. **Structural.** `emit.mjs` caps a single record's serialised size and spills oversized reasons to a sidecar file referenced by path. **Governance.** Rotation by session and retention window declared in `policy.yaml`, with the merge step tolerating missing or partial files.

### M27 — `harness init` trips the `ConfigChange` gate

`init` writes `extraKnownMarketplaces` and `enabledPlugins` into `.claude/settings.json` (M12), which the `ConfigChange` gate is registered to block as an unreviewed harness config change.

**Structural.** `init` is a CLI operation that runs outside a hooked session, before the plugin is enabled in that repo. It is never invoked from inside a session. **Structural.** The `ConfigChange` gate carries a provenance exemption for a change whose diff matches the init template exactly and whose event log shows a corresponding `init` invocation. Anything else is blocked.

---

## 5. External components: borrow, adapt, or build

Several free projects already solve individual layers well. The rule is that borrowing changes *what you implement*, never *how it is enforced*: an external tool enters the harness as a gate under the runner, or it does not enter at all.

### 5.1 Decisions

| Layer | Decision | Basis |
|-------|----------|-------|
| L5 red-green enforcement | **Adapt** an existing TDD enforcement hook | Test-first blocking and over-implementation prevention are solved; reimplementing is waste |
| L5 test-quality heuristics | **Adapt** the wiring-only-test rejection pattern | Rejecting tests that assert mock calls without verifying observable behaviour is a cheap pre-filter ahead of the mutation ratchet |
| L3 coverage parsing | **Adapt** a multi-format coverage parser | Parsing nine report formats is undifferentiated work |
| F1 verb discovery | **Adapt** the probe-before-write pattern | Reading CI config first, then dry-run probing each proposed command, and reporting rather than configuring a lane that finds nothing, is exactly `harness init` |
| M1 event storage and UI | **Adapt** an existing event dashboard | Storage and visualisation are solved; the harness contributes the gate taxonomy the dashboard lacks |
| L0 contract format | **Borrow the notation** (EARS), build the schema | EARS collapses each requirement to a single testable claim with unambiguous scope, trigger and response, which is what makes criterion-to-test mapping mechanical |
| L4 evidence bundle | **Build** | No free equivalent produces a durable, archived proof object addressable from the commit |
| L7 traceability | **Build** | Nothing closes criterion → test → commit bidirectionally or flags orphaned tests |
| L5 authoring provenance | **Build** | Nothing records `agent_type` per write and rejects tests authored by the implementer role or by a fork |
| The moat (§4) | **Build** | Every project reviewed hand-writes hook configuration and exit codes, and is one typo from a silently disabled gate |

### 5.2 Adapter contract

```js
export const adapter = {
  id: 'tdd-enforce',
  upstream: { name: '<tool>', versions: '>=x.y <z.0' },
  licence: 'MIT',                 // asserted in CI against the allowlist
  invoke: 'process',              // process boundary only, never source import
  parse(stdout, stderr, code) {
    // returns { verdict, reason } — NEVER propagates the upstream exit code
    // returns { verdict: 'error' } on anything unrecognised
  }
};
```

Four rules, all enforced by the generator or CI:

1. An adapter is invoked by a gate. It never appears in `hooks.json`.
2. An adapter never returns `pass` for output it did not understand.
3. An adapter declares its upstream version range and its licence.
4. An adapter crosses a process boundary, so upstream licence terms do not reach the plugin's own source.

### 5.3 Vendoring policy

External tools are pinned by exact version, recorded in `.harness/adapters.lock`, and updated only through the same gate as any harness change: canary suite green, then eval set green, then merge. An adapter whose upstream is unmaintained or whose licence is not on the allowlist is replaced by an internal implementation rather than carried.

---

## 6. Commands

**`bin/harness.mjs` is canonical.** Every command is a CLI subcommand, because CI must be able to invoke `harness doctor` and CI cannot invoke a slash command. The entries under `commands/` are thin slash-command wrappers that shell out to the same binary, so there is one implementation and one behaviour.

| Command | Purpose |
|---------|---------|
| `harness init` | Probe the repo, write `manifest.yaml` and `policy.yaml`, set mode `observe`, measure and record baselines, write `extraKnownMarketplaces` and `enabledPlugins` into `.claude/settings.json`, scaffold the CI mirror workflow |
| `harness doctor` | Full preflight: platform, runtime deps, verb resolution, JSON purity, worktree resolution, marketplace reachability, corpus size, and the canary suite. Prints a pass/fail table |
| `harness status` | Current mode, ratchet values, rules past their review date, gates that have not fired this week, open escalations |
| `harness mode <dormant\|observe\|enforce>` | Change enforcement level, with a required reason recorded in the event log |
| `harness promote` | Tighten ratchets one notch from measured current performance |
| `harness adapters` | List adapters, their pinned upstream versions, licence, and last fixture-canary result |

`doctor` is the load-bearing one. Run it after every plugin update, every Claude Code upgrade, and on every CI run.

---

## 7. Adoption sequence

1. Build the plugin with all gates registered but the default mode `dormant`.
2. Install at user scope. Nothing changes in any existing repo, because dormancy is unconditional without a manifest.
3. `harness init` on one repo, which lands in `observe`. Collect a week of event data with no blocking.
4. Review the gate-failure taxonomy. Fix noisy gates or retire them under the credibility rule before anything blocks.
5. `harness mode enforce` for the gates that survived, starting with the completion gate and per-edit typecheck.
6. `harness promote` weekly until the ratchets reach target.
7. Repeat per repo. Promote calibrated defaults into the plugin templates as they stabilise.

---

## 8. What this spec does not cover

- Individual gate implementations beyond their contract; those follow the layer requirements in the companion design.
- The evaluation set contents, which are repo-specific.
- Any assertion about third-party tooling behaviour, which remains unverified and should be checked against each tool's own documentation.
- A supported mechanism for disabling fork mode on current Claude Code versions, which is unconfirmed. The provenance countermeasure in M7 is deliberately independent of it.
