import { isObj, isStr, isIsoish, validateLesson } from './lessons-schema.mjs'

const DECLINE_PATTERNS = [
  /user doesn'?t want to proceed/i,
  /tool use was rejected/i,
  /user rejected/i,
  /rejected by (the )?user/i,
  /operation (was )?(cancelled|canceled) by (the )?user/i,
  /\[request interrupted by user/i,
]

const CORRECTION_STRONG = [
  /\brevert (that|it|this|the)\b/i,
  /\bundo (that|it|this|the)\b/i,
  /\bthat'?s (not|n[o']t) what i (asked|wanted|meant|said)\b/i,
  /\bthat'?s wrong\b/i,
  /\b(that|this|it) is wrong\b/i,
  /\bwrong\b.*\b(again|approach|file|change)\b/i,
  /\bdon'?t do (that|this)\b/i,
  /\bstop doing (that|this)\b/i,
  /\bi (said|told you)\b.*\bnot\b/i,
  /\bput (it|that) back\b/i,
]
const CORRECTION_WEAK = [
  /^\s*no[.,!\s]/i,
  /^\s*nope\b/i,
  /^\s*actually[,\s]/i,
  /\bactually,? (i|we|let'?s|you should)\b/i,
  /\binstead,? (do|use|try)\b/i,
  /\bnot like that\b/i,
]

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'str_replace_editor'])

export const SIGNALS = [
  {
    id: 'retry_after_failure',
    label: 'Failed call retried with a changed approach',
    description:
      'A tool call failed, and a later call to the same tool against the same target — with ' +
      'different input — succeeded. Mistake and fix are both literally in the transcript.',
    threshold: 'retry found within `retryWindow` (default 3) subsequent calls to the same tool, ' +
      'input similarity >= `retrySimilarity` (default 0.4), and the retry must have succeeded.',
    justification:
      'The strongest signal available, because nothing is inferred: the failing input and the ' +
      'working input are both recorded. The window exists because unrelated reads routinely sit ' +
      'between a failure and its retry; the similarity floor stops an unrelated later call to the ' +
      'same tool from being read as a fix. Requiring the retry to succeed is what makes it a fix ' +
      'rather than more of the same failure (which signal `failure_run` covers instead).',
  },
  {
    id: 'edit_thrash',
    label: 'One file edited many times in a session',
    description: 'The same file was edited `thrashThreshold`+ times, suggesting the change was not understood before it was attempted.',
    threshold: '>= `thrashThreshold` edit-tool calls (default 5) resolving to one file path.',
    justification:
      'Threshold taken from the research note (5+). Held there rather than tuned down: 3-4 edits ' +
      'to one file is ordinary iterative work, and a ledger that flags ordinary work gets ignored ' +
      'wholesale. The lesson is deliberately weaker in wording than the retry signal, because ' +
      'thrashing is a symptom whose cause is not in the transcript.',
  },
  {
    id: 'user_correction',
    label: 'User reversed or corrected the previous instruction',
    description: 'A human turn that contradicts what was just done ("no", "wrong", "actually", "revert that").',
    threshold:
      'A human message matching a strong pattern (confidence 0.7) or a weak pattern (0.45, below ' +
      'the default floor), which must not be the first message of the session.',
    justification:
      'A correction is the user stating a rule directly, so the `fix` field can quote them rather ' +
      'than paraphrase. Split into strong/weak because "actually" and a leading "no" appear ' +
      'constantly in ordinary conversation; scoring them below the default floor means they are ' +
      'available to a caller who lowers it, and invisible to one who does not.',
  },
  {
    id: 'failure_run',
    label: 'Consecutive failing tool calls',
    description: 'A run of `failureRunThreshold`+ tool results in a row came back as errors, with no success between.',
    threshold: '>= `failureRunThreshold` (default 3) consecutive `is_error` results, declines excluded.',
    justification:
      'Three is the point where a run stops looking like one bad command and starts looking like a ' +
      'wrong approach being repeated. Declines neither count toward a run nor extend one — they ' +
      'end it, because a human intervening is a different event from a tool failing. `fix` stays ' +
      '"unknown" unless a successful call ends the run, since otherwise the transcript does not ' +
      'say what worked.',
  },
]

export const DEFAULT_DERIVE_OPTS = {
  maxLessons: 20,
  minConfidence: 0.5,
  thrashThreshold: 5,
  failureRunThreshold: 3,
  retryWindow: 3,
  retrySimilarity: 0.4,
  includeSidechains: false,
}

const clamp01 = n => (n < 0 ? 0 : n > 1 ? 1 : Math.round(n * 100) / 100)
const ceil = (n, max) => clamp01(Math.min(n, max))

const tokens = s =>
  new Set(
    String(s)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(t => t.length > 1)
  )

function jaccard(a, b) {
  const A = tokens(a)
  const B = tokens(b)
  if (A.size === 0 && B.size === 0) return 1
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  return inter / (A.size + B.size - inter)
}

function blocksOf(rec) {
  const c = rec && rec.message && rec.message.content
  if (Array.isArray(c)) return c.filter(isObj)
  return []
}

function userText(rec) {
  const c = rec && rec.message && rec.message.content
  if (isStr(c)) return c
  if (Array.isArray(c)) {
    return c
      .filter(b => isObj(b) && b.type === 'text' && isStr(b.text))
      .map(b => b.text)
      .join('\n')
  }
  return ''
}

function resultText(block, rec) {
  const c = block && block.content
  if (isStr(c)) return c
  if (Array.isArray(c)) {
    return c
      .filter(b => isObj(b) && isStr(b.text))
      .map(b => b.text)
      .join('\n')
  }
  if (isStr(rec && rec.toolUseResult)) return rec.toolUseResult
  return ''
}

function targetOf(name, input) {
  if (!isObj(input)) return null
  const p = input.file_path || input.filePath || input.notebook_path || input.path
  if (isStr(p) && p.trim()) return p.trim()
  if (isStr(input.command) && input.command.trim()) return `$ ${input.command.trim()}`
  if (isStr(input.pattern) && input.pattern.trim()) return `/${input.pattern.trim()}/`
  return null
}

function inputString(input) {
  if (!isObj(input)) return ''
  try {
    return JSON.stringify(input)
  } catch {
    return ''
  }
}

const snip = (s, n = 160) => {
  const one = String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n - 1)}…` : one
}

const evRef = rec => ({
  uuid: isStr(rec && rec.uuid) && rec.uuid ? rec.uuid : null,
  ts: isIsoish(rec && rec.timestamp) ? rec.timestamp : null,
})

/**
 * Propose lessons from transcript records. Never throws. Pure.
 *
 * Every proposal is `status: 'proposed'` and carries `evidence` naming the records that produced
 * it; candidates that end up with no resolvable evidence are dropped and counted, never emitted.
 *
 * Confidence: each signal has a floor reflecting how much of the claim is observed versus
 * inferred (retry 0.6, correction 0.7 strong / 0.45 weak, failure run 0.55, thrash 0.5), plus
 * small bonuses for corroborating detail — an identical target, an immediate retry, more repeats
 * than the threshold. Ceilings sit at 0.9 or below: nothing here is certain, and a 1.0 on a
 * derived instruction would be a lie about the method.
 *
 * @param {object[]} records Transcript records (JSONL objects), in file order.
 * @param {object} [opts] See DEFAULT_DERIVE_OPTS. Unknown keys ignored.
 * @returns {{lessons: object[], stats: object, limits: object}}
 */
export function deriveLessons(records, opts) {
  const o = { ...DEFAULT_DERIVE_OPTS, ...(isObj(opts) ? opts : {}) }
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  o.maxLessons = Math.max(0, Math.floor(num(o.maxLessons, DEFAULT_DERIVE_OPTS.maxLessons)))
  o.minConfidence = num(o.minConfidence, DEFAULT_DERIVE_OPTS.minConfidence)
  o.thrashThreshold = Math.max(2, Math.floor(num(o.thrashThreshold, DEFAULT_DERIVE_OPTS.thrashThreshold)))
  o.failureRunThreshold = Math.max(2, Math.floor(num(o.failureRunThreshold, DEFAULT_DERIVE_OPTS.failureRunThreshold)))
  o.retryWindow = Math.max(1, Math.floor(num(o.retryWindow, DEFAULT_DERIVE_OPTS.retryWindow)))
  o.retrySimilarity = num(o.retrySimilarity, DEFAULT_DERIVE_OPTS.retrySimilarity)

  const stats = {
    records: Array.isArray(records) ? records.length : 0,
    considered: 0,
    skippedNonRecord: 0,
    skippedSidechain: 0,
    toolCalls: 0,
    toolResults: 0,
    failures: 0,
    declines: 0,
    candidates: 0,
    dropped: { ungrounded: 0, lowConfidence: 0, invalid: 0, duplicate: 0, overCap: 0 },
  }
  const limits = {
    maxLessons: o.maxLessons,
    capApplied: false,
    minConfidence: o.minConfidence,
    thresholds: {
      thrashThreshold: o.thrashThreshold,
      failureRunThreshold: o.failureRunThreshold,
      retryWindow: o.retryWindow,
      retrySimilarity: o.retrySimilarity,
    },
    includeSidechains: !!o.includeSidechains,
  }

  if (!Array.isArray(records)) {
    return { lessons: [], stats, limits }
  }

  const recs = []
  for (const r of records) {
    if (!isObj(r)) {
      stats.skippedNonRecord++
      continue
    }
    if (r.isSidechain === true && !o.includeSidechains) {
      stats.skippedSidechain++
      continue
    }
    recs.push(r)
  }
  stats.considered = recs.length

  const calls = []
  const callById = new Map()
  const resultsById = new Map()
  const humanTurns = []

  recs.forEach((rec, index) => {
    const blocks = blocksOf(rec)
    let sawToolResult = false
    for (const b of blocks) {
      if (b.type === 'tool_use') {
        stats.toolCalls++
        const call = {
          id: isStr(b.id) ? b.id : null,
          name: isStr(b.name) ? b.name : 'unknown',
          input: isObj(b.input) ? b.input : {},
          rec,
          index,
          order: calls.length,
        }
        call.target = targetOf(call.name, call.input)
        calls.push(call)
        if (call.id) callById.set(call.id, call)
      } else if (b.type === 'tool_result') {
        sawToolResult = true
        stats.toolResults++
        const text = resultText(b, rec)
        const declined = DECLINE_PATTERNS.some(p => p.test(text))
        const failed = b.is_error === true && !declined
        if (declined) stats.declines++
        if (failed) stats.failures++
        const entry = { id: isStr(b.tool_use_id) ? b.tool_use_id : null, rec, index, text, declined, failed, isError: b.is_error === true }
        if (entry.id) resultsById.set(entry.id, entry)
      }
    }
    if (rec.type === 'user' && !sawToolResult) {
      const text = userText(rec)
      if (text.trim()) humanTurns.push({ rec, index, text })
    }
  })

  for (const c of calls) c.result = c.id ? resultsById.get(c.id) || null : null

  const taskHint = (() => {
    const first = humanTurns[0]
    return first ? snip(first.text, 120) : 'unknown'
  })()

  const candidates = []
  const push = c => {
    stats.candidates++
    candidates.push(c)
  }

  calls.forEach((call, i) => {
    if (!call.result || !call.result.failed) return
    let searched = 0
    for (let j = i + 1; j < calls.length && searched < o.retryWindow; j++) {
      const next = calls[j]
      if (next.name !== call.name) continue
      searched++
      const sameInput = inputString(next.input) === inputString(call.input)
      if (sameInput) continue
      const sim = jaccard(inputString(call.input), inputString(next.input))
      const sameTarget = call.target !== null && next.target === call.target
      if (!sameTarget && sim < o.retrySimilarity) continue
      if (!next.result || next.result.failed || next.result.declined || next.result.isError) continue

      let confidence = 0.6
      if (sameTarget) confidence += 0.15
      if (searched === 1 && j === i + 1) confidence += 0.1
      if (sim >= 0.7) confidence += 0.05

      const cmd = isStr(next.input && next.input.command) ? next.input.command : ''
      const tests = /\b(npm (run )?test|node --test|pytest|vitest|jest)\b/.test(cmd) ? [cmd.trim()] : []

      push({
        signal: 'retry_after_failure',
        confidence: clamp01(confidence),
        ts: (call.result.rec && call.result.rec.timestamp) || call.rec.timestamp,
        task: taskHint,
        mistake:
          `${call.name} failed on ${call.target || 'an unrecorded target'}: ${snip(call.result.text, 140)}`,
        rule:
          `Before calling ${call.name} on ${call.target || 'this target'}, account for the failure ` +
          `"${snip(call.result.text, 80)}" — the same call succeeded only after its input changed.`,
        fix: `Retried ${next.name} with changed input (${snip(inputString(next.input), 140)}) and it succeeded.`,
        tests,
        evidence: [
          { ...evRef(call.rec), note: `failing ${call.name} call` },
          { ...evRef(call.result.rec), note: 'error result' },
          { ...evRef(next.rec), note: `succeeding ${next.name} retry` },
        ],
        key: `retry:${call.rec.uuid || call.order}:${next.rec.uuid || next.order}`,
      })
      break
    }
  })

  const byFile = new Map()
  for (const call of calls) {
    if (!EDIT_TOOLS.has(call.name)) continue
    const f = isStr(call.input.file_path || call.input.filePath || call.input.notebook_path)
      ? (call.input.file_path || call.input.filePath || call.input.notebook_path).trim()
      : null
    if (!f) continue
    if (!byFile.has(f)) byFile.set(f, [])
    byFile.get(f).push(call)
  }
  for (const [file, group] of byFile) {
    if (group.length < o.thrashThreshold) continue
    const over = group.length - o.thrashThreshold
    const last = group[group.length - 1]
    push({
      signal: 'edit_thrash',
      confidence: ceil(0.5 + 0.05 * over, 0.85),
      ts: last.rec.timestamp,
      task: taskHint,
      mistake: `${file} was edited ${group.length} times in one session (threshold ${o.thrashThreshold}).`,
      rule:
        `Read ${file} in full and settle the intended end state before editing it; ${group.length} ` +
        `edits in one session is a sign the change was attempted before it was understood.`,
      fix: 'unknown',
      tests: [],
      evidence: group.map((c, i) => ({ ...evRef(c.rec), note: `edit ${i + 1} of ${group.length}` })),
      key: `thrash:${file}`,
    })
  }

  humanTurns.forEach((turn, i) => {
    if (turn.index === 0 || i === 0) return
    const text = turn.text
    const strong = CORRECTION_STRONG.find(p => p.test(text))
    const weak = strong ? null : CORRECTION_WEAK.find(p => p.test(text))
    if (!strong && !weak) return
    const prior = humanTurns[i - 1]
    const evidence = [{ ...evRef(turn.rec), note: 'corrective user message' }]
    if (prior) evidence.push({ ...evRef(prior.rec), note: 'instruction being corrected' })
    push({
      signal: 'user_correction',
      confidence: strong ? 0.7 : 0.45,
      ts: turn.rec.timestamp,
      task: prior ? snip(prior.text, 120) : taskHint,
      mistake: `The user reversed the preceding work: "${snip(text, 160)}"`,
      rule:
        `Confirm the intended change against the user's stated constraint before acting; this turn ` +
        `had to be corrected with "${snip(text, 100)}".`,
      fix: snip(text, 200),
      tests: [],
      evidence,
      key: `correction:${turn.rec.uuid || turn.index}`,
    })
  })

  let run = []
  const flushRun = endedBy => {
    if (run.length >= o.failureRunThreshold) {
      const names = [...new Set(run.map(c => c.name))]
      const over = run.length - o.failureRunThreshold
      push({
        signal: 'failure_run',
        confidence: ceil(0.55 + 0.05 * over, 0.8),
        ts: (run[run.length - 1].result.rec && run[run.length - 1].result.rec.timestamp) || run[run.length - 1].rec.timestamp,
        task: taskHint,
        mistake:
          `${run.length} tool calls failed in a row (${names.join(', ')}). Last error: ` +
          `${snip(run[run.length - 1].result.text, 140)}`,
        rule:
          `After ${o.failureRunThreshold} consecutive tool failures, stop and re-check the ` +
          `assumption behind the approach instead of reissuing variations of it.`,
        fix: endedBy
          ? `The run ended when ${endedBy.name} succeeded (${snip(inputString(endedBy.input), 120)}).`
          : 'unknown',
        tests: [],
        evidence: run.map((c, i) => ({ ...evRef(c.rec), note: `failure ${i + 1} of ${run.length}: ${snip(c.result.text, 80)}` })),
        key: `run:${run[0].rec.uuid || run[0].order}:${run.length}`,
      })
    }
    run = []
  }
  for (const call of calls) {
    const res = call.result
    if (!res) continue
    if (res.declined) {
      flushRun(null)
      continue
    }
    if (res.failed) run.push(call)
    else flushRun(call)
  }
  flushRun(null)

  const seen = new Set()
  const kept = []
  for (const c of candidates) {
    const evidence = c.evidence.filter(e => e && (e.uuid || isIsoish(e.ts)))
    if (evidence.length === 0) {
      stats.dropped.ungrounded++
      continue
    }
    if (c.confidence < o.minConfidence) {
      stats.dropped.lowConfidence++
      continue
    }
    if (seen.has(c.key)) {
      stats.dropped.duplicate++
      continue
    }
    seen.add(c.key)

    const v = validateLesson({
      ts: isIsoish(c.ts) ? c.ts : 'unknown',
      task: c.task,
      mistake: c.mistake,
      evidence,
      rule: c.rule,
      fix: c.fix,
      tests: c.tests,
      status: 'proposed',
      confidence: c.confidence,
      signal: c.signal,
    })
    if (!v.ok) {
      stats.dropped.invalid++
      continue
    }
    kept.push(v.normalized)
  }

  kept.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence
    const at = a.ts === 'unknown' ? Infinity : Date.parse(a.ts)
    const bt = b.ts === 'unknown' ? Infinity : Date.parse(b.ts)
    return at - bt
  })

  let lessons = kept
  if (kept.length > o.maxLessons) {
    lessons = kept.slice(0, o.maxLessons)
    stats.dropped.overCap = kept.length - o.maxLessons
    limits.capApplied = true
  }

  return { lessons, stats, limits }
}
