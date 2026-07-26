import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractPlan, planLayout, blocksToPlan, diagnoseSession, turnMetrics, filesTouched } from '../../src/lib/plan.js'

const wrap = json => ({ kind: 'text', text: 'Here is the plan:\n```json\n' + JSON.stringify(json) + '\n```\nDone.' })

const SAMPLE = [
  { step_id: 1, description: 'Read schema', dependencies: [], tool_to_call: 'Read', expected_params: { file_path: '/src/db/schema.ts' } },
  { step_id: 2, description: 'Edit model', dependencies: [1], tool_to_call: 'Edit', expected_params: { target_line: 'TBD based on step 1' } },
  { step_id: 3, description: 'Run tests', dependencies: [1, 2], tool_to_call: 'Bash', expected_skill: ['TypeScript'] },
]

test('extractPlan finds a valid plan and accepts placeholder params', () => {
  const p = extractPlan([{ kind: 'user', text: 'hi' }, wrap(SAMPLE)])
  assert.equal(p.length, 3)
  assert.equal(p[1].expected_params.target_line, 'TBD based on step 1')
})

test('extractPlan returns the most recent plan', () => {
  const p = extractPlan([wrap(SAMPLE), wrap([{ step_id: 9, dependencies: [] }])])
  assert.equal(p.length, 1)
  assert.equal(p[0].step_id, 9)
})

test('extractPlan ignores non-plan json and prose', () => {
  assert.equal(extractPlan([{ kind: 'text', text: '```json\n{"foo":1}\n```' }]), null)
  assert.equal(extractPlan([{ kind: 'text', text: 'no code here' }]), null)
})

test('planLayout assigns depth by longest dependency chain', () => {
  const { depth, maxDepth } = planLayout(SAMPLE)
  assert.equal(depth.get(1), 0)
  assert.equal(depth.get(2), 1)
  assert.equal(depth.get(3), 2) // 3 depends on 2 which is depth 1
  assert.equal(maxDepth, 2)
})

test('blocksToPlan threads actions sequentially and columns by turn', () => {
  const blocks = [
    { kind: 'user', text: 'do a thing' },
    { kind: 'tool', name: 'Read', input: { file_path: '/a.ts' } },
    { kind: 'tool', name: 'Edit', input: { file_path: '/a.ts' } },
    { kind: 'user', text: 'now test' },
    { kind: 'tool', name: 'Bash', input: { command: 'npm test' } },
    { kind: 'tool', name: 'mcp__github__search', input: { q: 'x' } },
    { kind: 'tool', name: 'Skill', input: { skill: 'ponytail' } },
  ]
  const steps = blocksToPlan(blocks)
  assert.equal(steps.length, 5)
  assert.equal(steps[0].tool_to_call, 'Read')
  // sequential thread: each action depends on the previous one
  assert.deepEqual(steps[0].dependencies, [])
  assert.deepEqual(steps[1].dependencies, [1])
  assert.deepEqual(steps[2].dependencies, [2]) // first action of turn 2 links back to last of turn 1
  // columns follow turns
  assert.equal(steps[0].column, 0)
  assert.equal(steps[1].column, 0)
  assert.equal(steps[2].column, 1)
  // mcp + skill are surfaced as chips
  assert.equal(steps[3].mcp_server, 'github')
  assert.equal(steps[3].tool_to_call, 'search')
  assert.deepEqual(steps[4].expected_skill, ['ponytail'])
})

test('blocksToPlan builds a nested subplan graph for each subagent', () => {
  const blocks = [
    { kind: 'user', text: 'go' },
    { kind: 'tool', name: 'Task', input: { subagent_type: 'Explore', description: 'find X' }, children: [
      { kind: 'tool', name: 'Grep', input: { pattern: 'foo' } },
      { kind: 'text', text: 'thinking' },
      { kind: 'tool', name: 'Read', input: { file_path: '/b.ts' } },
    ] },
  ]
  const [step] = blocksToPlan(blocks)
  assert.equal(step.subplan.length, 2) // the text block is not an action
  assert.equal(step.subplan[0].tool_to_call, 'Grep')
  assert.deepEqual(step.subplan[1].dependencies, [1]) // nested graph is threaded too
  assert.match(step.description, /Explore.*2 actions/)
})

test('blocksToPlan nests subagents recursively (agent inside agent)', () => {
  const blocks = [
    { kind: 'user', text: 'go' },
    { kind: 'tool', name: 'Task', input: { subagent_type: 'outer' }, children: [
      { kind: 'tool', name: 'Task', input: { subagent_type: 'inner' }, children: [
        { kind: 'tool', name: 'Bash', input: { command: 'ls' } },
      ] },
    ] },
  ]
  const [outer] = blocksToPlan(blocks)
  assert.equal(outer.subplan.length, 1)
  assert.equal(outer.subplan[0].subplan[0].tool_to_call, 'Bash')
})

test('diagnoseSession flags shell-for-search and surfaces subagents', () => {
  const blocks = [
    { kind: 'user', text: 'go' },
    { kind: 'tool', name: 'Bash', input: { command: 'grep -n foo server.mjs' } },
    { kind: 'tool', name: 'Bash', input: { command: 'cat package.json' } },
    { kind: 'tool', name: 'Bash', input: { command: 'sed -n 1,10p a.js' } },
    { kind: 'tool', name: 'Task', input: { subagent_type: 'Explore' }, children: [] },
    { kind: 'tool', name: 'Bash', input: { command: 'ls x', }, result: 'ls: x: No such file or directory' },
  ]
  const d = diagnoseSession(blocks)
  assert.ok(d.some(x => x.level === 'warn' && /shell calls/.test(x.title)))
  assert.ok(d.some(x => x.level === 'good' && /subagent/.test(x.title)))
  assert.ok(d.some(x => /errors/.test(x.title))) // the "No such file" result
})

test('blocksToPlan caps long sessions with a truncation step', () => {
  const blocks = [{ kind: 'user', text: 'go' }, ...Array.from({ length: 80 }, () => ({ kind: 'tool', name: 'Read', input: {} }))]
  const steps = blocksToPlan(blocks)
  assert.equal(steps.length, 61) // 60 + one "session continues" note
  assert.match(steps[60].description, /session continues/)
})

test('blocksToPlan carries result/isError/toolResult, diagnosis uses the real error flag', () => {
  const blocks = [
    { kind: 'user', text: 'go' },
    { kind: 'tool', name: 'Bash', input: { command: 'npm run build' }, result: 'Build succeeded', isError: false },
    { kind: 'tool', name: 'Write', input: { file_path: '/a.ts', content: 'x' }, isError: true, result: 'ok looks fine', toolResult: { structuredPatch: [] } },
  ]
  const steps = blocksToPlan(blocks)
  assert.equal(steps[0].result, 'Build succeeded')
  assert.equal(steps[1].isError, true)
  assert.deepEqual(steps[1].toolResult, { structuredPatch: [] })
  // step 2 has NO error-ish text in result, so only the is_error flag can catch it
  const errFinding = diagnoseSession(blocks).find(d => /hit errors/.test(d.title))
  assert.ok(errFinding, 'error finding present via isError flag')
  assert.deepEqual(errFinding.stepIds, [2])
})

test('planLayout survives a dependency cycle', () => {
  const { depth } = planLayout([
    { step_id: 1, dependencies: [2] },
    { step_id: 2, dependencies: [1] },
  ])
  assert.ok(depth.has(1) && depth.has(2)) // no infinite loop / throw
})

test('turnMetrics counts fresh tokens and spans seconds per turn', () => {
  const m = turnMetrics([
    { column: 0, ts: '2026-07-14T10:00:00Z', usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 20, cache_read_input_tokens: 100 } },
    { column: 0, ts: '2026-07-14T10:00:12Z' },
    { column: 1, ts: '2026-07-14T10:01:00Z', usage: { input_tokens: 3, output_tokens: 2 } },
  ])
  assert.equal(m.get(0).tokens, 35) // input + output + cache creation
  assert.equal(m.get(0).ms, 12000)
  assert.equal(m.get(1).tokens, 5)
  assert.equal(m.get(1).ms, 0)
})

// cache_read is the same prefix replayed per message; summing it into the headline inflated a 36-action
// turn to ~8.9M "tokens". It must stay out of `tokens` and be reported separately.
test('turnMetrics keeps replayed cache reads out of the fresh-token headline', () => {
  const m = turnMetrics(Array.from({ length: 36 }, () => (
    { column: 0, usage: { output_tokens: 100, cache_read_input_tokens: 250_000 } }
  )))
  assert.equal(m.get(0).tokens, 3600)
  assert.equal(m.get(0).cached, 9_000_000)
})

test('turnMetrics leaves ms null when steps carry no timestamp (live stream)', () => {
  assert.equal(turnMetrics([{ column: 0, usage: { output_tokens: 7 } }]).get(0).ms, null)
})

test('filesTouched counts reads, writes and patch line deltas', () => {
  const files = filesTouched([
    { tool_to_call: 'Read', expected_params: { file_path: 'a.js' } },
    { tool_to_call: 'Read', expected_params: { file_path: 'a.js' } },
    {
      tool_to_call: 'Edit', expected_params: { file_path: 'b.js' },
      toolResult: { structuredPatch: [{ lines: ['-old', '+new', '+extra', ' ctx'] }] },
    },
  ])
  assert.deepEqual(files[0], { path: 'b.js', reads: 0, writes: 1, added: 2, removed: 1 })
  assert.deepEqual(files[1], { path: 'a.js', reads: 2, writes: 0, added: 0, removed: 0 })
})

// A long path tail-clipped at 60 chars renders as ".../src/Governa" — the basename, the only part worth
// reading, gets eaten. Paths must clip from the head instead.
test('blocksToPlan keeps the basename when a file path is too long to show', () => {
  const long = '/Users/ali.mohammad/learnspace/loushai/dashboard/src/GovernanceSection.jsx'
  const [step] = blocksToPlan([
    { kind: 'user', text: 'go' },
    { kind: 'tool', name: 'Edit', input: { file_path: long } },
  ])
  assert.match(step.description, /GovernanceSection\.jsx$/)
  assert.ok(step.description.includes('…/'), 'head is elided')
  assert.equal(step.expected_params.file_path, long, 'raw path is preserved for the detail panel')
})

test('blocksToPlan still clips commands from the tail (they read left-to-right)', () => {
  const [step] = blocksToPlan([
    { kind: 'user', text: 'go' },
    { kind: 'tool', name: 'Bash', input: { command: 'npm run build -- ' + 'x'.repeat(100) } },
  ])
  assert.match(step.description, /npm run build/)
})
