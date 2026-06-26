import { defineEval } from "eve/evals";
import { matches } from "eve/evals/expect";
import { z } from "zod";

// Proves Shipmate can serve a PROGRAMMATIC caller: pass an outputSchema on the
// turn and get a typed verdict back (not prose), so a CI bot or another service
// can POST "review this PR" and gate on `passed`. Deterministic via the couldn't-
// run case (unclonable repo): the structured verdict must be passed:false /
// ranChecks:false — proving the typed output faithfully reflects review_pr's
// result, including the "couldn't run ⇒ no false pass" safety rule.
const CouldntRunVerdict = z.object({
  passed: z.literal(false),
  ranChecks: z.literal(false),
  failingChecks: z.array(z.string()),
  summary: z.string(),
});

export default defineEval({
  description:
    "A caller can request a structured review verdict (outputSchema) and get typed JSON reflecting review_pr's result.",
  async test(t) {
    const turn = await t.send({
      message:
        "Review https://github.com/shipmate-nonexistent-org-zzz/does-not-exist/pull/1 and return the verdict.",
      outputSchema: {
        type: "object",
        properties: {
          passed: { type: "boolean" },
          ranChecks: { type: "boolean" },
          failingChecks: { type: "array", items: { type: "string" } },
          summary: { type: "string" },
        },
        required: ["passed", "ranChecks", "failingChecks", "summary"],
      },
    });
    turn.expectOk();
    t.succeeded();
    t.calledTool("review_pr");
    // The structured output is typed AND carries the couldn't-run verdict.
    // (0.15: assert via t.check(turn.data, matches(schema)) — t.outputMatches is
    // 0.14-era and not on EveEvalContext.)
    t.check(turn.data, matches(CouldntRunVerdict));
  },
});
