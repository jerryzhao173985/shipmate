import { defineOpenAPIConnection } from "eve/connections";
// import { always } from "eve/tools/approval"; // see "Human-in-the-loop" below

/**
 * Ticket Tracker — the team's own issue-tracking API (Hono on Vercel Fluid
 * Compute), wired from its published OpenAPI 3 document.
 *
 * On startup eve fetches the spec and generates one tool per operation, named
 * `tickets__<operationId>` (e.g. tickets__getWorkflow, tickets__listIssues,
 * tickets__createIssue, tickets__transitionIssue, tickets__bulkUpdateIssues).
 * For each call eve injects `Authorization: Bearer <token>`, resolves the path
 * against the server URL, and fills path params from the typed inputs. The model
 * never sees the spec URL, base URL, or token — only verb-named tools.
 *
 * Env:
 *   TICKET_TRACKER_TOKEN       (required) bearer token for every /v1 route
 *   TICKET_TRACKER_OPENAPI_URL (optional) override the spec URL
 *   TICKET_TRACKER_BASE_URL    (optional) override the request base URL
 *
 * The spec's `servers` already points at the live deployment, so baseUrl is
 * derived automatically; the override is only for pointing at a different env.
 */
export default defineOpenAPIConnection({
  spec:
    process.env.TICKET_TRACKER_OPENAPI_URL ??
    "https://tickettracker-chi.vercel.app/openapi.json",
  ...(process.env.TICKET_TRACKER_BASE_URL
    ? { baseUrl: process.env.TICKET_TRACKER_BASE_URL }
    : {}),
  description:
    "Ticket Tracker: the team's issue tracker. Manage issues, teams, projects, cycles, labels, comments, relations, and webhooks. Read workflow/stats/activity; create, update, transition, and bulk-update issues.",
  auth: {
    getToken: async () => ({ token: process.env.TICKET_TRACKER_TOKEN! }),
  },

  // Human-in-the-loop (optional). NOTE: eve's connection-level `approval` gates
  // EVERY generated operation — reads included — not just writes. Uncomment to
  // require a human approval before any Ticket Tracker tool runs:
  //
  //   approval: always(),
  //
  // To gate ONLY writes, split into two connections instead: a read connection
  // with `operations: { allow: [<all GET operationIds>] }` and a write
  // connection with `approval: always()` and `operations: { allow: ["createIssue",
  // "updateIssue", "transitionIssue", "bulkUpdateIssues", ...] }`.
});
