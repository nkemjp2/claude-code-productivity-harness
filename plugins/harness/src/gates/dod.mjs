import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { activeTaskId, taskDir, loadContract } from "../lib/task.mjs";
import { bundleProblems } from "../lib/evidence.mjs";

/**
 * The definition-of-done gate. The highest-yield gate in the design, and the
 * easiest to turn into an expensive grind.
 *
 * Two properties keep it useful.
 *
 * **It verifies; it never captures.** A Stop gate can re-fire up to the retry
 * ceiling, and a full-suite or mutation run is minutes long. A capturing Stop
 * gate turns every refusal into another few minutes and becomes the grind it
 * was written to prevent (C3). Capture happens at PostToolBatch, where the
 * affected-test run is already occurring. A test asserts zero verb invocations
 * here, on both the passing and the failing path.
 *
 * **It escalates below the platform's cap.** The platform ends the session
 * after CLAUDE_CODE_STOP_HOOK_BLOCK_CAP consecutive blocks (default 8). A
 * harness that reaches that has handed the decision to the platform; the
 * counter here fires first and says what was not met.
 */
export const meta = {
  id: "dod",
  events: ["Stop"],
  blocking: true,
  failClosed: true,
  timeoutMs: 5000,
  handlerTimeoutMs: 20000,
  mutatesInput: false,
  securityRelevant: false,
  retryCounter: "session+task",
  canaryCase: "dod-incomplete",
};

/** @param {string} root @param {string} taskId */
function retriesPath(root, taskId) {
  return join(taskDir(root, taskId), "evidence", "retries.json");
}

/** @param {string} root @param {string} taskId */
function readRetries(root, taskId) {
  const path = retriesPath(root, taskId);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

/**
 * @param {import("../lib/context.mjs").GateContext} ctx
 * @returns {Promise<import("../lib/context.mjs").Verdict>}
 */
export async function check(ctx) {
  // M6, first. The platform sets this when a previous Stop hook already kept
  // Claude running; ignoring it is precisely how a gate grinds to the cap.
  if (ctx?.event?.stop_hook_active === true) {
    return { verdict: "pass" };
  }

  const taskId = activeTaskId(ctx.root);
  if (taskId === null) return { verdict: "skip", why: "no active task, so there is no definition of done" };

  const commit = typeof ctx.commit === "string" ? ctx.commit : "unknown";
  const problems = bundleProblems(ctx.root, taskId, commit);
  if (problems.length === 0) return { verdict: "pass" };

  const sessionId = String(ctx?.event?.session_id ?? "nosession");
  const key = `${sessionId}::${taskId}`;
  const state = readRetries(ctx.root, taskId);
  const count = Number(state[key]?.count ?? 0) + 1;

  const ceiling = Number(ctx?.policy?.budgets?.stop_retries ?? loadContract(ctx.root, taskId)?.budget?.stop_retries ?? 5);
  const escalate = count >= ceiling;

  state[key] = { count, escalated: escalate, last: new Date().toISOString() };
  try {
    mkdirSync(join(taskDir(ctx.root, taskId), "evidence"), { recursive: true });
    writeFileSync(retriesPath(ctx.root, taskId), `${JSON.stringify({ ...state, count, escalated: escalate }, null, 2)}\n`, "utf8");
  } catch {
    // Bookkeeping must not fail the gate. The verdict below still stands.
  }

  const contract = loadContract(ctx.root, taskId);
  const unmet = (contract?.criteria ?? []).map((c) => c.id).join(", ") || "the declared criteria";

  if (escalate) {
    return {
      verdict: "block",
      escalate: true,
      reason:
        `stopping after ${count} attempts on ${taskId} without a complete evidence bundle. Unmet: ` +
        `${unmet}. Outstanding: ${problems.join("; ")}. This is a deliberate escalation below the ` +
        "platform's own block cap, so a human decides what happens next rather than the session " +
        "simply ending.",
    };
  }

  return {
    verdict: "block",
    reason:
      `the evidence bundle for ${taskId} is not complete (attempt ${count} of ${ceiling}). ` +
      `${problems.join("; ")}`,
  };
}
