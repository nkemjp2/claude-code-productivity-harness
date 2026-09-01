import { test } from "node:test";
import assert from "node:assert/strict";

import { decide } from "../../src/lib/emit.mjs";

/**
 * The §3.3 verdict-to-exit table and the §3.4 decision-shape table, one test
 * per row.
 *
 * These are the structural answer to "exit 1 does not block". A gate author
 * picks a verdict and never an exit code, so the mapping has to be right here
 * or it is wrong everywhere — and it is wrong silently, because a gate that
 * returns 1 looks like a gate that ran and found nothing.
 */

const BLOCKING = { event: "PreToolUse", blocking: true };
const NONBLOCKING = { event: "PostToolUse", blocking: false };

test("§3.3 pass — exit 0, no output, both event kinds", () => {
  for (const base of [BLOCKING, NONBLOCKING]) {
    const r = decide({ ...base, verdict: "pass", failClosed: true });
    assert.equal(r.exitCode, 0);
    assert.equal(r.payload, null, "a passing gate must print nothing at all");
  }
});

test("§3.3 skip — exit 0, no output, logged by the caller", () => {
  for (const base of [BLOCKING, NONBLOCKING]) {
    const r = decide({ ...base, verdict: "skip", why: "harness dormant", failClosed: true });
    assert.equal(r.exitCode, 0);
    assert.equal(r.payload, null);
  }
});

test("§3.3 warn — exit 0 plus systemMessage, both event kinds", () => {
  for (const base of [BLOCKING, NONBLOCKING]) {
    const r = decide({ ...base, verdict: "warn", message: "slow gate", failClosed: true });
    assert.equal(r.exitCode, 0);
    assert.equal(r.payload?.systemMessage, "slow gate");
  }
});

test("§3.3 block on a blocking event — exit 2 with the decision shape", () => {
  const r = decide({ ...BLOCKING, verdict: "block", reason: "outside blast radius", failClosed: true });
  assert.equal(r.exitCode, 2);
  assert.ok(r.payload);
});

test("§3.3 block on a non-blocking event — still exit 2, stderr is the channel", () => {
  // PostToolUse cannot undo the tool. Exit 2 surfaces stderr to Claude, which
  // is the whole value: a compiler-grade signal on the next turn.
  const r = decide({ ...NONBLOCKING, verdict: "block", reason: "typecheck failed", failClosed: true });
  assert.equal(r.exitCode, 2);
});

test("§3.3 error with failClosed true — exit 2, reason names the gate failure", () => {
  const r = decide({ ...BLOCKING, verdict: "error", detail: "cannot read manifest", failClosed: true });
  assert.equal(r.exitCode, 2);
  assert.match(JSON.stringify(r.payload), /cannot read manifest/);
});

test("§3.3 error with failClosed false — exit 0 plus systemMessage", () => {
  for (const base of [BLOCKING, NONBLOCKING]) {
    const r = decide({ ...base, verdict: "error", detail: "cannot read manifest", failClosed: false });
    assert.equal(r.exitCode, 0);
    assert.match(String(r.payload?.systemMessage), /cannot read manifest/);
  }
});

test("§3.3 watchdog fired on a blocking gate — exit 2, reason states the timeout", () => {
  const r = decide({
    ...BLOCKING,
    verdict: "error",
    failClosed: true,
    watchdogFired: true,
    detail: "gate exceeded 3000ms",
  });
  assert.equal(r.exitCode, 2);
  assert.match(JSON.stringify(r.payload), /timed out|timeout|exceeded/i);
});

test("a gate can never produce exit code 1", () => {
  // The single most valuable property in the table. Exit 1 is a non-blocking
  // error: the action proceeds. Any path that yields 1 is a gate that looks
  // enforced and is not.
  /** @type {import("../../src/lib/emit.mjs").Verdict[]} */
  const verdicts = ["pass", "skip", "warn", "block", "error"];
  for (const verdict of verdicts) {
    for (const failClosed of [true, false]) {
      for (const base of [BLOCKING, NONBLOCKING]) {
        const r = decide({ ...base, verdict, failClosed, reason: "r", message: "m", detail: "d" });
        assert.notEqual(r.exitCode, 1, `${verdict}/${failClosed}/${base.event} produced exit 1`);
        assert.ok([0, 2].includes(r.exitCode), `unexpected exit ${r.exitCode}`);
      }
    }
  }
});

/* §3.4 — decision shapes, one test per row. */

test("§3.4 PreToolUse — permissionDecision deny inside hookSpecificOutput", () => {
  const r = decide({ event: "PreToolUse", blocking: true, verdict: "block", reason: "denied because X", failClosed: true });
  assert.deepEqual(r.payload, {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "denied because X",
    },
  });
});

test("§3.4 top-level decision block for the seven events that use it", () => {
  const events = [
    "Stop",
    "SubagentStop",
    "PostToolUse",
    "PostToolBatch",
    "UserPromptSubmit",
    "PreCompact",
    "ConfigChange",
  ];
  for (const event of events) {
    const r = decide({ event, blocking: true, verdict: "block", reason: "because Y", failClosed: true });
    assert.deepEqual(r.payload, { decision: "block", reason: "because Y" }, `wrong shape for ${event}`);
  }
});

test("§3.4 TaskCreated — top-level decision block", () => {
  const r = decide({ event: "TaskCreated", blocking: true, verdict: "block", reason: "no contract", failClosed: true });
  assert.deepEqual(r.payload, { decision: "block", reason: "no contract" });
});

test("§3.4 TaskCompleted and TeammateIdle — exit 2 alone until final escalation", () => {
  for (const event of ["TaskCompleted", "TeammateIdle"]) {
    const ordinary = decide({ event, blocking: true, verdict: "block", reason: "not done", failClosed: true });
    assert.equal(ordinary.exitCode, 2);
    assert.equal(ordinary.payload, null, `${event} must not emit continue:false before escalation`);

    const final = decide({ event, blocking: true, verdict: "block", reason: "not done", failClosed: true, escalate: true });
    assert.equal(final.exitCode, 2);
    assert.deepEqual(final.payload, { continue: false, stopReason: "not done" });
  }
});

test("§3.4 WorktreeCreate — never JSON, because stdout is read as the path", () => {
  // Emitting a decision object here would be read as a directory name.
  const r = decide({ event: "WorktreeCreate", blocking: true, verdict: "block", reason: "setup failed", failClosed: true });
  assert.notEqual(r.exitCode, 0);
  assert.equal(r.payload, null);
});

test("§3.4 context-injection events cannot block", () => {
  for (const event of ["SessionStart", "SubagentStart"]) {
    const r = decide({ event, blocking: false, verdict: "block", reason: "should not block", failClosed: true });
    assert.equal(r.exitCode, 0, `${event} cannot block, so a block verdict must not exit 2`);
  }
});
