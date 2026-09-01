export const meta = { id: "noisy", events: ["PreToolUse"], blocking: true, failClosed: true, timeoutMs: 1000, handlerTimeoutMs: 5000 };
export async function check() {
  process.stderr.write("gate diagnostics that must not reach stdout\n");
  console.error("more noise");
  return { verdict: "block", reason: "blocked despite the noise" };
}
