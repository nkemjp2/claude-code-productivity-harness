import { test } from "node:test";
import assert from "node:assert/strict";

import { parse, YamlSubsetError } from "../../src/lib/yaml.mjs";

/**
 * The strict YAML subset parser (ADR-0008).
 *
 * The danger this suite exists for is not a parser that fails. It is a parser
 * that *guesses*. An anchor silently mis-read here corrupts a blast radius or
 * a protected-path list — the M25 failure, an adapter passing output it did
 * not understand, reproduced inside our own config loader where the blast
 * radius is larger.
 *
 * So every construct outside the subset must throw, and the tests below assert
 * throwing rather than any particular fallback value.
 */

test("nested maps", () => {
  assert.deepEqual(parse("verbs:\n  typecheck:\n    command: tsc\n    required: true\n"), {
    verbs: { typecheck: { command: "tsc", required: true } },
  });
});

test("sequences of scalars and of maps", () => {
  assert.deepEqual(parse("paths:\n  - src/**\n  - tests/**\n"), { paths: ["src/**", "tests/**"] });
  assert.deepEqual(parse("criteria:\n  - id: AC-1\n    statement: it works\n"), {
    criteria: [{ id: "AC-1", statement: "it works" }],
  });
});

test("scalars: booleans, integers, quoted strings, empty values", () => {
  const r = parse(
    ["enabled: true", "disabled: false", "retries: 8", "name: 'quoted value'", 'other: "double"', "missing:"].join("\n"),
  );
  assert.deepEqual(r, {
    enabled: true,
    disabled: false,
    retries: 8,
    name: "quoted value",
    other: "double",
    missing: null,
  });
});

test("a quoted string keeps characters that would otherwise be structure", () => {
  // Unquoted, the colon and hash would be read as syntax. This is the case a
  // naive line splitter gets wrong, and blast-radius globs are full of them.
  assert.deepEqual(parse('glob: "src/**/*.{ts,tsx}"\nnote: "a: b # c"\n'), {
    glob: "src/**/*.{ts,tsx}",
    note: "a: b # c",
  });
});

test("comments and blank lines are ignored", () => {
  assert.deepEqual(parse("# leading\n\nmode: observe   # trailing\n\n# trailing comment\n"), {
    mode: "observe",
  });
});

test("a value containing a hash inside quotes is not treated as a comment", () => {
  assert.deepEqual(parse('token: "abc#def"\n'), { token: "abc#def" });
});

/* Everything below is outside the subset and must throw. */

const REJECTED = {
  anchor: "base: &defaults\n  mode: observe\n",
  alias: "base:\n  mode: observe\nother: *base\n",
  tag: "value: !!str 123\n",
  "block scalar (literal)": "script: |\n  line one\n  line two\n",
  "block scalar (folded)": "script: >\n  line one\n  line two\n",
  "flow mapping": "verbs: { typecheck: tsc }\n",
  "flow sequence": "paths: [a, b]\n",
  "multiple documents": "---\na: 1\n---\nb: 2\n",
  "merge key": "child:\n  <<: *base\n  mode: enforce\n",
  "tab indentation": "verbs:\n\ttypecheck: tsc\n",
};

for (const [name, text] of Object.entries(REJECTED)) {
  test(`rejects ${name} rather than guessing`, () => {
    assert.throws(
      () => parse(text),
      YamlSubsetError,
      `${name} was accepted; an unsupported construct must never be interpreted`,
    );
  });
}

test("the error names the construct and the line", () => {
  // A build failure is the correct outcome for an unsupported template, but
  // only if it says which line to fix.
  try {
    parse("mode: observe\nbase: &defaults\n  x: 1\n");
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof YamlSubsetError);
    assert.match(err.message, /anchor/i);
    assert.match(err.message, /line 2/i);
  }
});

test("inconsistent indentation is an error, not a best effort", () => {
  assert.throws(() => parse("a:\n    b: 1\n  c: 2\n"), YamlSubsetError);
});
