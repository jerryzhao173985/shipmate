# Shipmate — Journey & Architecture (wrap-up for future sessions)

This is the **"how we got here + how it actually works"** reference. It complements the other
docs — read them together:

- **`CLAUDE.md`** — the working rules + the authoritative architecture tables + the
  "rejected approaches" table. Start there for *how to work on this repo*.
- **`docs/limitations-and-next-steps.md`** — what's not done + what to do next.
- **This file** — the narrative of what was built, the load-bearing decisions, and the key
  code, so a fresh session understands the whole picture quickly.

> One-line: **Shipmate (internal name `ship`)** is an [eve](https://eve.dev) durable agent on
> Vercel that **reviews PRs by actually running them** in a sandbox and publishes an
> *authoritative, merge-gating* verdict on GitHub — plus a Slack ops assistant that correlates
> a PR ↔ its ticket ↔ its Linear issue. Live at `https://ship-omega-lake.vercel.app`.

---

## 1. The journey, in phases (with the commits)

The repo was built bottom-up: an ops-assistant foundation first, then the headline PR-review
capability, then made real on GitHub, then hardened, then made *authoritative* and *trustworthy*.

### Phase 0 — Foundation: an ops assistant
Connections to the team's systems, discovered by file location (no central registry):
`tickets` (OpenAPI), `github` (MCP, app-scoped Connect), `linear` (MCP, user-scoped Connect),
plus the Slack channel. Slack-native presentation + queue/triage views.
*Commits:* `dca998e`, `95af3e3`, `6a013df`, `f9fdde1`, `7e3713d`.

### Phase 1 — Shipmate is born: `review_pr`
The headline tool: clone a PR in `ctx.getSandbox()`, run `install → lint → build → typecheck →
test`, return a structured `Verdict` with the **`ranChecks` honesty contract** (couldn't-run is
never reported as pass/fail). Sandbox: `vercel()` in prod, microsandbox locally.
*Commits:* `99c3fe4` (review_pr + correlation), `3068dd8` (timeouts, typecheck, private-repo
brokering), `eb576bf` (disable git credential prompts), `e6f0950` (review the **merge** result).

### Phase 2 — Real on GitHub + CI/CD
Pushed to `github.com/jerryzhao173985/shipmate` (public); wired CI (free checks always +
gated eval tier) and Vercel git auto-deploy (push to `main` → prod).
*Commits:* `bc06825` (README), `427ade1` / `16bd6b4` / `3e9f9ef` (CI), `917b46a` (CI split).

### Phase 3 — Hardening & capability (the "N/X" roadmap)
- **N1** writes-only HITL gate (`76b1b44`) — see §3.4.
- **X1** cross-turn memory via `defineState` (`c46f3a6`).
- **X2** deterministic correlation join-key extractor `correlate` (`d8c52bb`).
- **X3** idempotent, gated review write-back (`69c1321`, `b4bb6dc`).
- **X4/X5** connection tool-scoping + Slack Linear sign-in; **internal tracker trusted**, with
  irreversible deletes blocked to close a prompt-injection vector (`2dda134`, `45e20d3`).
- Tool surface hardened: `bash` + `web_fetch` disabled for the model (`105fb60`).
- Structured verdict output for programmatic callers (`a932964`); `npm run ci` gate (`04460a8`).
- Linear write path settled (key-based GraphQL; see §4 dead-ends): `3a4c1af`, `3c34825`,
  `917b46a` (OAuth scope fix).

### Phase 4 — Pillar 1: AUTHORITY (the Check Run)
Turn the verdict into a GitHub **Check Run** keyed on the PR head SHA → a **Required Status
Check** → a failing review **blocks the merge**. Activated by switching the github channel from
the dormant Vercel-Connect path to a classic **GitHub App webhook** (`ship-eve`).
*Commits:* `e0d59d3` (Check Run handler), `2d017f1` (App-webhook activation), `faf16da`
(build-before-typecheck so self-review passes), `b9faeff` (auto-review on synchronize/reopened).
**The blocker that cost the most:** the webhook 401'd every delivery — a **webhook-secret
mismatch** (see §4). Once fixed, the first real end-to-end auto-review fired and the check was
made a Required Status Check.

### Phase 5 — Pillar 2: TRUST (behavior-proven)
A merge-gating bot must not erode trust:
- **One sticky comment** — the channel's default `message.completed` *also* auto-posted the
  reply, double-posting alongside the agent's explicit comment. Fixed by making the verdict
  **code-owned** and suppressing the auto-reply on auto-review turns (`8c0a21d`). §3.2.
- **Flaky resilience** — a failing `test` is retried once; a transient pass-on-retry doesn't
  block (`2782e04`). §3.3.
- **Compare-to-base** — failures are re-run on the base; pre-existing breakage is flagged, not
  blamed on the PR (`444f262`). §3.3.
- **Behavior-proven in prod** on throwaway PRs #3 (flaky → success + "flaky", no block) and #4
  (failure → "also failing on base — pre-existing"). Closed PR records remain as the proof trail.

### Phase 6 — Pillar 3 (started) + docs
Observability: one structured `[shipmate:review] {…}` metric line per review (`e14d71b`).
Egress hardening (the bigger half of Pillar 3) is still open. Reference docs added (`dbeff3b`).

---

## 2. Architecture: the directory *is* the wiring

eve discovers capabilities by **file path** — a file's location is its name and role. The whole
authored surface is under `agent/`:

```
agent/
  agent.ts              defineAgent({ model: "anthropic/claude-sonnet-4.6" })
  instructions.md       the system prompt = the product (most logic lives here)
  channels/
    slack.ts            Slack (live) — Connect-brokered
    github.ts           GitHub App webhook — auto-review + BOTH verdict surfaces (§3.1, §3.2)
    eve.ts              built-in HTTP/control channel
  connections/
    tickets.ts          OpenAPI → tickets__*  (trusted; deletes blocked)
    github.ts           MCP → github__*       (app-scoped; writeApproval; deny-list)
    linear.ts           MCP → linear__*       (user-scoped reads)
  tools/
    review_pr.ts        HEADLINE: run the PR, return a Verdict (§3.3)
    correlate.ts        deterministic PR↔ticket↔Linear join-key extractor
    remember_link.ts / recall_links.ts   durable per-conversation memory
    linear_create_issue(.s).ts / linear_update_issue.ts   key-based Linear writes
    bash.ts / web_fetch.ts                disableTool() — prompt-injection defense
  lib/
    write-approval.ts   the writes-only HITL policy (§3.4)
    memory.ts           defineState slot for links
    linear.ts           raw-Authorization GraphQL helper
  sandbox/sandbox.ts    vercel() in prod (+ firewall token brokering), defaultBackend() local
  schedules/review-digest.ts            weekday Slack digest (read-only, app principal)
evals/*.eval.ts         deterministic regression guards (4 are tagged "ci")
```

**Two verdict surfaces, owned by code (not the model):** when `review_pr` completes, the github
channel's `action.result` handler publishes (1) the **Check Run** (authority) and (2) **one
sticky comment** (narration). The model's only job is to *run* `review_pr`; posting is the
channel's job. This is the core Pillar-1+2 design.

---

## 3. Key mechanisms (with code)

### 3.1 Verdict → Check Run (authority), idempotent — `agent/channels/github.ts`
```ts
// events: { "action.result": async (data, channel) => { ... } }
const v = data.result.output as ReviewVerdict;          // only when toolName === "review_pr"
const conclusion =
  v.ranChecks === false ? "neutral"                     // couldn't run → non-blocking
  : v.passed            ? "success"
  :                       "failure";                     // ran + failed → BLOCKS the merge
// idempotent: GET /commits/{headSha}/check-runs?check_name=Shipmate Review → PATCH it, else POST
```
Mapped so a sandbox hiccup (`neutral`) never blocks every merge, but a real failure does.

### 3.2 One sticky comment + suppress the double-post — `agent/channels/github.ts`
The github channel's *default* `message.completed` posts the agent's reply as a PR comment
(like Slack). Combined with an explicit verdict comment that was a **double-post**. Fix:
```ts
"message.completed": async (data, channel) => {
  const st = channel.state;
  const isAutoReview = st.triggeringCommentId == null && st.conversationKind !== "review_thread";
  if (isAutoReview) return;                 // verdict surfaces are owned by action.result
  if (data.message?.trim()) await channel.thread.post(data.message);  // @mention reply: unchanged
};
```
The sticky comment itself is upserted in `action.result` under a stable `<!-- shipmate-review -->`
marker, and appears **only on fail/couldn't-run** (a clean pass is silent — the green check says it).

### 3.3 `review_pr` — flaky retry + compare-to-base — `agent/tools/review_pr.ts`
Checks run in a sandbox script (write-file-then-`bash`, so all shell expansion is sandbox-side).
**Flaky:** a failing `test` is re-run once (never on a timeout, exit 124):
```sh
for c in lint build typecheck test; do if HAS "$c"; then
  timeout -k 10 420 npm run "$c" >"../$c.log" 2>&1; rc=$?
  if [ "$c" = test ] && [ "$rc" -ne 0 ] && [ "$rc" -ne 124 ]; then
    timeout -k 10 420 npm run test >"../test.log" 2>&1; rc2=$?
    [ "$rc2" -eq 0 ] && echo "###FLAKY test" && rc=0 || rc=$rc2
  fi
  echo "###CHECK $c $rc"; fi; done
```
**Compare-to-base:** a SEPARATE, time-bounded sandbox call *after* the core verdict is captured
(so it can never abort/alter it), re-running the failing checks on the base = the merge commit's
first parent (`HEAD^1`, no GitHub API):
```ts
if (sandbox && failingChecks.length && reviewedRef === "merge") {
  // base_compare.sh: cd review; BASE=$(git rev-parse HEAD^1); git checkout $BASE; npm ci;
  //                  for c in <failing>; do npm run "$c"; echo "###BASE $c $?"; done
  await sandbox.run({ command: "bash base_compare.sh", abortSignal: AbortSignal.timeout(BASE_COMPARE_MS) });
  // preexistingFailures = failingChecks that also fail on base (fail-safe: only if base reproduces it)
}
```
Both are **additive + fail-safe**: they never turn a real failure into a false pass, and the
`ranChecks` honesty contract is untouched. A per-review `[shipmate:review] {…}` metric line is
emitted at each return (observability).

### 3.4 Writes-only HITL gate — `agent/lib/write-approval.ts`
One `Approval` policy set on the **github + linear** connections (tickets is trusted, no gate):
```ts
// write-verb match on the tool name (after the "<conn>__" prefix). NOT a read-verb whitelist,
// because GitHub MCP names some reads pull_request_read/issue_read.
//   write op + interactive human (Slack/HTTP) → "user-approval"  (parks for confirm)
//   reads, OR app principal (schedules), OR github-webhook (auto-review) → "not-applicable"
```
The `github-webhook` skip is load-bearing: the auto-review can't satisfy a HITL prompt, so it
must run free; only interactive humans get the confirm.

### 3.5 Private-repo brokering — `agent/sandbox/sandbox.ts`
Prod pins `vercel()` with a `networkPolicy` that injects auth at the firewall (token never enters
a command or the workspace):
```ts
networkPolicy: { allow: { "github.com": [{ transform: [{ headers: { authorization } }] }], "*": [] } }
// authorization = `Basic base64("x-access-token:" + SHIPMATE_GITHUB_TOKEN)`
```

---

## 4. Decisions & dead-ends (do NOT re-walk)

**Load-bearing decisions:** Check Run (not just a comment) because only a Required Status Check
blocks merge · verdict surfaces owned by *code* (deterministic, dedup-safe) not the model ·
compare-to-base is *informational* (never silently un-blocks an untested gate change) · flaky
retry is `test`-only and never on a timeout · GitHub = app-scoped, Linear = user-scoped (see below).

**Dead-ends already paid for** (full table in `CLAUDE.md`):
- **Webhook-secret mismatch** — the auto-review's long "never fires" bug. A **401 from eve's
  github verifier means `HMAC(body, GITHUB_WEBHOOK_SECRET)` ≠ GitHub's signature** → the secrets
  differ (often an invisible trailing newline from `echo`/CLI). Fix: one identical value in both
  the App's Webhook→Secret and Vercel `GITHUB_WEBHOOK_SECRET`, then **redeploy**. Recent
  Deliveries (App UI) is the decisive diagnostic (401 secret / 404 URL / 2xx ran).
- **GitHub auto-review via Connect webhook** — Vercel Connect doesn't forward GitHub webhooks
  ("Slack-only in beta"); must use a classic GitHub App webhook.
- **Linear app-scoped Connect** — architecturally impossible (custom-OAuth/user-delegated). Reads
  via user-scoped Connect; **writes via key-based GraphQL** (raw `Authorization`, no `Bearer`).
- **OAuth scope `issues:update`** — not a valid Linear scope; use `["read","write"]`.
- **Inline `bash -c "<script>"` in the sandbox** — the host shell pre-expanded/`collapsed` it;
  always write-file-then-`bash`.

---

## 5. What's proven (verification evidence)

- **End-to-end auto-review** — PR synchronize → webhook (200) → `review_pr` (merge ref, real
  build+typecheck in the Vercel Sandbox) → **`success` Check Run** + verdict.
- **Authority** — "Shipmate Review" is a **Required Status Check** on `main` (`strict:false`,
  `enforce_admins:false`).
- **Trust, behavior-proven** — PR #3 (flaky test → success + "flaky", no block, silent comment);
  PR #4 (test failing on PR+base → failure + "pre-existing, not introduced by this PR").
- **Evals** — the connection-independent `--tag ci` subset is green in CI on every push;
  connection/sandbox/real-review evals are verified against prod (they cost credit — run
  deliberately).

---

## 6. How to resume (for the next session)

1. Read `CLAUDE.md` (rules + architecture), then this file, then
   `docs/limitations-and-next-steps.md` (what's open).
2. Re-sync before editing: `git status --short --branch`, confirm `main == origin/main`, and
   that the working tree is what you expect (this repo has had concurrent sessions — the branch
   can shift under you).
3. Verify against the installed `node_modules/eve` (the framework version wins over any doc).
4. Ship discipline: `eve info` (0/0) → `tsc` → `eve build` → a real turn / targeted smoke →
   commit `agent/**` → push (`main` auto-deploys) → confirm `/eve/v1/health`. **A green compile
   never proves auth or behavior.** Don't run evals locally just to "test" (credit) — use CI +
   targeted prod smoke.
5. The highest-value open work is in `docs/limitations-and-next-steps.md` §3 (rethought
   2026-06-29): **#1 = make verdict-write failures loud** (a latent *silent-gate* risk — the
   Check Run / comment writes are swallowed to logs at `github.ts ~:190,:228`), then #2 wire
   `correlate` into the auto-review, #3 unit-test the deterministic core in free CI. Sandbox
   egress hardening is now a **conditional tripwire** (do it when you accept public-fork PRs),
   not the headline.

*(Durable context also lives in the session memory files: `shipmate-authority-checkrun.md`,
`shipmate-pillar2-verdict-surfaces.md`, `shipmate-write-gate.md`, `shipmate-github-cicd.md`,
`ship-auth-architecture.md`, `shipmate-review-pr.md`, `shipmate-lanes.md`.)*
