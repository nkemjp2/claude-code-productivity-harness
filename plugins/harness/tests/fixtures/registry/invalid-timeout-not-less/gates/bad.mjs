export const meta = { id: "bad", events: ["PreToolUse"], blocking: true, failClosed: true, timeoutMs: 30000, handlerTimeoutMs: 30000, canaryCase: "c" };
export async function check() { return { verdict: "pass" }; }
