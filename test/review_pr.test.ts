import { test } from "node:test";
import assert from "node:assert/strict";
import { safeSegment } from "../agent/tools/review_pr.ts";

// `safeSegment` guards the owner/repo that get interpolated into the sandbox clone
// URL (`git clone https://github.com/<owner>/<repo>.git`). It must reject anything
// that could become a git flag, a path-traversal token, or a shell metacharacter.

test("safeSegment: accepts normal owner/repo names", () => {
  for (const s of ["sindresorhus", "slugify", "my-repo", "repo.js", "a_b", "X1", "v2.0"]) {
    assert.equal(safeSegment(s), true, `${s} should be allowed`);
  }
});

test("safeSegment: rejects '.'/'..' and leading '-' (flag/traversal guards)", () => {
  assert.equal(safeSegment("."), false);
  assert.equal(safeSegment(".."), false);
  assert.equal(safeSegment("-rf"), false);
  assert.equal(safeSegment("--upload-pack"), false);
});

test("safeSegment: rejects path separators and shell metacharacters", () => {
  for (const s of ["a/b", "a b", "a;b", "a$b", "a`b", "a|b", "a&b", "a(b)", "a*b", ""]) {
    assert.equal(safeSegment(s), false, `${JSON.stringify(s)} should be rejected`);
  }
});
