import { defineTool } from "eve/tools";
import { z } from "zod";
import { links, sameLink, type Link } from "#lib/memory.js";

/**
 * Record a PR / ticket / Linear correlation or a review verdict into the session's
 * durable memory, so it can be recalled later in the conversation (and survives
 * context compaction). Internal memory only — no external side effect, so no
 * approval gate.
 *
 * Merges into an existing entry that shares an identifier (pr/ticket/linear),
 * with new values winning; otherwise appends a new one.
 */
export default defineTool({
  description:
    "Remember a correlation or review verdict for the rest of this conversation: link a PR to its ticket / Linear issue, and/or record its review verdict. Call this after you correlate a PR with a ticket/Linear issue, or after review_pr runs, so you can recall it later without re-deriving it. Provide at least one of pr, ticket, or linear.",
  inputSchema: z.object({
    pr: z.string().optional().describe("PR URL or owner/repo#number."),
    ticket: z.string().optional().describe("Ticket id, e.g. ENG-12."),
    linear: z.string().optional().describe("Linear identifier, e.g. JER-5."),
    verdict: z.string().optional().describe("Short review verdict, e.g. 'failed: test'."),
    note: z.string().optional().describe("Any extra context worth recalling."),
  }),
  async execute(input) {
    const entry: Link = input;
    if (!entry.pr && !entry.ticket && !entry.linear) {
      return { ok: false as const, error: "Provide at least one of pr, ticket, or linear to remember." };
    }
    let stored: Link = entry;
    links.update((cur) => {
      const idx = cur.findIndex((e) => sameLink(e, entry));
      if (idx >= 0) {
        stored = { ...cur[idx], ...entry }; // merge; new non-undefined values win
        const next = cur.slice();
        next[idx] = stored;
        return next;
      }
      return [...cur, entry];
    });
    return { ok: true as const, remembered: stored, total: links.get().length };
  },
});
