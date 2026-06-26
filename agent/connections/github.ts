import { connect } from "@vercel/connect/eve";
import { defineMcpClientConnection } from "eve/connections";

/**
 * GitHub as a connection (GitHub's hosted remote MCP server).
 *
 * eve discovers GitHub's tools and surfaces them to the model as `github__<tool>`
 * (found via connection_search). The model never sees the URL or any token.
 *
 * Auth is brokered by Vercel Connect (managed OAuth) — app-scoped, so the agent
 * acts as one shared bot identity with no per-user consent flow. The connector
 * UID is `github/ship`; tokens are issued/refreshed by Connect. Verified working
 * against GitHub's hosted MCP server (HTTP 200 handshake).
 *
 * To keep the surface small, you can scope the exposed tools, e.g.:
 *   tools: { allow: ["search_issues", "get_pull_request", "list_workflow_runs"] }
 */
export default defineMcpClientConnection({
  url: "https://api.githubcopilot.com/mcp/",
  description:
    "GitHub: search and read issues, pull requests, repositories, and workflow runs; comment and update where permitted.",
  auth: connect({ connector: "github/ship", principalType: "app" }),
});
