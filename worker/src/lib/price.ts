/**
 * Price parsing to integer minor units. The sanity check is required:
 * below 100 or above 100,000,000 minor units is a parse failure, return null.
 * Null renders as no price, which is honest. A wrong number is not.
 * Spec: 03-ARCHITECTURE.md §4.4 · test cases in 06-AGENT-BUILD-GUIDE.md §4.3
 * P1 task 9 — not yet written.
 */
export {};
