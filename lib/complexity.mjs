
export const TIERS = ['simple', 'standard', 'complex', 'reasoning']

export const TIER_RANK = Object.freeze(Object.fromEntries(TIERS.map((t, i) => [t, i])))

export const MAX_SCAN_CHARS = 20000

const phraseRe = phrases =>
  new RegExp(`(?<![\\w-])(?:${phrases.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\w-])`, 'g')

const countMatches = (text, re) => {
  re.lastIndex = 0
  let n = 0
  while (re.exec(text) !== null) n++
  return n
}

const clamp01 = n => (n < 0 ? 0 : n > 1 ? 1 : n)

const KEYWORD_SATURATION = 3

const DOWN_SATURATION = 1

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

const shortTurnScale = ctx => clamp01((60 - ctx.tokens) / 60)

export const DIMENSIONS = Object.freeze([
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

  keyword('analyticalReasoning', 0.11, 'up', [
    'analyze', 'analyse', 'evaluate', 'compare', 'contrast', 'trade-off', 'tradeoff',
    'root cause', 'implication', 'implications', 'assess', 'critique', 'justify', 'rationale',
    'weigh', 'pros and cons', 'reason about',
    'consider', 'approaches', 'recommend', 'recommendation', 'hypothes', 'strategy',
    'design a', 'weigh the', 'at least three', 'form hypotheses',
  ]),

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


  structural('tokenCount', 0.05, 'up', ctx => clamp01(ctx.tokens / 2000)),

  structural('expectedOutputLength', 0.04, 'up', ctx => {
    const phrases = countMatches(ctx.text, EXPECTED_OUTPUT_RE)
    const explicit = /\b(\d{2,5})\s*(words|word|pages|paragraphs|examples|items|rows|bullets)\b/.exec(ctx.text)
    const explicitScore = explicit ? clamp01(Number(explicit[1]) / 500) : 0
    return clamp01(phrases / 2 + explicitScore)
  }),

  structural('toolCount', 0.04, 'up', ctx => clamp01(ctx.tools.length / 5)),

  structural('nestedListDepth', 0.03, 'up', ctx => clamp01((ctx.listDepth - 1) / 3)),

  structural('conditionalLogic', 0.03, 'up', ctx => clamp01(countMatches(ctx.text, CONDITIONAL_RE) / 4)),

  structural('scopeBreadth', 0.06, 'up', ctx => clamp01(countMatches(ctx.text, SCOPE_BREADTH_RE) / 4)),

  structural('clauseCount', 0.05, 'up', ctx => clamp01(countMatches(ctx.text, CLAUSE_JOIN_RE) / 4)),

  structural('constraintDensity', 0.03, 'up', ctx => {
    const per100 = (countMatches(ctx.text, CONSTRAINT_RE) / Math.max(ctx.tokens, 20)) * 100
    return clamp01(per100 / 5)
  }),

  structural('conversationDepth', 0.03, 'up', ctx => clamp01(ctx.depth / 10)),

  structural('codeToProse', 0.02, 'up', ctx => clamp01(ctx.codeChars / Math.max(ctx.chars, 1))),

  structural('repetitionRequests', 0.02, 'up', ctx => clamp01(countMatches(ctx.text, REPETITION_RE) / 3)),

  structural('questionCount', 0.02, 'up', ctx => clamp01(ctx.questions / 4)),
])

const EXPECTED_OUTPUT_RE = phraseRe([
  'comprehensive', 'detailed', 'in depth', 'in-depth', 'exhaustive', 'thorough', 'essay',
  'full report', 'write up', 'write-up', 'long form', 'long-form', 'as much detail',
  'complete list', 'everything',
])

const SCOPE_BREADTH_RE = /\b(across|every|all (?:the |of the )?\w+|each|throughout|codebase|everywhere|multiple|several|\d+\s+(?:services|files|modules|packages|repos|components|callers|places))\b/gi
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

export const DIMENSION_COUNT = DIMENSIONS.length

export const WEIGHT_BUDGET = Object.freeze(
  DIMENSIONS.reduce(
    (acc, d) => (d.direction === 'down' ? { ...acc, down: acc.down + d.weight } : { ...acc, up: acc.up + d.weight }),
    { up: 0, down: 0 },
  ),
)

export const BOUNDARIES = Object.freeze({ simpleMax: 0.034, standardMax: 0.092, complexMax: 0.158 })

export function tierFor(score) {
  if (!Number.isFinite(score)) return null
  if (score <= BOUNDARIES.simpleMax) return 'simple'
  if (score <= BOUNDARIES.standardMax) return 'standard'
  if (score <= BOUNDARIES.complexMax) return 'complex'
  return 'reasoning'
}

export function boundaryDistance(score) {
  const edges = [BOUNDARIES.simpleMax, BOUNDARIES.standardMax, BOUNDARIES.complexMax]
  return Math.min(...edges.map(e => Math.abs(score - e)))
}

export const CONFIDENCE = Object.freeze({ k: 60, midpoint: 0.015, threshold: 0.45 })

export const computeConfidence = score =>
  Number.isFinite(score) ? 1 / (1 + Math.exp(-CONFIDENCE.k * (boundaryDistance(score) - CONFIDENCE.midpoint))) : 0

export const MOMENTUM_WEIGHT = 0.25

export const TIER_ANCHOR = Object.freeze({
  simple: BOUNDARIES.simpleMax - 0.04,
  standard: (BOUNDARIES.simpleMax + BOUNDARIES.standardMax) / 2,
  complex: (BOUNDARIES.standardMax + BOUNDARIES.complexMax) / 2,
  reasoning: BOUNDARIES.complexMax + 0.09,
})

export function maxTier(a, b) {
  if (!(a in TIER_RANK)) return b in TIER_RANK ? b : null
  if (!(b in TIER_RANK)) return a
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b
}


const FENCE_RE = /```[\s\S]*?(?:```|$)/g
const INLINE_CODE_RE = /`[^`\n]+`/g
const LIST_ITEM_RE = /^([ \t]*)(?:[-*+]|\d+[.)])\s+/

function buildContext(raw, opts, truncated) {
  const scanned = truncated.applied ? raw.slice(0, MAX_SCAN_CHARS) : raw
  const lower = scanned.toLowerCase()

  const tokens = Math.round(raw.length / 4)

  let codeChars = 0
  for (const m of scanned.match(FENCE_RE) || []) codeChars += m.length
  for (const m of scanned.replace(FENCE_RE, '').match(INLINE_CODE_RE) || []) codeChars += m.length

  let listDepth = 0
  for (const line of scanned.split('\n')) {
    const m = LIST_ITEM_RE.exec(line)
    if (!m) continue
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
  tier: null,
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
  const weight = previous ? configured * clamp01(previous.confidence ?? 1) : 0
  const score = previous ? rawScore * (1 - weight) + TIER_ANCHOR[previous.tier] * weight : rawScore

  const tierBeforeMomentum = tierFor(rawScore)
  const tier = tierFor(score)
  const confidence = computeConfidence(score)

  return {
    tier,
    confidence,
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
