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
const PHASE = { init: 3, status: 3, mode: 3, promote: 7, adapters: 5 };

const argv = process.argv.slice(2);
const command = argv[0];

if (command === "doctor") {
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
