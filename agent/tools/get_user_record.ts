import { defineTool } from "eve/tools";
import { z } from "zod";

/**
 * TEMPLATE — adapt this to a real operation on YOUR internal API.
 *
 * This is the typed-tool pattern for calling your own service from the app
 * runtime: a Zod-validated input, a fetch against an env-configured base URL,
 * a bearer token from process.env, and a minimized JSON-serializable result
 * (never return the raw token or full upstream payload to the model).
 *
 * Replace the endpoint, inputs, and shape below with one concrete operation
 * your ops assistant needs (e.g. look up an account, fetch a deploy status,
 * read a feature flag). If your API publishes an OpenAPI/Swagger document,
 * prefer a connection in agent/connections/ (defineOpenAPIConnection) instead,
 * which derives one tool per operation automatically.
 *
 * Read-only, so no approval gate. Add `approval: always()` (from
 * "eve/tools/approval") if you make this tool write or mutate.
 *
 * Env: INTERNAL_API_BASE_URL, INTERNAL_API_TOKEN
 */
export default defineTool({
  description:
    "Look up a user/account record by id in the team's internal system. Use when the user asks about an internal account, customer, or user by id.",
  inputSchema: z.object({
    id: z.string().min(1).describe("The internal record id to look up."),
  }),
  async execute({ id }) {
    const baseUrl = process.env.INTERNAL_API_BASE_URL;
    const token = process.env.INTERNAL_API_TOKEN;
    if (!baseUrl) {
      return { ok: false as const, error: "INTERNAL_API_BASE_URL is not set." };
    }

    const res = await fetch(
      `${baseUrl.replace(/\/$/, "")}/users/${encodeURIComponent(id)}`,
      {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      },
    );

    if (!res.ok) {
      return {
        ok: false as const,
        status: res.status,
        error: `Internal API returned ${res.status} ${res.statusText}.`,
      };
    }

    const record = (await res.json()) as Record<string, unknown>;
    // Return only what the model needs; trim/redact fields as appropriate.
    return { ok: true as const, record };
  },
});
