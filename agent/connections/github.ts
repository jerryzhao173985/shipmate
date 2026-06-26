import { connect } from "@vercel/connect/eve";
import { defineMcpClientConnection } from "eve/connections";
import { writeApproval } from "#lib/write-approval.js";

/**
 * GitHub as a connection (GitHub's hosted remote MCP server).
 *
 * eve discovers GitHub's tools and surfaces them to the model as `github__<tool>`
 * (found via connection_search). The model never sees the URL or any token.
 *
 * Auth is brokered by Vercel Connect (managed OAuth) — app-scoped, so the agent
 * acts as one shared bot identity with no per-user consent flow. The connector
 * UID is `github/ship`; tokens are issued/refreshed by Connect. Verified working
 * against GitHub's hosted MCP server (HTTP 200 handshake).
 *
 * Surface is scoped: a `tools.block` deny-list removes destructive/admin tools the
 * agent must never call (repo lifecycle, merge/branch/file mutations, secrets,
 * workflow dispatch, …). Block (not allow) is chosen deliberately: `allow` is
 * exact-match with no wildcards, so a missed/renamed name would SILENTLY DROP a
 * needed read/comment tool; a deny-list fails safe — a missed dangerous name stays
 * exposed but is still HITL-gated by `writeApproval`. Filtered tools never reach
 * `connection_search`. Read tools and the PR/issue COMMENT tools the review
 * write-back needs (add_issue_comment, add_reply_to_pull_request_comment,
 * add_comment_to_pending_review) are intentionally NOT blocked.
 *
 * Block names grounded in the GitHub MCP server tool list
 * (github.com/github/github-mcp-server). Block fails safe, so over-listing
 * (names that may not exist on the hosted server) is harmless.
 */
export default defineMcpClientConnection({
  url: "https://api.githubcopilot.com/mcp/",
  description:
    "GitHub: search and read issues, pull requests, repositories, and workflow runs; comment on PRs/issues. Destructive/admin operations are not available.",
  auth: connect({ connector: "github/ship", principalType: "app" }),
  // Defense-in-depth deny-list: repo lifecycle, merge/branch/file writes, issue/PR
  // state mutation, gists, stars, notifications, projects, discussions, workflow
  // dispatch, and Copilot-agent side effects. The agent reviews + comments; it
  // never mutates repo or PR/issue state through GitHub.
  tools: {
    block: [
      // PRs: merge / open / mutate / branch
      "merge_pull_request",
      "create_pull_request",
      "update_pull_request",
      "update_pull_request_branch",
      "pull_request_review_write",
      // Repo / files / branches
      "create_or_update_file",
      "delete_file",
      "push_files",
      "create_branch",
      "create_repository",
      "fork_repository",
      // Issues / labels write (state mutation)
      "issue_write",
      "sub_issue_write",
      "label_write",
      // Gists, stars, notifications
      "create_gist",
      "update_gist",
      "star_repository",
      "unstar_repository",
      "dismiss_notification",
      "manage_notification_subscription",
      "manage_repository_notification_subscription",
      "mark_all_notifications_read",
      // Projects, discussions
      "projects_write",
      "discussion_comment_write",
      // Actions / Copilot side effects
      "actions_run_trigger",
      "assign_copilot_to_issue",
      "request_copilot_review",
    ],
  },
  // Writes-only HITL: gates the remaining github__* writes (the comment tools)
  // from an interactive human; reads and the github-webhook auto-review run free.
  // See agent/lib/write-approval.ts.
  approval: writeApproval,
});
