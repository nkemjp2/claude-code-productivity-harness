# harness

A deterministic control layer for agentic coding sessions, distributed as a
Claude Code plugin.

**Dormant until a repository opts in.** Installing it changes nothing, anywhere,
until you run `harness init` in a repository — and even then it starts in
`observe`, where every refusal is logged and none is enforced.

---

## What problem this solves

Post-hoc diff review is *detection*: it reads what was produced and comments on
it. By then the agent has already committed to a plan, and the two most
expensive failures are upstream of the diff entirely:

- the plan was wrong before a line was written — ambiguous contract, missing
  context, wrong blast radius;
- nothing structurally closes the loop — the agent declares completion, and
  nothing independently verifies it.

This is a **control** layer. Gates block; they do not annotate. "Done" is a
machine predicate over artefacts on disk rather than a claim in a transcript.

Diff review stays in your stack as a backstop. It is not what this replaces.

---

## Install

```bash
# Add the marketplace, then enable the plugin
/plugin marketplace add nkemjp2/claude-code-productivity-harness
/plugin install harness@claude-harness
```

Nothing happens yet. That is the point — see [Dormancy](#dormancy).

## Adopt one repository

```bash
cd your-repo
harness init      # probes, writes config, lands in observe mode
harness doctor    # preflight: does any of this actually work here?
```

`init` reads your `package.json` scripts and CI workflows, probes each candidate
command, and **reports rather than configures** anything that does not resolve:

```
  probed     test <- node (package.json scripts.test)
  probed     typecheck <- tsc (package.json scripts.typecheck)
  configured test
  REPORTED   typecheck: 'tsc' does not resolve on this machine, so it was NOT
             written to the manifest. Configure it by hand once the tool is installed.
```

A guessed verb is a lie the harness tells itself on every subsequent run: the
gate resolves nothing and either blocks all work or — far more likely — skips
silently while reporting healthy.

### What `init` will and will not discover

**From `package.json`**, a script whose name maps to a known verb. The full set,
which is the `SCRIPT_TO_VERB` table in `src/lib/probe.mjs`:

`test` · `test:affected` · `typecheck` · `type-check` · `tsc` · `lint` ·
`lint:diff` · `build` · `mutate` · `mutate:diff` · `arch` · `arch:check` ·
`sast` · `deps` · `deps:check` · `migrate`

A script called `check` could be a typecheck, a lint, or a deploy, so unmapped
names are simply not candidates.

**From `.github/workflows/*.yml`**, only lines that *invoke a named script* —
`npm run <x>`, `pnpm <x>`, `yarn <x>`. Both `run:` and `- run:` forms are read.

Matching a verb name anywhere in the line is far too loose, and adopting a real
repository proved it: `run: pnpm exec playwright install --with-deps` matched
the `deps` script name and wired `deps:check` to a **browser install** — a
minutes-long, network-bound, side-effecting command sitting behind a checking
verb. Worse than having no verb at all. So if your CI runs tools directly rather
than through named scripts, `init` will report nothing from it, and that is
deliberate.

**Resolution** looks in `node_modules/.bin` before `PATH`, and records the
resolved absolute path rather than the bare name — on Windows those entries are
`.cmd` shims, which are not real executables and cannot be spawned in exec form.
`harness doctor` resolves verbs through exactly the same code, so the two can
never disagree about your repository.

Then follow the adoption sequence:

1. **Collect a week in `observe`.** Every block is downgraded to a logged warn.
2. **Read the taxonomy.** `harness status` shows which gates fired and which
   never did. Fix noisy gates or retire them *before* anything blocks.
3. **`harness mode enforce --reason "…"`.** A reason is required; a mode change
   with none is the one you most want to read six weeks later.
4. **`harness promote <ratchet> <measured-value>`** as the numbers improve.

Skipping straight to `enforce` is how a harness gets switched off in week two.

### Calibrate before you enforce

`harness dry-run` replays your own recent commits through the gates and reports
what each *would* have blocked. It turns "I think that gate might be noisy" into
a number, before anything blocks:

```
harness dry-run — 173 distinct files across 60 commits

  would-block rate per PreToolUse gate:
    30.6%  blast-radius           53/173  e.g. sdks/dotnet/HeirlatchClient.cs
     0.0%  plan-first              0/173
```

Thirty percent is comfortably enough noise to get a harness switched off — and
in that real example the gate was not at fault. The contract declared four
directories while the work happened across eight. Widening it to what the
repository actually touches took the same gate to **1.2%**, and the residual was
two root config files genuinely worth pausing over.

The finding generalises: **`blast-radius` is only as good as the contract it
reads, so a narrow contract turns the highest-value gate into the noisiest one.**

It is an estimate and says so. A commit's file list is not a tool call — no
ordering within a commit, no plan artefact as of then, no session state — so
sequence-dependent gates are under-reported. Use it to rank, not to conclude.

### Promote gates one at a time

`policy.yaml` takes a per-gate mode, so three gates can enforce while twelve keep
collecting evidence about whether they deserve to:

```yaml
mode: observe        # the repository default
gates:
  dod: enforce
  blast-radius: enforce
  per-edit-check: enforce
```

Fifteen gates promoted together means one noisy gate poisons the set, and the
credible response to that is switching the whole thing off. This is also how a
gate is *demoted* — back to `observe`, or `dormant` — when it fires falsely and
is not fixed within a review cycle (R-F2.5). An unrecognised value falls back to
the repository mode rather than to `enforce`: a typo must never silently
escalate a gate into blocking.

Watch the cost while you do it. `harness latency` reports p50 and p95 per gate,
slowest first, because fifteen gates is fifteen processes per matching tool call
and that is the objection most likely to end an adoption.

---

## Dormancy

The runner's second step, before any gate loads:

```
read stdin → resolve repo root → no .harness/manifest.yaml? exit 0, write nothing
```

A user-scope install therefore changes nothing in any repository that has not
opted in. No event record, no `.harness/` directory, no side effects. There is a
test asserting exactly that, including on the path where stdin never arrived.

Kill switches: `HARNESS_DISABLE=1` for a session, `enabled: false` in
`policy.yaml` for a repository.

---

## The gates

Fifteen, each with a canary case that stages a real violation and asserts the
refusal. A gate with a unit test proves its logic; only a canary proves it is
still wired in.

| Gate | Event | Refuses |
|---|---|---|
| `plan-first` | PreToolUse | an edit before a plan artefact exists for the task |
| `blast-radius` | PreToolUse | a write outside the contract's declared paths, and any agent write to `evidence/` |
| `test-tampering` | PreToolUse | a test edit **after** the first implementation edit in the same task |
| `authoring-provenance` | PreToolUse | a test written in a forked session, or by the implementer role |
| `assertion-density` | PreToolUse | a test file containing a test that asserts nothing |
| `thrash-breaker` | PreToolUse | one file edited past the threshold — usually ambiguity, not difficulty |
| `effort-routing` | PreToolUse | *warns* on protected-path work at low effort (see below) |
| `per-edit-check` | PostToolUse | surfaces a typecheck failure on the very next turn |
| `per-batch-lint` | PostToolBatch | halts the loop on a failing diff lint |
| `evidence-capture` | PostToolBatch | writes the evidence bundle — the runner, never the agent |
| `budget` | PostToolBatch | a task past its declared wall-clock budget |
| `dod` | Stop | stopping without a complete, fresh evidence bundle |
| `task-created` | TaskCreated | a task with no contract, or criteria that are not EARS-shaped |
| `task-completed` | TaskCompleted | completion without a complete bundle |
| `session-provenance` | SessionStart | records how the session began, including `fork` |

Six are `fail-closed` — an internal error blocks rather than passes:
`blast-radius`, `plan-first`, `test-tampering`, `dod`, `task-created`,
`task-completed`. The rest fail open, because a lint or budget gate that breaks
should not stop the work.

### Two that are worth understanding

**`dod` verifies; it never captures.** A Stop gate can re-fire up to the retry
ceiling, and a full-suite run is minutes long — so a capturing Stop gate turns
every refusal into another few minutes and becomes the grind it was written to
prevent. Capture happens at `PostToolBatch`, where the affected-test run is
already occurring. There is a test asserting **zero** verb invocations during a
Stop gate run, on both the passing and the failing path.

**`test-tampering` is ordering-based, not a prohibition.** Banning test edits
within a task would forbid red-green outright. What distinguishes writing a test
from retrofitting one is *when*: before the implementation exists, or after.

---

## Evidence, not assertion

The evidence bundle is written by the runner and never by the agent. An
agent-authored bundle is an *attestation* — the agent saying the tests passed —
which collapses evidence back into the assertion it was meant to replace, and
the collapse is invisible because both look identical on disk.

So provenance lives inside the bundle:

```yaml
typecheck:
  status: pass
  verb: typecheck
  command: "tsc --noEmit"
  exit_code: 0
  written_by: runner      # checked, not assumed
mutation:
  status: unavailable     # never a zero, which would read as a measurement
  score: null
  note: "no mutation runner is configured…"
```

`blast-radius` denies the agent any write to `evidence/`, and the refusal says
who does write it.

---

## Commands

| Command | Purpose |
|---|---|
| `harness init` | Probe the repo, write manifest and policy, land in `observe` |
| `harness doctor` | Preflight: platform, deps, verb resolution, JSON purity, worktrees, canaries |
| `harness dry-run [n]` | Replay the last *n* commits through the gates to estimate noise **before** enforcing |
| `harness latency` | Per-gate p50/p95 from the event log — what having the gates on actually costs |
| `harness defect <id> --commits <shas>` | Record a defect against the commits it is attributed to |
| `harness status` | Mode, ratchets, configured verbs, gates that have never fired, open escalations |
| `harness mode <m> --reason <why>` | Change enforcement level; the reason is required |
| `harness promote <ratchet> <value>` | Move a ratchet to a **measured** number |
| `harness classify <c> --incident <id> --note <text>` | Record an escaped defect with its mandated remedy |
| `harness replay <session-id>` | Address transcript, event log and evidence bundles together |
| `harness metrics` | The R-M1.3 metrics, with reasons for those that cannot be computed |
| `harness adapters` | Vendored adapters, their upstream ranges and licences |

`bin/harness.mjs` is the canonical surface — CI must be able to run
`harness doctor`, and CI cannot invoke a slash command.

**`doctor` is the load-bearing one.** Run it after every plugin update, every
client upgrade, and on every CI run:

```
  PASS  platform              darwin arm64
  PASS  node version          node 22.22.3 (minimum 20)
  WARN  client version        client 2.1.251 (via ai_agent) but the event map was
                              audited against 2.1.247. Re-run the audit before
                              trusting a gate's minVersion.
  PASS  runtime dependencies  lint -> …/node; test -> …/node
  PASS  JSON purity           stdout parsed as exactly one JSON object
  PASS  worktree resolution   resolved root .
  PASS  canaries              15 gate(s) refused their staged violation
```

---

## Verified against the client, not assumed

`docs/event-map.verified.md` records, per hook event, whether it exists and
whether exit code 2 actually prevents anything. Every row was read from the
installed client bundle rather than from documentation.

The mechanism: exit 2 sets `blockingError` **uniformly** for every event, and
what differs is the consumer. `PreToolUse` becomes `behavior: "deny"`;
`PostToolUse` becomes a message the tool has already outrun; `Stop` and
`PostToolBatch` take the end-turn path. 26 of 31 events are confirmed; the five
that are not have no gate on them.

Two findings that changed the design rather than decorating it:

- **`PreModelSwitch` does not exist.** The design wanted a model floor on
  protected-path work enforced there. It is unbuildable, so `effort-routing`
  reads `CLAUDE_EFFORT` and **warns**, saying in its own message that it enforced
  no floor. See `docs/adr/0003`.
- **`SessionStart` carries `source: fork`.** The spec left the fork
  discriminator open. It exists, so `authoring-provenance` refuses a test
  written in a forked session — the case where `agent_type` reports
  "test-author" while the session has already inherited the implementation.

**Standing rule:** hook field names and event coverage are version-gated. Re-run
the audit after every client upgrade; `doctor` warns when the running version
differs from the audited one.

---

## Repository layout

```
.claude-plugin/marketplace.json   catalogue entry
plugins/harness/
  hooks/hooks.json                GENERATED — the generator is its only writer
  bin/harness.mjs                 the canonical command surface
  src/
    runner.mjs                    the single entry point for every gate
    lib/                          event, repo, manifest, policy, exec, log, emit, …
    gates/                        one module per gate, pure functions
    adapters/                     wrappers around external tools (none vendored yet)
    build/                        hooks + event-map generators, validator
  tests/{gates,canary,lint}/      unit tests, staged violations, lint fixtures
tools/lint/                       the nine prohibition rules
docs/
  specs/                          the two specifications this implements
  adr/                            eleven decisions, append-only
  event-map.verified.md           the client audit
  deferred-register.md            what is not built, and why
```

---

## Developing

```bash
npm install
npm run check     # lint, typecheck, tests, generated-file drift, hooks, canaries, governance
```

Node 20+, ES modules, **zero runtime dependencies** in `src/runner.mjs` and
`src/lib/`. Dev dependencies are `typescript` and `@types/node` only. Type
checking is JSDoc over `.mjs` via `tsc --checkJs --noEmit --strict`; there is no
transpile step, and the runner is directly executable by `node`.

CI runs the whole suite on macOS, Linux **and Windows**. That matrix is not
ceremony — it caught two real defects invisible on the other two platforms: a
log-naming scheme that relied on pids not being recycled, and a test asserting
`startsWith("/")` for "absolute path".

Neither the suite nor the matrix caught the next four, though. Those came from
pointing the harness at a codebase whose fixtures nobody had written: CI
discovery mapping a browser install to `deps:check`, the `- run:` list form
being invisible, `init` and `doctor` disagreeing about the same repository, and
`doctor` writing diagnostic records into the event log every metric computes
from.

The lesson is the canary argument one level up. A gate that has never met a real
violation and a harness that has never met a real repository fail the same way:
silently, while every check stays green. **Adopt it somewhere real early.**

### Nine prohibitions, each enforced by a lint rule

Each rule ships with a negative fixture proving it fires, plus a registry test
that fails when a prohibition has no rule behind it.

1. No `process.exit()` outside `emit.mjs` — exit 1 is *non-blocking*, so a gate
   returning it looks enforced and is not
2. No stdout writes outside `emit.mjs`
3. No `process.cwd()` or `CLAUDE_PROJECT_DIR` outside `repo.mjs`
4. No hand-edited `hooks.json`
5. No handler pointing anywhere except `runner.mjs`
6. No adapter returning `pass` for output it did not parse
7. No persistent state under the plugin root
8. No shared-handle appends to the event log
9. No `securityRelevant` gate outside `PreToolUse`

Every rule states in its own description **what it does not catch**. A rule that
overstates its reach is a silently disabled gate wearing a lint rule's clothes.

---

## What this deliberately does not do

- Replace human review on protected paths.
- Remove your existing diff-review tooling.
- Achieve autonomy. The target is high-yield supervised work.
- Claim a mutation score, an escape rate, or a coverage number it has not
  measured. `harness metrics` computes four of eight from the log alone, a fifth
  — escape rate — once `harness defect` has supplied the denominator R-L7.3a
  requires, and gives a reason for each of the rest. A metrics table that omits
  escape rate reads as a system with no escaped defects, and a zero reads as a
  measurement.

## Licence

MIT. Adapters cross a process boundary and are checked against
`.harness/licence-allowlist.json`, so an upstream tool's terms never reach this
source.
