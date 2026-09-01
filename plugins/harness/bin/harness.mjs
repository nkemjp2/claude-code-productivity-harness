#!/usr/bin/env node
/**
 * harness — the canonical command surface.
 *
 * Every command is a subcommand here, because CI must be able to invoke
 * `harness doctor` and CI cannot invoke a slash command. The entries under
 * commands/ are thin wrappers that shell out to this binary, so there is one
 * implementation and one behaviour.
 *
 * Phase 0 ships the skeleton only: the subcommands are declared so the surface
 * is fixed and testable, and each reports that it is not yet implemented rather
 * than pretending to succeed. A command that silently no-ops is the same defect
 * class as a silently disabled gate.
 */

/** @type {Record<string, string>} */
const COMMANDS = {
  classify: "Record an escaped defect against one of five classifications, with its mandated remedy",
  replay: "Address a session's transcript, event log and evidence bundles together",
  metrics: "The R-M1.3 metrics computed from the event log, with reasons for those that cannot be",
  init: "Probe the repo, write manifest and policy, set mode observe, record baselines",
  doctor: "Full preflight: platform, deps, verb resolution, JSON purity, worktree, canaries",
  status: "Mode, ratchets, rules past review, gates that have not fired, open escalations",
  mode: "Change enforcement level, with a required reason recorded in the event log",
  promote: "Tighten ratchets one notch from measured current performance",
  adapters: "List adapters, pinned upstream versions, licence, last fixture-canary result",
};

const argv = process.argv.slice(2);
const command = argv[0];

if (command === "init") {
  const { runInit } = await import("../src/commands/init.mjs");
  const { resolveRepoRoot, sessionProjectDir } = await import("../src/lib/repo.mjs");
  const root = resolveRepoRoot(null) ?? sessionProjectDir() ?? ".";
  try {
    const result = await runInit({ root });
    process.stderr.write(`harness init — ${root}\n\n`);
    for (const p of result.probed) process.stderr.write(`  probed     ${p}\n`);
    for (const c of result.configured) process.stderr.write(`  configured ${c}\n`);
    for (const r of result.reported) process.stderr.write(`  REPORTED   ${r}\n`);
    process.stderr.write("\nmode: observe. Collect a week of verdicts before promoting.\n");
  } catch (err) {
    process.stderr.write(`harness init refused: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 2;
  }
}

else if (command === "mode") {
  const { runMode } = await import("../src/commands/mode.mjs");
  const { resolveRepoRoot, sessionProjectDir } = await import("../src/lib/repo.mjs");
  const root = resolveRepoRoot(null) ?? sessionProjectDir() ?? ".";
  const target = argv[1] ?? "";
  const reasonFlag = argv.indexOf("--reason");
  const reason = reasonFlag === -1 ? "" : argv.slice(reasonFlag + 1).join(" ");
  try {
    const { from, to } = await runMode({ root, mode: target, reason });
    process.stderr.write(`harness mode: ${from} -> ${to}\n`);
  } catch (err) {
    process.stderr.write(`harness mode refused: ${err instanceof Error ? err.message : String(err)}\n`);
    process.stderr.write("usage: harness mode <dormant|observe|enforce> --reason <why>\n");
    process.exitCode = 2;
  }
}

else if (command === "status") {
  const { runStatus, formatStatus } = await import("../src/commands/status.mjs");
  const { resolveRepoRoot, sessionProjectDir } = await import("../src/lib/repo.mjs");
  const root = resolveRepoRoot(null) ?? sessionProjectDir() ?? ".";
  try {
    process.stderr.write(formatStatus(await runStatus({ root })));
  } catch (err) {
    process.stderr.write(`harness status: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 2;
  }
}

else if (command === "classify") {
  const { classify } = await import("../src/lib/loop.mjs");
  const { resolveRepoRoot, sessionProjectDir } = await import("../src/lib/repo.mjs");
  const root = resolveRepoRoot(null) ?? sessionProjectDir() ?? ".";
  const at = (/** @type {string} */ flag) => { const i = argv.indexOf(flag); return i === -1 ? "" : (argv[i + 1] ?? ""); };
  try {
    const r = classify(root, { incident: at("--incident"), classification: argv[1] ?? "", note: argv.slice(argv.indexOf("--note") + 1).join(" ") });
    process.stderr.write(`classified as ${r.classification}\n\nMandated remedy: ${r.remedy}\n`);
  } catch (err) {
    process.stderr.write(`harness classify refused: ${err instanceof Error ? err.message : String(err)}\n`);
    process.stderr.write("usage: harness classify <classification> --incident <id> --note <text>\n");
    process.exitCode = 2;
  }
}

else if (command === "replay") {
  const { resolveSession } = await import("../src/lib/loop.mjs");
  const { resolveRepoRoot, sessionProjectDir } = await import("../src/lib/repo.mjs");
  const root = resolveRepoRoot(null) ?? sessionProjectDir() ?? ".";
  const s = resolveSession(root, argv[1] ?? "");
  process.stderr.write(`session ${s.sessionId}\n  transcript: ${s.transcriptPath ?? "(none recorded)"}\n`);
  process.stderr.write(`  events: ${s.events.length}\n`);
  for (const b of s.evidenceBundles) process.stderr.write(`  evidence: ${b}\n`);
  if (s.note !== "") process.stderr.write(`  ${s.note}\n`);
}

else if (command === "metrics") {
  const { computeMetrics, formatMetrics } = await import("../src/lib/metrics.mjs");
  const { readRecords } = await import("../src/lib/log.mjs");
  const { resolveRepoRoot, sessionProjectDir } = await import("../src/lib/repo.mjs");
  const root = resolveRepoRoot(null) ?? sessionProjectDir() ?? ".";
  process.stderr.write(formatMetrics(computeMetrics(readRecords(root))));
}

else if (command === "promote") {
  const { readRatchet, writeRatchet } = await import("../src/lib/mutation.mjs");
  const { resolveRepoRoot, sessionProjectDir } = await import("../src/lib/repo.mjs");
  const root = resolveRepoRoot(null) ?? sessionProjectDir() ?? ".";
  const name = argv[1] ?? "mutation_score";
  const value = Number(argv[2]);
  if (!Number.isFinite(value)) {
    process.stderr.write("usage: harness promote <ratchet> <measured-value>\n");
    process.stderr.write("A ratchet moves to a MEASURED number, never to a target.\n");
    process.exitCode = 2;
  } else {
    const before = readRatchet(root, name);
    const after = writeRatchet(root, name, value);
    process.stderr.write(`${name}: ${before ?? "unset"} -> ${after}${after !== value ? " (refused to loosen)" : ""}\n`);
  }
}

else if (command === "adapters") {
  process.stderr.write("harness adapters\n\n  No adapters are vendored yet.\n");
  process.stderr.write("  Each must declare an upstream version range and a licence on the allowlist,\n");
  process.stderr.write("  and is invoked across a process boundary so its terms never reach this source.\n");
}

else if (command === "doctor") {
  // Wired first because CI runs it on every job, on every platform. The other
  // subcommands arrive with their phases.
  const { runDoctor, formatReport } = await import("../src/commands/doctor.mjs");
  const { resolveRepoRoot } = await import("../src/lib/repo.mjs");
  const root = resolveRepoRoot(null) ?? process.env.CLAUDE_PROJECT_DIR ?? ".";
  const report = await runDoctor({ root });
  process.stderr.write(formatReport(report));
  process.exitCode = report.ok ? 0 : 1;
}

else if (command === undefined || command === "--help" || command === "-h") {
  process.stderr.write("harness <command>\n\n");
  for (const [name, description] of Object.entries(COMMANDS)) {
    process.stderr.write(`  ${name.padEnd(10)} ${description}\n`);
  }
  process.stderr.write("\nEvery subcommand is implemented. `doctor` is the load-bearing one:\n");
  process.stderr.write("run it after every plugin update, every client upgrade, and in CI.\n");
  process.exitCode = 0;
} else if (!(command in COMMANDS)) {
  process.stderr.write(`harness: unknown command '${command}'\n`);
  process.exitCode = 2;
}
