# Shipmate — Limitations & Next Steps

A plain-language map of **what Shipmate can and can't do today**, **what to do next** (and
when it's worth doing), and the **operational lessons** that cost real time to learn — so the
next change doesn't re-trip on them.

Status at time of writing: Authority + Trust are **live in production and behavior-proven**;
Pillar 3 **observability** (one structured metric line per review) is **shipped** (deployed +
typecheck/CI-clean, not yet behavior-confirmed — it emits on the next real review).
Production: `https://ship-omega-lake.vercel.app` · deploys from `main` (Vercel git auto-deploy).

---

## 1. What works today

- **Reviews PRs by running them.** `review_pr` clones the PR in an isolated sandbox and runs
  the project's `lint → build → typecheck → test` (only the scripts it actually defines),
  reviewing the **merge result** (`pull/N/merge`, falling back to the PR head on conflict).
- **Authority.** The verdict is published as a GitHub **Check Run** ("Shipmate Review") keyed
  on the PR head SHA. It's a **Required Status Check** on `main`, so a `failure` **blocks the
  merge**. Couldn't-run → `neutral` (non-blocking).
- **Trust.** One **sticky verdict comment** (no duplicates); **flaky** tests are retried once
  (a transient failure doesn't block); **pre-existing** failures (already broken on the base)
  are flagged as "not this PR's fault".
- **Context.** Correlates a PR with its ticket / Linear issue (`correlate` + the connections),
  remembers links across a conversation (`remember_link` / `recall_links`).
- **Reach.** Slack (live), the GitHub App auto-review (`ship-eve`), an HTTP API, and a weekday
  Slack digest.
- **Safety.** External writes (GitHub/Linear) pause for human approval; the internal ticket
  tracker is trusted but its irreversible *delete* ops are blocked; `bash` and `web_fetch` are
  disabled for the model; untrusted PR code runs only in the sandbox.
- **CI/CD.** Every push: free checks (`eve build` + `tsc`) always; the connection-independent
  eval subset (`--tag ci`, strict + JUnit) when the `AI_GATEWAY_API_KEY` secret is set. Push to
  `main` auto-deploys.

---

## 2. Limitations (known and honest)

### Scope of review
- **Node projects only.** `review_pr` keys off `package.json` + npm scripts. A repo with no
  `package.json` (Python/Go/Rust/…) returns `ranChecks:false` → "couldn't run", **never** a
  false pass/fail. → see Next Steps #2.
- **`test`-only flaky retry.** Only `test` is re-run once on failure (never on a timeout, exit
  124). `lint/build/typecheck` are treated as deterministic and are **not** retried.
- **Compare-to-base is informational.** A pre-existing failure (failing on the PR *and* the
  base) is **flagged but still blocks** (the Check Run is still `failure`); a human decides with
  the context. It does **not** silently un-block. → see Next Steps #4.
- **Big repos can time out.** Budgets: clone 120 s, install/each-check 420 s, overall 20 min,
  plus base-compare up to 6 min. A very large/slow suite that exceeds the budget reports
  `couldn't run` (honest, not a false verdict).

### Security / sandbox
- **Egress is allow-all (`"*": []`).** Untrusted PR code in the sandbox can reach any host and
  npm `postinstall` scripts run. **Acceptable while PRs come only from your own org**; it
  becomes a real risk the moment you accept **public-fork** PRs. → **Next Steps #1 (do this
  first if you open to forks).**
- **Private repos need a brokered token.** A private clone works only when
  `SHIPMATE_GITHUB_TOKEN` is set (injected at the Vercel Sandbox firewall, never in a command).
  Without it, a private PR → `couldn't run`.

### Integrations
- **GitHub auto-review depends on the App webhook secret matching.** The channel runs on a
  classic GitHub App webhook (`ship-eve`). If Vercel `GITHUB_WEBHOOK_SECRET` ≠ the App's webhook
  secret, **every** delivery silently fails signature verification (HTTP 401) and nothing fires.
  The Vercel-Connect webhook path is **dormant** (Connect doesn't forward GitHub webhooks). See
  Operational Lessons.
- **Linear is asymmetric.** Reads act *as the requesting Slack user* (user-scoped Connect);
  writes go through key-based GraphQL tools (operator fallback). There is **no app-scoped
  Linear** (architecturally impossible). A user must **re-authorize once** for write scope; a
  Linear request without a user principal (local dev, evals, HTTP placeholder) fails
  `principal_required` — that's expected, not a bug.
- **Ticket tracker is ephemeral.** It's in-memory and re-seeds on cold start, so bot-created
  issues may not persist.

### Operational
- **Memory is conversation-scoped** (`defineState`) — it does not persist across sessions.
- **Review metrics are log-only.** Each review emits one structured `[shipmate:review] {…}`
  line (outcome, flaky, pre-existing, latency). There is **no aggregation/dashboard** yet. →
  see Next Steps #3.
- **CI eval tier costs AI-Gateway credit** (gated on the secret + path-filtered to
  `agent/**`, `evals/**`, deps). The **connection / sandbox / real-review** evals are **not**
  in CI — verify those against the live deployment (`eve eval --url <prod>`), which spends
  credit, so do it deliberately.
- **Admins can bypass the gate.** Branch protection uses `enforce_admins:false` (a deliberate
  emergency override) — the repo owner can merge a red PR.

---

## 3. Next steps (prioritized — do the top one only when it matters)

| # | Step | Why / when | Where |
|---|------|------------|-------|
| **1** | **Sandbox egress hardening** (Pillar 3) | **Do before accepting public-fork PRs.** Deny-by-default egress; allowlist the npm registry + `github.com`; block cloud-metadata (`169.254.169.254`) and RFC1918; `npm ci --ignore-scripts`. Low urgency while PRs are owner-only. | `agent/sandbox/sandbox.ts` |
| **2** | **Broaden `review_pr` beyond Node** | Only if the team has Python/Go/Rust repos to review. Detect project type and run language-appropriate checks (pytest/ruff, `go test`/`build`, `cargo`). | `agent/tools/review_pr.ts` |
| **3** | **Aggregate review metrics** | The per-review log line exists; turn it into rates + latency over time (a small periodic digest, or ship logs to an OTel/analytics sink). Lets you defend the spend and notice silent breakage. | new schedule / external sink |
| **4** | **Optional: compare-to-base gate-flip** | If you want a *pure* pre-existing failure to **not** block (Check Run `neutral` instead of `failure`). Only after behavior-testing the gate change on a real PR — it changes merge behavior. | `review_pr.ts` + `agent/channels/github.ts` |
| **5** | **Optional / lower value** | Linear Connect-write (only if Connect ever mints write tokens — then retire the key-based fallback); a dedicated review/triage subagent; richer verdict output for programmatic callers. | — |

**Not worth doing** (decided): a separate correlation subagent (the model chains the tools
reliably), speculative connection tool block-lists, a configurable digest-templating system.

---

## 4. Operational lessons (so future work doesn't re-trip)

- **A 401 from eve's GitHub verifier == webhook-secret mismatch.** It means GitHub *delivered*
  but `HMAC-SHA256(body, GITHUB_WEBHOOK_SECRET)` ≠ GitHub's signature. Fix: put **one identical
  value** in both the App's Webhook → Secret **and** Vercel `GITHUB_WEBHOOK_SECRET` (use the
  dashboards — pasting adds no trailing newline, which `echo`/CLI do), then **redeploy**. The
  decisive diagnostic is the App's **Settings → Advanced → Recent Deliveries** (response code:
  401 = secret; 404 = wrong URL; 2xx = it ran). (A wrong URL returns 404 — so a 401 proves the
  URL is right and only the secret is off.)
- **Env changes need a redeploy.** Setting a Vercel env var does **not** affect the running
  deployment until you redeploy (push to `main`, or redeploy in the dashboard).
- **`eve deploy` overwrites `.env.local`** by pulling the development env, and a *sensitive*
  prod secret pulls back **empty** (works server-side only). After a deploy, re-paste any local
  token (e.g. `TICKET_TRACKER_TOKEN`) or local connection evals will 401.
- **Verify against the installed `node_modules/eve`** — the framework's installed version wins
  over docs/memory (real API drift exists between minor versions).
- **Don't run evals locally to "test"** — they spend AI-Gateway credit. Use the structural
  gates (`eve info`, `tsc`, `eve build`, `bash -n` for sandbox scripts) plus CI's `--tag ci`
  subset; reserve a real `eve eval --url <prod>` or a targeted smoke PR for when you genuinely
  need behavior proof.
- **Prod URL note.** Use the **stable alias** `ship-omega-lake.vercel.app`; per-deploy URLs are
  protection-gated (302) and change every deploy. `/eve/v1/info` returning 401 anonymously is
  OIDC protection working, not an outage; `/eve/v1/health` is the public liveness check.
- **A GitHub App's "Pull request" *event* is separate from its `pull_requests` *permission*.**
  The permission grants API access; the event subscription is what makes GitHub actually *send*
  the webhook. So a third inbound-failure mode (besides the 401/404 above): **Recent Deliveries
  empty** → the event isn't subscribed (or the webhook is off). The URL must be **exactly**
  `…/eve/v1/github` (a bare `…/eve/v1` 404s). From the GitHub side, a `ship-eve` **check-suite
  stuck `queued` with 0 runs and no bot comment** means the inbound webhook never produced a
  turn — install + Checks access are fine, so look at events / URL / secret.
- **The GitHub channel auto-posts the agent's reply as a comment** (built-in `message.completed`,
  exactly like Slack) — so the auto-review must **not** also post a verdict through a tool, or it
  double-posts. Verdict surfaces are owned by deterministic channel code (`agent/channels/github.ts`):
  the Check Run + **one** sticky `<!-- shipmate-review -->` comment; the `message.completed`
  override suppresses the auto-review's own reply and preserves interactive @mention replies.
- **Multiple sessions/operators edit this repo in parallel.** Re-check `git status` (and
  `git log -- <file>`) before editing a hot file like `review_pr.ts`, build on the *committed*
  state, and commit small increments — that's how flaky-retry, base-compare, and observability
  landed without collisions (the editor's file-modified guard caught the one near-miss).

---

## 5. Before anything ships (verification gate)

`eve info` (Compile ready, 0/0) → `npm run typecheck` (tsc exit 0) → `npm run build` →
**drive a real turn or a targeted smoke** → commit `agent/**` → push (`main` auto-deploys) →
confirm prod (`/eve/v1/health` 200) — **a green compile never proves auth or behavior.**
