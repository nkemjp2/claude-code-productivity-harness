import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The event log (R-M1.1), and the only place an append happens.
 *
 * M26 is the reason for the shape. Matching hooks run in parallel — that is
 * why M14 exists at all — so several runners append in the same instant.
 * `O_APPEND` is atomic only up to `PIPE_BUF`, a record carrying a long block
 * reason exceeds it, and Windows behaves differently again. The corruption is
 * silent: a file that mostly parses, a few torn lines, and every metric in
 * R-M1.3 quietly wrong.
 *
 * So: one file per process, merged at read time. No shared handle exists
 * anywhere in the harness, which is prohibition 8.
 *
 * The file name carries a per-process nonce as well as the pid. The pid alone
 * was not enough, and Windows CI is what proved it: twelve concurrent runners
 * produced eleven files, because **pids are recycled**. Two runners in the same
 * session, one after the other, landed on the same pid and shared a file.
 *
 * That particular case was still safe — pids are unique among *live* processes,
 * so two concurrent writers can never collide — but "safe because of how this
 * platform recycles pids" is a platform assumption, and platform assumptions
 * are the thing this moat exists to remove. The nonce makes one-file-per-process
 * true by construction rather than by argument.
 *
 * @typedef {Record<string, unknown>} EventRecord
 */

/** Records above this are capped and their long field spilled beside them. */
const MAX_RECORD_BYTES = 4096;

/**
 * Unique to this process, computed once. Not a security value — just something
 * the operating system cannot hand to a later process the way it hands back a
 * pid.
 */
const NONCE = Math.random().toString(36).slice(2, 8);

/**
 * @param {string} root
 * @param {string} sessionId
 * @returns {string}
 */
function logPath(root, sessionId) {
  const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, "_") || "nosession";
  return join(root, ".harness", "events", `${safe}.${process.pid}-${NONCE}.jsonl`);
}

/**
 * Append one record. Never throws: a bookkeeping failure must not fail the
 * gate, because a harness that breaks the session to record that the session
 * happened is worse than no harness.
 *
 * @param {string} root
 * @param {string} sessionId
 * @param {EventRecord} record
 * @returns {void}
 */
export function appendRecord(root, sessionId, record) {
  try {
    const dir = join(root, ".harness", "events");
    mkdirSync(dir, { recursive: true });
    const path = logPath(root, sessionId);

    let payload = { ...record };
    let line = JSON.stringify(payload);

    if (Buffer.byteLength(line, "utf8") > MAX_RECORD_BYTES) {
      // Spill rather than truncate. A reason cut off mid-sentence reads as a
      // complete but wrong reason, which is worse than a pointer to the whole
      // thing (M15).
      const sidecar = `${path}.${Date.now()}.reason.txt`;
      const long = typeof payload["reason"] === "string" ? payload["reason"] : JSON.stringify(payload);
      writeFileSync(sidecar, long, "utf8");
      payload = { ...payload, reason: `${String(long).slice(0, 200)}…`, reason_ref: sidecar };
      line = JSON.stringify(payload);
    }

    appendFileSync(path, `${line}\n`, "utf8");
  } catch {
    // Deliberately silent on stdout; the diagnostic channel is stderr and the
    // caller already decided the verdict.
  }
}

/**
 * Every record, merged across per-process files (M26).
 *
 * The merge is the read half of the one-file-per-process design. Callers see a
 * single stream; the interleaving that a shared handle would have produced
 * never existed to begin with.
 *
 * @param {string} root
 * @returns {Record<string, unknown>[]}
 */
export function readRecords(root) {
  const dir = join(root, ".harness", "events");
  /** @type {Record<string, unknown>[]} */
  const out = [];
  try {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".jsonl")) continue;
      for (const line of readFileSync(join(dir, file), "utf8").split("\n")) {
        if (line.trim() === "") continue;
        try {
          out.push(JSON.parse(line));
        } catch {
          // A torn record is itself a finding, but not one a reader should
          // crash on. Per-process files exist so this stays rare.
        }
      }
    }
  } catch {
    return [];
  }
  return out.sort((a, b) => String(a["ts"] ?? "").localeCompare(String(b["ts"] ?? "")));
}
