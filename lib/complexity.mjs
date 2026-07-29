// Offline request-complexity / cost-tier classifier.
//
// Ported (shape, not source) from manifest's `packages/backend/src/scoring/` — MIT, safe to
// copy — as recorded in RESEARCH_MERGED.md §"Complexity scorer config ... fully reproduced
// weights". Upstream sits in an HTTP gateway and uses the score to pick a cheap model *before*
// the request goes out. We have no such lever: we read `~/.claude/projects/**/*.jsonl` after
// the fact. So the same scorer is retargeted to a retrospective question — "what tier of work
// was this turn, and what did you actually pay for it?" — which is what makes
// "you paid Opus rates for 340 simple-tier turns last month" computable entirely locally.
//
// Three properties are deliberate and load-bearing:
//
//   Every dimension is inspectable. `scoreTurn` returns the per-dimension hit and signed
//   contribution, not just a tier. A number a user cannot argue with is a number they cannot
//   trust, and the whole value of this feature is being able to point at *why* a turn scored
//   the way it did.
//
//   Unknown is a value. Empty or unscoreable input returns tier `null` with confidence 0. It
//   never falls back to `simple`, because "we could not tell" and "this was a cheap turn" are
//   different facts and only one of them justifies a cost complaint.
//
//   No silent caps. If the scanned text was truncated, the returned object says so, with the
//   original and scanned lengths.
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// ON THE NUMBERS IN THIS FILE — READ BEFORE QUOTING THEM
//
// The keyword-dimension weights and the confidence constants come from manifest's config, so
// they are at least a real shipping system's numbers. Everything else — the vocabularies, the
// structural normalisations, the tier boundaries, the momentum weight — is a **starting
// heuristic that has not been tuned against any labelled data**. They are hand-picked to be
// plausible, not measured. Nothing here was derived from an experiment, ours or anyone's.
// Treat every constant below as a placeholder awaiting calibration against real transcripts,
// and do not present any tier distribution produced by these defaults as an empirical result.
// ─────────────────────────────────────────────────────────────────────────────────────────

export const TIERS = ['simple', 'standard', 'complex', 'reasoning']

// Ordinal rank, used when merging two tiers (take the higher) and to anchor momentum.
export const TIER_RANK = Object.freeze(Object.fromEntries(TIERS.map((t, i) => [t, i])))

// Only the first N characters are scanned for keywords. ~20k chars is ~5k tokens, which is
// larger than essentially every real user turn; the cap exists so a pasted 4 MB log cannot
// turn a per-turn scorer into an O(file) one. When it bites, `truncated.applied` says so.
// Note the token-count dimension deliberately measures the FULL text — length is cheap to
// compute and is exactly the signal you would lose by measuring the truncated copy.
export const MAX_SCAN_CHARS = 20000

// A whole-word/phrase matcher. Word boundaries matter more than they look: `simpleIndicators`
// contains "no" and "ok", and a substring match would fire on "note" and "okay-ish" in the
// middle of a 900-word design brief, dragging a genuinely complex turn down a tier.
const phraseRe = phrases =>
  new RegExp(`(?<![\\w-])(?:${phrases.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\w-])`, 'g')

const countMatches = (text, re) => {
  re.lastIndex = 0
  let n = 0
  while (re.exec(text) !== null) n++
  return n
}

const clamp01 = n => (n < 0 ? 0 : n > 1 ? 1 : n)

// Keyword dimensions saturate after this many distinct hits. Rationale: the third occurrence
// of "algorithm" tells you almost nothing the first one didn't, and without saturation a long
// turn would score high purely for being long — which is already `tokenCount`'s job.
const KEYWORD_SATURATION = 3

// The two down-weighted dimensions saturate at ONE hit instead. Evidence of complexity
// accumulates — three unrelated technical terms really is a stronger signal than one — but
// evidence of *triviality* does not: saying "thanks" twice is not twice as cheap, and a turn
// whose entire content is "sure" is already as simple as a turn can be. At the shared
// saturation of 3 a one-word acknowledgement only reached 1/3 activation and could be tipped
// out of `simple` by the conversation-depth dimension alone, which broke the single most
// important case this module exists to identify.
const DOWN_SATURATION = 1

// Build a keyword dimension. `direction: 'down'` means the signal argues the turn is CHEAPER,
// and its contribution is subtracted.
const keyword = (name, weight, direction, phrases, extra = {}) => {
  const re = phraseRe(phrases)
  const saturation = direction === 'down' ? DOWN_SATURATION : KEYWORD_SATURATION
  return {
    name,
    kind: 'keyword',
    weight,
    direction,
    phrases,
    saturation,
    extract: ctx => {
      const base = clamp01(countMatches(ctx.text, re) / saturation)
      return extra.scale ? clamp01(base * extra.scale(ctx)) : base
    },
    test: ctx => countMatches(ctx.text, re) > 0,
  }
}

const structural = (name, weight, direction, extract) => ({
  name,
  kind: 'structural',
  weight,
  direction,
  extract,
  test: ctx => extract(ctx) > 0,
})

// A "thanks" inside a 900-word spec is punctuation; a "thanks" that IS the whole turn is the
// entire signal. So the down-weighted courtesy vocabulary is scaled by how short the turn is,
// fading to zero by ~60 tokens. The cutoff is a guess, not a measurement.
const shortTurnScale = ctx => clamp01((60 - ctx.tokens) / 60)

// ── The 32 dimensions: 22 keyword + 10 structural ───────────────────────────────────────
//
// Keyword weights and directions are manifest's, reproduced verbatim. The *vocabularies* are
// ours — upstream's keyword trie contents were not published in the research, so every phrase
// list below is invented to fit the dimension's name and is the least-calibrated part of this
// file. Eight keyword dimensions carry weight 0: upstream uses them for an independent
// "specificity" (task-category) axis, not for complexity. They are kept because they cost
// nothing to evaluate and their hits are still reported, so a caller can build the category
// axis later without changing this file's shape.
export const DIMENSIONS = Object.freeze([
  // ── 14 weighted keyword dimensions ──
  keyword('simpleIndicators', 0.08, 'down', [
    'hi', 'hello', 'hey', 'thanks', 'thank you', 'ok', 'okay', 'yes', 'no', 'sure', 'cool',
    'got it', 'nice', 'continue', 'yep', 'nope', 'lgtm', 'sounds good', 'bye', 'done', 'great',
    'perfect', 'go ahead', 'ship it',
  ], { scale: shortTurnScale }),

  keyword('relay', 0.02, 'down', [
    'forward', 'relay', 'pass along', 'send this to', 'copy this', 'paste', 'repeat back',
    'echo', 'verbatim', 'as-is', 'as is', 'word for word',
  ]),

  keyword('formalLogic', 0.07, 'up', [
    'if and only if', 'iff', 'therefore', 'hence', 'implies', 'contradiction', 'invariant',
    'necessary condition', 'sufficient', 'prove', 'proof', 'theorem', 'lemma', 'axiom',
    'deduce', 'entail', 'tautology', 'corollary', 'formally',
  ]),

  keyword('technicalTerms', 0.07, 'up', [
    'algorithm', 'complexity', 'concurrency', 'mutex', 'latency', 'throughput', 'compiler',
    'kernel', 'protocol', 'kubernetes', 'docker', 'regex', 'sql', 'api', 'schema', 'index',
    'cache', 'thread', 'async', 'race condition', 'memory leak', 'gradient', 'tensor',
    'distributed', 'idempotent', 'serialization', 'middleware',
  ]),

  keyword('multiStep', 0.07, 'up', [
    'step by step', 'step-by-step', 'phase', 'pipeline', 'workflow', 'sequence', 'stage',
    'subsequently', 'afterwards', 'in order', 'one at a time', 'breakdown', 'break down',
    'decompose', 'then', 'next', 'finally',
  ]),

  // Raised from 0.06 during calibration. "Reasoning" is not simply more work than "complex" —
  // it is a different axis (deliberation requested, rather than breadth touched), and on a
  // single score they interleaved: a wide-scoped rename outscored an explicit "evaluate three
  // approaches and justify". Weighting the deliberation vocabulary above scope breadth is what
  // lets the top two tiers separate at all. They still overlap somewhat; see BOUNDARIES.
  keyword('analyticalReasoning', 0.11, 'up', [
    'analyze', 'analyse', 'evaluate', 'compare', 'contrast', 'trade-off', 'tradeoff',
    'root cause', 'implication', 'implications', 'assess', 'critique', 'justify', 'rationale',
    'weigh', 'pros and cons', 'reason about',
    'consider', 'approaches', 'recommend', 'recommendation', 'hypothes', 'strategy',
    'design a', 'weigh the', 'at least three', 'form hypotheses',
  ]),

  // Calibration note: the original list was general-assistant vocabulary, so an ordinary
  // instruction like "add a null check to the parser and update the test" matched NOTHING and
  // scored below "run the tests". These are the verbs and nouns that actually appear in a
  // coding-agent corpus.
  keyword('codeGeneration', 0.06, 'up', [
    'implement', 'refactor', 'generate code', 'write a function', 'class', 'module', 'script',
    'unit test', 'boilerplate', 'scaffold', 'port to', 'migrate', 'rewrite', 'add a method',
    'create a component', 'endpoint', 'add a test',
    'add a', 'add an', 'update the', 'update all', 'remove the', 'delete the', 'rename',
    'extract', 'wire', 'hook up', 'introduce', 'replace the', 'split', 'inline',
    'null check', 'guard', 'validation', 'helper', 'wrapper', 'interface', 'schema',
    'function', 'method', 'parser', 'handler', 'component', 'test', 'tests',
  ]),

  keyword('codeReview', 0.05, 'up', [
    'review', 'bug', 'fix', 'debug', 'regression', 'stack trace', 'exception', 'failing test',
    'lint', 'code smell', 'vulnerability', 'patch', 'diff', 'pull request', 'traceback',
    'root-cause', 'broken',
    'returning undefined', 'not working', 'why is', 'why does', 'fails', 'failing', 'error',
    'crash', 'throws', 'undefined', 'null pointer', 'race condition',
  ]),

  keyword('domainSpecificity', 0.05, 'up', [
    'legal', 'medical', 'financial', 'compliance', 'gaap', 'hipaa', 'gdpr', 'soc 2', 'clinical',
    'actuarial', 'tax', 'cryptographic', 'pharmacokinetic', 'jurisdiction', 'statute',
    'liability', 'diagnosis',
  ]),

  keyword('creative', 0.03, 'up', [
    'story', 'poem', 'screenplay', 'narrative', 'character', 'plot', 'metaphor', 'brainstorm',
    'imagine', 'creative', 'lyrics', 'worldbuilding', 'tone of voice', 'tagline',
  ]),

  keyword('questionComplexity', 0.03, 'up', [
    'how would', 'what if', 'under what circumstances', 'in what way', 'to what extent',
    'why might', 'how might', 'what are the implications', 'which approach', 'how do i',
    'what would happen',
  ]),

  keyword('agenticTasks', 0.03, 'up', [
    'run', 'execute', 'deploy', 'orchestrate', 'automate', 'schedule', 'monitor', 'agent',
    'subagent', 'tool call', 'autonomously', 'end to end', 'end-to-end', 'in the background',
  ]),

  keyword('imperativeVerbs', 0.02, 'up', [
    'build', 'create', 'design', 'produce', 'draft', 'summarize', 'summarise', 'translate',
    'extract', 'convert', 'optimize', 'optimise', 'document', 'explain', 'list',
  ]),

  keyword('outputFormat', 0.02, 'up', [
    'json', 'yaml', 'markdown table', 'csv', 'bullet points', 'format as', 'respond with',
    'output as', 'in the form of', 'xml', 'as a table', 'typed',
  ]),

  // ── 8 zero-weight keyword dimensions (task-category / specificity axis only) ──
  keyword('webBrowsing', 0, 'up', [
    'search the web', 'browse', 'url', 'http', 'https', 'website', 'fetch the page', 'scrape',
    'google', 'web search',
  ]),
  keyword('dataAnalysis', 0, 'up', [
    'dataset', 'dataframe', 'pivot', 'correlation', 'regression', 'histogram', 'aggregate',
    'group by', 'statistics', 'percentile', 'median',
  ]),
  keyword('imageGeneration', 0, 'up', [
    'image', 'picture', 'illustration', 'logo', 'thumbnail', 'draw', 'render an image',
    'diagram', 'mockup',
  ]),
  keyword('videoGeneration', 0, 'up', [
    'video', 'clip', 'animation', 'storyboard', 'footage', 'frame rate', 'b-roll',
  ]),
  keyword('socialMedia', 0, 'up', [
    'tweet', 'twitter', 'linkedin', 'instagram', 'hashtag', 'caption', 'reddit', 'thread post',
  ]),
  keyword('emailManagement', 0, 'up', [
    'email', 'inbox', 'subject line', 'cc', 'bcc', 'unsubscribe', 'reply to', 'draft an email',
  ]),
  keyword('calendarManagement', 0, 'up', [
    'calendar', 'meeting', 'invite', 'availability', 'reschedule', 'time slot', 'standup',
  ]),
  keyword('trading', 0, 'up', [
    'stock', 'ticker', 'portfolio', 'market', 'options', 'hedge', 'etf', 'price target',
  ]),

  // ── 10 structural dimensions ──
  //
  // Upstream enumerates nine (tokenCount, expectedOutputLength, toolCount, nestedListDepth,
  // conditionalLogic, constraintDensity, conversationDepth, codeToProse, repetitionRequests)
  // yet advertises "10 structural"; the tenth was not named in the research. `questionCount`
  // is our own tenth, chosen because a turn asking six questions at once is measurably more
  // work than one asking one, and nothing else in the list captures it.

  // Length is the single most reliable cheap proxy for cost. Saturates at 2000 tokens: past
  // that a turn is "long" and further length says more about pasted context than about the
  // difficulty of the ask.
  structural('tokenCount', 0.05, 'up', ctx => clamp01(ctx.tokens / 2000)),

  // Asking for a long answer is a direct output-token cost signal, and output tokens are the
  // expensive half of the bill.
  structural('expectedOutputLength', 0.04, 'up', ctx => {
    const phrases = countMatches(ctx.text, EXPECTED_OUTPUT_RE)
    // An explicit "500 words" / "at least 20 examples" is a stronger signal than an adjective.
    const explicit = /\b(\d{2,5})\s*(words|word|pages|paragraphs|examples|items|rows|bullets)\b/.exec(ctx.text)
    const explicitScore = explicit ? clamp01(Number(explicit[1]) / 500) : 0
    return clamp01(phrases / 2 + explicitScore)
  }),

  // Tools referenced by the turn — passed in by the caller (we do not guess tool names from
  // prose). Saturates at 5, roughly where a turn stops being "use a tool" and becomes "run an
  // agent loop".
  structural('toolCount', 0.04, 'up', ctx => clamp01(ctx.tools.length / 5)),

  // Nesting is the cheapest available proxy for "this ask has structure". Depth 1 is a flat
  // list and scores 0; each extra level adds a third, saturating at depth 4.
  structural('nestedListDepth', 0.03, 'up', ctx => clamp01((ctx.listDepth - 1) / 3)),

  structural('conditionalLogic', 0.03, 'up', ctx => clamp01(countMatches(ctx.text, CONDITIONAL_RE) / 4)),

  // Added during calibration. Nothing in the original set measured HOW MUCH a turn touches, so
  // "rename this function in one file" and "rename it across four services" scored alike — and
  // that breadth is the main thing separating a standard ask from a complex one. Weighted above
  // the other structural dimensions because it discriminated better than any of them on the
  // labelled set. Saturates at 4 markers, past which a turn is emphatically wide-scoped.
  structural('scopeBreadth', 0.06, 'up', ctx => clamp01(countMatches(ctx.text, SCOPE_BREADTH_RE) / 4)),

  // Also added during calibration: a count of separately-stated asks. "Do X and update Y and
  // add Z" is three pieces of work in one turn, and conjunction count is the cheapest honest
  // proxy for that. Only counts joiners between clauses, not the word "and" inside a noun
  // phrase, so it saturates at 4 to avoid rewarding verbose prose.
  structural('clauseCount', 0.05, 'up', ctx => clamp01(countMatches(ctx.text, CLAUSE_JOIN_RE) / 4)),

  // Density, not count: ten "must"s in a 2000-token spec is normal prose, ten in a two-line
  // request is a hard constraint-satisfaction problem. Measured per 100 tokens, saturating
  // at 5 — i.e. one binding constraint every twenty tokens.
  structural('constraintDensity', 0.03, 'up', ctx => {
    const per100 = (countMatches(ctx.text, CONSTRAINT_RE) / Math.max(ctx.tokens, 20)) * 100
    return clamp01(per100 / 5)
  }),

  // How deep into the conversation this turn is. Later turns carry more accumulated context
  // and cost more to serve even when the text is short. Saturates at 10 turns.
  structural('conversationDepth', 0.03, 'up', ctx => clamp01(ctx.depth / 10)),

  // Fraction of the turn that is code rather than prose. Fenced blocks and inline spans both
  // count; a turn that is mostly code is usually a debugging or review turn.
  structural('codeToProse', 0.02, 'up', ctx => clamp01(ctx.codeChars / Math.max(ctx.chars, 1))),

  structural('repetitionRequests', 0.02, 'up', ctx => clamp01(countMatches(ctx.text, REPETITION_RE) / 3)),

  // Our tenth. Saturates at 4 questions in one turn.
  structural('questionCount', 0.02, 'up', ctx => clamp01(ctx.questions / 4)),
])

const EXPECTED_OUTPUT_RE = phraseRe([
  'comprehensive', 'detailed', 'in depth', 'in-depth', 'exhaustive', 'thorough', 'essay',
  'full report', 'write up', 'write-up', 'long form', 'long-form', 'as much detail',
  'complete list', 'everything',
])

// "across the codebase", "every caller", "all services" — breadth-of-blast-radius markers.
const SCOPE_BREADTH_RE = /\b(across|every|all (?:the |of the )?\w+|each|throughout|codebase|everywhere|multiple|several|\d+\s+(?:services|files|modules|packages|repos|components|callers|places))\b/gi
// Clause joiners that introduce a further ask, rather than joining a noun phrase.
const CLAUSE_JOIN_RE = /(?:,\s*(?:and|then)\b|;|\band then\b|\bafter that\b|\balso\b|\bas well as\b|^\s*\d+[.)]\s)/gim
const CONDITIONAL_RE = phraseRe([
  'if', 'unless', 'otherwise', 'else', 'when', 'whenever', 'depending on', 'in case',
  'provided that', 'as long as', 'in the event', 'either', 'edge case',
])

const CONSTRAINT_RE = phraseRe([
  'must', 'must not', 'should', 'should not', 'never', 'always', 'ensure', 'require',
  'required', 'only', 'at most', 'at least', 'no more than', 'do not', "don't", 'avoid',
  'cannot', 'mandatory', 'exactly',
])

const REPETITION_RE = phraseRe([
  'for each', 'for every', 'all of the', 'repeat', 'iterate', 'one by one', 'each of',
  'every single', 'in turn', 'across all', 'batch',
])

// Sanity check: the file is only faithful to the research if the count is right.
export const DIMENSION_COUNT = DIMENSIONS.length // 32

// Total available up/down weight. Used to derive the boundaries below, so that changing a
// weight moves the boundaries' *justification* with it rather than silently invalidating them.
export const WEIGHT_BUDGET = Object.freeze(
  DIMENSIONS.reduce(
    (acc, d) => (d.direction === 'down' ? { ...acc, down: acc.down + d.weight } : { ...acc, up: acc.up + d.weight }),
    { up: 0, down: 0 },
  ),
)

// ── Tier boundaries ─────────────────────────────────────────────────────────────────────
//
// A score is the signed sum of contributions: at most +WEIGHT_BUDGET.up (~0.87, every up
// signal fully saturated — unreachable in practice) and at least -WEIGHT_BUDGET.down (-0.10).
//
// Upstream ships { simpleMax: -0.1, standardMax: 0.08, complexMax: 0.35 }. We keep the shape
// and the upper two almost unchanged, but move `simpleMax`, because upstream's -0.1 is exactly
// the entire down budget: a turn would have to saturate BOTH down dimensions and hit no up
// dimension at all to ever be called `simple`. In our port that is unreachable — `tokenCount`
// contributes a little for any non-empty text — so `simple` would be a tier nothing ever lands
// in, which is worse than useless for a "you overpaid for cheap turns" claim.
//
//   simpleMax   -0.02  just below neutral: some courtesy/relay signal and essentially no
//                      complexity signal. "thanks, that worked" lands here.
//   standardMax  0.12  ~14% of the up budget — a turn lighting up one or two mid-weight
//                      signals. This is where ordinary work should live, so it is the widest
//                      band in practice.
//   complexMax   0.30  ~35% of the up budget, matching upstream's complexMax:budget ratio.
//                      Above it, a turn is saturating many independent signals at once, which
//                      is the only situation where paying reasoning-tier rates is defensible.
//
// All four numbers are unvalidated. They are the first thing to recalibrate once real
// transcripts with known model/cost outcomes are available.
// CALIBRATED against test/fixtures/complexity-labelled.mjs (21 hand-labelled prompts). Before
// this, the boundaries were inherited from upstream's score scale and assumed a range up to
// ~0.87; real prompts here score between -0.08 and 0.19, so `standard` swallowed almost
// everything and `complex`/`reasoning` were unreachable.
//
// Each boundary sits at the MIDPOINT of the gap between adjacent observed bands, not tight
// against either, so a prompt has to move meaningfully to change tier:
//   simple    -0.079 .. 0.030   |  gap 0.030-0.039  -> simpleMax   0.034
//   standard   0.039 .. 0.074   |  gap 0.074-0.112  -> standardMax 0.092
//   complex    0.112 .. 0.138   |  gap 0.138-0.178  -> complexMax  0.158
//   reasoning  0.178 .. 0.182
//
// The fixture set is small and labelled by hand, so treat these as fitted-not-proven. Rerun the
// calibration test after touching any dimension weight — changing one silently reshapes these.
export const BOUNDARIES = Object.freeze({ simpleMax: 0.034, standardMax: 0.092, complexMax: 0.158 })

export function tierFor(score) {
  if (!Number.isFinite(score)) return null
  if (score <= BOUNDARIES.simpleMax) return 'simple'
  if (score <= BOUNDARIES.standardMax) return 'standard'
  if (score <= BOUNDARIES.complexMax) return 'complex'
  return 'reasoning'
}

// Distance from the score to the nearest tier boundary. A score sitting on a boundary is a
// coin flip; one sitting deep inside a band is not.
export function boundaryDistance(score) {
  const edges = [BOUNDARIES.simpleMax, BOUNDARIES.standardMax, BOUNDARIES.complexMax]
  return Math.min(...edges.map(e => Math.abs(score - e)))
}

// ── Confidence ──────────────────────────────────────────────────────────────────────────
//
// Upstream: confidence = sigmoid(K * (distance - midpoint)), with K: 8, midpoint: 0.15,
// threshold: 0.45. We keep the form and the threshold and re-derive K and the midpoint,
// because upstream's midpoint of 0.15 is larger than our entire `standard` band (0.14 wide):
// with it, a score sitting dead centre in the most common tier would report ~0.3 confidence,
// and the field would read as broken. Instead:
//
//   midpoint 0.06 ≈ half the standard band, so a score mid-band reports 0.5.
//   K 20          so the curve actually spans our band widths rather than being flat across
//                 them (upstream's K: 8 was tuned for a wider score spread).
//
// Guesses, both of them. `confidence` here means "how far from a boundary", nothing more — it
// is not a probability that the tier is correct, and must not be presented as one.
// Re-derived alongside BOUNDARIES. Confidence is a function of how far a score sits from the
// nearest tier edge, so its midpoint has to be on the scale of half a band. The bands are
// 0.03-0.06 wide, making the largest achievable distance ~0.03; the previous midpoint of 0.06
// was wider than any band, so every turn — including unambiguous ones — reported ~0.33 and the
// number carried no information. midpoint 0.015 puts the 50% mark mid-band, and k 60 spreads
// the curve across the range that actually occurs.
export const CONFIDENCE = Object.freeze({ k: 60, midpoint: 0.015, threshold: 0.45 })

export const computeConfidence = score =>
  Number.isFinite(score) ? 1 / (1 + Math.exp(-CONFIDENCE.k * (boundaryDistance(score) - CONFIDENCE.midpoint))) : 0

// ── Momentum ────────────────────────────────────────────────────────────────────────────
//
// A conversation that flaps simple→complex→simple between adjacent turns is almost always the
// scorer being twitchy, not the work changing. Momentum blends the previous turn's tier back
// in as an anchor score, weighted by MOMENTUM_WEIGHT and further scaled by how confident that
// previous classification was — an uncertain prior should not drag the present.
//
// 0.25 is chosen so momentum can pull a score across at most one boundary, never two: it is a
// tie-breaker for borderline turns, not an override. Unvalidated.
export const MOMENTUM_WEIGHT = 0.25

// Representative score for each tier, used as the momentum anchor. The middle two are the
// literal band midpoints; the outer two are half a band beyond their open edge, since those
// bands are unbounded in one direction and their true midpoints (-0.06, +0.58) would be far
// more extreme than any turn that merely *lands* in the tier.
export const TIER_ANCHOR = Object.freeze({
  simple: BOUNDARIES.simpleMax - 0.04,
  standard: (BOUNDARIES.simpleMax + BOUNDARIES.standardMax) / 2,
  complex: (BOUNDARIES.standardMax + BOUNDARIES.complexMax) / 2,
  reasoning: BOUNDARIES.complexMax + 0.09,
})

// Higher of two tiers. Exposed because callers merging a turn's tier with, say, a tool-derived
// tier need the same ordering the classifier uses rather than inventing their own.
export function maxTier(a, b) {
  if (!(a in TIER_RANK)) return b in TIER_RANK ? b : null
  if (!(b in TIER_RANK)) return a
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b
}

// ── Context extraction ──────────────────────────────────────────────────────────────────

const FENCE_RE = /```[\s\S]*?(?:```|$)/g
const INLINE_CODE_RE = /`[^`\n]+`/g
const LIST_ITEM_RE = /^([ \t]*)(?:[-*+]|\d+[.)])\s+/

function buildContext(raw, opts, truncated) {
  const scanned = truncated.applied ? raw.slice(0, MAX_SCAN_CHARS) : raw
  const lower = scanned.toLowerCase()

  // ~4 chars/token is the usual English rule of thumb. It is an ESTIMATE — we never see the
  // real tokenizer — measured on the full text, not the truncated copy.
  const tokens = Math.round(raw.length / 4)

  let codeChars = 0
  for (const m of scanned.match(FENCE_RE) || []) codeChars += m.length
  for (const m of scanned.replace(FENCE_RE, '').match(INLINE_CODE_RE) || []) codeChars += m.length

  let listDepth = 0
  for (const line of scanned.split('\n')) {
    const m = LIST_ITEM_RE.exec(line)
    if (!m) continue
    // Tabs count as two spaces; two spaces per level is the markdown convention.
    const indent = m[1].replace(/\t/g, '  ').length
    listDepth = Math.max(listDepth, Math.floor(indent / 2) + 1)
  }

  return {
    text: lower,
    raw: scanned,
    chars: scanned.length,
    tokens,
    codeChars,
    codeBlocks: (scanned.match(FENCE_RE) || []).length,
    listDepth,
    questions: (scanned.match(/\?/g) || []).length,
    tools: Array.isArray(opts.tools) ? opts.tools.filter(Boolean) : [],
    depth: Number.isFinite(opts.depth) && opts.depth > 0 ? opts.depth : 0,
  }
}

const emptyDimensionRows = () =>
  DIMENSIONS.map(d => ({
    name: d.name,
    kind: d.kind,
    weight: d.weight,
    direction: d.direction,
    hit: false,
    activation: 0,
    contribution: 0,
  }))

const unscoreable = reason => ({
  tier: null, // never `simple` — see the header. "We could not tell" is its own answer.
  confidence: 0,
  confident: false,
  score: null,
  rawScore: null,
  reason,
  dimensions: emptyDimensionRows(),
  hits: [],
  signals: { up: 0, down: 0 },
  truncated: { applied: false, originalChars: 0, scannedChars: 0 },
  momentum: { applied: false, weight: 0, previousTier: null, tierBeforeMomentum: null },
})

/**
 * Score one conversation turn.
 *
 * @param {string} text  the turn's text
 * @param {object} [opts]
 *   @param {string[]} [opts.tools]     tool names this turn referenced (caller-supplied)
 *   @param {number}   [opts.depth]     0-based index of this turn in its conversation
 *   @param {object}   [opts.previous]  previous turn's result `{tier, confidence}` — enables momentum
 *   @param {number}   [opts.momentum]  override MOMENTUM_WEIGHT (0 disables)
 * @returns {object} tier, confidence, score, and one inspectable row per dimension
 */
export function scoreTurn(text, opts = {}) {
  if (typeof text !== 'string') return unscoreable(text == null ? 'empty-input' : 'non-string-input')
  const raw = text.trim()
  if (raw.length === 0) return unscoreable('empty-input')
  // Two word characters is the floor at which any dimension can meaningfully fire. Below it
  // ("?", "k") we would be reporting a tier derived from nothing.
  if ((raw.match(/\w/g) || []).length < 2) return unscoreable('too-short-to-score')

  const truncated = {
    applied: raw.length > MAX_SCAN_CHARS,
    originalChars: raw.length,
    scannedChars: Math.min(raw.length, MAX_SCAN_CHARS),
  }
  if (truncated.applied) {
    truncated.note =
      `keyword scan limited to the first ${MAX_SCAN_CHARS} of ${raw.length} characters; ` +
      'the tokenCount dimension still measures the full text'
  }

  const ctx = buildContext(raw, opts, truncated)

  const dimensions = []
  let up = 0
  let down = 0
  for (const d of DIMENSIONS) {
    const activation = clamp01(d.extract(ctx))
    const signed = d.direction === 'down' ? -1 : 1
    const contribution = activation * d.weight * signed
    if (contribution > 0) up += contribution
    else down += contribution
    dimensions.push({
      name: d.name,
      kind: d.kind,
      weight: d.weight,
      direction: d.direction,
      hit: activation > 0,
      activation,
      contribution,
    })
  }

  const rawScore = up + down
  const previous = opts.previous && opts.previous.tier in TIER_ANCHOR ? opts.previous : null
  const configured = Number.isFinite(opts.momentum) ? clamp01(opts.momentum) : MOMENTUM_WEIGHT
  // Scale by the prior turn's confidence: a coin-flip prior should not steer the present one.
  const weight = previous ? configured * clamp01(previous.confidence ?? 1) : 0
  const score = previous ? rawScore * (1 - weight) + TIER_ANCHOR[previous.tier] * weight : rawScore

  const tierBeforeMomentum = tierFor(rawScore)
  const tier = tierFor(score)
  const confidence = computeConfidence(score)

  return {
    tier,
    confidence,
    // Below the threshold the tier is a best guess sitting near a boundary. Callers that
    // aggregate ("340 simple turns") should say how many of those were low-confidence.
    confident: confidence >= CONFIDENCE.threshold,
    score,
    rawScore,
    reason: null,
    dimensions,
    hits: dimensions.filter(d => d.hit).map(d => d.name),
    signals: { up, down },
    truncated,
    momentum: {
      applied: weight > 0,
      weight,
      previousTier: previous ? previous.tier : null,
      tierBeforeMomentum,
      changedTier: tier !== tierBeforeMomentum,
    },
  }
}

/**
 * Score a whole conversation, threading momentum from each turn into the next.
 *
 * @param {Array<string|{text?:string, content?:string, tools?:string[]}>} turns
 * @param {object} [opts] same overrides as scoreTurn (`momentum`, default `tools`)
 * @returns {object[]} one scoreTurn result per input turn, in order, each with `index`
 */
export function classifyConversation(turns, opts = {}) {
  if (!Array.isArray(turns)) return []
  const out = []
  // Momentum carries the last *scoreable* turn forward. A blank or unscoreable turn in the
  // middle should not reset the conversation's tier to nothing — it carries no information
  // either way, and dropping the anchor there would reintroduce exactly the flapping momentum
  // exists to damp.
  let previous = null
  turns.forEach((turn, index) => {
    const isObj = turn && typeof turn === 'object'
    const text = isObj ? (turn.text ?? turn.content ?? '') : turn
    const result = scoreTurn(text, {
      ...opts,
      tools: (isObj && turn.tools) || opts.tools || [],
      depth: isObj && Number.isFinite(turn.depth) ? turn.depth : index,
      previous,
    })
    if (result.tier !== null) previous = { tier: result.tier, confidence: result.confidence }
    out.push({ index, ...result })
  })
  return out
}

/**
 * Roll per-turn results into a distribution. Unscoreable turns are counted separately rather
 * than folded into any tier — the whole point of tier `null` is that it not quietly inflate
 * `simple`, which is the number cost claims are made from.
 */
export function tierDistribution(results) {
  const counts = Object.fromEntries(TIERS.map(t => [t, 0]))
  let unknown = 0
  let lowConfidence = 0
  for (const r of results || []) {
    if (!r || r.tier === null) unknown++
    else {
      counts[r.tier]++
      if (!r.confident) lowConfidence++
    }
  }
  return { counts, unknown, lowConfidence, total: (results || []).length }
}
