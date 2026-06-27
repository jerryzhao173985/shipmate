# Shipmate

[![CI](https://github.com/jerryzhao173985/shipmate/actions/workflows/ci.yml/badge.svg)](https://github.com/jerryzhao173985/shipmate/actions/workflows/ci.yml)

A durable **PR-review & operations agent** for the team, built on
[eve](https://eve.dev) (a filesystem-first framework for durable backend AI
agents). Internal name: `ship`. Deployed on Vercel.

Shipmate's headline job is **reviewing pull requests by actually running them** —
it clones the PR branch into an isolated sandbox and runs install / lint /
typecheck / build / test before forming a verdict. It never judges from the diff
alone, and it never calls a change safe while checks fail (or claims a verdict it
couldn't actually run). Around that core it reads from and correlates the team's
systems — GitHub, Linear, and the ticket tracker — and is reachable in **Slack**,
on **GitHub** (@mention + auto-review on PR open), and over the HTTP API.

## The agent is the directory

eve discovers capabilities by file location — there is no central registry. The
authored surface lives under [`agent/`](agent/):

| Path | Role |
| --- | --- |
| `agent/agent.ts` | Runtime config (model only). |
| `agent/instructions.md` | The behavioral contract — most product logic lives here. |
| `agent/tools/review_pr.ts` | **Headline tool**: clone the PR's merge result, run the checks in `ctx.getSandbox()`, return `{ passed, ranChecks, failingChecks, summary }`. |
| `agent/tools/correlate.ts` | Deterministic PR↔ticket↔Linear join-key extractor. |
| `agent/tools/{remember,recall}_link.ts` | Cross-turn memory (`defineState`) of PR↔ticket links + verdicts. |
| `agent/connections/{github,linear,tickets}.ts` | GitHub/Linear (MCP via Vercel Connect) + the ticket tracker (OpenAPI). |
| `agent/channels/{slack,github,eve}.ts` | Slack, GitHub (auto-review), and the built-in HTTP channel. |
| `agent/sandbox/sandbox.ts` | The isolated `/workspace` (Vercel Sandbox in prod, microsandbox locally). |
| `agent/lib/write-approval.ts` | Writes-only human-in-the-loop gate (external writes pause; reads + automation flow). |
| `agent/schedules/review-digest.ts` | Weekday Slack digest of open PRs + tickets. |
| `evals/*.eval.ts` | Deterministic regression checks. |

## Safety posture

- **External writes pause for approval** (GitHub/Linear), gated by a custom
  `Approval` policy; **reads and automation** (schedules, the GitHub auto-review)
  flow without a prompt.
- The **internal ticket tracker is trusted** (writes auto-run) but its irreversible
  delete operations are blocked.
- Untrusted PR code runs only inside the sandbox; secrets stay in the app runtime,
  never in a sandbox command or returned to the model.
- The review verdict publishes as a GitHub **Check Run** keyed on the PR head SHA —
  added as a Required Status Check, a failing review **blocks the merge** (authority,
  not just a comment).

## Develop

```bash
npm install
npx eve dev            # local dev server + terminal UI
npx eve info           # discovered surface + diagnostics
npm run typecheck      # tsc
npm run build          # eve build
npm run ci             # build + typecheck + the connection-independent eval subset
npx eve eval           # run all evals (drives the live model)
```

A model credential is required to run the agent: on Vercel it uses project OIDC
for the AI Gateway; elsewhere set `AI_GATEWAY_API_KEY`.

## CI / Deploy

- **CI** — two workflows, split to control AI Gateway cost:
  - [`ci.yml`](.github/workflows/ci.yml) runs `eve build` + `tsc` on **every** push
    (no model, free).
  - [`evals.yml`](.github/workflows/evals.yml) runs the connection-independent eval
    subset the eve way (`eve eval --tag ci --strict --junit`, per-eval annotations,
    `.eve/evals/` artifacts) — but **only when `agent/**`, `evals/**`, or deps
    change** (a README/CI/docs push spends nothing) and only once the
    `AI_GATEWAY_API_KEY` repo secret is set. Connection + real-review evals need
    Connect/sandbox and are verified against the live deployment
    (`eve eval --url <prod>`), not in CI.
- **Deploy**: the Vercel project is connected to this repo, so **pushing to `main`
  auto-deploys** to production (no manual `eve deploy`).
