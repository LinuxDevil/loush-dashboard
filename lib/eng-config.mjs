// eng-config.mjs — the Engineering dashboard's user-editable configuration.
//
// WHY THIS EXISTS
// server-eng.mjs used to hardcode one company's production setup as its DEFAULTS: real employee email
// addresses, private repo names, a JIRA host, and a Sun–Thu 10:00–18:00 Asia/Riyadh work week. Two
// separate problems came out of that:
//   1. PII in version control. Ten colleagues' addresses were committed and pushed.
//   2. Silently wrong numbers for everyone else. The work-week constants feed EVERY duration in the
//      dashboard — cycle time, lead time, stage budgets, off-hours, weekend work. A US engineer on
//      Mon–Fri 9–5 had their whole Friday counted as weekend work and most of their day as off-hours,
//      with no setting anywhere to correct it.
//
// Everything that describes YOUR org now lives in `projects.json` (gitignored). `projects.example.json`
// is the committed template. Nothing in this file names a person, a company or a host.
//
// The work-time functions are pure and take the config explicitly so they can be tested against several
// work weeks — see test/eng-config.test.js.

import fs from 'node:fs'

const H = 3600e3
const DAY = 864e5

// A neutral default: Mon–Fri 09:00–17:00 UTC. It is a placeholder, not a recommendation — the whole
// point of this file is that you set it. `provenance` in the API payload reports what was actually used.
export const DEFAULT_WORK = {
  tzOffsetHours: 0,
  startHour: 9,
  endHour: 17,
  weekend: [0, 6],   // 0=Sun … 6=Sat — Saturday + Sunday
  weekStartDay: 1,   // weeks are keyed from Monday
}

// Story points → estimated working days. Org-specific by nature: a "5" means different things at
// different companies, so shipping one company's table as a universal default is how you score people
// against a conversion nobody on their team agreed to.
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
  // A zero-or-negative working day would make workDays() divide by zero and emit Infinity across the
  // whole dashboard. Fall back rather than propagate a poisoned constant.
  if (!(w.endHour > w.startHour)) { w.startHour = DEFAULT_WORK.startHour; w.endHour = DEFAULT_WORK.endHour }
  if (w.weekend.length >= 7) w.weekend = DEFAULT_WORK.weekend // an all-weekend week means no time ever passes
  w.tzMs = w.tzOffsetHours * H
  w.dayMs = (w.endHour - w.startHour) * H
  w.weekendSet = new Set(w.weekend)
  return w
}

// Unix day 0 (1970-01-01) is a Thursday, so ((d % 7) + 4) % 7 maps to 0=Sun … 6=Sat.
// The +7 guard matters for pre-epoch / negative-offset arithmetic, where d % 7 can be negative.
export const dowOf = (work, t) => ((((Math.floor((t + work.tzMs) / DAY) % 7) + 4) % 7) + 7) % 7
const dowOfDay = d => ((((d % 7) + 4) % 7) + 7) % 7

/** Working milliseconds between two instants, honouring the configured hours and weekend. */
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

/** The wall-clock instant `budgetMs` of working time after `from`. */
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
  return from + budgetMs // fallback: a budget larger than 500 working days
}

export const offHoursWith = (work, t) => workMsWith(work, t, t + 60_000) === 0
export const isWeekendWith = (work, t) => work.weekendSet.has(dowOf(work, t))

/** Week bucket key, starting on the configured day. */
export function weekKeyWith(work, t) {
  const d = Math.floor((t + work.tzMs) / DAY)
  const start = d - (((dowOfDay(d) - work.weekStartDay) % 7 + 7) % 7)
  return new Date(start * DAY).toISOString().slice(0, 10)
}

/** Human-readable description of the work week actually in force — reported in `provenance`. */
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
// Org-specific tool bundles
// ---------------------------------------------------------------------------
//
// Some features only make sense inside one organisation: the Constitution reader needs a
// `.wakeel/constitution/` knowledge base, and Figma Capture ships against a specific design-system
// catalog. Shipping those to everyone is what made this app feel like someone else's tool — but
// deleting them was wrong too, because for the org that HAS that layout they are load-bearing.
//
// So they live behind a named flag. The config key is `Company_Tools`; accepted forms:
//   "Company_Tools": true
//   "Company_Tools": { "enabled": true }
//   "Company_Tools": { "enabled": true, "emails": ["you@example.com"] }   // also require an identity match
//
// With `emails` set, the flag only opens for those identities — the configured JIRA email, or
// JIRA_EMAIL from the environment. Empty/absent `emails` means "enabled for whoever is running it".
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

/** Is a tool bundle open for this identity? Null/blank identity passes only an empty allowlist. */
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
    // Where the Figma Capture component picker gets its catalog. Two sources, either shape:
    //   "designSystem": { "package": "@your-org/design-system" }   // resolved from node_modules, or a path
    //   "designSystem": { "storybook": "https://your.github.io/ds/" }
    // Null means no catalog — the picker falls back to free text, which still works.
    designSystem: normalizeDesignSystem(j.designSystem),
    // `Company_Tools` is the canonical key. The camelCase spellings are accepted too, because a
    // config file is hand-edited and a silently-ignored key is indistinguishable from a broken feature.
    // The `Almosafer_*` spellings are the pre-rename name, still read so existing configs keep working.
    companyTools: normalizeToolFlag(
      j.Company_Tools ?? j.companyTools ?? j.company_tools ??
      j.Almosafer_Tools ?? j.almosaferTools ?? j.almosafer_tools),
    // Engineering metrics — escape rate, area hotspots and ownership concentration. Same flag
    // shape as Company_Tools (true, {enabled}, or {enabled, emails}), and off by default for
    // the same reason: every number in it comes from the JIRA/GitHub snapshot, so with no
    // credentials configured the section would show an empty frame rather than anything useful.
    // Spelling variants are accepted because this file is hand-edited and a silently-ignored
    // key is indistinguishable from a broken feature.
    engineering: normalizeToolFlag(
      j.Engineering ?? j.engineering ?? j.ENGINEERING ?? j.Engineering_Metrics ?? j.engineeringMetrics),
    _raw: j,
  }
}

// mtime-keyed memo: the work-time helpers are called in tight loops, so re-reading and re-parsing the
// file per call would be the single hottest thing in the snapshot path.
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
