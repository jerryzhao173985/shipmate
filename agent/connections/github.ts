import { connect } from "@vercel/connect/eve";
import { defineMcpClientConnection } from "eve/connections";

/**
 * GitHub as a connection (GitHub's hosted remote MCP server).
 *
 * eve discovers GitHub's tools and surfaces them to the model as `github__<tool>`
 * (found via connection_search). The model never sees the URL or any token.
 *
 * auth uses Vercel Connect for managed OAuth; "github/ship" is the registered
 * Connect client UID — keep it in sync with the client you register.
 *
 * [VERIFY] Confirm the endpoint matches the GitHub MCP server you intend to use.
 * GitHub's hosted remote MCP server is https://api.githubcopilot.com/mcp/ ; if
 * you self-host the GitHub MCP server, point `url` at your instance instead.
 *
 * To keep the surface small and safe, you can scope the exposed tools, e.g.:
 *   tools: { allow: ["search_issues", "get_pull_request", "list_workflow_runs"] }
 */
export default defineMcpClientConnection({
  url: "https://api.githubcopilot.com/mcp/",
  description:
    "GitHub: search and read issues, pull requests, repositories, and workflow runs; comment and update where permitted.",
  auth: connect("github/ship"),
});
