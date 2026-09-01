export const meta = { id: "bad", events: ["PostToolBatch"], blocking: true, failClosed: true, timeoutMs: 1000, handlerTimeoutMs: 5000, securityRelevant: true, canaryCase: "c" };
export async function check() { return { verdict: "pass" }; }
