import { test } from "node:test";
import assert from "node:assert/strict";

import { detectClientVersion } from "../../src/lib/client.mjs";

/**
 * Which client are we actually running against?
 *
 * Every gate's `meta.minVersion` guard rests on this answer, and the answer is
 * harder to get than it looks. The hook payload carries no version field —
 * verified against 2.1.247 — and `CLAUDE_CODE_VERSION`, the obvious candidate,
 * is **not set in child processes**: observed by dumping the environment of a
 * process the client spawned.
 *
 * What is set is `AI_AGENT`, in the form `claude-code_2-1-251_agent`. So that
 * is read, and the provenance travels with the answer, because a guard running
 * on a parsed environment string is a weaker claim than one running on a
 * declared field and the event record should say which.
 */

test("reads the version out of AI_AGENT", () => {
  const r = detectClientVersion({ AI_AGENT: "claude-code_2-1-251_agent" }, "2.1.247");
  assert.equal(r.version, "2.1.251");
  assert.equal(r.source, "ai_agent");
});

test("prefers an explicit CLAUDE_CODE_VERSION when one exists", () => {
  // It is unset today, but it is the field that would be authoritative if the
  // client ever populated it, so it wins where present.
  const r = detectClientVersion({ CLAUDE_CODE_VERSION: "3.0.0", AI_AGENT: "claude-code_2-1-251_agent" }, "2.1.247");
  assert.equal(r.version, "3.0.0");
  assert.equal(r.source, "env");
});

test("falls back to the audited baseline and says it is assuming", () => {
  const r = detectClientVersion({}, "2.1.247");
  assert.equal(r.version, "2.1.247");
  assert.equal(r.source, "assumed");
});

test("an unparseable AI_AGENT is not guessed at", () => {
  // A malformed value must not become a plausible-looking version. Assuming
  // the audited baseline is the honest answer; inventing one from fragments is
  // how a version guard silently starts judging against nonsense.
  for (const value of ["", "claude-code", "some-other-agent", "claude-code__agent"]) {
    const r = detectClientVersion({ AI_AGENT: value }, "2.1.247");
    assert.equal(r.source, "assumed", `AI_AGENT='${value}' was parsed into ${r.version}`);
  }
});

test("the real environment resolves to something, whatever it is", () => {
  const r = detectClientVersion(process.env, "2.1.247");
  assert.match(r.version, /^\d+\.\d+\.\d+$/);
  assert.ok(["env", "ai_agent", "assumed"].includes(r.source));
});
