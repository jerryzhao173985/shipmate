import { connect } from "@vercel/connect/eve";
import { defineMcpClientConnection } from "eve/connections";
import { writeApproval } from "#lib/write-approval.js";

/**
 * Linear workspace as a connection (hosted MCP server), via Vercel Connect.
 *
 * eve discovers Linear's tools and surfaces them as `linear__<tool>` (found via
 * connection_search) — the full Linear surface: search/read/create/update/
 * transition issues, projects, cycles, comments, relations. The model never sees
 * the URL or any token.
 *
 * USER-SCOPED Connect (`connect("linear/ship")` defaults to principalType
 * "user"). Linear's Vercel Connect connector is a Custom OAuth connector, which
 * is user-delegated — it has no app/bot identity, so app-scope is impossible.
 * Each end-user authorizes their own Linear once; the agent then acts as that
 * user.
 *
 * This requires a user principal on the session. Built-in platform channels
 * (Slack, etc.) attach the sender as a user principal, so the first Linear
 * request in Slack surfaces a one-time authorization challenge, then works.
 * Sessions WITHOUT a user (local dev, evals, the placeholder-auth HTTP route)
 * fail with reason "principal_required" — that is expected, not a bug.
 *
 * Endpoint is `/mcp` (Streamable HTTP); the older `/sse` path 404s.
 */
export default defineMcpClientConnection({
  url: "https://mcp.linear.app/mcp",
  description:
    "Linear workspace: search, read, create, update, and transition issues; projects, cycles, labels, comments, and relations.",
  // User-scoped Connect (defaults to principalType "user"). REQUEST WRITE SCOPE so
  // the agent can create/update/transition Linear issues (without it, reads work
  // but writes fail). Linear's VALID OAuth scopes are read / write / issues:create /
  // comments:create / admin — there is **no `issues:update`** (an earlier value of
  // `issues:update` made Linear reject the sign-in with "Invalid scope:
  // issues:update", which parked the session forever). The broad `write` scope
  // already covers create + update + delete of issues and comments, so just
  // ["read", "write"] is correct and sufficient.
  // ⚠️ Scope change → existing users must RE-AUTHORIZE once (the cached token has
  // the old/invalid scopes); the next Linear request re-triggers the Slack sign-in.
  // Grounding: the live "Invalid scope: issues:update" error + Linear OAuth scopes
  // (linear.app/developers/oauth-2-0-authentication); Connect token `scopes`.
  auth: connect({
    connector: "linear/ship",
    tokenParams: { scopes: ["read", "write"] },
  }),
  // Writes-only HITL: gates linear__* mutations (create/update/transition/
  // comment) from an interactive human; reads run free. Linear is user-scoped
  // (Slack only), so writes always come from an interactive human anyway.
  approval: writeApproval,

  // Linear writes are TRANSITIONING to this Connect path (per-user, write scope
  // above) as the PRIMARY route; the API-key tools (agent/tools/linear_create_*)
  // stay as a fallback until Connect-write is verified post-re-auth, then retire.
  // NO tool block-list here yet: Linear's hosted MCP does not publish its tool
  // names, so a deny-list would be a guess (cite-or-defer). The OAuth scopes
  // above + the writeApproval gate are the active controls. Add a grounded
  // `tools: { block: [...] }` once the live names are enumerated via tools/list.
});
