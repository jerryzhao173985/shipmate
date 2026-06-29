import { test } from "node:test";
import assert from "node:assert/strict";
import { verdictComment, MARKER } from "../agent/lib/verdict-comment.ts";

// verdictComment builds the single sticky PR comment. The MARKER must lead every
// variant (the action.result handler finds + PATCHes the comment by it — a missing
// marker would stack duplicates), and each verdict must render its own heading.

test("pass → leads with the marker + a ✅ heading + the summary", () => {
  const body = verdictComment({ ranChecks: true, passed: true, summary: "o/r#7: all checks passed (build, typecheck)." }, "abc1234deadbeef");
  assert.ok(body.startsWith(MARKER), "marker must lead so the comment is found + updated in place");
  assert.match(body, /✅ Shipmate Review — passed/);
  assert.match(body, /all checks passed/);
});

test("fail → ❌ heading, names the failing checks, 'Not safe to merge', + an output excerpt", () => {
  const body = verdictComment(
    { ranChecks: true, passed: false, failingChecks: ["test"], timedOut: false, output: "AssertionError: expected 1 to equal 2" },
    "abc1234deadbeef",
  );
  assert.ok(body.startsWith(MARKER));
  assert.match(body, /❌ Shipmate Review — failed/);
  assert.match(body, /Failing: test/);
  assert.match(body, /Not safe to merge/);
  assert.match(body, /<details>/); // the output excerpt is included for a failure
  assert.match(body, /AssertionError/);
});

test("fail with a timeout notes it", () => {
  const body = verdictComment({ ranChecks: true, passed: false, failingChecks: ["test"], timedOut: true }, "abc1234deadbeef");
  assert.match(body, /timed out/);
});

test("couldn't-run → ⚠️ heading + the non-blocking (neutral) note", () => {
  const body = verdictComment({ ranChecks: false, summary: "Could not run checks for o/r#7: …" }, "abc1234deadbeef");
  assert.ok(body.startsWith(MARKER));
  assert.match(body, /⚠️ Shipmate Review — couldn't run/);
  assert.match(body, /neutral/); // explains it won't block the merge
});

test("the short head SHA appears (7 chars), not the full one", () => {
  const body = verdictComment({ ranChecks: true, passed: true }, "abc1234deadbeefcafe");
  assert.match(body, /abc1234/);
  assert.ok(!body.includes("abc1234deadbeefcafe"), "should use the 7-char short SHA");
});
