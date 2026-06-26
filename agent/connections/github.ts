import { defineMcpClientConnection } from "eve/connections";

/**
 * GitHub as a connection (GitHub's hosted remote MCP server).
 *
 * eve discovers GitHub's tools and surfaces them to the model as `github__<tool>`
 * (found via connection_search). The model never sees the URL or the token.
 *
 * Auth is a Personal Access Token in an env var — the same simple pattern as the
 * ticket tracker (no interactive OAuth). Create a fine-grained PAT and set it as
 * GITHUB_TOKEN. eve sends it as `Authorization: Bearer <token>`.
 *
 * Env: GITHUB_TOKEN (required) — a GitHub fine-grained or classic PAT, or a
 * `gh auth token` from the GitHub CLI. Verified working against GitHub's hosted
 * remote MCP server below (HTTP 200 handshake). If you self-host the GitHub MCP
 * server, point `url` at your instance instead.
 *
 * To keep the surface small, you can scope the exposed tools, e.g.:
 *   tools: { allow: ["search_issues", "get_pull_request", "list_workflow_runs"] }
 */
export default defineMcpClientConnection({
  url: "https://api.githubcopilot.com/mcp/",
  description:
    "GitHub: search and read issues, pull requests, repositories, and workflow runs; comment and update where permitted.",
  auth: {
    getToken: async () => ({ token: process.env.GITHUB_TOKEN! }),
  },
});
