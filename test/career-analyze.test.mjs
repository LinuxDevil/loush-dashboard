import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analysisKey, runAnalyze } from '../career-analyze.mjs'

test('analysisKey is stable across key-order changes', () => {
  const a = analysisKey('focus', { a: 1, b: { x: 1, y: 2 } })
  const b = analysisKey('focus', { b: { y: 2, x: 1 }, a: 1 })
  assert.equal(a, b)
  assert.notEqual(a, analysisKey('workflow', { a: 1, b: { x: 1, y: 2 } }))
})

test('runAnalyze returns the model markdown via injected spawn', () => {
  const fakeSpawn = (cmd, args) => {
    assert.equal(cmd, 'claude')
    return { status: 0, stdout: JSON.stringify({ result: '# Analysis\n- do X' }) }
  }
  const r = runAnalyze({ panelKey: 'focus', payload: { item: 'y' }, spawn: fakeSpawn })
  assert.match(r.markdown, /# Analysis/)
})

test('runAnalyze degrades to a heuristic message on spawn failure', () => {
  const r = runAnalyze({ panelKey: 'focus', payload: {}, spawn: () => ({ status: 1, stderr: 'boom' }) })
  assert.ok(r.markdown)   // never empty — panel keeps its heuristic text (§6 degradation)
})
