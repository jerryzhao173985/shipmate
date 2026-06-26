import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { linearGraphQL } from "../lib/linear.js";

const TEAM_QUERY = `query($key: String!) {
  teams(first: 1, filter: { key: { eq: $key } }) { nodes { id } }
}`;

const CREATE = `mutation($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue { id identifier url state { name } }
  }
}`;

type TeamResp = { teams: { nodes: Array<{ id: string }> } };
type CreateResp = {
  issueCreate: {
    success: boolean;
    issue: { id: string; identifier: string; url: string; state: { name: string } };
  };
};

/**
 * Create a Linear issue.
 *
 * approval: always() — issueCreate is NOT idempotent, so a durable step that
 * re-runs on resume would otherwise create a duplicate. The approval record
 * survives the replay, so the issue is created exactly once and a human confirms
 * a new issue in the real workspace.
 */
export default defineTool({
  approval: always(),
  description:
    "Create a new Linear issue in a team. Provide the team key (e.g. JER), a title, and optionally a description and priority. Use linear_search_issues first to avoid duplicates.",
  inputSchema: z.object({
    teamKey: z.string().min(1).describe("Team key, e.g. JER."),
    title: z.string().min(1).describe("Issue title."),
    description: z.string().optional().describe("Markdown body."),
    priority: z
      .number()
      .int()
      .min(0)
      .max(4)
      .optional()
      .describe("0 none, 1 urgent, 2 high, 3 normal, 4 low."),
  }),
  async execute({ teamKey, title, description, priority }) {
    const team = await linearGraphQL<TeamResp>(TEAM_QUERY, {
      key: teamKey.toUpperCase(),
    });
    if (!team.ok) return { ok: false as const, error: team.error };
    const teamId = team.data.teams.nodes[0]?.id;
    if (!teamId) return { ok: false as const, error: `No Linear team with key ${teamKey}.` };

    const input: Record<string, unknown> = { teamId, title };
    if (description !== undefined) input.description = description;
    if (priority !== undefined) input.priority = priority;

    const res = await linearGraphQL<CreateResp>(CREATE, { input });
    if (!res.ok) return { ok: false as const, error: res.error };
    if (!res.data.issueCreate.success) {
      return { ok: false as const, error: "Linear reported the create did not succeed." };
    }
    return { ok: true as const, issue: res.data.issueCreate.issue };
  },
});
