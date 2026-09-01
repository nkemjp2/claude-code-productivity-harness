/**
 * The only writer to stdout, and the only owner of exit codes.
 *
 * This module is the structural answer to the two failures that quietly
 * disable a hook. Exit code 1 is treated as a *non-blocking* error and the
 * action proceeds, which is the opposite of Unix convention — so a gate that
 * returns 1 looks enforced and is not. And a single stray byte on stdout makes
 * the decision object unparseable, so the client sees nothing at all.
 *
 * Gate authors choose a verdict. They never choose an exit code, and they
 * never write to stdout. There is consequently no path on which a gate can
 * accidentally return 1 — see the exhaustive assertion in emit.test.mjs.
 *
 * @typedef {"pass" | "skip" | "warn" | "block" | "error"} Verdict
 * @typedef {{ exitCode: number, payload: Record<string, unknown> | null }} Decision
 */

/**
 * Events whose decision travels in `hookSpecificOutput.permissionDecision`.
 * @type {ReadonlySet<string>}
 */
const PERMISSION_SHAPE = new Set(["PreToolUse"]);

/**
 * Events that take a top-level `decision: "block"` with a `reason`.
 * @type {ReadonlySet<string>}
 */
const DECISION_SHAPE = new Set([
  "Stop",
  "SubagentStop",
  "PostToolUse",
  "PostToolBatch",
  "UserPromptSubmit",
  "PreCompact",
  "ConfigChange",
  "TaskCreated",
]);

/**
 * Events where a block is exit 2 alone, and `continue: false` appears only on
 * the final escalation (M6). Emitting it earlier ends the session instead of
 * asking for another attempt.
 * @type {ReadonlySet<string>}
 */
const CONTINUE_SHAPE = new Set(["TaskCompleted", "TeammateIdle"]);

/**
 * Events where exit 2 achieves nothing, so a block verdict must not produce
 * one. Registering a blocking gate here is refused by the generator (M20);
 * this is the runtime half of the same rule, because a gate reaching this
 * point with a block verdict would otherwise exit 2 for no effect and look
 * like enforcement in the log.
 * @type {ReadonlySet<string>}
 */
const CONTEXT_ONLY = new Set([
  "SessionStart",
  "SubagentStart",
  "PostCompact",
  "Setup",
  "StopFailure",
  "InstructionsLoaded",
  "FileChanged",
  "WorktreeRemove",
  "SessionEnd",
  "Notification",
]);

/**
 * `WorktreeCreate` reads stdout as the worktree path, so a decision object
 * there would be interpreted as a directory name. Non-zero exit, no JSON.
 * @type {ReadonlySet<string>}
 */
const NO_JSON = new Set(["WorktreeCreate"]);

/**
 * Map a verdict to an exit code and the event-appropriate decision payload.
 *
 * @param {{
 *   event: string,
 *   verdict: Verdict,
 *   blocking?: boolean,
 *   failClosed?: boolean,
 *   reason?: string,
 *   message?: string,
 *   why?: string,
 *   detail?: string,
 *   watchdogFired?: boolean,
 *   escalate?: boolean
 * }} input
 * @returns {Decision}
 */
export function decide(input) {
  const { event, verdict } = input;

  if (verdict === "pass" || verdict === "skip") {
    return { exitCode: 0, payload: null };
  }

  if (verdict === "warn") {
    return { exitCode: 0, payload: { systemMessage: input.message ?? "" } };
  }

  if (verdict === "error" && input.failClosed !== true) {
    // Fail open: the gate could not answer, and it was declared safe not to.
    // Said out loud rather than swallowed, because a gate that silently
    // stopped working is the failure this whole layer exists to surface.
    return {
      exitCode: 0,
      payload: { systemMessage: `harness gate error (not fail-closed): ${input.detail ?? "unknown"}` },
    };
  }

  // Everything below blocks: an explicit block, or a fail-closed error.
  if (CONTEXT_ONLY.has(event)) {
    return { exitCode: 0, payload: null };
  }

  const reason =
    verdict === "block"
      ? (input.reason ?? "")
      : input.watchdogFired === true
        ? `harness gate timed out: ${input.detail ?? "no detail"}`
        : `harness gate error: ${input.detail ?? "no detail"}`;

  if (NO_JSON.has(event)) {
    return { exitCode: 2, payload: null };
  }

  if (PERMISSION_SHAPE.has(event)) {
    return {
      exitCode: 2,
      payload: {
        hookSpecificOutput: {
          hookEventName: event,
          permissionDecision: "deny",
          permissionDecisionReason: reason,
        },
      },
    };
  }

  if (CONTINUE_SHAPE.has(event)) {
    return input.escalate === true
      ? { exitCode: 2, payload: { continue: false, stopReason: reason } }
      : { exitCode: 2, payload: null };
  }

  if (DECISION_SHAPE.has(event)) {
    return { exitCode: 2, payload: { decision: "block", reason } };
  }

  // An event the map does not describe. Exit 2 still surfaces stderr, and
  // inventing a payload shape for an unknown event is how malformed output
  // reaches the client.
  return { exitCode: 2, payload: null };
}

/**
 * The single write. Exactly one JSON object, or nothing at all.
 *
 * @param {Decision} decision
 * @returns {void}
 */
export function finish(decision) {
  if (decision.payload !== null) {
    process.stdout.write(JSON.stringify(decision.payload));
  }
  process.exit(decision.exitCode);
}

/**
 * Diagnostics. Never stdout — that channel carries the decision and nothing
 * else, which is what keeps a chatty gate from making a block unreadable.
 *
 * @param {string} text
 * @returns {void}
 */
export function diagnostic(text) {
  process.stderr.write(text.endsWith("\n") ? text : `${text}\n`);
}
