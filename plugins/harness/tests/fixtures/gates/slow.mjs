export const meta = { id: "slow", events: ["PreToolUse"], blocking: true, failClosed: true, timeoutMs: 300, handlerTimeoutMs: 5000 };
export async function check() {
  await new Promise((r) => setTimeout(r, 10_000));
  return { verdict: "pass" };
}
