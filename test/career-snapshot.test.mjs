import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveIdentity } from '../career-identity.mjs'
import { buildSnapshot, updateRollup } from '../career-snapshot.mjs'
import { defaultConfig } from '../career-config.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const usageDir = path.join(HERE, 'fixtures', 'usage-data')

function deps(over = {}) {
  return {
    usageDir, mtimeCache: new Map(), config: defaultConfig(),
    resolved: resolveIdentity({ gitEmails: ['ali@work.com'] }),
    readBugs: () => ({ bugs: [{ id: 'b1', culpritAuthorEmail: 'ali@work.com' }], findings: [], myPrCount: 6, reverts: 0 }),
    readTasks: () => ([{ id: 'AIR-1', stage: 'in-progress', ageDays: 9, slaDays: 5 }]),
    readReport: () => '<html></html>',
    ...over,
  }
}

test('buildSnapshot assembles all phase-1 sections', () => {
  const s = buildSnapshot(deps())
  assert.ok(s.quality.changeFailProxy > 0)
  assert.ok(Array.isArray(s.projects))
  assert.ok(s.focus.some(f => f.area === 'tasks'))
  assert.equal(s.parsed >= 1, true)
})

test('workflow rollup carries helpfulness + oneShotRate + interruptRate (Task 8)', () => {
  const w = buildSnapshot(deps()).workflow
  assert.ok(w.helpfulness && typeof w.helpfulness === 'object')
  assert.equal(typeof w.oneShotRate, 'number')
  assert.equal(typeof w.interruptRate, 'number')
  assert.ok(w.sessionTypes && typeof w.sessionTypes === 'object')
})

test('lowestBugRatio only records on a meaningful window (>=5 PRs), else stays null (fix 4)', () => {
  const big = updateRollup(defaultConfig(), buildSnapshot(deps()), '2026-07-09')          // myPrCount 6
  assert.equal(big.rollup.personalBests.lowestBugRatio, buildSnapshot(deps()).quality.changeFailProxy)
  const small = updateRollup(defaultConfig(), buildSnapshot(deps({ readBugs: () => ({ bugs: [], findings: [], myPrCount: 2, reverts: 0 }) })), '2026-07-09')
  assert.equal(small.rollup.personalBests.lowestBugRatio, undefined) // guarded — not a permanent trivial zero
})

test('after-hours uses a LOCAL window, not UTC (fix 1)', () => {
  // fixture s1 starts 19:24 UTC. At UTC+3 that is 22:24 local → after-hours (window 19–6).
  const cfg = defaultConfig(); cfg.tzOffsetHours = 3
  const s = buildSnapshot(deps({ config: cfg }))
  assert.equal(s.flow.afterHoursPct, 1)             // 22:24 local IS after-hours
  const cfg2 = defaultConfig(); cfg2.tzOffsetHours = -8 // PT: 19:24 UTC = 11:24 local → NOT after-hours
  const s2 = buildSnapshot(deps({ config: cfg2 }))
  assert.equal(s2.flow.afterHoursPct, 0)
})

test('coding streak survives an idle today (fix 3)', () => {
  const cfg = defaultConfig()
  cfg.rollup.activityDays = ['2026-07-07', '2026-07-08'] // yesterday + day before; nothing today
  const idleSnap = buildSnapshot(deps({ usageDir: path.join(HERE, 'fixtures', 'no-usage-dir') })) // missing dir → 0 sessions
  const patch = updateRollup(cfg, { ...idleSnap, me: { sessionCount: 0 } }, '2026-07-09')
  assert.equal(patch.rollup.streaks.coding, 2) // NOT 0
})
