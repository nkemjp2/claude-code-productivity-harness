export const meta = { id: "skip", events: ["PreToolUse"], blocking: true, failClosed: true, timeoutMs: 1000, handlerTimeoutMs: 5000 };
export async function check() { return { verdict: "skip", why: "nothing to judge" }; }
