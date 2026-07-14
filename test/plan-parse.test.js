import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractPlan, planLayout, blocksToPlan, diagnoseSession } from '../src/plan.js'

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

test('planLayout survives a dependency cycle', () => {
  const { depth } = planLayout([
    { step_id: 1, dependencies: [2] },
    { step_id: 2, dependencies: [1] },
  ])
  assert.ok(depth.has(1) && depth.has(2)) // no infinite loop / throw
})
