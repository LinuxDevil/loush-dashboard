// Model pricing. Kept apart from server/index.mjs so it can be exercised directly by tests —
// a silent error here is invisible in the UI but wrong on every dollar figure in the product.
//
// Values are USD per 1,000,000 input tokens, matched in table order. Output and cache rates
// derive from the published Anthropic ratios rather than being listed per model:
//   output 5x input · 5-minute cache write 1.25x · cache read 0.1x
export const PRICE_TABLE = [
  [/opus/, 15],
  [/sonnet/, 3],
  [/haiku/, 1],
  [/fable/, 15], // rate not verified against current pricing docs — carried over from the previous ladder
]

// null, not a default. The previous implementation fell through to Sonnet's rate for anything
// it did not recognise, so a local model or a newly released one was billed at $3/M without
// anything on screen saying so.
export const PRICE_PER_M = model => {
  for (const [re, usd] of PRICE_TABLE) if (re.test(model)) return usd
  return null
}

export const isPriced = model => PRICE_PER_M(model) != null

// An unpriced model contributes 0 rather than NaN, which would poison every downstream sum.
// Callers are expected to surface the unpriced model list alongside the total so a reader can
// tell "nothing was spent" apart from "we hold no rate for this".
export const entryCost = e => {
  const P = PRICE_PER_M(e.model)
  if (P == null) return 0
  return (e.in * P + e.out * P * 5 + e.cc * P * 1.25 + e.cr * P * 0.1) / 1e6
}

// A streaming assistant turn is appended to the transcript repeatedly as it grows, and every
// one of those records carries the same message.id with cumulative usage numbers. Folding them
// all in counts the same turn many times over — measured across real transcripts, 47.8% of
// usage records were repeats and the cost total came out 2.12x high.
//
// Keeps the last record per id (it holds that turn's final numbers) while preserving the
// position of the first sighting, so chronological order survives without a re-sort. Records
// with no id cannot be grouped and are each kept on their own key rather than collapsing
// unrelated turns together.
export function dedupeTurns(records) {
  const turns = new Map()
  let noId = 0
  for (const r of records) turns.set(r.id ? `id:${r.id}` : `n:${noId++}`, r)
  return [...turns.values()]
}
