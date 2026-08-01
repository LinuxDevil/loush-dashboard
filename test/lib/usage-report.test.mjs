import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cacheHitRate, sessionCacheHitRate,
  costByProjectBranch, NO_BRANCH_LABEL, NO_BRANCH_DATA_LABEL,
  subagentUsage,
  anonymiseUsage, toCsv, csvField,
} from '../../lib/usage-report.mjs'
import { entryCost } from '../../lib/pricing.mjs'

const e = (over = {}) => ({ t: Date.UTC(2026, 0, 1), model: 'claude-sonnet-4-6', proj: 'p', in: 0, out: 0, cc: 0, cc5: 0, cc1h: 0, cr: 0, tc: 0, ...over })
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`)

// ---------------------------------------------------------------- 038

test('a session with no tokens at all reports a null hit rate, not 0%', () => {
  // Regression: dividing by a zero denominator and falling back to 0 rendered
  // "0% cache hit rate", which reads as "the cache never helped" rather than
  // "there was nothing to measure".
  const r = cacheHitRate([e(), e()])
  assert.equal(r.session.rate, null)
  assert.equal(r.session.denominator, 0)
  assert.equal(sessionCacheHitRate([]), null)
  for (const turn of r.turns) assert.equal(turn.rate, null)
})

test('the hit rate divides cache reads by reads plus creation plus input', () => {
  // Regression: an earlier denominator omitted input tokens, inflating the rate.
  const r = cacheHitRate([e({ cr: 800, cc: 100, in: 100 })])
  near(r.session.rate, 0.8)
  near(r.turns[0].rate, 0.8)
})

test('per-turn rates stay independent of the session roll-up', () => {
  // Regression: turn rows were being filled with the running session average,
  // so a cold first turn looked as warm as the session that followed it.
  const r = cacheHitRate([e({ in: 1000 }), e({ cr: 1000 })])
  assert.equal(r.turns[0].rate, 0)
  assert.equal(r.turns[1].rate, 1)
  near(r.session.rate, 0.5)
})

test('a malformed entry is counted rather than thrown on', () => {
  // Regression: a null row in the transcript stream crashed the whole report.
  const r = cacheHitRate([null, e({ cr: 10, in: 10 }), 'nope'])
  assert.equal(r.malformed, 2)
  near(r.session.rate, 0.5)
})

// ---------------------------------------------------------------- 032

const fileWith = (proj, branches, over = {}) => ({ path: `/x/${proj}/s.jsonl`, proj, cost: 0, msgs: 0, branches, ...over })

test('an empty branch name survives as its own labelled row', () => {
  // Regression: rows keyed by '' were dropped by a truthiness filter, or worse,
  // relabelled 'main' — spend from detached HEAD / non-git dirs vanished or was
  // attributed to a branch that never ran it.
  const r = costByProjectBranch([
    fileWith('acme', { '': { cost: 3, out: 10, msgs: 2 }, feature: { cost: 1, out: 5, msgs: 1 } }),
  ])
  const branches = r.projects[0].branches
  assert.equal(branches.length, 2)
  const blank = branches.find(b => b.branch === '')
  assert.ok(blank, 'the empty-branch row must exist')
  assert.equal(blank.label, NO_BRANCH_LABEL)
  assert.equal(blank.branchKnown, false)
  assert.equal(blank.cost, 3)
  assert.notEqual(blank.label, 'main')
})

test('a file with no branches map is a different unknown from an empty branch name', () => {
  // Regression: "we have no branch data" was folded into the '' row, making it
  // impossible to tell detached HEAD from a transcript that never recorded git.
  const r = costByProjectBranch([fileWith('acme', {}, { cost: 4, msgs: 1, out: 7 })])
  const [b] = r.projects[0].branches
  assert.equal(b.branch, null)
  assert.equal(b.label, NO_BRANCH_DATA_LABEL)
  assert.equal(b.cost, 4)
})

test('costs and messages roll up two levels, project totals matching their branches', () => {
  // Regression: the project row was read off the file record while branches were
  // summed separately, so the two levels disagreed once a session spanned branches.
  const r = costByProjectBranch([
    fileWith('acme', { main: { cost: 2, out: 10, msgs: 1 }, dev: { cost: 3, out: 20, msgs: 2 } }),
    fileWith('beta', { main: { cost: 10, out: 5, msgs: 4 } }),
  ])
  assert.deepEqual(r.projects.map(p => p.proj), ['beta', 'acme'])
  const acme = r.projects.find(p => p.proj === 'acme')
  assert.equal(acme.cost, 5)
  assert.equal(acme.msgs, 3)
  assert.equal(acme.tokens.out, 30)
  assert.equal(r.totals.cost, 15)
  assert.equal(r.totals.branches, 3)
})

test('token fields the branch record never carried stay null instead of reading as zero', () => {
  // Regression: absent input/cache counts were coerced to 0, so a branch looked
  // like it had done no cache reads when in truth they were never attributed.
  const r = costByProjectBranch([fileWith('acme', { main: { cost: 1, out: 10, msgs: 1 } })])
  const [b] = r.projects[0].branches
  assert.equal(b.tokens.out, 10)
  assert.equal(b.tokens.in, null)
  assert.equal(b.tokens.cacheRead, null)
  assert.equal(b.tokensComplete, false, 'incomplete token attribution must be reported, not hidden')
})

test('a branch that carries raw entries is priced through the shared pricing module', () => {
  // Regression: a second, local price table drifted from lib/pricing.mjs and the
  // branch rollup disagreed with every other cost figure in the dashboard.
  const entry = e({ in: 1e6, out: 1e6 })
  const r = costByProjectBranch([fileWith('acme', { main: { entries: [entry] } })])
  const [b] = r.projects[0].branches
  near(b.cost, entryCost(entry))
  assert.equal(b.tokensComplete, true)
  assert.equal(b.msgs, 1)
})

test('malformed files and branch records are counted, never thrown on', () => {
  // Regression: one corrupt cached record took down the whole /api/usage response.
  const r = costByProjectBranch([null, fileWith('acme', { main: 'not-an-object' }), 7])
  assert.equal(r.malformed, 3)
  assert.equal(r.totals.cost, 0)
})

// ---------------------------------------------------------------- 033

test('auto-compaction is excluded from dispatched subagent totals', () => {
  // Regression: acompact-* sidechains were bucketed as a dispatched agent type,
  // overstating what delegation costs and inventing an "agent" nobody ran.
  const dispatched = e({ in: 1e6, isSidechain: true, path: '/p/subagents/reviewer-abc123de.jsonl' })
  const compact = e({ in: 2e6, isSidechain: true, path: '/p/subagents/acompact-99f0a1b2.jsonl' })
  const r = subagentUsage([dispatched, compact], [])
  assert.deepEqual(r.types.map(t => t.type), ['reviewer'])
  near(r.totals.dispatchedCost, entryCost(dispatched))
  near(r.autoCompaction.cost, entryCost(compact))
  near(r.totals.subagentCost, entryCost(dispatched) + entryCost(compact))
  assert.equal(r.totals.dispatchedMsgs, 1)
})

test('subagents are detected by sidechain flag, agentId or a /subagents/ path segment', () => {
  // Regression: detection keyed only on isSidechain missed transcripts written by
  // older harness versions, silently attributing agent spend to the main chain.
  const bySide = e({ out: 1e6, isSidechain: true, agentType: 'a' })
  const byId = e({ out: 1e6, agentId: 'agent-7', agentType: 'b' })
  const byPath = e({ out: 1e6, path: '/x/subagents/c-11223344.jsonl' })
  const mainChain = e({ out: 1e6, path: '/x/session.jsonl' })
  const r = subagentUsage([bySide, byId, byPath, mainChain], [])
  assert.deepEqual(r.types.map(t => t.type).sort(), ['a', 'b', 'c'])
  assert.equal(r.detection.byIsSidechain, 1)
  assert.equal(r.detection.byAgentId, 1)
  assert.equal(r.detection.byPath, 1)
  near(r.mainChain.cost, entryCost(mainChain))
})

test('types are ranked by cost so the most expensive agent type leads', () => {
  // Regression: insertion order was presented as a ranking.
  const cheap = e({ out: 1e5, isSidechain: true, agentType: 'docs' })
  const dear = e({ out: 5e6, isSidechain: true, agentType: 'explorer' })
  const r = subagentUsage([cheap, dear], [])
  assert.deepEqual(r.types.map(t => t.type), ['explorer', 'docs'])
})

test('an entry shared with a file record is counted once, not twice', () => {
  // Regression: walking entries and files independently double-counted every
  // subagent turn, doubling reported delegation spend.
  const shared = e({ out: 1e6, isSidechain: true })
  const file = { path: '/x/subagents/reviewer-aabbccdd.jsonl', isAgent: true, cost: 999, msgs: 1, entries: [shared] }
  const r = subagentUsage([shared], [file])
  near(r.totals.subagentCost, entryCost(shared))
  assert.equal(r.types[0].type, 'reviewer')
})

test('a subagent file whose entries were not handed in still contributes its cost', () => {
  // Regression: when the caller passed only file summaries, agent spend read as 0.
  const file = { path: '/x/subagents/reviewer-aabbccdd.jsonl', isAgent: true, cost: 2.5, msgs: 3, out: 100 }
  const r = subagentUsage([], [file])
  near(r.totals.dispatchedCost, 2.5)
  assert.equal(r.types[0].sessions, 1)
})

test('subagent attribution survives malformed rows', () => {
  // Regression: a null entry aborted the dispatch report.
  const r = subagentUsage([null, e({ out: 1e6, isSidechain: true, agentType: 'x' })], [undefined])
  assert.equal(r.malformed, 2)
  assert.equal(r.types.length, 1)
})

// ---------------------------------------------------------------- 039

test('CSV quotes and doubles a field containing a quote and a comma', () => {
  // Regression: naive join(',') split one field into two columns and let a stray
  // quote corrupt every following column of the export.
  const csv = toCsv([{ note: 'he said "hi", loudly', n: 1 }])
  assert.equal(csv, 'note,n\r\n"he said ""hi"", loudly",1\r\n')
})

test('CSV quotes a field containing a newline so the row is not split', () => {
  // Regression: an embedded newline broke the record count of the export.
  assert.equal(csvField('a\nb'), '"a\nb"')
  assert.equal(csvField('a\r\nb'), '"a\r\nb"')
})

test('CSV leaves ordinary fields unquoted and renders null as empty, not "null"', () => {
  // Regression: nulls were stringified into the literal text "null" in exports.
  const csv = toCsv([{ a: 'plain', b: null, c: undefined }])
  assert.equal(csv, 'a,b,c\r\nplain,,\r\n')
})

test('CSV export covers every row and every column of the dataset, not a page', () => {
  // Regression: the export reused the table's paged view model, so only the
  // visible 50 rows (and only the visible columns) ever reached the file.
  const rows = Array.from({ length: 250 }, (_, i) => (i === 200 ? { a: i, late: 'x' } : { a: i }))
  const csv = toCsv(rows)
  const lines = csv.trimEnd().split('\r\n')
  assert.equal(lines.length, 251)
  assert.equal(lines[0], 'a,late')
  assert.equal(lines[250], '249,')
})

test('anonymising strips project paths, branch names and prompt text', () => {
  // Regression: an "anonymised" export still carried cwd and the first prompt,
  // leaking repo names and customer names into a shared file.
  const r = anonymiseUsage([
    { proj: '/home/me/acme-secret', cwd: '/home/me/acme-secret', branch: 'feat/customer-x', prompt: 'fix the ACME billing bug', cost: 1.5, model: 'claude-sonnet-4-6' },
  ])
  const [row] = r.rows
  assert.equal(row.cost, 1.5)
  assert.equal(row.model, 'claude-sonnet-4-6')
  assert.equal(row.prompt, null)
  for (const v of Object.values(row)) assert.ok(!String(v).includes('acme') && !String(v).includes('ACME'), 'no repo name may survive')
  assert.ok(!String(row.branch).includes('customer'))
  assert.equal(r.redacted.text, 1)
  assert.equal(r.hashEmitted, false)
})

test('anonymised labels are stable within an export so rows can still be grouped', () => {
  // Regression: a fresh label per row destroyed the grouping the export exists for.
  const r = anonymiseUsage([{ proj: 'a' }, { proj: 'b' }, { proj: 'a' }])
  assert.equal(r.rows[0].proj, r.rows[2].proj)
  assert.notEqual(r.rows[0].proj, r.rows[1].proj)
  assert.equal(r.distinct.project, 2)
})

test('an empty branch name stays empty through anonymisation rather than becoming a label', () => {
  // Regression: '' was pseudonymised into 'branch-1', turning "no branch" into a
  // phantom named branch in shared stats.
  const r = anonymiseUsage([{ branch: '' }, { branch: 'main' }])
  assert.equal(r.rows[0].branch, '')
  assert.equal(r.rows[1].branch, 'branch-1')
})

test('anonymisation reports its method and emits no reversible hash', () => {
  // Regression: an earlier version emitted an unsalted sha of the path, which is
  // a 1:1 map back to the repo name for anyone holding a candidate list.
  const r = anonymiseUsage([{ proj: '/home/me/acme' }])
  assert.equal(r.method, 'sequential-labels')
  assert.equal(r.reversible, false)
  assert.equal(r.salted, false)
  assert.equal(r.truncated, false)
  assert.equal(r.rowCount, 1)
})

test('anonymisation can be turned off and still returns the same envelope', () => {
  // Regression: the non-anonymised path returned a bare array, so callers had to
  // branch on the shape and one of them lost the row count.
  const r = anonymiseUsage([{ proj: 'x', cost: 1 }], { anonymise: false })
  assert.equal(r.rows[0].proj, 'x')
  assert.equal(r.anonymised, false)
  assert.equal(r.rowCount, 1)
})

test('anonymisation counts malformed rows instead of throwing', () => {
  // Regression: a null row in the filtered dataset aborted the export.
  const r = anonymiseUsage([null, { proj: 'x' }, 5])
  assert.equal(r.droppedRows, 2)
  assert.equal(r.rowCount, 1)
  assert.equal(r.inputRowCount, 3)
})

test('anonymised rows feed straight into the CSV writer', () => {
  // Regression: the export pipeline stringified objects with String(), yielding
  // "[object Object]" columns.
  const { rows } = anonymiseUsage([{ proj: '/home/me/acme, inc', cost: 2 }])
  assert.equal(toCsv(rows), 'proj,cost\r\nproject-1,2\r\n')
})
