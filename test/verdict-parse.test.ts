import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseChecks,
  parseBaseResults,
  buildVerdict,
} from "../agent/lib/verdict-parse.ts";

// parseChecks/buildVerdict ARE the verdict: they turn the sandbox's ###CHECK/
// ###FLAKY/###REF/###BASE markers into pass/fail/flaky/pre-existing/couldn't-run.
// A regex slip or an off-by-one here silently mis-reports a Check Run conclusion —
// the worst kind of bug for a merge gate — and tsc/eve build cannot catch it.

// Helper: assemble a sandbox stdout from marker lines.
const out = (...lines: string[]) => lines.join("\n") + "\n";
const RAN_OK = ["###CHECK clone 0", "###REF merge", "###CHECK checkout 0", "###CHECK install 0"];

test("parseChecks: a clean pass — every check 0 → ranChecks, passed, no failures", () => {
  const p = parseChecks(out(...RAN_OK, "###CHECK build 0", "###CHECK typecheck 0", "###CHECK test 0"));
  assert.equal(p.ranChecks, true);
  assert.equal(p.passed, true);
  assert.deepEqual(p.failingChecks, []);
  assert.deepEqual(p.flakyChecks, []);
  assert.equal(p.reviewedRef, "merge");
  assert.equal(p.timedOut, false);
});

test("parseChecks: a real failure — test exits non-zero → failing, not passed", () => {
  const p = parseChecks(out(...RAN_OK, "###CHECK build 0", "###CHECK typecheck 0", "###CHECK test 1"));
  assert.equal(p.ranChecks, true);
  assert.equal(p.passed, false);
  assert.deepEqual(p.failingChecks, ["test"]);
});

test("parseChecks: flaky — test fails then passes on retry → flaky + passed (never blocks)", () => {
  const p = parseChecks(out(...RAN_OK, "###RETRY test 1", "###FLAKY test", "###CHECK test 0"));
  assert.equal(p.passed, true);
  assert.deepEqual(p.failingChecks, []);
  assert.deepEqual(p.flakyChecks, ["test"]);
});

test("parseChecks: a timeout (exit 124) → timedOut + failing, not passed", () => {
  const p = parseChecks(out(...RAN_OK, "###CHECK test 124"));
  assert.equal(p.timedOut, true);
  assert.equal(p.passed, false);
  assert.deepEqual(p.failingChecks, ["test"]);
});

test("parseChecks: head-ref fallback is recorded", () => {
  const p = parseChecks(out("###CHECK clone 0", "###REF head", "###CHECK checkout 0", "###CHECK install 0", "###CHECK test 0"));
  assert.equal(p.reviewedRef, "head");
});

test("parseChecks: clone failure → ranChecks false (couldn't run)", () => {
  const p = parseChecks(out("###CHECK clone 128"));
  assert.equal(p.ranChecks, false);
  assert.equal(p.cloneOk, false);
});

test("parseChecks: only infra checks ran (no real scripts) → ranChecks false", () => {
  const p = parseChecks(out(...RAN_OK)); // clone/checkout/install ok, but no lint/build/typecheck/test
  assert.equal(p.ranChecks, false);
});

test("parseBaseResults: a check failing on base too is pre-existing; passing-on-base is not", () => {
  assert.deepEqual(parseBaseResults("###BASE test 1\n", ["test"]), ["test"]);
  assert.deepEqual(parseBaseResults("###BASE test 0\n", ["test"]), []); // base passed → real, not pre-existing
  assert.deepEqual(parseBaseResults("", ["test"]), []); // no marker → fail-safe, NOT pre-existing
});

// buildVerdict end-to-end (parse → build), the shape the Check Run + comment read.
const build = (stdout: string, baseOut = "", runError: string | null = null) =>
  buildVerdict({ parsed: parseChecks(stdout), stdout, baseOut, runError, owner: "o", repo: "r", number: 7 });

test("buildVerdict: pass → passed, ranChecks, 'all checks passed' summary", () => {
  const v = build(out(...RAN_OK, "###CHECK test 0"));
  assert.equal(v.passed, true);
  assert.equal(v.ranChecks, true);
  assert.match(v.summary, /all checks passed/);
});

test("buildVerdict: fail → not passed, failingChecks, 'Not safe to merge'", () => {
  const v = build(out(...RAN_OK, "###CHECK test 1"));
  assert.equal(v.passed, false);
  assert.deepEqual(v.failingChecks, ["test"]);
  assert.match(v.summary, /FAILED — test failing/);
  assert.match(v.summary, /Not safe to merge/);
});

test("buildVerdict: a pre-existing failure stays blocking (passed:false) but is flagged, not blamed", () => {
  const v = build(out(...RAN_OK, "###CHECK test 1"), "###BASE test 1\n");
  assert.equal(v.passed, false); // informational: never silently un-blocks
  assert.deepEqual(v.preexistingFailures, ["test"]);
  assert.match(v.summary, /pre-existing/);
});

test("buildVerdict: couldn't-run (clone failed) → ranChecks false, honest 'Could not run' summary", () => {
  const v = build(out("###CHECK clone 128"));
  assert.equal(v.ranChecks, false);
  assert.equal(v.passed, false);
  assert.match(v.summary, /Could not run checks/);
  assert.match(v.summary, /could not clone/);
});

test("buildVerdict: couldn't-run (no package.json) names the detect reason", () => {
  const v = build(out("###CHECK clone 0", "###REF merge", "###CHECK checkout 0", "###CHECK detect 1"));
  assert.equal(v.ranChecks, false);
  assert.match(v.summary, /no package\.json/);
});
