import { defineState } from "eve/context";

// A remembered correlation / review outcome. Any subset of keys may be set; the
// identifiers (pr / ticket / linear) are how entries are matched and merged.
export type Link = {
  pr?: string; // PR URL or "owner/repo#number"
  ticket?: string; // ticket tracker id, e.g. "ENG-12"
  linear?: string; // Linear identifier, e.g. "JER-5"
  verdict?: string; // short review verdict, e.g. "failed: test"
  note?: string; // any extra context worth recalling
};

// Durable per-session memory of the PR / ticket / Linear correlations and review
// verdicts Shipmate has established this conversation. Survives turn + step
// boundaries AND context compaction (defineState is structured, not summarized
// away), so a long thread can still recall a link made many turns ago.
//
// Conversation-scoped only: it lives and dies with the session, and never crosses
// into a subagent. Cross-session/shared facts belong in a connection, not here.
//
// grounding: defineState(name, initial) -> StateHandle{get,update} from eve/context
// (node_modules/eve/dist/src/public/definitions/state.d.ts:8-12,37);
// references/components/state.md.
export const links = defineState<Link[]>("shipmate.links", () => []);

// True when two entries share at least one identifier (pr/ticket/linear).
export function sameLink(a: Link, b: Link): boolean {
  return (
    (!!a.pr && a.pr === b.pr) ||
    (!!a.ticket && a.ticket === b.ticket) ||
    (!!a.linear && a.linear === b.linear)
  );
}
