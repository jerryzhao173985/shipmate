# Shipmate — Implementation Plan for the Next Steps (#4, #5, and beyond)

Detailed, ready-to-execute plans for the work left after the 2026-06-29 rethink (#1 loud-gate,
#2 correlation-at-gate, #3 unit-tests are **done + live** — see `docs/limitations-and-next-steps.md`
§3 and the memory `shipmate-rethink-fixes.md`). Read those first for *why*; this file is the *how*.

**Before you touch anything — read this:**
- **Concurrent sessions edit the same files** (`agent/channels/github.ts`, `agent/tools/review_pr.ts`,
  `agent/lib/verdict-*.ts`). Re-check `git status --short --branch` and `git log -5` right before
  editing; if a file shows as just-modified, **re-read it** (the Edit tool will block a stale write).
  Do **not** clobber another session's uncommitted work — wait for it to land, then build on top.
- **Verify against the installed `node_modules/eve`** (the version wins over any doc).
- **Verification gate (every change):** `npx eve info` (0/0) → `npm run typecheck` → `npm test`
  (the unit tests) → `npm run build` → drive a real turn / targeted smoke → commit `agent/**`
  → push (`main` auto-deploys) → confirm `/eve/v1/health`. A green compile never proves behavior.
- **Don't run `eve eval` locally to "test"** (AI-Gateway credit). Use the structural gates + the
  free unit tests; reserve a real auto-review smoke PR (see "Smoke pattern" below) for behavior proof.
- **Unit-test gotcha:** `node --test` can't import a file that uses the `#lib/*.js` import map
  (NodeNext `.js`→`.ts` isn't resolved). Tests in `test/` may import only **leaf lib files**
  (`agent/lib/verdict-parse.ts`, `verdict-comment.ts`, `write-approval.ts` — they import only
  `zod`/type-only), NOT `review_pr.ts`/`github.ts`. Put any new pure logic in a leaf lib to test it.
- **Where the verdict logic lives now:** the pure parsing/verdict-building is in
  `agent/lib/verdict-parse.ts` (`CHECK_SCRIPTS`, `Verdict`, `VerdictT`, `parseChecks`, `buildVerdict`,
  `safeSegment`); the comment builder + `MARKER` in `agent/lib/verdict-comment.ts`. `review_pr.ts`
  owns sandbox orchestration; `github.ts` owns the channel + the two verdict surfaces.

---

## #4 — Diff-awareness in `review_pr` (SOON)

**Why:** the verdict says *which checks* failed but not *which files the PR changed*, so a reader
can't tell if a failure is even in the PR's blast radius. Make every fail/flaky/pre-existing line
actionable. Nearly free — the sandbox already has the merge commit checked out.

**Scope discipline (load-bearing):** list the changed files and a **soft** proximity note only.
Do **NOT** claim "this test covers your change" — mapping a failing *check* to changed *files* is
heuristic, and overclaiming erodes the honesty posture the product guards hardest.

**Files:** `agent/lib/verdict-parse.ts` (Verdict field + buildVerdict + a marker parser),
`agent/tools/review_pr.ts` (capture in the sandbox), optionally `agent/lib/verdict-comment.ts`
(surface it), `test/verdict-parse.test.ts` (lock the parser).

**Steps:**
1. **Sandbox capture** (`review_pr.ts`, in the sandbox script, only on the `merge` ref — `HEAD^1`
   is the base there, same primitive compare-to-base uses; skip on the `head` fallback). After the
   checkout, before the checks, emit changed files (cap to avoid bloat):
   ```sh
   # illustrative — verify the script structure in review_pr.ts first
   git diff --name-only HEAD^1 2>/dev/null | head -n 50 | sed 's/^/###CHANGED /'
   ```
2. **Parse + Verdict** (`verdict-parse.ts`): add `changedFiles: string[]` to the `Verdict` zod
   schema; parse `^###CHANGED (.+)$` lines in `parseChecks` (or a sibling); include in `buildVerdict`
   and in the `base`/couldn't-run object so every return path has it (matches how `flakyChecks`/
   `preexistingFailures` were threaded). Cap the list (e.g. first 50 + a "+N more" count).
3. **Surface** (`verdict-comment.ts` + the Check Run summary via `review_pr`'s `summary`): on a
   FAIL, add a soft line, e.g. `_N files changed; the failing check’s output references a changed
   path_` ONLY if the output excerpt actually contains a changed path — otherwise just `_N files
   changed_`. Keep it factual, never causal.
4. **Test** (`test/verdict-parse.test.ts`): feed synthetic stdout with `###CHANGED` markers →
   assert `changedFiles` parsed + capped; assert no causal claim is fabricated.

**Verify:** `tsc` + `eve info` + `npm test` + `bash -n` the new git line; behavior via a smoke PR
(a PR that changes one file and fails a check → the comment lists that file).
**Risk:** low/additive. **Gotcha:** large diffs (cap the list); the `head`-ref fallback has no clean
base (skip changedFiles there, like compare-to-base).

---

## #5 — One self-monitoring digest (SOON)

**Why:** #1 makes a gate-publish failure *loud in logs* (`[shipmate:authority-failed]`) and #3's
`[shipmate:review]` metric line records each review — but **logs aren't queryable from the agent**,
and `defineState` is conversation-scoped (the auto-review turns are different sessions than a
schedule), so a digest can't read them. Frame this as **silent-breakage detection, not analytics**.

**Key design decision — DON'T try to grep logs.** Instead, **proactively query GitHub** for the
*current* gate state. This needs no log sink and no cross-session store:
- For each recent open PR in `SHIPMATE_GITHUB_SCOPE`, GET the head SHA's check-runs (a github__*
  **read** — not blocked) and inspect the `Shipmate Review` check:
  - **Missing** on a PR open longer than a few minutes → the gate didn't publish → **FLAG** (this is
    the silent-deadlock #1 guards against, surfaced proactively).
  - **Stale** (check on a SHA that isn't the PR's current head) → the latest push wasn't reviewed → flag.
  - **Present** → tally its conclusion (success/failure/neutral) for the activity summary.
- Output ONE Slack line/section: e.g. `🩺 Shipmate gate: 6 PRs reviewed (5✅ 1❌); ⚠️ PR #12 has no
  Shipmate Review check`.

**Files:** fold into `agent/schedules/review-digest.ts` (the rethink wants *one merged digest*, not a
new channel) — it already runs as the **app principal**, is scoped by `SHIPMATE_GITHUB_SCOPE`,
posts to `SLACK_DIGEST_CHANNEL`, and has a **read-only guard** in its prompt (load-bearing: tickets
writes auto-run as the app principal). Add a "Gate health" section to its prompt instructing the
agent to do the per-PR check-run inspection above and report missing/stale + the outcome tally.

**Steps:**
1. Read `agent/schedules/review-digest.ts`; confirm the scope/channel/app-principal/read-only setup.
2. Extend the schedule prompt with the gate-health instruction (keep the read-only guard; the
   check-run reads are reads). Keep it ONE message.
3. (Optional, later) If/when an OTel or log sink is wired, the digest could also surface
   `[shipmate:authority-failed]`/`[shipmate:review]` aggregates — but the proactive query above is
   the achievable v1 with zero new infra.

**Verify:** `tsc` + `eve info`; behavior via a real schedule run or `eve eval --url <prod>` (credit —
deliberate). **Risk:** low (read-only, app principal, existing guards). **Gotcha:** the schedule has
no Linear user (app principal) — don't have it touch Linear; GitHub + tickets only, as today.

---

## Tripwires — correct, but build ONLY when the trigger fires (not speculatively)

### T1 — Sandbox egress hardening → *when you accept public-fork PRs*
Untrusted PR code currently runs with allow-all egress (`"*": []`). Lock it down in
`agent/sandbox/sandbox.ts`:
- On the **`vercel()`** backend (prod), set a deny-by-default `networkPolicy`: allow only the npm
  registry (`registry.npmjs.org`) + `github.com` (keep the existing token-broker `transform` for
  `github.com`); block cloud-metadata (`169.254.169.254`) and RFC1918 ranges.
- In `review_pr`'s install step, use `npm ci --ignore-scripts` (stop arbitrary `postinstall`).
- **Typing gotcha (verified eve 0.15.1):** the record-form `networkPolicy` with `transform` only
  typechecks on a **pinned `vercel()`** backend — under `defaultBackend()` the `use({networkPolicy})`
  option resolves to `never`. Keep `process.env.VERCEL ? prodBackend() : defaultBackend()`.
- **Verify:** `tsc` + `eve info`; a private/public clone smoke. **Don't** do this speculatively — it
  can subtly break installs (some packages need scripts), so do it with a real fork-PR to test against.

### T2 — `merge_group` handling → *when you enable a GitHub merge queue*
A merge queue tests the queued combination, not the PR head. Add handling so the gate covers the
merge-queue ref. Grounding: check eve's github channel for a `merge_group`/`onCheckSuite` hook in
`node_modules/eve/.../channels/github/` before designing. Until a queue is enabled, this is dead code.

### T3 — Broaden `review_pr` beyond Node → *when there's a non-Node repo to review*
Today `review_pr` keys off `package.json` + npm scripts; a non-Node repo → honest `ranChecks:false`.
Detect project type in the sandbox (`pyproject.toml`/`requirements.txt` → pytest/ruff; `go.mod` →
`go test`/`go build`; `Cargo.toml` → `cargo test`/`build`) and run language-appropriate checks. Keep
the same Verdict shape + the `ranChecks` honesty contract. Big-ish; only worth it with a real repo.

---

## Deferred / lower-value (do only on measured need)
- **Flaky resilience extension** — currently `test`-only, one retry. Could compare base-flakiness or
  N retries; defer until flaky-blocking is a *measured* recurring pain.
- **Metrics aggregation / OTel sink** — ship `[shipmate:review]` lines to a queryable sink, then a
  dashboard or a richer #5. Defer until someone needs the numbers.
- **Structured-output callers** — already supported (`outputSchema`); extend only on demand.

## Explicitly NOT worth doing (decided — don't re-walk)
Chatty LLM commentary / one-click auto-fix / whole-repo RAG (attack the run-it-first moat;
auto-fix needs re-enabling the disabled `bash`/write tools — a security regression); CI-triage via
`onCheckSuite`/`onWorkflowRun` (re-narrates Actions failures a human already sees); compare-to-base
**gate-flip** (silently un-blocks a merge off a heuristic — enrich the title text at most, never flip
the gate); cross-PR flake-quarantine ledger (needs cross-session storage the agent lacks); a separate
correlation/triage subagent; digest templating.

---

## Smoke pattern (how this session behavior-proved fixes, for reuse)
To prove an auto-review change end-to-end without a Slack user, create a throwaway PR via the GitHub
API (no local churn) and watch the auto-review:
1. Branch off `main`; add the change via the contents API (`PUT /repos/.../contents/<path>` with
   `branch`). To force a FAILING verdict (so the sticky comment exists), add a file with a deliberate
   `tsc` type error (e.g. `agent/lib/_x.ts: export const x: number = "s";`) — `eve build` still
   bundles fine, `typecheck` fails.
2. `gh pr create`; poll `gh api repos/.../commits/<headSHA>/check-runs?check_name=Shipmate%20Review`
   for the conclusion, and `repos/.../issues/<n>/comments` for the `ship-eve` comment body.
3. Behavior-proven on PRs #1–#5 this way (e.g. #5 confirmed `**Linked work:** references JER-5` was
   appended). **Close the PR + delete the branch after** (`gh pr close <n> --delete-branch`).
4. Costs a little AI-Gateway credit (one real review turn). To reference a Linear id you get a
   guaranteed non-`none` `LINKED-WORK:` line (Linear is referenced-not-resolved in a webhook); to
   prove ticket *resolution* you need a real id that currently exists in the ephemeral tracker.
