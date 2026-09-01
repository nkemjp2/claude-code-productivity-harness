import { activeTaskId, relativePath } from "../lib/task.mjs";

/**
 * The thrash circuit breaker (R-G5.2).
 *
 * A file edited over and over in one session is rarely incompetence
 * downstream; it is usually ambiguity upstream. Left alone it also turns an L4
 * completion gate into an expensive infinite grind — the agent cannot satisfy
 * the gate, so it edits again, so the gate refuses again.
 *
 * Halting is an escalation rather than another refusal, because the thing that
 * needs to change is not in the agent's reach.
 */
export const meta = {
  id: "thrash-breaker",
  events: ["PreToolUse"],
  matcher: "Edit|Write|NotebookEdit",
  blocking: true,
  failClosed: false,
  timeoutMs: 4000,
  handlerTimeoutMs: 15000,
  mutatesInput: false,
  securityRelevant: false,
  retryCounter: null,
  canaryCase: "thrash-halt",
};

/**
 * @param {import("../lib/context.mjs").GateContext} ctx
 * @returns {Promise<import("../lib/context.mjs").Verdict>}
 */
export async function check(ctx) {
  const target = ctx?.event?.tool_input?.file_path;
  if (typeof target !== "string" || target === "") return { verdict: "pass" };

  const threshold = Number(ctx?.policy?.budgets?.["thrash_edits"] ?? 8);
  const sessionId = String(ctx?.event?.session_id ?? "");
  const taskId = activeTaskId(ctx.root);

  const edits = (ctx.events ?? []).filter(
    (r) => r?.["session_id"] === sessionId && r?.["target"] === target && r?.["task"] === taskId,
  ).length;

  if (edits < threshold) return { verdict: "pass" };

  return {
    verdict: "block",
    escalate: true,
    reason:
      `${relativePath(ctx.root, target)} has been edited ${edits + 1} times in this session, past the ` +
      `threshold of ${threshold}. Repeated edits to one file are usually an ambiguous contract rather ` +
      "than a difficult change, and continuing costs tokens without converging. This halts for a " +
      "decision rather than refusing again.",
  };
}
