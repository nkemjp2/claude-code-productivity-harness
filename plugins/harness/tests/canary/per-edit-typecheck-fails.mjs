import { stageRepo } from "./_stage.mjs";
import { join } from "node:path";

/** A typecheck that fails after an edit must reach Claude on the next turn. */
export const meta = { gate: "per-edit-check", expect: "block" };
export function event() { return {}; }
export async function stage() {
  const { root } = stageRepo({ plan: true });
  return {
    root,
    event: {
      hook_event_name: "PostToolUse", session_id: "canary", cwd: root,
      tool_name: "Edit", tool_input: { file_path: join(root, "src", "x.ts") },
    },
    manifest: { verbs: { typecheck: { command: "node", required: false } } },
    runVerb: async (/** @type {string} */ v) => ({
      verb: v, command: "tsc --noEmit", code: 2, stdout: "",
      stderr: "src/x.ts(3,1): error TS2304: Cannot find name 'foo'.", timedOut: false,
    }),
  };
}
