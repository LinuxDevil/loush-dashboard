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
  }
}
function extraProjects() { try { return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8')) } catch { return [] } }
function loadProjects() {
  const map = new Map()
  for (const p of DEFAULT_PROJECTS) map.set(p.key.toUpperCase(), p)
  for (const p of extraProjects()) { const k = (p.key || p.jiraProjectKey || '').toUpperCase(); if (!k) continue; map.set(k, { ...(map.get(k) || {}), ...p, key: k }) } // extras override/extend defaults
  return [...map.values()].map(normalizeProject)
}
function upsertProject(rec) {
  const extra = extraProjects()
  const k = (rec.key || '').toUpperCase()
  const idx = extra.findIndex(p => (p.key || p.jiraProjectKey || '').toUpperCase() === k)
  if (idx >= 0) extra[idx] = { ...extra[idx], ...rec, key: k }
  else extra.push({ ...rec, key: k })
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(extra, null, 2))
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
  const fields = ['summary', 'issuetype', 'status', 'assignee', 'reporter', 'labels', 'components', 'issuelinks', 'parent', 'created', 'updated', 'resolutiondate', F.sp, F.sprint].filter(Boolean)
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
  for (const h of issue.changelog?.histories || [])
    for (const it of h.items || [])
      if (it.field === 'status') changes.push({ at: Date.parse(h.created), from: it.fromString, to: it.toString, author: h.author ? { id: h.author.accountId, name: h.author.displayName } : null })
  changes.sort((a, b) => a.at - b.at)
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
  return { daysIn, delivery, firstInProg, liveAt, curStatus: cur, curSince, qaCycles: qaEntries, rework: reworkN + reopenN, fixer }
}

function num(v) { if (v == null) return 0; if (typeof v === 'number') return v; if (typeof v === 'object') return v.value ?? 0; return Number(v) || 0 }
function parseSprint(raw) {
  if (!raw) return null
  const arr = Array.isArray(raw) ? raw : [raw]
  const last = arr[arr.length - 1]
  if (!last) return null
  if (typeof last === 'object') return last.name ? { id: last.id ?? null, name: last.name, state: last.state || '' } : null
  const s = String(last)
  const name = (s.match(/name=([^,\]]+)/) || [])[1]
  const state = (s.match(/state=([^,\]]+)/) || [])[1]
  const id = (s.match(/id=(\d+)/) || [])[1]
  return name ? { id: id ? +id : null, name, state: state || '' } : null
}

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
  // assignee changelog → resolve dev/QA assignee by role in resolveRoles
  const assigneeHistory = []
  for (const h of issue.changelog?.histories || []) for (const it of h.items || []) if (it.field === 'assignee' && it.to) assigneeHistory.push({ id: it.to, name: it.toString || '' })
  if (assignee) assigneeHistory.push({ id: assignee.id, name: assignee.name })
  return {
    key: issue.key, project: cfg.key, host: cfg.jiraHost, type: f.issuetype?.name || 'Task', summary: f.summary, isBug, area,
    status, statusKind: kind, statusColor: colorFor(status), sprint: parseSprint(f[F.sprint]),
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

function fetchPRs(cfg) {
  const [owner, name] = cfg.githubRepo.split('/')
  if (!owner || !name) return []
  const q = `query($cur:String){repository(owner:"${owner}",name:"${name}"){pullRequests(first:50,after:$cur,orderBy:{field:UPDATED_AT,direction:DESC}){pageInfo{hasNextPage endCursor} nodes{number title headRefName state createdAt mergedAt closedAt additions deletions changedFiles author{login} assignees(first:5){nodes{login}} reviews(first:30){nodes{state author{login} submittedAt}} comments{totalCount} reviewThreads{totalCount} files(first:30){nodes{path additions deletions}}}}}}`
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
      prs.push({
        num: p.number, project: cfg.key, repo: cfg.githubRepo, ticket, title: p.title, branch: p.headRefName, state,
        author: p.author?.login || '', createdAt: p.createdAt, mergedAt: p.mergedAt, closedAt: p.closedAt,
        additions: p.additions, deletions: p.deletions, changedFiles: p.changedFiles,
        comments: (p.comments?.totalCount || 0) + (p.reviewThreads?.totalCount || 0),
        firstReviewDays: firstReview ? +workDays(created, firstReview).toFixed(2) : null,
        mergeDays: p.mergedAt ? +workDays(created, Date.parse(p.mergedAt)).toFixed(2) : null,
        openDays: +workDays(created, p.mergedAt ? Date.parse(p.mergedAt) : Date.now()).toFixed(1),
        cycles: 1 + changesReq, reviewers, assignees: (p.assignees?.nodes || []).map(a => a.login).filter(Boolean),
        files: (p.files.nodes || []).map(f => ({ path: f.path, add: f.additions, del: f.deletions })),
        reviewEvents: realReviews.map(r => ({ state: r.state, login: r.login, at: r.at })),
      })
    }
    if (!conn.pageInfo.hasNextPage) break
    cur = conn.pageInfo.endCursor
  }
  return prs
}

// ---------- snapshot (cached per project, TTL) ----------
const snaps = new Map() // key -> {at, data}
const SNAP_TTL = 2 * 3600_000 // cache the JIRA+GitHub aggregate for 2 hours
async function snapshot(cfg) {
  const hit = snaps.get(cfg.key)
  if (hit && Date.now() - hit.at < SNAP_TTL) return hit.data
  const prs = ghAvailable() ? safe(() => fetchPRs(cfg), []) : []
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
  const data = {
    available: true, team: projectPill(cfg), projects: projectList(),
    generatedAt: new Date().toISOString(), ghAvailable: prs.length > 0 || ghAvailable(),
    issues, prs, members, okrs: OKRS,
  }
  snaps.set(cfg.key, { at: Date.now(), data })
  return data
}
async function snapshotAll() {
  const projs = loadProjects()
  const parts = await Promise.all(projs.map(p => snapshot(p).catch(e => ({ available: false, error: e.message }))))
  const avail = parts.filter(p => p.available)
  if (!avail.length) { const e = new Error('no-jira-creds'); throw e }
  const issues = avail.flatMap(p => p.issues)
  const prs = avail.flatMap(p => p.prs)
  const mm = {}
  for (const p of avail) for (const m of p.members) { (mm[m.id] ||= { ...m, count: 0 }).count += m.count }
  const members = Object.values(mm).sort((a, b) => b.count - a.count)
  return {
    available: true, team: { key: 'all', name: 'All projects', jiraProjectKey: 'ALL', githubRepo: '' },
    projects: projectList(), generatedAt: new Date().toISOString(),
    ghAvailable: avail.some(p => p.ghAvailable), issues, prs, members, okrs: OKRS,
  }
}
function safe(fn, dflt) { try { return fn() } catch (e) { console.error('[eng]', e.message); return dflt } }

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
    const key = req.query.project
    try {
      if (key === 'all') return res.json(await snapshotAll())
      const projs = loadProjects()
      const cfg = projs.find(p => p.key === (key || '').toUpperCase()) || projs[0]
      res.json(await snapshot(cfg))
    } catch (e) {
      const projs = projectList()
      if (e.message === 'no-jira-creds') return res.json({ available: false, reason: 'no-jira-token', projects: projs, team: projs[0] })
      res.status(500).json({ available: false, error: e.message, projects: projs, team: projs[0] })
    }
  })
  app.post('/api/eng/refresh', async (req, res) => {
    const key = req.query.project
    try {
      if (key === 'all' || !key) snaps.clear()
      else snaps.delete((key || '').toUpperCase())
      if (key === 'all') return res.json(await snapshotAll())
      const projs = loadProjects()
      const cfg = projs.find(p => p.key === (key || '').toUpperCase()) || projs[0]
      res.json(await snapshot(cfg))
    } catch (e) { res.status(500).json({ error: e.message }) }
  })
}
