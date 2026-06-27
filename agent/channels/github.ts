import { connectGitHubCredentials } from "@vercel/connect/eve";
import { defaultGitHubAuth, githubChannel } from "eve/channels/github";

/**
 * Reach Shipmate from GitHub — review PRs where they live.
 *
 * - **@mention** the bot in a PR / issue / review comment → it replies in that
 *   thread (the default mention gate; no `onComment` override, so only mentions
 *   dispatch — ordinary comments are ignored).
 * - **A newly opened pull request** is auto-reviewed (`onPullRequest`).
 *
 * Either way the always-on instructions drive the turn: the agent calls
 * `review_pr` (its own sandbox checkout + run), correlates with the linked
 * ticket / Linear issue, and posts the verdict back as an idempotent PR comment.
 *
 * AUTHORITY (Pillar 1): the `action.result` handler below also turns the
 * `review_pr` verdict into a GitHub **Check Run** keyed on the PR head SHA. Made a
 * Required Status Check in branch protection, a `failure` conclusion physically
 * **blocks the merge** — the difference between a bot that comments and the
 * reviewer the team can't merge without.
 *
 * Credentials are ACTIVATION-GATED (see the switch below the type):
 * - DEFAULT (no App secrets): Vercel Connect (`github/ship`). Connect does NOT
 *   forward GitHub webhooks yet ("Slack-only in beta"), so this path is DORMANT —
 *   the channel is discovered + typechecked but receives no PR events. Boots fine.
 * - ACTIVE (all three App secrets set): a classic GitHub App webhook. eve mints the
 *   App JWT + installation token (which the Check Run handler needs) and verifies
 *   inbound webhooks natively at /eve/v1/github.
 *
 * To go live (the only step left for Pillar 1 to fire):
 *   1. Create a GitHub App; grant it `checks: write` + `pull_requests: read` +
 *      `issues: read/write` (comments); subscribe to Pull request + Issue comment
 *      events; set its webhook URL to https://<deploy>/eve/v1/github and a secret.
 *   2. In the Vercel project env set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY (the PEM;
 *      eve normalizes newlines), GITHUB_WEBHOOK_SECRET, then redeploy.
 *   3. Install the App on the repo; open a PR; add "Shipmate Review" as a Required
 *      Status Check in branch protection.
 *
 * grounding: githubChannel/onPullRequest/events/defaultGitHubAuth — docs/channels/github.mdx;
 * channel.github.request → GitHubApiResponse{body} (channels/github/api.d.ts:30-34);
 * action.result data.result: RuntimeActionResult (protocol/message.d.ts:171-181);
 * RuntimeToolResultActionResult{toolName,output} (runtime/actions/types.d.ts:107-113);
 * channel.repository{owner,name} (inbound.d.ts:6-12), channel.state.headSha (state.d.ts:22).
 */

const CHECK_NAME = "Shipmate Review";

// The subset of review_pr's Verdict the Check Run reads.
type ReviewVerdict = {
  ranChecks?: boolean;
  passed?: boolean;
  failingChecks?: string[];
  summary?: string;
};

// Activation switch (boot-safe). When ALL THREE GitHub App secrets are present, use
// the classic App-webhook path: eve mints the App JWT + installation token (which the
// Check Run handler needs) and verifies inbound webhooks natively at /eve/v1/github.
// When any is missing, fall back to the Vercel Connect path — which is DORMANT today
// (Connect doesn't forward GitHub webhooks yet) but boots cleanly. So setting the
// secrets activates the channel; leaving them unset never breaks the deploy.
// Env names match eve's resolver fallbacks (channels/github/auth.js).
const APP_ID = process.env.GITHUB_APP_ID;
const APP_PRIVATE_KEY = process.env.GITHUB_APP_PRIVATE_KEY;
const APP_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;
const useAppWebhook = Boolean(APP_ID && APP_PRIVATE_KEY && APP_WEBHOOK_SECRET);

export default githubChannel({
  credentials: useAppWebhook
    ? { appId: APP_ID, privateKey: APP_PRIVATE_KEY, webhookSecret: APP_WEBHOOK_SECRET }
    : connectGitHubCredentials("github/ship"),
  botName: process.env.SHIPMATE_GITHUB_BOTNAME ?? "shipmate",
  // Auto-review on a new PR (opened/reopened) AND on every push to an open PR
  // (synchronize) — so re-reviewing is just `git push`, no fresh PR needed, and the
  // Check Run re-keys onto the new head SHA each time.
  onPullRequest: (ctx, pr) =>
    pr.action === "opened" ||
    pr.action === "reopened" ||
    pr.action === "synchronize"
      ? {
          auth: defaultGitHubAuth(ctx),
          context: [
            "Review this pull request: call review_pr on this PR's URL, then post the verdict back as a single idempotent PR comment and note the linked ticket/Linear issue. If review_pr reports ranChecks:false, say it couldn't be run — do not guess a pass/fail. (A GitHub Check Run is published automatically from the review_pr result; you don't post the check yourself.)",
          ],
        }
      : null,

  events: {
    // PILLAR 1 — AUTHORITY. Publish the review_pr verdict as a Check Run on the PR
    // head SHA. Additive: the github channel has NO built-in `action.result`
    // handler, so this does not clobber the default reply-posting (message.completed).
    //
    // Mapping: passed → success ; failed (ranChecks:true, !passed) → FAILURE (gates
    // the merge) ; couldn't run (ranChecks:false) → neutral (non-blocking — a sandbox
    // hiccup must not block every merge; a human decides). Idempotent: update the
    // existing Shipmate check run on this SHA, else create one.
    //
    // Needs the GitHub App installation to grant `checks: write`. If it doesn't, the
    // request throws and we log + continue — the review comment still posts.
    "action.result": async (data, channel) => {
      const r = data.result;
      if (data.error || r.kind !== "tool-result" || r.toolName !== "review_pr") return;

      const out = r.output;
      if (!out || typeof out !== "object" || Array.isArray(out)) return;
      const v = out as ReviewVerdict;

      const { owner, name: repo } = channel.repository;
      const headSha = channel.state.headSha;
      if (!headSha) return; // not a PR context — nothing to gate

      const conclusion =
        v.ranChecks === false ? "neutral" : v.passed ? "success" : "failure";
      const title =
        v.ranChecks === false
          ? "Couldn't run the checks"
          : v.passed
            ? "All checks passed"
            : `Failing: ${(v.failingChecks ?? []).join(", ") || "checks"}`;
      const body = {
        name: CHECK_NAME,
        head_sha: headSha,
        status: "completed",
        conclusion,
        output: { title, summary: v.summary ?? title },
      };

      try {
        const existing = await channel.github.request<{
          check_runs?: { id: number; name: string }[];
        }>({
          method: "GET",
          path: `/repos/${owner}/${repo}/commits/${headSha}/check-runs?check_name=${encodeURIComponent(CHECK_NAME)}`,
        });
        const found = existing.body.check_runs?.find((c) => c.name === CHECK_NAME);
        if (found) {
          await channel.github.request({
            method: "PATCH",
            path: `/repos/${owner}/${repo}/check-runs/${found.id}`,
            body,
          });
        } else {
          await channel.github.request({
            method: "POST",
            path: `/repos/${owner}/${repo}/check-runs`,
            body,
          });
        }
      } catch (err) {
        // Most likely the GitHub App lacks `checks: write`. Don't fail the turn.
        console.error(
          "[shipmate] Check Run write failed (does the GitHub App grant checks:write?):",
          err instanceof Error ? err.message : err,
        );
      }
    },
  },
});
