export const meta = { id: "warn", events: ["PreToolUse"], blocking: true, failClosed: true, timeoutMs: 1000, handlerTimeoutMs: 5000 };
export async function check() { return { verdict: "warn", message: "worth a look" }; }
