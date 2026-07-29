// Hand-labelled prompts used to calibrate lib/complexity.mjs tier boundaries.
//
// These labels are a judgement call, not ground truth from users. They were chosen to span the
// range this dashboard actually sees: courtesy and relay turns, one-shot lookups, ordinary
// single-file coding asks, wide-scoped multi-file work, and explicit deliberation requests.
//
// The set is deliberately small enough to read in one sitting. If you disagree with a label,
// change it and rerun the calibration test — that is the intended workflow. What must not
// happen is a dimension weight changing while these silently stop matching.
export const LABELLED_PROMPTS = [
  // Courtesy and control turns — no work requested at all.
  ['simple', 'ok'],
  ['simple', 'thanks'],
  ['simple', 'yes please'],
  ['simple', 'continue'],
  ['simple', 'sounds good'],
  // Single lookups and one-step commands. Cheap regardless of how the answer is produced.
  ['simple', 'what is the capital of France?'],
  ['simple', 'what does ENOENT mean?'],
  ['simple', 'run the tests'],
  ['simple', 'commit and push'],
  ['simple', 'show me the file'],
  // Ordinary development work: one file, one clear change, no deliberation asked for.
  ['standard', 'Add a null check to the parser and update the test.'],
  ['standard', 'Fix the failing test in pricing.test.mjs'],
  ['standard', 'Rename the getUser function to fetchUser in this file.'],
  ['standard', 'Why is this returning undefined?'],
  ['standard', 'Add a retry with backoff to the fetch helper.'],
  ['standard', 'Extract this into a helper and add a unit test.'],
  // Wide blast radius — the work is not harder to reason about, there is just a lot of it.
  ['complex', 'Refactor the auth module across four services so token refresh is shared, then update every caller and add integration tests.'],
  ['complex', 'Migrate the database schema to add a tenant column, backfill existing rows, and update all queries that assume a single tenant.'],
  ['complex', 'Rename this API across the codebase, update every caller, and fix the tests that break.'],
  // Deliberation explicitly requested: weigh options, justify a choice. A different axis from
  // breadth, which is why analyticalReasoning outweighs scopeBreadth.
  ['reasoning', 'Design a caching strategy for this API. Consider read-heavy and write-heavy workloads, evaluate at least three approaches, weigh the tradeoffs of each, and justify your recommendation.'],
  ['reasoning', 'Analyze why our p99 latency regressed. Form hypotheses, evaluate each against the traces, and recommend a fix with rationale.'],
]

export const TIER_RANK_ORDER = ['simple', 'standard', 'complex', 'reasoning']
