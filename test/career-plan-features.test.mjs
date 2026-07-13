import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateAchievements, badgeProgress } from '../career-gamify.mjs'
import { isoWeekKey, kpiMoved, updateRollup } from '../career-snapshot.mjs'
import { importGithub } from '../career-import-github.mjs'
import { migrate, CONFIG_VERSION } from '../career-config.mjs'
import { parseGitLog, shapeDomain } from '../career-domain.mjs'
import { meetingStats } from '../career-meetings.mjs'
import { weeklyDigest } from '../career-digest.mjs'

// ── ★ time-series + G8 personal bests ────────────────────────────────────────
test('isoWeekKey is ISO-8601 (2026-01-01 → 2026-W01)', () => {
  assert.equal(isoWeekKey('2026-01-01'), '2026-W01')
  assert.equal(isoWeekKey('2026-07-12'), '2026-W28')
})

test('updateRollup appends a weekly sample, overwriting within the same week', () => {
  const snapA = { generatedAt: 1, quality: { changeFailProxy: 0.2, myPrCount: 6 }, workflow: { oneShotRate: 0.4 }, flow: { afterHoursPct: 0.1 }, me: { sessionCount: 5 }, game: { xp: 100 } }
  let { rollup } = updateRollup({ rollup: {} }, snapA, '2026-07-12')
  assert.equal(rollup.history.length, 1)
  // same week, new numbers → replaced not appended
  const snapB = { ...snapA, workflow: { oneShotRate: 0.9 } }
  ;({ rollup } = updateRollup({ rollup }, snapB, '2026-07-12'))
  assert.equal(rollup.history.length, 1)
  assert.equal(rollup.history[0].oneShotRate, 0.9)
})

test('bestFlowWeek is the highest one-shot week over a meaningful sample; thin weeks ignored', () => {
  const mk = (one, sessions) => ({ generatedAt: 1, quality: { changeFailProxy: 0, myPrCount: 6 }, workflow: { oneShotRate: one }, flow: {}, me: { sessionCount: sessions }, game: { xp: 0 } })
  let rollup = {}
  ;({ rollup } = updateRollup({ rollup }, mk(0.5, 5), '2026-07-06'))   // W28
  ;({ rollup } = updateRollup({ rollup }, mk(0.99, 1), '2026-07-13'))  // W29 but only 1 session → ignored
  assert.match(rollup.personalBests.bestFlowWeek, /W28 · 50%/)
})

test('mostKrsQuarter counts KR/OKR closures per quarter from the ledger', () => {
  const jul = Date.UTC(2026, 6, 1), apr = Date.UTC(2026, 3, 1)
  const config = { rollup: {}, xpLedger: [
    { type: 'kr', at: jul }, { type: 'okr', at: jul }, { type: 'kr', at: jul },
    { type: 'kr', at: apr }, { type: 'course', at: jul },
  ] }
  const snap = { generatedAt: 1, quality: { changeFailProxy: 0, myPrCount: 6 }, workflow: {}, flow: {}, me: { sessionCount: 3 }, game: {} }
  const { rollup } = updateRollup(config, snap, '2026-07-12')
  assert.equal(rollup.personalBests.mostKrsQuarter, 3)  // Q3 has 3 kr/okr; 'course' doesn't count
})

// ── G2 business-impact linkage ───────────────────────────────────────────────
test('kpiMoved respects direction; non-numeric never counts as moved', () => {
  assert.equal(kpiMoved({ baseline: 10, current: 12, direction: 'up' }), true)
  assert.equal(kpiMoved({ baseline: 10, current: 8, direction: 'up' }), false)
  assert.equal(kpiMoved({ baseline: 200, current: 150, direction: 'down' }), true)
  assert.equal(kpiMoved({ baseline: 'x', current: 12, direction: 'up' }), false)
})

test('impact-trader needs ≥5 linked; needle-mover needs 1 moved (badge, no XP)', () => {
  const few = evaluateAchievements({ impact: { linkedCount: 4, movedCount: 0 } }, {})
  assert.ok(!few.includes('impact-trader') && !few.includes('needle-mover'))
  const many = evaluateAchievements({ impact: { linkedCount: 5, movedCount: 1 } }, {})
  assert.ok(many.includes('impact-trader') && many.includes('needle-mover'))
  assert.deepEqual(badgeProgress({ impact: { linkedCount: 2 } }, {}).find(b => b.id === 'impact-trader'), { id: 'impact-trader', have: 2, need: 5 })
})

// ── G1 AI-code-share badge (gated on a clean escaped-bug ratio) ───────────────
test('ai-pair-master requires meaningful AI commits AND a zero escaped-bug ratio', () => {
  const dirty = evaluateAchievements({ ai: { aiCommits: 20 }, quality: { changeFailProxy: 0.1, myPrCount: 6 } }, {})
  assert.ok(!dirty.includes('ai-pair-master'))   // a single escaped bug blocks it
  const clean = evaluateAchievements({ ai: { aiCommits: 20 }, quality: { changeFailProxy: 0, myPrCount: 6 } }, {})
  assert.ok(clean.includes('ai-pair-master'))
  // progress reads 0 while the ratio is dirty (mirrors clean-sprint)
  assert.equal(badgeProgress({ ai: { aiCommits: 8 }, quality: { changeFailProxy: 0.1 } }, {}).find(b => b.id === 'ai-pair-master').have, 0)
})

// ── G8 GitHub import: commit count, reverts, real review passes ───────────────
test('importGithub sums PR commits, counts revert PRs, and uses real review passes', () => {
  const ghJson = {
    reviews: { items: [{ number: 1, user: { login: 'other' } }] },
    reviewPasses: 7,
    prs: [
      { title: 'feat: x', additions: 10, deletions: 2, commits: [{}, {}, {}] },
      { title: 'Revert "feat: x"', additions: 2, deletions: 10, commits: [{}] },
    ],
  }
  const imp = importGithub({ ghJson, resolved: { gitEmails: [], githubHandle: 'me' } })
  assert.equal(imp.commitCount, 4)
  assert.equal(imp.revertCount, 1)
  assert.equal(imp.reviewFootprint.commentsLeftEstimate, 7)   // real passes, not items.length (=1)
})

test('importGithub degrades commentsLeftEstimate to items.length when reviewPasses absent', () => {
  const imp = importGithub({ ghJson: { reviews: { items: [{ number: 1 }, { number: 2 }] }, prs: [] }, resolved: {} })
  assert.equal(imp.reviewFootprint.commentsLeftEstimate, 2)
  assert.equal(imp.commitCount, 0)
})

// ── G2 config migration ──────────────────────────────────────────────────────
test('migrate backfills kpiLinks and lands on the current version', () => {
  const { cfg } = migrate({ version: 2, focusActed: {} })
  assert.equal(cfg.version, CONFIG_VERSION)
  assert.deepEqual(cfg.kpiLinks, [])
})

// ── G4 domain/expertise map ──────────────────────────────────────────────────
const MK = '\x01'
test('parseGitLog attributes file-touches per area to me vs others', () => {
  const log = [
    `${MK}me@x.com`, 'src/a.js', 'src/b.js', 'docs/readme.md',
    `${MK}other@y.com`, 'src/a.js', 'lib/c.js',
  ].join('\n')
  const areas = parseGitLog(log, ['ME@x.com'])   // case-insensitive
  assert.deepEqual(areas.src, { mine: 2, total: 3 })   // my 2 src touches, other's 1
  assert.deepEqual(areas.docs, { mine: 1, total: 1 })
  assert.deepEqual(areas.lib, { mine: 0, total: 1 })
})

test('shapeDomain flags a keystone only over a real, high-ownership sample', () => {
  const { areas, keystones } = shapeDomain({
    core: { mine: 12, total: 13 },   // 92% over 12 → keystone
    edge: { mine: 3, total: 20 },    // low ownership
    tiny: { mine: 2, total: 2 },     // 100% but too few commits
  })
  assert.deepEqual(keystones, ['core'])
  assert.equal(areas[0].area, 'core')   // ranked by mine desc
  assert.ok(!areas.some(a => a.mine === 0))
})

// ── G5 meetings ──────────────────────────────────────────────────────────────
test('meetingStats splits decision vs status and counts meetings I drove', () => {
  const ev = [
    { start: '2026-07-06T09:00:00Z', end: '2026-07-06T10:00:00Z', title: 'Architecture review', organizer: 'me@x.com' },
    { start: '2026-07-06T10:00:00Z', end: '2026-07-06T10:15:00Z', title: 'Daily standup', organizer: 'lead@x.com' },
    { start: '2026-07-07T09:00:00Z', end: '2026-07-07T09:30:00Z', title: 'Design decision', organizer: 'me@x.com' },
  ]
  const s = meetingStats(ev, { meEmails: ['me@x.com'] })
  assert.equal(s.count, 3)
  assert.equal(s.decisionCount, 2)
  assert.equal(s.statusCount, 1)
  assert.equal(s.droveDecisions, 2)   // both decision meetings organized by me
  assert.equal(s.hours, 1.8)   // 1 + 0.25 + 0.5 = 1.75 → rounded
})

// ── G4/G5/G6 badges ──────────────────────────────────────────────────────────
test('keystone / decision-driver / prolific-author badges gate correctly', () => {
  assert.ok(evaluateAchievements({ domain: { keystones: ['core'] } }, {}).includes('keystone'))
  assert.ok(!evaluateAchievements({ domain: { keystones: [] } }, {}).includes('keystone'))
  assert.ok(evaluateAchievements({ meetings: { droveDecisions: 3 } }, {}).includes('decision-driver'))
  assert.ok(!evaluateAchievements({ meetings: { droveDecisions: 2 } }, {}).includes('decision-driver'))
  const cfg = { ownership: [{ type: 'design-doc' }, { type: 'system' }, { type: 'oss' }, { type: 'talk' }] }
  assert.ok(evaluateAchievements({}, cfg).includes('prolific-author'))   // 3 artifact-type entries (talk excluded)
})

// ── G10 weekly digest ────────────────────────────────────────────────────────
test('weeklyDigest reports this-week metrics and deltas vs last week', () => {
  const snap = {
    rollup: { history: [
      { week: '2026-W27', xp: 100, sessions: 8, oneShotRate: 0.4, changeFailProxy: 0.2 },
      { week: '2026-W28', xp: 140, sessions: 12, oneShotRate: 0.6, changeFailProxy: 0.1 },
    ] },
    ai: { codeShare: 0.7 }, impact: { movedCount: 2 }, meetings: { droveDecisions: 1 }, domain: { keystones: ['core'] },
    bragCandidates: [{ title: 'Shipped X' }], focus: [{ message: 'do Y', actedOn: null }],
  }
  const d = weeklyDigest(snap)
  assert.equal(d.week, '2026-W28')
  assert.equal(d.xpDelta, 40)
  assert.equal(d.oneShotDelta, 0.2)
  assert.equal(d.changeFailDelta, -0.1)   // improved
  assert.equal(d.keystones, 1)
  assert.deepEqual(d.wins, ['Shipped X'])
})
