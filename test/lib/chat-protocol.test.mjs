import test from 'node:test'
import assert from 'node:assert/strict'
import { createRun, emit, replayFrom, sseReplay, parseInbound, INBOUND_VERBS, DEFAULT_BUFFER } from '../../lib/chat-protocol.mjs'

const chatOf = (seqs, { dropped = 0 } = {}) => ({ events: seqs.map(seq => ({ seq, type: 'x' })), seq: seqs.length ? seqs[seqs.length - 1] : 0, dropped })

test('frames are stamped with a monotonic seq starting at 1', () => {
  const run = createRun('r1')
  assert.equal(emit(run, 'delta', { t: 'a' }).frame.seq, 1)
  assert.equal(emit(run, 'delta', { t: 'b' }).frame.seq, 2)
  assert.equal(run.seq, 2)
})

test('a run terminates once — a second complete is refused, not silently dropped', () => {
  const run = createRun('r1')
  emit(run, 'delta', {})
  assert.equal(emit(run, 'complete', {}).ok, true)
  const second = emit(run, 'complete', {})
  assert.equal(second.ok, false)
  assert.equal(second.reason, 'already-complete')
  assert.equal(run.seq, 2, 'a refused emit must not consume a seq')
})

test('the buffer is bounded and the eviction is counted, not silent', () => {
  const run = createRun('r1', { bufferSize: 3 })
  for (let i = 0; i < 5; i++) emit(run, 'delta', { i })
  assert.equal(run.buffer.length, 3)
  assert.equal(run.evicted, 2)
  assert.deepEqual(run.buffer.map(f => f.seq), [3, 4, 5])
})

test('a junk buffer size falls back to the default rather than an unbounded buffer', () => {
  for (const bad of [0, -1, NaN, 'lots', null, undefined]) {
    assert.equal(createRun('r', { bufferSize: bad }).bufferSize, DEFAULT_BUFFER, `${bad}`)
  }
})

test('an in-window replay returns exactly the missed frames and claims completeness', () => {
  const run = createRun('r1', { bufferSize: 10 })
  for (let i = 0; i < 5; i++) emit(run, 'delta', { i })
  const r = replayFrom(run, 3)
  assert.equal(r.complete, true)
  assert.deepEqual(r.frames.map(f => f.seq), [4, 5])
  assert.equal(r.upTo, 5)
})

test('a client already up to date gets nothing and is told so', () => {
  const run = createRun('r1')
  emit(run, 'delta', {})
  const r = replayFrom(run, 1)
  assert.equal(r.complete, true)
  assert.deepEqual(r.frames, [])
})

test('a replay whose gap was evicted must NOT claim completeness', () => {
  const run = createRun('r1', { bufferSize: 3 })
  for (let i = 0; i < 6; i++) emit(run, 'delta', { i })
  const r = replayFrom(run, 1)   // needs seq 2, but the buffer starts at 4
  assert.equal(r.complete, false)
  assert.equal(r.reason, 'buffer-evicted')
  assert.equal(r.earliestSeq, 4)
  assert.equal(r.evicted, 3)
})

test('the boundary case — last surviving seq minus one — is still serveable', () => {
  const run = createRun('r1', { bufferSize: 3 })
  for (let i = 0; i < 5; i++) emit(run, 'delta', { i })   // buffer holds 3,4,5
  assert.equal(replayFrom(run, 2).complete, true, 'fromSeq 2 wants seq 3, which is retained')
  assert.equal(replayFrom(run, 1).complete, false, 'fromSeq 1 wants seq 2, which is gone')
})

test('replay of a missing run reports it rather than returning an empty success', () => {
  const r = replayFrom(null, 0)
  assert.equal(r.complete, false)
  assert.equal(r.reason, 'no-run')
})

// ---- sseReplay: the branch the live SSE endpoint runs ----

test('no fromSeq is a first connection and gets the whole retained log', () => {
  const chat = chatOf([1, 2, 3])
  for (const raw of [undefined, '', 'abc', '0', '-4']) {
    const r = sseReplay(chat, raw)
    assert.equal(r.resuming, false, `${raw}`)
    assert.equal(r.gap, null)
    assert.deepEqual(r.frames.map(f => f.seq), [1, 2, 3])
  }
})

test('resuming skips frames the client already has', () => {
  const r = sseReplay(chatOf([1, 2, 3, 4]), '2')
  assert.equal(r.resuming, true)
  assert.equal(r.gap, null)
  assert.deepEqual(r.frames.map(f => f.seq), [3, 4])
})

test('resuming past the trimmed head emits a gap frame carrying the drop count', () => {
  const chat = chatOf([10, 11, 12], { dropped: 9 })
  const r = sseReplay(chat, '4')
  assert.equal(r.gap.type, 'replay_gap')
  assert.equal(r.gap.earliestSeq, 10)
  assert.equal(r.gap.requestedFrom, 4)
  assert.equal(r.gap.dropped, 9)
  // The surviving tail is still sent — it is useful — but only alongside the admission that it
  // is not the whole run.
  assert.deepEqual(r.frames.map(f => f.seq), [10, 11, 12])
})

test('an empty retained log does not fabricate a gap for an up-to-date client', () => {
  const r = sseReplay({ events: [], seq: 7, dropped: 0 }, '7')
  assert.equal(r.gap, null)
  assert.deepEqual(r.frames, [])
})

test('sseReplay tolerates a malformed chat object', () => {
  for (const junk of [null, undefined, {}, { events: 'nope' }]) {
    const r = sseReplay(junk, '3')
    assert.deepEqual(r.frames, [])
  }
})

// ---- inbound parsing ----

test('an unknown verb is named in the rejection so the client learns why it got no reply', () => {
  const r = parseInbound({ verb: 'chat.nope' })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'unknown-verb')
  assert.equal(r.verb, 'chat.nope')
  assert.deepEqual(r.known, INBOUND_VERBS)
})

test('parsing never throws on socket garbage', () => {
  for (const junk of ['{', '', 'null', '[]', '42', null, undefined, [], 7]) {
    const r = parseInbound(junk)
    assert.equal(r.ok, false, `${JSON.stringify(junk)} should be refused`)
    assert.ok(r.error, 'a refusal must carry a reason')
  }
})

test('a valid verb parses from either `verb` or `type`', () => {
  assert.equal(parseInbound('{"verb":"chat.send","payload":{"text":"hi"}}').payload.text, 'hi')
  assert.equal(parseInbound({ type: 'chat.abort' }).verb, 'chat.abort')
})
