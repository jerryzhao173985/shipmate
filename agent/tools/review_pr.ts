import { defineTool } from "eve/tools";
import { z } from "zod";

/**
 * review_pr — Shipmate's headline capability: review a pull request by RUNNING it.
 *
 * This tool runs in the **app runtime** (full process.env, trusted), but the
 * untrusted PR code is only ever cloned and executed inside the isolated
 * sandbox reached via `await ctx.getSandbox()`. We never run PR code in the app
 * runtime, and we never write a secret into a sandbox command.
 *
 * v0 scope: PUBLIC GitHub PRs only — cloned over https with no token, using
 * GitHub's `pull/<n>/head` ref. A PRIVATE repo would need a GITHUB_TOKEN brokered
 * at the sandbox network firewall (a per-domain header `transform` in the sandbox
 * network policy) so the token authenticates egress without ever entering a clone
 * command or the workspace. That path is intentionally NOT enabled here.
 *
 * The verdict carries `ranChecks`: when the sandbox can't clone or run the suite
 * (e.g. the local just-bash backend has no real git/network), `ranChecks` is
 * false and the model must report "couldn't run", never a pass/fail.
 *
 * Read-only (no GitHub writes), so no approval gate. Posting a review back to
 * GitHub would be a write action and must be gated on approval.
 *
 * grounding: defineTool/ctx.getSandbox — references/components/{tool,sandbox}.md;
 * sandbox.run/.exitCode — e2e/fixtures/agent-tools-sandbox/agent/tools/run_python.ts:21-36.
 */

const CheckResult = z.object({
  name: z.string(),
  passed: z.boolean(),
  exitCode: z.number(),
});

const Verdict = z.object({
  /** True only when every check ran AND passed. Never true if ranChecks is false. */
  passed: z.boolean(),
  /** False when the sandbox couldn't clone or execute the suite at all. */
  ranChecks: z.boolean(),
  /** Names of the checks that failed (e.g. ["test", "lint"]). Empty when none ran. */
  failingChecks: z.array(z.string()),
  /** Per-check outcomes for the checks that actually executed. */
  checks: z.array(CheckResult),
  /** One-line human verdict the model can quote. */
  summary: z.string(),
  /** Parsed PR coordinates, for the model to reference. */
  pr: z.object({ owner: z.string(), repo: z.string(), number: z.number() }),
  /** Tail of the sandbox output, for citing the failing excerpt. Trimmed. */
  output: z.string(),
});

type VerdictT = z.infer<typeof Verdict>;

const PR_URL = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i;
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/; // GitHub owner/repo charset — blocks shell injection.

function trimTail(s: string, max = 3000): string {
  if (s.length <= max) return s;
  return `…(${s.length - max} chars trimmed)\n` + s.slice(s.length - max);
}

export default defineTool({
  description:
    "Review a GitHub pull request by actually running it: clone the PR branch in an isolated sandbox and run the project's install, lint, build, and test checks. Use whenever asked to review, check, or evaluate a pull request. Returns a structured verdict { passed, ranChecks, failingChecks, summary }. Public repos only (no token needed).",
  inputSchema: z.object({
    prUrl: z
      .string()
      .describe("Full GitHub PR URL, e.g. https://github.com/owner/repo/pull/123"),
  }),
  outputSchema: Verdict,
  async execute({ prUrl }, ctx): Promise<VerdictT> {
    const m = prUrl.match(PR_URL);
    if (!m) {
      return {
        passed: false,
        ranChecks: false,
        failingChecks: [],
        checks: [],
        summary: `"${prUrl}" is not a recognizable GitHub PR URL (expected github.com/owner/repo/pull/<number>).`,
        pr: { owner: "", repo: "", number: 0 },
        output: "",
      };
    }
    const owner = m[1];
    const repo = m[2].replace(/\.git$/, "");
    const number = Number.parseInt(m[3], 10);

    if (!SAFE_SEGMENT.test(owner) || !SAFE_SEGMENT.test(repo)) {
      return {
        passed: false,
        ranChecks: false,
        failingChecks: [],
        checks: [],
        summary: `Refusing to review: owner/repo in "${prUrl}" contain unexpected characters.`,
        pr: { owner, repo, number },
        output: "",
      };
    }

    const pr = { owner, repo, number };

    // One self-contained sandbox script: clone the PR head, then run each check
    // that the project actually defines. Emits parseable "###CHECK <name> <exit>"
    // markers and stops early on a clone/checkout/install failure. No secrets,
    // no app env — purely the public clone URL and the PR number.
    const script = [
      "set -u",
      "WORK=review",
      'rm -rf "$WORK"',
      `if git clone --depth 50 "https://github.com/${owner}/${repo}.git" "$WORK" > clone.log 2>&1; then echo "###CHECK clone 0"; else echo "###CHECK clone $?"; tail -n 40 clone.log; exit 0; fi`,
      'cd "$WORK"',
      `if git fetch --depth 50 origin "pull/${number}/head" > ../fetch.log 2>&1 && git checkout -q FETCH_HEAD 2> ../checkout.log; then echo "###CHECK checkout 0"; else echo "###CHECK checkout $?"; tail -n 40 ../fetch.log ../checkout.log; exit 0; fi`,
      'if [ ! -f package.json ]; then echo "###CHECK detect 1"; echo "No package.json at repo root; v0 reviews Node projects only."; exit 0; fi',
      'if [ -f package-lock.json ]; then npm ci > ../install.log 2>&1; else npm install > ../install.log 2>&1; fi; rc=$?; echo "###CHECK install $rc"; tail -n 30 ../install.log',
      '[ "$rc" -ne 0 ] && exit 0',
      'HAS(){ node -e "process.exit((require(\\"./package.json\\").scripts||{})[process.argv[1]]?0:1)" "$1" 2>/dev/null; }',
      'for c in lint build test; do if HAS "$c"; then npm run "$c" > "../$c.log" 2>&1; rc=$?; echo "###CHECK $c $rc"; tail -n 40 "../$c.log"; fi; done',
    ].join("\n");

    let stdout = "";
    let runError: string | null = null;
    try {
      const sandbox = await ctx.getSandbox();
      // Write the script to a file and run it, rather than `bash -c "<inline>"`:
      // writeTextFile preserves newlines and defers all variable expansion to the
      // sandbox shell (no host-side quoting hazard). Matches the fixture pattern in
      // e2e/fixtures/agent-tools-sandbox/agent/tools/run_python.ts:21-36.
      await sandbox.writeTextFile({ path: "review_pr.sh", content: script });
      const result = await sandbox.run({ command: "bash review_pr.sh" });
      stdout = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    } catch (err) {
      runError = err instanceof Error ? err.message : String(err);
    }

    // Parse the "###CHECK <name> <exit>" markers.
    const checks: { name: string; passed: boolean; exitCode: number }[] = [];
    for (const line of stdout.split("\n")) {
      const cm = line.match(/^###CHECK (\S+) (-?\d+)\s*$/);
      if (cm) checks.push({ name: cm[1], passed: cm[2] === "0", exitCode: Number.parseInt(cm[2], 10) });
    }

    const by = (n: string) => checks.find((c) => c.name === n);
    const cloneOk = by("clone")?.passed === true;
    const checkoutOk = by("checkout")?.passed === true;
    const installCheck = by("install");
    const installOk = installCheck ? installCheck.passed : false;

    // Infra steps (clone/checkout/install/detect) gate whether the suite ran at all.
    const realChecks = checks.filter((c) => c.name === "lint" || c.name === "build" || c.name === "test");
    const ranChecks = cloneOk && checkoutOk && installOk && realChecks.length > 0;

    if (!ranChecks) {
      let reason: string;
      if (runError) reason = `the sandbox could not execute the review (${runError}). This usually means no real sandbox backend is available (the local just-bash backend has no git or network).`;
      else if (!cloneOk) reason = `could not clone https://github.com/${owner}/${repo} in the sandbox — likely no real git/network backend available locally, or the repo is private/unreachable.`;
      else if (!checkoutOk) reason = `cloned the repo but could not fetch/checkout PR #${number}'s head ref.`;
      else if (by("detect")) reason = `the repo has no package.json at its root — v0 reviews Node projects only.`;
      else if (!installOk) reason = `dependency install failed, so no checks could run.`;
      else reason = `the project defines no lint/build/test scripts to run.`;
      return {
        passed: false,
        ranChecks: false,
        failingChecks: [],
        checks,
        summary: `Could not run checks for ${owner}/${repo}#${number}: ${reason}`,
        pr,
        output: trimTail(stdout),
      };
    }

    const failingChecks = realChecks.filter((c) => !c.passed).map((c) => c.name);
    const passed = failingChecks.length === 0;
    const summary = passed
      ? `${owner}/${repo}#${number}: all checks passed (${realChecks.map((c) => c.name).join(", ")}).`
      : `${owner}/${repo}#${number}: FAILED — ${failingChecks.join(", ")} failing (ran: ${realChecks.map((c) => c.name).join(", ")}). Not safe to merge.`;

    return { passed, ranChecks: true, failingChecks, checks, summary, pr, output: trimTail(stdout) };
  },
});
