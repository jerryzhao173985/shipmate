import { defineEval } from "eve/evals";

// Regression guard for Shipmate's headline capability: when asked to review a PR,
// the agent must invoke `review_pr` (which clones + runs the PR in the sandbox)
// and report a verdict honestly — never a pass when the checks didn't run.
//
// Backend note: `review_pr` runs checks inside ctx.getSandbox(). On a real backend
// (Docker / microsandbox / Vercel) the suite actually runs and Shipmate names the
// failing check. Under the local just-bash backend there's no git/network, so the
// suite can't run; there the meaningful, deterministic guard is that Shipmate still
// CALLS review_pr and does not fake a verdict. Hence:
//   - calledTool("review_pr")  -> hard gate (green in any environment)
//   - the failing-check naming  -> soft/tracked metric (a real signal under
//     `eve eval --strict` on a backend that can clone+test).
//
// To exercise the full failing-check path, point PR_URL at a PUBLIC PR you know
// fails a check, and run against a real sandbox backend.
const PR_URL = "https://github.com/sindresorhus/slugify/pull/30";
const FAILING_CHECK = /\b(test|tests|lint|build)\b/i;

export default defineEval({
  description:
    "Shipmate reviews a PR by running it: calls review_pr, and either names the failing check (real backend) or honestly reports the checks couldn't run (just-bash).",
  async test(t) {
    await t.send(
      `Review this pull request and tell me whether it is safe to merge: ${PR_URL}`,
    );
    t.succeeded();
    // The loop must actually run the tool — the deterministic v0 proof.
    t.calledTool("review_pr");
    // On a backend that can clone+test, the reply names the failing check.
    // Tracked (soft) so the suite stays green where the sandbox can't run a suite;
    // `--strict` promotes a miss to a failure in CI on a real backend.
    t.messageIncludes(FAILING_CHECK).soft();
  },
});
