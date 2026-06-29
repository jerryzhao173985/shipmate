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
- **No diff context.** The verdict reports *which checks* failed but not *which files the PR
  changed*, so a reader can't tell if a failure is even in the PR's blast radius. → Next Steps #4.

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
- **⚠️ The verdict surface can fail *silently* (the #1 risk).** The Check Run and sticky-comment
  writes are wrapped in `try/catch` that only `console.error`s to Vercel logs
  (`agent/channels/github.ts` ~`:190` and ~`:228`). A transient GitHub error or a token expiry
  then leaves the Required check unpublished — an invisible **deadlock** ("Waiting for status"
  forever) or **bypass** — with the only signal in logs nobody watches. → **Next Steps #1.**
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
- **Coverage gap is logic-vs-behavior (the "no unit tests" gap is closed, 2026-06-29).** The
  deterministic LOGIC core is now unit-tested — **34 model-free `*.test.ts`** run in free CI
  (`npm test` in `ci.yml`): `isWriteOp` (the HITL-gate arbiter), `safeSegment`, the verdict parsers
  (`parseChecks`/`buildVerdict`), `verdictComment`, `sanitizeLinkPhrase`. What free tests still
  can't cover is **behavior** — the connection / sandbox / real-review paths — which only the
  credit-spending live evals exercise (run those deliberately).

---

## 3. Next steps (prioritized — rethought 2026-06-29)

A grounded rethink (all commits + the code + eve's framework + best-practice, with an
adversarial "earns-its-place" critic) reordered this list. The principle for a merge-gating
product: **protecting the gate's integrity beats adding capability**, and the two best additive
moves *reuse what already exists* rather than building new systems. Full reasoning lives in
`docs/journey-and-architecture.md`. (This supersedes the earlier ordering, which had egress
hardening as "#1 next" — that's now a conditional tripwire, see below.)

**Status (2026-06-29): #1, #2, #3 are DONE, verified, and live** (loud gate `00b6461`; correlation
`3446889`; unit tests `36e40ee`/`f6a3c20`/`9704c54`). **#4, #5, and the tripwires remain** — the
detailed how-to is in `docs/implementation-plan-next.md`.

| # | Step | Why it earns its place | Where | When |
|---|------|------------------------|-------|------|
| **1** | **Make verdict-write failures loud, not silent.** On a Check Run or sticky-comment write failure, stop swallowing it: emit a structured `[shipmate:authority-failed]` line, and on Check Run failure post a fallback "couldn't publish the gate" comment (optionally one retry on a 5xx). | The one fragility that hits the pillar everything rests on — a Required check that silently no-ops is an invisible deadlock or bypass (§2). Pure trust defense, not feature creep. **Low / low.** | `agent/channels/github.ts` (the two `catch` sites ~`:190`, `:228`) | **Now** |
| **2** | **Wire correlation into the auto-review.** Chain the existing `correlate` after `review_pr`, resolve candidates via `tickets__*`/`linear__*`, and add ONE bounded "Linked work: ENG-12 (In Progress)" line to the sticky comment + Check Run summary. **Informational, never gating.** | The documented core mission ("correlate across systems") delivered *at the gate* — the capability enterprise reviewers charge for. Every piece exists and is Slack-proven, so it's a wiring job, not a new system. Turns "a CI check that runs tests" into "the agent that ties the PR to its work item." Med / low. | `agent/channels/github.ts` (`onPullRequest` context + `verdictComment`) | Now (after #1) |
| **3** | **Unit-test the deterministic core in free CI.** `isWriteOp`/`WRITE_VERB` (the HITL-gate arbiter), `safeSegment`, the `###CHECK/FLAKY/REF/BASE` parsers, `verdictComment` — model-free `*.test.ts` run in `ci.yml`. | Currently zero unit tests (§2); a regex slip silently mis-gates a write or mis-reports a verdict, and `build`+`typecheck` can't catch it. Highest blast-radius, cheapest guard (no AI-Gateway spend). Med / low. | `*.test.ts` + `ci.yml` | Now / parallel |
| **4** | **Diff-awareness.** `git diff --name-only HEAD^1` (the sandbox already has the merge commit), add `changedFiles` to the Verdict + a *soft* "failure is in / outside the changed area" note. **Soft proximity only — never a confident "this test covers your change".** | Today the verdict has no diff context, so a reader can't tell if a failure is in the PR's blast radius. Makes every line actionable, nearly free. Med / low; scope discipline is load-bearing (overclaiming erodes the honesty posture). | `agent/tools/review_pr.ts` | Soon |
| **5** | **One self-monitoring digest** (optional). Fold gate-health (did a recent webhook turn fail to publish? — pairs with #1) + Shipmate's own review activity (from the `[shipmate:review]` metric line) into a single periodic Slack line. | Proactive **silent-breakage detection**, not analytics — in one surface, not a new channel. Sits just behind #4. | `agent/schedules/` | Soon |

### Tripwires — correct, but build only when the trigger lands (not speculatively)
- **Sandbox egress hardening** (deny-by-default; allowlist npm + `github.com`; block
  `169.254.169.254`/RFC1918; `npm ci --ignore-scripts`) → **the moment you accept public-fork
  PRs.** `agent/sandbox/sandbox.ts`.
- **`merge_group` handling** → **the moment you turn on a GitHub merge queue.**
- **Broaden `review_pr` beyond Node** (pytest/ruff, `go test`/`build`, `cargo`) → **when the
  team actually has a non-Node repo to review.** `agent/tools/review_pr.ts`.

### Not worth doing (decided — say no with confidence)
- **Chatty LLM commentary / one-click auto-fix / whole-repo RAG.** These attack the moat: noise
  is the #1 adoption killer; auto-fix needs re-enabling the deliberately-disabled `bash`/write
  tools (a security regression); RAG competes with the differentiator (running code beats
  reasoning about it).
- **CI-triage via `onCheckSuite`/`onWorkflowRun`.** Re-narrates Actions failures the human can
  already see — a chatty third surface. The correlation move (#2) delivers more from the same turn.
- **Compare-to-base gate-flip** (`failure`→`neutral` for a pure pre-existing failure). Silently
  un-blocks a merge off a heuristic — real risk on the authority surface for marginal gain.
  Enrich the title text at most; don't flip the gate.
- **Cross-PR flake quarantine ledger.** The one-shot retry covers the common single-flake case;
  quarantine needs durable cross-session storage the agent deliberately lacks. Defer until
  flaky-blocking is a *measured* recurring pain.
- A separate correlation / triage **subagent**, **digest templating**, speculative connection
  tool block-lists — premature or already-rejected.

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
