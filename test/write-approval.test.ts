import { test } from "node:test";
import assert from "node:assert/strict";
import { isWriteOp, writeApproval } from "../agent/lib/write-approval.ts";

// `isWriteOp` is the literal arbiter of the writes-only HITL gate (agent/lib/
// write-approval.ts). A regex slip here silently mis-gates a real external write or
// wrongly parks a read — and `tsc`/`eve build` cannot catch that. Lock the behavior,
// especially the subtle near-misses.

const READS = [
  "github__get_pull_request",
  "github__list_issues",
  "github__search_code",
  "github__pull_request_read", // GitHub MCP consolidated read — NO leading read verb
  "github__issue_read",
  "tickets__listIssues",
  "tickets__getWorkflow",
  "tickets__getIssue",
  "linear__list_issues",
  "linear__get_issue",
];

const WRITES = [
  "github__add_issue_comment",
  "github__create_issue",
  "github__update_pull_request",
  "github__merge_pull_request",
  "github__delete_branch",
  "tickets__createIssue",
  "tickets__updateIssue",
  "tickets__transitionIssue",
  "tickets__bulkUpdateIssues",
  "linear__create_issue",
  "linear__update_issue",
  "linear__create_comment",
];

test("isWriteOp: reads are never classified as writes", () => {
  for (const name of READS) {
    assert.equal(isWriteOp(name), false, `${name} should NOT be a write`);
  }
});

test("isWriteOp: writes are classified as writes", () => {
  for (const name of WRITES) {
    assert.equal(isWriteOp(name), true, `${name} should be a write`);
  }
});

test("isWriteOp: near-misses don't false-match a write verb", () => {
  // "linear" must NOT match the "link" verb (they diverge at char 4).
  assert.equal(isWriteOp("linear__list_issues"), false);
  // bare internal tools that merely start with similar letters aren't writes.
  assert.equal(isWriteOp("review_pr"), false); // not "remove/reopen/restore/rename"
  assert.equal(isWriteOp("correlate"), false); // not "create/convert/comment"
  assert.equal(isWriteOp("recall_links"), false); // not "remove"
});

test("isWriteOp: strips the <conn>__ prefix before matching the verb", () => {
  assert.equal(isWriteOp("create_issue"), true); // no prefix, still a write
  assert.equal(isWriteOp("get_thing"), false);
});

// `writeApproval` is the full policy: a WRITE from an interactive human parks for
// confirmation; reads and AUTOMATED principals (the app schedule, the github-webhook
// auto-review) run free — gating those would deadlock automation.
function ctx(toolName: string, current: unknown) {
  return { toolName, session: { auth: { current } } } as never;
}
const HUMAN = { authenticator: "slack-webhook", principalId: "U1", principalType: "user" };
const APP = { authenticator: "app", principalId: "eve:app", principalType: "runtime" };
const WEBHOOK = { authenticator: "github-webhook", principalId: "github:1", principalType: "user" };

test("writeApproval: a human write parks", () => {
  assert.equal(writeApproval(ctx("github__add_issue_comment", HUMAN)), "user-approval");
});

test("writeApproval: a read never parks (even from a human)", () => {
  assert.equal(writeApproval(ctx("github__get_pull_request", HUMAN)), "not-applicable");
});

test("writeApproval: the app principal (schedule) write runs free", () => {
  assert.equal(writeApproval(ctx("github__create_issue", APP)), "not-applicable");
});

test("writeApproval: the github-webhook (auto-review) write runs free", () => {
  assert.equal(writeApproval(ctx("github__add_issue_comment", WEBHOOK)), "not-applicable");
});

test("writeApproval: a write with no current principal falls through to parking", () => {
  assert.equal(writeApproval(ctx("github__create_issue", null)), "user-approval");
});
