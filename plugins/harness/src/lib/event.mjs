/**
 * Reading and parsing the hook payload.
 *
 * Two failures with two different meanings, and conflating them is a defect:
 * malformed JSON means the client sent something unusable, so there is no
 * event to act on; a truncated or timed-out read means the gate never saw its
 * input at all. The first cannot justify blocking every tool call. The second
 * is exactly the condition a fail-closed gate exists for.
 *
 * @typedef {{ ok: true, raw: string }} ReadOk
 * @typedef {{ ok: false, kind: "timeout" | "truncated" }} ReadFailed
 * @typedef {Record<string, unknown>} HookEvent
 */

/**
 * Read stdin to completion under its own timeout.
 *
 * @param {number} timeoutMs
 * @returns {Promise<ReadOk | ReadFailed>}
 */
export function readStdin(timeoutMs) {
  // A deliberate testability seam. It only ever makes the runner more
  // conservative — it simulates never having seen the input — so it cannot be
  // used to skip a gate.
  if (process.env.HARNESS_SIMULATE_READ_FAILURE === "1") {
    return Promise.resolve({ ok: false, kind: "truncated" });
  }

  return new Promise((resolve) => {
    let data = "";
    let settled = false;

    const done = (/** @type {ReadOk | ReadFailed} */ value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => done({ ok: false, kind: "timeout" }), timeoutMs);

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => done({ ok: true, raw: data }));
    process.stdin.on("error", () => done({ ok: false, kind: "truncated" }));
  });
}

/**
 * @param {string} raw
 * @returns {{ ok: true, event: HookEvent } | { ok: false }}
 */
export function parseEvent(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { ok: false };
    return { ok: true, event: /** @type {HookEvent} */ (parsed) };
  } catch {
    return { ok: false };
  }
}

/**
 * @param {HookEvent | null} event
 * @param {string} key
 * @returns {string | undefined}
 */
export function str(event, key) {
  const v = event?.[key];
  return typeof v === "string" ? v : undefined;
}
