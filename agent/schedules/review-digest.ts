import { defineSchedule } from "eve/schedules";
import slack from "../channels/slack.js";

/**
 * Proactive weekday digest pushed to a Slack channel: open PRs awaiting review
 * and tickets needing attention, presented so the team can act in seconds.
 *
 * Runs as the app principal (eve:app), so it uses the **app-scoped** connections —
 * `github__*` (app-scoped Connect) and `tickets__*` (token). It does NOT use
 * Linear: `linear__*` is user-scoped and this run has no user principal, so a
 * Linear call would fail `principal_required`.
 *
 * Delivery target is a Slack channel id in SLACK_DIGEST_CHANNEL (e.g. C0123ABC).
 * If unset, the schedule no-ops — safe to deploy before the channel is chosen.
 *
 * `cron` is evaluated in UTC: "0 9 * * 1-5" = 09:00 UTC, Mon–Fri.
 * Grounding: docs/schedules.mdx:64-72 (run/receive/waitUntil/appAuth),
 * docs/channels/slack.mdx:116 (proactive target shape `{ channelId }`).
 */
const DIGEST = [
  "Build the team's morning work digest and post it to this Slack channel.",
  "Use `github__*` for open pull requests that need review, and `tickets__*` for",
  "tickets in triage or in progress. Do NOT use the Linear tools — this scheduled",
  "run has no user principal, so Linear is unavailable.",
  "",
  "Present it per the 'Working issues in Slack' rules: a one-line summary, then",
  "group as *Needs review* / *In progress* / *Untriaged*; one item per line with",
  "its id, a short title, owner, and a link. Keep it tight and scannable.",
  "",
  "If there is nothing worth flagging (no open PRs and no triage/in-progress",
  "tickets), do not post anything.",
].join("\n");

export default defineSchedule({
  cron: "0 9 * * 1-5",
  run({ receive, waitUntil, appAuth }) {
    const channelId = process.env.SLACK_DIGEST_CHANNEL;
    if (!channelId) return; // no target configured → no-op (safe)
    waitUntil(
      receive(slack, {
        auth: appAuth,
        message: DIGEST,
        target: { channelId },
      }),
    );
  },
});
