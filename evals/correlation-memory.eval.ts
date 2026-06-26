import { defineEval } from "eve/evals";

// Proves cross-turn durable memory (defineState via agent/lib/memory.ts): a fact
// recorded in turn 1 round-trips through state and is recalled in turn 2 of the
// SAME session. The recall_links output must contain the remembered ticket id —
// that's the proof the write reached durable state and was read back, not just
// answered from conversation history.
export default defineEval({
  description:
    "Shipmate remembers a PR↔ticket link across turns: remember_link in turn 1, recall_links returns it in turn 2.",
  async test(t) {
    await t.send(
      "Remember this for later: the pull request https://github.com/acme/widgets/pull/7 implements ticket ENG-12, and its review failed the test check. Record it.",
    );
    await t.send(
      "Using your memory, what did you record about pull request acme/widgets#7? Recall it.",
    );
    t.succeeded();
    t.calledTool("remember_link");
    // The recall returns the stored entry from durable state (contains ENG-12).
    t.calledTool("recall_links", {
      output: (v: unknown) => JSON.stringify(v ?? "").includes("ENG-12"),
    });
    t.messageIncludes(/ENG-12/);
  },
});
