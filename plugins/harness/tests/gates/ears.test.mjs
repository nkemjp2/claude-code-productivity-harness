import { test } from "node:test";
import assert from "node:assert/strict";

import { classify, validateCriteria, EARS_PATTERNS } from "../../src/lib/ears.mjs";

/**
 * EARS validation is a **shape check and nothing more**.
 *
 * The notation is borrowed because it collapses a requirement to a single
 * testable claim with unambiguous scope, trigger and response — which is what
 * makes criterion-to-test mapping mechanical rather than editorial.
 *
 * What this cannot do is decide whether a well-formed criterion is *true*, or
 * achievable, or the one the author meant. That is not decidable, and a
 * validator that implied otherwise would be worse than none: it would put a
 * green tick beside a criterion nobody has thought about.
 */

test("the five templates are exactly the five", () => {
  assert.deepEqual(
    [...EARS_PATTERNS].sort(),
    ["event-driven", "optional-feature", "state-driven", "ubiquitous", "unwanted-behaviour"],
  );
});

test("ubiquitous", () => {
  assert.equal(classify("The system shall reject a task created with no contract."), "ubiquitous");
});

test("event-driven", () => {
  assert.equal(
    classify("When a write is attempted outside the declared blast radius, the system shall deny the tool call."),
    "event-driven",
  );
});

test("state-driven", () => {
  assert.equal(
    classify("While the harness is in observe mode, the system shall record every block as a warning."),
    "state-driven",
  );
});

test("unwanted behaviour", () => {
  assert.equal(
    classify("If the evidence bundle is incomplete, then the system shall block the stop."),
    "unwanted-behaviour",
  );
});

test("optional feature", () => {
  assert.equal(
    classify("Where mutation testing is configured, the system shall enforce the diff ratchet."),
    "optional-feature",
  );
});

test("a criterion matching no template is rejected", () => {
  for (const bad of [
    "Tests should probably pass.",
    "Make the thing work properly",
    "The system will maybe reject bad input.",
    "When something happens the system does a thing.",
  ]) {
    assert.equal(classify(bad), null, `'${bad}' was classified rather than rejected`);
  }
});

test("'shall' is required, because it is what makes the claim testable", () => {
  // "should" and "will" are the words a criterion hides in when nobody has
  // decided whether it is a requirement.
  assert.equal(classify("When X happens, the system should deny the call."), null);
  assert.equal(classify("When X happens, the system will deny the call."), null);
});

test("validateCriteria names the offending id and says which templates exist", () => {
  const problems = validateCriteria([
    { id: "AC-1", statement: "The system shall reject a task with no contract." },
    { id: "AC-2", statement: "Make it fast" },
  ]);
  assert.equal(problems.length, 1);
  const problem = problems[0];
  assert.ok(problem);
  assert.match(problem, /AC-2/);
  assert.match(problem, /ubiquitous|event-driven|shall/);
});

test("validation says nothing about whether a criterion is true", () => {
  // Deliberately absurd, deliberately well-formed. A shape check that rejected
  // this would be claiming a semantic judgement it cannot make; one that
  // accepts it is being honest about its own reach.
  assert.deepEqual(
    validateCriteria([{ id: "AC-1", statement: "The system shall travel backwards in time." }]),
    [],
  );
});

test("a criterion with no id is a problem, because traceability keys on it", () => {
  // R-L7.1: the id appears in the contract, in test names, in the commit
  // trailer and in the PR body. An anonymous criterion cannot be traced.
  const problems = validateCriteria([{ id: "", statement: "The system shall do a thing." }]);
  assert.equal(problems.length, 1);
  const problem = problems[0];
  assert.ok(problem);
  assert.match(problem, /id/i);
});
