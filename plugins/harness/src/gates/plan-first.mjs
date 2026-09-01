import { existsSync } from "node:fs";
import { join } from "node:path";

import { activeTaskId, taskDir, relativePath } from "../lib/task.mjs";

/**
 * No edits before there is a plan (R-L4.1).
 *
 * The cheapest possible intervention against the most expensive failure mode:
 * an agent that started writing before it worked out what it was doing. The
 * plan is not required to be good; it is required to exist, because writing it
 * is what surfaces the questions.
 */
export const meta = {
  id: "plan-first",
  events: ["PreToolUse"],
  matcher: "Edit|Write|NotebookEdit",
  blocking: true,
  failClosed: true,
  timeoutMs: 3000,
  handlerTimeoutMs: 15000,
  mutatesInput: false,
  securityRelevant: false,
  retryCounter: null,
  canaryCase: "plan-first-missing",
};

/**
 * @param {import("../lib/context.mjs").GateContext} ctx
 * @returns {Promise<import("../lib/context.mjs").Verdict>}
 */
export async function check(ctx) {
  const target = ctx?.event?.tool_input?.file_path;
  if (typeof target !== "string" || target === "") return { verdict: "pass" };

  const taskId = activeTaskId(ctx.root);
  if (taskId === null) return { verdict: "skip", why: "no active task" };

  const rel = relativePath(ctx.root, target);

  // Writing the plan cannot require a plan, or the only way to satisfy the
  // gate is blocked by the gate.
  if (rel === `.harness/tasks/${taskId}/plan.md` || rel === `.harness/tasks/${taskId}/handoff.md`) {
    return { verdict: "pass" };
  }

  if (existsSync(join(taskDir(ctx.root, taskId), "plan.md"))) return { verdict: "pass" };

  return {
    verdict: "block",
    reason:
      `no plan artefact exists for ${taskId}. Write .harness/tasks/${taskId}/plan.md first: what you ` +
      "intend to change, why, and which criteria it satisfies. It does not need to be long; it needs " +
      "to exist before the first edit.",
  };
}
