import { test } from 'node:test'
import assert from 'node:assert/strict'
import { awardXp, computeStreaks, evaluateAchievements, personalBests } from '../career-gamify.mjs'

test('(a) a "brag entry logged" event grants 0 XP (Goodhart guard)', () => {
  const { xpLedger, level } = awardXp({ xpLedger: [] }, [{ type: 'log', id: 'log:b1', xp: 999 }])
  const total = xpLedger.reduce((a, e) => a + e.xp, 0)
  assert.equal(total, 0)
  assert.equal(level, 0)
})

test('(b) a "KR closed" event grants XP once and is idempotent on replay', () => {
  const ev = { type: 'kr', id: 'kr:k1', xp: 25 }
  const first = awardXp({ xpLedger: [] }, [ev])
  assert.equal(first.xpLedger.reduce((a, e) => a + e.xp, 0), 25)
  // replay the same event id → no double-count
  const second = awardXp({ xpLedger: first.xpLedger }, [ev, ev])
  assert.equal(second.xpLedger.reduce((a, e) => a + e.xp, 0), 25)
  assert.equal(second.xpLedger.length, 1)
})

test('level = ceil(sqrt(totalXp/100))', () => {
  const { level } = awardXp({ xpLedger: [] }, [{ type: 'okr', id: 'okr:1', xp: 400 }])
  assert.equal(level, 2)   // sqrt(400/100)=2
})

test('(c) Zero-Regression badge uses escaped-only bug ratio', () => {
  const cfg = { xpLedger: [] }
  const clean = evaluateAchievements({ quality: { changeFailProxy: 0, myPrCount: 6 } }, cfg)
  assert.ok(clean.includes('zero-regression-sprint'))
  const regressed = evaluateAchievements({ quality: { changeFailProxy: 0.2, myPrCount: 6 } }, cfg)
  assert.ok(!regressed.includes('zero-regression-sprint'))
})

test('(d) streak survives a snapshot window that no longer contains older activity days', () => {
  // rollup.activityDays is persisted and accumulates — it outlives the raw session window.
  const rollup = { activityDays: ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09'] }
  const s = computeStreaks(rollup, '2026-07-09')
  assert.equal(s.coding, 4)   // walked from persisted days, not the (rotated) session window
})

test('today-idle does not break the coding streak', () => {
  const rollup = { activityDays: ['2026-07-07', '2026-07-08'] }
  assert.equal(computeStreaks(rollup, '2026-07-09').coding, 2)   // idle today, streak = yesterday back
})

test('personalBests surfaces lowest escaped-only bug ratio from rollup', () => {
  const pb = personalBests({ personalBests: { lowestBugRatio: 0.03 }, activityDays: ['2026-07-08', '2026-07-09'] })
  assert.equal(pb.lowestBugRatio, 0.03)
  assert.equal(pb.longestStreak, 2)
})
