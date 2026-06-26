import { defineOpenAPIConnection } from "eve/connections";
import { writeApproval } from "#lib/write-approval.js";

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

  // Writes-only human-in-the-loop. eve's connection `approval` runs on EVERY
  // generated operation, so `writeApproval` itself decides per call: it returns
  // "user-approval" only for write operations (createIssue/updateIssue/
  // transitionIssue/bulkUpdateIssues/…) from an interactive human, and
  // "not-applicable" for reads and for automated callers (schedules, the GitHub
  // auto-review). One policy, no read/write connection split needed.
  approval: writeApproval,
});
