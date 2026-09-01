import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

import { readStdin, parseEvent, str } from "./lib/event.mjs";
import { resolveRepoRoot, currentCommit } from "./lib/repo.mjs";
import { loadPolicy } from "./lib/policy.mjs";
import { loadManifest } from "./lib/manifest.mjs";
import { appendRecord, readRecords } from "./lib/log.mjs";
import { decide, finish, diagnostic } from "./lib/emit.mjs";
import { detectClientVersion, compareVersions } from "./lib/client.mjs";
import { activeTaskId } from "./lib/task.mjs";
import { runChild } from "./lib/exec.mjs";

/**
 * The single entry point for every gate.
 *
 * Every handler in `hooks.json` invokes this file with a gate id, so there is
 * one place where dormancy is checked, one watchdog, one verdict-to-exit
 * mapping and one event record. A gate script named directly in configuration
 * would sit outside all of it (M23), which is why the generator refuses to
 * emit one.
 *
 * Sequence, amended by ADR-0009:
 *   1. read stdin under its own timeout
 *   2. resolve dormancy — from `event.cwd`, or from `CLAUDE_PROJECT_DIR` when
 *      the read failed and there is no event to read `cwd` from
 *   3. apply fail-closed for a read failure
 *   4. kill switch, mode, version guard
 *   5. run the gate under the internal watchdog
 *   6. exactly one JSON object, then the mapped exit code
 *   7. one event record for every outcome past step 2
 *
 * Step 2 sits above step 3 deliberately. The specification ordered them the
 * other way, which blocks tool calls in repositories that never installed the
 * harness — the one thing M11 promises cannot happen.
 */

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STDIN_TIMEOUT_MS = 5000;

/** @typedef {import("./lib/emit.mjs").Verdict} Verdict */

/** Harness version, for stamping every record (R-G1.3). */
function harnessVersion() {
  try {
    const raw = readFileSync(join(PLUGIN_ROOT, "plugin.json"), "utf8");
    const v = JSON.parse(raw)["version"];
    return typeof v === "string" ? v : "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * The client version, with its provenance. See lib/client.mjs for why this is
 * not simply a field on the payload.
 *
 * @returns {{ version: string, source: "env" | "ai_agent" | "assumed" }}
 */
function clientVersion() {
  let audited = "0.0.0";
  try {
    const map = JSON.parse(readFileSync(join(PLUGIN_ROOT, "src", "generated", "event-map.json"), "utf8"));
    if (typeof map["auditedVersion"] === "string") audited = map["auditedVersion"];
  } catch {
    /* the fallback below stands */
  }
  return detectClientVersion(process.env, audited);
}

/**
 * The path a tool event is about, where there is one.
 *
 * @param {Record<string, unknown> | null} event
 * @returns {string | null}
 */
function targetPath(event) {
  const input = event?.["tool_input"];
  if (typeof input !== "object" || input === null) return null;
  const path = /** @type {Record<string, unknown>} */ (input)["file_path"];
  return typeof path === "string" && path !== "" ? path : null;
}

/**
 * Build the verb runner a gate receives.
 *
 * Gates invoke abstract verbs and never commands, so the same gate works
 * across stacks (R-F1.1). Every child goes through exec.mjs, which means
 * /dev/null on stdin and an environment with every interactive prompt
 * disarmed — a verb that prompts would hang until the watchdog, and a timed
 * out PreToolUse gate does not block (M4, M5).
 *
 * @param {string} root
 * @param {{ verbs: Record<string, { command: string, args?: string[], required: boolean }> } | null} manifest
 * @param {number} timeoutMs
 */
function makeRunVerb(root, manifest, timeoutMs) {
  return async (/** @type {string} */ verb) => {
    const spec = manifest?.verbs?.[verb];
    if (spec === undefined) {
      // Not configured is not the same as failed. `harness init` reports a verb
      // it could not resolve rather than writing it, so an absent verb here is
      // an expected state and says so.
      return {
        verb,
        command: `(${verb} is not configured in .harness/manifest.yaml)`,
        code: 127,
        stdout: "",
        stderr: `verb '${verb}' is not configured in this repository's manifest`,
        timedOut: false,
      };
    }
    const args = Array.isArray(spec.args) ? spec.args : [];
    const result = await runChild(spec.command, args, { cwd: root, timeoutMs });
    return {
      verb,
      command: [spec.command, ...args].join(" "),
      code: result.code ?? -1,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
    };
  };
}

/** Where gate modules live. Overridable so fixtures can be exercised. */
function gateRoot() {
  const override = process.env.HARNESS_GATE_ROOT;
  return override !== undefined && override !== "" ? override : join(PLUGIN_ROOT, "src", "gates");
}

/**
 * @param {string} gateId
 * @returns {Promise<{ meta: Record<string, unknown>, check: Function } | null>}
 */
async function loadGate(gateId) {
  const path = join(gateRoot(), `${gateId}.mjs`);
  if (!existsSync(path)) return null;
  try {
    const mod = await import(pathToFileURL(path).href);
    if (typeof mod.check !== "function" || typeof mod.meta !== "object" || mod.meta === null) return null;
    return { meta: mod.meta, check: mod.check };
  } catch {
    return null;
  }
}

/**
 * Run the gate against its own watchdog.
 *
 * M5 is the reason this exists rather than trusting the platform timeout: a
 * timed-out `PreToolUse` command hook does **not** block the tool call, so a
 * stalled gate fails open silently. The watchdog fires at 60% of the handler
 * timeout and converts the stall into a deterministic verdict while the
 * runner still controls the outcome.
 *
 * @param {Function} check
 * @param {object} ctx
 * @param {number} timeoutMs
 * @returns {Promise<{ result: { verdict: Verdict, [k: string]: unknown } | null, threw: Error | null, timedOut: boolean }>}
 */
async function runWithWatchdog(check, ctx, timeoutMs) {
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  const watchdog = new Promise((resolveWatchdog) => {
    timer = setTimeout(() => resolveWatchdog("__watchdog__"), timeoutMs);
  });

  try {
    const outcome = await Promise.race([Promise.resolve(check(ctx)), watchdog]);
    if (outcome === "__watchdog__") return { result: null, threw: null, timedOut: true };
    return { result: /** @type {any} */ (outcome), threw: null, timedOut: false };
  } catch (err) {
    return { result: null, threw: err instanceof Error ? err : new Error(String(err)), timedOut: false };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const gateId = process.argv[2];
  if (gateId === undefined) {
    diagnostic("harness runner: no gate id in argv");
    finish({ exitCode: 0, payload: null });
    return;
  }

  const started = Date.now();

  // 1. Read.
  const read = await readStdin(STDIN_TIMEOUT_MS);
  const parsed = read.ok ? parseEvent(read.raw) : { ok: /** @type {const} */ (false) };
  const event = parsed.ok ? parsed.event : null;

  // 2. Dormancy, before anything else can block (ADR-0009).
  const root = resolveRepoRoot(event);
  if (root === null || loadManifest(root) === null) {
    finish({ exitCode: 0, payload: null });
    return;
  }

  const sessionId = str(event, "session_id") ?? "nosession";
  const eventName = str(event, "hook_event_name") ?? "unknown";
  const version = harnessVersion();
  const client = clientVersion();

  /** @param {Record<string, unknown>} extra */
  const record = (extra) => {
    appendRecord(root, sessionId, {
      ts: new Date().toISOString(),
      session_id: sessionId,
      prompt_id: str(event, "prompt_id") ?? null,
      agent_id: str(event, "agent_id") ?? null,
      agent_type: str(event, "agent_type") ?? null,
      event: eventName,
      tool: str(event, "tool_name") ?? null,
      // R-M1.1 names both of these explicitly. `target` is also what the
      // ordering-based tamper gate reads to know whether implementation work
      // has begun, so an absent target is a silently weakened gate.
      target: targetPath(event),
      task: activeTaskId(root),
      gate: gateId,
      duration_ms: Date.now() - started,
      harness_version: version,
      client_version: client.version,
      client_version_source: client.source,
      ...extra,
    });
  };

  const gate = await loadGate(gateId);

  // 3. Fail-closed for a read failure — now that dormancy has passed, so this
  //    can only ever affect a repository that opted in.
  if (!read.ok) {
    const failClosed = gate?.meta["failClosed"] === true;
    const detail = `stdin read failed (${read.kind}): the gate never saw its input`;
    diagnostic(`harness: ${detail}`);
    record({ verdict: failClosed ? "error" : "skip", reason: detail });
    finish(
      decide({ event: eventName, verdict: "error", blocking: true, failClosed, detail }),
    );
    return;
  }

  // Malformed JSON: unusable input, but nothing to act on either.
  if (!parsed.ok) {
    record({ verdict: "skip", reason: "malformed event JSON" });
    finish({ exitCode: 0, payload: null });
    return;
  }

  // 4. Kill switch.
  if (process.env.HARNESS_DISABLE === "1") {
    record({ verdict: "skip", reason: "HARNESS_DISABLE=1" });
    finish({ exitCode: 0, payload: null });
    return;
  }

  const policy = loadPolicy(root);
  if (!policy.enabled || policy.mode === "dormant") {
    record({ verdict: "skip", reason: `policy ${policy.enabled ? policy.mode : "disabled"}` });
    finish({ exitCode: 0, payload: null });
    return;
  }

  if (gate === null) {
    const detail = `gate '${gateId}' could not be loaded`;
    diagnostic(`harness: ${detail}`);
    record({ verdict: "error", reason: detail });
    finish({ exitCode: 0, payload: { systemMessage: `harness: ${detail}` } });
    return;
  }

  // 5. Version guard. A gate above the running client skips with a warning,
  //    never an error — M17. Erroring would take a whole session down for a
  //    gate that simply has not arrived yet.
  const minVersion = gate.meta["minVersion"];
  if (typeof minVersion === "string" && compareVersions(client.version, minVersion) < 0) {
    diagnostic(`harness: gate '${gateId}' needs client ${minVersion}, running ${client.version}; skipping`);
    record({ verdict: "skip", reason: `minVersion ${minVersion} > client ${client.version}` });
    finish({ exitCode: 0, payload: null });
    return;
  }

  // 6. Run under the watchdog.
  const handlerTimeout = typeof gate.meta["handlerTimeoutMs"] === "number" ? gate.meta["handlerTimeoutMs"] : 30_000;
  const declared = typeof gate.meta["timeoutMs"] === "number" ? gate.meta["timeoutMs"] : Math.floor(handlerTimeout * 0.6);
  const watchdogMs = Math.min(declared, Math.floor(handlerTimeout * 0.6));

  const failClosed = gate.meta["failClosed"] === true;
  const blocking = gate.meta["blocking"] === true;
  const manifest = loadManifest(root);

  const { result, threw, timedOut } = await runWithWatchdog(
    gate.check,
    {
      event: parsed.event,
      root,
      policy,
      manifest,
      gateId,
      commit: currentCommit(root),
      // Read lazily-ish but eagerly enough to stay simple: the tamper gate
      // needs ordering, and the log is the single source for it rather than a
      // second piece of state that could drift.
      events: readRecords(root),
      runVerb: makeRunVerb(root, manifest, Math.max(1000, handlerTimeout - 2000)),
    },
    watchdogMs,
  );

  if (timedOut) {
    const detail = `gate '${gateId}' exceeded ${watchdogMs}ms`;
    diagnostic(`harness: ${detail}`);
    record({ verdict: "error", reason: detail, watchdog: true });
    finish({ ...decide({ event: eventName, verdict: "error", blocking, failClosed, detail, watchdogFired: true }) });
    return;
  }

  if (threw !== null) {
    const detail = `gate '${gateId}' threw: ${threw.message}`;
    diagnostic(`harness: ${detail}`);
    record({ verdict: "error", reason: detail });
    finish(decide({ event: eventName, verdict: "error", blocking, failClosed, detail }));
    return;
  }

  /** @type {Verdict} */
  let verdict = /** @type {Verdict} */ (result?.verdict ?? "error");
  const reason = typeof result?.["reason"] === "string" ? result["reason"] : undefined;
  const message = typeof result?.["message"] === "string" ? result["message"] : undefined;

  // 7. Observe mode downgrades every block to a logged warn. This is what
  //    makes adoption survivable: a week of real verdicts before anything is
  //    refused, so a noisy gate is retired rather than routed around.
  if (policy.mode === "observe" && verdict === "block") {
    record({ verdict: "warn", downgraded_from: "block", reason: reason ?? null });
    finish({ exitCode: 0, payload: { systemMessage: `harness (observe): ${reason ?? "would have blocked"}` } });
    return;
  }

  const escalate = result?.["escalate"] === true;
  record({ verdict, reason: reason ?? message ?? null, ...(escalate ? { escalate: true } : {}) });
  finish(
    decide({
      event: eventName,
      verdict,
      blocking,
      failClosed,
      ...(escalate ? { escalate: true } : {}),
      ...(reason === undefined ? {} : { reason }),
      ...(message === undefined ? {} : { message }),
    }),
  );
}

main().catch((err) => {
  // The runner itself failing is not a reason to break the session; it is a
  // reason to say so loudly on the channel that cannot corrupt a decision.
  diagnostic(`harness runner crashed: ${err instanceof Error ? err.message : String(err)}`);
  finish({ exitCode: 0, payload: null });
});
