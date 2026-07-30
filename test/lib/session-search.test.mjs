import test from 'node:test'
import assert from 'node:assert/strict'
import {
  searchTranscripts,
  detectAbnormalEnd,
  compactionEvents,
  parseQuery,
  REDACTED_SNIPPET,
} from '../../lib/session-search.mjs'

/**
 * Fixtures below are shaped from REAL records read out of
 * ~/.claude/projects/-home-user-loush-dashboard/ (Claude Code 2.1.220):
 * the main session file and its subagents/agent-*.jsonl children. Field
 * names, block shapes and the null-vs-missing distinctions are copied from
 * that data, not invented. Long text bodies are shortened.
 */

const SESSION = 'bc239e17-2565-5b06-854b-74372ebb3193'

const userText = (text, over = {}) => ({
  parentUuid: '13f5c15f-6381-4c45-891d-c030616fe7cf',
  isSidechain: false,
  promptId: '6eab9caf-c761-4819-a52e-57c973063465',
  type: 'user',
  message: { role: 'user', content: [{ type: 'text', text }] },
  uuid: 'u-1',
  timestamp: '2026-07-29T08:16:42.263Z',
  userType: 'external',
  entrypoint: 'remote_desktop',
  cwd: '/home/user/loush-dashboard',
  sessionId: SESSION,
  version: '2.1.220',
  gitBranch: 'claude/merge-md-output-files-wwp0k3',
  ...over,
})

const assistant = (content, stopReason, over = {}) => ({
  parentUuid: '37a2fe61-b4b6-4de1-9fdc-3c68b1812a25',
  isSidechain: false,
  message: {
    model: 'claude-sonnet-5',
    id: over.messageId ?? 'msg_011CdW1zRMLqFPWU4mouWBcb',
    type: 'message',
    role: 'assistant',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 2,
      cache_creation_input_tokens: 52285,
      cache_read_input_tokens: 0,
      output_tokens: 101,
      service_tier: 'standard',
    },
    diagnostics: null,
  },
  requestId: 'req_011CdW1z',
  type: 'assistant',
  uuid: 'a-1',
  timestamp: '2026-07-29T08:16:45.000Z',
  userType: 'external',
  entrypoint: 'remote_desktop',
  cwd: '/home/user/loush-dashboard',
  sessionId: SESSION,
  version: '2.1.220',
  gitBranch: 'claude/merge-md-output-files-wwp0k3',
  ...over,
})

const toolUseBlock = (id, name, input) => ({ type: 'tool_use', id, name, input, caller: { type: 'direct' } })

const toolResult = (id, content, over = {}) => ({
  parentUuid: 'a-1',
  isSidechain: false,
  promptId: '6eab9caf-c761-4819-a52e-57c973063465',
  type: 'user',
  message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content, is_error: false }] },
  uuid: 'r-1',
  timestamp: '2026-07-29T08:16:46.000Z',
  toolUseResult: { stdout: content, stderr: '', interrupted: false },
  sourceToolAssistantUUID: 'a-1',
  userType: 'external',
  entrypoint: 'remote_desktop',
  cwd: '/home/user/loush-dashboard',
  sessionId: SESSION,
  version: '2.1.220',
  gitBranch: 'claude/merge-md-output-files-wwp0k3',
  ...over,
})

/* --------------------------------------------------------------- 059 */

// Regression: a search that matches inside a Bash command must never echo the
// command back. A transcript full of `export TOKEN=...` would otherwise leak
// every secret to anyone who can type a query.
test('a hit inside a tool input reports the field but redacts the value', () => {
  const records = [
    assistant(
      [toolUseBlock('toolu_019U6aw8wEbjhoxLMLsvyZkA', 'Bash', {
        command: 'curl -H "Authorization: Bearer sk-live-SUPERSECRET" https://api.example.com/deploy',
        description: 'Deploy the service',
      })],
      'tool_use',
    ),
  ]

  const res = searchTranscripts(records, 'deploy')
  const toolHit = res.results.find(r => r.source === 'tool_input')

  assert.ok(toolHit, 'the tool input is searched')
  assert.equal(toolHit.tool, 'Bash')
  assert.equal(toolHit.field, 'command')
  assert.equal(toolHit.snippetRedacted, true)
  assert.ok(toolHit.snippet.includes(REDACTED_SNIPPET))
  assert.ok(!toolHit.snippet.includes('SUPERSECRET'), 'the secret never reaches the snippet')
  assert.ok(!JSON.stringify(res).includes('SUPERSECRET'), 'nor anywhere else in the result')
  assert.equal(toolHit.sessionId, SESSION)
  assert.equal(toolHit.timestamp, '2026-07-29T08:16:45.000Z')
  assert.equal(toolHit.role, 'assistant')
})

// Regression: tool_result content is unbounded command output; searching it
// would reprint whatever a command printed, secrets included.
test('tool results are not searched at all', () => {
  const records = [toolResult('toolu_1', 'AWS_SECRET_ACCESS_KEY=hunter2 unique-marker-xyz')]
  const res = searchTranscripts(records, 'unique-marker-xyz')
  assert.equal(res.total, 0)
  assert.ok(!JSON.stringify(res).includes('hunter2'))
})

// Regression: user and assistant prose IS the point of a search — snippets
// there must show the surrounding words, with the match inside them.
test('a prose hit returns a snippet with the match located in it', () => {
  const records = [
    userText('Lets check the MD files that we outputted and merge them into one file.'),
    assistant([{ type: 'text', text: 'Good, this confirms all 21 projects are represented under "Feature inventory".' }], 'end_turn'),
  ]
  const res = searchTranscripts(records, 'merge')
  assert.equal(res.total, 1)
  assert.equal(res.results[0].source, 'user_text')
  assert.equal(res.results[0].snippetRedacted, false)
  assert.ok(res.results[0].snippet.includes('merge them into one file'))
  assert.equal(res.results[0].role, 'user')
  assert.equal(res.results[0].gitBranch, 'claude/merge-md-output-files-wwp0k3')
})

// Regression: "feature inventory" as a phrase must not match a record that
// merely contains both words far apart, or quoting would be decorative.
test('quoted phrases match as a unit while bare terms match independently', () => {
  const together = userText('all 21 projects are represented under Feature inventory today')
  const apart = userText('the feature list is separate from the inventory of files', { uuid: 'u-2' })
  const records = [together, apart]

  const phrase = searchTranscripts(records, '"feature inventory"')
  assert.equal(phrase.total, 1)
  assert.equal(phrase.results[0].uuid, together.uuid)
  assert.equal(phrase.results[0].matchedIsPhrase, true)

  const terms = searchTranscripts(records, 'feature inventory')
  assert.equal(terms.results.length, 2, 'both records contain both bare terms')
})

// Regression: a cap that silently drops results makes a search lie about how
// much matched. The count of everything found must survive the slice.
test('hitting the result limit is reported, not silently swallowed', () => {
  const records = Array.from({ length: 10 }, (_, i) => userText(`needle number ${i}`, { uuid: `u-${i}` }))
  const res = searchTranscripts(records, 'needle', { limit: 3 })
  assert.equal(res.returned, 3)
  assert.equal(res.total, 10)
  assert.equal(res.truncated, true)
  assert.equal(res.limit, 3)
})

// Regression: a transcript line that failed to parse, or a half-written
// record, used to be enough to blow up a whole search run.
test('malformed records are counted and skipped instead of throwing', () => {
  const records = [null, 'not a record', 42, { type: 'user' }, { type: 'user', message: { content: 7 } }, userText('findme here')]
  const res = searchTranscripts(records, 'findme')
  assert.equal(res.total, 1)
  assert.equal(res.skipped, 3, 'the three non-objects are counted')
})

// Regression: thinking blocks are private reasoning; they should stay out of
// results unless the caller explicitly opts in.
test('thinking blocks are excluded by default and searchable on request', () => {
  const records = [assistant([{ type: 'thinking', thinking: 'the secret plan is codeword-alpha', signature: 'EpECCok' }], null)]
  assert.equal(searchTranscripts(records, 'codeword-alpha').total, 0)
  const opted = searchTranscripts(records, 'codeword-alpha', { includeThinking: true })
  assert.equal(opted.total, 1)
  assert.equal(opted.results[0].source, 'assistant_thinking')
})

// Regression: an empty or whitespace query once matched every record.
test('an empty query returns nothing rather than everything', () => {
  const records = [userText('anything at all')]
  assert.equal(searchTranscripts(records, '').total, 0)
  assert.equal(searchTranscripts(records, '   ').total, 0)
  assert.equal(searchTranscripts(records, null).total, 0)
  assert.equal(searchTranscripts(null, 'x').total, 0)
})

// Regression: an unbalanced quote must be reported, not thrown on, so the UI
// can tell the user why their phrase behaved like loose terms.
test('an unbalanced quote degrades to terms and says so', () => {
  const parsed = parseQuery('"feature inventory')
  assert.equal(parsed.unbalancedQuote, true)
  assert.deepEqual(parsed.phrases, [])
  assert.ok(parsed.terms.includes('feature'))
})

// Regression: user message.content is a bare string on ~6% of real user
// records; treating content as always-an-array missed those entirely.
test('user records whose content is a plain string are searched', () => {
  const records = [userText('ignored', { message: { role: 'user', content: 'a plain string prompt about widgets' } })]
  const res = searchTranscripts(records, 'widgets')
  assert.equal(res.total, 1)
  assert.equal(res.results[0].snippet.includes('widgets'), true)
})

/* --------------------------------------------------------------- 060 */

// Regression: THE expensive false positive. A session that finished its turn
// normally must never be reported as crashed just because the file ends.
test('a session ending on end_turn with every tool answered is clean', () => {
  const records = [
    userText('Lets check the MD files.'),
    assistant([toolUseBlock('toolu_A', 'Bash', { command: 'ls' })], 'tool_use'),
    toolResult('toolu_A', 'README.md'),
    assistant([{ type: 'text', text: 'Done — everything is merged.' }], 'end_turn', { uuid: 'a-2', messageId: 'msg_final', timestamp: '2026-07-29T08:17:00.000Z' }),
  ]
  const res = detectAbnormalEnd(records)
  assert.equal(res.ended, 'clean')
  assert.equal(res.reason, 'terminal-stop-reason:end_turn')
  assert.deepEqual(res.evidence.pendingToolUses, [])
})

// Regression: a clean session that has simply been idle for days must stay
// clean — silence after a finished turn is not a crash.
test('a long silence after a finished turn does not turn clean into abnormal', () => {
  const records = [
    userText('hi'),
    assistant([{ type: 'text', text: 'hello' }], 'end_turn', { messageId: 'msg_final', timestamp: '2026-07-29T08:17:00.000Z' }),
  ]
  const res = detectAbnormalEnd(records, { now: Date.parse('2026-08-15T00:00:00.000Z') })
  assert.equal(res.ended, 'clean')
  assert.equal(res.evidence.stale, true, 'staleness is still reported as evidence')
})

// Regression: a tool call issued and never answered, long after the fact, is
// the canonical killed-mid-turn shape.
test('a trailing tool_use with no tool_result is abnormal', () => {
  const records = [
    userText('run the build'),
    assistant([toolUseBlock('toolu_B', 'Bash', { command: 'npm test' })], 'tool_use', { timestamp: '2026-07-29T08:16:45.000Z' }),
  ]
  const res = detectAbnormalEnd(records, { now: Date.parse('2026-07-30T00:00:00.000Z') })
  assert.equal(res.ended, 'abnormal')
  assert.equal(res.reason, 'unanswered-tool-use')
  assert.deepEqual(res.evidence.pendingToolUses, [{ id: 'toolu_B', name: 'Bash', index: 1 }])
})

// Regression: a tool call issued five seconds ago is a RUNNING session, not a
// dead one. Reporting it as abnormal would flag every live session.
test('an unanswered tool call in a session that is still fresh is unknown, not abnormal', () => {
  const records = [
    userText('run the build'),
    assistant([toolUseBlock('toolu_C', 'Bash', { command: 'npm test' })], 'tool_use', { timestamp: '2026-07-29T08:16:45.000Z' }),
  ]
  const res = detectAbnormalEnd(records, { now: Date.parse('2026-07-29T08:17:00.000Z') })
  assert.equal(res.ended, 'unknown')
  assert.equal(res.reason, 'tool-call-in-flight')
})

// Regression: subagent transcripts on this machine carry stop_reason: null on
// 39 of 41 assistant records. Treating "no stop reason" as a crash would flag
// every single subagent run.
test('a transcript that never records a stop reason is unknown, not abnormal', () => {
  const records = [
    userText('do the research', { isSidechain: true, agentId: 'a055bc67d87982a67' }),
    assistant([{ type: 'thinking', thinking: 'planning', signature: 'EpEC' }], null, { isSidechain: true, agentId: 'a055bc67d87982a67' }),
    assistant([{ type: 'text', text: 'All 53 new tests pass; full suite is 646/646.' }], null, {
      isSidechain: true, agentId: 'a055bc67d87982a67', uuid: 'a-2', messageId: 'msg_last', timestamp: '2026-07-29T17:56:49.868Z',
    }),
  ]
  const res = detectAbnormalEnd(records)
  assert.equal(res.ended, 'unknown')
  assert.equal(res.reason, 'transcript-records-no-stop-reasons')
  assert.equal(res.evidence.stopReasonsSeen, 0)
})

// Regression: `unknown` has to be a reachable outcome for empty input too —
// "we have nothing to look at" is not "it crashed".
test('empty and content-free record sets report unknown', () => {
  assert.equal(detectAbnormalEnd([]).ended, 'unknown')
  assert.equal(detectAbnormalEnd([]).reason, 'no-records')
  assert.equal(detectAbnormalEnd(null).ended, 'unknown')
  const bookkeepingOnly = [{ type: 'mode', mode: 'normal', sessionId: SESSION }, { type: 'last-prompt', lastPrompt: 'x', sessionId: SESSION }]
  assert.equal(detectAbnormalEnd(bookkeepingOnly).reason, 'no-conversation-records')
})

// Regression: bookkeeping records ('mode', 'last-prompt') are the literal last
// two lines of the real main transcript. If they counted as the ending, every
// session would look like it ended on a non-conversation record.
test('trailing mode and last-prompt records do not mask a clean ending', () => {
  const records = [
    userText('hi'),
    assistant([{ type: 'text', text: 'hello' }], 'end_turn', { messageId: 'msg_final' }),
    { type: 'last-prompt', lastPrompt: 'hi', leafUuid: 'a-1', sessionId: SESSION },
    { type: 'mode', mode: 'normal', sessionId: SESSION },
  ]
  const res = detectAbnormalEnd(records)
  assert.equal(res.ended, 'clean')
  assert.equal(res.evidence.lastRole, 'assistant')
})

// Regression: one logical assistant turn spans several records sharing
// message.id (seen up to 5 in the real file), and only one of them carries the
// stop_reason. Reading just the last record would miss the terminal signal.
test('a stop reason on an earlier record of the same message id still counts', () => {
  const records = [
    userText('hi'),
    assistant([{ type: 'text', text: 'answer part one' }], 'end_turn', { messageId: 'msg_split', uuid: 'a-1' }),
    assistant([{ type: 'text', text: 'answer part two' }], null, { messageId: 'msg_split', uuid: 'a-2', timestamp: '2026-07-29T08:16:50.000Z' }),
  ]
  const res = detectAbnormalEnd(records)
  assert.equal(res.ended, 'clean')
})

// Regression: interruptedByShutdown: true appears mid-session in the real
// transcript and the session carried on. Only a trailing one ends a session.
test('interruptedByShutdown mid-session does not condemn a session that continued', () => {
  const mid = userText('[Request interrupted by user for tool use]', { interruptedByShutdown: true, uuid: 'u-int' })
  const records = [
    userText('hi'),
    mid,
    userText('carry on', { uuid: 'u-3' }),
    assistant([{ type: 'text', text: 'ok' }], 'end_turn', { messageId: 'msg_final' }),
  ]
  assert.equal(detectAbnormalEnd(records).ended, 'clean')

  const cutShort = [userText('hi'), assistant([{ type: 'text', text: 'partial' }], null, { messageId: 'm1' }), mid]
  const res = detectAbnormalEnd(cutShort)
  assert.equal(res.ended, 'abnormal')
  assert.equal(res.reason, 'interrupted-by-shutdown')
})

// Regression: a malformed line inside a session must not take down the whole
// end-detection pass.
test('abnormal-end detection survives malformed records', () => {
  const records = [
    null,
    'garbage',
    { type: 'assistant', message: 'not an object' },
    assistant([{ type: 'text', text: 'ok' }], 'end_turn', { messageId: 'msg_final' }),
  ]
  const res = detectAbnormalEnd(records)
  assert.equal(res.ended, 'clean')
  assert.equal(res.evidence.malformedRecords, 2)
})

/* --------------------------------------------------------------- 058 */

// Regression: THE arithmetic trap. A missing postTokens once defaulted to 0,
// which made `reclaimed` equal the entire context window — a fabricated number
// that looked plausible on a chart.
test('a compaction missing postTokens reports reclaimed as null, not a computed number', () => {
  const records = [{
    type: 'system',
    subtype: 'compact_boundary',
    timestamp: '2026-07-29T09:00:00.000Z',
    uuid: 'c-1',
    sessionId: SESSION,
    compactMetadata: { trigger: 'auto', preTokens: 164000 },
  }]
  const { events } = compactionEvents(records)
  assert.equal(events.length, 1)
  assert.equal(events[0].preTokens, 164000)
  assert.equal(events[0].postTokens, null)
  assert.equal(events[0].reclaimed, null)
  assert.ok(events[0].missing.includes('postTokens'))
  assert.ok(events[0].missing.includes('reclaimed'))
})

// Regression: with both endpoints present the subtraction must actually happen
// — a null-safe parser that returns null for everything is equally useless.
test('a complete compaction reports reclaimed as the real difference', () => {
  const records = [{
    type: 'system',
    subtype: 'compact_boundary',
    timestamp: '2026-07-29T09:00:00.000Z',
    uuid: 'c-1',
    sessionId: SESSION,
    compactMetadata: { trigger: 'manual', preTokens: 164000, postTokens: 32000, durationMs: 8412 },
  }]
  const { events, count } = compactionEvents(records)
  assert.equal(count, 1)
  assert.deepEqual(
    { at: events[0].at, trigger: events[0].trigger, preTokens: events[0].preTokens, postTokens: events[0].postTokens, reclaimed: events[0].reclaimed, durationMs: events[0].durationMs },
    { at: '2026-07-29T09:00:00.000Z', trigger: 'manual', preTokens: 164000, postTokens: 32000, reclaimed: 132000, durationMs: 8412 },
  )
  assert.deepEqual(events[0].missing, [])
  assert.equal(events[0].fieldSources.preTokens, 'compactMetadata.preTokens')
})

// Regression: the field names could not be verified against real data (no
// compaction has ever happened on this machine), so the parser must accept the
// plausible aliases and SAY which key it actually read.
test('compaction fields are found under aliases and their real key is reported', () => {
  const records = [{
    type: 'system',
    subtype: 'compact_boundary',
    timestamp: '2026-07-29T10:00:00.000Z',
    uuid: 'c-2',
    sessionId: SESSION,
    compactionTrigger: 'auto',
    preCompactTokens: 100,
    tokensAfter: 40,
    duration_ms: 900,
  }]
  const { events } = compactionEvents(records)
  assert.equal(events[0].trigger, 'auto')
  assert.equal(events[0].reclaimed, 60)
  assert.equal(events[0].fieldSources.preTokens, 'preCompactTokens')
  assert.equal(events[0].fieldSources.postTokens, 'tokensAfter')
  assert.equal(events[0].fieldSources.durationMs, 'duration_ms')
})

// Regression: the only system subtype on this machine is stop_hook_summary.
// A detector that matched on type alone would report 18 phantom compactions.
test('ordinary system records are not mistaken for compactions', () => {
  const records = [{
    parentUuid: 'd5793f24-57cf-4122-b1db-af714eafd062',
    isSidechain: false,
    type: 'system',
    subtype: 'stop_hook_summary',
    hookCount: 1,
    hookInfos: [{ command: '~/.claude/stop-hook-git-check.sh', durationMs: 42 }],
    hookErrors: [],
    preventedContinuation: false,
    stopReason: '',
    level: 'suggestion',
    timestamp: '2026-07-29T08:22:26.733Z',
    uuid: '23e5aebb-0585-42b4-bc5b-34b0ee490aad',
    sessionId: SESSION,
  }]
  const res = compactionEvents(records)
  assert.equal(res.count, 0)
  assert.equal(res.scanned, 1)
})

// Regression: compaction records may be flagged by compactMetadata alone or by
// isCompactSummary; which detector fired has to be visible for auditing.
test('compactions are detected by metadata or summary flag and the detector is named', () => {
  const records = [
    { type: 'user', timestamp: '2026-07-29T11:00:00.000Z', uuid: 'c-3', compactMetadata: { trigger: 'auto', preTokens: 10, postTokens: 4 } },
    { type: 'summary', isCompactSummary: true, timestamp: '2026-07-29T12:00:00.000Z', uuid: 'c-4' },
  ]
  const res = compactionEvents(records)
  assert.equal(res.count, 2)
  assert.equal(res.events[0].detectedBy, 'compactMetadata')
  assert.equal(res.events[0].reclaimed, 6)
  assert.equal(res.events[1].detectedBy, 'isCompactSummary')
  assert.equal(res.events[1].reclaimed, null, 'a summary record carries no token counts')
  assert.equal(res.detectors.compactMetadata, 1)
})

// Regression: malformed lines must not throw here either, and a non-array
// input must return the same empty shape rather than blowing up a caller.
test('compaction parsing survives malformed and non-array input', () => {
  const res = compactionEvents([null, 'x', 5, { type: 'system', subtype: 'compact_boundary', compactMetadata: 'not an object' }])
  assert.equal(res.count, 1, 'the boundary record still counts, its metadata is just unusable')
  assert.deepEqual(res.events[0].missing.sort(), ['durationMs', 'postTokens', 'preTokens', 'reclaimed', 'trigger'])
  assert.equal(res.events[0].at, null)
  assert.equal(res.malformedRecords, 3)
  assert.deepEqual(compactionEvents(null).events, [])
})

// Regression: the live session on this machine ends exactly this way — last
// turn's stop_reason is 'tool_use', its result is present, and the file stops
// because the session is still running. Calling that a crash flags every
// session currently in progress.
test('a live session whose last turn handed off to a tool result is unknown, not abnormal', () => {
  const records = [
    userText('do a thing'),
    assistant([toolUseBlock('toolu_D', 'Bash', { command: 'ls' })], 'tool_use', { messageId: 'msg_last', timestamp: '2026-07-29T08:16:45.000Z' }),
    toolResult('toolu_D', 'README.md'),
  ]
  const fresh = detectAbnormalEnd(records, { now: Date.parse('2026-07-29T08:17:00.000Z') })
  assert.equal(fresh.ended, 'unknown')
  assert.equal(fresh.reason, 'turn-in-flight')

  const cold = detectAbnormalEnd(records, { now: Date.parse('2026-07-30T08:17:00.000Z') })
  assert.equal(cold.ended, 'abnormal')
  assert.equal(cold.reason, 'stopped-awaiting-next-turn')
})
