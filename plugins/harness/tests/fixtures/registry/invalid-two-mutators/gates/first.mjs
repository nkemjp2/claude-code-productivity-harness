export const meta = { id: "first", events: ["PreToolUse"], blocking: true, failClosed: true, timeoutMs: 1000, handlerTimeoutMs: 5000, mutatesInput: true, canaryCase: "c" };
export async function check() { return { verdict: "pass" }; }
