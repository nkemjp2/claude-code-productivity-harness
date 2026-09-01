export const meta = { gate: "blast-radius", expect: "block" };
export function event() {
  return { hook_event_name: "PreToolUse", session_id: "canary", cwd: "/repo", tool_name: "Write", tool_input: { file_path: "/etc/passwd" } };
}
