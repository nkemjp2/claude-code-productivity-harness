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
  init: "Probe the repo, write manifest and policy, set mode observe, record baselines",
  doctor: "Full preflight: platform, deps, verb resolution, JSON purity, worktree, canaries",
  status: "Mode, ratchets, rules past review, gates that have not fired, open escalations",
  mode: "Change enforcement level, with a required reason recorded in the event log",
  promote: "Tighten ratchets one notch from measured current performance",
  adapters: "List adapters, pinned upstream versions, licence, last fixture-canary result",
};

/** @type {Record<string, number>} */
const PHASE = { promote: 7, adapters: 5 };

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
  process.stderr.write("\nPhase 0: the surface is declared; no subcommand is implemented yet.\n");
  process.exitCode = 0;
} else if (!(command in COMMANDS)) {
  process.stderr.write(`harness: unknown command '${command}'\n`);
  process.exitCode = 2;
} else {
  process.stderr.write(
    `harness ${command}: not implemented — arrives in Phase ${PHASE[command]}.\n`,
  );
  process.exitCode = 2;
}
