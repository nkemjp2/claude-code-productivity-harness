export const meta = { id: "block", events: ["PreToolUse"], blocking: true, failClosed: true, timeoutMs: 1000, handlerTimeoutMs: 5000 };
export async function check() { return { verdict: "block", reason: "declared blast radius does not include this path" }; }
