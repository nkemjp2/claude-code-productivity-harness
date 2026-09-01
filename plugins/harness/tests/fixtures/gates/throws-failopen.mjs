export const meta = { id: "throws-failopen", events: ["PreToolUse"], blocking: true, failClosed: false, timeoutMs: 1000, handlerTimeoutMs: 5000 };
export async function check() { throw new Error("gate exploded"); }
