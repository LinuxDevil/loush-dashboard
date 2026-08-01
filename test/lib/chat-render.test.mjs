import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { extractTokenBudget, registerRenderer, rendererFor, renderToolCall, groupBySubagent } from '../../lib/chat-render.mjs'

const usageEvent = (model, usage) => ({ message: { model, usage } })

test('a known model yields a real percentage of its real window', () => {
  const b = extractTokenBudget(usageEvent('claude-opus-5', { input_tokens: 100_000, cache_read_input_tokens: 200_000 }))
  assert.equal(b.known, true)
  assert.equal(b.used, 300_000)
  assert.equal(b.window, 1_000_000)
  assert.equal(b.percent, 30)
  assert.equal(b.over, false)
})

test('all three prompt components count toward occupancy', () => {
  const b = extractTokenBudget(usageEvent('claude-haiku-4-5', {
    input_tokens: 1000, cache_creation_input_tokens: 2000, cache_read_input_tokens: 3000,
  }))
  assert.equal(b.used, 6000, 'cache reads and creations are part of the prompt the model saw')
  assert.equal(b.window, 200_000)
})

test('output tokens are not occupancy and must not be counted', () => {
  const b = extractTokenBudget(usageEvent('claude-opus-5', { input_tokens: 10, output_tokens: 999_999 }))
  assert.equal(b.used, 10)
})

test('an unknown model reports the real token count with a null percent, not a guessed window', () => {
  const b = extractTokenBudget(usageEvent('some-future-model', { input_tokens: 5 }))
  assert.equal(b.known, false)
  assert.equal(b.used, 5, 'the measurement is real even when the denominator is not')
  assert.equal(b.window, null)
  assert.equal(b.percent, null)
  assert.equal(b.reason, 'unknown-model-window')
})

test('a missing model is distinguished from an unrecognised one', () => {
  assert.equal(extractTokenBudget({ message: { usage: { input_tokens: 5 } } }).reason, 'no-model-on-event')
})

test('an event with no usage block says so rather than reporting zero', () => {
  for (const [event, reason] of [
    [{ message: { model: 'claude-opus-5' } }, 'no-usage-on-event'],
    [{ message: { model: 'claude-opus-5', usage: 'nope' } }, 'no-usage-on-event'],
    [{ message: { model: 'claude-opus-5', usage: {} } }, 'no-input-tokens'],
    [null, 'no-usage-on-event'],
  ]) {
    const b = extractTokenBudget(event)
    assert.equal(b.known, false)
    assert.equal(b.used, null, 'zero would render as an empty bar, which is a claim')
    assert.equal(b.reason, reason)
  }
})

test('an over-window reading is surfaced, not clamped to 100', () => {
  const b = extractTokenBudget(usageEvent('claude-haiku-4-5', { input_tokens: 300_000 }))
  assert.equal(b.over, true)
  assert.ok(b.percent > 100, 'a reading past the end means our window figure is wrong — that is the signal')
})

test('usage is read off a bare event as well as a nested message', () => {
  const b = extractTokenBudget({ model: 'claude-opus-5', usage: { input_tokens: 250_000 } })
  assert.equal(b.percent, 25)
})

// ---- renderer registry ----

test('an unregistered tool falls back to the shared summariser rather than inventing a description', () => {
  const out = rendererFor('SomeUnknownTool')({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'SomeUnknownTool', input: { a: 1 } }] } })
  assert.equal(out.title, 'SomeUnknownTool')
  assert.match(out.summary, /No per-tool summary renderer exists/)
})

test('a registered renderer takes precedence and later registrations replace earlier ones', () => {
  registerRenderer('TestTool', () => ({ title: 'first' }))
  assert.equal(rendererFor('TestTool')({}).title, 'first')
  registerRenderer('TestTool', () => ({ title: 'second' }))
  assert.equal(rendererFor('TestTool')({}).title, 'second')
})

test('a junk registration is refused rather than poisoning the lookup', () => {
  for (const [name, fn] of [['', () => {}], [null, () => {}], ['Ok', null], ['Ok', 'nope']]) {
    assert.equal(registerRenderer(name, fn), false, `${name}/${typeof fn}`)
  }
})

test('a renderer that throws does not take the transcript view down', () => {
  registerRenderer('ExplodingTool', () => { throw new Error('boom') })
  const out = renderToolCall({ name: 'ExplodingTool' })
  assert.equal(out.kind, 'unknown')
  assert.equal(out.title, 'ExplodingTool')
  assert.match(out.error, /boom/)
})

test('renderToolCall finds the tool name in a real assistant record shape', () => {
  const out = renderToolCall({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/a/b.mjs' } }] } })
  // The name is extracted from the nested tool_use block and dispatched; the shared summariser
  // then titles it with the path it read, which is more than the bare tool name.
  assert.match(out.title, /^Read\b/)
  assert.notEqual(out.kind, 'unknown', 'a known tool must not fall through to the generic result')
})

// ---- subagent grouping ----

test('children nest under the tool_use that spawned them', () => {
  const g = groupBySubagent([
    { uuid: 'p', type: 'assistant' },
    { uuid: 'c1', isSidechain: true, sourceToolUseID: 'p' },
    { uuid: 'c2', isSidechain: true, sourceToolUseID: 'p' },
  ])
  assert.deepEqual(g.roots.map(r => r.uuid), ['p'])
  assert.deepEqual(g.childrenOf('p').map(r => r.uuid), ['c1', 'c2'])
  assert.equal(g.counts.sidechain, 2)
  assert.equal(g.counts.parents, 1)
})

test('a sidechain record with no parent link is reported as unlinked, not flattened silently', () => {
  const g = groupBySubagent([
    { uuid: 'p' },
    { uuid: 'orphan', isSidechain: true, agentId: 'agent-7' },
  ])
  assert.equal(g.counts.sidechainUnlinked, 1)
  assert.match(g.note, /could not be nested/, 'a flat view must not read as "there were no subagents"')
})

test('a run with no subagents carries no note', () => {
  const g = groupBySubagent([{ uuid: 'a' }, { uuid: 'b' }])
  assert.equal(g.note, null)
  assert.equal(g.counts.sidechainUnlinked, 0)
})

test('grouping tolerates junk entries and a non-array argument', () => {
  const g = groupBySubagent([null, 'nope', 7, { uuid: 'ok' }])
  assert.deepEqual(g.roots.map(r => r.uuid), ['ok'])
  assert.equal(g.counts.total, 4, 'the total counts what was handed in, including what was skipped')
  assert.deepEqual(groupBySubagent(null).roots, [])
})

test('childrenOf an unknown id is empty rather than undefined', () => {
  assert.deepEqual(groupBySubagent([]).childrenOf('nobody'), [])
})

// ---- against a real transcript, when one is present ----

test('the parent-link field matches what real transcripts actually carry', { skip: !fs.existsSync('/root/.claude/projects') }, () => {
  const dirs = fs.readdirSync('/root/.claude/projects', { withFileTypes: true }).filter(d => d.isDirectory())
  const records = []
  for (const d of dirs) {
    for (const f of fs.readdirSync(`/root/.claude/projects/${d.name}`).filter(n => n.endsWith('.jsonl'))) {
      for (const line of fs.readFileSync(`/root/.claude/projects/${d.name}/${f}`, 'utf8').split('\n')) {
        if (!line) continue
        try { records.push(JSON.parse(line)) } catch {}
      }
    }
  }
  if (!records.length) return
  const sidechain = records.filter(r => r?.isSidechain)
  if (!sidechain.length) return
  const g = groupBySubagent(records)
  assert.equal(g.counts.sidechain, sidechain.length)
  // Either they linked or they were counted as unlinked — no sidechain record may vanish.
  const nested = [...new Set(sidechain.map(r => r.sourceToolUseID ?? r.sourceToolAssistantUUID ?? r.parent_tool_use_id ?? r.parentToolUseId).filter(Boolean))]
  const nestedCount = nested.reduce((n, id) => n + g.childrenOf(id).length, 0)
  assert.equal(nestedCount + g.counts.sidechainUnlinked, sidechain.length)
})
