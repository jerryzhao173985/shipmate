import { defineEval } from "eve/evals";

// Smoke guard for the Linear connection. Linear is user-scoped Connect, so the
// eval harness (no authenticated user principal) cannot read Linear data — but
// it CAN verify the connection is wired and the agent degrades gracefully: the
// turn completes (doesn't crash/park) and the reply addresses Linear and the
// sign-in/authorization need rather than hallucinating data.
export default defineEval({
  description: "Linear connection wired; agent degrades gracefully without a user principal.",
  async test(t) {
    await t.send(
      "Using the Linear tools, list issues for team JER. If Linear can't be reached in this context, briefly say so and why.",
    );
    t.succeeded();
    t.messageIncludes(/linear/i);
    t.messageIncludes(/authoriz|sign[- ]?in|user|principal|connect|reach/i);
  },
});
