import { disableTool } from "eve/tools";

/**
 * Disable the built-in `bash` tool for the model.
 *
 * Shipmate runs untrusted PR code in the sandbox and feeds its output (logs, test
 * results) back to the model — a prompt-injection surface. The model has no
 * legitimate need for arbitrary shell: `review_pr` reaches the sandbox directly
 * via `ctx.getSandbox()`, and write-back posts through the `github__*` connection.
 * Removing `bash` means an injection in PR output has no shell to execute.
 *
 * eve recommends exactly this lock-down (docs/concepts/default-harness.md:87).
 * Disabling the model-facing tool does NOT affect `ctx.getSandbox()` in review_pr.
 */
export default disableTool();
