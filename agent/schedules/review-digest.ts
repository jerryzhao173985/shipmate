import { defineSchedule } from "eve/schedules";
import slack from "../channels/slack.js";

/**
 * Proactive weekday digest pushed to a Slack channel: open PRs awaiting review
 * and tickets needing attention, presented so the team can act in seconds.
 *
 * Runs as the app principal (eve:app), so it uses the **app-scoped** connections —
 * `github__*` (app-scoped Connect) and `tickets__*` (token). It does NOT use
 * Linear: `linear__*` is user-scoped and this run has no user principal.
 *
 * Config (read at fire time):
 *   SLACK_DIGEST_CHANNEL  (required) Slack channel id to post to; unset → no-op.
 *   SHIPMATE_GITHUB_SCOPE (optional) a GitHub search qualifier that bounds the PR
 *     search to the team's repos/org, e.g. "org:my-team" or
 *     "repo:owner/name" or "review-requested:@me". WITHOUT it the digest does NOT
 *     search GitHub (a global search returns the whole world's PRs, which is
 *     useless) — it falls back to a tickets-only digest.
 *
 * `cron` is evaluated in UTC: "0 9 * * 1-5" = 09:00 UTC, Mon–Fri.
 * Grounding: docs/schedules.mdx:64-72 (run/receive/waitUntil/appAuth),
 * docs/channels/slack.mdx:116 (proactive target shape `{ channelId }`).
 */
export default defineSchedule({
  cron: "0 9 * * 1-5",
  run({ receive, waitUntil, appAuth }) {
    const channelId = process.env.SLACK_DIGEST_CHANNEL;
    if (!channelId) return; // no target configured → no-op (safe)

    const scope = process.env.SHIPMATE_GITHUB_SCOPE?.trim();
    const prInstruction = scope
      ? `Use github__* to find OPEN pull requests that need review, bounded to ${scope} — e.g. search \`is:open is:pr ${scope}\` (and prefer those with review requested or no approving review). Never search GitHub globally; only include PRs within ${scope}.`
      : `Do NOT search GitHub for PRs (no SHIPMATE_GITHUB_SCOPE is configured, and a global PR search is meaningless). Skip the PR section and note once that a GitHub scope isn't set.`;

    const message = [
      "Build the team's morning work digest and post it to this Slack channel.",
      prInstruction,
      "Use `tickets__*` for tickets in triage or in progress.",
      "Do NOT use the Linear tools — this scheduled run has no user principal.",
      "",
      "Present per the 'Working issues in Slack' rules: a one-line summary, then",
      "group as *Needs review* / *In progress* / *Untriaged*; one item per line with",
      "its id, a short title, owner, and a link. Keep it tight and scannable.",
      "",
      "If there is genuinely nothing worth flagging, do not post anything.",
    ].join("\n");

    waitUntil(
      receive(slack, { auth: appAuth, message, target: { channelId } }),
    );
  },
});
