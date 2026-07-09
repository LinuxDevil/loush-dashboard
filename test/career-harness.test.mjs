import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harnessScore } from '../career-harness.mjs'

const baselineFrictionRate = 1   // 1 friction event per session, org-wide baseline
const goodSessions = n => Array.from({ length: n }, () => ({ verified: true, session_type: 'one_shot', interrupted: false, friction_counts: {}, tool_counts: { Edit: 3, Bash: 1 } }))

test('no CLAUDE.md + 2x baseline friction scores low and yields both fixes', () => {
  // verified/one-shot/not-interrupted so only CLAUDE.md and friction fall below threshold
  const sessions = Array.from({ length: 4 }, () => ({ verified: true, session_type: 'one_shot', interrupted: false, friction_counts: { wrong_approach: 2 }, tool_counts: { Edit: 3, Bash: 1 } }))
  const r = harnessScore({ project: 'p', sessionsForProject: sessions, repoProbe: { hasClaudeMd: false, claudeMdQuality: 0 }, baselineFrictionRate })
  assert.ok(r.score < 60, `expected low score, got ${r.score}`)
  const ids = r.fixes.map(f => f.id)
  assert.ok(ids.includes('no-claude-md'), 'missing no-claude-md fix')
  assert.ok(ids.includes('high-friction'), 'missing high-friction fix')
})

test('healthy project scores high with no fixes', () => {
  const r = harnessScore({ project: 'p', sessionsForProject: goodSessions(6), repoProbe: { hasClaudeMd: true, claudeMdQuality: 1 }, baselineFrictionRate })
  assert.ok(r.score >= 85, `expected high score, got ${r.score}`)
  assert.equal(r.fixes.length, 0)
})

test('never throws on empty inputs', () => {
  const r = harnessScore({})
  assert.equal(typeof r.score, 'number')
  assert.ok(Array.isArray(r.fixes))
})
