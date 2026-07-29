// test/lib/todos.test.mjs — the TODO model. Everything here is pure: no fs, no express, no React.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  STATUS_IDS, TERMINAL_STATUS, stepStatus, statusIndex,
  dayKey, isDayKey, dayStart, dayEnd, shiftDay, humanDay, dottedDay,
  normalizeRel, dirOfRel, normalizeTodo, applyPatch, progressOf,
  partitionByDate, dayStats, groupByPath, suggestFromActivity,
  rollForward, carriedDays, stageIntervals, stageDurations, timeInStages, humanMs, periodRange, insights,
} from '../../lib/todos.mjs'

test('stages are the requested pipeline, in order', () => {
  assert.deepEqual(STATUS_IDS, [
    'draft', 'in-progress', 'code-review', 'design-qa', 'manual-qa', 'ready-for-release', 'live',
  ])
  assert.equal(TERMINAL_STATUS, 'live')
})

test('stepStatus clamps at both ends rather than wrapping', () => {
  assert.equal(stepStatus('draft', -1), 'draft')
  assert.equal(stepStatus('draft', +1), 'in-progress')
  assert.equal(stepStatus('live', +1), 'live')
  assert.equal(stepStatus('live', -1), 'ready-for-release')
  assert.equal(statusIndex('nope'), 0) // unknown ids never produce a negative index
})

test('day keys are LOCAL, not UTC', () => {
  // 2025-07-28 00:30 local. toISOString() would file this under the 27th in any positive offset.
  const d = new Date(2025, 6, 28, 0, 30)
  assert.equal(dayKey(d), '2025-07-28')
  assert.equal(dottedDay('2025-07-28'), '28.7.2025')
  assert.equal(dayEnd('2025-07-28') - dayStart('2025-07-28'), 86_400_000)
  assert.equal(new Date(dayStart('2025-07-28')).getDate(), 28)
})

test('day arithmetic crosses months and DST without drifting', () => {
  assert.equal(shiftDay('2025-07-28', 1), '2025-07-29')
  assert.equal(shiftDay('2025-08-01', -1), '2025-07-31')
  assert.equal(shiftDay('2025-03-01', -1), '2025-02-28')
  assert.equal(shiftDay('2024-03-01', -1), '2024-02-29') // leap year
  assert.equal(isDayKey('2025-7-28'), false)
  assert.equal(isDayKey('yesterday'), false)
})

test('humanDay names the near days relative to the given today', () => {
  assert.equal(humanDay('2025-07-28', '2025-07-28'), 'today')
  assert.equal(humanDay('2025-07-27', '2025-07-28'), 'yesterday')
  assert.equal(humanDay('2025-07-29', '2025-07-28'), 'tomorrow')
  assert.match(humanDay('2025-07-20', '2025-07-28'), /Jul/)
})

test('paths are normalised and traversal is rejected, not clamped', () => {
  assert.equal(normalizeRel('./src/ui/Drawer.jsx'), 'src/ui/Drawer.jsx')
  assert.equal(normalizeRel('src\\ui\\Drawer.jsx'), 'src/ui/Drawer.jsx')
  assert.equal(normalizeRel('/src/a.js'), 'src/a.js')
  assert.equal(normalizeRel('../../etc/passwd'), null)
  assert.equal(normalizeRel('  '), null)
  assert.equal(dirOfRel('src/ui/Drawer.jsx'), 'src/ui')
  assert.equal(dirOfRel('README.md'), '.')
})

test('normalizeTodo defaults an unknown stage to draft instead of throwing the row away', () => {
  const t = normalizeTodo({ title: '  ship the drawer  ', status: 'nonsense', date: 'whenever' }, 1_000)
  assert.equal(t.title, 'ship the drawer')
  assert.equal(t.status, 'draft')
  assert.equal(isDayKey(t.date), true) // fell back to the day of `now`
  assert.equal(t.done, false)
  assert.deepEqual(t.history, [{ at: 1_000, from: null, to: 'draft', note: 'created' }])
})

test('normalizeTodo requires a title and derives dir from file', () => {
  assert.throws(() => normalizeTodo({ title: '   ' }), /title is required/)
  const t = normalizeTodo({ title: 'x', file: 'src/sections/TodosSection.jsx', dir: 'ignored/because/file/wins' })
  assert.equal(t.dir, 'src/sections')
  assert.equal(t.file, 'src/sections/TodosSection.jsx')
})

test('a todo created directly at live is already done', () => {
  const t = normalizeTodo({ title: 'shipped last week', status: 'live' }, 5)
  assert.equal(t.done, true)
  assert.equal(t.doneAt, 5)
})

test('ticking the box completes without silently promoting the stage', () => {
  const t = normalizeTodo({ title: 'a', status: 'draft' }, 1)
  const done = applyPatch(t, { done: true }, 2)
  assert.equal(done.done, true)
  assert.equal(done.doneAt, 2)
  assert.equal(done.status, 'draft', 'ticking must not claim the work shipped')
})

test('moving to live ticks the box; un-ticking live walks the stage back', () => {
  const t = normalizeTodo({ title: 'a' }, 1)
  const live = applyPatch(t, { status: 'live' }, 2)
  assert.equal(live.done, true)
  const back = applyPatch(live, { done: false }, 3)
  assert.equal(back.done, false)
  assert.equal(back.status, 'ready-for-release', 'live && !done is not a real state')
  assert.equal(back.history.at(-1).to, 'ready-for-release')
})

test('applyPatch does not mutate its input', () => {
  const t = normalizeTodo({ title: 'a', subtasks: [{ title: 's1' }] }, 1)
  const next = applyPatch(t, { subtaskAdd: 's2', status: 'in-progress' }, 2)
  assert.equal(t.subtasks.length, 1)
  assert.equal(t.status, 'draft')
  assert.equal(next.subtasks.length, 2)
  assert.equal(next.status, 'in-progress')
})

test('sub-tasks add, toggle and remove by id', () => {
  let t = normalizeTodo({ title: 'a' }, 1)
  t = applyPatch(t, { subtaskAdd: 'write the test' }, 2)
  t = applyPatch(t, { subtaskAdd: 'run it' }, 3)
  assert.deepEqual(progressOf(t), { done: 0, total: 2, pct: 0 })
  const first = t.subtasks[0].id
  t = applyPatch(t, { subtaskToggle: first }, 4)
  assert.equal(t.subtasks[0].done, true)
  assert.equal(progressOf(t).pct, 50)
  t = applyPatch(t, { subtaskToggle: first, subtaskDone: true }, 5)
  assert.equal(t.subtasks[0].done, true, 'explicit subtaskDone is not a toggle')
  t = applyPatch(t, { subtaskRemove: first }, 6)
  assert.equal(t.subtasks.length, 1)
})

test('a todo with no sub-tasks is not 0% done', () => {
  assert.deepEqual(progressOf(normalizeTodo({ title: 'a' })), { done: 0, total: 0, pct: null })
})

test('stage changes are recorded in history with from/to', () => {
  let t = normalizeTodo({ title: 'a' }, 1)
  t = applyPatch(t, { status: 'code-review', note: 'PR up' }, 2)
  assert.deepEqual(t.history.at(-1), { at: 2, from: 'draft', to: 'code-review', note: 'PR up' })
  const same = applyPatch(t, { status: 'code-review' }, 3)
  assert.equal(same.history.length, t.history.length, 'a no-op stage set writes no history')
})

test('partitionByDate carries unfinished past work forward and never hides it', () => {
  const mk = (d, done, status = 'draft') => ({ ...normalizeTodo({ title: d + status, date: d, status }), done })
  const todos = [
    mk('2025-07-28', false), mk('2025-07-28', true),
    mk('2025-07-27', false), mk('2025-07-26', true), // the finished one does NOT carry
    mk('2025-07-29', false),
  ]
  const { onDate, carry, later } = partitionByDate(todos, '2025-07-28')
  assert.equal(onDate.length, 2)
  assert.equal(carry.length, 1)
  assert.equal(carry[0].date, '2025-07-27')
  assert.equal(later.length, 1)
  assert.deepEqual(dayStats(onDate).byStatus.draft, 2)
  assert.deepEqual({ ...dayStats(onDate), byStatus: undefined }, { total: 2, done: 1, open: 1, byStatus: undefined })
})

test('groupByPath builds directory → file → todos and keeps unattached rows visible', () => {
  const t = (title, file, dir) => normalizeTodo({ title, file, dir, date: '2025-07-28' })
  const { dirs, loose } = groupByPath([
    t('a', 'src/ui/Drawer.jsx'),
    t('b', 'src/ui/Drawer.jsx'),
    t('c', 'src/ui/tabs.jsx'),
    t('d', null, 'server'),
    t('e'),
  ])
  assert.deepEqual(dirs.map(d => d.dir), ['server', 'src/ui'])
  const ui = dirs.find(d => d.dir === 'src/ui')
  assert.equal(ui.count, 3)
  assert.deepEqual(ui.files.map(f => f.file), ['src/ui/Drawer.jsx', 'src/ui/tabs.jsx'])
  assert.equal(ui.files[0].todos.length, 2)
  assert.equal(dirs.find(d => d.dir === 'server').todos.length, 1, 'directory-level todos hang off the directory')
  assert.equal(loose.length, 1, 'a todo with no path is shown, not dropped')
})

test('groupByPath counts done per directory and per file', () => {
  const a = { ...normalizeTodo({ title: 'a', file: 'src/a.js' }), done: true }
  const b = normalizeTodo({ title: 'b', file: 'src/a.js' })
  const { dirs } = groupByPath([a, b])
  assert.equal(dirs[0].done, 1)
  assert.equal(dirs[0].count, 2)
  assert.equal(dirs[0].files[0].done, 1)
})

test('suggestFromActivity scopes to the day, to the repo, and joins failures', () => {
  const root = '/home/me/repo'
  const on = dayStart('2025-07-28') + 3_600_000
  const before = dayStart('2025-07-28') - 1
  const edits = [
    { t: on, file: root + '/src/ui/Drawer.jsx', add: 10, del: 2, sessionId: 's1' },
    { t: on + 60, file: root + '/src/ui/Drawer.jsx', add: 4, del: 0, sessionId: 's2' },
    { t: on, file: root + '/server/index.mjs', add: 1, del: 1, sessionId: 's1' },
    { t: before, file: root + '/src/ui/old.jsx', add: 9, del: 9, sessionId: 's0' }, // wrong day
    { t: on, file: '/elsewhere/other.js', add: 5, del: 5, sessionId: 's3' },        // wrong repo
  ]
  const errors = [
    { t: on, file: root + '/src/ui/Drawer.jsx', tool: 'Edit', text: 'string not found' },
    { t: on, file: root + '/src/ui/never-edited.jsx', tool: 'Edit', text: 'ignored' },
  ]
  const out = suggestFromActivity({
    edits, errors, root, date: '2025-07-28',
    existing: [normalizeTodo({ title: 'already', file: 'server/index.mjs', root, date: '2025-07-28' })],
  })
  assert.equal(out.files, 2)
  assert.equal(out.edits, 3)
  assert.deepEqual(out.dirs.map(d => d.dir), ['src/ui', 'server'], 'ranked by edit volume')
  const drawer = out.dirs[0].files[0]
  assert.equal(drawer.file, 'src/ui/Drawer.jsx')
  assert.equal(drawer.edits, 2)
  assert.equal(drawer.add, 14)
  assert.equal(drawer.sessions, 2)
  assert.equal(drawer.failures, 1)
  assert.equal(drawer.hasTodo, false)
  assert.equal(out.dirs[1].files[0].hasTodo, true, 'files already filed for this day are marked')
})

test('suggestFromActivity is empty, not wrong, without a root or a valid day', () => {
  assert.deepEqual(suggestFromActivity({ edits: [{ t: 1, file: '/a/b.js' }], root: '', date: '2025-07-28' }), { dirs: [], files: 0, edits: 0 })
  assert.deepEqual(suggestFromActivity({ edits: [], root: '/a', date: 'nope' }), { dirs: [], files: 0, edits: 0 })
})

// ── roll-over ────────────────────────────────────────────────────────────────────────────────────

test('rollForward moves unfinished past work onto today and leaves finished work where it was', () => {
  const mk = (date, done) => ({ ...normalizeTodo({ title: date + (done ? ' done' : ' open'), date }, 1), done })
  const todos = [mk('2025-07-26', false), mk('2025-07-26', true), mk('2025-07-28', false), mk('2025-07-30', false)]
  const { todos: next, moved, changed } = rollForward(todos, '2025-07-28', 5_000)
  assert.equal(changed, true)
  assert.equal(moved.length, 1, 'only the unfinished todo from an EARLIER day moves')
  assert.equal(moved[0].from, '2025-07-26')
  assert.equal(next[0].date, '2025-07-28')
  assert.equal(next[1].date, '2025-07-26', 'a finished todo is the record of the day it was finished on')
  assert.equal(next[2].date, '2025-07-28', 'today is left alone')
  assert.equal(next[3].date, '2025-07-30', 'a future todo is not dragged backwards')
})

test('roll-over keeps the original day, counts the moves, and logs each one', () => {
  let t = normalizeTodo({ title: 'a', date: '2025-07-25' }, 1)
  ;({ todos: [t] } = rollForward([t], '2025-07-26', 2))
  ;({ todos: [t] } = rollForward([t], '2025-07-27', 3))
  assert.equal(t.date, '2025-07-27')
  assert.equal(t.firstDate, '2025-07-25', 'the day it was originally filed for never moves')
  assert.equal(t.rollovers, 2)
  assert.equal(carriedDays(t, '2025-07-28'), 3)
  const rolls = t.history.filter(h => h.kind === 'rollover')
  assert.deepEqual(rolls.map(r => [r.fromDate, r.toDate]), [['2025-07-25', '2025-07-26'], ['2025-07-26', '2025-07-27']])
})

test('rollForward is a no-op when nothing is overdue, and never counts a todo twice', () => {
  const t = normalizeTodo({ title: 'a', date: '2025-07-28' }, 1)
  const once = rollForward([t], '2025-07-28')
  assert.equal(once.changed, false)
  assert.equal(once.todos.length, 1)
  const twice = rollForward(rollForward([normalizeTodo({ title: 'b', date: '2025-07-27' }, 1)], '2025-07-28').todos, '2025-07-28')
  assert.equal(twice.changed, false, 'a second pass on the same day moves nothing — one piece of work, one row')
  assert.equal(twice.todos.length, 1)
})

test('a roll-over is not a stage change', () => {
  let t = normalizeTodo({ title: 'a', date: '2025-07-27', status: 'code-review' }, 1)
  ;({ todos: [t] } = rollForward([t], '2025-07-28', 2))
  assert.equal(t.status, 'code-review')
  assert.equal(stageIntervals(t, 3).length, 1, 'the timeline is not split by a date change')
})

// ── time in each column ──────────────────────────────────────────────────────────────────────────

const H = 3_600_000

test('stage durations follow the transitions', () => {
  let t = normalizeTodo({ title: 'a' }, 0)
  t = applyPatch(t, { status: 'in-progress' }, 2 * H)
  t = applyPatch(t, { status: 'code-review' }, 5 * H)
  const d = stageDurations(t, { now: 6 * H })
  assert.equal(d.byStatus.draft, 2 * H)
  assert.equal(d.byStatus['in-progress'], 3 * H)
  assert.equal(d.byStatus['code-review'], 1 * H)
  assert.equal(d.total, 6 * H)
})

test('the clock stops when a todo is ticked', () => {
  let t = normalizeTodo({ title: 'a' }, 0)
  t = applyPatch(t, { status: 'in-progress' }, 1 * H)
  t = applyPatch(t, { done: true }, 3 * H)
  const a = timeInStages(t, 3 * H)
  const b = timeInStages(t, 1000 * H) // a month later, same numbers
  assert.deepEqual(a.byStatus, b.byStatus)
  assert.equal(b.byStatus['in-progress'], 2 * H)
  assert.equal(b.leadMs, 3 * H)
  assert.equal(b.current.open, false)
})

test('lead time is null until it is finished — never "so far"', () => {
  let t = normalizeTodo({ title: 'a' }, 0)
  t = applyPatch(t, { status: 'manual-qa' }, 2 * H)
  const x = timeInStages(t, 9 * H)
  assert.equal(x.leadMs, null)
  assert.equal(x.ageMs, 9 * H)
  assert.deepEqual(x.current, { status: 'manual-qa', ms: 7 * H, open: true })
})

test('stage time clips to a window so a long todo is not counted into two months', () => {
  let t = normalizeTodo({ title: 'a' }, 0)
  t = applyPatch(t, { status: 'code-review' }, 10 * H)
  const early = stageDurations(t, { from: 0, to: 4 * H, now: 20 * H })
  const late = stageDurations(t, { from: 4 * H, to: 20 * H, now: 20 * H })
  assert.equal(early.total, 4 * H)
  assert.equal(late.total, 16 * H)
  assert.equal(early.byStatus.draft, 4 * H)
  assert.equal(late.byStatus.draft, 6 * H)
  assert.equal(late.byStatus['code-review'], 10 * H)
})

test('a todo with no usable history still reports its current stage rather than nothing', () => {
  const legacy = { id: 'x', title: 'legacy', status: 'design-qa', createdAt: 0, done: false, history: [] }
  const d = stageDurations(legacy, { now: 5 * H })
  assert.equal(d.byStatus['design-qa'], 5 * H)
})

test('humanMs is compact and never fabricates a number for null', () => {
  assert.equal(humanMs(null), '—')
  assert.equal(humanMs(45_000), '45s')
  assert.equal(humanMs(90 * 60_000), '1h 30m')
  assert.equal(humanMs(26 * H), '1d 2h')
  assert.equal(humanMs(48 * H), '2d')
})

// ── insights ─────────────────────────────────────────────────────────────────────────────────────

test('periodRange builds an ISO week (Monday-start), a calendar month and a single day', () => {
  const w = periodRange('week', '2025-07-31') // a Thursday
  assert.equal(w.from, '2025-07-28')
  assert.equal(w.to, '2025-08-04')
  assert.equal(w.days, 7)
  const sunday = periodRange('week', '2025-08-03')
  assert.equal(sunday.from, '2025-07-28', 'Sunday is the END of its week, not the start of a new one')
  const m = periodRange('month', '2025-07-15')
  assert.equal(m.from, '2025-07-01')
  assert.equal(m.to, '2025-08-01')
  assert.equal(m.days, 31)
  const d = periodRange('day', '2025-07-28')
  assert.deepEqual([d.from, d.to, d.days], ['2025-07-28', '2025-07-29', 1])
})

test('insights counts created, completed and open honestly', () => {
  const day = '2025-07-28'
  const t0 = dayStart(day)
  let a = normalizeTodo({ title: 'a', date: day }, t0 + H)
  a = applyPatch(a, { done: true }, t0 + 3 * H)
  const b = normalizeTodo({ title: 'b', date: day }, t0 + 2 * H)
  const older = normalizeTodo({ title: 'older', date: '2025-07-01' }, dayStart('2025-07-01'))
  const i = insights([a, b, older], { period: 'day', date: day, now: t0 + 5 * H })
  assert.equal(i.counts.created, 2, 'the July 1 todo was not created in this window')
  assert.equal(i.counts.completed, 1)
  assert.equal(i.counts.active, 3, 'the still-open older todo is active in this window')
  assert.equal(i.completionRate, 50)
  assert.equal(i.leadTime.n, 1)
  assert.equal(i.leadTime.medianMs, 2 * H)
  assert.equal(i.series.length, 24, 'a day is bucketed by hour')
})

test('completion rate is null, not 0%, when nothing was created', () => {
  const i = insights([], { period: 'week', date: '2025-07-28', now: dayStart('2025-07-28') })
  assert.equal(i.completionRate, null)
  assert.equal(i.empty, true)
  assert.equal(i.series.length, 7)
})

test('insights per-stage time is clipped to the window and carries n', () => {
  const day = '2025-07-28', t0 = dayStart(day)
  let a = normalizeTodo({ title: 'a', date: day }, t0 - 48 * H) // created two days earlier
  a = applyPatch(a, { status: 'code-review' }, t0 + 2 * H)
  const i = insights([a], { period: 'day', date: day, now: t0 + 6 * H })
  const draft = i.stages.find(s => s.status === 'draft')
  const cr = i.stages.find(s => s.status === 'code-review')
  assert.equal(draft.totalMs, 2 * H, 'only the part of Draft that falls inside the day counts')
  assert.equal(cr.totalMs, 4 * H)
  assert.equal(draft.n, 1)
})

test('no bottleneck is named below the minimum sample — one card is not a trend', () => {
  const day = '2025-07-28', t0 = dayStart(day)
  const one = insights([normalizeTodo({ title: 'a', date: day }, t0)], { period: 'day', date: day, now: t0 + 4 * H })
  assert.equal(one.bottleneck, null)
  const two = insights(
    [normalizeTodo({ title: 'a', date: day }, t0), normalizeTodo({ title: 'b', date: day }, t0)],
    { period: 'day', date: day, now: t0 + 4 * H })
  assert.equal(two.bottleneck.status, 'draft')
  assert.equal(two.bottleneck.n, 2)
})

test('insights reports roll-over pressure and the oldest carried work', () => {
  const day = '2025-07-28', t0 = dayStart(day)
  let t = normalizeTodo({ title: 'stuck in review', date: '2025-07-25', status: 'code-review' }, dayStart('2025-07-25'))
  ;({ todos: [t] } = rollForward([t], '2025-07-26', dayStart('2025-07-26')))
  ;({ todos: [t] } = rollForward([t], '2025-07-28', t0))
  // The week of the 28th is Mon 28 → Sun 3, so only the SECOND roll-over falls inside it. That is the
  // point of the counter: "how much work was pushed forward during this window", not "ever".
  const week = insights([t], { period: 'week', date: day, now: t0 + H })
  assert.equal(week.counts.rollovers, 1)
  const month = insights([t], { period: 'month', date: day, now: t0 + H })
  assert.equal(month.counts.rollovers, 2, 'July contains both moves')
  // Aging is the todo's whole life, not the window's slice — it is the age of the thing itself.
  assert.equal(week.aging[0].title, 'stuck in review')
  assert.equal(week.aging[0].rollovers, 2)
  assert.equal(week.aging[0].days, 3)
})

test('insights groups by directory and by JIRA ticket, with per-stage time per ticket', () => {
  const day = '2025-07-28', t0 = dayStart(day)
  let a = normalizeTodo({ title: 'a', date: day, file: 'src/ui/x.jsx', jira: { key: 'ABC-1', url: 'https://h/browse/ABC-1' } }, t0)
  a = applyPatch(a, { status: 'code-review' }, t0 + H)
  let b = normalizeTodo({ title: 'b', date: day, file: 'src/ui/y.jsx', jira: { key: 'ABC-1' } }, t0)
  b = applyPatch(b, { done: true }, t0 + H)
  const c = normalizeTodo({ title: 'c', date: day, file: 'server/z.mjs' }, t0)
  const i = insights([a, b, c], { period: 'day', date: day, now: t0 + 3 * H })
  assert.equal(i.counts.linkedToJira, 2)
  assert.equal(i.byJira.length, 1)
  assert.deepEqual({ key: i.byJira[0].key, total: i.byJira[0].total, done: i.byJira[0].done }, { key: 'ABC-1', total: 2, done: 1 })
  assert.equal(i.byJira[0].url, 'https://h/browse/ABC-1')
  assert.ok(i.byJira[0].msByStage['code-review'] > 0)
  assert.deepEqual(i.byDir.map(x => x.dir).sort(), ['server', 'src/ui'])
  assert.equal(i.byDir.find(x => x.dir === 'src/ui').total, 2)
})

test('a jira link can be set and cleared through applyPatch', () => {
  let t = normalizeTodo({ title: 'a' }, 1)
  assert.equal(t.jira, null)
  t = applyPatch(t, { jira: { key: 'ABC-12', url: 'https://h/browse/ABC-12', host: 'h' } }, 2)
  assert.deepEqual({ key: t.jira.key, url: t.jira.url, linkedAt: t.jira.linkedAt }, { key: 'ABC-12', url: 'https://h/browse/ABC-12', linkedAt: 2 })
  t = applyPatch(t, { jira: null }, 3)
  assert.equal(t.jira, null)
})

test('aging counts work pulled forward BY HAND, not only automatic roll-overs', () => {
  const day = '2025-07-28', t0 = dayStart(day)
  // filed for the 25th, dragged onto the 28th with the manual "pull" action — rollovers stays 0
  const pulled = applyPatch(normalizeTodo({ title: 'quietly re-dated', date: '2025-07-25' }, dayStart('2025-07-25')), { date: day }, t0)
  assert.equal(pulled.rollovers, 0)
  const i = insights([pulled], { period: 'week', date: day, now: t0 + H })
  assert.deepEqual(i.aging.map(a => [a.title, a.days, a.rollovers]), [['quietly re-dated', 3, 0]])
})

test('a todo sitting on the day it was filed for is not "carried"', () => {
  const day = '2025-07-28', t0 = dayStart(day)
  const i = insights([normalizeTodo({ title: 'filed today', date: day }, t0)], { period: 'day', date: day, now: t0 + H })
  assert.deepEqual(i.aging, [])
})
