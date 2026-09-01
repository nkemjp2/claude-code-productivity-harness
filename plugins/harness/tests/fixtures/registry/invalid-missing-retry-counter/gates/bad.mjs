export const meta = { id: "bad", events: ["TaskCompleted"], blocking: true, failClosed: true, timeoutMs: 1000, handlerTimeoutMs: 5000, retryCounter: null, canaryCase: "c" };
export async function check() { return { verdict: "pass" }; }
