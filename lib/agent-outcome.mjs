// Did the agent actually run?
//
// A `claude -p` child that hits an account limit EXITS 0 and prints the notice as its result:
//
//     You've hit your session limit · resets 4:20am (Asia/Amman)
//
// So `!error` does not mean "it ran". On the board this read as a successful review with zero
// findings, and zero findings is a clean review — ticket AIR-10733 was promoted to `ready-for-qa`
// on a review that never happened. Absence of findings is not absence of problems, which is the
// same failure the empty canvas and the sign-in page saved as `content.csv` already taught us.
//
// The counter-risk is real and is why this file is deliberately timid: `reconcileOrphanedRuns`
// (`server/board.mjs`) once wrote a bogus "lost" run against an agent that was working perfectly,
// and a false positive here would block a ticket whose work genuinely happened. So the test is
// short AND matching — never matching alone.

const LIMIT = /(hit (?:your|the) [^.\n]{0,20}limit|usage limit reached|limit reached[^\n]{0,20}reset|out of (?:usage|credits))/i
// The reset time is the one actionable fact in a limit notice — "come back after 4:20am" is a
// plan; "the agent hit a limit" is not. Kept verbatim rather than parsed into a Date: the notice
// carries a timezone we do not want to reinterpret.
const RESET = /(?:resets?|will reset)\b[^\n]{0,48}/i

// A limit notice is a one-line banner and nothing else. A 40KB review that happens to contain the
// word "limit" is a real review, so length is what separates the two — matching alone would stall
// genuine work, and stalling genuine work is worse than the bug this catches.
const BANNER_CHARS = 400

/**
 * Why this agent's output cannot be trusted as a result — or `null` when it looks like one.
 *
 * `error` is passed through unchanged so a caller can make ONE check instead of two; every caller
 * already treats a non-null reason the way it treated `error`.
 */
export function unfinishedReason(result, error) {
  if (error) return String(error)
  const text = String(result ?? '').trim()
  if (!text) return 'the agent returned no output at all'
  if (text.length > BANNER_CHARS || !LIMIT.test(text)) return null
  const reset = RESET.exec(text)
  return `the agent hit an account limit instead of running${reset ? ` — ${reset[0].trim()}` : ''}, so nothing was produced`
}
