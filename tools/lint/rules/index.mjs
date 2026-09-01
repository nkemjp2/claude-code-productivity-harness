import { matchAll } from "../engine.mjs";

/**
 * The nine prohibitions from the work order, one rule each.
 *
 * Every rule states, in its own `describe`, what it does *not* catch. A rule
 * that overstates its reach is the silently-disabled-gate failure (M2) wearing
 * a lint rule's clothes.
 *
 * @typedef {import("../engine.mjs").Rule} Rule
 * @typedef {import("../engine.mjs").Violation} Violation
 */

const SRC = "plugins/harness/src/";
const isPluginSource = (/** @type {string} */ rel) => rel.startsWith(SRC);
const isNot = (/** @type {string} */ rel, /** @type {string} */ file) => rel !== SRC + file;

/** @type {Rule} */
const noProcessExit = {
  id: "no-process-exit",
  prohibition: 1,
  moat: "M1",
  fileset: "source",
  describe:
    "process.exit() and bare exit() are confined to emit.mjs, which owns the verdict-to-exit " +
    "mapping. Gate authors choose a verdict; they never choose an exit code, so there is no " +
    "path on which a gate can accidentally return 1 — the code the platform treats as " +
    "non-blocking. Does not catch an exit reached through a dynamically built member access.",
  appliesTo: (rel) => isPluginSource(rel) && isNot(rel, "lib/emit.mjs"),
  check: (text, rel) =>
    matchAll(text, rel, /\bprocess\s*\.\s*exit\s*\(|(?<![.\w])exit\s*\(/g, () =>
      "process.exit()/exit() outside src/lib/emit.mjs (M1). Return a verdict instead."),
};

/** @type {Rule} */
const noStdoutWrites = {
  id: "no-stdout-writes",
  prohibition: 2,
  moat: "M3",
  fileset: "source",
  describe:
    "Only emit.mjs writes to stdout. One writer means the client always reads exactly one JSON " +
    "object, so a stray diagnostic cannot corrupt a decision payload — the same failure a shell " +
    "profile's echo causes. Diagnostics go to stderr or the event log. Does not catch a write " +
    "through an aliased stream handle.",
  appliesTo: (rel) => isPluginSource(rel) && isNot(rel, "lib/emit.mjs"),
  check: (text, rel) =>
    matchAll(
      text,
      rel,
      /\bconsole\s*\.\s*(log|info|dir|table)\s*\(|\bprocess\s*\.\s*stdout\s*\.\s*write\s*\(/g,
      (m) => `${m[0].trim()} writes to stdout outside src/lib/emit.mjs (M3).`,
    ),
};

/** @type {Rule} */
const noDirectCwd = {
  id: "no-direct-cwd",
  prohibition: 3,
  moat: "M9",
  fileset: "source",
  describe:
    "repo.mjs is the only resolver of the repository root. CLAUDE_PROJECT_DIR stays at the " +
    "session's starting root while the agent's cwd follows it into a worktree, so a second " +
    "opinion about the root is a gate that reads the wrong repository. Does not catch an env " +
    "read through a computed key.",
  appliesTo: (rel) => isPluginSource(rel) && isNot(rel, "lib/repo.mjs"),
  check: (text, rel) =>
    matchAll(
      text,
      rel,
      /\bprocess\s*\.\s*cwd\s*\(|CLAUDE_PROJECT_DIR/g,
      (m) => `${m[0].trim()} outside src/lib/repo.mjs (M9). Use resolveRepoRoot(event).`,
    ),
};

/** @type {Rule} */
const hooksJsonGenerated = {
  id: "hooks-json-generated",
  prohibition: 4,
  moat: "M2",
  fileset: "hooks",
  describe:
    "hooks.json carries a generator stamp. The generator is its only writer, because a handler " +
    "path that does not resolve leaves a gate silently disabled, visible only as a transcript " +
    "notice on first run. Absence of the stamp means a human edited it. Does not catch an edit " +
    "that preserves the stamp — the stamp carries no content hash yet, which is the obvious " +
    "hardening and is recorded in the deferred register.",
  appliesTo: () => true,
  check: (text, rel) => {
    /** @type {Violation[]} */
    const out = [];
    /** @type {unknown} */
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return [{ file: rel, line: 1, message: "hooks.json is not valid JSON (M2)." }];
    }
    const stamp =
      typeof parsed === "object" && parsed !== null && "_generated" in parsed
        ? /** @type {Record<string, unknown>} */ (parsed)["_generated"]
        : undefined;
    if (stamp === undefined) {
      out.push({
        file: rel,
        line: 1,
        message:
          "hooks.json has no _generated stamp, so it was hand-edited (M2). " +
          "Run the generator; it is the only writer.",
      });
    }
    return out;
  },
};

/** @type {Rule} */
const handlersPointAtRunner = {
  id: "handlers-point-at-runner",
  prohibition: 5,
  moat: "M23",
  fileset: "hooks",
  describe:
    "Every handler invokes runner.mjs with a gate id. A handler pointing anywhere else sits " +
    "outside the verdict protocol: it picks its own exit codes, writes its own stdout, and has " +
    "no dormancy check, no watchdog and no event record. One such handler reintroduces every " +
    "failure mode the moat exists to close. Does not catch a foreign handler registered in a " +
    "settings file this repository does not own — that is `harness doctor` reading the merged " +
    "hook configuration, because a lint rule cannot see the user's machine.",
  appliesTo: () => true,
  check: (text, rel) => {
    /** @type {Violation[]} */
    const out = [];
    /** @type {unknown} */
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return [];
    }
    const seen = JSON.stringify(parsed);
    // Every "command"/"args" pair in the tree must reference runner.mjs.
    for (const m of seen.matchAll(/"args":\[(.*?)\]/g)) {
      const args = m[1] ?? "";
      if (!args.includes("runner.mjs")) {
        out.push({
          file: rel,
          line: 1,
          message: `handler args ${args} do not point at runner.mjs (M23).`,
        });
      }
    }
    return out;
  },
};

/** @type {Rule} */
const adapterNeverBlindPass = {
  id: "adapter-never-blind-pass",
  prohibition: 6,
  moat: "M25",
  fileset: "source",
  describe:
    "Restated per ADR-0004, because the original is not statically decidable: an adapter's " +
    "parse() must have a terminal path returning verdict 'error', and must not return " +
    "verdict 'pass' from a catch block. Does NOT catch an adapter that tests the wrong " +
    "condition and passes on a genuine match failure — that residual is covered by M25's " +
    "recorded upstream fixture in CI, not by this rule.",
  appliesTo: (rel) => rel.startsWith(SRC + "adapters/"),
  check: (text, rel) => {
    /** @type {Violation[]} */
    const out = [];
    if (!/\bparse\s*\(/.test(text)) return out;
    if (!/verdict\s*:\s*['"]error['"]/.test(text)) {
      out.push({
        file: rel,
        line: 1,
        message:
          "adapter parse() has no terminal verdict:'error' path (M25, ADR-0004). " +
          "Unrecognised upstream output must be an error, never a pass.",
      });
    }
    out.push(
      ...matchAll(text, rel, /catch\s*(\([^)]*\))?\s*\{[^}]*verdict\s*:\s*['"]pass['"]/g, () =>
        "adapter returns verdict:'pass' from a catch block (M25, ADR-0004)."),
    );
    return out;
  },
};

/** @type {Rule} */
const noStateUnderPluginRoot = {
  id: "no-state-under-plugin-root",
  prohibition: 7,
  moat: "M8",
  fileset: "source",
  describe:
    "Nothing is written under the plugin root. CLAUDE_PLUGIN_ROOT moves on every update, so " +
    "anything persisted there is silently lost. Caches belong in CLAUDE_PLUGIN_DATA; task " +
    "state belongs in the repository's .harness/. Does not catch a path assembled at runtime " +
    "from separately held fragments.",
  appliesTo: (rel) => isPluginSource(rel),
  check: (text, rel) =>
    matchAll(
      text,
      rel,
      /\b(writeFileSync|writeFile|appendFileSync|appendFile|mkdirSync|createWriteStream)\s*\([^;]{0,160}CLAUDE_PLUGIN_ROOT/g,
      () => "write beneath CLAUDE_PLUGIN_ROOT (M8). It moves on every plugin update.",
    ),
};

/** @type {Rule} */
const noSharedHandleAppend = {
  id: "no-shared-handle-append",
  prohibition: 8,
  moat: "M26",
  fileset: "source",
  describe:
    "One log file per process, named by session and PID, merged at read. Matching hooks run in " +
    "parallel and O_APPEND is atomic only up to PIPE_BUF, so a record carrying a long block " +
    "reason interleaves — silently corrupting every metric. Append-mode opens are confined to " +
    "log.mjs. Does not catch an append through a handle passed in from elsewhere.",
  appliesTo: (rel) => isPluginSource(rel) && isNot(rel, "lib/log.mjs"),
  check: (text, rel) =>
    matchAll(
      text,
      rel,
      /\bappendFileSync\s*\(|\bappendFile\s*\(|flags\s*:\s*['"]a['"]/g,
      (m) => `${m[0].trim()} appends outside src/lib/log.mjs (M26).`,
    ),
};

/** @type {Rule} */
const securityRelevantPreToolUseOnly = {
  id: "security-relevant-pretooluse-only",
  prohibition: 9,
  moat: "M20",
  fileset: "source",
  describe:
    "A gate declaring meta.securityRelevant may register only on PreToolUse. Post-hoc events " +
    "cannot prevent anything — exit 2 on PostToolUse merely surfaces stderr, the tool has " +
    "already run — so a security control registered there is decoration. Lintable because " +
    "securityRelevant and events are declared meta fields. Does not catch a gate that is " +
    "security-relevant in fact and never declares the flag; nothing static can, and that gap " +
    "is closed by review at registration rather than by this rule.",
  appliesTo: (rel) => rel.startsWith(SRC + "gates/"),
  check: (text, rel) => {
    /** @type {Violation[]} */
    const out = [];
    if (!/securityRelevant\s*:\s*true/.test(text)) return out;
    const events = /events\s*:\s*\[([^\]]*)\]/.exec(text);
    const listed = (events?.[1] ?? "").replace(/\s/g, "");
    if (listed !== "'PreToolUse'" && listed !== '"PreToolUse"') {
      out.push({
        file: rel,
        line: 1,
        message:
          `securityRelevant gate registers on [${listed}] (M20). ` +
          "Only PreToolUse or the permission system can prevent an action.",
      });
    }
    return out;
  },
};

/** @type {Rule[]} */
export const rules = [
  noProcessExit,
  noStdoutWrites,
  noDirectCwd,
  hooksJsonGenerated,
  handlersPointAtRunner,
  adapterNeverBlindPass,
  noStateUnderPluginRoot,
  noSharedHandleAppend,
  securityRelevantPreToolUseOnly,
];
