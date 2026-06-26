// Shared helper for calling Linear's GraphQL API from tools.
// Import-only module (agent/lib is never mounted to the sandbox).

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";

export type LinearResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Run a Linear GraphQL query/mutation with the personal API key.
 *
 * Linear personal API keys go in the `Authorization` header WITHOUT a `Bearer`
 * prefix — that's why Linear is wired as a tool here rather than through eve's
 * MCP connection auth (which always sends `Bearer`). The model never sees the key.
 *
 * Env: LINEAR_API_KEY
 */
export async function linearGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<LinearResult<T>> {
  const key = process.env.LINEAR_API_KEY;
  if (!key) return { ok: false, error: "LINEAR_API_KEY is not set." };

  const res = await fetch(LINEAR_GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = (await res.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };
  if (json.errors?.length) {
    return { ok: false, error: json.errors.map((e) => e.message).join("; ") };
  }
  if (!res.ok) {
    return { ok: false, error: `Linear API ${res.status} ${res.statusText}` };
  }
  return { ok: true, data: json.data as T };
}
