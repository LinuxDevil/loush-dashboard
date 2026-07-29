import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LESSON_STATUS_IDS,
  SIGNALS,
  DEFAULT_DERIVE_OPTS,
  validateLesson,
  normalizeEvidence,
  serializeLesson,
  parseLessonsJsonl,
  deriveLessons,
} from '../../lib/lessons.mjs'

// ── fixture helpers: the real transcript shapes verified in this repo ────────
let clock = 0
const at = () => new Date(Date.UTC(2026, 6, 29, 8, 0, clock++)).toISOString()

const assistantCall = (uuid, id, name, input) => ({
  type: 'assistant',
  uuid,
  timestamp: at(),
  isSidechain: false,
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
})

const toolResult = (uuid, id, text, isError = false) => ({
  type: 'user',
  uuid,
  timestamp: at(),
  isSidechain: false,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: isError }] },
  toolUseResult: isError ? `Error: ${text}` : text,
})

const humanTurn = (uuid, text) => ({
  type: 'user',
  uuid,
  timestamp: at(),
  isSidechain: false,
  message: { role: 'user', content: text },
})

const validLesson = (over = {}) => ({
  ts: '2026-07-29T08:00:00.000Z',
  task: 'wire up the lessons ledger',
  mistake: 'Read was called on a path that does not exist',
  evidence: [{ uuid: 'u1', ts: '2026-07-29T08:00:00.000Z' }],
  rule: 'Confirm a path exists before reading it',
  fix: 'Re-read with the absolute path',
  tests: ['node --test'],
  status: 'proposed',
  ...over,
})

// ── schema / validation ─────────────────────────────────────────────────────

test('a complete lesson validates and normalizes its evidence references', () => {
  const v = validateLesson(validLesson())
  assert.equal(v.ok, true)
  assert.deepEqual(v.errors, [])
  assert.deepEqual(v.normalized.evidence, [{ uuid: 'u1', ts: '2026-07-29T08:00:00.000Z', note: null }])
  assert.equal(v.normalized.status, 'proposed')
})

test('a lesson with no evidence is rejected', () => {
  // The regression this guards: the whole value of this feature is that a lesson is grounded in
  // records the user can go and read. An evidence-free lesson is a hallucinated instruction that
  // the ledger's formatting makes look authoritative.
  for (const bad of [undefined, null, [], 'u1']) {
    const v = validateLesson(validLesson({ evidence: bad }))
    assert.equal(v.ok, false, `evidence ${JSON.stringify(bad)} must not validate`)
    assert.ok(v.errors.some(e => e.field === 'evidence'))
  }
})

test('an evidence reference that names no record is rejected', () => {
  // A note with no uuid and no timestamp cannot be checked against the transcript, so it is
  // commentary, not evidence.
  const v = validateLesson(validLesson({ evidence: [{ note: 'it felt wrong' }] }))
  assert.equal(v.ok, false)
  assert.equal(normalizeEvidence({ note: 'x' }).ok, false)
  assert.equal(normalizeEvidence('u9').value.uuid, 'u9')
})

test('an invalid lesson yields normalized: null so it cannot be written by accident', () => {
  // The regression this guards: returning a best-effort object made `if (v.normalized) write(...)`
  // append invalid rows to the ledger, which is exactly the corruption this module exists to stop.
  const v = validateLesson(validLesson({ mistake: '   ' }))
  assert.equal(v.ok, false)
  assert.equal(v.normalized, null)
})

test('validateLesson never throws on hostile input', () => {
  for (const bad of [null, undefined, 42, 'lesson', [], () => {}, NaN]) {
    const v = validateLesson(bad)
    assert.equal(v.ok, false)
    assert.ok(Array.isArray(v.errors) && v.errors.length > 0)
  }
})

test('a missing task normalizes to "unknown" rather than failing or being invented', () => {
  // House rule: unknown is a value. `task` is frequently unobservable, and guessing it would put
  // fabricated context on a record whose point is that it is factual.
  const v = validateLesson(validLesson({ task: undefined }))
  assert.equal(v.ok, true)
  assert.equal(v.normalized.task, 'unknown')
})

test('ts accepts the literal "unknown" but rejects an unparseable string', () => {
  assert.equal(validateLesson(validLesson({ ts: 'unknown' })).ok, true)
  const v = validateLesson(validLesson({ ts: 'last tuesday' }))
  assert.equal(v.ok, false)
  assert.ok(v.errors.some(e => e.field === 'ts'))
})

test('status is restricted to the documented enum', () => {
  for (const s of LESSON_STATUS_IDS) assert.equal(validateLesson(validLesson({ status: s })).ok, true)
  assert.equal(validateLesson(validLesson({ status: 'maybe' })).ok, false)
  assert.equal(validateLesson(validLesson({ status: undefined })).normalized.status, 'proposed')
})

test('confidence outside [0,1] is an error rather than being clamped silently', () => {
  assert.equal(validateLesson(validLesson({ confidence: 0.6 })).normalized.confidence, 0.6)
  assert.equal(validateLesson(validLesson({ confidence: 1.4 })).ok, false)
  assert.equal(validateLesson(validLesson({ confidence: 'high' })).ok, false)
  assert.equal(validateLesson(validLesson({})).normalized.confidence, null)
})

// ── JSONL ───────────────────────────────────────────────────────────────────

test('a lesson round-trips through serialize and parse', () => {
  const line = serializeLesson(validLesson({ confidence: 0.75, signal: 'retry_after_failure' }))
  const out = parseLessonsJsonl(line)
  assert.equal(out.malformed.length, 0)
  assert.equal(out.lessons.length, 1)
  assert.equal(out.lessons[0].confidence, 0.75)
  assert.equal(out.lessons[0].signal, 'retry_after_failure')
  assert.deepEqual(Object.keys(JSON.parse(line)).slice(0, 8), [
    'ts', 'task', 'mistake', 'evidence', 'rule', 'fix', 'tests', 'status',
  ])
})

test('serializeLesson refuses an invalid lesson instead of writing a broken line', () => {
  // The regression this guards: serializing best-effort put rows into the ledger that could never
  // be read back, so the file grew while the readable history shrank.
  assert.equal(serializeLesson(validLesson({ evidence: [] })), null)
  assert.equal(serializeLesson(null), null)
})

test('a malformed JSONL line is reported with its line number, never dropped', () => {
  // The regression this guards: a parser that `continue`s past a bad line makes a lessons file
  // that quietly loses entries — worse than no lessons file, because the user trusts it.
  const text = [serializeLesson(validLesson()), '{not json', serializeLesson(validLesson({ task: 'second' }))].join('\n')
  const out = parseLessonsJsonl(text)
  assert.equal(out.lessons.length, 2)
  assert.equal(out.malformed.length, 1)
  assert.equal(out.malformed[0].line, 2, 'line numbers are 1-based and count blank lines too')
  assert.equal(out.malformed[0].raw, '{not json')
  assert.match(out.malformed[0].reason, /invalid JSON/)
})

test('a line that is valid JSON but an invalid lesson is reported, not accepted', () => {
  // A row missing `evidence` parses fine as JSON. Accepting it would smuggle an ungrounded lesson
  // into the ledger through the file rather than through derivation.
  const out = parseLessonsJsonl(JSON.stringify({ ...validLesson(), evidence: [] }))
  assert.equal(out.lessons.length, 0)
  assert.equal(out.malformed.length, 1)
  assert.match(out.malformed[0].reason, /evidence/)
  assert.ok(out.malformed[0].errors.some(e => e.field === 'evidence'))
})

test('blank lines are counted rather than reported as malformed', () => {
  const out = parseLessonsJsonl(`\n${serializeLesson(validLesson())}\n\n`)
  assert.equal(out.lessons.length, 1)
  assert.equal(out.malformed.length, 0)
  assert.equal(out.counts.blank, 3)
  assert.equal(out.counts.total, out.counts.parsed + out.counts.malformed + out.counts.blank)
})

test('parseLessonsJsonl never throws on non-string input', () => {
  const out = parseLessonsJsonl(null)
  assert.equal(out.lessons.length, 0)
  assert.equal(out.malformed.length, 1)
  assert.match(out.malformed[0].reason, /not a string/)
})

// ── derivation: the grounding guarantees ────────────────────────────────────

test('an empty or non-array transcript proposes nothing and still reports its limits', () => {
  for (const input of [[], null, undefined, 'records', 42]) {
    const out = deriveLessons(input)
    assert.deepEqual(out.lessons, [])
    assert.equal(out.limits.maxLessons, DEFAULT_DERIVE_OPTS.maxLessons)
  }
})

test('every derived lesson carries evidence and is status proposed', () => {
  // The regression this guards: an emitted lesson with an empty evidence array reads as a vetted
  // rule while being unfalsifiable — the single failure mode this feature must not have.
  const records = [
    humanTurn('h1', 'add the lessons module'),
    assistantCall('a1', 't1', 'Read', { file_path: '/home/user/loush-dashboard/lib/lesson.mjs' }),
    toolResult('r1', 't1', 'File does not exist. Note: your current working directory is /home/user/loush-dashboard.', true),
    assistantCall('a2', 't2', 'Read', { file_path: '/home/user/loush-dashboard/lib/lessons.mjs' }),
    toolResult('r2', 't2', '1  // ok', false),
  ]
  const { lessons } = deriveLessons(records)
  assert.ok(lessons.length > 0, 'this transcript has an observable mistake and fix')
  for (const l of lessons) {
    assert.equal(l.status, 'proposed')
    assert.ok(Array.isArray(l.evidence) && l.evidence.length > 0)
    for (const e of l.evidence) assert.ok(e.uuid || e.ts, 'each reference points at a record')
    assert.ok(l.confidence > 0 && l.confidence <= 1)
  }
})

test('records with no uuid and no timestamp produce no lesson at all', () => {
  // Grounding is checked at emit time, not just at construction: a candidate whose records cannot
  // be located in the transcript is unverifiable, so it is dropped and counted.
  const bare = (id, name, input) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } })
  const bareResult = (id, text) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: true }] } })
  const records = [
    bare('t1', 'Bash', { command: 'node --test lib/a.mjs' }),
    bareResult('t1', 'Exit code 1'),
    bare('t2', 'Bash', { command: 'node --test lib/b.mjs' }),
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'ok', is_error: false }] } },
  ]
  const out = deriveLessons(records)
  assert.deepEqual(out.lessons, [])
  assert.ok(out.stats.dropped.ungrounded > 0, 'the drop is counted, not invisible')
})

test('a user declining a tool call never becomes a lesson', () => {
  // The regression this guards: a decline arrives as is_error:true, so a naive failure detector
  // "learns" from the permission gate and proposes rules for routing around the human.
  const records = [
    humanTurn('h1', 'update the config'),
    assistantCall('a1', 't1', 'Edit', { file_path: '/home/user/loush-dashboard/lib/paths.mjs' }),
    toolResult('r1', 't1', "The user doesn't want to proceed with this tool use. The tool use was rejected.", true),
    assistantCall('a2', 't2', 'Edit', { file_path: '/home/user/loush-dashboard/lib/paths.mjs', old_string: 'a', new_string: 'b' }),
    toolResult('r2', 't2', 'The user doesn\'t want to proceed with this tool use. The tool use was rejected.', true),
    assistantCall('a3', 't3', 'Edit', { file_path: '/home/user/loush-dashboard/lib/paths.mjs', old_string: 'c', new_string: 'd' }),
    toolResult('r3', 't3', "The user doesn't want to proceed with this tool use. The tool use was rejected.", true),
  ]
  const out = deriveLessons(records)
  assert.deepEqual(out.lessons, [], 'three declines in a row are three decisions, not a failure run')
  assert.equal(out.stats.declines, 3)
  assert.equal(out.stats.failures, 0)
})

// ── derivation: the four signals ────────────────────────────────────────────

test('a failed call retried with changed input proposes a retry lesson citing all three records', () => {
  const records = [
    humanTurn('h1', 'read the pricing module'),
    assistantCall('a1', 't1', 'Read', { file_path: '/home/user/loush-dashboard/lib/pricing.js' }),
    toolResult('r1', 't1', 'File does not exist. Note: your current working directory is /home/user/loush-dashboard.', true),
    assistantCall('a2', 't2', 'Read', { file_path: '/home/user/loush-dashboard/lib/pricing.mjs' }),
    toolResult('r2', 't2', 'export const PRICE_PER_M = ...', false),
  ]
  const { lessons } = deriveLessons(records)
  const retry = lessons.find(l => l.signal === 'retry_after_failure')
  assert.ok(retry, 'the mistake and the fix are both literally in this transcript')
  assert.match(retry.mistake, /File does not exist/)
  assert.match(retry.fix, /pricing\.mjs/)
  assert.deepEqual(retry.evidence.map(e => e.uuid), ['a1', 'r1', 'a2'])
})

test('a failure retried identically is not treated as a fix', () => {
  // The regression this guards: an unchanged rerun that happens to succeed (flaky command) is not
  // a lesson — there is no changed approach to record as the fix.
  const records = [
    assistantCall('a1', 't1', 'Bash', { command: 'npm test' }),
    toolResult('r1', 't1', 'Exit code 1', true),
    assistantCall('a2', 't2', 'Bash', { command: 'npm test' }),
    toolResult('r2', 't2', 'ok', false),
  ]
  const { lessons } = deriveLessons(records)
  assert.equal(lessons.filter(l => l.signal === 'retry_after_failure').length, 0)
})

test('a later unrelated call to the same tool is not read as the fix', () => {
  // The regression this guards: matching on tool name alone made any subsequent Bash call look
  // like the remedy, producing confident nonsense pairings.
  const records = [
    assistantCall('a1', 't1', 'Bash', { command: 'python3 scripts/parse.py --strict' }),
    toolResult('r1', 't1', 'Exit code 1\nTraceback (most recent call last):', true),
    assistantCall('a2', 't2', 'Bash', { command: 'git status --short' }),
    toolResult('r2', 't2', '', false),
  ]
  const { lessons } = deriveLessons(records)
  assert.equal(lessons.filter(l => l.signal === 'retry_after_failure').length, 0)
})

test('five edits to one file propose a thrash lesson citing every edit', () => {
  const records = [humanTurn('h1', 'refactor the server')]
  for (let i = 0; i < 5; i++) {
    records.push(assistantCall(`a${i}`, `t${i}`, 'Edit', { file_path: '/home/user/loush-dashboard/server/index.mjs', old_string: `x${i}`, new_string: `y${i}` }))
    records.push(toolResult(`r${i}`, `t${i}`, 'ok', false))
  }
  const { lessons } = deriveLessons(records)
  const thrash = lessons.find(l => l.signal === 'edit_thrash')
  assert.ok(thrash)
  assert.match(thrash.mistake, /edited 5 times/)
  assert.equal(thrash.evidence.length, 5, 'all five edits are cited, not a sample')
  assert.equal(thrash.fix, 'unknown', 'the transcript does not say what the right edit was')
})

test('four edits to one file stay below the threshold', () => {
  // The regression this guards: iterative editing is normal work. A ledger that flags four edits
  // flags every session, and a ledger that flags everything gets ignored entirely.
  const records = []
  for (let i = 0; i < 4; i++) {
    records.push(assistantCall(`a${i}`, `t${i}`, 'Edit', { file_path: '/home/user/loush-dashboard/lib/agent.mjs', old_string: `x${i}`, new_string: `y${i}` }))
    records.push(toolResult(`r${i}`, `t${i}`, 'ok', false))
  }
  assert.equal(deriveLessons(records).lessons.filter(l => l.signal === 'edit_thrash').length, 0)
})

test('a user reversing the previous instruction proposes a correction lesson', () => {
  const records = [
    humanTurn('h1', 'move the pricing table into lib/rates.mjs'),
    assistantCall('a1', 't1', 'Write', { file_path: '/home/user/loush-dashboard/lib/rates.mjs' }),
    toolResult('r1', 't1', 'ok', false),
    humanTurn('h2', 'no, revert that — pricing stays where it is'),
  ]
  const { lessons } = deriveLessons(records)
  const corr = lessons.find(l => l.signal === 'user_correction')
  assert.ok(corr)
  assert.match(corr.fix, /pricing stays where it is/, 'the fix quotes the user rather than paraphrasing')
  assert.deepEqual(corr.evidence.map(e => e.uuid), ['h2', 'h1'])
  assert.equal(corr.confidence, 0.7)
})

test('a weak correction cue scores below the default floor and stays hidden', () => {
  // The regression this guards: "actually" and a leading "no" appear constantly in ordinary
  // conversation. Emitting a rule for each one buries the corrections that mattered.
  const records = [
    humanTurn('h1', 'run the tests'),
    assistantCall('a1', 't1', 'Bash', { command: 'node --test' }),
    toolResult('r1', 't1', 'ok', false),
    humanTurn('h2', 'actually, can you also check the lint config?'),
  ]
  assert.equal(deriveLessons(records).lessons.filter(l => l.signal === 'user_correction').length, 0)
  const lowered = deriveLessons(records, { minConfidence: 0.4 })
  assert.equal(lowered.lessons.filter(l => l.signal === 'user_correction').length, 1, 'available when the caller asks for it')
  assert.ok(deriveLessons(records).stats.dropped.lowConfidence > 0, 'the drop is counted')
})

test('an opening message is never treated as a correction', () => {
  // There is nothing before the first turn to reverse, so "no" there is just a word.
  const records = [humanTurn('h1', 'no rush on this, but revert that old branch when you can')]
  assert.deepEqual(deriveLessons(records).lessons, [])
})

test('three consecutive failures propose a failure-run lesson naming the tools and the last error', () => {
  const records = [
    humanTurn('h1', 'get the build green'),
    assistantCall('a1', 't1', 'Bash', { command: 'npm run build' }),
    toolResult('r1', 't1', 'Exit code 1', true),
    assistantCall('a2', 't2', 'Bash', { command: 'npx vite build' }),
    toolResult('r2', 't2', 'Exit code 144', true),
    assistantCall('a3', 't3', 'Bash', { command: 'node scripts/build.mjs' }),
    toolResult('r3', 't3', 'Exit code 1\nFAILED: browserType.launch', true),
    assistantCall('a4', 't4', 'Bash', { command: 'npm ci && npm run build' }),
    toolResult('r4', 't4', 'built in 7.54s', false),
  ]
  const { lessons } = deriveLessons(records)
  const run = lessons.find(l => l.signal === 'failure_run')
  assert.ok(run)
  assert.match(run.mistake, /3 tool calls failed in a row/)
  assert.match(run.fix, /succeeded/, 'the succeeding call that ended the run is the observable fix')
  assert.equal(run.evidence.length, 3)
})

test('two consecutive failures stay below the run threshold', () => {
  const records = [
    assistantCall('a1', 't1', 'Bash', { command: 'npm run build' }),
    toolResult('r1', 't1', 'Exit code 1', true),
    assistantCall('a2', 't2', 'Bash', { command: 'npm run compile' }),
    toolResult('r2', 't2', 'Exit code 1', true),
  ]
  assert.equal(deriveLessons(records).lessons.filter(l => l.signal === 'failure_run').length, 0)
})

test('a decline in the middle of failures breaks the run rather than extending it', () => {
  // The regression this guards: counting a decline as a link in the chain turned two failures plus
  // a human "no" into a three-failure "wrong approach" lesson about the human's decision.
  const records = [
    assistantCall('a1', 't1', 'Bash', { command: 'rm -rf dist' }),
    toolResult('r1', 't1', 'Exit code 1', true),
    assistantCall('a2', 't2', 'Bash', { command: 'rm -rf build' }),
    toolResult('r2', 't2', 'Exit code 1', true),
    assistantCall('a3', 't3', 'Bash', { command: 'rm -rf node_modules' }),
    toolResult('r3', 't3', "The user doesn't want to proceed with this tool use.", true),
  ]
  const out = deriveLessons(records)
  assert.equal(out.lessons.filter(l => l.signal === 'failure_run').length, 0)
  assert.equal(out.stats.failures, 2)
  assert.equal(out.stats.declines, 1)
})

// ── derivation: bookkeeping and house rules ─────────────────────────────────

test('a tool call with no recorded result counts as neither success nor failure', () => {
  // Unknown is a value: an interrupted session leaves calls without verdicts, and inventing a
  // failure for them would manufacture lessons out of a truncated file.
  const records = [
    assistantCall('a1', 't1', 'Bash', { command: 'npm test' }),
    assistantCall('a2', 't2', 'Bash', { command: 'npm run lint' }),
    assistantCall('a3', 't3', 'Bash', { command: 'npm run build' }),
  ]
  const out = deriveLessons(records)
  assert.deepEqual(out.lessons, [])
  assert.equal(out.stats.failures, 0)
  assert.equal(out.stats.toolCalls, 3)
})

test('the proposal cap is reported alongside how many it dropped', () => {
  // House rule: no silent caps. A user reading five lessons must be able to tell whether that was
  // all of them.
  const records = []
  for (let f = 0; f < 4; f++) {
    for (let i = 0; i < 5; i++) {
      records.push(assistantCall(`a${f}-${i}`, `t${f}-${i}`, 'Edit', { file_path: `/home/user/loush-dashboard/lib/f${f}.mjs`, old_string: `x${i}`, new_string: `y${i}` }))
      records.push(toolResult(`r${f}-${i}`, `t${f}-${i}`, 'ok', false))
    }
  }
  const uncapped = deriveLessons(records)
  assert.equal(uncapped.lessons.length, 4)
  assert.equal(uncapped.limits.capApplied, false)
  const capped = deriveLessons(records, { maxLessons: 2 })
  assert.equal(capped.lessons.length, 2)
  assert.equal(capped.limits.capApplied, true)
  assert.equal(capped.limits.maxLessons, 2)
  assert.equal(capped.stats.dropped.overCap, 2)
})

test('sidechain records are excluded by default and the exclusion is counted', () => {
  const records = []
  for (let i = 0; i < 5; i++) {
    records.push({ ...assistantCall(`a${i}`, `t${i}`, 'Edit', { file_path: '/home/user/loush-dashboard/lib/sub.mjs', old_string: `x${i}`, new_string: `y${i}` }), isSidechain: true })
    records.push({ ...toolResult(`r${i}`, `t${i}`, 'ok', false), isSidechain: true })
  }
  const out = deriveLessons(records)
  assert.deepEqual(out.lessons, [])
  assert.equal(out.stats.skippedSidechain, 10)
  assert.equal(deriveLessons(records, { includeSidechains: true }).lessons.length, 1)
})

test('malformed records are skipped and counted, and derivation never throws', () => {
  const records = [null, 'user said something', 42, [], { type: 'assistant' }, { type: 'user', message: null }]
  const out = deriveLessons(records, null)
  assert.deepEqual(out.lessons, [])
  assert.equal(out.stats.skippedNonRecord, 4)
  assert.equal(out.stats.records, 6)
})

test('proposals come back ordered by confidence, strongest first', () => {
  const records = [
    humanTurn('h1', 'fix the parser'),
    assistantCall('a1', 't1', 'Read', { file_path: '/home/user/loush-dashboard/lib/adf.js' }),
    toolResult('r1', 't1', 'File does not exist.', true),
    assistantCall('a2', 't2', 'Read', { file_path: '/home/user/loush-dashboard/lib/adf.mjs' }),
    toolResult('r2', 't2', 'ok', false),
  ]
  for (let i = 0; i < 5; i++) {
    records.push(assistantCall(`e${i}`, `te${i}`, 'Edit', { file_path: '/home/user/loush-dashboard/lib/adf.mjs', old_string: `x${i}`, new_string: `y${i}` }))
    records.push(toolResult(`re${i}`, `te${i}`, 'ok', false))
  }
  const { lessons } = deriveLessons(records)
  assert.ok(lessons.length >= 2)
  for (let i = 1; i < lessons.length; i++) {
    assert.ok(lessons[i - 1].confidence >= lessons[i].confidence)
  }
})

test('every derived proposal survives its own validator and serializes', () => {
  // The regression this guards: derivation once emitted lessons the ledger could not store, so
  // proposals were shown in the UI and then vanished on write.
  const records = [
    humanTurn('h1', 'get the suite green'),
    assistantCall('a1', 't1', 'Bash', { command: 'node --test test/lib/pricing.js' }),
    toolResult('r1', 't1', 'Exit code 1\nFile does not exist', true),
    assistantCall('a2', 't2', 'Bash', { command: 'node --test test/lib/pricing.test.mjs' }),
    toolResult('r2', 't2', 'pass 12', false),
    humanTurn('h2', "no, that's not what I asked — run the whole suite"),
  ]
  const { lessons } = deriveLessons(records)
  assert.ok(lessons.length > 0)
  for (const l of lessons) {
    assert.equal(validateLesson(l).ok, true)
    const line = serializeLesson(l)
    assert.equal(typeof line, 'string')
    assert.equal(parseLessonsJsonl(line).lessons.length, 1)
  }
})

test('the signal catalogue documents a threshold and a justification for each signal', () => {
  // The catalogue is what a UI renders as "why did this appear?"; an undocumented signal is an
  // unexplainable proposal.
  const ids = SIGNALS.map(s => s.id)
  assert.deepEqual(ids, ['retry_after_failure', 'edit_thrash', 'user_correction', 'failure_run'])
  for (const s of SIGNALS) {
    assert.ok(s.threshold && s.threshold.length > 10)
    assert.ok(s.justification && s.justification.length > 20)
  }
})
