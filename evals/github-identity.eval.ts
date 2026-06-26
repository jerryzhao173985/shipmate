import { defineEval } from "eve/evals";

// Regression guard for the GitHub connection (Vercel Connect, app-scoped): the
// agent must reach GitHub and return a known stable fact (the numeric user id of
// a fixed login), proving Connect issued a working token and a github__* tool ran.
export default defineEval({
  description: "GitHub (Connect): agent looks up a login and returns its user id.",
  async test(t) {
    await t.send(
      "Using the GitHub tools, search for the user with login jerryzhao173985 and include their numeric user id in your reply.",
    );
    t.succeeded();
    t.messageIncludes(/44931279/);
  },
});
