export const meta = { id: "future", events: ["PreToolUse"], blocking: true, failClosed: true, timeoutMs: 1000, handlerTimeoutMs: 5000, minVersion: "99.0.0" };
export async function check() { return { verdict: "block", reason: "should never run on this client" }; }
