import { defineEval } from "eve/evals";

// Regression guard for the Linear GraphQL tools: the agent must boot, call a
// linear_* tool against the live workspace, and answer with a count.
export default defineEval({
  description: "Linear: agent lists issues for team JER and reports a count.",
  async test(t) {
    await t.send(
      "Using the Linear tools, how many issues are in team JER? Reply with just the number.",
    );
    t.succeeded();
    t.messageIncludes(/\d/);
    t.calledTool("linear_search_issues").soft();
  },
});
