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
  auth: connect("linear/ship"),
  // Writes-only HITL: gates linear__* mutations (create/update/transition/
  // comment) from an interactive human; reads run free. Linear is user-scoped
  // (Slack only), so writes always come from an interactive human anyway.
  approval: writeApproval,
});
