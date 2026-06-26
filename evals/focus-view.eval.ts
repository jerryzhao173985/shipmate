import { defineEval } from "eve/evals";

// Guards the cross-system navigation behavior: a "what should I focus on" query
// must actually pull the tracker (not answer from memory) and return a concrete,
// navigable answer with real issue identifiers the user can click through.
export default defineEval({
  description: "Focus view: agent pulls the tracker and returns a grouped, id-bearing answer.",
  async test(t) {
    await t.send(
      "What are the top issues in the ticket tracker I should focus on right now? Group them and include each issue's id.",
    );
    t.succeeded();
    t.calledTool("tickets__listIssues").soft();
    t.messageIncludes(/(ENG|DES)-\d+|tt_\d+/i);
  },
});
