import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Generate `src/generated/event-map.json` from `docs/event-map.verified.md`
 * (ADR-0006).
 *
 * The markdown is the source of truth and the artefact humans review. The
 * runner reads only the JSON, resolved relative to the plugin root — which
 * removes both the ambiguity about whose `docs/` directory is meant at runtime
 * and the cost of parsing a markdown table in the hot path of every tool call.
 *
 * CI regenerates and fails on a diff, the same discipline `hooks.json` gets
 * under M2 and for the same reason: a generated file that can drift from its
 * source is a generated file nobody can trust.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const SOURCE = join(ROOT, "docs", "event-map.verified.md");
const TARGET = join(ROOT, "plugins", "harness", "src", "generated", "event-map.json");

const md = readFileSync(SOURCE, "utf8");

const versionMatch = /\*\*Audited client version:\s*([0-9][^*]*?)\*\*/.exec(md);
const auditedVersion = versionMatch?.[1]?.trim().split(/\s/)[0] ?? "0.0.0";

/** @type {Record<string, { exists: boolean, blocks: string, shape: string, provenance: string }>} */
const events = {};

for (const line of md.split("\n")) {
  const m = /^\|\s*`([A-Za-z]+)`\s*\|\s*(yes|no)\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|/.exec(line);
  if (m === null) continue;
  const [, name, exists, blocks, shape, provenance] = m;
  if (name === undefined) continue;
  events[name] = {
    exists: exists === "yes",
    blocks: (blocks ?? "").trim(),
    shape: (shape ?? "").trim(),
    provenance: (provenance ?? "").trim(),
  };
}

const out = {
  _comment:
    "GENERATED from docs/event-map.verified.md by src/build/generate-event-map.mjs. Do not hand-edit; CI regenerates and fails on a diff.",
  auditedVersion,
  auditedOn: /\*\*Audit date:\s*([0-9-]+)\*\*/.exec(md)?.[1] ?? "unknown",
  events,
};

writeFileSync(TARGET, `${JSON.stringify(out, null, 2)}\n`, "utf8");
process.stderr.write(`event-map: ${Object.keys(events).length} events, audited ${auditedVersion}\n`);
