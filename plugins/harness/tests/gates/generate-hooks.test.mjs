import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { generateHooks, GenerationRefused } from "../../src/build/generate-hooks.mjs";
import { validateHooks } from "../../src/build/validate-hooks.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = resolve(HERE, "..", "fixtures", "registry");

/**
 * The generator refuses; it does not warn.
 *
 * `hooks.json` is generated because a hand-written handler path that does not
 * resolve leaves a gate silently disabled, surfacing only as a transcript
 * notice on first run (M2). But generation alone only moves the problem: a
 * generator that happily emits a registration the platform cannot honour
 * produces a file that looks right and enforces nothing.
 *
 * So each refusal below is a registration that would have been legal to write
 * and useless once written, and each test asserts the failure names the gate —
 * a refusal that does not say which gate is a refusal nobody can act on.
 */

/** @param {string} dir */
const roots = (dir) => ({ gateRoot: join(FIX, dir, "gates"), canaryRoot: join(FIX, dir, "canary") });

test("a valid registry generates handlers in exec form pointing at runner.mjs", async () => {
  const hooks = await generateHooks(roots("valid"));

  assert.ok(hooks._generated, "the stamp is what tells the validator a human did not write this");
  assert.equal(typeof hooks._generated.at, "string");

  const pre = hooks.hooks.PreToolUse;
  assert.ok(Array.isArray(pre) && pre.length === 1);

  const handler = pre[0].hooks[0];
  // Exec form, not shell form. Shell form sources the user profile, so an
  // unconditional echo in .bashrc prepends text to stdout and the decision
  // object stops parsing (M3).
  assert.equal(handler.type, "command");
  assert.equal(handler.command, "node");
  assert.deepEqual(handler.args, ["${CLAUDE_PLUGIN_ROOT}/src/runner.mjs", "blast-radius"]);
  assert.equal(handler.timeout, 30000);

  assert.ok(hooks.hooks.Stop, "the Stop gate must be registered too");
});

test("every generated handler points at runner.mjs and nothing else", async () => {
  // M23. One handler outside the runner reintroduces every failure mode the
  // moat closes: its own exit codes, its own stdout, no dormancy check, no
  // watchdog, no event record.
  const hooks = await generateHooks(roots("valid"));
  const serialised = JSON.stringify(hooks);
  for (const m of serialised.matchAll(/"args":\[([^\]]*)\]/g)) {
    assert.match(String(m[1]), /runner\.mjs/, `handler args ${m[1]} escape the runner`);
  }
});

/* One refusal per condition. Each asserts the gate is named. */

test("refuses blocking:true on an event the verified map says cannot block", async () => {
  await assert.rejects(
    () => generateHooks(roots("invalid-blocking-on-nonblocking")),
    (err) => {
      if (!(err instanceof Error)) throw err;
      assert.ok(err instanceof GenerationRefused);
      assert.match(err.message, /\bbad\b/, "the refusal must name the offending gate");
      assert.match(err.message, /PostToolUse/);
      return true;
    },
  );
});

test("refuses timeoutMs that is not strictly less than handlerTimeoutMs", async () => {
  // M5. The internal watchdog exists because a timed-out PreToolUse hook does
  // not block the tool call. A watchdog that fires at or after the platform
  // timeout has already lost the race it was written to win.
  await assert.rejects(
    () => generateHooks(roots("invalid-timeout-not-less")),
    (err) => {
      if (!(err instanceof Error)) throw err;
      assert.match(err.message, /\bbad\b/);
      assert.match(err.message, /timeoutMs/);
      return true;
    },
  );
});

test("refuses a second gate declaring mutatesInput", async () => {
  // M14. updatedInput replaces the whole tool input and matching hooks run in
  // parallel, so two mutating gates silently clobber each other on last write.
  await assert.rejects(
    () => generateHooks(roots("invalid-two-mutators")),
    (err) => {
      if (!(err instanceof Error)) throw err;
      assert.match(err.message, /mutatesInput/);
      assert.match(err.message, /first|second/, "the refusal must name the gates in conflict");
      return true;
    },
  );
});

test("refuses a blocking TaskCompleted gate with no retryCounter", async () => {
  // M6. TeammateIdle and TaskCompleted carry no re-entrancy flag, so without a
  // counter the harness grinds until the platform kills the session — the
  // platform choosing the exit instead of the harness escalating.
  await assert.rejects(
    () => generateHooks(roots("invalid-missing-retry-counter")),
    (err) => {
      if (!(err instanceof Error)) throw err;
      assert.match(err.message, /\bbad\b/);
      assert.match(err.message, /retryCounter/);
      return true;
    },
  );
});

test("refuses a securityRelevant gate registered outside PreToolUse", async () => {
  // M20. Post-hoc events cannot prevent anything, so a security control there
  // is decoration that reads as enforcement in the log.
  await assert.rejects(
    () => generateHooks(roots("invalid-security-off-pretooluse")),
    (err) => {
      if (!(err instanceof Error)) throw err;
      assert.match(err.message, /\bbad\b/);
      assert.match(err.message, /securityRelevant/);
      return true;
    },
  );
});

test("refuses a gate whose named canary case does not exist", async () => {
  // M2/B5. Canary discovery is by explicit registry field rather than naming
  // convention, because a convention that silently fails to match reproduces
  // the exact failure the canary suite exists to prevent.
  await assert.rejects(
    () => generateHooks(roots("invalid-missing-canary-case")),
    (err) => {
      if (!(err instanceof Error)) throw err;
      assert.match(err.message, /\bbad\b/);
      assert.match(err.message, /canaryCase|does-not-exist/);
      return true;
    },
  );
});

test("refuses a registry whose gate module cannot be loaded", async () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-badgate-"));
  const gateRoot = join(dir, "gates");
  const canaryRoot = join(dir, "canary");
  writeFileSync(join(mkdtempSync(join(tmpdir(), "unused-")), "x"), "");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(gateRoot, { recursive: true });
  mkdirSync(canaryRoot, { recursive: true });
  writeFileSync(join(gateRoot, "broken.mjs"), "export const meta = { id: 'broken' };\n");

  await assert.rejects(
    () => generateHooks({ gateRoot, canaryRoot }),
    (err) => {
      if (!(err instanceof Error)) throw err;
      assert.match(err.message, /broken/);
      return true;
    },
  );
});

/* The validator, which is the CI half of the same rule. */

test("the validator accepts what the generator produced", async () => {
  const hooks = await generateHooks(roots("valid"));
  const file = join(mkdtempSync(join(tmpdir(), "harness-hooks-")), "hooks.json");
  writeFileSync(file, JSON.stringify(hooks, null, 2));
  assert.deepEqual(validateHooks(file), []);
});

test("the validator fails on a hand-edited hooks.json", async () => {
  const hooks = await generateHooks(roots("valid"));
  const file = join(mkdtempSync(join(tmpdir(), "harness-hooks-")), "hooks.json");
  const { _generated, ...withoutStamp } = hooks;
  writeFileSync(file, JSON.stringify(withoutStamp, null, 2));

  const problems = validateHooks(file);
  assert.ok(problems.length > 0);
  assert.match(problems.join(" "), /hand-edited|_generated/i);
});

test("the validator fails on a handler that does not point at runner.mjs", async () => {
  const hooks = await generateHooks(roots("valid"));
  hooks.hooks.PreToolUse[0].hooks[0].args = ["${CLAUDE_PLUGIN_ROOT}/src/other-tool.mjs", "scan"];
  const file = join(mkdtempSync(join(tmpdir(), "harness-hooks-")), "hooks.json");
  writeFileSync(file, JSON.stringify(hooks, null, 2));

  const problems = validateHooks(file);
  assert.match(problems.join(" "), /runner\.mjs/);
});

test("the validator notices a stamp that no longer matches the content", async () => {
  // The blind spot the prohibition-4 lint rule names: an edit that preserves
  // the stamp. The stamp carries a content hash so the validator closes it.
  const hooks = await generateHooks(roots("valid"));
  const file = join(mkdtempSync(join(tmpdir(), "harness-hooks-")), "hooks.json");
  writeFileSync(file, JSON.stringify(hooks, null, 2));
  assert.deepEqual(validateHooks(file), []);

  const tampered = JSON.parse(readFileSync(file, "utf8"));
  tampered.hooks.PreToolUse[0].matcher = "Bash";
  writeFileSync(file, JSON.stringify(tampered, null, 2));

  const problems = validateHooks(file);
  assert.ok(problems.length > 0, "a content change under an intact stamp must be caught");
  assert.match(problems.join(" "), /hash|checksum|content/i);
});
