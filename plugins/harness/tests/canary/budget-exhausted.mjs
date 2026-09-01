import { stageRepo } from "./_stage.mjs";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** A task that has run well past the wall-clock budget its contract declares. */
export const meta = { gate: "budget", expect: "block" };
export function event() { return {}; }
export async function stage() {
  const { root, taskId } = stageRepo({ plan: true });
  const contract = join(root, ".harness", "tasks", taskId, "contract.yaml");
  writeFileSync(contract, `${readFileSync(contract, "utf8")}budget:\n  minutes: 30\n`);
  return {
    root,
    event: { hook_event_name: "PostToolBatch", session_id: "canary", cwd: root },
    events: [{ event: "PreToolUse", ts: new Date(Date.now() - 90 * 60 * 1000).toISOString(), session_id: "canary", task: taskId, verdict: "pass" }],
  };
}
