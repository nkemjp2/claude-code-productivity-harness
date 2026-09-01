import { join } from "node:path";
import { stageRepo } from "./_stage.mjs";

/**
 * The fork attack, staged. A session reporting the test-author role that
 * actually began as a fork, and therefore already holds the implementation.
 */
export const meta = { gate: "authoring-provenance", expect: "block" };
export function event() { return {}; }
export async function stage() {
  const { root } = stageRepo({ plan: true, blastRadius: ["src/**", "tests/**"] });
  return {
    root,
    event: {
      hook_event_name: "PreToolUse", session_id: "forked", cwd: root, tool_name: "Write",
      tool_input: { file_path: join(root, "tests", "a.test.ts") }, agent_type: "test-author",
    },
    events: [{ event: "SessionStart", session_id: "forked", session_source: "fork" }],
  };
}
