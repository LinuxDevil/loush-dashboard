// test/lib/tracker.test.mjs — the agent-callable tracker. Everything here is pure: no fs, no express.
// The assertions are deliberately about HONESTY properties, not just happy paths: an unknown status
// is rejected BY NAME, a conflict names BOTH versions, a truncation reports its cap, an update on a
// missing id refuses to invent one.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  TRACKER_STATUSES, TRACKER_TYPES, LIMITS, isTrackerId, isSessionId,
  normalizeState, toArray, trackerCreate, trackerUpdate, trackerList, trackerLinkSession, trackerToolSchemas,
  createTracker,
} from '../../lib/tracker.mjs'

const NOW = 1_700_000_000_000
const seed = (...inputs) => {
  let st = { items: {}, seq: 0 }
  const items = []
  for (const [i, input] of inputs.entries()) {
    const r = trackerCreate(st, input, { now: NOW + i })
    assert.equal(r.ok, true, r.reason || r.error)
    st = r.state
    items.push(r.item)
  }
  return { st, items }
}

// ---------------------------------------------------------------------------
// ids and vocabulary
// ---------------------------------------------------------------------------

test('ids that are not ids are rejected, including prototype-poisoning keys', () => {
  assert.equal(isTrackerId('tk1a2b3c'), true)
  assert.equal(isTrackerId('PROJ-123'), true)
  assert.equal(isTrackerId(''), false)
  assert.equal(isTrackerId('ab'), false)              // too short
  assert.equal(isTrackerId('a'.repeat(65)), false)    // too long
  assert.equal(isTrackerId('has space'), false)
  assert.equal(isTrackerId('../../etc/passwd'), false)
  assert.equal(isTrackerId('a/b'), false)
  assert.equal(isTrackerId(42), false)
  assert.equal(isTrackerId(null), false)
  assert.equal(isTrackerId('__proto__'), false)       // legal string, poisons the item map
  assert.equal(isTrackerId('constructor'), false)
  assert.equal(isSessionId('018f0a3c-1d2e-7a10-9b21-abcdef012345'), true)
  assert.equal(isSessionId('short'), false)
  assert.equal(isSessionId('has space here'), false)
  assert.equal(isSessionId('../etc/passwd'), false)
})

test('the status vocabulary is the human board pipeline', () => {
  assert.deepEqual(TRACKER_STATUSES, [
    'backlog', 'in-progress', 'code-review', 'fixing', 'ready-for-qa',
    'qa-running', 'bug-reported', 'ready-for-release', 'released',
  ])
})

// ---------------------------------------------------------------------------
// tracker_create
// ---------------------------------------------------------------------------

test('create stores an item and reports what was actually stored', () => {
  const r = trackerCreate({}, { title: '  Fix the sidebar  ', project: '/repo/a' }, { now: NOW })
  assert.equal(r.ok, true)
  assert.equal(r.item.title, 'Fix the sidebar')
  assert.equal(r.item.status, 'backlog')
  assert.equal(r.item.version, 1)
  assert.deepEqual(r.stored, { id: r.item.id, title: 'Fix the sidebar', status: 'backlog', project: '/repo/a', version: 1 })
  assert.equal(toArray(r.state).length, 1)
})

test('an unknown status is rejected and the reply NAMES the allowed set', () => {
  const r = trackerCreate({}, { title: 'x', status: 'in progres' }, { now: NOW })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'unknown_status')
  assert.deepEqual(r.allowed, TRACKER_STATUSES)
  assert.match(r.reason, /in progres/)
  assert.equal(r.suggestion, 'in-progress')            // near-miss named so the model can self-correct
  assert.equal(Object.keys(r.state.items).length, 0)   // and nothing was written
})

test('a custom pipeline replaces the allowed set — the agent is held to the columns the human sees', () => {
  const allowedStatuses = ['todo', 'doing', 'shipped']
  const bad = trackerCreate({}, { title: 'x', status: 'backlog' }, { now: NOW, allowedStatuses })
  assert.equal(bad.error, 'unknown_status')
  assert.deepEqual(bad.allowed, allowedStatuses)
  const good = trackerCreate({}, { title: 'x', status: 'doing' }, { now: NOW, allowedStatuses })
  assert.equal(good.ok, true)
  assert.equal(good.item.status, 'doing')
})

test('an unknown type is rejected by name too', () => {
  const r = trackerCreate({}, { title: 'x', type: 'epic' }, { now: NOW })
  assert.equal(r.error, 'unknown_type')
  assert.deepEqual(r.allowed, TRACKER_TYPES)
})

test('over-long free text is capped AND the cap is reported with the dropped length', () => {
  const long = 'y'.repeat(LIMITS.title + 300)
  const r = trackerCreate({}, { title: long, notes: 'z'.repeat(LIMITS.notes + 10) }, { now: NOW })
  assert.equal(r.ok, true)
  assert.equal(r.item.title.length, LIMITS.title)
  const tw = r.warnings.find(w => w.field === 'title')
  assert.equal(tw.cap, LIMITS.title)
  assert.equal(tw.originalLength, long.length)
  assert.equal(tw.dropped, 300)
  assert.match(tw.reason, /NOT stored/)
  assert.ok(r.warnings.find(w => w.field === 'notes' && w.cap === LIMITS.notes))
  assert.equal(r.caps.title, LIMITS.title)             // the caps themselves ride along
})

test('a missing project is null WITH a reason — never defaulted to a plausible project', () => {
  const r = trackerCreate({}, { title: 'x' }, { now: NOW, knownProjects: ['/repo/only'] })
  assert.equal(r.item.project, null)
  assert.match(r.item.unknown.project, /unscoped/)
  // and an unrecognised project is recorded-but-flagged, not silently trusted or dropped
  const r2 = trackerCreate({}, { title: 'x', project: '/repo/ghost' }, { now: NOW, knownProjects: ['/repo/only'] })
  assert.equal(r2.item.project, '/repo/ghost')
  assert.match(r2.item.unknown.project, /not in the known-project list/)
})

test('create never throws on hostile or malformed input', () => {
  for (const bad of [null, undefined, 42, 'string', [], { title: 42 }, { title: 'x', tags: 'nope' }, { title: 'x', id: '__proto__' }]) {
    const r = trackerCreate({}, bad, { now: NOW })
    assert.equal(typeof r.ok, 'boolean')
    assert.equal(r.ok, false)
    assert.ok(r.reason, 'a failure must carry a reason')
  }
  assert.equal(({}).polluted, undefined)
})

test('tags are capped in count and in length, both reported', () => {
  const tags = Array.from({ length: LIMITS.tags + 4 }, (_, i) => 'tag' + i)
  tags[0] = 'x'.repeat(LIMITS.tag + 5)
  const r = trackerCreate({}, { title: 'x', tags }, { now: NOW })
  assert.equal(r.item.tags.length, LIMITS.tags)
  assert.ok(r.warnings.some(w => w.cap === LIMITS.tags))
  assert.ok(r.warnings.some(w => w.field === 'tag' && w.cap === LIMITS.tag))
})

test('a duplicate caller-supplied id fails instead of overwriting', () => {
  const a = trackerCreate({}, { title: 'first', id: 'PROJ-1' }, { now: NOW })
  const b = trackerCreate(a.state, { title: 'second', id: 'PROJ-1' }, { now: NOW })
  assert.equal(b.error, 'id_exists')
  assert.equal(b.currentVersion, 1)
  assert.equal(a.state.items['PROJ-1'].title, 'first')
})

// ---------------------------------------------------------------------------
// tracker_update
// ---------------------------------------------------------------------------

test('update on a nonexistent id FAILS with a reason and never silently creates', () => {
  const { st } = seed({ title: 'real' })
  const r = trackerUpdate(st, { id: 'tk-typo-999', expectedVersion: 1, status: 'in-progress' }, { now: NOW })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'no_such_item')
  assert.match(r.reason, /never creates/)
  assert.equal(Object.keys(r.state.items).length, 1)   // the ghost was NOT created
  assert.equal(r.state.items['tk-typo-999'], undefined)
})

test('update requires expectedVersion — a blind write is refused and the current version is named', () => {
  const { st, items } = seed({ title: 'a' })
  const r = trackerUpdate(st, { id: items[0].id, status: 'in-progress' }, { now: NOW })
  assert.equal(r.error, 'expected_version_required')
  assert.equal(r.currentVersion, 1)
  assert.equal(r.state.items[items[0].id].status, 'backlog')
})

test('a concurrent update conflicts and the conflict NAMES BOTH versions', () => {
  const { st, items } = seed({ title: 'a' })
  const id = items[0].id
  // Two agents both read version 1.
  const first = trackerUpdate(st, { id, expectedVersion: 1, status: 'in-progress' }, { now: NOW + 10 })
  assert.equal(first.ok, true)
  assert.equal(first.version, 2)
  const second = trackerUpdate(first.state, { id, expectedVersion: 1, status: 'code-review' }, { now: NOW + 20 })
  assert.equal(second.ok, false)
  assert.equal(second.error, 'version_conflict')
  assert.equal(second.expectedVersion, 1)
  assert.equal(second.actualVersion, 2)
  assert.match(second.reason, /expectedVersion 1/)
  assert.match(second.reason, /stored version is 2/)
  // last-write-wins would have left 'code-review' here; the first writer's edit survives.
  assert.equal(second.state.items[id].status, 'in-progress')
  assert.equal(second.lastChangedAt, NOW + 10)
})

test('an invalid expectedVersion is rejected rather than coerced', () => {
  const { st, items } = seed({ title: 'a' })
  for (const v of ['one', 0, -3, 1.5, {}]) {
    const r = trackerUpdate(st, { id: items[0].id, expectedVersion: v, status: 'fixing' }, { now: NOW })
    assert.equal(r.error, 'invalid_expected_version', `expectedVersion ${JSON.stringify(v)} should not be accepted`)
    assert.equal(r.currentVersion, 1)
  }
})

test('a successful update returns exactly what changed, field by field', () => {
  const { st, items } = seed({ title: 'a', project: '/repo/a' })
  const id = items[0].id
  const r = trackerUpdate(st, { id, expectedVersion: 1, status: 'ready-for-qa', title: 'a2', notes: 'n' }, { now: NOW + 5 })
  assert.equal(r.ok, true)
  assert.deepEqual(r.changed.map(c => c.field).sort(), ['notes', 'status', 'title'])
  assert.deepEqual(r.changed.find(c => c.field === 'status'), { field: 'status', from: 'backlog', to: 'ready-for-qa' })
  assert.equal(r.previousVersion, 1)
  assert.equal(r.version, 2)
  assert.match(r.reason, /version 2/)
  assert.equal(r.item.history.at(-1).to, 'ready-for-qa')
})

test('a no-op update says so and does NOT bump the version', () => {
  const { st, items } = seed({ title: 'a' })
  const r = trackerUpdate(st, { id: items[0].id, expectedVersion: 1, status: 'backlog' }, { now: NOW + 5 })
  assert.equal(r.ok, true)
  assert.equal(r.noop, true)
  assert.deepEqual(r.changed, [])
  assert.equal(r.version, 1)                       // a needless bump would conflict-storm other holders
  assert.match(r.reason, /NOT bumped/)
})

test('unknown update fields are reported as ignored, not silently swallowed', () => {
  const { st, items } = seed({ title: 'a' })
  const r = trackerUpdate(st, { id: items[0].id, expectedVersion: 1, assignee: 'bob', stage: 'released' }, { now: NOW })
  assert.equal(r.ok, true)
  assert.equal(r.noop, true)
  assert.ok(r.warnings.some(w => w.field === 'assignee' && /not an updatable field/.test(w.reason)))
  assert.ok(r.warnings.some(w => w.field === 'stage'))   // `stage` is the board's word — say it was ignored
})

test('update refuses to blank a title and refuses self-parenting; neither writes', () => {
  const { st, items } = seed({ title: 'a' })
  const id = items[0].id
  const blank = trackerUpdate(st, { id, expectedVersion: 1, title: '   ' }, { now: NOW })
  assert.equal(blank.error, 'title_required')
  assert.equal(blank.state.items[id].title, 'a')
  const self = trackerUpdate(st, { id, expectedVersion: 1, parent: id }, { now: NOW })
  assert.equal(self.error, 'invalid_parent')
})

test('clearing a project keeps SAYING the item is now unscoped', () => {
  const { st, items } = seed({ title: 'a', project: '/repo/a' })
  const r = trackerUpdate(st, { id: items[0].id, expectedVersion: 1, project: null }, { now: NOW })
  assert.equal(r.ok, true)
  assert.equal(r.item.project, null)
  assert.match(r.item.unknown.project, /unscoped/)
})

test('update never throws on hostile input', () => {
  const { st, items } = seed({ title: 'a' })
  for (const bad of [null, 7, [], { id: {} }, { id: items[0].id, expectedVersion: 1, notes: [] }, { id: '__proto__', expectedVersion: 1 }]) {
    const r = trackerUpdate(st, bad, { now: NOW })
    assert.equal(r.ok, false)
    assert.ok(r.reason)
  }
})

// ---------------------------------------------------------------------------
// tracker_link_session
// ---------------------------------------------------------------------------

const SID = '018f0a3c-1d2e-7a10-9b21-abcdef012345'

test('a link to an unknown session is recorded as UNVERIFIED — not rejected, not trusted', () => {
  const { st, items } = seed({ title: 'a' })
  const r = trackerLinkSession(st, { id: items[0].id, sessionId: SID }, { now: NOW, knownSessionIds: ['other-session-id-1'] })
  assert.equal(r.ok, true)                       // recorded
  assert.equal(r.verified, false)                // but flagged
  assert.match(r.verifyReason, /NOT in the supplied session index/)
  assert.match(r.verifyReason, /UNVERIFIED rather than rejected/)
  assert.equal(r.item.links[0].verified, false)
  assert.ok(r.warnings.some(w => w.field === 'sessionId'))
})

test('with no index at all, verification is null ("not checked"), never a hopeful true', () => {
  const { st, items } = seed({ title: 'a' })
  const r = trackerLinkSession(st, { id: items[0].id, sessionId: SID }, { now: NOW })
  assert.equal(r.verified, null)
  assert.match(r.verifyReason, /RECORDED BUT UNCHECKED/)
})

test('a known session verifies, and a later verification upgrades the earlier unverified link', () => {
  const { st, items } = seed({ title: 'a' })
  const id = items[0].id
  const un = trackerLinkSession(st, { id, sessionId: SID }, { now: NOW })
  assert.equal(un.verified, null)
  const up = trackerLinkSession(un.state, { id, sessionId: SID }, { now: NOW + 1, knownSessionIds: new Set([SID]) })
  assert.equal(up.verified, true)
  assert.equal(up.duplicate, true)
  assert.deepEqual(up.changed, [{ field: 'links', from: 'unverified', to: 'verified' }])
  assert.equal(up.item.links.length, 1)          // re-linking does not double-count the work
})

test('re-linking the same session is not a second link and says so', () => {
  const { st, items } = seed({ title: 'a' })
  const id = items[0].id
  const a = trackerLinkSession(st, { id, sessionId: SID }, { now: NOW, knownSessionIds: [SID] })
  const b = trackerLinkSession(a.state, { id, sessionId: SID }, { now: NOW + 1, knownSessionIds: [SID] })
  assert.equal(b.duplicate, true)
  assert.deepEqual(b.changed, [])
  assert.match(b.reason, /already linked/)
  assert.equal(b.item.links.length, 1)
})

test('the per-item link list is capped and the cap is reported', () => {
  let { st, items } = seed({ title: 'a' })
  const id = items[0].id
  let last
  for (let i = 0; i < LIMITS.links + 3; i++) {
    last = trackerLinkSession(st, { id, sessionId: `session-${String(i).padStart(6, '0')}` }, { now: NOW + i })
    assert.equal(last.ok, true, last.reason)
    st = last.state
  }
  assert.equal(last.item.links.length, LIMITS.links)
  assert.equal(last.capped.cap, LIMITS.links)
  assert.ok(last.capped.dropped >= 1)
  assert.match(last.capped.reason, /NOT recoverable/)
})

test('link rejects unusable ids and a link to a missing item, without throwing', () => {
  const { st, items } = seed({ title: 'a' })
  assert.equal(trackerLinkSession(st, { id: items[0].id, sessionId: 'nope' }, { now: NOW }).error, 'invalid_session_id')
  assert.equal(trackerLinkSession(st, { id: 'tk-nope-1', sessionId: SID }, { now: NOW }).error, 'no_such_item')
  assert.equal(trackerLinkSession(st, null, { now: NOW }).error, 'invalid_input')
})

// ---------------------------------------------------------------------------
// tracker_list
// ---------------------------------------------------------------------------

test('list reports the pre-paging total and never lets a page read as the whole board', () => {
  let st = { items: {}, seq: 0 }
  for (let i = 0; i < 12; i++) st = trackerCreate(st, { title: 'item ' + i, project: '/repo/a' }, { now: NOW + i }).state
  const r = trackerList(st, { limit: 5 })
  assert.equal(r.ok, true)
  assert.equal(r.total, 12)
  assert.equal(r.returned, 5)
  assert.equal(r.more, true)
  assert.match(r.reason, /5 of 12/)
  assert.match(r.reason, /7 more remain/)
  const page2 = trackerList(st, { limit: 5, offset: 5 })
  assert.equal(page2.returned, 5)
  assert.equal(page2.more, true)
})

test('a page size beyond the hard cap is capped AND the cap is reported', () => {
  const { st } = seed({ title: 'a' })
  const r = trackerList(st, { limit: 10_000 })
  assert.equal(r.limit, LIMITS.listPageMax)
  assert.equal(r.limitCapped.asked, 10_000)
  assert.equal(r.limitCapped.cap, LIMITS.listPageMax)
  assert.match(r.limitCapped.reason, /hard page cap/)
})

test('an unknown status FILTER is rejected by name rather than quietly returning everything', () => {
  const { st } = seed({ title: 'a' }, { title: 'b' })
  const r = trackerList(st, { status: 'done' })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'unknown_status')
  assert.deepEqual(r.allowed, TRACKER_STATUSES)
  assert.deepEqual(r.items, [])      // NOT the whole board under a "done" heading
  assert.equal(r.total, 0)
})

test('list filters, states which filters were applied, and can reach unscoped items', () => {
  const { st, items } = seed(
    { title: 'alpha', project: '/repo/a' },
    { title: 'beta', project: '/repo/b', status: 'in-progress' },
    { title: 'orphan' },
  )
  assert.equal(trackerList(st, { project: '/repo/a' }).total, 1)
  assert.equal(trackerList(st, { status: 'in-progress' }).items[0].title, 'beta')
  assert.deepEqual(trackerList(st, { status: ['backlog', 'in-progress'] }).total, 3)
  assert.equal(trackerList(st, { text: 'ORPH' }).total, 1)
  const unscoped = trackerList(st, { project: null })
  assert.equal(unscoped.total, 1)
  assert.equal(unscoped.items[0].title, 'orphan')
  const all = trackerList(st, {})
  assert.equal(all.unscopedCount, 1)               // the board can state "1 item is in no project"
  assert.deepEqual(trackerList(st, { project: '/repo/a' }).filters, { project: '/repo/a' })
  assert.equal(items.length, 3)
})

test('list can find items by the session that worked them', () => {
  const { st, items } = seed({ title: 'a' }, { title: 'b' })
  const linked = trackerLinkSession(st, { id: items[1].id, sessionId: SID }, { now: NOW })
  const r = trackerList(linked.state, { sessionId: SID })
  assert.equal(r.total, 1)
  assert.equal(r.items[0].id, items[1].id)
})

// ---------------------------------------------------------------------------
// malformed persisted state
// ---------------------------------------------------------------------------

test('malformed persisted state is repaired and every repair is reported', () => {
  const { state, repairs } = normalizeState({
    items: [
      { id: 'ok-item-1', title: 'fine', version: 3 },
      { id: 'ok-item-1', title: 'dupe' },
      { id: 'bad id', title: 'unreachable' },
      null,
      { id: 'no-version-1', title: 'v?', version: 'x' },
    ],
    seq: 'nope',
  })
  assert.equal(Object.keys(state.items).length, 2)
  assert.equal(state.items['ok-item-1'].title, 'fine')
  assert.equal(state.items['no-version-1'].version, 1)
  assert.equal(state.seq, 0)
  assert.ok(repairs.some(r => /duplicate id/.test(r.reason)))
  assert.ok(repairs.some(r => /no usable id/.test(r.reason)))
  assert.ok(repairs.some(r => /version missing/.test(r.reason)))
})

test('every entry point survives garbage state without throwing', () => {
  for (const bad of [null, undefined, 3, 'x', [], { items: 5 }, { items: [1, 2] }]) {
    assert.equal(typeof trackerList(bad, {}).ok, 'boolean')
    assert.equal(typeof trackerCreate(bad, { title: 'x' }, { now: NOW }).ok, 'boolean')
    assert.equal(typeof trackerUpdate(bad, { id: 'aaa', expectedVersion: 1 }, { now: NOW }).ok, 'boolean')
    assert.equal(typeof trackerLinkSession(bad, { id: 'aaa', sessionId: SID }, { now: NOW }).ok, 'boolean')
  }
})

test('the tool schemas are generated from the same constants the validators enforce', () => {
  const s = trackerToolSchemas()
  assert.deepEqual(s.map(x => x.name), ['tracker_create', 'tracker_update', 'tracker_list', 'tracker_link_session'])
  assert.match(s[0].description, /backlog \| in-progress/)
  assert.match(s[0].description, new RegExp(String(LIMITS.title)))
  assert.match(s[1].description, /expectedVersion/)
  assert.match(s[3].description, /UNVERIFIED/)
  const custom = trackerToolSchemas(['todo', 'doing'])
  assert.match(custom[0].description, /todo \| doing/)   // a custom pipeline changes what the model is told
})

// ---------------------------------------------------------------------------
// createTracker — the injected-persistence adapter. Still no fs anywhere: read/write are functions,
// so the store's failure modes (unreadable, unwritable, absent, corrupt) are all testable in memory.
// ---------------------------------------------------------------------------

const memStore = (initial = { items: {}, seq: 0 }) => {
  let saved = initial
  const writes = []
  return {
    io: { read: () => saved, write: s => { writes.push(s); saved = s }, now: () => NOW },
    writes,
    get current() { return saved },
  }
}

test('createTracker persists through the injected write(), and only when something changed', async () => {
  const store = memStore()
  const t = createTracker(store.io)
  const c = await t.tracker_create({ title: 'a' })
  assert.equal(c.ok, true)
  assert.equal(c.persisted, true)
  assert.equal(store.writes.length, 1)
  const id = c.item.id

  const noop = await t.tracker_update({ id, expectedVersion: 1, status: 'backlog' })
  assert.equal(noop.noop, true)
  assert.equal(store.writes.length, 1, 'a no-op must not rewrite the store')

  const list = await t.tracker_list({})
  assert.equal(list.total, 1)
  assert.equal(store.writes.length, 1, 'list must never write')

  const up = await t.tracker_update({ id, expectedVersion: 1, status: 'in-progress' })
  assert.equal(up.persisted, true)
  assert.equal(store.current.items[id].status, 'in-progress')
})

test('createTracker compare-and-sets against the LIVE store, not a stale snapshot', async () => {
  const store = memStore()
  const t = createTracker(store.io)
  const id = (await t.tracker_create({ title: 'a' })).item.id
  await t.tracker_update({ id, expectedVersion: 1, status: 'in-progress' })   // another writer got there first
  const mine = await t.tracker_update({ id, expectedVersion: 1, status: 'released' })
  assert.equal(mine.error, 'version_conflict')
  assert.equal(mine.expectedVersion, 1)
  assert.equal(mine.actualVersion, 2)
  assert.equal(store.current.items[id].status, 'in-progress')                 // the earlier edit survives
})

test('a store that cannot be read or written reports it instead of pretending', async () => {
  const noRead = createTracker({ write: () => {} })
  assert.equal((await noRead.tracker_list({})).error, 'store_unavailable')

  const boom = createTracker({ read: () => { throw new Error('EACCES') }, write: () => {} })
  const r = await boom.tracker_create({ title: 'a' })
  assert.equal(r.error, 'store_read_failed')
  assert.match(r.reason, /EACCES/)

  const badWrite = createTracker({ read: () => ({ items: {}, seq: 0 }), write: () => { throw new Error('disk full') } })
  const w = await badWrite.tracker_create({ title: 'a' })
  assert.equal(w.error, 'store_write_failed')
  assert.equal(w.persisted, false)
  assert.match(w.reason, /Treat this as not applied/)

  const noWrite = createTracker({ read: () => ({ items: {}, seq: 0 }) })
  const nw = await noWrite.tracker_create({ title: 'a' })
  assert.equal(nw.ok, true)
  assert.equal(nw.persisted, false)
  assert.match(nw.reason, /NOT persisted/)
})

test('createTracker re-reads the injected pipeline on every call, so the agent tracks the human board', async () => {
  const store = memStore()
  let stages = ['todo', 'doing']
  const t = createTracker({ ...store.io, allowedStatuses: () => stages })
  assert.equal((await t.tracker_create({ title: 'a', status: 'backlog' })).error, 'unknown_status')
  assert.equal((await t.tracker_create({ title: 'a', status: 'doing' })).ok, true)
  stages = ['todo', 'doing', 'shipped']                 // the human edits the pipeline template
  assert.equal((await t.tracker_create({ title: 'b', status: 'shipped' })).ok, true)
  assert.match(t.schemas()[0].description, /todo \| doing \| shipped/)
})

test('omitting knownSessionIds yields "not checked" — injecting an empty list is a different claim', async () => {
  const unchecked = createTracker(memStore().io)
  const id = (await unchecked.tracker_create({ title: 'a' })).item.id
  assert.equal((await unchecked.tracker_link_session({ id, sessionId: SID })).verified, null)

  const checked = createTracker({ ...memStore().io, knownSessionIds: () => [] })
  const id2 = (await checked.tracker_create({ title: 'a' })).item.id
  const r = await checked.tracker_link_session({ id: id2, sessionId: SID })
  assert.equal(r.verified, false)                       // checked, and it is not there
  assert.match(r.verifyReason, /NOT in the supplied session index/)
})

test('the adapter never throws, whatever the store or the caller hands it', async () => {
  const t = createTracker(memStore().io)
  for (const bad of [null, undefined, 5, 'x', []]) {
    for (const fn of [t.tracker_create, t.tracker_update, t.tracker_link_session, t.tracker_list]) {
      const r = await fn(bad)
      assert.equal(typeof r.ok, 'boolean')
    }
  }
  const weird = createTracker({ read: () => 'not a state', write: () => {} })
  assert.equal((await weird.tracker_list({})).ok, true)
  assert.equal((await weird.tracker_list({})).total, 0)
})
