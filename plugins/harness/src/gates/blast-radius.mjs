import { activeTaskId, loadContract, matchesGlob, relativePath } from "../lib/task.mjs";

/**
 * Deny writes outside the paths the contract declared (R-L0.4).
 *
 * Enforced rather than advisory, because a blast radius nobody checks is a
 * sentence in a file. Two carve-outs, each deliberate:
 *
 *   plan.md / handoff.md are writable — they are written during normal work,
 *   and protecting the whole task tree would block the agent from its own plan.
 *
 *   evidence/** is denied outright — an agent-authored bundle is an
 *   attestation, which collapses evidence back into assertion (R-L4.4a).
 */
export const meta = {
  id: "blast-radius",
  events: ["PreToolUse"],
  matcher: "Edit|Write|NotebookEdit",
  blocking: true,
  failClosed: true,
  timeoutMs: 4000,
  handlerTimeoutMs: 15000,
  mutatesInput: false,
  securityRelevant: false,
  retryCounter: null,
  canaryCase: "blast-radius-escape",
};

/**
 * @param {import("../lib/context.mjs").GateContext} ctx
 * @returns {Promise<import("../lib/context.mjs").Verdict>}
 */
export async function check(ctx) {
  const target = ctx?.event?.tool_input?.file_path;
  if (typeof target !== "string" || target === "") return { verdict: "pass" };

  const taskId = activeTaskId(ctx.root);
  if (taskId === null) {
    return { verdict: "skip", why: "no active task, so there is no contract to enforce against" };
  }

  const contract = loadContract(ctx.root, taskId);
  if (contract === null) {
    return { verdict: "skip", why: `task ${taskId} has no contract.yaml` };
  }

  const rel = relativePath(ctx.root, target);

  if (matchesGlob(`.harness/tasks/*/evidence/**`, rel)) {
    return {
      verdict: "block",
      reason:
        `${rel} is inside the evidence bundle, which the agent may never write. Evidence is captured ` +
        "by the runner invoking manifest verbs, because a bundle you wrote yourself is an attestation " +
        "rather than proof (R-L4.4a).",
    };
  }

  for (const allowed of [`.harness/tasks/${taskId}/plan.md`, `.harness/tasks/${taskId}/handoff.md`]) {
    if (rel === allowed) return { verdict: "pass" };
  }

  if (contract.blastRadius.length === 0) {
    return { verdict: "skip", why: `task ${taskId} declares no blast radius` };
  }

  if (contract.blastRadius.some((pattern) => matchesGlob(pattern, rel))) return { verdict: "pass" };

  return {
    verdict: "block",
    reason:
      `${rel} is outside the blast radius declared in .harness/tasks/${taskId}/contract.yaml ` +
      `(${contract.blastRadius.join(", ")}). Either the change belongs in a different task, or the ` +
      "contract needs widening — and widening it is a decision, not a formality.",
  };
}
