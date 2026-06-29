// THROWAWAY — test branch only, never merged to main.
// A deliberate TypeScript error so Shipmate's auto-review produces a FAILING
// verdict, exercising the Pillar 2 sticky-comment path (one ❌ marker comment,
// no chatty auto-reply) and a `failure` Check Run conclusion.
export const intentionalTypeError: number = "this is a string, not a number";
