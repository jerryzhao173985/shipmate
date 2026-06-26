import type { Approval } from "eve/tools";

/**
 * Writes-only human-in-the-loop gate for the EXTERNAL connections — github and
 * linear. The internal ticket tracker (tickets.ts) is FULLY TRUSTED and does NOT
 * use this gate: its writes auto-run. So this policy is set as `approval:` on
 * github + linear only.
 *
 * Posture (decided with the user): a consequential WRITE pauses for a human
 * confirmation when the caller is an interactive human who can actually answer
 * the prompt; READS never pause; AUTOMATED callers never pause. So:
 *   - reads (get / list / search …)                        -> not-applicable
 *   - writes from a Slack user / authenticated HTTP caller -> user-approval (parks)
 *   - writes from the app principal (schedules) or the
 *     GitHub channel (github-webhook auto-review)         -> not-applicable
 *
 * Why skip github-webhook: the GitHub channel auto-reviews PRs and posts the
 * verdict autonomously; it has no approval UI to satisfy a HITL pause, so gating
 * it would deadlock the auto-review. Schedules (app principal) are likewise
 * non-interactive. Both stay autonomous; only interactive humans get the prompt.
 *
 * Classification is a WRITE-verb match (not a read-verb whitelist): the GitHub MCP
 * server names some reads `pull_request_read`/`issue_read` (no leading read verb),
 * which a read-verb whitelist would wrongly gate. The write verbs are
 * unambiguous, and the connections are also tool-scoped (github tools.block), so
 * the only writes the gate sees are the comment/create/update tools — all caught.
 *
 * grounding: Approval/ApprovalContext (toolName, session.auth.current) —
 * node_modules/eve/dist/src/public/definitions/approval.d.ts:14-39,
 * channel/types.d.ts:49-52; the app-principal triple — references/components/approval.md:98-105.
 */

// An operation/tool whose name (after the `<connection>__` prefix) starts with a
// mutating verb is treated as a write. github/linear name verb-first
// (create_issue, add_comment, transition…, update_issue); reads start with
// get/list/search/find/read or are the `*_read` consolidated tools (not gated).
const WRITE_VERB =
  /^(create|update|delete|remove|add|set|transition|bulk|move|archive|merge|close|reopen|assign|unassign|convert|restore|patch|put|post|comment|edit|rename|link|unlink|duplicate|cancel|approve|subscribe|unsubscribe)/i;

function isWriteOp(toolName: string): boolean {
  const op = toolName.includes("__")
    ? toolName.slice(toolName.indexOf("__") + 2)
    : toolName;
  return WRITE_VERB.test(op);
}

export const writeApproval: Approval = (ctx) => {
  if (!isWriteOp(ctx.toolName)) return "not-applicable";
  const c = ctx.session.auth.current;
  if (c) {
    const isAppPrincipal =
      c.authenticator === "app" &&
      c.principalId === "eve:app" &&
      c.principalType === "runtime";
    if (isAppPrincipal || c.authenticator === "github-webhook") {
      return "not-applicable";
    }
  }
  return "user-approval";
};
