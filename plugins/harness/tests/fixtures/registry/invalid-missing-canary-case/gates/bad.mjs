export const meta = { id: "bad", events: ["PreToolUse"], blocking: true, failClosed: true, timeoutMs: 1000, handlerTimeoutMs: 5000, canaryCase: "does-not-exist" };
export async function check() { return { verdict: "pass" }; }
