// ─────────────────────────────────────────────────────────────────────────────
// TWO DATA PLANES — structural, enforced here, not by policy. Read before editing.
//
//   PLANE A (this file) = WORK ARTIFACTS: JIRA issues, GitHub PRs/reviews, CI runs, bugs.
//     Already team-visible — every engineer can open every underlying artifact about
//     themselves. Per-person OPERATIONAL facts are therefore allowed (who owns a ticket,
//     whose review a PR waits on, what is stuck). Per-person EVALUATIVE scores are NOT:
//     no composite score, no ranking, no "delivery skills" radar, no bugs-caused counter.
//
//   PLANE B (server.mjs / server-cursor.mjs) = HARNESS TELEMETRY: transcripts, tokens,
//     cost, session times, active hours. One machine's private data, self-only, forever.
//
//   HARD RULES for /api/eng/*:
//     · Never emit a per-person token count, cost, session time, active-hours or any
//       transcript-derived field. Guarded by test/eng-privacy.test.js.
//     · No endpoint accepts a user/machine parameter for telemetry.
//     · Sustainable-pace / load data is TEAM-AGGREGATE ONLY: min-N=5 suppression is applied
//       IN THE ENDPOINT (cells return null below that), weekly buckets, no per-person rows,
//       no drilldown. Sourced from PR createdAt/mergedAt — never transcripts.
//     · Every write action (JIRA transition, gh pr comment) is gated on a projects.json
//       `"writes": true` flag and uses the operator's own credentials. The default action
//       everywhere is copy-to-clipboard. Never an auto-ping.
// ─────────────────────────────────────────────────────────────────────────────
// Engineering Metrics dashboard — fully separate read-only routes under /api/eng/*.
// Multi-project: each project = a JIRA board (project key) + a GitHub repo. Defaults ship two
//   (AIR, TRN); more can be added at runtime via POST /api/eng/projects -> projects.json (gitignored).
// JIRA: REST v3 Basic auth (email + API token) from .eng.local.json / config.json / env, or reuse
//   acli's OAuth token from the keychain. GitHub: shells out to the already-authed `gh` CLI.
// Time model (§time): durations are WORKING time — 10:00–18:00, Sun–Thu, Asia/Riyadh (UTC+3, no DST).
//   Estimates derive from story points via the org SP->days table (no dev-day custom field needed).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DAY = 864e5
const H = 3600e3
const KSA = 3 * H            // Asia/Riyadh offset, no DST
const WORKDAY_MS = 8 * H     // 10:00–18:00 = 8h

// ---------- projects (§0) — defaults + runtime-added, one JIRA board + repo each ----------
const DEV_EMAILS = ['ali.mohammad@almosafer.com', 'ammar.mohammad@almosafer.com', 'yaser.kasem@almosafer.com', 'tony.jacob@almosafer.com']
const DEFAULT_PROJECTS = [
  { key: 'AIR', name: 'Flight Web', githubRepo: 'tajawal/ct-web-flights',
    qaEmails: ['karim.said@almosafer.com', 'muhammad.abdullah@almosafer.com'],
    productEmails: ['sumayah.abdalla@almosafer.com', 'nadeen.ahmed@almosafer.com'] },
  { key: 'TRN', name: 'Transport Web', githubRepo: 'tajawal/ct-web-transport', devEmails: [...DEV_EMAILS, 'samvel.tadevosyan@almosafer.com'],
    qaEmails: ['renuka.gopalakrishnan@almosafer.com', 'mohammad.awad@almosafer.com'],
    productEmails: ['nadeen.ahmed@almosafer.com'] },
]
const PROJECTS_FILE = path.join(HERE, 'projects.json')
function normalizeProject(p) {
  const key = (p.key || p.jiraProjectKey || '').toUpperCase()
  const pk = (p.jiraProjectKey || key).toUpperCase()
  return {
    key, name: p.name || key,
    jiraHost: p.jiraHost || 'data4altayyargroup.atlassian.net',
    jiraProjectKey: pk, githubRepo: p.githubRepo || '',
    ticketRegex: new RegExp(`${pk}-\\d+`, 'i'),
    jql: p.jql || `project = ${pk} AND (updated >= -180d OR statusCategory != Done) ORDER BY updated DESC`,
    spField: p.spField || null,
    devEmails: (p.devEmails && p.devEmails.length ? p.devEmails : DEV_EMAILS).map(e => e.toLowerCase()),
    qaEmails: (p.qaEmails || []).map(e => e.toLowerCase()),
    productEmails: (p.productEmails || []).map(e => e.toLowerCase()),
    writes: p.writes === true, // §writes: JIRA transitions / gh pr comment stay behind this. Default: copy-to-clipboard.
  }
}
// projects.json is either a bare array (legacy) or {projects:[…], effortBuckets:{…}} (§7).
function projectsFile() { try { return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8')) } catch { return null } }
function extraProjects() { const j = projectsFile(); return Array.isArray(j) ? j : (j?.projects || []) }
function loadProjects() {
  const map = new Map()
  for (const p of DEFAULT_PROJECTS) map.set(p.key.toUpperCase(), p)
  for (const p of extraProjects()) { const k = (p.key || p.jiraProjectKey || '').toUpperCase(); if (!k) continue; map.set(k, { ...(map.get(k) || {}), ...p, key: k }) } // extras override/extend defaults
  return [...map.values()].map(normalizeProject)
}
function upsertProject(rec) {
  const j = projectsFile()
  const extra = extraProjects()
  const k = (rec.key || '').toUpperCase()
  const idx = extra.findIndex(p => (p.key || p.jiraProjectKey || '').toUpperCase() === k)
  if (idx >= 0) extra[idx] = { ...extra[idx], ...rec, key: k }
  else extra.push({ ...rec, key: k })
  const out = Array.isArray(j) || !j ? extra : { ...j, projects: extra } // keep the effortBuckets block intact
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(out, null, 2))
}
// members editor from the UI: [{email, role}] -> role email lists (only when members supplied)
function rostersFrom(members) {
  if (!Array.isArray(members)) return {}
  const g = r => members.filter(m => m.role === r && m.email).map(m => m.email.trim().toLowerCase())
  return { devEmails: g('dev'), qaEmails: g('qa'), productEmails: g('product') }
}
const projectPill = p => ({ key: p.key, name: p.name, jiraProjectKey: p.jiraProjectKey, githubRepo: p.githubRepo, jiraHost: p.jiraHost, dev: p.devEmails, qa: p.qaEmails, product: p.productEmails })
const projectList = () => loadProjects().map(projectPill)

// ---------- working-time engine (§time) ----------
// Only 10:00–18:00 Sun–Thu counts. Unix day 0 (1970-01-01) is Thursday, so (d+4)%7 gives 0=Sun..6=Sat.
function workMs(from, to) {
  if (!(to > from)) return 0
  const L0 = from + KSA, L1 = to + KSA
  const d0 = Math.floor(L0 / DAY), d1 = Math.floor(L1 / DAY)
  let ms = 0
  for (let d = d0; d <= d1; d++) {
    const dow = ((d % 7) + 4) % 7
    if (dow === 5 || dow === 6) continue // Fri/Sat weekend
    const ws = d * DAY + 10 * H, we = d * DAY + 18 * H
    ms += Math.max(0, Math.min(L1, we) - Math.max(L0, ws))
  }
  return ms
}
const workDays = (from, to) => workMs(from, to) / WORKDAY_MS
// wall-clock instant `budgetMs` of working-time after `from`
function addWorkTime(from, budgetMs) {
  if (budgetMs <= 0) return from
  let L = from + KSA, d = Math.floor(L / DAY), left = budgetMs
  for (let guard = 0; guard < 500; guard++, d++) {
    const dow = ((d % 7) + 4) % 7
    if (dow === 5 || dow === 6) { L = 0; continue }
    const ws = Math.max(L || 0, d * DAY + 10 * H), we = d * DAY + 18 * H
    if (ws >= we) { L = 0; continue }
    const avail = we - ws
    if (avail >= left) return ws + left - KSA
    left -= avail; L = we
  }
  return from + budgetMs // fallback
}
// true when an instant falls outside 10:00–18:00 Sun–Thu (a PR opened then is "off hours")
const offHours = t => workMs(t, t + 60_000) === 0
const isWeekend = t => { const dow = ((Math.floor((t + KSA) / DAY) % 7) + 4) % 7; return dow === 5 || dow === 6 }

// ---------- percentiles (§2 — the client does its own too; these are the ones the server needs) ----------
function pctl(arr, p) {
  const a = arr.filter(v => v != null && !Number.isNaN(v)).sort((x, y) => x - y)
  if (!a.length) return null
  const i = (a.length - 1) * p
  const lo = Math.floor(i), hi = Math.ceil(i)
  return +(a[lo] + (a[hi] - a[lo]) * (i - lo)).toFixed(2)
}
const median = a => pctl(a, 0.5)
const round1 = v => (v == null ? null : +v.toFixed(1))
const monthKey = t => new Date(t).toISOString().slice(0, 7)
// ISO-ish week key (Sunday-start, matching the KSA work week)
function weekKey(t) { const d = Math.floor((t + KSA) / DAY); const sun = d - (((d % 7) + 4) % 7); return new Date(sun * DAY).toISOString().slice(0, 10) }

// ---------- story points -> estimated working-days (org reference table) ----------
const SP_DAYS = [[1, 0.4], [2, 0.8], [3, 1.5], [5, 3], [8, 6], [13, 10], [21, 22]] // 21 ≈ a month of working days
function estDaysFromPts(pts) {
  if (!pts || pts <= 0) return 0
  for (const [p, d] of SP_DAYS) if (pts === p) return d
  if (pts < SP_DAYS[0][0]) return SP_DAYS[0][1] * pts / SP_DAYS[0][0]
  for (let i = 0; i < SP_DAYS.length - 1; i++) {
    const [p0, d0] = SP_DAYS[i], [p1, d1] = SP_DAYS[i + 1]
    if (pts > p0 && pts < p1) return d0 + (d1 - d0) * (pts - p0) / (p1 - p0)
  }
  const [pl, dl] = SP_DAYS[SP_DAYS.length - 1]; return dl * pts / pl
}
// reference accuracy: early/on-time -> ratio×50+50 (50–100%), late -> (est/actual)×100 (0–100%)
function estAccuracy(est, actual) {
  if (!(est > 0) || !(actual > 0)) return null
  return actual <= est ? (actual / est) * 50 + 50 : (est / actual) * 100
}

// ---------- status model (§2) — matched case-insensitively; statusCategory is the fallback ----------
const ACTIVE = ['in progress', 'in code review', 'design qa', 'in qa (dev)', 'in qa', 'reopen', 'reopened']
const WAITING = ['pm backlog', 'to do', 'ready for qa', 'qa blocked', 'on hold', 'paused', 'ready for release', 'backlog']
const PAUSED = ['on hold', 'paused'] // excluded from cycle/delivery — the clock stops while parked
const DONE = ['live', 'closed', "won't fix", 'done', 'resolved']
const REVIEWY = ['in code review', 'design qa', 'in qa (dev)', 'in qa', 'qa blocked', 'ready for qa']
const norm = s => (s || '').trim().toLowerCase()
function kindOf(name, category) {
  const n = norm(name)
  if (ACTIVE.includes(n)) return 'active'
  if (WAITING.includes(n)) return 'wait'
  if (DONE.includes(n)) return 'done'
  const c = norm(category)
  return c === 'done' ? 'done' : c === 'indeterminate' ? 'active' : 'wait'
}
const STATUS_COLOR = {
  'in progress': '#8ec8ff', 'in code review': '#a894f0', 'design qa': '#f2a2c4',
  'ready for qa': '#f5c451', 'in qa (dev)': '#5fd39a', 'in qa': '#5fd39a', 'qa blocked': '#f2777a',
  'ready for release': '#7c9bd6', 'live': '#5fd39a', 'to do': '#7f8ea1', 'closed': '#5fd39a', 'reopen': '#f2777a',
}
const colorFor = name => STATUS_COLOR[norm(name)] || '#7f8ea1'

// ---------- JIRA auth ----------
function creds() {
  let email = process.env.JIRA_EMAIL || '', token = process.env.JIRA_API_TOKEN || ''
  for (const file of ['.eng.local.json', 'config.json']) {
    try {
      const f = JSON.parse(fs.readFileSync(path.join(HERE, file), 'utf8'))
      email = email || f.jiraEmail || f.email || ''
      token = token || f.jiraToken || f.token || f.jiraAPIKey || ''
    } catch {}
  }
  return { email, token }
}
function acliProfile() {
  try {
    const y = fs.readFileSync(path.join(os.homedir(), '.config', 'acli', 'jira_config.yaml'), 'utf8')
    const prof = (y.match(/current_profile:\s*(\S+)/) || [])[1]
    if (!prof) return null
    return { profile: prof, cloudId: prof.split(':')[0], account: `jira:${prof}` }
  } catch { return null }
}
function readAcliBundle(account) {
  try {
    const r = spawnSync('security', ['find-generic-password', '-s', 'acli', '-a', account, '-w'], { timeout: 8000 })
    if (r.status !== 0) return null
    const b64 = r.stdout.toString().trim().replace(/^go-keyring-base64:/, '')
    return JSON.parse(zlib.gunzipSync(Buffer.from(b64, 'base64')).toString())
  } catch { return null }
}
async function jiraAuth(cfg) {
  const { email, token } = creds()
  if (email && token) return { base: `https://${cfg.jiraHost}/rest/api/3`, headers: { Authorization: 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64'), Accept: 'application/json' } }
  const prof = acliProfile()
  if (prof) {
    let b = readAcliBundle(prof.account)
    if (b && new Date(b.expiry).getTime() < Date.now() + 90_000) {
      spawnSync('acli', ['jira', 'workitem', 'search', '--jql', `project = ${cfg.jiraProjectKey}`, '--limit', '1'], { timeout: 30_000 })
      b = readAcliBundle(prof.account)
    }
    if (b?.access_token) return { base: `https://api.atlassian.com/ex/jira/${prof.cloudId}/rest/api/3`, headers: { Authorization: 'Bearer ' + b.access_token, Accept: 'application/json' } }
  }
  throw new Error('no-jira-creds')
}

async function jira(a, pathAndQuery) {
  const r = await fetch(`${a.base}${pathAndQuery}`, { headers: a.headers })
  if (!r.ok) throw new Error(`jira ${r.status}: ${(await r.text()).slice(0, 180)}`)
  return r.json()
}

const FIELDS = new Map() // per-project field ids — resolved once by real usage, not just by name
async function resolveFields(a, cfg) {
  if (FIELDS.has(cfg.key)) return FIELDS.get(cfg.key)
  const all = await jira(a, '/field')
  const byName = re => all.filter(f => re.test(f.name)).map(f => f.id)
  const spCands = [...new Set([cfg.spField, ...byName(/story point/i)].filter(Boolean))]
  const mostUsed = await pickPopulated(a, cfg, spCands)
  const F = {
    sp: spCands.sort((x, y) => (mostUsed[y] || 0) - (mostUsed[x] || 0))[0] || null,
    sprint: (all.find(f => /^sprint$/i.test(f.name)) || {}).id,
  }
  FIELDS.set(cfg.key, F)
  return F
}
async function pickPopulated(a, cfg, ids) {
  if (!ids.length) return {}
  const body = { jql: `project = ${cfg.jiraProjectKey} AND updated >= -120d ORDER BY updated DESC`, fields: ids, maxResults: 100 }
  const r = await fetch(`${a.base}/search/jql`, { method: 'POST', headers: { ...a.headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) return {}
  const j = await r.json(); const cnt = {}
  for (const is of j.issues || []) for (const id of ids) { const v = is.fields[id]; if (v != null && v !== '') cnt[id] = (cnt[id] || 0) + 1 }
  return cnt
}

async function jiraIssues(cfg) {
  const a = await jiraAuth(cfg)
  const F = await resolveFields(a, cfg)
  const fields = ['summary', 'issuetype', 'status', 'assignee', 'reporter', 'labels', 'components', 'issuelinks', 'parent', 'created', 'updated', 'resolutiondate', 'duedate', 'fixVersions', F.sp, F.sprint].filter(Boolean)
  const out = []
  let token = null
  do {
    const body = { jql: cfg.jql, fields, expand: 'changelog', maxResults: 100, ...(token ? { nextPageToken: token } : {}) }
    const r = await fetch(`${a.base}/search/jql`, { method: 'POST', headers: { ...a.headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!r.ok) throw new Error(`jira search ${r.status}: ${(await r.text()).slice(0, 180)}`)
    const j = await r.json()
    for (const is of j.issues || []) out.push(is)
    token = j.nextPageToken || null
    if (out.length > 800) break // ponytail: hard cap, widen if a team genuinely runs bigger
  } while (token)
  await mapLimit(out, 8, async is => {
    const histories = is.changelog?.histories
    if (!histories || (is.changelog.total && is.changelog.total > histories.length)) {
      try { is.changelog = (await jira(a, `/issue/${is.id}?expand=changelog&fields=none`)).changelog } catch {}
    }
  })
  return { issues: out, F }
}
async function mapLimit(arr, n, fn) {
  const it = arr[Symbol.iterator](); const work = Array.from({ length: n }, async () => { for (const x of it) await fn(x) })
  await Promise.all(work)
}

// ---------- per-issue metrics from the changelog (§3), in working time ----------
function statusSegments(issue) {
  const created = Date.parse(issue.fields.created)
  const changes = []
  const sprintEvents = [] // §8: the Sprint items sit right next to the status ones — keep them.
  for (const h of issue.changelog?.histories || [])
    for (const it of h.items || []) {
      if (it.field === 'status') changes.push({ at: Date.parse(h.created), from: it.fromString, to: it.toString, author: h.author ? { id: h.author.accountId, name: h.author.displayName } : null })
      else if (it.field === 'Sprint') sprintEvents.push({ at: Date.parse(h.created), from: it.fromString || '', to: it.toString || '', fromIds: idList(it.from), toIds: idList(it.to), author: h.author?.displayName || '' })
    }
  changes.sort((a, b) => a.at - b.at)
  sprintEvents.sort((a, b) => a.at - b.at)
  const days = {}; let firstInProg = null, liveAt = null, qaEntries = 0, reworkN = 0, reopenN = 0, inProgEntries = 0, fixer = null
  let cur = changes.length ? changes[0].from : issue.fields.status.name
  let t0 = created, curSince = created
  const add = (st, from, to) => { const k = st || 'Unknown'; days[k] = (days[k] || 0) + workMs(from, to) }
  for (const c of changes) {
    add(c.from, t0, c.at); t0 = c.at; cur = c.to; curSince = c.at
    const to = norm(c.to)
    if (to === 'in progress') { inProgEntries++; if (firstInProg == null) firstInProg = c.at; if (inProgEntries > 1) reworkN++ }
    if (to === 'reopen' || to === 'reopened') reopenN++
    if (to === 'in qa (dev)' || to === 'in qa' || to === 'ready for qa') { qaEntries++; if (c.author) fixer = c.author } // whoever moves it to QA-ready owns the fix
    if (DONE.includes(to) && liveAt == null && (to === 'live' || to === 'closed' || to === 'done')) liveAt = c.at
  }
  add(cur, t0, Date.now())
  if (firstInProg == null && norm(cur) === 'in progress') { firstInProg = created; curSince = created }
  const daysIn = {}; for (const k in days) daysIn[k] = days[k] / WORKDAY_MS
  const endT = liveAt || Date.now()
  // cycle excludes time parked in On Hold / Paused — those don't count against the team
  const pausedMs = Object.entries(days).reduce((a, [k, v]) => a + (PAUSED.includes(norm(k)) ? v : 0), 0)
  const spanMs = firstInProg != null ? workMs(firstInProg, endT) : 0
  const delivery = Math.max(0, spanMs - pausedMs) / WORKDAY_MS
  return { daysIn, delivery, firstInProg, liveAt, curStatus: cur, curSince, qaCycles: qaEntries, rework: reworkN + reopenN, fixer, sprintEvents }
}
const idList = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean)
const nameList = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean)

function num(v) { if (v == null) return 0; if (typeof v === 'number') return v; if (typeof v === 'object') return v.value ?? 0; return Number(v) || 0 }
// §8: BOTH forms carry startDate/endDate/completeDate — they were being thrown away.
function parseSprintOne(one) {
  if (!one) return null
  if (typeof one === 'object') return one.name ? { id: one.id ?? null, name: one.name, state: one.state || '', startDate: one.startDate || null, endDate: one.endDate || null, completeDate: one.completeDate || null, boardId: one.boardId ?? null } : null
  const s = String(one)
  const g = re => (s.match(re) || [])[1] || null
  const name = g(/name=([^,\]]+)/)
  const iso = v => (v && v !== '<null>' ? v : null)
  return name ? {
    id: g(/id=(\d+)/) ? +g(/id=(\d+)/) : null, name, state: g(/state=([^,\]]+)/) || '',
    startDate: iso(g(/startDate=([^,\]]+)/)), endDate: iso(g(/endDate=([^,\]]+)/)), completeDate: iso(g(/completeDate=([^,\]]+)/)),
    boardId: g(/boardId=(\d+)/) ? +g(/boardId=(\d+)/) : null,
  } : null
}
const parseSprints = raw => (raw ? (Array.isArray(raw) ? raw : [raw]) : []).map(parseSprintOne).filter(Boolean)
function parseSprint(raw) { const a = parseSprints(raw); return a.length ? a[a.length - 1] : null }

// hover recommendation: when to move to the next step to keep a good metric score
function recFor(status, pts, curSince) {
  const n = norm(status)
  let next = null, budget = 0
  if (n === 'in progress') { next = 'In Code Review'; budget = Math.max(0.5, estDaysFromPts(pts) || 1.5) }
  else if (n === 'in code review') { next = 'Ready for QA'; budget = 1 }
  else if (n === 'design qa') { next = 'In QA (Dev)'; budget = 1 }
  else if (n === 'ready for qa' || n === 'in qa (dev)' || n === 'in qa') { next = 'Ready for Release'; budget = 1 }
  else if (n === 'qa blocked') { next = 'In Progress'; budget = 0.5 }
  else return null
  const moveBy = addWorkTime(curSince, budget * WORKDAY_MS)
  const spent = workDays(curSince, Date.now())
  const remaining = +(budget - spent).toFixed(2)
  return { next, budget: +budget.toFixed(2), moveBy: new Date(moveBy).toISOString(), remaining, atRisk: remaining < 0 }
}

function computeIssue(issue, F, prsByTicket, cfg) {
  const f = issue.fields
  const seg = statusSegments(issue)
  const dev = seg.daysIn['In Progress'] || Object.entries(seg.daysIn).find(([k]) => norm(k) === 'in progress')?.[1] || 0
  const cr = Object.entries(seg.daysIn).find(([k]) => norm(k) === 'in code review')?.[1] || 0
  const pts = num(f[F.sp])
  const est = estDaysFromPts(pts)           // working-day estimate from story points
  const actual = dev || seg.delivery
  const estAcc = estAccuracy(est, actual)
  const status = f.status.name
  const kind = kindOf(status, f.status.statusCategory?.key)
  const live = norm(status) === 'live' || (kind === 'done')
  const when = seg.liveAt || Date.parse(f.resolutiondate || f.updated || f.created)
  const d = new Date(when)
  const prs = prsByTicket[issue.key] || []
  const anyMerged = prs.some(p => p.state === 'Merged')
  const stale = REVIEWY.includes(norm(status)) && anyMerged
  const staleNote = stale ? `PR #${prs.find(p => p.state === 'Merged')?.num} merged — status out of date` : ''
  let activeDays = 0, waitDays = 0
  for (const [k, v] of Object.entries(seg.daysIn)) { const kk = kindOf(k); if (kk === 'active') activeDays += v; else if (kk === 'wait') waitDays += v }
  const isBug = /bug|defect/i.test(f.issuetype?.name || '')
  const area = f.components?.[0]?.name || null // component only — labels aren't reliable enough
  const assignee = f.assignee ? { name: f.assignee.displayName, email: f.assignee.emailAddress || '', id: f.assignee.accountId } : null
  // bug linked to a parent story (AIR happy path: the bug hangs off the ticket it belongs to)
  let linkedKey = f.parent?.key || null
  if (isBug && !linkedKey) for (const l of f.issuelinks || []) { const o = l.outwardIssue || l.inwardIssue; if (o) { linkedKey = o.key; break } }
  // issuelinks are fetched today and used only to resolve linkedKey — keep the whole graph (blocker matrix)
  const links = (f.issuelinks || []).map(l => {
    const o = l.outwardIssue || l.inwardIssue
    if (!o) return null
    return { key: o.key, dir: l.outwardIssue ? 'outward' : 'inward', type: l.type?.name || '', rel: (l.outwardIssue ? l.type?.outward : l.type?.inward) || '', status: o.fields?.status?.name || '' }
  }).filter(Boolean)
  // assignee changelog → resolve dev/QA assignee by role in resolveRoles
  const assigneeHistory = []
  for (const h of issue.changelog?.histories || []) for (const it of h.items || []) if (it.field === 'assignee' && it.to) assigneeHistory.push({ id: it.to, name: it.toString || '' })
  if (assignee) assigneeHistory.push({ id: assignee.id, name: assignee.name })
  return {
    key: issue.key, project: cfg.key, host: cfg.jiraHost, type: f.issuetype?.name || 'Task', summary: f.summary, isBug, area,
    labels: f.labels || [], duedate: f.duedate || null, fixVersions: (f.fixVersions || []).map(v => v.name), links,
    url: `https://${cfg.jiraHost}/browse/${issue.key}`,
    status, statusKind: kind, statusColor: colorFor(status), sprint: parseSprint(f[F.sprint]), sprints: parseSprints(f[F.sprint]), sprintEvents: seg.sprintEvents,
    assignee, assigneeHistory, devAssignee: null, qaAssignee: null, inCurrent: +workDays(seg.curSince, Date.now()).toFixed(2),
    reporter: f.reporter ? { name: f.reporter.displayName, email: f.reporter.emailAddress || '', id: f.reporter.accountId } : null, qaReported: false,
    // bug ownership — owner = who has the bug (default assignee), fixer = who moved it to QA-ready. Resolved/overridden in snapshot.
    owner: assignee, ownerId: assignee?.id || null, fixer: seg.fixer, fixerId: seg.fixer?.id || null, linkedKey,
    pts, est: +est.toFixed(2), dev: +dev.toFixed(2), cr: +cr.toFixed(2), delivery: +seg.delivery.toFixed(2),
    estAcc: estAcc == null ? null : +estAcc.toFixed(1), qaCycles: seg.qaCycles, rework: seg.rework,
    daysIn: Object.fromEntries(Object.entries(seg.daysIn).map(([k, v]) => [k, +v.toFixed(2)])),
    activeDays: +activeDays.toFixed(2), waitDays: +waitDays.toFixed(2),
    live, active: kind === 'active', month: d.getMonth(), year: d.getFullYear(),
    created: f.created, closedAt: f.resolutiondate || (seg.liveAt ? new Date(seg.liveAt).toISOString() : null),
    curSince: new Date(seg.curSince).toISOString(),
    firstInProg: seg.firstInProg ? new Date(seg.firstInProg).toISOString() : null, // §12: computed since day one, never exposed
    liveAt: seg.liveAt ? new Date(seg.liveAt).toISOString() : null,
    leadDays: +workDays(Date.parse(f.created), seg.liveAt || Date.now()).toFixed(2), // created → live (the queue half #11)
    rec: live ? null : recFor(status, pts, seg.curSince),
    parent: f.parent ? { key: f.parent.key, summary: f.parent.fields?.summary || '' } : null,
    prNums: prs.map(p => p.num), stale, staleNote,
  }
}

// ---------- bug ownership overrides (manual, persisted) ----------
const BUGS_FILE = path.join(HERE, 'bug-ownership.json')
function readBugOwn() { try { return JSON.parse(fs.readFileSync(BUGS_FILE, 'utf8')) } catch { return {} } }
function writeBugOwn(o) { fs.writeFileSync(BUGS_FILE, JSON.stringify(o, null, 2)) }
// classify each ticket's dev/QA assignee from the assignee changelog + role rosters (by email)
function resolveRoles(issues, cfg) {
  const emailById = {}
  for (const i of issues) { if (i.assignee?.email) emailById[i.assignee.id] = i.assignee.email.toLowerCase(); if (i.reporter?.email) emailById[i.reporter.id] = i.reporter.email.toLowerCase() }
  const dev = new Set(cfg.devEmails), qa = new Set(cfg.qaEmails), prod = new Set(cfg.productEmails)
  for (const i of issues) {
    let da = null, qaa = null
    for (const p of i.assigneeHistory || []) { const e = emailById[p.id]; if (!e) continue; if (dev.has(e)) da = p; if (qa.has(e)) qaa = p }
    i.devAssignee = da; i.qaAssignee = qaa
    // role of whoever it's assigned to now — bug register only shows bugs assigned to a team member
    const ae = (i.assignee?.email || '').toLowerCase() || emailById[i.assignee?.id] || ''
    i.assigneeTeam = dev.has(ae) ? 'dev' : qa.has(ae) ? 'qa' : prod.has(ae) ? 'product' : null
    // a bug counts only if the team's own QA reported it
    if (i.isBug) { const re = (i.reporter?.email || '').toLowerCase() || emailById[i.reporter?.id] || ''; i.qaReported = qa.has(re) }
    delete i.assigneeHistory // trim payload
  }
}
// resolve AIR linked-bug owners to the parent story's assignee, then apply manual overrides
function resolveOwnership(issues) {
  const byKey = {}; for (const i of issues) byKey[i.key] = i
  const accounts = {}
  for (const i of issues) { for (const p of [i.assignee, i.fixer, i.owner]) if (p?.id) accounts[p.id] = p.name }
  const ov = readBugOwn()
  for (const i of issues) {
    if (i.isBug && i.linkedKey && byKey[i.linkedKey]?.assignee) { i.owner = byKey[i.linkedKey].assignee; i.ownerId = i.owner.id }
    const o = ov[i.key]
    if (o) {
      if (o.ownerId) { i.owner = { id: o.ownerId, name: accounts[o.ownerId] || 'Assigned' }; i.ownerId = o.ownerId; i.ownerManual = true }
      if (o.fixerId) { i.fixer = { id: o.fixerId, name: accounts[o.fixerId] || 'Assigned' }; i.fixerId = o.fixerId; i.fixerManual = true }
    }
  }
}

// ---------- GitHub PRs via the authed gh CLI (GraphQL, paginated) ----------
const BOT = login => !login || login === 'github-actions' || /\[bot\]$/.test(login)
function gh(args, timeout = 60000) {
  const r = spawnSync('gh', args, { timeout, maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) throw new Error('gh: ' + (r.stderr || '').toString().slice(0, 200))
  return r.stdout.toString()
}
function ghAvailable() { try { return spawnSync('gh', ['auth', 'status'], { timeout: 8000 }).status === 0 } catch { return false } }

// §4/§11: three fields ADDED to the query we already run — no extra request.
//   reviewRequests   → who was ASKED and never responded (invisible today)
//   timelineItems    → REVIEW_REQUESTED_EVENT, so first-review latency starts at the REQUEST,
//                      not at PR-open (the old firstReviewDays blames the author for the reviewer's queue)
//   commits(last:1)  → statusCheckRollup, a per-PR checks state
const prQuery = (owner, name) => `query($cur:String){repository(owner:"${owner}",name:"${name}"){defaultBranchRef{name} pullRequests(first:50,after:$cur,orderBy:{field:UPDATED_AT,direction:DESC}){pageInfo{hasNextPage endCursor} nodes{number title headRefName state createdAt mergedAt closedAt additions deletions changedFiles author{login} assignees(first:5){nodes{login}} reviews(first:30){nodes{state author{login} submittedAt}} comments{totalCount} reviewThreads{totalCount} files(first:30){nodes{path additions deletions}} reviewRequests(first:10){nodes{requestedReviewer{__typename ... on User{login} ... on Team{name}}}} timelineItems(itemTypes:[REVIEW_REQUESTED_EVENT],first:20){nodes{... on ReviewRequestedEvent{createdAt requestedReviewer{__typename ... on User{login} ... on Team{name}}}}} commits(last:1){nodes{commit{statusCheckRollup{state}}}}}}}}`
const GQL = prQuery('<owner>', '<name>') // §13: shipped in the snapshot so the UI can offer "copy the gh command"
const ghCommandFor = repo => `gh api graphql -f query='${prQuery(...String(repo).split('/'))}'`
const reviewerLogin = r => r?.login || r?.name || ''

function fetchPRs(cfg) {
  const [owner, name] = cfg.githubRepo.split('/')
  if (!owner || !name) return []
  const q = prQuery(owner, name)
  const prs = []; let cur = ''
  for (let page = 0; page < 6; page++) { // ponytail: 300 most-recent PRs; bump the cap if history matters
    const args = ['api', 'graphql', '-f', `query=${q}`]
    if (cur) args.push('-F', `cur=${cur}`)
    const j = JSON.parse(gh(args))
    const conn = j.data.repository.pullRequests
    for (const p of conn.nodes) {
      const m = (p.headRefName || '').match(cfg.ticketRegex) || (p.title || '').match(cfg.ticketRegex)
      if (!m) continue
      const ticket = m[0].toUpperCase()
      const reviews = (p.reviews.nodes || []).map(r => ({ state: r.state, login: r.author?.login, at: r.submittedAt }))
      const realReviews = reviews.filter(r => !BOT(r.login) && r.at)
      const created = Date.parse(p.createdAt)
      const firstReview = realReviews.map(r => Date.parse(r.at)).sort((a, b) => a - b)[0]
      const changesReq = reviews.filter(r => r.state === 'CHANGES_REQUESTED').length
      const approved = reviews.some(r => r.state === 'APPROVED')
      let state = 'Open'
      if (p.mergedAt) state = 'Merged'
      else if (p.state === 'CLOSED') state = 'Closed'
      else if (approved) state = 'Approved'
      else if (changesReq > 0) state = 'Changes requested'
      const reviewers = [...new Set(realReviews.map(r => r.login))]
      // asked-but-never-responded + the honest clock: request → first review, per reviewer
      const requested = (p.reviewRequests?.nodes || []).map(n => reviewerLogin(n.requestedReviewer)).filter(l => l && !BOT(l))
      const reviewRequests = (p.timelineItems?.nodes || [])
        .map(n => ({ login: reviewerLogin(n.requestedReviewer), at: n.createdAt }))
        .filter(r => r.login && r.at && !BOT(r.login))
      const firstReqAt = reviewRequests.map(r => Date.parse(r.at)).sort((a, b) => a - b)[0]
      const checks = p.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state || null // SUCCESS | FAILURE | PENDING | ERROR | EXPECTED | null
      const approvedAt = reviews.filter(r => r.state === 'APPROVED' && r.at).map(r => Date.parse(r.at)).sort((a, b) => a - b)[0]
      prs.push({
        num: p.number, project: cfg.key, repo: cfg.githubRepo, ticket, title: p.title, branch: p.headRefName, state,
        url: `https://github.com/${cfg.githubRepo}/pull/${p.number}`, checks,
        author: p.author?.login || '', createdAt: p.createdAt, mergedAt: p.mergedAt, closedAt: p.closedAt,
        additions: p.additions, deletions: p.deletions, changedFiles: p.changedFiles,
        comments: (p.comments?.totalCount || 0) + (p.reviewThreads?.totalCount || 0),
        firstReviewDays: firstReview ? +workDays(created, firstReview).toFixed(2) : null,
        // the honest wait: clock starts when a reviewer was asked, not when the author pushed
        firstReviewFromRequestDays: firstReview && firstReqAt && firstReview >= firstReqAt ? +workDays(firstReqAt, firstReview).toFixed(2) : null,
        mergeDays: p.mergedAt ? +workDays(created, Date.parse(p.mergedAt)).toFixed(2) : null,
        openDays: +workDays(created, p.mergedAt ? Date.parse(p.mergedAt) : Date.now()).toFixed(1),
        approvedAt: approvedAt ? new Date(approvedAt).toISOString() : null,
        approvedUnmergedDays: !p.mergedAt && p.state !== 'CLOSED' && approvedAt ? +workDays(approvedAt, Date.now()).toFixed(2) : null,
        cycles: 1 + changesReq, changesRequested: changesReq, reviewers, assignees: (p.assignees?.nodes || []).map(a => a.login).filter(Boolean),
        files: (p.files.nodes || []).map(f => ({ path: f.path, add: f.additions, del: f.deletions })),
        reviewEvents: realReviews.map(r => ({ state: r.state, login: r.login, at: r.at })),
        requestedReviewers: [...new Set(requested)], reviewRequests,
        // requested, never answered — the set nobody can see today
        unanswered: [...new Set(requested)].filter(l => !reviewers.includes(l)),
      })
    }
    if (!conn.pageInfo.hasNextPage) break
    cur = conn.pageInfo.endCursor
  }
  return prs
}

// ---------- CI health (§11) — NEW gh calls, existing auth. Cached separately, shorter TTL. ----------
const CI_FILE_TTL = 30 * 60_000
const ciCache = new Map() // project key -> {at, data}
const ghJSON = (pathQ, timeout = 30000) => JSON.parse(gh(['api', pathQ], timeout))
function ciFor(cfg, errs) {
  const hit = ciCache.get(cfg.key)
  if (hit && Date.now() - hit.at < CI_FILE_TTL) return hit.data
  if (!cfg.githubRepo || !ghAvailable()) return null
  const data = safe(() => {
    const repo = ghJSON(`/repos/${cfg.githubRepo}`)
    const branch = repo.default_branch || 'main'
    const runs = (ghJSON(`/repos/${cfg.githubRepo}/actions/runs?branch=${branch}&per_page=50`).workflow_runs || [])
      .filter(r => r.conclusion)
      .map(r => ({
        id: r.id, name: r.name || r.workflow_id, sha: r.head_sha, actor: r.actor?.login || '', attempt: r.run_attempt || 1,
        conclusion: r.conclusion, at: r.created_at, done: r.updated_at, url: r.html_url,
        mins: +(((Date.parse(r.updated_at) - Date.parse(r.created_at)) / 60000) || 0).toFixed(1),
      }))
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    const fails = runs.filter(r => r.conclusion === 'failure')
    // time-to-green: each red→next-green transition, in WORKING hours
    const greens = []
    let redAt = null
    for (const r of runs) {
      if (r.conclusion === 'failure' && redAt == null) redAt = Date.parse(r.at)
      else if (r.conclusion === 'success' && redAt != null) { greens.push(+(workMs(redAt, Date.parse(r.at)) / H).toFixed(2)); redAt = null }
    }
    // flaky = the SAME headSha produced both a failure and a success
    const bySha = {}
    for (const r of runs) (bySha[r.sha] ||= []).push(r)
    const flakyShas = Object.entries(bySha).filter(([, rs]) => rs.some(r => r.conclusion === 'failure') && rs.some(r => r.conclusion === 'success'))
    const jobCount = {}
    for (const [sha, rs] of flakyShas.slice(0, 8)) { // ponytail: cap the per-run jobs fan-out
      for (const r of rs.filter(x => x.conclusion === 'failure')) {
        const jobs = safe(() => ghJSON(`/repos/${cfg.githubRepo}/actions/runs/${r.id}/jobs`).jobs || [], [], errs)
        for (const j of jobs.filter(j => j.conclusion === 'failure')) {
          const k = j.name
          const e = (jobCount[k] ||= { job: k, workflow: r.name, flakes: 0, shas: [], lastUrl: j.html_url })
          e.flakes++; if (!e.shas.includes(sha)) e.shas.push(sha.slice(0, 7))
        }
      }
    }
    const last = runs[runs.length - 1] || null
    return {
      project: cfg.key, repo: cfg.githubRepo, branch, runs: runs.slice(-20).reverse(),
      total: runs.length, failures: fails.length,
      failureRate: runs.length ? +(fails.length / runs.length * 100).toFixed(1) : null,
      medianTimeToGreenHours: median(greens), medianRunMins: median(runs.map(r => r.mins)),
      red: !!last && last.conclusion === 'failure',
      brokeIt: last && last.conclusion === 'failure' ? last.actor : null,
      lastRun: last,
      flaky: Object.values(jobCount).sort((a, b) => b.flakes - a.flakes).slice(0, 10),
      flakyShaCount: flakyShas.length,
    }
  }, null, errs)
  ciCache.set(cfg.key, { at: Date.now(), data })
  return data
}

// ---------- triage (§1) — one pass, typed risk records. 100% of it is already-computed signal. ----------
const TRIAGE_FILE = path.join(HERE, 'eng-triage.json')
function readTriage() { try { return JSON.parse(fs.readFileSync(TRIAGE_FILE, 'utf8')) } catch { return {} } }
function writeTriage(o) { fs.writeFileSync(TRIAGE_FILE, JSON.stringify(o, null, 2)) } // same versioned-write pattern as bug-ownership.json
const jiraLink = i => i.url || `https://${i.host}/browse/${i.key}`

function triage(issues, prs, ci = []) {
  const out = []
  const push = r => out.push({ id: `${r.kind}:${r.subjectKey}`, overBudgetBy: null, ageWorkDays: null, owner: null, ...r })
  // sev 0 — red main. One red main blocks the whole team at once.
  for (const c of ci) if (c?.red) push({
    kind: 'red-main', severity: 0, subject: `${c.repo}@${c.branch} is red`, subjectKey: c.repo, project: c.project,
    owner: c.brokeIt ? { name: c.brokeIt } : null, deepLink: c.lastRun?.url || `https://github.com/${c.repo}/actions`,
    ageWorkDays: c.lastRun ? +workDays(Date.parse(c.lastRun.at), Date.now()).toFixed(2) : null,
    detail: c.lastRun ? `${c.lastRun.name} failed` : '',
  })
  for (const i of issues) {
    if (i.live) continue
    const age = i.inCurrent
    if (i.rec?.atRisk) push({
      kind: 'over-budget', severity: 1, subject: `${i.key} ${i.summary}`, subjectKey: i.key, project: i.project, owner: i.assignee,
      ageWorkDays: age, overBudgetBy: +(-i.rec.remaining).toFixed(2), deepLink: jiraLink(i),
      detail: `${i.status} ${age}d — budget ${i.rec.budget}d, move to ${i.rec.next}`,
    })
    if (i.stale) push({
      kind: 'stale-status', severity: 1, subject: `${i.key} ${i.summary}`, subjectKey: i.key, project: i.project, owner: i.assignee,
      ageWorkDays: age, deepLink: jiraLink(i), detail: i.staleNote,
    })
    if (norm(i.status) === 'qa blocked') push({
      kind: 'qa-blocked', severity: 1, subject: `${i.key} ${i.summary}`, subjectKey: i.key, project: i.project, owner: i.assignee,
      ageWorkDays: age, deepLink: jiraLink(i), detail: `QA Blocked ${age}d`,
    })
    if (i.active && !i.prNums.length && age > 1) push({
      kind: 'no-pr', severity: 2, subject: `${i.key} ${i.summary}`, subjectKey: i.key, project: i.project, owner: i.assignee,
      ageWorkDays: age, deepLink: jiraLink(i), detail: `active ${age}d, no PR`,
    })
    if (i.qaCycles >= 3) push({
      kind: 'qa-loops', severity: 2, subject: `${i.key} ${i.summary}`, subjectKey: i.key, project: i.project, owner: i.assignee,
      ageWorkDays: age, deepLink: jiraLink(i), detail: `${i.qaCycles} QA cycles`,
    })
  }
  for (const p of prs) {
    if (p.state === 'Merged' || p.state === 'Closed') continue
    const owner = p.author ? { name: p.author, login: p.author } : null
    if (p.openDays > 2 && !p.reviewEvents.length) push({
      kind: 'pr-no-review', severity: 1, subject: `#${p.num} ${p.title}`, subjectKey: `${p.repo}#${p.num}`, project: p.project, owner,
      ageWorkDays: p.openDays, overBudgetBy: +(p.openDays - 2).toFixed(2), deepLink: p.url,
      detail: p.requestedReviewers.length ? `open ${p.openDays}d, requested ${p.requestedReviewers.join(', ')} — zero reviews` : `open ${p.openDays}d, no reviewer requested`,
      waitingOn: p.requestedReviewers,
    })
    if (p.approvedUnmergedDays != null && p.approvedUnmergedDays > 1) push({
      kind: 'pr-approved-unmerged', severity: 2, subject: `#${p.num} ${p.title}`, subjectKey: `${p.repo}#${p.num}`, project: p.project, owner,
      ageWorkDays: p.approvedUnmergedDays, overBudgetBy: +(p.approvedUnmergedDays - 1).toFixed(2), deepLink: p.url,
      detail: `approved ${p.approvedUnmergedDays}d ago, still not merged`,
    })
    if (p.changesRequested >= 2) push({
      kind: 'pr-rework', severity: 2, subject: `#${p.num} ${p.title}`, subjectKey: `${p.repo}#${p.num}`, project: p.project, owner,
      ageWorkDays: p.openDays, deepLink: p.url, detail: `${p.changesRequested} rounds of changes requested`,
    })
    if (p.checks === 'FAILURE' || p.checks === 'ERROR') push({
      kind: 'pr-red-checks', severity: 2, subject: `#${p.num} ${p.title}`, subjectKey: `${p.repo}#${p.num}`, project: p.project, owner,
      ageWorkDays: p.openDays, deepLink: p.url, detail: 'checks failing',
    })
  }
  // WIP > 2 per engineer — an operational fact about the queue, not a score about the person
  const wip = {}
  for (const i of issues) if (i.active && i.assignee) (wip[i.assignee.id] ||= { who: i.assignee, keys: [], project: i.project }).keys.push(i.key)
  for (const w of Object.values(wip)) if (w.keys.length > 2) push({
    kind: 'wip-overload', severity: 2, subject: `${w.who.name} has ${w.keys.length} tickets in flight`, subjectKey: w.who.id,
    project: w.project, owner: w.who, ageWorkDays: null, deepLink: null, detail: w.keys.join(', '), keys: w.keys,
  })
  const dis = readTriage()
  const now = Date.now()
  const live = out.filter(r => { const d = dis[r.id]; return !(d && (!d.until || Date.parse(d.until) > now)) })
  live.sort((a, b) => a.severity - b.severity || (b.ageWorkDays || 0) - (a.ageWorkDays || 0))
  return live
}

// ---------- review flow, keyed on REVIEWER (§4) — never a slowest-reviewer leaderboard ----------
function reviewFlow(prs) {
  const now = Date.now()
  const within = (at, d) => at && now - Date.parse(at) < d * DAY
  const R = {}
  const rec = login => (R[login] ||= { login, awaiting: 0, oldestWaitDays: null, given30: 0, given90: 0, received30: 0, received90: 0, lat30: [], lat90: [] })
  for (const p of prs) {
    const open = p.state !== 'Merged' && p.state !== 'Closed'
    // PRs sitting on a reviewer right now = requested and not yet reviewed by them
    if (open) for (const l of p.unanswered) {
      const r = rec(l)
      const askedAt = p.reviewRequests.filter(x => x.login === l).map(x => Date.parse(x.at)).sort((a, b) => a - b)[0] || Date.parse(p.createdAt)
      const wait = +workDays(askedAt, now).toFixed(2)
      r.awaiting++
      if (r.oldestWaitDays == null || wait > r.oldestWaitDays) r.oldestWaitDays = wait
    }
    // reviews GIVEN + request→first-review latency, per reviewer
    const seen = new Set()
    for (const e of p.reviewEvents) {
      if (seen.has(e.login)) continue
      seen.add(e.login)
      const r = rec(e.login)
      if (within(e.at, 90)) r.given90++
      if (within(e.at, 30)) r.given30++
      const askedAt = p.reviewRequests.filter(x => x.login === e.login).map(x => Date.parse(x.at)).sort((a, b) => a - b)[0] || Date.parse(p.createdAt)
      const lat = Date.parse(e.at) >= askedAt ? +workDays(askedAt, Date.parse(e.at)).toFixed(2) : null
      if (lat != null && within(e.at, 90)) r.lat90.push(lat)
      if (lat != null && within(e.at, 30)) r.lat30.push(lat)
    }
    // reviews RECEIVED, credited to the author
    if (p.author && !BOT(p.author)) {
      const a = rec(p.author)
      if (within(p.createdAt, 90)) a.received90 += p.reviewEvents.length
      if (within(p.createdAt, 30)) a.received30 += p.reviewEvents.length
    }
  }
  const reviewers = Object.values(R).map(r => ({
    login: r.login, awaiting: r.awaiting, oldestWaitDays: r.oldestWaitDays,
    given30: r.given30, given90: r.given90, received30: r.received30, received90: r.received90,
    p50_30: pctl(r.lat30, 0.5), p90_30: pctl(r.lat30, 0.9), p50_90: pctl(r.lat90, 0.5), p90_90: pctl(r.lat90, 0.9),
    n30: r.lat30.length, n90: r.lat90.length,
  })).sort((a, b) => b.awaiting - a.awaiting || b.given90 - a.given90)
  // team-level CONCENTRATION — the two seniors reviewing everything are the two people who will quit
  const totals = reviewers.map(r => r.given90).sort((a, b) => b - a)
  const sum = totals.reduce((a, b) => a + b, 0)
  const share = n => (sum ? +(totals.slice(0, n).reduce((a, b) => a + b, 0) / sum * 100).toFixed(1) : null)
  const openPrs = prs.filter(p => p.state !== 'Merged' && p.state !== 'Closed')
  return {
    reviewers,
    concentration: { total90: sum, reviewerCount: reviewers.filter(r => r.given90 > 0).length, top1Share: share(1), top2Share: share(2), flagged: (share(2) || 0) > 60 },
    noReviewerRequested: openPrs.filter(p => !p.requestedReviewers.length && !p.reviewEvents.length).map(p => ({ num: p.num, repo: p.repo, title: p.title, openDays: p.openDays, author: p.author, url: p.url })),
    unanswered: openPrs.filter(p => p.unanswered.length).map(p => ({ num: p.num, repo: p.repo, title: p.title, openDays: p.openDays, author: p.author, url: p.url, waitingOn: p.unanswered })),
    firstReview: { p50: pctl(prs.map(p => p.firstReviewFromRequestDays), 0.5), p90: pctl(prs.map(p => p.firstReviewFromRequestDays), 0.9) },
    mergeTime: { p50: pctl(prs.map(p => p.mergeDays), 0.5), p90: pctl(prs.map(p => p.mergeDays), 0.9) },
  }
}

// ---------- quality (§5) — escape rate, area hotspots, ownership concentration. No blame panel. ----------
const top2Seg = p => String(p).split('/').slice(0, 2).join('/')
function quality(issues, prs) {
  const byKey = {}; for (const i of issues) byKey[i.key] = i
  const prByNum = {}; for (const p of prs) prByNum[`${p.project}#${p.num}`] = p
  const bugs = issues.filter(i => i.isBug)
  const escaped = [], caught = []
  for (const b of bugs) {
    const parent = b.linkedKey ? byKey[b.linkedKey] : null
    const parentLive = parent?.liveAt ? Date.parse(parent.liveAt) : null
    const isEscaped = !!parentLive && Date.parse(b.created) > parentLive
    b.escaped = isEscaped // escaped = filed AFTER the thing it belongs to went Live/Closed
    ;(isEscaped ? escaped : caught).push(b)
  }
  const shippedBy = {}
  for (const i of issues) if (i.live && !i.isBug && i.liveAt) (shippedBy[monthKey(Date.parse(i.liveAt))] ||= []).push(i)
  const months = [...new Set([...Object.keys(shippedBy), ...bugs.map(b => monthKey(Date.parse(b.created)))])].sort().slice(-12)
  const escapeRate = months.map(m => {
    const shipped = (shippedBy[m] || []).length
    const esc = escaped.filter(b => monthKey(Date.parse(b.created)) === m).length
    const qa = caught.filter(b => monthKey(Date.parse(b.created)) === m).length
    return { month: m, shipped, escaped: esc, qaCaught: qa, rate: shipped ? +(esc / shipped * 100).toFixed(1) : null }
  })
  // hotspots: bug → linkedKey → that ticket's prNums → prs[].files[].path, rolled up by the top-2 path segments
  const areaBugs = {}, areaShipped = {}
  const pathsOf = i => {
    const set = new Set()
    for (const n of i?.prNums || []) for (const f of prByNum[`${i.project}#${n}`]?.files || []) set.add(top2Seg(f.path))
    return [...set]
  }
  for (const i of issues) if (i.live && !i.isBug) for (const a of pathsOf(i)) areaShipped[a] = (areaShipped[a] || 0) + 1
  for (const b of bugs) {
    const parent = b.linkedKey ? byKey[b.linkedKey] : null
    for (const a of [...new Set([...pathsOf(parent), ...pathsOf(b)])]) (areaBugs[a] ||= { area: a, bugs: 0, escaped: 0, keys: [] }).bugs++
    for (const a of [...new Set([...pathsOf(parent), ...pathsOf(b)])]) { if (b.escaped) areaBugs[a].escaped++; areaBugs[a].keys.push(b.key) }
  }
  const hotspots = Object.values(areaBugs).map(a => ({
    ...a, keys: a.keys.slice(0, 20), shipped: areaShipped[a.area] || 0,
    bugsPerShipped: areaShipped[a.area] ? +(a.bugs / areaShipped[a.area]).toFixed(2) : null,
  })).sort((a, b) => b.bugs - a.bugs).slice(0, 10)
  // ownership concentration / bus factor — component × engineer, flagged at ≥70% from one person
  const comp = {}
  for (const i of issues) {
    if (!i.area || !i.live || !i.assignee) continue
    const c = (comp[i.area] ||= { area: i.area, total: 0, by: {} })
    c.total++; c.by[i.assignee.name] = (c.by[i.assignee.name] || 0) + 1
  }
  const ownership = Object.values(comp).map(c => {
    const rows = Object.entries(c.by).map(([who, n]) => ({ who, n, share: +(n / c.total * 100).toFixed(1) })).sort((a, b) => b.n - a.n)
    return { area: c.area, total: c.total, contributors: rows.length, rows, top: rows[0] || null, busFactor: rows.length === 1 || (rows[0]?.share || 0) >= 70 }
  }).sort((a, b) => b.total - a.total)
  return {
    escapeRate, hotspots, ownership,
    totals: { bugs: bugs.length, escaped: escaped.length, qaCaught: caught.length, reopens: issues.filter(i => i.rework > 0).length },
  }
}

// ---------- investment mix (§7) — delivered points AND activeDays, bucketed. Rules from projects.json. ----------
const DEFAULT_BUCKETS = {
  bug: { types: ['bug', 'defect'] },
  ai: { labels: ['ai', 'ai-experiment', 'ai-experimentation', 'claude', 'cursor', 'genai', 'llm'] },
  toil: { types: ['task', 'chore', 'support', 'maintenance', 'sub-task'], labels: ['tech-debt', 'techdebt', 'tech_debt', 'toil', 'ktlo', 'ops', 'refactor', 'chore'] },
  feature: { types: ['story', 'epic', 'feature', 'improvement', 'new feature'] },
}
const effortBuckets = () => { const j = projectsFile(); return (!Array.isArray(j) && j?.effortBuckets) || DEFAULT_BUCKETS }
function bucketOf(i, B) {
  const type = norm(i.type), labels = (i.labels || []).map(norm)
  const hits = b => (B[b]?.types || []).some(t => type.includes(norm(t))) || (B[b]?.labels || []).some(l => labels.includes(norm(l)))
  if (i.isBug || hits('bug')) return i.escaped ? 'bug-escaped' : 'bug-qa'
  if (hits('ai')) return 'ai'
  if (hits('toil')) return 'toil'
  if (hits('feature')) return 'feature'
  return 'feature' // sane default when no rule matches
}
const BUCKETS = ['feature', 'bug-escaped', 'bug-qa', 'toil', 'ai']
function investment(issues) {
  const B = effortBuckets()
  const byMonth = {}
  for (const i of issues) {
    if (!i.live || !i.liveAt) continue
    const m = monthKey(Date.parse(i.liveAt))
    const row = (byMonth[m] ||= { month: m, pts: 0, days: 0, reworkPts: 0, reworkDays: 0, buckets: Object.fromEntries(BUCKETS.map(b => [b, { pts: 0, days: 0, n: 0 }])) })
    const b = bucketOf(i, B)
    row.buckets[b].pts += i.pts; row.buckets[b].days += i.activeDays; row.buckets[b].n++
    row.pts += i.pts; row.days += i.activeDays
    if (i.rework > 0) { row.reworkPts += i.pts; row.reworkDays += i.activeDays } // work we paid for twice
  }
  const months = Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month)).slice(-6)
  for (const m of months) { m.pts = +m.pts.toFixed(1); m.days = +m.days.toFixed(1); m.reworkPts = +m.reworkPts.toFixed(1); m.reworkDays = +m.reworkDays.toFixed(1); for (const b of BUCKETS) { m.buckets[b].pts = +m.buckets[b].pts.toFixed(1); m.buckets[b].days = +m.buckets[b].days.toFixed(1) } }
  const cur = months[months.length - 1], prev = months[months.length - 2]
  const tax = m => (m && m.pts ? +((m.buckets['bug-escaped'].pts + m.buckets['bug-qa'].pts + m.buckets.toil.pts) / m.pts * 100).toFixed(1) : null)
  return { buckets: BUCKETS, months, rules: B, bugTaxPct: tax(cur), bugTaxPrevPct: tax(prev) }
}

// ---------- sprint predictability (§8) — from the Sprint changelog items statusSegments now keeps ----------
function sprintNamesAt(i, t) {
  const evs = i.sprintEvents || []
  const before = evs.filter(e => e.at <= t)
  if (before.length) return nameList(before[before.length - 1].to)
  if (evs.length) return nameList(evs[0].from)                 // never changed before t → the pre-first-event set
  return (i.sprints || []).map(s => s.name)                    // no Sprint history at all → whatever it is in now
}
function sprintStats(issues) {
  const reg = {}
  for (const i of issues) for (const s of i.sprints || []) if (s.name) {
    const e = (reg[s.name] ||= { ...s })
    for (const k of ['startDate', 'endDate', 'completeDate', 'id', 'state']) if (!e[k] && s[k]) e[k] = s[k]
  }
  const sprints = Object.values(reg).filter(s => s.startDate).sort((a, b) => Date.parse(b.startDate) - Date.parse(a.startDate)).slice(0, 6)
  return sprints.map(s => {
    const start = Date.parse(s.startDate)
    const end = Date.parse(s.completeDate || s.endDate || new Date().toISOString())
    const committed = [], added = [], delivered = [], carried = []
    for (const i of issues) {
      const inNow = (i.sprints || []).some(x => x.name === s.name)
      const everIn = inNow || (i.sprintEvents || []).some(e => nameList(e.to).includes(s.name) || nameList(e.from).includes(s.name))
      if (!everIn) continue
      const atStart = sprintNamesAt(i, start).includes(s.name)
      const atEnd = sprintNamesAt(i, end).includes(s.name)
      if (atStart) committed.push(i); else if (atEnd || inNow) added.push(i)
      const done = i.liveAt && Date.parse(i.liveAt) <= end
      if (done && (atStart || atEnd || inNow)) delivered.push(i)
      else if (atEnd && !done) carried.push(i)
    }
    const pts = a => +a.reduce((x, i) => x + (i.pts || 0), 0).toFixed(1)
    const cpts = pts(committed)
    return {
      id: s.id, name: s.name, state: s.state, startDate: s.startDate, endDate: s.endDate, completeDate: s.completeDate,
      committed: committed.length, committedPts: cpts,
      added: added.length, addedPts: pts(added),
      delivered: delivered.length, deliveredPts: pts(delivered),
      carriedOver: carried.length, carriedOverPts: pts(carried),
      injectionPct: cpts ? +(pts(added) / cpts * 100).toFixed(1) : null,
      sayDoPct: cpts ? +(pts(delivered) / cpts * 100).toFixed(1) : null,
      keys: { committed: committed.map(i => i.key), added: added.map(i => i.key), delivered: delivered.map(i => i.key), carriedOver: carried.map(i => i.key) },
    }
  })
}

// ---------- epic rollup + forecast (§10) ----------
const EPIC_FILE = path.join(HERE, 'eng-epic-targets.json')
function readEpicTargets() { try { return JSON.parse(fs.readFileSync(EPIC_FILE, 'utf8')) } catch { return {} } }
function writeEpicTargets(o) { fs.writeFileSync(EPIC_FILE, JSON.stringify(o, null, 2)) }
function epicRollup(issues) {
  const byKey = {}; for (const i of issues) byKey[i.key] = i
  const targets = readEpicTargets()
  // trailing-8-week velocity, in points per working day
  const since = Date.now() - 56 * DAY
  const vel = issues.filter(i => i.live && i.liveAt && Date.parse(i.liveAt) >= since).reduce((a, i) => a + (i.pts || 0), 0)
  const perDay = vel / Math.max(1, workDays(since, Date.now()))
  const groups = {}
  for (const i of issues) if (i.parent?.key) (groups[i.parent.key] ||= { key: i.parent.key, summary: i.parent.summary, kids: [] }).kids.push(i)
  const bugsByParent = {}
  for (const i of issues) if (i.isBug && i.linkedKey) (bugsByParent[i.linkedKey] ||= []).push(i)
  return Object.values(groups)
    .filter(g => g.kids.some(k => !k.live)) // in flight only
    .map(g => {
      const done = g.kids.filter(k => k.live)
      const ptsDone = +done.reduce((a, k) => a + (k.pts || 0), 0).toFixed(1)
      const ptsRemaining = +g.kids.filter(k => !k.live).reduce((a, k) => a + (k.pts || 0), 0).toFixed(1)
      const starts = g.kids.map(k => Date.parse(k.firstInProg || k.created)).filter(Boolean)
      const startedAt = starts.length ? Math.min(...starts) : null
      const escapedBugs = g.kids.flatMap(k => bugsByParent[k.key] || []).filter(b => b.escaped)
      const forecast = perDay > 0 && ptsRemaining > 0 ? new Date(addWorkTime(Date.now(), (ptsRemaining / perDay) * WORKDAY_MS)).toISOString() : (ptsRemaining === 0 ? new Date().toISOString() : null)
      const epic = byKey[g.key]
      const due = targets[g.key]?.targetDate || epic?.duedate || null
      const slipDays = due && forecast ? +workDays(Date.parse(due), Date.parse(forecast)).toFixed(1) : null
      return {
        key: g.key, summary: g.summary, project: epic?.project || g.kids[0]?.project || null,
        url: epic ? jiraLink(epic) : null,
        total: g.kids.length, done: done.length, pctComplete: g.kids.length ? +(done.length / g.kids.length * 100).toFixed(1) : 0,
        ptsDone, ptsRemaining,
        daysInFlight: startedAt ? +workDays(startedAt, Date.now()).toFixed(1) : null,
        escapedBugs: escapedBugs.length, escapedBugKeys: escapedBugs.map(b => b.key),
        velocityPtsPerDay: +perDay.toFixed(2), forecastDate: forecast, targetDate: due,
        targetManual: !!targets[g.key]?.targetDate,
        slipDays, risk: slipDays == null ? 'unknown' : slipDays > 5 ? 'red' : slipDays > 0 ? 'amber' : 'green',
        keys: g.kids.map(k => k.key),
      }
    })
    .sort((a, b) => (b.slipDays ?? -99) - (a.slipDays ?? -99))
}

// ---------- sustainable pace (§14) — TEAM AGGREGATE ONLY. min-N=5 enforced HERE, not in the UI. ----------
const MIN_N = 5
function loadStats(prs, issues, members) {
  const weeks = {}
  for (const p of prs) {
    if (!p.createdAt || BOT(p.author)) continue
    const t = Date.parse(p.createdAt)
    const w = (weeks[weekKey(t)] ||= { week: weekKey(t), n: 0, off: 0, weekend: 0, authors: new Set() })
    w.n++; if (offHours(t)) w.off++; if (isWeekend(t)) w.weekend++
    if (p.author) w.authors.add(p.author)
  }
  const rows = Object.values(weeks).sort((a, b) => a.week.localeCompare(b.week)).slice(-12).map(w => {
    const suppressed = w.authors.size < MIN_N // below the floor the cell renders "—", server-side. There is no drilldown.
    return {
      week: w.week, prs: suppressed ? null : w.n, contributors: w.authors.size, suppressed,
      offHoursPct: suppressed ? null : +(w.off / w.n * 100).toFixed(1),
      weekendPct: suppressed ? null : +(w.weekend / w.n * 100).toFixed(1),
    }
  })
  const active = issues.filter(i => i.active).length
  const heads = members.length
  return {
    minN: MIN_N, weeks: rows,
    wipPerEngineer: heads >= MIN_N ? +(active / heads).toFixed(2) : null,
    headcount: heads, note: 'Team aggregate only. No per-person rows exist in this payload, by construction.',
  }
}

// ---------- snapshot (cached per project, TTL) ----------
const snaps = new Map() // key -> {at, data}
const SNAP_TTL = 2 * 3600_000 // cache the JIRA+GitHub aggregate for 2 hours
// §3: the REAL error text, not console.error. A swallowed gh failure renders a confident zero-PR dashboard.
function safe(fn, dflt, errs) {
  try { return fn() } catch (e) {
    console.error('[eng]', e.message)
    if (errs) errs.push({ source: 'gh', message: String(e.message).slice(0, 400), at: new Date().toISOString() })
    return dflt
  }
}
// everything derived, computed once, over whatever issue/PR set it is handed (one project or all of them)
const derive = (issues, prs, members, ci) => ({
  triage: triage(issues, prs, ci),
  review: reviewFlow(prs),
  quality: quality(issues, prs),     // sets i.escaped as a side-effect — investment() reads it
  investment: investment(issues),
  sprints: sprintStats(issues),
  epics: epicRollup(issues),
  load: loadStats(prs, issues, members),
  ci,
})
async function snapshot(cfg) {
  const hit = snaps.get(cfg.key)
  if (hit && Date.now() - hit.at < SNAP_TTL) return hit.data
  const errors = []
  const gh0 = ghAvailable()
  if (!gh0) errors.push({ source: 'gh', message: 'gh CLI not authenticated (`gh auth status` failed) — PR, review and CI panels are empty, not zero', at: new Date().toISOString() })
  const prs = gh0 ? safe(() => fetchPRs(cfg), [], errors) : []
  const prsByTicket = {}; for (const p of prs) (prsByTicket[p.ticket] ||= []).push(p)
  const { issues: raw, F } = await jiraIssues(cfg)
  const issues = raw.map(is => computeIssue(is, F, prsByTicket, cfg))
  resolveRoles(issues, cfg)
  resolveOwnership(issues)
  const dev = new Set(cfg.devEmails)
  const memMap = {}
  for (const i of issues) if (i.assignee) { const k = i.assignee.id; (memMap[k] ||= { ...i.assignee, count: 0 }).count++ }
  const allMembers = Object.values(memMap).sort((a, b) => b.count - a.count)
  const devMembers = allMembers.filter(m => dev.has((m.email || '').toLowerCase()))
  const members = devMembers.length ? devMembers : allMembers // ponytail: fall back if JIRA hides emails
  const ci = [ciFor(cfg, errors)].filter(Boolean)
  const data = {
    available: true, team: projectPill(cfg), projects: projectList(),
    generatedAt: new Date().toISOString(), ghAvailable: prs.length > 0 || gh0,
    issues, prs, members, okrs: OKRS,
    byProject: [{ key: cfg.key, name: cfg.name, issues, prs }],
    errors, writes: cfg.writes,
    provenance: { jql: cfg.jql, graphql: cfg.githubRepo ? prQuery(...cfg.githubRepo.split('/')) : GQL, ghCommand: cfg.githubRepo ? ghCommandFor(cfg.githubRepo) : null, workingTime: '10:00–18:00 Sun–Thu, Asia/Riyadh', ttlMs: SNAP_TTL },
    ...derive(issues, prs, members, ci),
  }
  snaps.set(cfg.key, { at: Date.now(), data })
  return data
}
async function snapshotAll() {
  const projs = loadProjects()
  const parts = await Promise.all(projs.map(p => snapshot(p).catch(e => ({ available: false, key: p.key, name: p.name, error: e.message }))))
  const avail = parts.filter(p => p.available)
  if (!avail.length) { const e = new Error(parts.every(p => p.error === 'no-jira-creds') ? 'no-jira-creds' : (parts[0]?.error || 'no-jira-creds')); throw e }
  const issues = avail.flatMap(p => p.issues)
  const prs = avail.flatMap(p => p.prs)
  const mm = {}
  for (const p of avail) for (const m of p.members) { (mm[m.id] ||= { ...m, count: 0 }).count += m.count }
  const members = Object.values(mm).sort((a, b) => b.count - a.count)
  const ci = avail.flatMap(p => p.ci || [])
  const errors = [
    ...avail.flatMap(p => p.errors || []),
    ...parts.filter(p => !p.available).map(p => ({ source: 'project', project: p.key, message: `${p.name || p.key}: ${p.error}`, at: new Date().toISOString() })),
  ]
  return {
    available: true, team: { key: 'all', name: 'All projects', jiraProjectKey: 'ALL', githubRepo: '' },
    projects: projectList(), generatedAt: new Date().toISOString(),
    ghAvailable: avail.some(p => p.ghAvailable), issues, prs, members, okrs: OKRS,
    // §9: keep the project boundaries the old flatMap destroyed
    byProject: avail.map(p => ({ key: p.team.key, name: p.team.name, issues: p.issues, prs: p.prs })),
    errors, writes: avail.some(p => p.writes),
    provenance: { jql: loadProjects().map(p => ({ project: p.key, jql: p.jql })), graphql: GQL, ghCommand: loadProjects().filter(p => p.githubRepo).map(p => ({ project: p.key, cmd: ghCommandFor(p.githubRepo) })), workingTime: '10:00–18:00 Sun–Thu, Asia/Riyadh', ttlMs: SNAP_TTL },
    ...derive(issues, prs, members, ci),
  }
}
async function snapFor(key) {
  if (key === 'all') return snapshotAll()
  const projs = loadProjects()
  return snapshot(projs.find(p => p.key === (key || '').toUpperCase()) || projs[0])
}

// ---------- OKRs (§4) — every measure is AUTO, computed by the UI from live aggregates ----------
const OKRS = {
  Q3: [
    { title: 'Cut engineering effort per feature', def: 'Reduce hands-on development effort to ship a feature, without sacrificing quality.', owner: 'Web Engineering', color: '#5fd39a', measures: [
      { t: 'Reduce Avg Development Time 40% vs baseline', auto: 'devTime', note: 'Working days in In Progress · vs earliest-month baseline', reducePct: 40, baselineOf: 'devTime', unit: 'd', dir: 'down' },
      { t: 'Estimation accuracy above 85%', auto: 'estAcc', note: 'Story-point estimate vs actual dev time', target: 85, unit: '%', dir: 'up' },
      { t: 'Code review time under 1 day', auto: 'crTime', note: 'Working days in In Code Review', target: 1.0, unit: 'd', dir: 'down' },
    ] },
    { title: 'Ship faster with fewer QA loops', def: 'Tighten the QA feedback loop so tickets spend less time bouncing between QA states.', owner: 'Web Engineering', color: '#8ec8ff', measures: [
      { t: 'Avg QA Cycles under 1.0', auto: 'qaCycles', note: 'Ready for QA / In QA (Dev) loops', target: 1.0, unit: '', dir: 'down' },
      { t: 'Zero stale statuses', auto: 'stale', note: 'JIRA status vs merged-PR cross-check', target: 0, unit: '', dir: 'down' },
      { t: 'Cycle time under 4 days', auto: 'cycle', note: 'In Progress → Live, avg shipped', target: 4.0, unit: 'd', dir: 'down' },
    ] },
    { title: 'Tighten the PR feedback loop', def: 'Get PRs reviewed and merged faster, with fewer rework rounds.', owner: 'Web Engineering', color: '#a894f0', measures: [
      { t: 'Time to first review under 1 day', auto: 'firstReview', note: 'GitHub · opened → first review', target: 1.0, unit: 'd', dir: 'down' },
      { t: 'PR merge time under 3 days', auto: 'mergeTime', note: 'GitHub · opened → merged', target: 3.0, unit: 'd', dir: 'down' },
      { t: 'Rework rate under 15%', auto: 'reworkRate', note: 'Issues re-entering In Progress / Reopen', target: 15, unit: '%', dir: 'down' },
    ] },
  ],
  Q4: [
    { title: 'Sustain effort reduction gains', def: 'Hold the Q3 development-time improvements across the full surface.', owner: 'Web Engineering', color: '#8ec8ff', carried: 'Q3', measures: [
      { t: 'Reduce Avg Development Time 37% vs baseline', auto: 'devTime', note: 'Rolling · vs earliest-month baseline', reducePct: 37, baselineOf: 'devTime', unit: 'd', dir: 'down' },
      { t: 'Cycle time under 4 days', auto: 'cycle', note: 'In Progress → Live, avg shipped', target: 4.0, unit: 'd', dir: 'down' },
    ] },
    { title: 'Reach 90% estimation accuracy', def: 'Push planning quality to a 90% accuracy floor.', owner: 'Web Engineering', color: '#5fd39a', carried: 'Q3', measures: [
      { t: 'Avg Estimation Accuracy ≥ 90%', auto: 'estAcc', note: 'Story-point estimate vs actual', target: 90, unit: '%', dir: 'up' },
    ] },
  ],
}

// ---------- per-ticket detail + AI artifacts (Sprint analytics) ----------
// Detail is fetched on demand (not in the bulk snapshot) so the board stays lean: JIRA description +
// comments (from renderedFields HTML) + status/assignee/sprint changelog timeline + linked-PR/commit
// context (from the cached PR list, plus one `gh pr view` per PR for commit subjects). AC & test cases
// are generated by `claude -p` (same mechanism as career-analyze) and persisted keyed by JIRA key.
const ARTIFACTS_FILE = path.join(HERE, 'eng-artifacts.json')
function readArtifacts() { try { return JSON.parse(fs.readFileSync(ARTIFACTS_FILE, 'utf8')) } catch { return {} } }
function writeArtifacts(o) { fs.writeFileSync(ARTIFACTS_FILE, JSON.stringify(o, null, 2)) }
const hashOf = s => crypto.createHash('sha256').update(s).digest('hex')
const cfgFor = key => { const projs = loadProjects(); return projs.find(p => p.key === (key || '').toUpperCase()) || projs[0] }

const decodeEnt = s => String(s).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
// JIRA renderedFields give HTML — turn it into readable text, keeping block/list line breaks.
function htmlToText(html) {
  if (!html) return ''
  return decodeEnt(String(html).replace(/<\s*(br|\/p|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, '\n').replace(/<\s*li[^>]*>/gi, '• ').replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}
function historyOf(changelog) {
  const out = []
  for (const h of changelog?.histories || [])
    for (const it of h.items || [])
      if (['status', 'assignee', 'Sprint'].includes(it.field))
        out.push({ at: h.created, author: h.author?.displayName || '', field: it.field, from: it.fromString || '', to: it.toString || '' })
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}
function prCommits(cfg, num) {
  if (!cfg.githubRepo) return []
  try {
    const j = JSON.parse(gh(['pr', 'view', String(num), '--repo', cfg.githubRepo, '--json', 'commits'], 20000))
    return (j.commits || []).map(c => (c.messageHeadline || '').trim()).filter(Boolean).slice(0, 30)
  } catch { return [] }
}

const ticketCache = new Map() // key -> {at, data}
const TICKET_TTL = 10 * 60_000
async function ticketDetail(cfg, key) {
  const hit = ticketCache.get(key)
  if (hit && Date.now() - hit.at < TICKET_TTL) return hit.data
  const a = await jiraAuth(cfg)
  const iss = await jira(a, `/issue/${encodeURIComponent(key)}?expand=renderedFields,changelog&fields=summary,description,comment,status,issuetype,assignee,created,updated`)
  const rf = iss.renderedFields || {}
  const comments = (rf.comment?.comments || iss.fields.comment?.comments || []).map(c => ({ author: c.author?.displayName || '', at: c.created, body: htmlToText(c.body) }))
  const snap = await snapshot(cfg).catch(() => null)
  const prsRaw = (snap?.prs || []).filter(p => p.ticket === key)
  const prs = prsRaw.map(p => ({ num: p.num, repo: p.repo, title: p.title, state: p.state, branch: p.branch, changedFiles: p.changedFiles, files: (p.files || []).map(f => f.path).slice(0, 40), commits: prCommits(cfg, p.num) }))
  const data = { key, summary: iss.fields.summary, type: iss.fields.issuetype?.name || '', status: iss.fields.status?.name || '', description: htmlToText(rf.description), comments, history: historyOf(iss.changelog), prs }
  ticketCache.set(key, { at: Date.now(), data })
  return data
}

const GEN = {
  ac: 'You are a senior product engineer. From the JIRA ticket below, write clear, testable Acceptance Criteria as a markdown checklist — Given/When/Then where it helps, plain checklist otherwise. Cover the happy path, error/empty/loading states, and edge cases implied by the content. Output ONLY the acceptance criteria in markdown, no preamble.',
  tests: 'You are a senior QA engineer. From the JIRA ticket below and its linked PR/commit context, write a concrete functional test plan as a markdown table with columns: #, Scenario, Steps, Expected. Include happy-path, negative, boundary and regression cases relevant to the changed files. Output ONLY the test plan in markdown, no preamble.',
}
function genPrompt(kind, d) {
  const prs = d.prs.map(p => `PR #${p.num} (${p.state}) ${p.title}\nfiles: ${p.files.join(', ')}\ncommits: ${p.commits.join(' | ')}`).join('\n\n')
  return `${GEN[kind]}\n\n# ${d.key} — ${d.summary}\nType: ${d.type} · Status: ${d.status}\n\n## Description\n${d.description || '(none)'}\n\n## Comments\n${d.comments.map(c => `- ${c.author}: ${c.body}`).join('\n') || '(none)'}\n\n## Linked PR / commit context\n${prs || '(none)'}`
}
function claudeMarkdown(prompt) { // ponytail: spawnSync blocks the handler — fine for a local single-user dashboard, same as career-analyze
  const r = spawnSync('claude', ['-p', prompt, '--output-format', 'json'], { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 })
  if (r.status !== 0) throw new Error((r.stderr || 'claude failed').toString().slice(0, 200))
  const out = JSON.parse(r.stdout.toString())
  const md = out.result || out.text || ''
  if (!md) throw new Error('claude returned empty result')
  return { md, model: out.model || 'claude' }
}

// Named exports for the other data-plane-A modules (server.mjs inbox, server-team.mjs, server-cursor-join.mjs).
// Nothing here reads a transcript, a token count or a session — and nothing that does may import from it.
export { snapshotAll, snapshot, snapFor, loadProjects, projectList, cfgFor, triage, readTriage, reviewFlow, quality, investment, sprintStats, epicRollup, loadStats, ciFor, workMs, workDays, addWorkTime, recFor, pctl, median, offHours, isWeekend, weekKey, GQL }

// ---------- routes ----------
export default function mountEng(app) {
  app.get('/api/eng/projects', (req, res) => res.json(projectList()))
  app.post('/api/eng/projects', (req, res) => {
    const { name, jiraProjectKey, githubRepo, jiraHost, members } = req.body || {}
    const key = (jiraProjectKey || '').toUpperCase().trim()
    if (!/^[A-Z][A-Z0-9]+$/.test(key)) return res.status(400).json({ error: 'invalid JIRA project key' })
    if (!/^[\w.-]+\/[\w.-]+$/.test(githubRepo || '')) return res.status(400).json({ error: 'githubRepo must be owner/name' })
    if (loadProjects().find(p => p.key === key)) return res.status(409).json({ error: `project ${key} already exists` })
    upsertProject({ key, name: name || key, jiraProjectKey: key, githubRepo, ...(jiraHost ? { jiraHost } : {}), ...rostersFrom(members) })
    snaps.delete(key); FIELDS.delete(key)
    res.json({ ok: true, projects: projectList() })
  })
  app.put('/api/eng/projects/:key', (req, res) => {
    const key = (req.params.key || '').toUpperCase()
    if (!loadProjects().find(p => p.key === key)) return res.status(404).json({ error: 'no such project' })
    const { name, githubRepo, jiraHost, members } = req.body || {}
    if (githubRepo && !/^[\w.-]+\/[\w.-]+$/.test(githubRepo)) return res.status(400).json({ error: 'githubRepo must be owner/name' })
    upsertProject({ key, ...(name ? { name } : {}), ...(githubRepo ? { githubRepo } : {}), ...(jiraHost ? { jiraHost } : {}), ...rostersFrom(members) })
    snaps.delete(key); FIELDS.delete(key) // roster/repo change invalidates this project's cache
    res.json({ ok: true, projects: projectList() })
  })
  app.get('/api/eng/creds', (req, res) => { const { email, token } = creds(); res.json({ hasCreds: !!(email && token), email }) })
  app.post('/api/eng/creds', (req, res) => {
    const { email, token } = req.body || {}
    if (!email || !token) return res.status(400).json({ error: 'email and API token both required' })
    fs.writeFileSync(path.join(HERE, '.eng.local.json'), JSON.stringify({ jiraEmail: email, jiraToken: token }, null, 2))
    snaps.clear() // new creds → recompute
    res.json({ ok: true })
  })
  app.get('/api/eng/bug-ownership', (req, res) => res.json(readBugOwn()))
  app.post('/api/eng/bug-ownership', (req, res) => {
    const { key, ownerId, fixerId } = req.body || {}
    if (!key) return res.status(400).json({ error: 'key required' })
    const o = readBugOwn()
    o[key] = { ...(o[key] || {}), ...(ownerId !== undefined ? { ownerId: ownerId || null } : {}), ...(fixerId !== undefined ? { fixerId: fixerId || null } : {}) }
    if (!o[key].ownerId && !o[key].fixerId) delete o[key]
    writeBugOwn(o); snaps.clear() // ownership feeds ratios — invalidate so the next snapshot reflects it
    res.json({ ok: true, ownership: o[key] || null })
  })
  app.get('/api/eng/snapshot', async (req, res) => {
    try { res.json(await snapFor(req.query.project)) }
    catch (e) {
      const projs = projectList()
      if (e.message === 'no-jira-creds') return res.json({ available: false, reason: 'no-jira-token', projects: projs, team: projs[0] })
      res.status(500).json({ available: false, error: e.message, projects: projs, team: projs[0] })
    }
  })
  app.post('/api/eng/refresh', async (req, res) => {
    const key = req.query.project
    try {
      if (key === 'all' || !key) { snaps.clear(); ciCache.clear() }
      else { snaps.delete((key || '').toUpperCase()); ciCache.delete((key || '').toUpperCase()) }
      res.json(await snapFor(key))
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  // ---- §1 attention queue: the same records the snapshot carries, plus the dismissal store ----
  app.get('/api/eng/triage', async (req, res) => {
    try {
      const s = await snapFor(req.query.project)
      res.json({ generatedAt: s.generatedAt, items: s.triage, dismissed: readTriage(), errors: s.errors, writes: s.writes })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })
  // dismiss-for-today (or forever). `until` is an ISO string; omit for a 1-working-day snooze.
  app.post('/api/eng/triage/dismiss', (req, res) => {
    const { id, until, forever } = req.body || {}
    if (!id) return res.status(400).json({ error: 'id required' })
    const o = readTriage()
    o[id] = { at: new Date().toISOString(), until: forever ? null : (until || new Date(addWorkTime(Date.now(), WORKDAY_MS)).toISOString()) }
    writeTriage(o)
    res.json({ ok: true, dismissed: o[id] })
  })
  app.delete('/api/eng/triage/dismiss/:id', (req, res) => {
    const o = readTriage(); delete o[req.params.id]; writeTriage(o)
    res.json({ ok: true })
  })

  // ---- §11 CI health (its own route so a red main can be polled without the whole snapshot) ----
  app.get('/api/eng/ci', (req, res) => {
    const key = (req.query.project || 'all').toUpperCase()
    const errors = []
    const projs = loadProjects().filter(p => key === 'ALL' || p.key === key)
    const repos = projs.map(p => ciFor(p, errors)).filter(Boolean)
    res.json({ ghAvailable: ghAvailable(), repos, errors, generatedAt: new Date().toISOString() })
  })

  // ---- §14 sustainable pace — TEAM AGGREGATE. min-N=5 applied above; no user/machine param exists. ----
  app.get('/api/eng/load', async (req, res) => {
    try { const s = await snapFor(req.query.project); res.json(s.load) }
    catch (e) { res.status(500).json({ error: e.message }) }
  })

  // ---- §10 epic target-date overrides ----
  app.get('/api/eng/epic-targets', (req, res) => res.json(readEpicTargets()))
  app.post('/api/eng/epic-targets', (req, res) => {
    const { key, targetDate } = req.body || {}
    if (!key) return res.status(400).json({ error: 'key required' })
    const o = readEpicTargets()
    if (targetDate) o[key] = { targetDate, at: new Date().toISOString() }
    else delete o[key]
    writeEpicTargets(o); snaps.clear() // the forecast delta is computed in the snapshot
    res.json({ ok: true, targets: o })
  })

  // ---- writes (§writes) — gated on projects.json "writes": true, operator's own credentials, one call each.
  // The DEFAULT everywhere in the UI is copy-to-clipboard. These exist so an opt-in team can act in one click.
  app.post('/api/eng/pr/:num/comment', (req, res) => {
    const cfg = cfgFor(req.query.project || req.body?.project)
    if (!cfg.writes) return res.status(403).json({ error: 'writes disabled — set "writes": true on this project in projects.json' })
    const body = (req.body?.body || '').trim()
    if (!body) return res.status(400).json({ error: 'body required' })
    try { gh(['pr', 'comment', String(req.params.num), '--repo', cfg.githubRepo, '--body', body], 30000); res.json({ ok: true }) }
    catch (e) { res.status(500).json({ error: e.message }) }
  })
  app.post('/api/eng/pr/:num/request-review', (req, res) => {
    const cfg = cfgFor(req.query.project || req.body?.project)
    if (!cfg.writes) return res.status(403).json({ error: 'writes disabled — set "writes": true on this project in projects.json' })
    const login = (req.body?.login || '').trim()
    if (!login) return res.status(400).json({ error: 'login required' })
    try { gh(['pr', 'edit', String(req.params.num), '--repo', cfg.githubRepo, '--add-reviewer', login], 30000); snaps.delete(cfg.key); res.json({ ok: true }) }
    catch (e) { res.status(500).json({ error: e.message }) }
  })
  app.post('/api/eng/ticket/:key/transition', async (req, res) => {
    const cfg = cfgFor(req.query.project || req.body?.project)
    if (!cfg.writes) return res.status(403).json({ error: 'writes disabled — set "writes": true on this project in projects.json' })
    const to = (req.body?.to || '').trim()
    if (!to) return res.status(400).json({ error: 'to (status name) required' })
    try {
      const a = await jiraAuth(cfg)
      const key = req.params.key.toUpperCase()
      const { transitions } = await jira(a, `/issue/${encodeURIComponent(key)}/transitions`)
      const t = (transitions || []).find(t => norm(t.to?.name) === norm(to) || norm(t.name) === norm(to))
      if (!t) return res.status(400).json({ error: `no transition to "${to}"`, available: (transitions || []).map(t => t.to?.name) })
      const r = await fetch(`${a.base}/issue/${encodeURIComponent(key)}/transitions`, { method: 'POST', headers: { ...a.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ transition: { id: t.id } }) })
      if (!r.ok) throw new Error(`jira ${r.status}: ${(await r.text()).slice(0, 180)}`)
      snaps.delete(cfg.key); ticketCache.delete(key)
      res.json({ ok: true, to: t.to?.name })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  // ticket detail — content, comments, history, linked-PR context + any saved AC/test-case artifacts
  app.get('/api/eng/ticket/:key', async (req, res) => {
    try {
      const d = await ticketDetail(cfgFor(req.query.project), req.params.key.toUpperCase())
      const art = readArtifacts()[d.key] || {}
      const withStale = kind => art[kind] ? { ...art[kind], stale: !art[kind].edited && art[kind].inputHash !== hashOf(genPrompt(kind, d)) } : null
      res.json({ ...d, artifacts: { ac: withStale('ac'), tests: withStale('tests') } })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })
  // generate acceptance criteria / test cases via `claude -p`, persist keyed by JIRA key
  app.post('/api/eng/ticket/:key/generate', async (req, res) => {
    try {
      const kind = req.body?.kind
      if (!['ac', 'tests'].includes(kind)) return res.status(400).json({ error: 'kind must be ac|tests' })
      const key = req.params.key.toUpperCase()
      const d = await ticketDetail(cfgFor(req.query.project || req.body.project), key)
      const prompt = genPrompt(kind, d)
      const { md, model } = claudeMarkdown(prompt)
      const store = readArtifacts()
      store[key] = { ...(store[key] || {}), [kind]: { md, at: new Date().toISOString(), model, inputHash: hashOf(prompt), edited: false } }
      writeArtifacts(store)
      res.json({ ...store[key][kind], stale: false })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })
  // save a hand-edited artifact
  app.put('/api/eng/ticket/:key/artifact', (req, res) => {
    const { kind, md } = req.body || {}
    if (!['ac', 'tests'].includes(kind)) return res.status(400).json({ error: 'kind must be ac|tests' })
    const key = req.params.key.toUpperCase()
    const store = readArtifacts()
    store[key] = { ...(store[key] || {}), [kind]: { ...(store[key]?.[kind] || {}), md, at: new Date().toISOString(), edited: true } }
    writeArtifacts(store)
    res.json({ ...store[key][kind], stale: false })
  })
}
