// THROWAWAY — behavior test for correlation-at-the-gate. Deliberate type error
// so review_pr's typecheck fails, forcing a ❌ verdict (so the sticky comment exists
// for the LINKED-WORK line to be appended to). Never merged.
export const _behaviorTestTypeError: number = "this is a string, not a number";
