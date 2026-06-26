import { defineTool } from "eve/tools";
import { z } from "zod";
import { links } from "#lib/memory.js";

/**
 * Recall the PR / ticket / Linear links and review verdicts remembered this
 * conversation (via remember_link). Optionally filter by a query substring.
 * Read-only; no approval gate.
 */
export default defineTool({
  description:
    "Recall what you've remembered this conversation: the PR↔ticket↔Linear links and review verdicts recorded with remember_link. Optionally filter by a query (a PR url, ticket id, or Linear id). Use this on a follow-up turn instead of re-deriving correlations.",
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe("Optional filter: a PR url, ticket id, Linear id, or any substring to match."),
  }),
  async execute({ query }) {
    const all = links.get();
    if (!query) return { links: all, total: all.length };
    const q = query.toLowerCase();
    const matched = all.filter((e) =>
      [e.pr, e.ticket, e.linear, e.verdict, e.note].some((v) =>
        v?.toLowerCase().includes(q),
      ),
    );
    return { links: matched, total: matched.length };
  },
});
