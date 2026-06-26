# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this project is

**`ship`** (internal name) is an **eve agent app** shipped as **Shipmate** (product
name) — a single durable backend AI agent for the team. Its **headline capability is
reviewing pull requests by actually running them**: `review_pr` clones the PR branch in
an isolated sandbox and runs install/lint/build/test, returning a structured verdict —
it never judges a change from the diff alone. Around that core it is also an **operations
assistant** that reads from and acts on three of the team's systems and, crucially,
**correlates across them** (a PR ↔ its ticket ↔ its Linear issue):

- **Ticket Tracker** — the team's own issue tracker, wired from its OpenAPI spec.
- **GitHub** — issues, PRs, repos, workflow runs (hosted MCP server).
- **Linear** — the product issue tracker (hosted MCP server).

The agent is reachable over **Slack** and the built-in **HTTP API**. It is built on
[eve](https://eve.dev) (`eve@0.15.1`), a *filesystem-first* framework for durable
agents: you author files under `agent/`, and eve runs the model loop, persists every
session, and serves HTTP + channel webhooks. Model: `anthropic/claude-sonnet-4.6`
via the Vercel AI Gateway. Deploy target: Vercel.

## Commands

```bash
npm run dev          # eve dev — local dev server + interactive terminal UI (HMR)
npx eve dev --no-ui  # headless/controllable dev server — use this for agent-driven verification
npx eve dev <url>    # drive a remote deployment (preview/prod smoke test) instead of booting local
npm run build        # eve build — compile .eve/ artifacts + build .output/ host bundle
npm run start        # eve start — serve the built .output/
npm run typecheck    # tsc (noEmit) — also the project's "build" check

npx eve info         # print discovered tools/connections/channels/routes + discovery diagnostics
npx eve eval         # run ALL evals (boots a local server, runs against the live model)
npx eve eval tickets-triage   # run ONE eval by id (exact id, or a directory prefix)
npx eve eval --list           # list discovered evals without running
npx eve eval --strict --junit .eve/junit.xml   # CI invocation
npx eve eval --url <deployed-url>              # run evals against a deployment

npx eve link         # link to a Vercel project + pull AI Gateway creds into .env.local
npx eve deploy       # deploy to Vercel production
npx eve channels add slack|web   # scaffold a new channel
```

**Typecheck note:** `tsconfig.json` includes `.eve/**/*.d.ts` (generated types). Run
`eve build` or `eve dev` at least once so `.eve/` exists before `tsc` resolves cleanly.

## Architecture: the directory *is* the wiring

eve discovers capabilities by **file location** — there is no central registry and no
import-graph to trace. A file's path gives it its name and role. The entire authored
surface lives under `agent/`:

| Path | Role | Notes |
| --- | --- | --- |
| `agent/agent.ts` | Runtime config | Just `defineAgent({ model })`. Minimal by design. |
| `agent/instructions.md` | **System prompt = the product** | The behavioral contract: how to triage, when to confirm, how to interpret Linear scope, the no-self-reply rule. **Most product logic lives here, not in code** — treat edits as product changes. |
| `agent/channels/eve.ts` | Built-in HTTP channel | Routes `POST /eve/v1/session`, `POST /eve/v1/session/:id`, `GET /eve/v1/session/:id/stream`. Auth stack: `localDev()` + `vercelOidc()` + `placeholderAuth()`. |
| `agent/channels/slack.ts` | Slack channel | Route `POST /eve/v1/slack`. Credentials brokered by Vercel Connect (`connectSlackCredentials("slack/ship")`) — no bot token/signing secret in code. `threadContext: since last-agent-reply`. |
| `agent/connections/tickets.ts` | OpenAPI connection → `tickets__*` tools | eve fetches the spec at boot and generates one tool per operation (`tickets__listIssues`, `tickets__createIssue`, `tickets__transitionIssue`, `tickets__bulkUpdateIssues`, `tickets__getWorkflow`, …). Auth: `TICKET_TRACKER_TOKEN` bearer, injected per call. |
| `agent/connections/github.ts` | MCP connection → `github__*` tools | Vercel Connect, **app-scoped** (`principalType: "app"`, connector `github/ship`). Acts as one shared bot identity — no per-user consent. |
| `agent/connections/linear.ts` | MCP connection → `linear__*` tools | Vercel Connect, **user-scoped** (`connect("linear/ship")` defaults to user). Acts as the *requesting* user; needs a user principal on the session. |
| `agent/tools/review_pr.ts` | Typed `defineTool` → `review_pr` | **Headline tool** (the real `defineTool` example). Clones a PR branch in the sandbox via `ctx.getSandbox()`, runs install/lint/build/test, returns `{ passed, ranChecks, failingChecks, checks, summary }`. Read-only (no GitHub writes). Public repos only in v0. Shell-injection-safe; honest `ranChecks:false` when no real backend can run. |
| sandbox (default, no file) | Isolated `/workspace` bash env | No `agent/sandbox.ts` needed — `review_pr` uses the **default** backend via `ctx.getSandbox()`: `vercel()` in prod (`process.env.VERCEL`), **microsandbox** locally (devDep), else Docker, else just-bash (no real git/network → `ranChecks:false`). **Verified locally 2026-06-26:** microsandbox ran `slugify#30` end-to-end → `ranChecks:true`, `failingChecks:["test"]`. First run pulls a libkrunfw VM image (~minutes); a real review during `eve eval` is therefore slow, which is why `review`'s failing-check assertion stays soft. |
| `evals/*.eval.ts` | Deterministic regression guards | `defineEval` with assertions; no LLM judge (`evals.config.ts` is `{}`). `tickets-triage`, `github-identity`, `linear-smoke` (graceful degradation without a user principal), `review` (review_pr smoke). |

### Connections vs. tools (the key abstraction)

- A **connection** (MCP or OpenAPI) auto-generates *many* `<name>__<operation>` tools,
  discovered by the model at runtime via the built-in `connection_search` tool. Prefer
  a connection whenever the service publishes an OpenAPI doc or an MCP server.
- A **tool** (`defineTool`) is one typed function you hand-write. The filename (snake_case)
  becomes the tool name the model sees.
- In both cases **the model never sees URLs or tokens** — eve injects auth and resolves
  endpoints. Tool results must be *minimized*: never return raw upstream payloads or
  credentials back to the model.

### Authoring conventions (when adding a tool / connection / channel)

- **Path *is* identity — never write a `name`/`id` field.** eve rejects an authored name at
  compile *and* runtime; the filename is the name (`tools/review_pr.ts` → tool `review_pr`;
  `connections/github.ts` → `github__*`). Discovery manifest entries key on
  `sourceKind`/`logicalPath`, not name/slug.
- **Imports use the `#*` map + NodeNext `.js` extensions.** Import siblings as `#tools/…`,
  `#connections/…`, `#evals/…` (see `package.json` `imports`); under NodeNext + strict,
  relative imports need the `.js` suffix (`../lib/foo.js`) even though the file is `.ts`.
- **`agent/lib/` is import-only** — never mounted into the sandbox `/workspace`. Put shared
  helpers there; never reference `lib/` paths from sandbox commands.
- **Verification gate before any commit/deploy:** `eve info` (Compile ready, 0 errors/0
  warnings) → `npm run typecheck` (tsc exit 0) → `npm run build` → then drive a **real turn**
  (locally `eve dev --no-ui`, or `eve eval --url <prod>`). A green compile never proves auth.

### Auth model is deliberately asymmetric (do not "fix" this)

This is the single most important non-obvious constraint:

- **GitHub = app-scoped** → one shared bot identity, no user consent flow.
- **Linear = user-scoped** → the agent acts *as the requesting person*. Linear's Connect
  connector is custom-OAuth/user-delegated, so an app/bot identity is **impossible**.
  The first Linear request from a user triggers a one-time sign-in link.
- Consequence: **Linear requires a user principal on the session.** Slack attaches the
  sender as a user principal, so Linear works there. Sessions *without* a user — local
  `eve dev`, evals, the `placeholderAuth()` HTTP route — fail Linear with
  `principal_required`. **This is expected, not a bug.** It's why the data-reading evals
  cover Tickets + GitHub; Linear has only a `linear-smoke` eval that asserts *graceful
  degradation* (the agent reports the sign-in need, doesn't crash), never Linear data.

### Cross-system correlation (the multiplier: `review_pr` × the connections)

The product value is the *join*: `review_pr` runs a PR; the connections say what that PR
is *for*. This flow is **instruction-driven, not a new tool** (it chains tools the model
already has — keep it that way unless a step proves unreliable):

1. `review_pr(prUrl)` → structured verdict (`passed` / `ranChecks` / `failingChecks`).
2. `github__*` → read the PR's title/body/branch for a linked **ticket** (`ENG-12`) or
   **Linear** id (`JER-12`).
3. `tickets__*` / `linear__*` → fetch that work item; report the verdict *in context*.
4. **Write-back is confirm-first:** posting a PR comment, or moving the ticket/Linear
   issue (→ "In Review" on pass, back to "In Progress" on fail), happens only after the
   user agrees. **Never** mutate tracker state off a `ranChecks:false` (couldn't-run) verdict.

The behavioral contract for this lives in `agent/instructions.md` → *"Put the review in
context"*. See `memory/shipmate-review-pr.md` (review/sandbox) and
`memory/ship-auth-architecture.md` (connection auth) for the two sub-systems this joins.

### Working lanes (parallel sessions — keep these separate)

To let two sessions develop without clobbering each other:

- **Shipmate / PR-review lane:** `agent/tools/review_pr.ts`, the sandbox backend, the
  `review` eval, and the PR-review sections of `instructions.md`.
- **Foundation / connections lane:** `agent/connections/*`, `agent/channels/*`, the
  tickets/github/linear/correlation behavior, and their evals.
- **Shared (edit surgically, announce intent in commits):** `instructions.md` (the
  product), `CLAUDE.md` (this file), `package.json`. Prefer additive, clearly-scoped edits.

### Other constraints worth knowing

- **`placeholderAuth()`** blocks browser requests in production — replace it with a real
  auth provider (Auth.js/Clerk) or `none()` before exposing a browser UI.
- **Human-in-the-loop / approvals:** **nothing is approval-gated today** — there are no
  `approval:` fields on any tool or connection, so reads and writes run autonomously. The
  instructions enforce *"state consequential writes before doing them"* (and *"confirm
  before posting a review back"*) in prose rather than a hard gate. If you want a real
  gate: a connection-level `approval: always()` gates *every* operation (reads included),
  so to gate writes only, split into a read + a write connection (see the commented
  guidance in `connections/tickets.ts`), or put the write behind a dedicated `defineTool`
  with `approval: always()`.
- **No self-reply tool:** instructions forbid the agent from posting its own reply through
  any tool — Slack/HTTP deliver the response automatically. Don't add a "send message" tool.
- **Durability:** sessions are crash-safe/resumable (Workflow SDK underneath). Two ids
  matter — `continuationToken` (post the next user message) and `sessionId` (stream/inspect).

## Development history & rejected approaches (do NOT re-walk these)

The committed arc is 9 commits (`eddfda1` scaffold → `6a013df`); the Shipmate/`review_pr`
layer sits on top as (currently uncommitted) working-tree state. The build cost real hours on
auth and sandbox dead-ends — each settled by a **live API call or a real sandbox run, not a
typecheck**. Avoid re-attempting:

| Dead-end | Why it was abandoned |
| --- | --- |
| **`post_slack_message` self-reply tool** | The Slack channel auto-posts the agent's reply, so a send-tool caused a spurious approval prompt on every message *and* a "missing `SLACK_BOT_TOKEN`" error (Slack auth is Connect, not a bot-token env). Deleted before it was ever committed. |
| **Linear MCP with a personal API key** | `mcp.linear.app/mcp` + a `lin_api_*` key → `401 invalid_token`; Linear MCP is OAuth-only. (`/sse` 404s; the live path is `/mcp`.) |
| **Linear GraphQL with a `Bearer` prefix** | Linear's GraphQL API rejects `Bearer` ("Remove the Bearer prefix") and needs a **raw** `Authorization` header — the opposite of GitHub MCP, which *requires* `Bearer`. |
| **Hand-written Linear GraphQL tools** (`agent/lib/linear.ts` + `linear_search_issues`/`get_issue`/`create_issue`/`create_issues`/`update_issue`) | Built and verified read+write+bulk against the live workspace (`935ac0a`/`7e3713d`), then **retired at `dca998e`** for user-scoped Connect MCP (full toolset + per-user attribution). **Kept in git at `7e3713d` for rollback.** |
| **Linear app-scoped Vercel Connect** (`principalType:'app'`) | *Architecturally impossible.* Linear's connector is Custom OAuth (`type:'oauth'`, `service:'mcp.linear.app'`) — user-delegated, no app identity. Returns `app_not_installed` (`retryable:false`); even after a user authorizes, that flow mints a *user*-subject token, never `app`. Only managed connectors (Slack, GitHub, Snowflake, Salesforce) can issue an app token. **Do not re-investigate.** |
| **`evals/linear-list.eval.ts`** | Passed against the key-based tools; removed at `dca998e` (user-scoped Connect can't run without a user principal). Replaced by `linear-smoke`. |
| **Inline `bash -c "<script>"` in `review_pr`** | The *host* shell collapsed newlines and pre-expanded `$WORK`/`$?` (→ `rm -rf ""`, `syntax error near then`). Replaced by `sandbox.writeTextFile("review_pr.sh", …)` + `sandbox.run("bash review_pr.sh")` (`review_pr.ts:124-129`), deferring all expansion to the sandbox shell. **Reuse this write-file-then-run pattern for any sandbox script.** |

**Why an eval suite exists at all — static checks lie about auth.** `eve info`, `typecheck`,
and `build` all pass for a connection that *cannot authenticate*: discovery validates a
connection's *shape*, not its credentials. Every auth dead-end above was caught only by
driving a real turn against the live integration. Never claim a connection works because it
compiles — exercise it.

## Verified facts & deployment

> **What's deployed ≠ the working tree.** Production runs **git `HEAD` (`6a013df`, the
> ops-assistant era)** — the **Shipmate / `review_pr` layer is uncommitted working-tree state,
> NOT committed or deployed.** So `review_pr` does **not** run in prod yet; the live agent is
> still the tickets/GitHub/Linear ops assistant. Commit + `vercel deploy --prod` to ship it.
> (Prod `/eve/v1/info` returns empty anonymously — that's `vercelOidc()` protection working,
> not an outage.)

| Item | Value |
| --- | --- |
| Production (stable alias — point Slack here) | `https://ship-omega-lake.vercel.app` (`/eve/v1/health` → `{"ok":true,"status":"ready"}`, live) |
| Per-deploy URLs | Deployment-protection gated (302), change every deploy — never use for Slack. |
| GitHub MCP server | `https://api.githubcopilot.com/mcp/` (verified 200 handshake) |
| Linear MCP endpoint | `https://mcp.linear.app/mcp` (`/sse` 404s) |
| Ticket Tracker OpenAPI | `https://tickettracker-chi.vercel.app/openapi.json` — **46 operations → 46 `tickets__*` tools** (verified live). Hono on Vercel Fluid Compute; **in-memory/ephemeral — re-seeds on cold start**, so issues the bot creates here may not persist (Linear/GitHub writes are durable). `/`, `/health`, `/openapi.json`, `/ui` are public; every `/v1` route needs the bearer. |
| Connectors (Connect UIDs) | `slack/ship`, `github/ship` (app-scoped, works), `linear/ship` (user-scoped) |
| `github-identity` eval known-good | login `jerryzhao173985` → id **`44931279`** |
| `review` eval fixture PR | `https://github.com/sindresorhus/slugify/pull/30` |
| Linear team | `JER` |
| Key deps | `eve@^0.15.1`, `@vercel/connect@0.2.2`, `microsandbox@^0.5.10` (dev), `ai@^7`, `zod@4.4.3`, Node `24.x` |

## Working conventions & operational gotchas

Preferences the user has expressed, and traps observed during development:

- **Prefer Vercel Connect over hand-managed tokens** wherever capability allows.
- **First-principles truth over giving up** — prove what's actually true from source/docs
  (this is what settled Linear app-scope). But when a wall is genuine — `MODEL_CALL_FAILED
  403 "Free tier users do not have access to this model"` (AI Gateway free tier) — **stop and
  report**, don't churn; it's a billing/access wall, not a bug.
- **Verify against ground truth, not appearances.** A Slack reply that looked wrong (an issue
  double-grouped under two statuses) was a *rendering* fix in instructions, confirmed against
  the live API — not a guess.
- **Don't commit unless asked; deploy only when explicitly asked.** Commit trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Crash recovery resumes from the last completed step, not a full turn replay** — an
  interrupted step *re-runs*, so any non-idempotent external write must be idempotent or
  stated/confirmed first.
- **Eval API:** use `t.succeeded()`, not `t.completed()` (the latter appears in some docs and
  throws TS2339). `eve eval` won't boot a second server while one runs → use
  `eve eval --url <running-server>`; run against prod with
  `eve eval --url https://ship-omega-lake.vercel.app`.
- **Background verification:** never bare `eve dev` (it opens the REPL) — use `eve dev --no-ui`
  and parse stdout for the ready URL. It builds for **~2.5 min** before printing
  `[DEV] server listening at http://127.0.0.1:2000/`; `pkill`'ing it exits 143/144 (expected
  SIGTERM), and a `curl --max-time` timeout (exit 28) on `/stream` is the timeout, not a turn
  failure. Boot sequence per turn: `session.started → turn.started → message.appended →
  message.completed → turn.completed → session.waiting`.
- **Linear `issueDelete` is a soft delete to trash (~30 days), and `includeArchived:true`
  queries STILL return trashed items** — confirm a removal via the `trashed` field, not by
  re-listing with `includeArchived`. (The auto-mode classifier also blocks destructive
  external writes like deletes when the user only asked for a read — get explicit consent.)
- **`vercel connect attach <conn> -e production` REPLACES the env set** (drops dev+preview),
  breaking local token resolution — re-attach to all environments to restore local dev.

## Environment

`.env.local` (gitignored) holds: `VERCEL_OIDC_TOKEN` (AI Gateway credential + powers the
`vercelOidc()` channel auth), `TICKET_TRACKER_TOKEN` (read directly by the tickets
connection). GitHub and Linear tokens are **brokered by Vercel Connect**, not read from
env. Optional overrides: `TICKET_TRACKER_OPENAPI_URL`, `TICKET_TRACKER_BASE_URL`. The
model needs an AI Gateway credential (`VERCEL_OIDC_TOKEN` from `eve link`, or
`AI_GATEWAY_API_KEY`). `GITHUB_TOKEN` / `LINEAR_API_KEY` may still exist in the Vercel env
but are now **unused** (GitHub + Linear authenticate via Vercel Connect) — safe to remove.

## Reference

eve's full docs are bundled in the installed package at **`node_modules/eve/docs/`**
(README → introduction → getting-started → reference/ → concepts/ → channels/ →
connections/ → evals/). Read the relevant guide there before extending an agent surface.
Generated, gitignored dirs: `.eve/` (compiled artifacts, types, eval results),
`.output/` (built host bundle), `.vercel/`.
