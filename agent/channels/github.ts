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
 * Credentials + inbound webhook verification are brokered by Vercel Connect via
 * the SAME `github/ship` connector that powers the `github__*` MCP tools — no
 * GitHub-App secrets in env. The webhook lands at `/eve/v1/github`.
 *
 * Posture note: the model has `bash` disabled (prompt-injection hardening). The
 * channel still checks the repo out into the sandbox, and the model can inspect
 * it via `read_file`/`glob`/`grep`; controlled *execution* happens only through
 * `review_pr`. That is the intended security posture, not a limitation.
 *
 * [VERIFY] Runtime (not yet exercised) requires: (1) the `github/ship` connector
 * to FORWARD GitHub webhooks to this deployment — enable triggers on the
 * connector + attach this project as a trigger destination
 * (`vercel connect attach github/ship --triggers --trigger-path /eve/v1/github`),
 * (2) `botName` to match the connector's GitHub App login for @mentions, and
 * (3) a real PR event. Structurally discovered + typechecked; end-to-end pending
 * that infra + a live PR. Coordinated with the review/sandbox lane (this channel
 * triggers their `review_pr` and shares the sandbox checkout).
 *
 * grounding: githubChannel/onPullRequest/defaultGitHubAuth — docs/channels/github.mdx:7,35,44-52;
 * connectGitHubCredentials — @vercel/connect/eve (github-credentials.d.ts).
 */
export default githubChannel({
  credentials: connectGitHubCredentials("github/ship"),
  botName: process.env.SHIPMATE_GITHUB_BOTNAME ?? "shipmate",
  onPullRequest: (ctx, pr) =>
    pr.action === "opened"
      ? {
          auth: defaultGitHubAuth(ctx),
          context: [
            "This pull request was just opened. Review it: call review_pr on this PR's URL, then post the verdict back as a single idempotent PR comment and note the linked ticket/Linear issue. If review_pr reports ranChecks:false, say it couldn't be run — do not guess a pass/fail.",
          ],
        }
      : null,
});
