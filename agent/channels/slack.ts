import { connectSlackCredentials } from "@vercel/connect/eve";
import { slackChannel } from "eve/channels/slack";

/**
 * Slack reachability for the ops assistant.
 *
 * Credentials are brokered by Vercel Connect: connectSlackCredentials provisions
 * the bot token and the inbound webhook verifier, so there is no SLACK_BOT_TOKEN
 * or signing secret to manage here. The argument is the registered Connect
 * client UID — keep "slack/ship" in sync with the client you register.
 *
 * threadContext injects only messages since the agent's last reply, so the model
 * gets fresh thread context without re-reading the whole history each turn.
 */
export default slackChannel({
  credentials: connectSlackCredentials("slack/ship"),
  threadContext: { since: "last-agent-reply" },
});
