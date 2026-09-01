export const meta = { id: "block-posttooluse", events: ["PostToolUse"], blocking: false, failClosed: true, timeoutMs: 1000, handlerTimeoutMs: 5000 };
export async function check() { return { verdict: "block", reason: "typecheck failed on the edited file" }; }
