import { defineTool } from "eve/tools";
import { z } from "zod";

/**
 * review_pr — Shipmate's headline capability: review a pull request by RUNNING it.
 *
 * This tool runs in the **app runtime** (full process.env, trusted), but the
 * untrusted PR code is only ever cloned and executed inside the isolated sandbox
 * reached via `await ctx.getSandbox()`. We never run PR code in the app runtime,
 * and we never write a secret into a sandbox command.
 *
 * Repos:
 *  - PUBLIC PRs work with no token (clone over https, GitHub's `pull/<n>/head` ref).
 *  - PRIVATE PRs work when the sandbox brokers a token at its network firewall —
 *    see `agent/sandbox/sandbox.ts`, which injects an Authorization header for
 *    github.com egress when `SHIPMATE_GITHUB_TOKEN` is set. The token authenticates
 *    the clone WITHOUT ever entering this command or the workspace. This tool stays
 *    token-blind: the same `git clone https://github.com/owner/repo.git` works for
 *    both, because the firewall (not the command) carries the credential.
 *
 * Durability: every command is wrapped in `timeout` so a runaway install or test
 * can't hang the durable step forever (the realistic failure mode for untrusted
 * PR code). A timed-out check exits 124 and is reported as a failing check.
 *
 * The verdict carries `ranChecks`: when the sandbox can't clone or run the suite,
 * `ranChecks` is false and the model must report "couldn't run", never a pass/fail.
 *
 * Read-only (no GitHub writes), so no approval gate. Posting a verdict back to
 * GitHub is a separate, confirm-first write done through the github__* connection.
 *
 * grounding: defineTool/ctx.getSandbox — references/components/{tool,sandbox}.md;
 * sandbox.run/.exitCode — e2e/fixtures/agent-tools-sandbox/agent/tools/run_python.ts:21-36;
 * network brokering — docs/sandbox.mdx:208-225 (per-domain `transform` headers).
 */

// Per-command wall-clock budgets (seconds) and the overall step budget (ms).
const CLONE_TIMEOUT = 120;
const INSTALL_TIMEOUT = 420;
const CHECK_TIMEOUT = 420;
const OVERALL_MS = 20 * 60 * 1000;

// The project scripts we run as independent checks, in order.
const CHECK_SCRIPTS = ["lint", "typecheck", "build", "test"] as const;

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
  /** True when at least one check was killed by the wall-clock timeout (exit 124). */
  timedOut: z.boolean(),
  /**
   * Which ref was reviewed: "merge" = the PR merged into its base (what would
   * actually land, like GitHub Actions' default), "head" = the PR branch tip
   * (used when the merge has conflicts with the base). null when nothing checked out.
   */
  reviewedRef: z.enum(["merge", "head"]).nullable(),
  /** One-line human verdict the model can quote. */
  summary: z.string(),
  /** Parsed PR coordinates, for the model to reference. */
  pr: z.object({ owner: z.string(), repo: z.string(), number: z.number() }),
  /** Tail of the sandbox output, for citing the failing excerpt. Trimmed. */
  output: z.string(),
});

type VerdictT = z.infer<typeof Verdict>;

const PR_URL = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i;
// GitHub owner/repo charset; additionally reject "."/".." and leading "-" so a
// segment can't become a git flag or a path-traversal token in the clone URL.
const SAFE_SEGMENT = /^[A-Za-z0-9_.-]+$/;
function safeSegment(s: string): boolean {
  return SAFE_SEGMENT.test(s) && s !== "." && s !== ".." && !s.startsWith("-");
}

function trimTail(s: string, max = 1500): string {
  if (s.length <= max) return s;
  return `…(${s.length - max} chars trimmed)\n` + s.slice(s.length - max);
}

export default defineTool({
  description:
    "Review a GitHub pull request by actually running it: clone the PR branch in an isolated sandbox and run the project's install, lint, typecheck, build, and test scripts. Use whenever asked to review, check, or evaluate a pull request. Returns a structured verdict { passed, ranChecks, failingChecks, summary }. Public repos need no token; private repos work when the sandbox is configured to broker a GitHub token.",
  inputSchema: z.object({
    prUrl: z
      .string()
      .describe("Full GitHub PR URL, e.g. https://github.com/owner/repo/pull/123"),
  }),
  outputSchema: Verdict,
  async execute({ prUrl }, ctx): Promise<VerdictT> {
    const base = {
      passed: false,
      ranChecks: false,
      failingChecks: [],
      checks: [],
      timedOut: false,
      reviewedRef: null as "merge" | "head" | null,
    };
    const m = prUrl.match(PR_URL);
    if (!m) {
      return {
        ...base,
        summary: `"${prUrl}" is not a recognizable GitHub PR URL (expected github.com/owner/repo/pull/<number>).`,
        pr: { owner: "", repo: "", number: 0 },
        output: "",
      };
    }
    const owner = m[1];
    const repo = m[2].replace(/\.git$/, "");
    const number = Number.parseInt(m[3], 10);
    const pr = { owner, repo, number };

    if (!safeSegment(owner) || !safeSegment(repo)) {
      return {
        ...base,
        summary: `Refusing to review: owner/repo in "${prUrl}" contain unexpected characters.`,
        pr,
        output: "",
      };
    }

    // One self-contained sandbox script: clone the PR head, then run each check
    // the project actually defines. Emits parseable "###CHECK <name> <exit>"
    // markers, stops early on a clone/checkout/install failure, and wraps every
    // command in `timeout` so a runaway never hangs the durable step. No secrets
    // and no app env are interpolated — a private clone is authenticated by the
    // sandbox firewall, not by anything in this script.
    const script = [
      "set -u",
      // Never let git block on an interactive credential prompt: a nonexistent or
      // private repo returns 401, and without this git would try to read a username
      // from a TTY ("fatal: could not read Username") — which hangs a real
      // private-repo review (no token) until the timeout. These make the clone fail
      // FAST and cleanly so the verdict is an honest ranChecks:false.
      "export GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=true GCM_INTERACTIVE=never",
      "WORK=review",
      'rm -rf "$WORK"',
      `if timeout -k 10 ${CLONE_TIMEOUT} git clone --depth 50 "https://github.com/${owner}/${repo}.git" "$WORK" > clone.log 2>&1; then echo "###CHECK clone 0"; else echo "###CHECK clone $?"; tail -n 40 clone.log; exit 0; fi`,
      'cd "$WORK"',
      // Prefer the merge ref (PR merged into base = what actually lands, like
      // GitHub Actions). Fall back to the PR head when the merge has conflicts.
      `if timeout -k 10 ${CLONE_TIMEOUT} git fetch --depth 50 origin "pull/${number}/merge" > ../fetch.log 2>&1 && git checkout -q FETCH_HEAD 2> ../checkout.log; then echo "###REF merge"; echo "###CHECK checkout 0"; elif timeout -k 10 ${CLONE_TIMEOUT} git fetch --depth 50 origin "pull/${number}/head" > ../fetch.log 2>&1 && git checkout -q FETCH_HEAD 2> ../checkout.log; then echo "###REF head"; echo "###CHECK checkout 0"; else echo "###CHECK checkout 1"; tail -n 40 ../fetch.log ../checkout.log; exit 0; fi`,
      'if [ ! -f package.json ]; then echo "###CHECK detect 1"; echo "No package.json at repo root; Shipmate reviews Node projects for now."; exit 0; fi',
      `if [ -f package-lock.json ]; then timeout -k 10 ${INSTALL_TIMEOUT} npm ci > ../install.log 2>&1; else timeout -k 10 ${INSTALL_TIMEOUT} npm install > ../install.log 2>&1; fi`,
      'rc=$?; echo "###CHECK install $rc"; tail -n 30 ../install.log',
      'if [ "$rc" -ne 0 ]; then exit 0; fi',
      'HAS(){ node -e "process.exit((require(\\"./package.json\\").scripts||{})[process.argv[1]]?0:1)" "$1" 2>/dev/null; }',
      `for c in ${CHECK_SCRIPTS.join(" ")}; do if HAS "$c"; then timeout -k 10 ${CHECK_TIMEOUT} npm run "$c" > "../$c.log" 2>&1; rc=$?; echo "###CHECK $c $rc"; tail -n 40 "../$c.log"; fi; done`,
    ].join("\n");

    let stdout = "";
    let runError: string | null = null;
    try {
      const sandbox = await ctx.getSandbox();
      // Write the script to a file and run it (preserves newlines, defers all
      // expansion to the sandbox shell). An overall abortSignal backstops the
      // per-command timeouts in case the sandbox process itself wedges.
      await sandbox.writeTextFile({ path: "review_pr.sh", content: script });
      const result = await sandbox.run({
        command: "bash review_pr.sh",
        abortSignal: AbortSignal.timeout(OVERALL_MS),
      });
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

    const refLine = stdout.split("\n").find((l) => /^###REF (merge|head)\s*$/.test(l));
    const reviewedRef: "merge" | "head" | null = refLine
      ? refLine.includes("merge")
        ? "merge"
        : "head"
      : null;

    const by = (n: string) => checks.find((c) => c.name === n);
    const cloneOk = by("clone")?.passed === true;
    const checkoutOk = by("checkout")?.passed === true;
    const installOk = by("install")?.passed === true;

    const realChecks = checks.filter((c) => (CHECK_SCRIPTS as readonly string[]).includes(c.name));
    const ranChecks = cloneOk && checkoutOk && installOk && realChecks.length > 0;
    const timedOut = checks.some((c) => c.exitCode === 124);

    if (!ranChecks) {
      let reason: string;
      if (runError) reason = `the sandbox could not execute the review (${runError}). This usually means no real sandbox backend is available (the local just-bash backend has no git or network).`;
      else if (!cloneOk) reason = `could not clone https://github.com/${owner}/${repo} in the sandbox — the repo may not exist, may be private (private repos need a GitHub token brokered by the sandbox), or no real git/network backend is available locally.`;
      else if (!checkoutOk) reason = `cloned the repo but could not fetch/checkout PR #${number}'s head ref.`;
      else if (by("detect")) reason = `the repo has no package.json at its root — Shipmate reviews Node projects for now.`;
      else if (!installOk) reason = `dependency install failed${timedOut ? " (timed out)" : ""}, so no checks could run.`;
      else reason = `the project defines none of: ${CHECK_SCRIPTS.join(", ")}.`;
      return {
        ...base,
        timedOut,
        reviewedRef,
        checks,
        summary: `Could not run checks for ${owner}/${repo}#${number}: ${reason}`,
        pr,
        output: trimTail(stdout),
      };
    }

    const failingChecks = realChecks.filter((c) => !c.passed).map((c) => c.name);
    const passed = failingChecks.length === 0;
    const ran = realChecks.map((c) => c.name).join(", ");
    const refNote =
      reviewedRef === "head"
        ? " [reviewed PR head — the merge into the base has conflicts]"
        : reviewedRef === "merge"
          ? " [reviewed the PR merged into its base]"
          : "";
    const summary = passed
      ? `${owner}/${repo}#${number}: all checks passed (${ran})${refNote}.`
      : `${owner}/${repo}#${number}: FAILED — ${failingChecks.join(", ")} failing${timedOut ? " (some timed out)" : ""} (ran: ${ran})${refNote}. Not safe to merge.`;

    return { passed, ranChecks: true, failingChecks, checks, timedOut, reviewedRef, summary, pr, output: trimTail(stdout) };
  },
});
