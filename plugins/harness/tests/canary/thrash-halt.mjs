import { join } from "node:path";
import { stageRepo } from "./_stage.mjs";

/** One file, edited past the threshold in a single session. */
export const meta = { gate: "thrash-breaker", expect: "block" };
export function event() { return {}; }
export async function stage() {
  const { root, taskId } = stageRepo({ plan: true });
  const target = join(root, "src", "x.ts");
  return {
    root,
    event: { hook_event_name: "PreToolUse", session_id: "canary", cwd: root, tool_name: "Edit", tool_input: { file_path: target } },
    events: Array.from({ length: 9 }, () => ({ event: "PreToolUse", session_id: "canary", task: taskId, target, verdict: "pass" })),
  };
}
