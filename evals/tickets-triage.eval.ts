import { defineEval } from "eve/evals";

// Regression guard for the ticket-tracker connection: the agent must boot,
// query the live tracker, and answer with a count. Keeps the tickets__* wiring
// from silently breaking on future prompt/model/connection changes.
export default defineEval({
  description: "Ticket tracker: agent counts triage issues from the live tracker.",
  async test(t) {
    await t.send(
      "Using the ticket tracker, how many issues are currently in triage? Reply with the number.",
    );
    t.succeeded();
    t.messageIncludes(/\d/);
    t.calledTool("tickets__listIssues").soft();
  },
});
