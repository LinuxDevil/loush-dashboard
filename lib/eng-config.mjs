
import fs from 'node:fs'

const H = 3600e3
const DAY = 864e5

export const DEFAULT_WORK = {
  tzOffsetHours: 0,
  startHour: 9,
  endHour: 17,
  weekend: [0, 6],
  weekStartDay: 1,
}

export const DEFAULT_SP_DAYS = [[1, 0.4], [2, 0.8], [3, 1.5], [5, 3], [8, 6], [13, 10], [21, 22]]

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d)

export function normalizeWork(raw = {}) {
  const w = {
    tzOffsetHours: num(raw.tzOffsetHours, DEFAULT_WORK.tzOffsetHours),
    startHour: num(raw.startHour, DEFAULT_WORK.startHour),
    endHour: num(raw.endHour, DEFAULT_WORK.endHour),
    weekend: Array.isArray(raw.weekend) ? raw.weekend.filter(d => Number.isInteger(d) && d >= 0 && d <= 6) : DEFAULT_WORK.weekend,
    weekStartDay: num(raw.weekStartDay, DEFAULT_WORK.weekStartDay),
  }
  if (!(w.endHour > w.startHour)) { w.startHour = DEFAULT_WORK.startHour; w.endHour = DEFAULT_WORK.endHour }
  if (w.weekend.length >= 7) w.weekend = DEFAULT_WORK.weekend
  w.tzMs = w.tzOffsetHours * H
  w.dayMs = (w.endHour - w.startHour) * H
  w.weekendSet = new Set(w.weekend)
  return w
}

export const dowOf = (work, t) => ((((Math.floor((t + work.tzMs) / DAY) % 7) + 4) % 7) + 7) % 7
const dowOfDay = d => ((((d % 7) + 4) % 7) + 7) % 7

export function workMsWith(work, from, to) {
  if (!(to > from)) return 0
  const L0 = from + work.tzMs, L1 = to + work.tzMs
  const d0 = Math.floor(L0 / DAY), d1 = Math.floor(L1 / DAY)
  let ms = 0
  for (let d = d0; d <= d1; d++) {
    if (work.weekendSet.has(dowOfDay(d))) continue
    const ws = d * DAY + work.startHour * H, we = d * DAY + work.endHour * H
    ms += Math.max(0, Math.min(L1, we) - Math.max(L0, ws))
  }
  return ms
}

export const workDaysWith = (work, from, to) => workMsWith(work, from, to) / work.dayMs

export function addWorkTimeWith(work, from, budgetMs) {
  if (budgetMs <= 0) return from
  let L = from + work.tzMs, d = Math.floor(L / DAY), left = budgetMs
  for (let guard = 0; guard < 500; guard++, d++) {
    if (work.weekendSet.has(dowOfDay(d))) { L = 0; continue }
    const ws = Math.max(L || 0, d * DAY + work.startHour * H), we = d * DAY + work.endHour * H
    if (ws >= we) { L = 0; continue }
    const avail = we - ws
    if (avail >= left) return ws + left - work.tzMs
    left -= avail
    L = we
  }
  return from + budgetMs
}

export const offHoursWith = (work, t) => workMsWith(work, t, t + 60_000) === 0
export const isWeekendWith = (work, t) => work.weekendSet.has(dowOf(work, t))

export function weekKeyWith(work, t) {
  const d = Math.floor((t + work.tzMs) / DAY)
  const start = d - (((dowOfDay(d) - work.weekStartDay) % 7 + 7) % 7)
  return new Date(start * DAY).toISOString().slice(0, 10)
}

export function describeWork(work) {
  const NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const working = [0, 1, 2, 3, 4, 5, 6].filter(d => !work.weekendSet.has(d))
  const hh = n => String(n).padStart(2, '0') + ':00'
  const off = work.tzOffsetHours >= 0 ? '+' + work.tzOffsetHours : String(work.tzOffsetHours)
  const span = working.length && working[working.length - 1] - working[0] === working.length - 1
    ? `${NAMES[working[0]]}–${NAMES[working[working.length - 1]]}`
    : working.map(d => NAMES[d]).join(',')
  return `${hh(work.startHour)}–${hh(work.endHour)} ${span}, UTC${off}`
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
export function normalizeToolFlag(raw) {
  if (raw === true) return { enabled: true, emails: [] }
  if (!raw || typeof raw !== 'object') return { enabled: false, emails: [] }
  return {
    enabled: raw.enabled === true,
    emails: Array.isArray(raw.emails) ? raw.emails.filter(Boolean).map(e => String(e).trim().toLowerCase()) : [],
  }
}

/**
 * Normalize the `designSystem` config block to `{ package, storybook }` with blanks as null.
 * A bare string is taken as a package name, since that is what people type first.
 */
export function normalizeDesignSystem(raw) {
  const str = v => (typeof v === 'string' && v.trim() ? v.trim() : null)
  if (typeof raw === 'string') return str(raw) ? { package: str(raw), storybook: null } : null
  if (!raw || typeof raw !== 'object') return null
  const pkg = str(raw.package), sb = str(raw.storybook)
  return pkg || sb ? { package: pkg, storybook: sb } : null
}

export function toolFlagAllows(flag, email) {
  const f = normalizeToolFlag(flag)
  if (!f.enabled) return false
  if (!f.emails.length) return true
  return !!email && f.emails.includes(String(email).trim().toLowerCase())
}

/**
 * Read the config file. Shapes accepted, oldest to newest:
 *   [ …projects ]                                    (legacy bare array)
 *   { projects: [...], effortBuckets: {...} }        (previous)
 *   { jiraHost, work: {...}, storyPointDays, defaultDevEmails, projects: [...] }
 * Missing file → defaults with an empty project list. That is the correct cold start: the dashboard
 * reports "not configured" rather than inventing someone else's board.
 */
export function parseEngConfig(raw) {
  const j = Array.isArray(raw) ? { projects: raw } : (raw && typeof raw === 'object' ? raw : {})
  return {
    jiraHost: typeof j.jiraHost === 'string' && j.jiraHost ? j.jiraHost : null,
    work: normalizeWork(j.work),
    storyPointDays: Array.isArray(j.storyPointDays) && j.storyPointDays.length ? j.storyPointDays : DEFAULT_SP_DAYS,
    defaultDevEmails: Array.isArray(j.defaultDevEmails) ? j.defaultDevEmails.map(e => String(e).toLowerCase()) : [],
    projects: Array.isArray(j.projects) ? j.projects : [],
    effortBuckets: j.effortBuckets || null,
    designSystem: normalizeDesignSystem(j.designSystem),
    companyTools: normalizeToolFlag(
      j.Company_Tools ?? j.companyTools ?? j.company_tools ??
      j.Almosafer_Tools ?? j.almosaferTools ?? j.almosafer_tools),
    engineering: normalizeToolFlag(
      j.Engineering ?? j.engineering ?? j.ENGINEERING ?? j.Engineering_Metrics ?? j.engineeringMetrics),
    _raw: j,
  }
}

let cache = null, cacheMtime = -1, cachePath = null
export function loadEngConfig(file) {
  let m = -1
  try { m = fs.statSync(file).mtimeMs } catch {}
  if (cache && m === cacheMtime && file === cachePath) return cache
  let raw = null
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')) } catch {}
  cache = parseEngConfig(raw)
  cacheMtime = m
  cachePath = file
  return cache
}
export function invalidateEngConfig() { cache = null; cacheMtime = -1 }
