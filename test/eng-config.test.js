// Tests for eng-config.mjs — the work-week engine that every duration in the Engineering dashboard
// is measured against. It was previously hardcoded to Sun–Thu 10:00–18:00 Asia/Riyadh, so these pin
// the two things that were impossible before: a different work week, and a negative UTC offset.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeWork, parseEngConfig, workMsWith, workDaysWith, addWorkTimeWith,
  offHoursWith, isWeekendWith, weekKeyWith, describeWork, dowOf,
  DEFAULT_WORK, DEFAULT_SP_DAYS,
} from '../lib/eng-config.mjs'

const H = 3600e3
const KSA = normalizeWork({ tzOffsetHours: 3, startHour: 10, endHour: 18, weekend: [5, 6], weekStartDay: 0 })
const US = normalizeWork({ tzOffsetHours: -8, startHour: 9, endHour: 17, weekend: [0, 6], weekStartDay: 1 })
const UTC = normalizeWork({})

// 2026-03-02 is a Monday. 2026-03-06 Friday, 2026-03-07 Saturday, 2026-03-08 Sunday.
const at = (iso) => Date.parse(iso)

test('normalizeWork fills defaults and derives dayMs', () => {
  assert.equal(UTC.startHour, DEFAULT_WORK.startHour)
  assert.equal(UTC.dayMs, 8 * H)
  assert.equal(KSA.dayMs, 8 * H)
  assert.equal(KSA.tzMs, 3 * H)
  assert.equal(US.tzMs, -8 * H)
})

test('normalizeWork refuses a zero-length working day rather than propagating Infinity', () => {
  // workDays() divides by dayMs. A 0 would make every duration in the app Infinity.
  const w = normalizeWork({ startHour: 14, endHour: 14 })
  assert.ok(w.dayMs > 0)
  assert.equal(w.startHour, DEFAULT_WORK.startHour)
})

test('normalizeWork refuses an all-weekend week', () => {
  const w = normalizeWork({ weekend: [0, 1, 2, 3, 4, 5, 6] })
  assert.deepEqual(w.weekend, DEFAULT_WORK.weekend, 'a week with no working days means time never passes')
})

test('dowOf maps 0=Sunday .. 6=Saturday', () => {
  assert.equal(dowOf(UTC, at('2026-03-08T12:00:00Z')), 0, 'Sunday')
  assert.equal(dowOf(UTC, at('2026-03-02T12:00:00Z')), 1, 'Monday')
  assert.equal(dowOf(UTC, at('2026-03-07T12:00:00Z')), 6, 'Saturday')
})

test('workMsWith counts only configured hours within one day', () => {
  // Mon 09:00 -> 17:00 UTC is the whole working day.
  assert.equal(workMsWith(UTC, at('2026-03-02T09:00:00Z'), at('2026-03-02T17:00:00Z')), 8 * H)
  // 08:00 -> 10:00 spans one hour before opening: only 09:00-10:00 counts.
  assert.equal(workMsWith(UTC, at('2026-03-02T08:00:00Z'), at('2026-03-02T10:00:00Z')), 1 * H)
  // Entirely outside hours.
  assert.equal(workMsWith(UTC, at('2026-03-02T20:00:00Z'), at('2026-03-02T23:00:00Z')), 0)
})

test('workMsWith skips the configured weekend — and the two work weeks disagree, as they should', () => {
  // UTC is Mon–Fri 09–17 at offset 0; KSA is Sun–Thu 10–18 at +3. Both are mid-workday at these
  // instants, so the only thing that differs is which days count as the weekend.
  const friAM = at('2026-03-06T12:00:00Z'), friPM = at('2026-03-06T16:00:00Z')
  assert.equal(workMsWith(UTC, friAM, friPM) > 0, true, 'Friday is a working day in a Mon–Fri week')
  assert.equal(workMsWith(KSA, friAM, friPM), 0, 'Friday is the weekend in a Sun–Thu week')

  // Sunday is the mirror image.
  const sunAM = at('2026-03-08T12:00:00Z'), sunPM = at('2026-03-08T16:00:00Z')
  assert.equal(workMsWith(UTC, sunAM, sunPM), 0, 'Sunday is the weekend in a Mon–Fri week')
  assert.equal(workMsWith(KSA, sunAM, sunPM) > 0, true, 'Sunday is a working day in a Sun–Thu week')
})

test('workMsWith is correct across a negative UTC offset', () => {
  // US-Pacific 09:00 local on Monday = 17:00 UTC Monday.
  const start = at('2026-03-02T17:00:00Z')
  const end = at('2026-03-03T01:00:00Z') // 17:00 local Monday
  assert.equal(workMsWith(US, start, end), 8 * H, 'a full local working day that crosses UTC midnight')
})

test('workMsWith returns 0 for a reversed or zero-length interval', () => {
  assert.equal(workMsWith(UTC, at('2026-03-02T12:00:00Z'), at('2026-03-02T10:00:00Z')), 0)
  assert.equal(workMsWith(UTC, at('2026-03-02T12:00:00Z'), at('2026-03-02T12:00:00Z')), 0)
})

test('workDaysWith divides by the configured day length, not a fixed 8h', () => {
  const short = normalizeWork({ startHour: 9, endHour: 13 }) // 4h day
  assert.equal(workDaysWith(short, at('2026-03-02T09:00:00Z'), at('2026-03-02T13:00:00Z')), 1)
  assert.equal(workDaysWith(UTC, at('2026-03-02T09:00:00Z'), at('2026-03-02T13:00:00Z')), 0.5)
})

test('addWorkTimeWith is the inverse of workMsWith', () => {
  const from = at('2026-03-02T10:00:00Z')
  for (const budget of [1 * H, 6 * H, 8 * H, 20 * H, 60 * H]) {
    const to = addWorkTimeWith(UTC, from, budget)
    assert.equal(workMsWith(UTC, from, to), budget, `round-trip failed for ${budget / H}h`)
  }
})

test('addWorkTimeWith skips the weekend when the budget spans it', () => {
  // Friday 15:00 UTC + 4 working hours, Mon–Fri 09-17 → 2h Friday, 2h Monday.
  const to = addWorkTimeWith(UTC, at('2026-03-06T15:00:00Z'), 4 * H)
  assert.equal(new Date(to).toISOString(), '2026-03-09T11:00:00.000Z', 'lands Monday morning, not Saturday')
})

test('addWorkTimeWith returns the start instant for a non-positive budget', () => {
  const from = at('2026-03-02T10:00:00Z')
  assert.equal(addWorkTimeWith(UTC, from, 0), from)
  assert.equal(addWorkTimeWith(UTC, from, -5), from)
})

test('offHoursWith and isWeekendWith follow the configured week', () => {
  assert.equal(offHoursWith(UTC, at('2026-03-02T03:00:00Z')), true, '03:00 is outside 09-17')
  assert.equal(offHoursWith(UTC, at('2026-03-02T12:00:00Z')), false)
  assert.equal(isWeekendWith(US, at('2026-03-06T18:00:00Z')), false, 'Friday is not weekend for Mon–Fri')
  assert.equal(isWeekendWith(KSA, at('2026-03-06T12:00:00Z')), true, 'Friday IS weekend for Sun–Thu')
})

test('weekKeyWith buckets from the configured first day', () => {
  const wed = at('2026-03-04T12:00:00Z')
  assert.equal(weekKeyWith(US, wed), '2026-03-02', 'Monday-start week')
  assert.equal(weekKeyWith(KSA, wed), '2026-03-01', 'Sunday-start week')
})

test('weekKeyWith is stable across every day of one week', () => {
  const keys = new Set()
  for (let i = 0; i < 5; i++) keys.add(weekKeyWith(US, at('2026-03-02T12:00:00Z') + i * 864e5))
  assert.equal(keys.size, 1, 'Mon–Fri all land in the same bucket')
})

test('describeWork reports the week actually in force', () => {
  assert.equal(describeWork(KSA), '10:00–18:00 Sun–Thu, UTC+3')
  assert.equal(describeWork(US), '09:00–17:00 Mon–Fri, UTC-8')
})

// ---------------------------------------------------------------- parseEngConfig

test('parseEngConfig accepts a legacy bare array of projects', () => {
  const c = parseEngConfig([{ key: 'ABC' }])
  assert.equal(c.projects.length, 1)
  assert.equal(c.projects[0].key, 'ABC')
})

test('parseEngConfig accepts the current object shape', () => {
  const c = parseEngConfig({ jiraHost: 'x.atlassian.net', projects: [{ key: 'ABC' }], work: { startHour: 8, endHour: 16 } })
  assert.equal(c.jiraHost, 'x.atlassian.net')
  assert.equal(c.work.startHour, 8)
})

test('parseEngConfig on a missing/garbage file yields an EMPTY project list, not someone else defaults', () => {
  for (const input of [null, undefined, 'nonsense', 42]) {
    const c = parseEngConfig(input)
    assert.deepEqual(c.projects, [], 'an unconfigured install must have zero projects')
    assert.equal(c.jiraHost, null, 'and no JIRA host — the dashboard reports "not configured"')
    assert.deepEqual(c.defaultDevEmails, [], 'and no roster to misattribute work to')
  }
})

test('parseEngConfig falls back to the reference SP table only when none is supplied', () => {
  assert.deepEqual(parseEngConfig({}).storyPointDays, DEFAULT_SP_DAYS)
  assert.deepEqual(parseEngConfig({ storyPointDays: [[1, 1]] }).storyPointDays, [[1, 1]])
})

test('parseEngConfig lowercases the default dev roster so email matching is case-insensitive', () => {
  assert.deepEqual(parseEngConfig({ defaultDevEmails: ['Dev@Example.COM'] }).defaultDevEmails, ['dev@example.com'])
})
