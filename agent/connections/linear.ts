import { connect } from "@vercel/connect/eve";
import { defineMcpClientConnection } from "eve/connections";

/**
 * Linear workspace as a connection (hosted MCP server).
 *
 * eve discovers Linear's tools from the server and surfaces them to the model as
 * `linear__<tool>` (found via connection_search). The model never sees the URL
 * or any token.
 *
 * auth uses Vercel Connect: each user signs in through Connect, which stores and
 * refreshes their token. "linear/ship" is the registered Connect client UID —
 * keep it in sync with the client you register.
 */
export default defineMcpClientConnection({
  url: "https://mcp.linear.app/sse",
  description:
    "Linear workspace: search, read, create, and update issues, projects, cycles, and comments.",
  auth: connect("linear/ship"),
});
