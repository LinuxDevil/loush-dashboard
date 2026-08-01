// Differential test: the REAL `buildBlocks` against the copy restated in chatBlocks.test.mjs.
//
// That copy exists because "JSX cannot be imported under `node --test`", and the honest worry
// recorded alongside it is that a restated reducer can drift and silently validate logic that no
// longer ships. The answer given was to pin seven branches by source text. That catches a rewrite of
// those seven lines and nothing else — not a new branch, not a reordered `else if`, not a changed
// default, not a change anywhere in the reducer that those seven lines do not mention.
//
// The harness in ./harness/jsx.mjs removes the premise, so drift can be settled instead of sampled:
// run both implementations over the same corpus and require identical output. Any divergence
// anywhere in the reducer fails here, whether or not anyone thought to add a branch to a list.
//
// The corpus is enumerated rather than sampled at random, because a flaky drift test is worse than
// none: the same inputs run on every machine, every time.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import './harness/jsx.mjs'                       // installs the JSX load hook

const { buildBlocks: real } = await import('../../src/ui/chatBlocks.jsx')

// The restated copy, lifted out of chatBlocks.test.mjs by reading that file and evaluating just the
// reducer. Reading it rather than re-typing it is the point: if the copy in the test file changes,
// this compares the changed copy, so the two can never quietly disagree about what "the copy" is.
const copySource = (() => {
  const src = readFileSync(new URL('./chatBlocks.test.mjs', import.meta.url), 'utf8')
  const start = src.indexOf('const short = (v, n = 200)')
  const end = src.indexOf('const assistant = (content')
  assert.ok(start > -1 && end > start, 'could not find the restated reducer in chatBlocks.test.mjs')
  return src.slice(start, end)
})()
const copy = new Function(`${copySource}; return buildBlocks`)()

// ------------------------------------------------------------------------------------- the corpus

const A = (content, extra = {}, evExtra = {}) => ({
  type: 'assistant', timestamp: '2026-07-31T21:26:04.000Z',
  message: { model: 'claude-opus-5', content, ...extra }, ...evExtra,
})
const U = (content, evExtra = {}) => ({ type: 'user', timestamp: '2026-07-31T21:26:05.000Z', message: { content }, ...evExtra })

const CASES = {
  // every content type, present and well formed
  'assistant: all content kinds': [A([
    { type: 'text', text: 'answer' },
    { type: 'thinking', thinking: 'reasoning' },
    { type: 'redacted_thinking', data: 'blob' },
    { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a' } },
  ], { usage: { input_tokens: 5 } })],

  // the guards, each on its own
  'assistant: text missing / null / blank / whitespace': [A([
    { type: 'text' }, { type: 'text', text: null }, { type: 'text', text: '' }, { type: 'text', text: '   \n\t ' },
  ])],
  'assistant: thinking missing / null / blank': [A([
    { type: 'thinking' }, { type: 'thinking', thinking: null }, { type: 'thinking', thinking: '  ' },
  ])],
  'assistant: text that is a number, an object, an array': [A([
    { type: 'text', text: 0 }, { type: 'text', text: 42 }, { type: 'text', text: { a: 1 } }, { type: 'text', text: ['x'] },
  ])],
  'assistant: unknown content type': [A([{ type: 'no_such_kind', text: 'x' }, { type: 'text', text: 'kept' }])],
  'assistant: content not an array': [{ type: 'assistant', message: { content: 'plain string' } }],
  'assistant: no message at all': [{ type: 'assistant' }],
  'assistant: empty content array': [A([])],
  'assistant: no model, no timestamp': [{ type: 'assistant', message: { content: [{ type: 'text', text: 'x' }] } }],

  // usage handoff to the FIRST tool_use only
  'usage goes to the first tool_use and is nulled after': [A([
    { type: 'thinking', thinking: 'plan' },
    { type: 'tool_use', id: 't1', name: 'Read', input: {} },
    { type: 'tool_use', id: 't2', name: 'Bash', input: {} },
  ], { usage: { input_tokens: 120, output_tokens: 8 } })],
  'usage absent': [A([{ type: 'tool_use', id: 't1', name: 'Read', input: {} }])],

  // Task/Agent get a children array; nothing else does
  'Task gets children, Read does not': [A([
    { type: 'tool_use', id: 't1', name: 'Task', input: {} },
    { type: 'tool_use', id: 't2', name: 'Agent', input: {} },
    { type: 'tool_use', id: 't3', name: 'Read', input: {} },
    { type: 'tool_use', id: 't4', name: 'task', input: {} },
  ])],
  'tool_use with no id and no name': [A([{ type: 'tool_use' }])],

  // nesting
  'child event nests under its parent tool block': [
    A([{ type: 'tool_use', id: 't1', name: 'Task', input: {} }]),
    A([{ type: 'text', text: 'inner' }], {}, { parent_tool_use_id: 't1' }),
    U([{ type: 'text', text: 'inner user' }], { parent_tool_use_id: 't1' }),
  ],
  'child event whose parent is unknown falls back to the top level': [
    A([{ type: 'text', text: 'orphan' }], {}, { parent_tool_use_id: 'nope' }),
  ],
  'child event whose parent has no children array falls back': [
    A([{ type: 'tool_use', id: 't1', name: 'Read', input: {} }]),
    A([{ type: 'text', text: 'orphan' }], {}, { parent_tool_use_id: 't1' }),
  ],

  // tool_result matching
  'tool_result: string, object, missing, empty, huge': [
    A([{ type: 'tool_use', id: 't1', name: 'Bash', input: {} },
      { type: 'tool_use', id: 't2', name: 'Bash', input: {} },
      { type: 'tool_use', id: 't3', name: 'Bash', input: {} },
      { type: 'tool_use', id: 't4', name: 'Bash', input: {} },
      { type: 'tool_use', id: 't5', name: 'Bash', input: {} }]),
    U([{ type: 'tool_result', tool_use_id: 't1', content: 'short' }]),
    U([{ type: 'tool_result', tool_use_id: 't2', content: { a: 1, b: [2, 3] } }]),
    U([{ type: 'tool_result', tool_use_id: 't3' }]),
    U([{ type: 'tool_result', tool_use_id: 't4', content: '' }]),
    U([{ type: 'tool_result', tool_use_id: 't5', content: 'z'.repeat(60_000) }]),
  ],
  'tool_result at exactly the 400 and 20k boundaries': [
    A([{ type: 'tool_use', id: 't1', name: 'B', input: {} }, { type: 'tool_use', id: 't2', name: 'B', input: {} },
      { type: 'tool_use', id: 't3', name: 'B', input: {} }, { type: 'tool_use', id: 't4', name: 'B', input: {} }]),
    U([{ type: 'tool_result', tool_use_id: 't1', content: 'a'.repeat(400) }]),
    U([{ type: 'tool_result', tool_use_id: 't2', content: 'a'.repeat(401) }]),
    U([{ type: 'tool_result', tool_use_id: 't3', content: 'a'.repeat(20_000) }]),
    U([{ type: 'tool_result', tool_use_id: 't4', content: 'a'.repeat(20_001) }]),
  ],
  'tool_result for an unknown tool_use_id is ignored': [U([{ type: 'tool_result', tool_use_id: 'ghost', content: 'x' }])],
  'tool_result error flags: is_error, status, interrupted, none': [
    A([{ type: 'tool_use', id: 't1', name: 'B', input: {} }, { type: 'tool_use', id: 't2', name: 'B', input: {} },
      { type: 'tool_use', id: 't3', name: 'B', input: {} }, { type: 'tool_use', id: 't4', name: 'B', input: {} },
      { type: 'tool_use', id: 't5', name: 'B', input: {} }]),
    U([{ type: 'tool_result', tool_use_id: 't1', content: 'x', is_error: true }]),
    U([{ type: 'tool_result', tool_use_id: 't2', content: 'x', is_error: 'yes' }]),
    { ...U([{ type: 'tool_result', tool_use_id: 't3', content: 'x' }]), toolUseResult: { status: 'error' } },
    { ...U([{ type: 'tool_result', tool_use_id: 't4', content: 'x' }]), toolUseResult: { interrupted: true } },
    { ...U([{ type: 'tool_result', tool_use_id: 't5', content: 'x' }]), toolUseResult: 'a string, not an object' },
  ],
  'a second tool_result overwrites the first': [
    A([{ type: 'tool_use', id: 't1', name: 'B', input: {} }]),
    U([{ type: 'tool_result', tool_use_id: 't1', content: 'first' }]),
    U([{ type: 'tool_result', tool_use_id: 't1', content: 'second' }]),
  ],
  'a reused tool id rebinds to the later block': [
    A([{ type: 'tool_use', id: 'dup', name: 'B', input: { n: 1 } }]),
    A([{ type: 'tool_use', id: 'dup', name: 'B', input: { n: 2 } }]),
    U([{ type: 'tool_result', tool_use_id: 'dup', content: 'r' }]),
  ],

  // user events
  'user: text, image, image with no data, unknown kind': [U([
    { type: 'text', text: 'hi' },
    { type: 'text', text: null },
    { type: 'image', source: { media_type: 'image/png', data: 'AAAA' } },
    { type: 'image', source: {} },
    { type: 'image' },
    { type: 'whatever' },
  ])],
  'user: content is a plain string': [{ type: 'user', message: { content: 'plain' } }],
  'user: no message': [{ type: 'user' }],
  'user: content null': [{ type: 'user', message: { content: null } }],

  // terminal events
  'result / stderr / closed, complete and empty': [
    { type: 'result', duration_ms: 1234, total_cost_usd: 0.5 },
    { type: 'result' },
    { type: 'stderr', text: 'boom' },
    { type: 'stderr' },
    { type: 'closed', code: 1, error: 'died' },
    { type: 'closed' },
  ],
  'terminal events inside a child still go to the top level': [
    A([{ type: 'tool_use', id: 't1', name: 'Task', input: {} }]),
    { type: 'result', duration_ms: 1, total_cost_usd: 2, parent_tool_use_id: 't1' },
    { type: 'stderr', text: 'e', parent_tool_use_id: 't1' },
    { type: 'closed', code: 0, parent_tool_use_id: 't1' },
  ],
  'unknown top-level event type': [{ type: 'ping' }, { type: 'text', text: 'x' }, {}],
  'empty stream': [],
}

test('the restated reducer produces byte-identical output to the real one, on every case', () => {
  for (const [name, events] of Object.entries(CASES)) {
    const a = JSON.stringify(real(structuredClone(events)))
    const b = JSON.stringify(copy(structuredClone(events)))
    assert.equal(b, a, `DRIFT on "${name}"\n  real: ${a}\n  copy: ${b}`)
  }
})

test('and on the whole corpus concatenated, so cross-event state is compared too', () => {
  const all = Object.values(CASES).flat()
  assert.equal(JSON.stringify(copy(structuredClone(all))), JSON.stringify(real(structuredClone(all))))
})

test('neither implementation throws on any case — the reducer runs during render', () => {
  for (const [name, events] of Object.entries(CASES)) {
    assert.doesNotThrow(() => real(structuredClone(events)), `real threw on "${name}"`)
    assert.doesNotThrow(() => copy(structuredClone(events)), `copy threw on "${name}"`)
  }
})

test('the corpus can actually detect drift', () => {
  // Negative control. Without this the three tests above pass just as happily against a corpus that
  // exercises nothing, which is the exact failure mode this file was written to rule out.
  const mutant = new Function(
    `${copySource.replace("else if (c.type === 'redacted_thinking')", "else if (c.type === 'never_matches_this')")}; return buildBlocks`)()
  assert.throws(() => {
    for (const events of Object.values(CASES)) {
      assert.equal(JSON.stringify(mutant(structuredClone(events))), JSON.stringify(real(structuredClone(events))))
    }
  })
})
