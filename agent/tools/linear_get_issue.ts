import { defineTool } from "eve/tools";
import { z } from "zod";
import { linearGraphQL } from "../lib/linear.js";

const QUERY = `query Get($key: String!, $number: Float!) {
  issues(first: 1, filter: { team: { key: { eq: $key } }, number: { eq: $number } }) {
    nodes {
      id identifier title description priority url createdAt updatedAt
      state { name type }
      assignee { name email }
      team { key name }
      labels { nodes { name } }
    }
  }
}`;

type Resp = { issues: { nodes: Array<Record<string, unknown>> } };

export default defineTool({
  description:
    "Get full detail for one Linear issue by its identifier (e.g. JER-12): title, description, status, assignee, labels, and URL.",
  inputSchema: z.object({
    identifier: z
      .string()
      .regex(/^[A-Za-z]+-\d+$/, "Use a Linear identifier like JER-12.")
      .describe("Linear issue identifier, e.g. JER-12."),
  }),
  async execute({ identifier }) {
    const [key, num] = identifier.split("-");
    const res = await linearGraphQL<Resp>(QUERY, {
      key: key.toUpperCase(),
      number: Number(num),
    });
    if (!res.ok) return { ok: false as const, error: res.error };
    const issue = res.data.issues.nodes[0];
    if (!issue) return { ok: false as const, error: `No Linear issue ${identifier} found.` };
    return { ok: true as const, issue };
  },
});
