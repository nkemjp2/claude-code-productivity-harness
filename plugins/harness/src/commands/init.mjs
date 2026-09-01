import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { discoverCandidates, probe } from "../lib/probe.mjs";
import { parse } from "../lib/yaml.mjs";

/**
 * `harness init` — probe before write.
 *
 * Three rules, each answering a way this step normally goes wrong.
 *
 * **Report rather than configure.** A verb that resolves to nothing is named
 * in the report and left out of the manifest. Writing it anyway produces a
 * harness that lies to itself on every subsequent run: the gate resolves
 * nothing and either blocks all work or, far more likely, skips silently while
 * reporting healthy.
 *
 * **Land in observe.** Never enforce. The adoption sequence depends on a week
 * of real verdicts arriving before anything is refused, so a noisy gate is
 * retired under R-F2.5 rather than routed around.
 *
 * **Ratchets at measured baseline, or explicitly unmeasured.** Never a target.
 * A ratchet seeded with an aspiration fires on day one against a standard the
 * repository has never met, and the credible response is to switch the harness
 * off.
 *
 * Runs from the CLI, outside a hooked session (M27). It cannot be reached as a
 * hook because handlers only ever invoke `runner.mjs`, which is a structural
 * guarantee rather than a check.
 *
 * @typedef {{ configured: string[], reported: string[], probed: string[] }} InitResult
 */

export class InitRefused extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "InitRefused";
  }
}

/**
 * Ratchets the harness knows about, and what it can honestly measure today.
 *
 * Each entry carries `measured`. Where the tooling that would produce a number
 * is deferred, the entry says so and holds null — which is a different claim
 * from zero, and a very different claim from a target.
 *
 * @type {{ name: string, note: string }[]}
 */
const RATCHETS = [
  {
    name: "mutation_score",
    note: "no mutation runner is configured; the ratchet is declared so it cannot be quietly forgotten, and holds no value until one runs",
  },
  {
    name: "typecheck_clean",
    note: "measured at init when a typecheck verb resolved; otherwise unmeasured",
  },
  {
    name: "affected_test_seconds",
    note: "requires a test:affected verb and one real run; not measured during setup because a full suite is a minutes-long side effect",
  },
];

/**
 * @param {string} root
 * @param {string} rel
 * @param {string} content
 * @returns {boolean} true when written, false when already identical
 */
function writeIfChanged(root, rel, content) {
  const path = join(root, rel);
  mkdirSync(join(path, "..").replace(/[/\\][^/\\]*$/, "") || path.replace(/[/\\][^/\\]*$/, ""), { recursive: true });
  if (existsSync(path) && readFileSync(path, "utf8") === content) return false;
  writeFileSync(path, content, "utf8");
  return true;
}

/**
 * @param {{ root: string, require?: string[], marketplace?: string }} opts
 * @returns {Promise<InitResult>}
 */
export async function runInit(opts) {
  const root = opts.root;
  const required = new Set(opts.require ?? []);

  const candidates = discoverCandidates(root);
  /** @type {string[]} */
  const configured = [];
  /** @type {string[]} */
  const reported = [];
  /** @type {string[]} */
  const probed = [];
  /** @type {Record<string, { command: string, args: string[], required: boolean }>} */
  const verbs = {};

  for (const candidate of candidates) {
    const result = probe(candidate, root);
    probed.push(`${candidate.verb} <- ${candidate.command} (${candidate.source})`);

    if (result.resolved === null) {
      const line =
        `${candidate.verb}: '${candidate.command}' from ${candidate.source} does not resolve on this ` +
        "machine, so it was NOT written to the manifest. Configure it by hand once the tool is installed.";
      reported.push(line);
      if (required.has(candidate.verb)) {
        throw new InitRefused(
          `required verb '${candidate.verb}' cannot be resolved: '${candidate.command}' was not found. ` +
            "A required tool that silently skips is the disabled gate this design exists to prevent " +
            "(M13, R-F2.4), so initialisation stops rather than producing a manifest that cannot work.",
        );
      }
      continue;
    }

    if (verbs[candidate.verb] !== undefined) continue;
    verbs[candidate.verb] = {
      command: candidate.command,
      args: candidate.args,
      required: required.has(candidate.verb),
    };
    configured.push(candidate.verb);
  }

  for (const name of required) {
    if (verbs[name] === undefined && !reported.some((r) => r.startsWith(`${name}:`))) {
      throw new InitRefused(
        `required verb '${name}' was not discovered anywhere in this repository's package scripts or ` +
          "CI configuration, so it cannot be configured. Add it, or drop it from the required set.",
      );
    }
  }

  if (candidates.length === 0) {
    reported.push(
      "no candidate commands were discoverable from package.json scripts or .github/workflows, so " +
        "nothing was configured. This is deliberate: a guessed verb is a lie the harness tells itself " +
        "on every subsequent run.",
    );
  }

  mkdirSync(join(root, ".harness"), { recursive: true });

  const manifest = renderManifest(verbs, reported);
  writeIfChanged(root, join(".harness", "manifest.yaml"), manifest);

  // Preserve an operator's mode across re-init. Idempotent must not mean
  // "resets to observe every time", or somebody who promoted a repository to
  // enforce loses it silently on the next setup run.
  const policyPath = join(root, ".harness", "policy.yaml");
  let mode = "observe";
  if (existsSync(policyPath)) {
    try {
      const existing = parse(readFileSync(policyPath, "utf8"));
      if (typeof existing["mode"] === "string") mode = String(existing["mode"]);
    } catch {
      /* an unreadable policy is replaced with a fresh one in observe */
    }
  }
  writeIfChanged(root, join(".harness", "policy.yaml"), renderPolicy(mode, verbs));

  mkdirSync(join(root, ".claude"), { recursive: true });
  writeSettings(root, opts.marketplace ?? "nkemjp2/claude-code-productivity-harness");

  return { configured, reported, probed };
}

/**
 * @param {Record<string, { command: string, args: string[], required: boolean }>} verbs
 * @param {string[]} reported
 * @returns {string}
 */
function renderManifest(verbs, reported) {
  const lines = [
    "# .harness/manifest.yaml — the toolchain adapter (R-F1.1).",
    "#",
    "# Gates invoke abstract verbs, never commands, so the same gate works across",
    "# stacks. Written by `harness init` from this repository's own package scripts",
    "# and CI configuration; anything that did not resolve is listed at the bottom",
    "# rather than guessed at.",
    "#",
    "# required: true  -> a missing tool is an error, and with failClosed it blocks.",
    "# required: false -> a missing tool skips with a warning, so work continues.",
    "#",
    "# A required tool that quietly skips is the silently disabled gate this whole",
    "# design exists to prevent (M13, R-F2.4). Choose deliberately.",
    "verbs:",
  ];

  // An empty `verbs:` key parses to null, which loadManifest reads as no verbs.
  // Writing a placeholder would be a verb nobody declared.
  const names = Object.keys(verbs).sort();
  for (const name of names) {
    const v = verbs[name];
    if (v === undefined) continue;
    lines.push(`  ${name}:`);
    lines.push(`    command: ${v.command}`);
    if (v.args.length > 0) {
      lines.push("    args:");
      for (const a of v.args) lines.push(`      - ${JSON.stringify(a)}`);
    }
    lines.push(`    required: ${v.required}`);
  }

  if (reported.length > 0) {
    lines.push("");
    lines.push("# Not configured, and deliberately so:");
    for (const r of reported) lines.push(`#   - ${r}`);
  }

  return `${lines.join("\n")}\n`;
}

/**
 * @param {string} mode
 * @param {Record<string, unknown>} verbs
 * @returns {string}
 */
function renderPolicy(mode, verbs) {
  const typecheckMeasured = verbs["typecheck"] !== undefined;

  const lines = [
    "# .harness/policy.yaml — modes, protected paths, ratchets.",
    "#",
    "# `harness init` leaves a repository in observe, never enforce. A week of real",
    "# verdicts arrives before anything is refused, so a noisy gate is retired under",
    "# R-F2.5 rather than routed around.",
    "enabled: true",
    `mode: ${mode}`,
    "",
    "# Ratchets initialise at a MEASURED baseline or hold no value at all.",
    "# A ratchet seeded with a target fires on day one against a standard this",
    "# repository has never met, and the credible response to that is to switch the",
    "# harness off.",
    "ratchets:",
  ];

  for (const r of RATCHETS) {
    const measured = r.name === "typecheck_clean" ? typecheckMeasured : false;
    lines.push(`  ${r.name}:`);
    lines.push(`    measured: ${measured}`);
    lines.push(`    value: ${measured ? "true" : "null"}`);
    lines.push(`    note: ${JSON.stringify(r.note)}`);
  }

  lines.push(
    "",
    "# Protected paths need explicit human approval (R-F3.7).",
    "protected_paths:",
    '  - ".harness/manifest.yaml"',
    '  - ".harness/policy.yaml"',
    '  - ".claude/settings.json"',
    '  - ".github/workflows/**"',
    '  - "**/migrations/**"',
    '  - "**/*.lock"',
    "",
    "# Carved out of the protected register, because task artefacts are written",
    "# during normal work and protecting the whole tree would block the agent from",
    "# its own plan (R-L0.4).",
    "agent_writable:",
    '  - ".harness/tasks/*/plan.md"',
    '  - ".harness/tasks/*/handoff.md"',
    "",
    "# Denied to the agent entirely. Evidence is written by the runner; an",
    "# agent-authored bundle is an attestation, which collapses evidence back into",
    "# the assertion it was meant to replace (R-L4.4a).",
    "agent_denied:",
    '  - ".harness/tasks/*/evidence/**"',
    "",
    "budgets:",
    "  stop_retries: 5   # below CLAUDE_CODE_STOP_HOOK_BLOCK_CAP so the harness escalates, not the platform (M6)",
    "",
    "retention:",
    "  event_log_days: 90",
  );

  return `${lines.join("\n")}\n`;
}

/**
 * Declare the marketplace and plugin in the repository's own settings (M12).
 *
 * Repo-declared plugins reach cloud sessions; user-scope ones do not. Writing
 * this here is what makes the harness follow the repository rather than the
 * machine it happened to be set up on.
 *
 * @param {string} root
 * @param {string} marketplace
 */
function writeSettings(root, marketplace) {
  const path = join(root, ".claude", "settings.json");
  /** @type {Record<string, any>} */
  let settings = {};
  if (existsSync(path)) {
    try {
      settings = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      settings = {};
    }
  }

  // Merge, never replace. Everything else in this file belongs to somebody
  // else, and setup that clobbers a team's permission rules is setup that gets
  // reverted.
  settings.extraKnownMarketplaces = {
    ...(settings.extraKnownMarketplaces ?? {}),
    "claude-harness": { source: { source: "github", repo: marketplace } },
  };
  settings.enabledPlugins = { ...(settings.enabledPlugins ?? {}), "harness@claude-harness": true };

  const next = `${JSON.stringify(settings, null, 2)}\n`;
  if (!existsSync(path) || readFileSync(path, "utf8") !== next) writeFileSync(path, next, "utf8");
}
