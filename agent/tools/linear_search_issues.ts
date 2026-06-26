import { defineTool } from "eve/tools";
import { z } from "zod";
import { linearGraphQL } from "../lib/linear.js";

const QUERY = `query Search($first: Int!, $filter: IssueFilter) {
  issues(first: $first, filter: $filter, orderBy: updatedAt) {
    nodes {
      id identifier title priority url updatedAt
      state { name type }
      assignee { name }
      team { key name }
    }
  }
}`;

type Resp = { issues: { nodes: unknown[] } };

export default defineTool({
  description:
    "Search or list issues in Linear (the team's product issue tracker, separate from the ticket tracker). Optionally match free text in the title and/or restrict to a team. Use to look up Linear issues and correlate them with tickets or GitHub PRs.",
  inputSchema: z.object({
    term: z
      .string()
      .optional()
      .describe("Free text to match in the issue title (case-insensitive)."),
    teamKey: z
      .string()
      .optional()
      .describe("Restrict to a team by its key, e.g. JER."),
    first: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(25)
      .describe("Max issues to return."),
  }),
  async execute({ term, teamKey, first }) {
    const filter: Record<string, unknown> = {};
    if (term) filter.title = { containsIgnoreCase: term };
    if (teamKey) filter.team = { key: { eq: teamKey } };
    const res = await linearGraphQL<Resp>(QUERY, {
      first,
      filter: Object.keys(filter).length ? filter : undefined,
    });
    if (!res.ok) return { ok: false as const, error: res.error };
    return { ok: true as const, issues: res.data.issues.nodes };
  },
});
