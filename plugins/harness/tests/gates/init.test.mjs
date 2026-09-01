import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runInit, InitRefused } from "../../src/commands/init.mjs";
import { parse } from "../../src/lib/yaml.mjs";

/**
 * `harness init` — probe before write.
 *
 * The failure this avoids is the one that poisons everything downstream: a
 * manifest full of plausible commands that do not exist on this machine. Every
 * gate then resolves a verb to nothing, and depending on `required` either
 * blocks all work or — far worse — skips silently and reports healthy.
 *
 * So init reads the repository's own CI configuration first, probes each
 * candidate, and **reports rather than configures** anything that resolves to
 * nothing. A guessed verb is a lie the harness tells itself on every
 * subsequent run.
 */

/** @param {{ pkg?: object, workflow?: string }} [opts] */
function repo(opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "harness-init-"));
  if (opts.pkg !== undefined) writeFileSync(join(dir, "package.json"), JSON.stringify(opts.pkg, null, 2));
  if (opts.workflow !== undefined) {
    mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
    writeFileSync(join(dir, ".github", "workflows", "ci.yml"), opts.workflow);
  }
  return dir;
}

/** @param {string} root */
const manifestOf = (root) => parse(readFileSync(join(root, ".harness", "manifest.yaml"), "utf8"));
/** @param {string} root */
const policyOf = (root) => parse(readFileSync(join(root, ".harness", "policy.yaml"), "utf8"));

test("init on a repo with no CI config configures nothing and reports it", async () => {
  const root = repo();
  const result = await runInit({ root });

  assert.ok(existsSync(join(root, ".harness", "manifest.yaml")));
  const verbs = /** @type {any} */ (manifestOf(root)).verbs ?? {};
  assert.deepEqual(Object.keys(verbs), [], "nothing was discoverable, so nothing may be configured");
  assert.ok(result.reported.length > 0, "init must say what it could not find rather than going quiet");
  assert.match(result.reported.join(" "), /no candidate|not discover|nothing/i);
});

test("init on a repo with a valid config discovers and probes its verbs", async () => {
  const root = repo({
    pkg: { name: "sample", scripts: { test: "node --test", typecheck: "tsc --noEmit", lint: "eslint ." } },
  });
  const result = await runInit({ root });

  const verbs = /** @type {any} */ (manifestOf(root)).verbs ?? {};
  assert.ok(Object.keys(verbs).length > 0, "package.json scripts are candidates and should have been probed");
  for (const [name, spec] of Object.entries(verbs)) {
    assert.equal(typeof /** @type {any} */ (spec).command, "string", `${name} has no command`);
    assert.equal(typeof /** @type {any} */ (spec).required, "boolean", `${name} does not declare required`);
  }
  assert.ok(result.probed.length > 0);
});

test("a partially valid config configures what resolves and reports what does not", async () => {
  // The realistic case, and the one where guessing is most tempting.
  const root = repo({
    pkg: {
      name: "sample",
      scripts: { test: "node --test", mutate: "definitely-not-on-this-machine --run" },
    },
  });
  const result = await runInit({ root });

  const verbs = /** @type {any} */ (manifestOf(root)).verbs ?? {};
  assert.ok("test" in verbs, "a verb that resolves must be configured");
  assert.ok(!("mutate" in verbs), "a verb that resolves to nothing must NOT be written");
  assert.match(result.reported.join(" "), /mutate/, "the unresolvable verb must be named in the report");
});

test("an unresolvable verb is reported and left unconfigured, never guessed", async () => {
  const root = repo({ pkg: { name: "s", scripts: { arch: "definitely-not-on-this-machine check" } } });
  const result = await runInit({ root });

  const manifest = JSON.stringify(manifestOf(root));
  assert.ok(!manifest.includes("definitely-not-on-this-machine"), "an unprobeable command was written anyway");
  assert.match(result.reported.join(" "), /arch/);
});

test("a REQUIRED verb that cannot be resolved fails init loudly", async () => {
  // M13/R-F2.4. A typechecker that quietly skips is the silently disabled gate
  // this whole design exists to prevent, so it must not be possible to
  // initialise into that state at all.
  const root = repo({ pkg: { name: "s", scripts: { typecheck: "definitely-not-on-this-machine --noEmit" } } });
  await assert.rejects(
    () => runInit({ root, require: ["typecheck"] }),
    (err) => {
      if (!(err instanceof Error)) throw err;
      assert.ok(err instanceof InitRefused);
      assert.match(err.message, /typecheck/);
      return true;
    },
  );
});

test("init lands the repository in observe, never enforce", async () => {
  // The adoption sequence depends on this. A week of real verdicts arrives
  // before anything is refused, so a noisy gate is retired under R-F2.5
  // rather than routed around.
  const root = repo({ pkg: { name: "s", scripts: { test: "node --test" } } });
  await runInit({ root });
  assert.equal(/** @type {any} */ (policyOf(root)).mode, "observe");
});

test("ratchets initialise at a measured baseline, never at a target", async () => {
  // The property, stated precisely: a ratchet may carry a number only if it
  // was measured. An aspirational default would ratchet the repo against a
  // standard it has never met, and every gate would fire on day one.
  const root = repo({ pkg: { name: "s", scripts: { test: "node --test" } } });
  await runInit({ root });

  const ratchets = /** @type {any} */ (policyOf(root)).ratchets ?? {};
  assert.ok(Object.keys(ratchets).length > 0, "policy must declare its ratchets even when unmeasured");
  for (const [name, r] of Object.entries(ratchets)) {
    const entry = /** @type {any} */ (r);
    assert.equal(typeof entry.measured, "boolean", `${name} does not say whether it was measured`);
    if (entry.measured === false) {
      assert.equal(entry.value, null, `${name} carries a value ${entry.value} it never measured`);
      assert.ok(typeof entry.note === "string" && entry.note.length > 0, `${name} does not say why it is unmeasured`);
    }
  }
});

test("protected paths carve out the task tree and deny evidence to the agent", async () => {
  // R-L0.4 and R-L4.4a. Task artefacts are written during normal work, so
  // protecting the whole .harness tree would block the agent from its own
  // plan. Evidence is the opposite: an agent-authored bundle is an
  // attestation, which collapses P4 back into assertion.
  const root = repo({ pkg: { name: "s", scripts: { test: "node --test" } } });
  await runInit({ root });

  const policy = /** @type {any} */ (policyOf(root));
  const protectedPaths = policy.protected_paths ?? [];
  const agentWritable = policy.agent_writable ?? [];
  const agentDenied = policy.agent_denied ?? [];

  assert.ok(protectedPaths.some((/** @type {string} */ p) => p.includes(".harness/policy.yaml")));
  assert.ok(protectedPaths.some((/** @type {string} */ p) => p.includes(".claude/settings.json")));
  assert.ok(agentWritable.some((/** @type {string} */ p) => p.includes("plan.md")));
  assert.ok(agentWritable.some((/** @type {string} */ p) => p.includes("handoff.md")));
  assert.ok(agentDenied.some((/** @type {string} */ p) => p.includes("evidence")));
});

test("init writes the marketplace and plugin into .claude/settings.json", async () => {
  // M12. Repo-declared plugins reach cloud sessions; user-scope ones do not.
  // Writing this into the repo is what makes the harness follow the repository
  // rather than the machine it was set up on.
  const root = repo({ pkg: { name: "s", scripts: { test: "node --test" } } });
  await runInit({ root });

  const settings = JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8"));
  assert.ok(settings.extraKnownMarketplaces, "no marketplace declared");
  assert.ok(settings.enabledPlugins, "no plugin enabled");
});

test("init preserves settings it did not write", async () => {
  const root = repo({ pkg: { name: "s", scripts: { test: "node --test" } } });
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "settings.json"), JSON.stringify({ permissions: { deny: ["Bash(rm *)"] } }));

  await runInit({ root });
  const settings = JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8"));
  assert.deepEqual(settings.permissions.deny, ["Bash(rm *)"], "init clobbered settings it does not own");
  assert.ok(settings.enabledPlugins);
});

test("init is idempotent", async () => {
  const root = repo({ pkg: { name: "s", scripts: { test: "node --test", typecheck: "node --version" } } });
  await runInit({ root });
  const first = {
    manifest: readFileSync(join(root, ".harness", "manifest.yaml"), "utf8"),
    policy: readFileSync(join(root, ".harness", "policy.yaml"), "utf8"),
    settings: readFileSync(join(root, ".claude", "settings.json"), "utf8"),
  };

  await runInit({ root });
  assert.equal(readFileSync(join(root, ".harness", "manifest.yaml"), "utf8"), first.manifest);
  assert.equal(readFileSync(join(root, ".harness", "policy.yaml"), "utf8"), first.policy);
  assert.equal(readFileSync(join(root, ".claude", "settings.json"), "utf8"), first.settings);
});

test("a second init does not reset a mode the operator has since changed", async () => {
  // Idempotent must not mean "resets to observe every time it is run". Somebody
  // who promoted a repo to enforce would silently lose it.
  const root = repo({ pkg: { name: "s", scripts: { test: "node --test" } } });
  await runInit({ root });
  const policyPath = join(root, ".harness", "policy.yaml");
  writeFileSync(policyPath, readFileSync(policyPath, "utf8").replace("mode: observe", "mode: enforce"));

  await runInit({ root });
  assert.equal(/** @type {any} */ (policyOf(root)).mode, "enforce", "init reset an operator's enforce mode");
});
