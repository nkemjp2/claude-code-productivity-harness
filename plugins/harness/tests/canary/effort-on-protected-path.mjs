import { join } from "node:path";
import { stageRepo } from "./_stage.mjs";

/**
 * A CI workflow edited at low effort. Warns rather than blocks, deliberately:
 * PreModelSwitch does not exist, so nothing here enforced a floor.
 */
export const meta = { gate: "effort-routing", expect: "warn" };
export function event() { return {}; }
export async function stage() {
  const { root } = stageRepo({ plan: true, blastRadius: ["**"] });
  return {
    root,
    event: {
      hook_event_name: "PreToolUse", session_id: "canary", cwd: root, tool_name: "Write",
      tool_input: { file_path: join(root, ".github", "workflows", "ci.yml") },
    },
    effort: "low",
  };
}
