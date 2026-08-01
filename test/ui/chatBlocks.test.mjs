import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// `buildBlocks` is the pure half of src/ui/chatBlocks.jsx — stream events in, render-ready blocks
// out — but the module it lives in is JSX and imports React, so it cannot be imported under plain
// `node --test`. The reducer is restated here for the same reason test/ui/markdown-xss.test.mjs
// restates the sanitiser config: the point is to pin the CONTRACT, and any divergence between this
// and the component is itself the regression worth catching.
//
// What this guards: thinking content used to be dropped on the floor. The loop over an assistant
// message handled `text` and `tool_use` and nothing else, so a turn that reasoned and then answered
// rendered as the answer alone, and a turn that only reasoned rendered as nothing at all.
// `redacted_thinking` is the sharper case — it carries no readable text, so the tempting handling is
// to skip it, which produces a transcript that silently omits that the model thought.
//
// And: the reducer runs during render in three sections, so any unguarded field access on a stream
// event takes the whole transcript down. A malformed or partial event must produce a missing block,
// never a thrown one.

const short = (v, n = 200) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v) ?? ''
  return s.length > n ? s.slice(0, n) + '…' : s
}

function buildBlocks(events) {
  const blocks = [], byToolId = {}
  const target = ev => (ev.parent_tool_use_id && byToolId[ev.parent_tool_use_id]?.children) || blocks
  for (const ev of events) {
    if (ev.type === 'user' && Array.isArray(ev.message?.content)) {
      for (const c of ev.message.content)
        if (c.type === 'tool_result' && byToolId[c.tool_use_id]) {
          const b = byToolId[c.tool_use_id]
          b.summary = short(c.content, 400)
          b.result = short(c.content, 20_000)
          b.isError = c.is_error === true || ev.toolUseResult?.status === 'error' || ev.toolUseResult?.interrupted === true
          if (ev.toolUseResult && typeof ev.toolUseResult === 'object') b.toolResult = ev.toolUseResult
        }
        else if (c.type === 'text') target(ev).push({ kind: 'user', text: String(c.text ?? ''), ts: ev.timestamp || null })
        else if (c.type === 'image' && c.source?.data) target(ev).push({ kind: 'user-image', src: `data:${c.source.media_type};base64,${c.source.data}`, ts: ev.timestamp || null })
    } else if (ev.type === 'user') {
      target(ev).push({ kind: 'user', text: String(ev.message?.content ?? ''), ts: ev.timestamp || null })
    } else if (ev.type === 'assistant' && Array.isArray(ev.message?.content)) {
      let usageLeft = ev.message?.usage || null
      for (const c of ev.message.content) {
        if (c.type === 'text' && String(c.text ?? '').trim()) target(ev).push({ kind: 'text', text: c.text, ts: ev.timestamp || null, model: ev.message?.model || null })
        else if (c.type === 'thinking' && String(c.thinking ?? '').trim()) target(ev).push({ kind: 'thinking', text: c.thinking, ts: ev.timestamp || null, model: ev.message?.model || null })
        else if (c.type === 'redacted_thinking') target(ev).push({ kind: 'thinking', text: '', redacted: true, ts: ev.timestamp || null, model: ev.message?.model || null })
        else if (c.type === 'tool_use') {
          const b = { kind: 'tool', id: c.id, name: c.name, input: c.input, ts: ev.timestamp || null, usage: usageLeft, children: c.name === 'Task' || c.name === 'Agent' ? [] : null }
          usageLeft = null
          byToolId[c.id] = b
          target(ev).push(b)
        }
      }
    } else if (ev.type === 'result') {
      blocks.push({ kind: 'turn-end', ms: ev.duration_ms, cost: ev.total_cost_usd })
    } else if (ev.type === 'stderr') {
      blocks.push({ kind: 'stderr', text: ev.text })
    } else if (ev.type === 'closed') {
      blocks.push({ kind: 'closed', code: ev.code, error: ev.error })
    }
  }
  return blocks
}

const assistant = (content, extra = {}) => ({
  type: 'assistant',
  timestamp: '2026-07-31T21:26:04.000Z',
  message: { model: 'claude-opus-5', content, ...extra },
})

test('a thinking content block becomes a thinking block, carrying its text', () => {
  const blocks = buildBlocks([assistant([
    { type: 'thinking', thinking: 'The file is 300 lines; I should read the imports first.', signature: 'abc' },
    { type: 'text', text: 'Reading the imports.' },
  ])])

  assert.deepEqual(blocks.map(b => b.kind), ['thinking', 'text'])
  const t = blocks[0]
  assert.equal(t.text, 'The file is 300 lines; I should read the imports first.')
  assert.equal(t.redacted, undefined)
  assert.equal(t.model, 'claude-opus-5')
  assert.equal(t.ts, '2026-07-31T21:26:04.000Z')
})

test('redacted_thinking is not silently dropped — it becomes a flagged thinking block', () => {
  const blocks = buildBlocks([assistant([
    { type: 'redacted_thinking', data: 'EvwCCkYIBRgCKkBmM2Y0…' },
    { type: 'text', text: 'Done.' },
  ])])

  assert.deepEqual(blocks.map(b => b.kind), ['thinking', 'text'])
  assert.equal(blocks[0].redacted, true, 'must be flagged so the renderer shows a placeholder, not an empty box')
  // No readable text exists, and the encrypted `data` blob must not leak into the transcript.
  assert.equal(blocks[0].text, '')
  assert.equal(blocks[0].data, undefined)
})

test('a turn that only thinks still produces a block', () => {
  // The regression this file exists for: with `thinking` unhandled, this event rendered as nothing,
  // and the transcript showed a gap where a turn had happened.
  const blocks = buildBlocks([assistant([{ type: 'thinking', thinking: 'Let me check.' }])])
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].kind, 'thinking')
})

test('empty and whitespace-only thinking is skipped, matching the text rule', () => {
  const blocks = buildBlocks([assistant([
    { type: 'thinking', thinking: '   \n ' },
    { type: 'thinking', thinking: '' },
    { type: 'text', text: 'Answer.' },
  ])])
  assert.deepEqual(blocks.map(b => b.kind), ['text'])
})

test('thinking inside a subagent turn nests under its parent tool block', () => {
  const blocks = buildBlocks([
    assistant([{ type: 'tool_use', id: 'tu_1', name: 'Task', input: { subagent_type: 'explore' } }]),
    { ...assistant([{ type: 'thinking', thinking: 'Where does routing live?' }]), parent_tool_use_id: 'tu_1' },
  ])

  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].kind, 'tool')
  assert.deepEqual(blocks[0].children.map(c => c.kind), ['thinking'])
})

test('thinking does not consume the usage figure that belongs to the first tool call', () => {
  // `usageLeft` is attached to the first tool_use of a turn and nulled after. A new branch in that
  // loop must not steal it, or the context pill loses its reading.
  const blocks = buildBlocks([assistant(
    [
      { type: 'thinking', thinking: 'Plan.' },
      { type: 'tool_use', id: 'tu_2', name: 'Read', input: { file_path: 'src/App.jsx' } },
    ],
    { usage: { input_tokens: 120, output_tokens: 8 } },
  )])

  const tool = blocks.find(b => b.kind === 'tool')
  assert.deepEqual(tool.usage, { input_tokens: 120, output_tokens: 8 })
})

// A text block with no `text` is what a partial or malformed stream event looks like, and
// `c.text.trim()` threw a TypeError on it. buildBlocks runs during render in three sections, so that
// throw blanked the whole transcript — one bad frame cost every message before it.
test('a text content block with no text is skipped, not thrown on', () => {
  let blocks
  assert.doesNotThrow(() => {
    blocks = buildBlocks([assistant([
      { type: 'text' },
      { type: 'text', text: null },
      { type: 'text', text: 'Answer.' },
    ])])
  })
  assert.deepEqual(blocks.map(b => b.kind), ['text'])
  assert.equal(blocks[0].text, 'Answer.')
})

test('a user text block with no text yields an empty string, not null', () => {
  // The block feeds `<Cap text={b.text}>`, whose capture handler calls `text.slice()`. A null here
  // renders fine and then throws on click, which is worse than rendering an empty turn.
  const blocks = buildBlocks([{ type: 'user', message: { content: [{ type: 'text', text: null }] } }])
  assert.deepEqual(blocks.map(b => b.kind), ['user'])
  assert.equal(blocks[0].text, '')
})

test('a tool_result with no content does not throw — short() tolerates undefined', () => {
  // JSON.stringify(undefined) is undefined, not a string, so the old `short` threw on `.length`.
  const events = [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu_3', name: 'Bash', input: { command: 'ls' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu_3' }] } },
  ]
  let blocks
  assert.doesNotThrow(() => { blocks = buildBlocks(events) })
  assert.equal(blocks[0].result, '')
  assert.equal(blocks[0].summary, '')
})

test('a tool result keeps a short summary and a much longer body', () => {
  // The point of the split: the collapsed row shows a peek, the opened <details> shows enough that
  // "expand" actually reveals something. With one 400-char value it revealed nothing.
  const content = 'x'.repeat(5000)
  const events = [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu_4', name: 'Read', input: { file_path: 'a.txt' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu_4', content }] } },
  ]
  const b = buildBlocks(events)[0]
  assert.equal(b.summary.length, 401, '400 chars plus the ellipsis')
  assert.equal(b.result, content, 'well under the body ceiling, so it is kept whole')
  assert.ok(b.result.length > b.summary.length * 10)
})

test('the body is still capped, because every block is retained for the session', () => {
  const content = 'y'.repeat(50_000)
  const events = [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu_5', name: 'Bash', input: { command: 'cat big' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu_5', content }] } },
  ]
  const b = buildBlocks(events)[0]
  assert.equal(b.result.length, 20_001, '20k chars plus the ellipsis — an uncapped body pins megabytes per block')
})

// A restated reducer can drift from the component silently, which would make every assertion above
// pass against code that no longer exists. This reads the real source as text and pins the branches
// the file is about, so a rewrite of them fails here rather than going unnoticed.
test('the restated reducer still matches the branches in chatBlocks.jsx', () => {
  const source = readFileSync(new URL('../../src/ui/chatBlocks.jsx', import.meta.url), 'utf8')
  for (const branch of [
    "if (c.type === 'text' && String(c.text ?? '').trim()) target(ev).push({ kind: 'text', text: c.text, ts: ev.timestamp || null, model: ev.message?.model || null })",
    "else if (c.type === 'thinking' && String(c.thinking ?? '').trim()) target(ev).push({ kind: 'thinking', text: c.thinking, ts: ev.timestamp || null, model: ev.message?.model || null })",
    "else if (c.type === 'redacted_thinking') target(ev).push({ kind: 'thinking', text: '', redacted: true, ts: ev.timestamp || null, model: ev.message?.model || null })",
    "else if (c.type === 'text') target(ev).push({ kind: 'user', text: String(c.text ?? ''), ts: ev.timestamp || null })",
    'b.summary = short(c.content, 400)',
    'b.result = short(c.content, 20_000)',
    "const s = typeof v === 'string' ? v : JSON.stringify(v) ?? ''",
  ])
    assert.ok(source.includes(branch), `chatBlocks.jsx no longer contains:\n  ${branch}\nUpdate this test to match.`)
})
