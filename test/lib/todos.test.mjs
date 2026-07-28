// test/lib/todos.test.mjs — the TODO model. Everything here is pure: no fs, no express, no React.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  STATUS_IDS, TERMINAL_STATUS, stepStatus, statusIndex,
  dayKey, isDayKey, dayStart, dayEnd, shiftDay, humanDay, dottedDay,
  normalizeRel, dirOfRel, normalizeTodo, applyPatch, progressOf,
  partitionByDate, dayStats, groupByPath, suggestFromActivity,
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
