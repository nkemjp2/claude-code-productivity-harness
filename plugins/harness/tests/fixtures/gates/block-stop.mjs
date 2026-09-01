export const meta = { id: "block-stop", events: ["Stop"], blocking: true, failClosed: true, timeoutMs: 1000, handlerTimeoutMs: 5000 };
export async function check() { return { verdict: "block", reason: "evidence bundle is incomplete" }; }
