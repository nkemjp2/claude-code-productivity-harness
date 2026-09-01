export const meta = { id: "throws-failclosed", events: ["PreToolUse"], blocking: true, failClosed: true, timeoutMs: 1000, handlerTimeoutMs: 5000 };
export async function check() { throw new Error("gate exploded"); }
