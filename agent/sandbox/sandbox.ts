import { defaultBackend, defineSandbox } from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";

/**
 * The agent's isolated /workspace sandbox — used by `review_pr` to clone and run
 * untrusted PR code.
 *
 * Backend selection mirrors eve's default (Vercel Sandbox in prod, microsandbox
 * locally) but pins `vercel()` explicitly in prod so we can attach a network
 * policy. Locally (`process.env.VERCEL` unset) it is exactly `defaultBackend()`,
 * so the verified local microsandbox path is unchanged — this file is a no-op
 * locally.
 *
 * What it ADDS in prod: optional **private-repo support** via credential brokering
 * at the network firewall. When `SHIPMATE_GITHUB_TOKEN` is set, the Vercel Sandbox
 * firewall injects an `Authorization` header on github.com egress, so
 * `git clone https://github.com/owner/repo.git` authenticates a private clone
 * WITHOUT the token ever entering a sandbox command or the workspace (the
 * trust-boundary rule: secrets stay in the app runtime). The `"*": []` catch-all
 * keeps all other egress open, so npm install and the test suite are unaffected.
 *
 * Gated on a dedicated `SHIPMATE_GITHUB_TOKEN` (NOT the ambient, Connect-superseded
 * `GITHUB_TOKEN`): unset → plain `vercel()`, and the tokenless public-PR path is
 * untouched.
 *
 * grounding: defineSandbox/defaultBackend (`eve/sandbox`), vercel() networkPolicy
 * (`eve/sandbox/vercel`) — references/components/sandbox.md; per-domain header
 * `transform` — docs/sandbox.mdx:208-225.
 */
function prodBackend() {
  const token = process.env.SHIPMATE_GITHUB_TOKEN;
  if (!token) return vercel();
  // GitHub git-over-HTTPS accepts Basic auth as `x-access-token:<token>`.
  const authorization = `Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  return vercel({
    networkPolicy: {
      allow: {
        "github.com": [{ transform: [{ headers: { authorization } }] }],
        "*": [],
      },
    },
  });
}

export default defineSandbox({
  backend: process.env.VERCEL ? prodBackend() : defaultBackend(),
});
