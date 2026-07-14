// THE PRIVACY CONTRACT, as a test. server-team.mjs is the only place cross-person aggregation
// happens; this file is the only thing stopping it from becoming surveillance. Every assertion
// here exists because a persona said they would close the tab forever if it were violated.
//
//   1. STRUCTURAL — server-team.mjs may import server-eng.mjs (Plane A) and node builtins. Nothing else.
//      It may not read ~/.claude, transcripts, usage-data or any Plane-B module.
//   2. FIELD-LEVEL — no team payload may carry a token, cost, session-time or transcript-derived field,
//      even if the upstream snapshot is poisoned with one.
//   3. SYMMETRY — per-person rows are alphabetical, carry no score/rank/hours field.
//   4. MIN-N — sustainability returns null below 5 contributors, and suppresses any weekly cell below it.
//
// If you are here because a test failed: the payload is wrong, not the test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { guard, guardPerson, teamBoard, reviewFlow, stageFunnel, effortMix, commitments, ownership, ciFrom, sustainability } from '../server-team.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = fs.readFileSync(path.join(HERE, '..', 'server-team.mjs'), 'utf8')

// ---------- fixtures: a snapshot POISONED with Plane-B fields, as a hostile upstream would be ----------
const person = (id, name) => ({ id, name, email: `${name.toLowerCase()}@x.com` })
const ISSUE = (o) => ({
  key: 'TRN-1', project: 'TRN', host: 'jira.x', summary: 's', type: 'Task', isBug: false, labels: [],
  status: 'In Progress', statusKind: 'active', active: true, live: false, inCurrent: 1, daysIn: { 'In Progress': 1 },
  activeDays: 1, waitDays: 0, pts: 3, qaCycles: 0, rework: 0, prNums: [], sprint: null, parent: null,
  created: new Date(Date.now() - 5 * 864e5).toISOString(), closedAt: null, curSince: new Date().toISOString(),
  rec: { next: 'In Code Review', budget: 1.5, moveBy: new Date().toISOString(), remaining: 0.5, atRisk: false }, ...o,
})
const PR = (o) => ({
  num: 1, project: 'TRN', repo: 'o/r', ticket: 'TRN-1', title: 't', branch: 'b', state: 'Open', author: 'ali',
  createdAt: new Date(Date.now() - 5 * 864e5).toISOString(), mergedAt: null, openDays: 5, firstReviewDays: null,
  reviewers: [], assignees: [], reviewEvents: [], files: [{ path: 'src/a.ts', add: 1, del: 0 }], ...o,
})
const snapWith = (issues, prs) => ({
  generatedAt: new Date().toISOString(), issues, prs,
  projects: [{ key: 'TRN', name: 'T', githubRepo: 'o/r', dev: ['ali@x.com'] }],
  members: [], team: { key: 'all' },
})
// the hostile case: harness telemetry smuggled onto the upstream records
const POISONED = snapWith(
  [ISSUE({ assignee: person('u1', 'Ali'), tokens: 4200, costUsd: 3.1 })],
  [PR({ author: 'ali', sessionId: 'abc', transcriptPath: '/x.jsonl' })],
)

// ═══ 1. STRUCTURAL — the file split IS the boundary ═══════════════════════════
test('server-team.mjs imports Plane-A only (server-eng.mjs + node builtins)', () => {
  const imports = [...SRC.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map(m => m[1])
  for (const i of imports) {
    const ok = i.startsWith('node:') || i === './server-eng.mjs'
    assert.ok(ok, `server-team.mjs may not import "${i}" — only node builtins and ./server-eng.mjs (Plane A) are allowed`)
  }
  assert.ok(imports.includes('./server-eng.mjs'))
})

test('server-team.mjs has no code path to ~/.claude, transcripts or usage data', () => {
  // comments explain the rule (and therefore name the forbidden things); the CODE may not touch them.
  const code = SRC.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  for (const forbidden of ['\\.claude', 'usage-data', 'jsonl', 'homedir', 'career\\.json', 'cursor', 'claude -p'])
    assert.ok(!new RegExp(forbidden, 'i').test(code), `server-team.mjs code references "${forbidden}" — that is Plane B and must be unreachable from this file`)
  // the only file this module is allowed to read is the project roster
  const reads = [...code.matchAll(/readFileSync\([^)]*/g)].map(m => m[0])
  for (const r of reads) assert.match(r, /projects\.json/, `server-team.mjs reads a file other than projects.json: ${r}`)
})

// ═══ 2. FIELD-LEVEL — the guard fails loudly on any Plane-B field ═════════════
test('guard() throws on a per-person token / cost / session / transcript field', () => {
  for (const bad of [
    { rows: [{ name: 'Ali', tokens: 10 }] },
    { rows: [{ name: 'Ali', costUsd: 1 }] },
    { rows: [{ name: 'Ali', sessionTime: 5 }] },
    { rows: [{ name: 'Ali', transcriptPath: '/x' }] },
    { rows: [{ name: 'Ali', activeHours: 9 }] },
    { deep: { nest: [{ xp: 100 }] } },
  ]) assert.throws(() => guard(bad), /plane violation/, `guard() let a Plane-B field through: ${JSON.stringify(bad)}`)
})

test('guard() passes a clean operational payload', () => {
  assert.doesNotThrow(() => guard({ rows: [{ name: 'Ali', open: 3, atRisk: 1, inCurrent: 2.5 }] }))
})

test('every team aggregate is clean even when the upstream snapshot is poisoned', () => {
  for (const [name, payload] of [
    ['board', teamBoard(POISONED)],
    ['review-flow', reviewFlow(POISONED, { me: 'ali' })],
    ['funnel', stageFunnel(POISONED)],
    ['effort', effortMix(POISONED)],
    ['commitments', commitments(POISONED)],
    ['ownership', ownership(POISONED)],
    ['sustainability', sustainability(POISONED)],
    ['ci', ciFrom([{ id: 1, headSha: 'a', conclusion: 'failure', name: 'ci', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }])],
  ]) assert.doesNotThrow(() => guard(payload, name), `${name} leaked a Plane-B field from a poisoned upstream`)
  // and the poison specifically did not survive
  assert.equal(JSON.stringify(teamBoard(POISONED)).includes('4200'), false)
  assert.equal(JSON.stringify(reviewFlow(POISONED, { me: 'ali' })).includes('abc'), false)
})

// ═══ 3. SYMMETRY — per-person rows are alphabetical, scoreless ════════════════
test('team board rows are ALPHABETICAL, never ranked by output or stuckness', () => {
  const snap = snapWith([
    ISSUE({ key: 'TRN-1', assignee: person('u1', 'Zed'), inCurrent: 40, rec: { atRisk: true, budget: 1 } }),
    ISSUE({ key: 'TRN-2', assignee: person('u2', 'Ali'), inCurrent: 1 }),
    ISSUE({ key: 'TRN-3', assignee: person('u3', 'Mo'), inCurrent: 9 }),
  ], [])
  assert.deepEqual(teamBoard(snap).rows.map(r => r.name), ['Ali', 'Mo', 'Zed'])
})

test('reviewer load rows are alphabetical', () => {
  const at = new Date().toISOString()
  const snap = snapWith([], [
    PR({ num: 1, reviewEvents: [{ state: 'APPROVED', login: 'zed', at }, { state: 'APPROVED', login: 'zed', at }] }),
    PR({ num: 2, reviewEvents: [{ state: 'APPROVED', login: 'ali', at }] }),
  ])
  assert.deepEqual(reviewFlow(snap).load.map(r => r.login), ['ali', 'zed'])
})

test('guardPerson() rejects a score / rank / hours field on a person row', () => {
  for (const bad of [{ name: 'Ali', score: 9 }, { name: 'Ali', rank: 1 }, { name: 'Ali', afterHoursPct: 0.3 }, { name: 'Ali', level: 7 }])
    assert.throws(() => guardPerson([bad]), /symmetry violation/)
  assert.doesNotThrow(() => guardPerson([{ name: 'Ali', open: 2, wip: 1, atRisk: 0, oldestInCurrent: 3 }]))
})

test('no per-person row carries a composite score anywhere in the team surface', () => {
  const rows = [...teamBoard(POISONED).rows, ...reviewFlow(POISONED).load, ...ownership(POISONED).rows.flatMap(r => r.owners)]
  assert.doesNotThrow(() => guardPerson(rows, 'all-person-rows'))
})

// ═══ 4. MIN-N — enforced IN THE ENDPOINT, not in the UI ═══════════════════════
const prsFrom = (logins, n = 3) => logins.flatMap((l, i) => Array.from({ length: n }, (_, k) => PR({
  num: i * 10 + k, author: l, createdAt: new Date(Date.now() - (k + 1) * 3 * 864e5).toISOString(),
})))

test('sustainability returns null / suppressed below MIN_N=5 contributors', () => {
  const s = sustainability(snapWith([], prsFrom(['a', 'b', 'c', 'd'])))
  assert.equal(s.available, false)
  assert.equal(s.suppressed, true)
  assert.equal(s.weeks, null)
  assert.equal(s.minN, 5)
  assert.match(s.reason, /min-N/)
})

test('sustainability at or above MIN_N emits weekly aggregates and NO per-person row', () => {
  const s = sustainability(snapWith([], prsFrom(['a', 'b', 'c', 'd', 'e'], 4)))
  assert.equal(s.available, true)
  assert.ok(Array.isArray(s.weeks))
  const json = JSON.stringify(s)
  for (const login of ['a', 'b', 'c', 'd', 'e'])
    assert.equal(new RegExp(`"author"|"login"|"${login}"`).test(json), false, 'sustainability leaked a contributor identity')
  for (const w of s.weeks) {
    assert.ok(!('author' in w) && !('login' in w) && !('name' in w), 'sustainability emitted a per-person row')
    // any weekly cell computed from fewer than MIN_N contributors is suppressed to null
    if (w.contributors < s.minN) assert.equal(w.outsideHoursShare, null, `week ${w.week} exposed a cell built from ${w.contributors} contributors (< ${s.minN})`)
  }
})

test('sustainability is sourced from PR timestamps only — a snapshot with no PRs yields nothing to show', () => {
  const s = sustainability(snapWith([ISSUE({ assignee: person('u1', 'Ali') })], []))
  assert.equal(s.available, false)   // zero contributors < min-N
})

// ═══ aggregation sanity (so the contract above is being tested against real behaviour) ═══
test('teamBoard counts WIP / at-risk / parked and emits a human-sendable nudge line', () => {
  const snap = snapWith([
    ISSUE({ key: 'TRN-1', assignee: person('u1', 'Ali'), rec: { atRisk: true, budget: 1.5 } }),
    ISSUE({ key: 'TRN-2', assignee: person('u1', 'Ali'), status: 'Ready for QA', statusKind: 'wait', active: false, inCurrent: 6 }),
  ], [])
  const r = snap && teamBoard(snap).rows[0]
  assert.equal(r.open, 2); assert.equal(r.wip, 1); assert.equal(r.atRisk, 1)
  assert.ok(r.tickets.some(t => t.parked))
  assert.match(r.tickets[0].nudge, /TRN-\d/)
  assert.ok(r.flags.some(f => /parked/.test(f)))
})

test('reviewFlow queues a PR open past the SLA with zero reviews, and flags concentration', () => {
  const at = new Date().toISOString()
  const snap = snapWith([], [
    PR({ num: 1, author: 'ali', openDays: 5, firstReviewDays: null }),
    PR({ num: 2, author: 'mo', openDays: 6, state: 'Changes requested', firstReviewDays: 1, reviewEvents: [{ state: 'CHANGES_REQUESTED', login: 'zed', at }] }),
  ])
  const rf = reviewFlow(snap, { me: 'ali' })
  assert.equal(rf.queue.length, 2)
  assert.equal(rf.mine.length, 1)
  assert.equal(rf.mine[0].red, true)
  assert.match(rf.queue[0].nudge, /#\d/)
  assert.equal(rf.concentration.top1Share, 1)      // one reviewer holds every review
  assert.equal(rf.concentration.flagged, true)
})

test('ownership flags a single-owner area above the floor and proposes a second owner', () => {
  const prs = Array.from({ length: 12 }, (_, i) => PR({ num: i, author: 'ali', files: [{ path: 'payments/x.ts', add: 1, del: 0 }] }))
  const o = ownership(snapWith([], prs))
  const area = o.rows.find(r => r.area === 'payments')
  assert.equal(area.busFactor, 1)
  assert.equal(area.soleOwner, 'ali')
  assert.match(o.risks[0].proposal, /Pair a second engineer/)
})

test('ciFrom detects a red main and a flaky job (same sha red then green)', () => {
  const t = (h) => new Date(Date.now() - h * 3600e3).toISOString()
  const c = ciFrom([
    { id: 1, headSha: 'aaa', conclusion: 'failure', name: 'build', createdAt: t(10), updatedAt: t(10) },
    { id: 2, headSha: 'aaa', conclusion: 'success', name: 'build', createdAt: t(9), updatedAt: t(8) },
    { id: 3, headSha: 'bbb', conclusion: 'failure', name: 'e2e', createdAt: t(1), updatedAt: t(1) },
  ])
  assert.equal(c.red, true)                 // most recent main run is red
  assert.equal(c.flaky[0].job, 'build')
  assert.ok(c.failureRate > 0)
})

test('effortMix classes bugs and reports a bug-tax headline per team', () => {
  const now = new Date().toISOString()
  const snap = snapWith([
    ISSUE({ key: 'TRN-1', isBug: true, live: true, closedAt: now, activeDays: 4 }),
    ISSUE({ key: 'TRN-2', live: true, closedAt: now, activeDays: 6 }),
  ], [])
  const m = effortMix(snap)
  const q = m.teams[0].quarters.slice(-1)[0]
  assert.equal(q.share.bug, 0.4)
  assert.match(m.headlines[0].line, /bug tax = 40%/)
})
