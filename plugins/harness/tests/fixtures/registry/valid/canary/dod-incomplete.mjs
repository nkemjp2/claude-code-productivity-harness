export const meta = { gate: "dod", expect: "block" };
export function event() {
  return { hook_event_name: "Stop", session_id: "canary", cwd: "/repo", evidence_complete: false };
}
