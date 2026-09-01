export const meta = { id: "bad", events: ["PostToolUse"], blocking: true, failClosed: true, timeoutMs: 1000, handlerTimeoutMs: 5000, canaryCase: "c" };
export async function check() { return { verdict: "pass" }; }
