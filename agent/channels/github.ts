import { connectGitHubCredentials } from "@vercel/connect/eve";
import { defaultGitHubAuth, githubChannel } from "eve/channels/github";

/**
 * Reach Shipmate from GitHub — review PRs where they live.
 *
 * - **@mention** the bot in a PR / issue / review comment → it replies in that
 *   thread (the default mention gate; no `onComment` override, so only mentions
 *   dispatch — ordinary comments are ignored).
 * - **A newly opened / reopened / synchronized pull request** is auto-reviewed
 *   (`onPullRequest`): the agent runs `review_pr` in its sandbox.
 *
 * VERDICT SURFACES ARE OWNED BY CODE, NOT THE MODEL (Pillar 1 Authority + Pillar 2
 * Trust). Two deterministic surfaces, each with one job, both driven off the
 * `review_pr` Verdict in the `action.result` handler below:
 *   1. **Check Run** ("Shipmate Review") keyed on the PR head SHA — the AUTHORITY.
 *      Made a Required Status Check in branch protection, a `failure` conclusion
 *      physically **blocks the merge**. Idempotent: PATCH the existing run on the
 *      SHA, else POST.
 *   2. **One sticky comment** (marker `<!-- shipmate-review -->`) — the NARRATION.
 *      Upserted in place (PATCH, never stacks). It only appears when there is
 *      something to say: a FAIL or COULDN'T-RUN. A clean pass stays silent (the
 *      green Check Run says it), unless a prior comment exists — then it's updated
 *      to ✅ so it never goes stale.
 *
 * Why code and not the model: the GitHub channel natively auto-posts the agent's
 * reply (`message.completed` → a PR comment, like Slack), and the agent was also
 * being told to post a verdict comment — so every review double-posted (the
 * structured comment AND the chatty reply). The `message.completed` override below
 * SUPPRESSES that auto-reply on auto-review turns (`triggeringCommentId == null`)
 * while PRESERVING normal replies on interactive @mention turns. The model's job
 * is to produce the verdict (run `review_pr`); posting is the channel's job.
 *
 * Credentials are ACTIVATION-GATED (see the switch below the type):
 * - DEFAULT (no App secrets): Vercel Connect (`github/ship`) — DORMANT (Connect
 *   doesn't forward GitHub webhooks yet). Boots fine, receives no PR events.
 * - ACTIVE (all three App secrets set): a classic GitHub App webhook. eve mints the
 *   App JWT + installation token (which both surfaces need) and verifies inbound
 *   webhooks natively at /eve/v1/github. THIS IS LIVE in prod (App `ship-eve`).
 *
 * grounding (eve 0.15.1): a custom `events[key]` REPLACES the built-in handler for
 * that key (githubChannel.d.ts:72-77); `message.completed` data `{ message: string
 * | null, finishReason, … }` (protocol/message.d.ts:271-280); auto-review vs
 * interactive via `channel.state.triggeringCommentId`/`conversationKind`
 * (state.d.ts:19-32); `channel.thread.post` / `channel.github.request` installation
 * auth (binding.d.ts:30-44); action.result `data.result` RuntimeToolResultActionResult
 * `{toolName,output}`; GitHub Check Runs + Issue Comments REST shapes are standard.
 */

const CHECK_NAME = "Shipmate Review";
// Stable marker so the verdict comment is found + updated in place, never stacked.
const MARKER = "<!-- shipmate-review -->";

// The subset of review_pr's Verdict the Check Run + comment read.
type ReviewVerdict = {
  ranChecks?: boolean;
  passed?: boolean;
  failingChecks?: string[];
  timedOut?: boolean;
  reviewedRef?: "merge" | "head" | null;
  summary?: string;
  output?: string;
};

// Build the human-readable sticky verdict comment from the structured Verdict.
function verdictComment(v: ReviewVerdict, headSha: string): string {
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

// Activation switch (boot-safe). When ALL THREE GitHub App secrets are present, use
// the classic App-webhook path: eve mints the App JWT + installation token (which the
// Check Run + comment handlers need) and verifies inbound webhooks natively at
// /eve/v1/github. When any is missing, fall back to the Vercel Connect path — DORMANT
// today but boots cleanly. So setting the secrets activates the channel; leaving them
// unset never breaks the deploy. Env names match eve's resolver fallbacks.
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
  // (synchronize) — so re-reviewing is just `git push`, and both surfaces re-key
  // onto the new head SHA. The agent ONLY runs review_pr; it must not post a
  // comment — the Check Run + sticky comment are published by code (see events).
  onPullRequest: (ctx, pr) =>
    pr.action === "opened" ||
    pr.action === "reopened" ||
    pr.action === "synchronize"
      ? {
          auth: defaultGitHubAuth(ctx),
          context: [
            "Review this pull request by calling review_pr on this PR's URL. Do NOT post a PR comment or call any GitHub comment/issue tool, and do not ask to — the verdict is published automatically as a 'Shipmate Review' Check Run and, only on a failure or couldn't-run, a single sticky PR comment. If review_pr reports ranChecks:false, that is reported as 'couldn't run' (non-blocking); never guess a pass/fail.",
          ],
        }
      : null,

  events: {
    // PILLAR 1 (AUTHORITY) + PILLAR 2 (TRUST): publish BOTH verdict surfaces from
    // the review_pr result, deterministically. Replaces nothing (the channel has no
    // built-in action.result handler).
    //
    // Check Run mapping: passed → success ; failed (ranChecks:true,!passed) →
    // FAILURE (gates the merge) ; couldn't run (ranChecks:false) → neutral
    // (non-blocking — a sandbox hiccup must not block every merge; a human decides).
    // Sticky comment: appears only on fail/couldn't-run; a clean pass is silent
    // unless a prior comment exists (then updated to ✅ so it's never stale).
    // Both idempotent. Wrapped in try/catch so a missing permission logs + continues.
    "action.result": async (data, channel) => {
      const r = data.result;
      if (data.error || r.kind !== "tool-result" || r.toolName !== "review_pr") return;

      const out = r.output;
      if (!out || typeof out !== "object" || Array.isArray(out)) return;
      const v = out as ReviewVerdict;

      const { owner, name: repo } = channel.repository;
      const headSha = channel.state.headSha;
      if (!headSha) return; // not a PR context — nothing to gate

      // 1) Check Run — the authority, keyed on the head SHA.
      const conclusion =
        v.ranChecks === false ? "neutral" : v.passed ? "success" : "failure";
      const title =
        v.ranChecks === false
          ? "Couldn't run the checks"
          : v.passed
            ? "All checks passed"
            : `Failing: ${(v.failingChecks ?? []).join(", ") || "checks"}`;
      const checkBody = {
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
        await channel.github.request({
          method: found ? "PATCH" : "POST",
          path: found
            ? `/repos/${owner}/${repo}/check-runs/${found.id}`
            : `/repos/${owner}/${repo}/check-runs`,
          body: checkBody,
        });
      } catch (err) {
        console.error(
          "[shipmate] Check Run write failed (does the GitHub App grant checks:write?):",
          err instanceof Error ? err.message : err,
        );
      }

      // 2) Sticky verdict comment — narration, only when there's something to say.
      const prNumber = channel.state.pullRequestNumber;
      if (!prNumber) return; // a push outside a PR — the Check Run is enough
      const passed = v.ranChecks !== false && v.passed === true;
      try {
        const existing = await channel.github.request<
          { id: number; body?: string }[]
        >({
          method: "GET",
          path: `/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100`,
        });
        const list = Array.isArray(existing.body) ? existing.body : [];
        const found = list.find(
          (c) => typeof c.body === "string" && c.body.includes(MARKER),
        );
        if (found) {
          // Keep the one comment current (even a pass, so it's never stale-red).
          await channel.github.request({
            method: "PATCH",
            path: `/repos/${owner}/${repo}/issues/comments/${found.id}`,
            body: { body: verdictComment(v, headSha) },
          });
        } else if (!passed) {
          // First time we have something to flag — post the single sticky comment.
          await channel.github.request({
            method: "POST",
            path: `/repos/${owner}/${repo}/issues/${prNumber}/comments`,
            body: { body: verdictComment(v, headSha) },
          });
        }
        // passed && !found → stay silent; the green Check Run is the verdict.
      } catch (err) {
        console.error(
          "[shipmate] verdict comment upsert failed:",
          err instanceof Error ? err.message : err,
        );
      }
    },

    // Reply delivery (REPLACES the channel's built-in message.completed, which
    // would auto-post the agent's reply as a PR comment).
    //
    // - Auto-review turns (no triggering comment): SUPPRESS the reply entirely.
    //   The verdict lives in the Check Run + sticky comment above; the model's
    //   prose would just be a duplicate/chatty third surface.
    // - Interactive @mention turns (a real triggering comment, or a review thread):
    //   PRESERVE the default behavior — post the reply into the thread.
    "message.completed": async (data, channel) => {
      const st = channel.state;
      const isAutoReview =
        st.triggeringCommentId == null && st.conversationKind !== "review_thread";
      if (isAutoReview) return; // verdict surfaces are owned by action.result
      const text = data.message;
      if (text && text.trim()) await channel.thread.post(text);
    },
  },
});
