import { defineEval } from "eve/evals";

// Proves the deterministic join-key extractor: given PR text with a tracker id
// (ENG-12), a Linear id (JER-5), and a PR ref, `correlate` returns those exact
// keys. Deterministic (pure regex), so the output predicate is a hard gate.
export default defineEval({
  description:
    "correlate extracts the cross-system join keys (ENG-12, JER-5, owner/repo#n) from PR text.",
  async test(t) {
    await t.send(
      "Use your tools to extract the linked issue keys and PR references from this pull request description:\n\n" +
        "'This change implements ENG-12 and is related to JER-5. Supersedes acme/widgets#7. Uses UTF-8 encoding.'",
    );
    t.succeeded();
    t.calledTool("correlate", {
      output: (v: unknown) => {
        const o = v as { issueKeys?: unknown; prs?: unknown };
        const keys = Array.isArray(o.issueKeys) ? (o.issueKeys as string[]) : [];
        const prs = Array.isArray(o.prs) ? (o.prs as string[]) : [];
        // The two real issue keys are found; UTF-8 is correctly excluded; the PR
        // ref is normalized.
        return (
          keys.includes("ENG-12") &&
          keys.includes("JER-5") &&
          !keys.includes("UTF-8") &&
          prs.includes("acme/widgets#7")
        );
      },
    });
  },
});
