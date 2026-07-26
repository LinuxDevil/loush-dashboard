import { test } from 'node:test'
import assert from 'node:assert/strict'
import { triage, reviewFlow, quality, investment, sprintStats, epicRollup, loadStats } from '../server/eng.mjs'

// ─── The two-plane rule, as a test ──────────────────────────────────────────────
// server-eng.mjs is PLANE A: work artifacts (JIRA, GitHub, CI, bugs). It may carry per-person
// OPERATIONAL facts (who owns a stuck ticket, whose review a PR waits on). It may NEVER carry a
// per-person token count, cost, session time or active-hours field — that is PLANE B, self-only.
// This test fails if any /api/eng/* payload shape ever grows one.
const BANNED = /(^|[._-])(tokens?|cost|costs|usd|cents|spend|spending|price|pricing|session|sessions|sessionid|sessionms|duration_?ms|activehours|afterhours|hoursactive|keystrokes?|transcripts?|cacheread|inputtokens|outputtokens)([._-]|$)/i

function walk(node, path, hits) {
  if (node == null || typeof node !== 'object') return hits
  if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${path}[${i}]`, hits)); return hits }
  for (const [k, v] of Object.entries(node)) {
    if (BANNED.test(k)) hits.push(`${path}.${k}`)
    walk(v, `${path}.${k}`, hits)
  }
  return hits
}

const ISO = t => new Date(t).toISOString()
const now = Date.now()
const DAY = 864e5

const ALI = { id: 'a1', name: 'Ali', email: 'dev-a@example.com' }
const AMMAR = { id: 'a2', name: 'Ammar', email: 'dev-b@example.com' }

const issue = o => ({
  key: 'TEST-1', project: 'AIR', host: 'x.atlassian.net', url: 'https://x/browse/TEST-1', type: 'Story', summary: 's',
  isBug: false, area: 'Search', labels: [], links: [], duedate: null, fixVersions: [],
  status: 'In Progress', statusKind: 'active', live: false, active: true, pts: 3, activeDays: 2, waitDays: 1,
  rework: 0, qaCycles: 0, inCurrent: 4, prNums: [], assignee: ALI, owner: ALI, linkedKey: null, parent: null,
  created: ISO(now - 10 * DAY), closedAt: null, liveAt: null, firstInProg: ISO(now - 8 * DAY), curSince: ISO(now - 4 * DAY),
  leadDays: 8, daysIn: { 'In Progress': 4 }, sprints: [], sprintEvents: [], rec: null, stale: false, staleNote: '',
  ...o,
})
const pr = o => ({
  num: 1, project: 'AIR', repo: 'o/r', ticket: 'TEST-1', title: 't', branch: 'AIR-1', state: 'Open',
  url: 'https://github.com/o/r/pull/1', checks: 'SUCCESS', author: 'ali', createdAt: ISO(now - 5 * DAY),
  mergedAt: null, closedAt: null, additions: 10, deletions: 2, changedFiles: 1, comments: 0,
  firstReviewDays: null, firstReviewFromRequestDays: null, mergeDays: null, openDays: 5,
  approvedAt: null, approvedUnmergedDays: null, cycles: 1, changesRequested: 0, reviewers: [], assignees: [],
  files: [{ path: 'src/search/Box.tsx', add: 10, del: 2 }], reviewEvents: [],
  requestedReviewers: [], reviewRequests: [], unanswered: [],
  ...o,
})

const ISSUES = [
  issue({ rec: { next: 'In Code Review', budget: 1.5, moveBy: ISO(now), remaining: -2.5, atRisk: true } }),
  issue({ key: 'TEST-2', status: 'Live', statusKind: 'done', live: true, active: false, liveAt: ISO(now - 20 * DAY), prNums: [1] }),
  issue({ key: 'TEST-3', type: 'Bug', isBug: true, linkedKey: 'TEST-2', created: ISO(now - 5 * DAY), assignee: AMMAR, owner: AMMAR }),
]
const PRS = [
  pr({ requestedReviewers: ['ammar'], reviewRequests: [{ login: 'ammar', at: ISO(now - 4 * DAY) }], unanswered: ['ammar'] }),
  pr({ num: 2, state: 'Merged', mergedAt: ISO(now - 2 * DAY), mergeDays: 2, author: 'ammar', reviewers: ['ali'], reviewEvents: [{ state: 'APPROVED', login: 'ali', at: ISO(now - 3 * DAY) }], reviewRequests: [{ login: 'ali', at: ISO(now - 4 * DAY) }], requestedReviewers: ['ali'], unanswered: [] }),
]
const MEMBERS = [ALI, AMMAR]

const payload = () => ({
  triage: triage(ISSUES, PRS, [{ project: 'AIR', repo: 'o/r', branch: 'main', red: true, brokeIt: 'ali', lastRun: { url: 'u', at: ISO(now - DAY), name: 'ci' } }]),
  review: reviewFlow(PRS),
  quality: quality(ISSUES, PRS),
  investment: investment(ISSUES),
  sprints: sprintStats(ISSUES),
  epics: epicRollup(ISSUES),
  load: loadStats(PRS, ISSUES, MEMBERS),
})

test('no /api/eng/* payload shape carries a per-person token, cost or session-time field', () => {
  const hits = walk(payload(), 'snapshot', [])
  assert.deepEqual(hits, [], `Plane-B fields leaked into Plane A: ${hits.join(', ')}`)
})

test('the sustainable-pace payload is team-aggregate: min-N=5 suppression happens in the endpoint', () => {
  const load = loadStats(PRS, ISSUES, MEMBERS)
  assert.equal(load.minN, 5)
  // 2 distinct PR authors is below the floor — every cell must be null, not a small-sample number
  for (const w of load.weeks) {
    assert.ok(w.contributors < 5)
    assert.equal(w.suppressed, true)
    assert.equal(w.offHoursPct, null)
    assert.equal(w.weekendPct, null)
    assert.equal(w.prs, null)
  }
  // headcount below the floor suppresses WIP too, and there is no per-person row to drill into
  assert.equal(load.wipPerEngineer, null)
  assert.equal(JSON.stringify(load).includes(ALI.name), false, 'no person appears anywhere in the load payload')
})

test('triage emits typed, actionable records — operational facts only, no score', () => {
  const t = triage(ISSUES, PRS, [])
  const over = t.find(r => r.kind === 'over-budget')
  assert.ok(over, 'a ticket past its recFor() budget is emitted')
  assert.equal(over.severity, 1)
  assert.equal(over.overBudgetBy, 2.5)
  assert.equal(over.owner.name, 'Ali')
  assert.match(over.deepLink, /browse\/TEST-1/)
  // PR open >2 working days with zero reviewEvents
  const stale = t.find(r => r.kind === 'pr-no-review')
  assert.ok(stale && stale.deepLink.includes('/pull/1'))
  // no record carries an evaluative score
  for (const r of t) { assert.equal(r.score, undefined); assert.equal(r.rank, undefined) }
})

test('a red main is a severity-0 triage record', () => {
  const t = triage([], [], [{ project: 'AIR', repo: 'o/r', branch: 'main', red: true, brokeIt: 'ali', lastRun: { url: 'u', at: ISO(now - DAY), name: 'ci' } }])
  assert.equal(t[0].kind, 'red-main')
  assert.equal(t[0].severity, 0)
})

test('review flow is keyed on reviewer and reports concentration, not a slowest-reviewer ranking', () => {
  const rf = reviewFlow(PRS)
  const ammar = rf.reviewers.find(r => r.login === 'ammar')
  assert.equal(ammar.awaiting, 1, 'requested and never responded shows as awaiting')
  assert.ok(ammar.oldestWaitDays > 0)
  const ali = rf.reviewers.find(r => r.login === 'ali')
  assert.equal(ali.given90, 1)
  assert.ok(rf.concentration.top1Share === 100) // 1 of 1 reviews in 90d
  assert.equal(rf.unanswered.length, 1)
})

test('escape rate splits bugs filed after their parent went live from what QA caught in flight', () => {
  const q = quality(ISSUES, PRS)
  assert.equal(q.totals.escaped, 1) // TEST-3 was created after TEST-2 hit Live
  assert.equal(q.totals.qaCaught, 0)
  assert.ok(q.hotspots.some(h => h.area === 'src/search')) // bug → parent → prNums → files → top-2 segments
})

test('investment mix buckets delivered points and activeDays, with a rework overlay', () => {
  const inv = investment(ISSUES)
  assert.deepEqual(inv.buckets, ['feature', 'bug-escaped', 'bug-qa', 'toil', 'ai'])
  const m = inv.months.at(-1)
  assert.ok(m.buckets.feature.pts > 0)
  assert.equal(typeof m.reworkDays, 'number')
})
