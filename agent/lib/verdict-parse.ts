import { z } from "zod";

/**
 * Pure parsing + verdict-building for review_pr — extracted from the tool's
 * `execute` so the deterministic core (which `###CHECK/###FLAKY/###REF/###BASE`
 * marker means what, and how it maps to pass/fail/flaky/pre-existing/couldn't-run)
 * is unit-tested in free CI (`test/verdict-parse.test.ts`). No sandbox, no I/O.
 * review_pr.ts keeps the sandbox orchestration and calls these. NO behavior change.
 */

// The project scripts we run as independent checks, in order. Also drives the
// sandbox script in review_pr.ts. build BEFORE typecheck: a codegen repo's tsc
// needs the types `build` generates.
export const CHECK_SCRIPTS = ["lint", "build", "typecheck", "test"] as const;

const CheckResult = z.object({
  name: z.string(),
  passed: z.boolean(),
  exitCode: z.number(),
});

export const Verdict = z.object({
  /** True only when every check ran AND passed. Never true if ranChecks is false. */
  passed: z.boolean(),
  /** False when the sandbox couldn't clone or execute the suite at all. */
  ranChecks: z.boolean(),
  /** Genuine, PR-introduced failures that block the merge. */
  failingChecks: z.array(z.string()),
  /** Checks that FAILED then PASSED on a single retry — treated as passed, surfaced. */
  flakyChecks: z.array(z.string()),
  /** Of the failingChecks, those ALSO failing on the base branch (pre-existing). Informational. */
  preexistingFailures: z.array(z.string()),
  /** Per-check outcomes for the checks that actually executed. */
  checks: z.array(CheckResult),
  /** True when at least one check was killed by the wall-clock timeout (exit 124). */
  timedOut: z.boolean(),
  /** "merge" = PR merged into base (what lands), "head" = PR tip (merge had conflicts), null = nothing checked out. */
  reviewedRef: z.enum(["merge", "head"]).nullable(),
  /** One-line human verdict the model can quote. */
  summary: z.string(),
  /** Parsed PR coordinates, for the model to reference. */
  pr: z.object({ owner: z.string(), repo: z.string(), number: z.number() }),
  /** Tail of the sandbox output, for citing the failing excerpt. Trimmed. */
  output: z.string(),
});
export type VerdictT = z.infer<typeof Verdict>;

export function trimTail(s: string, max = 1500): string {
  if (s.length <= max) return s;
  return `…(${s.length - max} chars trimmed)\n` + s.slice(s.length - max);
}

// GitHub owner/repo charset; additionally reject "."/".." and leading "-" so a
// segment can't become a git flag or a path-traversal token in the clone URL.
// Pure → unit-tested in test/review_pr.test.ts. (Lives in the lib, not review_pr.ts,
// so a unit test can import it without loading the eve-tool module — `node --test`
// can't resolve the tool's `#lib/*.js` chain at runtime, only eve build/tsc can.)
const SAFE_SEGMENT = /^[A-Za-z0-9_.-]+$/;
export function safeSegment(s: string): boolean {
  return SAFE_SEGMENT.test(s) && s !== "." && s !== ".." && !s.startsWith("-");
}

export type ParsedChecks = {
  checks: { name: string; passed: boolean; exitCode: number }[];
  flakyChecks: string[];
  reviewedRef: "merge" | "head" | null;
  cloneOk: boolean;
  checkoutOk: boolean;
  installOk: boolean;
  ranChecks: boolean;
  timedOut: boolean;
  failingChecks: string[];
  passed: boolean;
};

/** Parse the main sandbox stdout markers into check outcomes + whether the suite ran. */
export function parseChecks(stdout: string): ParsedChecks {
  // The "###CHECK <name> <exit>" markers (final exit per check, after any flaky retry).
  const checks: { name: string; passed: boolean; exitCode: number }[] = [];
  for (const line of stdout.split("\n")) {
    const cm = line.match(/^###CHECK (\S+) (-?\d+)\s*$/);
    if (cm) checks.push({ name: cm[1], passed: cm[2] === "0", exitCode: Number.parseInt(cm[2], 10) });
  }

  // ###FLAKY <name>: failed then passed on retry (final ###CHECK exit is 0, so counts as passed).
  const flakyChecks: string[] = [];
  for (const line of stdout.split("\n")) {
    const fm = line.match(/^###FLAKY (\S+)\s*$/);
    if (fm && !flakyChecks.includes(fm[1])) flakyChecks.push(fm[1]);
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
  const failingChecks = realChecks.filter((c) => !c.passed).map((c) => c.name);
  const passed = ranChecks && failingChecks.length === 0;

  return { checks, flakyChecks, reviewedRef, cloneOk, checkoutOk, installOk, ranChecks, timedOut, failingChecks, passed };
}

/** Parse the ###BASE markers from the base-compare run → the pre-existing set (fail-safe). */
export function parseBaseResults(baseOut: string, failingChecks: string[]): string[] {
  const baseRc = new Map<string, number>();
  for (const line of baseOut.split("\n")) {
    const bm = line.match(/^###BASE (\S+) (-?\d+)\s*$/);
    if (bm) baseRc.set(bm[1], Number.parseInt(bm[2], 10));
  }
  // Pre-existing only if base DEFINITIVELY reproduced the failure (ran and returned non-zero).
  const preexisting: string[] = [];
  for (const name of failingChecks) {
    const rc = baseRc.get(name);
    if (rc !== undefined && rc !== 0) preexisting.push(name);
  }
  return preexisting;
}

/** Build the final Verdict from the parsed checks (+ optional base-compare output). */
export function buildVerdict(opts: {
  parsed: ParsedChecks;
  stdout: string;
  baseOut: string;
  runError: string | null;
  owner: string;
  repo: string;
  number: number;
}): VerdictT {
  const { parsed, stdout, baseOut, runError, owner, repo, number } = opts;
  const pr = { owner, repo, number };

  if (!parsed.ranChecks) {
    const by = (n: string) => parsed.checks.find((c) => c.name === n);
    let reason: string;
    if (runError) reason = `the sandbox could not execute the review (${runError}). This usually means no real sandbox backend is available (the local just-bash backend has no git or network).`;
    else if (!parsed.cloneOk) reason = `could not clone https://github.com/${owner}/${repo} in the sandbox — the repo may not exist, may be private (private repos need a GitHub token brokered by the sandbox), or no real git/network backend is available locally.`;
    else if (!parsed.checkoutOk) reason = `cloned the repo but could not fetch/checkout PR #${number}'s head ref.`;
    else if (by("detect")) reason = `the repo has no package.json at its root — Shipmate reviews Node projects for now.`;
    else if (!parsed.installOk) reason = `dependency install failed${parsed.timedOut ? " (timed out)" : ""}, so no checks could run.`;
    else reason = `the project defines none of: ${CHECK_SCRIPTS.join(", ")}.`;
    return {
      passed: false,
      ranChecks: false,
      failingChecks: [],
      flakyChecks: [],
      preexistingFailures: [],
      checks: parsed.checks,
      timedOut: parsed.timedOut,
      reviewedRef: parsed.reviewedRef,
      summary: `Could not run checks for ${owner}/${repo}#${number}: ${reason}`,
      pr,
      output: trimTail(stdout),
    };
  }

  const preexistingFailures = parseBaseResults(baseOut, parsed.failingChecks);
  const ran = parsed.checks
    .filter((c) => (CHECK_SCRIPTS as readonly string[]).includes(c.name))
    .map((c) => c.name)
    .join(", ");
  const refNote =
    parsed.reviewedRef === "head"
      ? " [reviewed PR head — the merge into the base has conflicts]"
      : parsed.reviewedRef === "merge"
        ? " [reviewed the PR merged into its base]"
        : "";
  const flakyNote = parsed.flakyChecks.length
    ? ` (flaky: ${parsed.flakyChecks.join(", ")} failed then passed on retry)`
    : "";
  const preexistingNote = preexistingFailures.length
    ? ` [⚠️ ${preexistingFailures.join(", ")} also failing on the base branch — pre-existing, not introduced by this PR]`
    : "";
  const summary = parsed.passed
    ? `${owner}/${repo}#${number}: all checks passed (${ran})${flakyNote}${refNote}.`
    : `${owner}/${repo}#${number}: FAILED — ${parsed.failingChecks.join(", ")} failing${parsed.timedOut ? " (some timed out)" : ""} (ran: ${ran})${flakyNote}${preexistingNote}${refNote}. Not safe to merge.`;

  return {
    passed: parsed.passed,
    ranChecks: true,
    failingChecks: parsed.failingChecks,
    flakyChecks: parsed.flakyChecks,
    preexistingFailures,
    checks: parsed.checks,
    timedOut: parsed.timedOut,
    reviewedRef: parsed.reviewedRef,
    summary,
    pr,
    output: trimTail(stdout),
  };
}
