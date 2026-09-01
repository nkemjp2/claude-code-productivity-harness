import { join } from "node:path";
import { stageRepo } from "./_stage.mjs";

/** A test that runs the code and asserts nothing. */
export const meta = { gate: "assertion-density", expect: "block" };
export function event() { return {}; }
export async function stage() {
  const { root } = stageRepo({ plan: true, blastRadius: ["src/**", "tests/**"] });
  return {
    root,
    event: {
      hook_event_name: "PreToolUse", session_id: "canary", cwd: root, tool_name: "Write",
      tool_input: { file_path: join(root, "tests", "vacuous.test.ts"), content: 'test("does the thing", () => { doTheThing(); });' },
    },
  };
}
