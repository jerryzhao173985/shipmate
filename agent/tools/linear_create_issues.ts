import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { linearGraphQL } from "../lib/linear.js";

const TEAM_QUERY = `query($key: String!) {
  teams(first: 1, filter: { key: { eq: $key } }) { nodes { id } }
}`;

const EXISTING = `query($key: String!) {
  issues(first: 250, filter: { team: { key: { eq: $key } } }) { nodes { title } }
}`;

const CREATE = `mutation($input: IssueCreateInput!) {
  issueCreate(input: $input) { success issue { identifier url title } }
}`;

type TeamResp = { teams: { nodes: Array<{ id: string }> } };
type ExistingResp = { issues: { nodes: Array<{ title: string }> } };
type CreateResp = {
  issueCreate: { success: boolean; issue: { identifier: string; url: string; title: string } };
};

/**
 * Bulk-create Linear issues in one team with a single approval — for syncing a
 * batch (e.g. tracker tickets) into Linear without one prompt per issue.
 *
 * approval: always() — non-idempotent, so the human confirms the whole batch and
 * the approval record survives a durable replay.
 *
 * Idempotent on re-run: issues whose title already exists in the team are
 * skipped (case-insensitive), so a retry — or a step that replays mid-batch —
 * never creates duplicates. This also enforces "search before create" for syncs.
 */
export default defineTool({
  approval: always(),
  description:
    "Create several Linear issues in one team in a single approved batch. Use to sync a list (e.g. tracker tickets) into Linear. Issues whose title already exists in the team are skipped, so it is safe to re-run.",
  inputSchema: z.object({
    teamKey: z.string().min(1).describe("Team key, e.g. JER."),
    issues: z
      .array(
        z.object({
          title: z.string().min(1),
          description: z.string().optional().describe("Markdown body; include source id/status/labels for context."),
          priority: z.number().int().min(0).max(4).optional().describe("0 none,1 urgent,2 high,3 normal,4 low."),
        }),
      )
      .min(1)
      .max(50)
      .describe("Issues to create."),
  }),
  async execute({ teamKey, issues }) {
    const key = teamKey.toUpperCase();
    const team = await linearGraphQL<TeamResp>(TEAM_QUERY, { key });
    if (!team.ok) return { ok: false as const, error: team.error };
    const teamId = team.data.teams.nodes[0]?.id;
    if (!teamId) return { ok: false as const, error: `No Linear team with key ${teamKey}.` };

    const existing = await linearGraphQL<ExistingResp>(EXISTING, { key });
    if (!existing.ok) return { ok: false as const, error: existing.error };
    const seen = new Set(existing.data.issues.nodes.map((n) => n.title.trim().toLowerCase()));

    const created: Array<{ identifier: string; url: string; title: string }> = [];
    const skipped: string[] = [];
    const failed: Array<{ title: string; error: string }> = [];

    for (const issue of issues) {
      if (seen.has(issue.title.trim().toLowerCase())) {
        skipped.push(issue.title);
        continue;
      }
      const input: Record<string, unknown> = { teamId, title: issue.title };
      if (issue.description !== undefined) input.description = issue.description;
      if (issue.priority !== undefined) input.priority = issue.priority;

      const res = await linearGraphQL<CreateResp>(CREATE, { input });
      if (!res.ok || !res.data.issueCreate.success) {
        failed.push({ title: issue.title, error: res.ok ? "create did not succeed" : res.error });
        continue;
      }
      seen.add(issue.title.trim().toLowerCase());
      created.push(res.data.issueCreate.issue);
    }

    return { ok: true as const, created, skipped, failed };
  },
});
