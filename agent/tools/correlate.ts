import { defineTool } from "eve/tools";
import { z } from "zod";

/**
 * Deterministically extract the cross-system JOIN KEYS from text (a PR title/body/
 * branch, or any message): tracker/Linear issue ids (ENG-12, JER-5, OPS-123) and
 * PR references (a github PR URL or owner/repo#n). This makes the PR↔ticket↔Linear
 * correlation explicit and reliable instead of leaving id-spotting to the model.
 *
 * It returns CANDIDATES — the model still fetches each id via the tickets / linear
 * tools to confirm it's a real issue (and discards a candidate that 404s), then
 * remember_links the confirmed links. Read-only, no side effect, no approval gate.
 *
 * grounding: defineTool/outputSchema — references/components/tool.md; the issue-key
 * convention [A-Z][A-Z0-9]+-<n> — PR-review-agent research (Atlassian/Linear keys).
 */

// Tracker/Linear ids: an uppercase project key + a number, e.g. ENG-12, JER-5.
const ISSUE_KEY = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/g;
// A github PR URL, and the short owner/repo#n form.
const PR_URL = /github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/gi;
const PR_SHORT = /\b([\w.-]+)\/([\w.-]+)#(\d+)\b/g;

// Common uppercase-dash-number tokens that are NOT issue keys, to cut false
// positives (the model would 404 them anyway, but don't propose obvious noise).
const NOT_ISSUE = new Set(["UTF", "SHA", "MD", "RFC", "ISO", "IPV", "RGB", "SHA1", "SHA256", "BASE64"]);

const Correlation = z.object({
  /** Candidate issue/ticket ids, e.g. ["ENG-12", "JER-5"]. Confirm by fetching. */
  issueKeys: z.array(z.string()),
  /** PR references normalized to "owner/repo#number". */
  prs: z.array(z.string()),
});

export default defineTool({
  description:
    "Extract the cross-system join keys from text (a PR title/body/branch, or a message): issue/ticket ids like ENG-12 or Linear ids like JER-5, and PR references. Use this to reliably find which ticket/Linear issue a PR links to instead of eyeballing it; then fetch each id via tickets__*/linear__* to confirm, and remember_link the real ones.",
  inputSchema: z.object({
    text: z
      .string()
      .describe("Text to scan — a PR title/body/branch name, or any message."),
  }),
  outputSchema: Correlation,
  async execute({ text }) {
    const issueKeys = Array.from(
      new Set(Array.from(text.matchAll(ISSUE_KEY), (m) => m[1])),
    ).filter((k) => !NOT_ISSUE.has(k.split("-")[0]));

    const prs = new Set<string>();
    for (const m of text.matchAll(PR_URL)) {
      prs.add(`${m[1]}/${m[2].replace(/\.git$/, "")}#${m[3]}`);
    }
    for (const m of text.matchAll(PR_SHORT)) {
      prs.add(`${m[1]}/${m[2]}#${m[3]}`);
    }
    return { issueKeys, prs: Array.from(prs) };
  },
});
