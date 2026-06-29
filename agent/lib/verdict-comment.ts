/**
 * The sticky verdict-comment builder — pure (no eve runtime), so it's unit-testable
 * without booting a channel. Owned by `agent/channels/github.ts` (the `action.result`
 * handler imports `MARKER` + `verdictComment`); extracted here only so a regression
 * in the wording/branching is caught by `test/verdict-comment.test.ts` in free CI.
 */

// Stable marker so the verdict comment is found + updated in place, never stacked.
export const MARKER = "<!-- shipmate-review -->";

// The subset of review_pr's Verdict the Check Run + comment read.
export type ReviewVerdict = {
  ranChecks?: boolean;
  passed?: boolean;
  failingChecks?: string[];
  timedOut?: boolean;
  reviewedRef?: "merge" | "head" | null;
  summary?: string;
  output?: string;
};

// Build the human-readable sticky verdict comment from the structured Verdict.
export function verdictComment(v: ReviewVerdict, headSha: string): string {
  const sha = headSha.slice(0, 7);
  if (v.ranChecks === false) {
    return [
      MARKER,
      `## ⚠️ Shipmate Review — couldn't run`,
      ``,
      v.summary ?? `The checks could not be run on \`${sha}\`.`,
      ``,
      `_The Check Run is **neutral** (non-blocking) — a sandbox hiccup won't block the merge. Re-push to retry._`,
    ].join("\n");
  }
  if (v.passed) {
    return [
      MARKER,
      `## ✅ Shipmate Review — passed`,
      ``,
      v.summary ?? `All checks passed on \`${sha}\`.`,
    ].join("\n");
  }
  const failing = (v.failingChecks ?? []).join(", ") || "checks";
  const excerpt = (v.output ?? "").trim();
  const detail = excerpt
    ? `\n\n<details><summary>Output excerpt</summary>\n\n\`\`\`\n${excerpt.slice(-1200)}\n\`\`\`\n\n</details>`
    : "";
  return (
    [
      MARKER,
      `## ❌ Shipmate Review — failed`,
      ``,
      `**Failing: ${failing}**${v.timedOut ? " (some checks timed out)" : ""} on \`${sha}\`. Not safe to merge.`,
      v.summary ? `\n${v.summary}` : ``,
    ]
      .filter((line) => line !== ``)
      .join("\n") + detail
  );
}
