import { test } from 'node:test'
import assert from 'node:assert/strict'
import { awardXp, computeStreaks, evaluateAchievements, personalBests, questDone, badgeProgress, levelBand } from '../career-gamify.mjs'

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

test('questDone → outcome event that grants XP once, idempotent on replay', () => {
  const ev = questDone({ id: 'q1', title: 'Ship X', xp: 15 })
  assert.equal(ev.type, 'quest')
  const first = awardXp({ xpLedger: [] }, [ev])
  assert.equal(first.xpLedger.reduce((a, e) => a + e.xp, 0), 15)
  const second = awardXp({ xpLedger: first.xpLedger }, [ev, ev])   // replay same id
  assert.equal(second.xpLedger.reduce((a, e) => a + e.xp, 0), 15)
})

test('levelBand inverts the level formula and reports XP-to-next', () => {
  // round-trip: the band a computed level lands in must contain its own XP
  for (const xp of [0, 1, 99, 100, 101, 250, 400, 401, 900]) {
    const { level, bandLo, bandHi, toNext } = levelBand(xp)
    assert.equal(level, Math.ceil(Math.sqrt(xp / 100)))
    if (level >= 1) { assert.ok(xp > bandLo || xp === 0, `${xp} > ${bandLo}`); assert.ok(xp <= bandHi) }
    assert.equal(toNext, Math.max(0, bandHi - xp))
  }
  assert.deepEqual(levelBand(400), { level: 2, bandLo: 100, bandHi: 400, toNext: 0 })
})

test('badgeProgress reports distance only for unearned countable badges', () => {
  const snap = { quality: { changeFailProxy: 0, myPrCount: 3 }, github: { reviewFootprint: { reviewedForOthers: { a: 2 } } } }
  const cfg = { quests: [{ id: 'q1', done: true }], courses: [] }
  const p = Object.fromEntries(badgeProgress(snap, cfg).map(b => [b.id, b]))
  assert.equal(p['mentor-5'].have, 2)                 // 2/5
  assert.equal(p['zero-regression-sprint'].have, 3)   // 3 clean PRs, need 5
  assert.equal(p['quest-streak'].have, 1)             // 1/3
  // an escaped bug blocks the clean-sprint badge → progress reads 0
  const blocked = badgeProgress({ quality: { changeFailProxy: 0.2, myPrCount: 9 } }, {}).find(b => b.id === 'zero-regression-sprint')
  assert.equal(blocked.have, 0)
})
