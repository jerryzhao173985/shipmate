import { defineTool } from "eve/tools";
import { z } from "zod";
import { linearGraphQL } from "../lib/linear.js";

const FIND = `query($key: String!, $number: Float!) {
  issues(first: 1, filter: { team: { key: { eq: $key } }, number: { eq: $number } }) {
    nodes { id team { key } }
  }
}`;

const STATES = `query($key: String!) {
  workflowStates(filter: { team: { key: { eq: $key } } }) { nodes { id name } }
}`;

const UPDATE = `mutation($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) {
    success
    issue { identifier priority state { name } title }
  }
}`;

type FindResp = { issues: { nodes: Array<{ id: string; team: { key: string } }> } };
type StatesResp = { workflowStates: { nodes: Array<{ id: string; name: string }> } };
type UpdateResp = {
  issueUpdate: {
    success: boolean;
    issue: { identifier: string; priority: number; state: { name: string }; title: string };
  };
};

/**
 * Update a Linear issue by identifier (e.g. JER-12): title, description,
 * priority, and/or status (a transition, by state name).
 *
 * No approval gate: an update sets fields to explicit values, so a replayed step
 * produces the same result (idempotent). Resolving the issue id and state id are
 * read-only lookups.
 */
export default defineTool({
  description:
    "Update a Linear issue by identifier (e.g. JER-12). Set any of: title, description, priority (0 none,1 urgent,2 high,3 normal,4 low), or status (by state name like 'In Progress' or 'Done').",
  inputSchema: z.object({
    identifier: z
      .string()
      .regex(/^[A-Za-z]+-\d+$/, "Use an identifier like JER-12.")
      .describe("Linear issue identifier, e.g. JER-12."),
    title: z.string().optional(),
    description: z.string().optional(),
    priority: z.number().int().min(0).max(4).optional(),
    stateName: z
      .string()
      .optional()
      .describe("Target status name, e.g. 'In Progress', 'Done', 'Todo'."),
  }),
  async execute({ identifier, title, description, priority, stateName }) {
    const [key, num] = identifier.split("-");
    const teamKey = key.toUpperCase();

    const found = await linearGraphQL<FindResp>(FIND, { key: teamKey, number: Number(num) });
    if (!found.ok) return { ok: false as const, error: found.error };
    const issue = found.data.issues.nodes[0];
    if (!issue) return { ok: false as const, error: `No Linear issue ${identifier} found.` };

    const input: Record<string, unknown> = {};
    if (title !== undefined) input.title = title;
    if (description !== undefined) input.description = description;
    if (priority !== undefined) input.priority = priority;

    if (stateName !== undefined) {
      const states = await linearGraphQL<StatesResp>(STATES, { key: teamKey });
      if (!states.ok) return { ok: false as const, error: states.error };
      const match = states.data.workflowStates.nodes.find(
        (s) => s.name.toLowerCase() === stateName.toLowerCase(),
      );
      if (!match) {
        const names = states.data.workflowStates.nodes.map((s) => s.name).join(", ");
        return { ok: false as const, error: `No state "${stateName}" for team ${teamKey}. Available: ${names}.` };
      }
      input.stateId = match.id;
    }

    if (Object.keys(input).length === 0) {
      return { ok: false as const, error: "Nothing to update — provide at least one field." };
    }

    const res = await linearGraphQL<UpdateResp>(UPDATE, { id: issue.id, input });
    if (!res.ok) return { ok: false as const, error: res.error };
    if (!res.data.issueUpdate.success) {
      return { ok: false as const, error: "Linear reported the update did not succeed." };
    }
    return { ok: true as const, issue: res.data.issueUpdate.issue };
  },
});
