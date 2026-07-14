// ─────────────────────────────────────────────────────────────────────────────
// THE PLANE BOUNDARY. This file exists so that "team data" is structurally
// incapable of carrying "harness telemetry". Read this before editing it.
//
//   PLANE A (this file) = WORK ARTIFACTS: JIRA issues, GitHub PRs/reviews, CI runs.
//     Every fact here is one a teammate can already open about themselves in JIRA or
//     GitHub. Per-person OPERATIONAL facts are therefore allowed (who owns TRN-123,
//     whose review a PR is waiting on, what is parked). Per-person EVALUATIVE facts
//     are not: no composite score, no ranking, no sort-by-output — rows are ALPHABETICAL.
//
//   PLANE B (server.mjs / server-career.mjs / career-*.mjs / server-cursor.mjs) =
//     HARNESS TELEMETRY: transcripts, tokens, cost, session times, active hours,
//     ~/.claude. SELF-ONLY, FOREVER. There is no code path from this file to it:
//     server-team.mjs imports ONLY server-eng.mjs (Plane A) + node builtins. It never
//     reads ~/.claude, never accepts a user/machine parameter for telemetry, and every
//     response passes through guard() below, which THROWS on a Plane-B field name.
//
//   SYMMETRY RULE — a per-person view ships only if the subject can render the identical
//     view about themselves from the same UI. That is why rows are alphabetical, carry no
//     score, and hold no token/cost/hours/transcript field.
//
//   MIN-N — anything sustainability-shaped is TEAM-AGGREGATE ONLY: suppression at
//     MIN_N=5 contributors is applied HERE, in the endpoint, not in the UI. Below the
//     floor the endpoint returns null. There is no per-person row and no drilldown.
//
//   WRITES — gated on the project's `writes: true` flag. The default everywhere is a
//     copy-to-clipboard line a human sends. Never an auto-ping.
//
//   Enforced by test/team-privacy.test.js. If you make that test pass by weakening it,
//   you have deleted the only thing keeping this dashboard from being surveillance.
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import * as eng from './server-eng.mjs'   // ← the ONLY non-builtin import allowed in this file

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DAY = 864e5
const MIN_N = 5           // k-anonymity floor for any aggregate signal (item 15)
const OWNER_FLOOR = 10    // file-touches below which an "owner" is not a real owner (item 12)

// ---------- the guard: a Plane-B field can never leave this file ----------
// Key names that only ever exist on Plane B. A team payload carrying one of these is a bug,
// not a feature — so we fail loudly rather than ship it.
const PLANE_B = /token|cost|usd|price|spend|transcript|keystroke|\bxp\b|heatmap|session|activehours|afterhours|toolcalls|runningnow/i
export function guard(payload, where = 'team') {
  const walk = (v, at) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${at}[${i}]`))
    if (!v || typeof v !== 'object') return
    for (const [k, val] of Object.entries(v)) {
      if (PLANE_B.test(k)) throw new Error(`plane violation in ${where}: ${at}.${k} is a Plane-B (harness telemetry) field — it may never appear in a team payload`)
      walk(val, `${at}.${k}`)
    }
  }
  walk(payload, where)
  return payload
}
// Per-person rows carry an even tighter ban (symmetry rule): nothing about hours or effort.
const PERSON_B = /hour|xp|level|score|rank|streak|heatmap/i
export function guardPerson(rows, where = 'rows') {
  for (const r of rows || []) for (const k of Object.keys(r || {}))
    if (PERSON_B.test(k)) throw new Error(`symmetry violation in ${where}: per-person field "${k}" is an evaluative/telemetry field`)
  return rows
}

// ---------- Plane-A data access: server-eng.mjs, and nothing else ----------
// Prefer a named export; fall back to the already-mounted /api/eng/snapshot (same process,
// same 2h cache) so we never duplicate its JIRA/GitHub fetching.
const PORT = Number(process.env.DASH_PORT) || 5178
const api = async (p) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`); if (!r.ok) throw new Error(`${p} → ${r.status}`); return r.json() }
let memo = { at: 0, data: null }
export async function engSnapshot(force = false) {
  if (!force && memo.data && Date.now() - memo.at < 60_000) return memo.data
  const fn = eng.snapshotAll || eng.__eng?.snapshotAll   // prefer a named export once server-eng.mjs offers one
  let data
  if (fn) data = await fn()
  else {
    // Fall back to the mounted routes — same process, same 2h snapshot cache, so nothing is re-fetched.
    // Merged per project rather than via ?project=all, which is currently unstable for the AIR board.
    const projects = await api('/api/eng/projects')
    const parts = []
    for (const p of projects) { try { parts.push(await api(`/api/eng/snapshot?project=${p.key}`)) } catch (e) { console.error('[team]', p.key, e.message) } }
    const avail = parts.filter(p => p && p.available)
    if (!avail.length) throw new Error('no-jira-creds')
    const mm = {}
    for (const p of avail) for (const m of p.members || []) (mm[m.id] ||= { ...m, count: 0 }).count += m.count || 0
    data = { available: true, generatedAt: new Date().toISOString(), projects,
      issues: avail.flatMap(p => p.issues || []), prs: avail.flatMap(p => p.prs || []), members: Object.values(mm),
      // server-eng.mjs already computes these — carry them through rather than recomputing them here
      ci: avail.flatMap(p => p.ci || []),
      epics: avail.flatMap(p => p.epics || []),
      sprints: avail.flatMap(p => (p.sprints || []).map(s => ({ project: p.team?.key || null, ...s }))),
      load: avail.map(p => ({ project: p.team?.key || null, ...(p.load || {}) })).filter(l => Array.isArray(l.weeks)) }
  }
  if (data && data.available === false) throw new Error(data.reason || data.error || 'eng snapshot unavailable')
  // normalize the two shapes server-eng can hand us: its own snapshotAll keys `load` as one object and
  // omits `project` on sprints; the per-project merge above keys both by project.
  if (data.load && !Array.isArray(data.load)) data.load = [{ project: null, ...data.load }]
  if (Array.isArray(data.sprints)) data.sprints = data.sprints.map(s => ({ ...s, project: s.project || sprintTeam(s) }))
  memo = { at: Date.now(), data }
  return data
}
// sprint names are project-prefixed ("AIR-W21Y26"); fall back to that when the rollup omits the key
const sprintTeam = s => (String(s.name || '').match(/^([A-Z]{2,10})\b/) || [])[1] || null
const projectsCfg = () => { try { return JSON.parse(fs.readFileSync(path.join(HERE, 'projects.json'), 'utf8')) } catch { return null } }

// ---------- tiny stats ----------
const pct = (arr, p) => { if (!arr.length) return null; const a = [...arr].sort((x, y) => x - y); return +a[Math.min(a.length - 1, Math.floor(p / 100 * a.length))].toFixed(2) }
const byName = (a, b) => String(a.name || a.login || '').localeCompare(String(b.name || b.login || ''))
const weekKey = ts => { const d = new Date(ts); d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7)); const y0 = Date.UTC(d.getUTCFullYear(), 0, 1); return `${d.getUTCFullYear()}-W${String(Math.ceil(((d - y0) / DAY + 1) / 7)).padStart(2, '0')}` }
const jiraUrl = i => `https://${i.host}/browse/${i.key}`

// ═══ item 2 — team board: blocked & at-risk, grouped by person ═══════════════
// One row per engineer, ALPHABETICAL (never ranked). Tickets inside a row are sorted by
// how stuck they are — a ticket is not a person.
export function teamBoard(snap, { parkedDays = 3, wipMax = 4 } = {}) {
  const rows = new Map()
  for (const i of snap.issues || []) {
    const p = i.assignee
    if (!p || i.live) continue
    const r = rows.get(p.id) || { id: p.id, name: p.name, open: 0, wip: 0, atRisk: 0, oldestInCurrent: 0, tickets: [], flags: [] }
    r.open++
    if (i.active) r.wip++
    if (i.rec?.atRisk) r.atRisk++
    r.oldestInCurrent = Math.max(r.oldestInCurrent, i.inCurrent || 0)
    const parked = i.statusKind === 'wait' && (i.inCurrent || 0) > parkedDays
    r.tickets.push({
      key: i.key, project: i.project, summary: i.summary, status: i.status, statusKind: i.statusKind,
      inCurrent: i.inCurrent, atRisk: !!i.rec?.atRisk, parked, moveBy: i.rec?.moveBy || null,
      prNums: i.prNums || [], stale: !!i.stale, staleNote: i.staleNote || '', url: jiraUrl(i),
      nudge: `${i.key} (${i.summary || ''}) has been in "${i.status}" for ${i.inCurrent} working days${i.rec ? ` — budget was ${i.rec.budget}d` : ''}. What is blocking it?`,
    })
    rows.set(p.id, r)
  }
  const out = [...rows.values()]
  for (const r of out) {
    r.tickets.sort((a, b) => (b.atRisk - a.atRisk) || (b.inCurrent - a.inCurrent))
    r.blocked = r.tickets.filter(t => t.parked || t.atRisk).length
    if (r.wip > wipMax) r.flags.push(`WIP ${r.wip} > ${wipMax}`)
    if (r.tickets.some(t => t.parked)) r.flags.push(`parked > ${parkedDays}d`)
  }
  out.sort(byName)   // ALPHABETICAL — the symmetry rule. Do not "improve" this into a ranking.
  guardPerson(out, 'teamBoard')
  return { rows: out, parkedDays, wipMax, unassigned: (snap.issues || []).filter(i => !i.assignee && !i.live).length }
}

// ═══ item 3 — review flow: rot board + team queue + reviewer load ════════════
const OPEN_PR = p => p.state === 'Open' || p.state === 'Approved' || p.state === 'Changes requested'
export function reviewFlow(snap, { me = '', slaDays = 2, stuckDays = 3, loadDays = 30 } = {}) {
  const prs = (snap.prs || []).filter(OPEN_PR)
  const row = p => ({
    num: p.num, repo: p.repo, project: p.project, title: p.title, author: p.author, ticket: p.ticket, state: p.state,
    openDays: p.openDays, firstReviewDays: p.firstReviewDays, reviewers: p.reviewers || [],
    awaiting: (p.assignees || []).filter(a => !(p.reviewers || []).includes(a)),
    url: `https://github.com/${p.repo}/pull/${p.num}`,
    nudge: p.firstReviewDays == null
      ? `PR #${p.num} (${p.title}) has been open ${p.openDays} working days with no review yet. Could someone take a look?`
      : `PR #${p.num} (${p.title}) is in "${p.state}" after ${p.openDays} working days. What does it need to land?`,
  })
  const mine = me ? prs.filter(p => p.author === me).map(row).map(r => ({ ...r, red: r.firstReviewDays == null && r.openDays > slaDays })) : []
  const queue = prs.filter(p => (p.firstReviewDays == null && p.openDays > slaDays) || (p.state === 'Changes requested' && p.openDays > stuckDays))
    .map(row).sort((a, b) => b.openDays - a.openDays)   // PRs, not people — ranking a queue is fine

  // reviewer LOAD — alphabetical, no ranking. Concentration is the signal, not the person.
  const cutoff = Date.now() - loadDays * DAY
  const load = new Map()
  let total = 0
  for (const p of snap.prs || []) {
    const first = [...(p.reviewEvents || [])].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0]
    for (const ev of p.reviewEvents || []) {
      if (Date.parse(ev.at) < cutoff) continue
      const l = load.get(ev.login) || { login: ev.login, reviews: 0, prs: new Set(), firstReviewDaysSamples: [] }
      l.reviews++; l.prs.add(p.num)
      if (first && first.login === ev.login && p.firstReviewDays != null) l.firstReviewDaysSamples.push(p.firstReviewDays)
      load.set(ev.login, l); total++
    }
  }
  const openByReviewer = {}
  for (const p of prs) for (const r of new Set([...(p.reviewers || []), ...(p.assignees || [])])) openByReviewer[r] = (openByReviewer[r] || 0) + 1
  const rows = [...load.values()].map(l => ({
    login: l.login, reviews: l.reviews, prs: l.prs.size, openNow: openByReviewer[l.login] || 0,
    p50FirstReview: pct(l.firstReviewDaysSamples, 50), p90FirstReview: pct(l.firstReviewDaysSamples, 90),
  })).sort((a, b) => String(a.login).localeCompare(String(b.login)))   // ALPHABETICAL
  const shares = [...load.values()].map(l => l.reviews).sort((a, b) => b - a)
  const top1Share = total ? (shares[0] || 0) / total : 0
  const top2Share = total ? ((shares[0] || 0) + (shares[1] || 0)) / total : 0
  const roster = [...new Set((snap.projects || []).flatMap(p => p.dev || []))]
  const reviewed = new Set([...load.keys()])
  guardPerson(rows, 'reviewerLoad')
  return {
    slaDays, stuckDays, loadDays, mine, queue, load: rows,
    concentration: { top1Share: +top1Share.toFixed(2), top2Share: +top2Share.toFixed(2), flagged: top2Share > 0.6, totalReviews: total },
    neverReviewed: roster.filter(e => ![...reviewed].some(l => e.startsWith(l.toLowerCase()))).sort(),
  }
}

// ═══ item 5 — stage funnel + wait radar ══════════════════════════════════════
export function stageFunnel(snap, { since = Date.now() - 90 * DAY } = {}) {
  const closed = (snap.issues || []).filter(i => i.live && i.closedAt && Date.parse(i.closedAt) >= since)
  const dwell = {}, depth = {}
  for (const i of closed) for (const [st, d] of Object.entries(i.daysIn || {})) (dwell[st] ||= []).push(d)
  for (const i of snap.issues || []) if (!i.live) depth[i.status] = (depth[i.status] || 0) + 1
  const stages = Object.entries(dwell).map(([stage, d]) => ({
    stage, p50: pct(d, 50), p75: pct(d, 75), p90: pct(d, 90), n: d.length, depth: depth[stage] || 0,
  })).sort((a, b) => b.n - a.n)
  // daysIn keeps accruing into the TERMINAL status (a ticket live for a year has ~250 days in "Live"), so
  // summing it is not a lead time — it read p90 = 1676 days. server-eng already computes created→live.
  const lead = closed.map(i => i.leadDays).filter(v => v != null)
  // activeDays is null for a ticket that never entered an active status — an absent measurement. Coercing
  // it to 0 (the old `|| 0`) buried the real cycle time under a pile of fake zeros.
  const cycle = closed.map(i => i.activeDays).filter(v => v != null)
  const wait = closed.map(i => i.waitDays || 0)
  const p75By = Object.fromEntries(stages.map(s => [s.stage, s.p75]))
  // RADAR — tickets parked longer than the team's own p75 for THAT status
  const radar = (snap.issues || []).filter(i => !i.live && i.statusKind !== 'active' && p75By[i.status] != null && i.inCurrent > p75By[i.status])
    .map(i => ({
      key: i.key, project: i.project, summary: i.summary, status: i.status, inCurrent: i.inCurrent,
      p75: p75By[i.status], over: +(i.inCurrent - p75By[i.status]).toFixed(2),
      waitingOn: i.qaAssignee?.name || (i.prNums?.length ? `PR #${i.prNums[0]} review` : i.assignee?.name || 'unassigned'),
      url: jiraUrl(i),
      nudge: `${i.key} has sat in "${i.status}" for ${i.inCurrent} working days (team p75 is ${p75By[i.status]}d). Waiting on: ${i.qaAssignee?.name || (i.prNums?.length ? `review of PR #${i.prNums[0]}` : i.assignee?.name || 'nobody')}.`,
    })).sort((a, b) => b.over - a.over).slice(0, 100)
  // cross-team blockers — walks issues[].links (server-eng.mjs projects them as {key, dir, rel, status}).
  // A ticket is blocked when an INWARD link says so ("is blocked by" / "is caused by"). Cross-project only.
  const pairs = {}
  let linksAvailable = false
  const BLOCKED_BY = /blocked by|caused by|depends on/i
  for (const i of snap.issues || []) for (const l of i.links || []) {
    linksAvailable = true
    if (l.dir !== 'inward' || !BLOCKED_BY.test(l.rel || '')) continue
    const other = String(l.key || '').split('-')[0]
    if (!other || other === i.project) continue
    const k = `${i.project}←${other}`
    const p = (pairs[k] ||= { blocked: i.project, blocking: other, tickets: [], days: 0 })
    p.tickets.push(i.key); p.days += i.inCurrent || 0
  }
  const blockers = Object.values(pairs).map(p => ({ ...p, days: +p.days.toFixed(1), escalation: `${p.tickets.length} ${p.blocked} ticket(s) are blocked by ${p.blocking}: ${p.tickets.join(', ')} — ${p.days.toFixed(0)} working days burned waiting.` }))
  return {
    stages, radar, blockers,
    linksAvailable: linksAvailable || null,
    leadTime: { p50: pct(lead, 50), p90: pct(lead, 90) },
    cycleTime: { p50: pct(cycle, 50), p90: pct(cycle, 90) },
    queueWait: { p50: pct(wait, 50), p90: pct(wait, 90) },
    n: closed.length,
  }
}

// ═══ item 6 — work-class effort mix, per team, QoQ ═══════════════════════════
const DEFAULT_BUCKETS = {
  bug: { types: ['bug', 'defect'], labels: [] },
  ktlo: { types: ['support', 'incident', 'ops'], labels: ['ktlo', 'ops', 'support', 'maintenance'] },
  debt: { types: [], labels: ['tech-debt', 'techdebt', 'debt', 'refactor'] },
  feature: { types: [], labels: [] },  // the default class
}
const quarterOf = ts => { const d = new Date(ts); return `${d.getUTCFullYear()}Q${Math.floor(d.getUTCMonth() / 3) + 1}` }
export function effortMix(snap, buckets = DEFAULT_BUCKETS) {
  const classOf = i => {
    const t = (i.type || '').toLowerCase(), labels = (i.labels || []).map(s => String(s).toLowerCase())
    if (i.isBug || buckets.bug.types.some(x => t.includes(x))) return 'bug'
    for (const cls of ['ktlo', 'debt']) {
      const b = buckets[cls] || { types: [], labels: [] }
      if (b.types.some(x => t.includes(x)) || labels.some(l => b.labels.includes(l))) return cls
    }
    return 'feature'
  }
  const cells = {}   // team -> quarter -> class -> {days, pts, keys[]}
  for (const i of snap.issues || []) {
    const when = i.closedAt || i.created
    if (!when) continue
    const q = quarterOf(Date.parse(when))
    const cls = classOf(i)
    const t = (cells[i.project] ||= {}), c = (t[q] ||= {})
    const cell = (c[cls] ||= { days: 0, pts: 0, tickets: [] })
    cell.days += i.activeDays || 0; cell.pts += i.pts || 0
    cell.tickets.push({ key: i.key, summary: i.summary, activeDays: i.activeDays, url: jiraUrl(i) })
  }
  const teams = Object.entries(cells).map(([team, qs]) => ({
    team,
    quarters: Object.entries(qs).sort((a, b) => a[0] < b[0] ? -1 : 1).map(([quarter, classes]) => {
      const days = Object.fromEntries(Object.entries(classes).map(([k, v]) => [k, +v.days.toFixed(1)]))
      const pts = Object.fromEntries(Object.entries(classes).map(([k, v]) => [k, v.pts]))
      const tot = Object.values(days).reduce((a, b) => a + b, 0)
      const share = Object.fromEntries(Object.entries(days).map(([k, v]) => [k, tot ? +(v / tot).toFixed(3) : 0]))
      for (const c of Object.values(classes)) c.tickets.sort((a, b) => (b.activeDays || 0) - (a.activeDays || 0))
      return { quarter, days, pts, share, totalDays: +tot.toFixed(1), tickets: Object.fromEntries(Object.entries(classes).map(([k, v]) => [k, v.tickets.slice(0, 25)])) }
    }),
  })).sort((a, b) => a.team.localeCompare(b.team))
  // headline: bug tax this quarter vs prior, per team
  const headlines = teams.map(t => {
    const qs = t.quarters, cur = qs[qs.length - 1], prev = qs[qs.length - 2]
    if (!cur) return null
    const c = Math.round((cur.share.bug || 0) * 100), p = prev ? Math.round((prev.share.bug || 0) * 100) : null
    return { team: t.team, quarter: cur.quarter, bugTaxPct: c, priorBugTaxPct: p, deltaPct: p == null ? null : c - p,
      line: `${t.team}: bug tax = ${c}% of capacity in ${cur.quarter}${p == null ? '' : `, ${c >= p ? 'up' : 'down'} from ${p}%`}.` }
  }).filter(Boolean)
  return { teams, headlines, buckets }
}

// ═══ item 7 — delivery commitments ═══════════════════════════════════════════
export function commitments(snap, { sprintHistory = 6, throughputWeeks = 6 } = {}) {
  // server-eng.mjs already replays the Sprint changelog (snap.sprints: committed / added / delivered /
  // carriedOver / sayDoPct) and rolls up epics (snap.epics: forecastDate / slipDays / risk). Consume
  // them. The blocks below are the fallback for a snapshot that predates those fields.
  if (snap.sprints?.length || snap.epics?.length) return commitmentsFromEng(snap, { sprintHistory })
  // (a) PREDICTABILITY — per team per sprint (fallback: current sprint field only, no changelog).
  const bySprint = new Map()
  for (const i of snap.issues || []) {
    if (!i.sprint?.name) continue
    const k = i.project + '§' + i.sprint.name
    const s = bySprint.get(k) || { team: i.project, sprint: i.sprint.name, state: i.sprint.state || '', inSprint: 0, completed: 0, carried: 0, pts: 0, ptsDone: 0, added: null }
    s.inSprint++; s.pts += i.pts || 0
    if (i.live) { s.completed++; s.ptsDone += i.pts || 0 } else s.carried++
    bySprint.set(k, s)
  }
  const sprints = [...bySprint.values()].map(s => ({ ...s, completionRatio: s.inSprint ? +(s.completed / s.inSprint).toFixed(2) : null }))
  const teams = [...new Set(sprints.map(s => s.team))].sort()
  const predictability = teams.map(team => {
    const rows = sprints.filter(s => s.team === team).slice(-sprintHistory)
    const rs = rows.map(r => r.completionRatio).filter(v => v != null)
    const mean = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null
    const band = rs.length ? Math.round((Math.max(...rs) - Math.min(...rs)) * 100) : null
    return { team, sprints: rows, meanCompletion: mean == null ? null : +mean.toFixed(2), bandPts: band, red: band != null && band > 25,
      line: mean == null ? `${team}: no sprint data.` : `${team}: mean sprint completion ${Math.round(mean * 100)}% over ${rs.length} sprints, spread ±${band} pts${band > 25 ? ' — unpredictable' : ''}.` }
  })
  // (b) EPIC FORECAST — remaining children ÷ trailing throughput of that epic's children
  const epics = new Map()
  const cutoff = Date.now() - throughputWeeks * 7 * DAY
  for (const i of snap.issues || []) {
    if (!i.parent?.key) continue
    const e = epics.get(i.parent.key) || { key: i.parent.key, summary: i.parent.summary, team: i.project, total: 0, done: 0, remaining: 0, doneRecent: 0, children: [] }
    e.total++
    if (i.live) { e.done++; if (i.closedAt && Date.parse(i.closedAt) >= cutoff) e.doneRecent++ }
    else { e.remaining++; e.children.push({ key: i.key, status: i.status, inCurrent: i.inCurrent, assignee: i.assignee?.name || null, url: jiraUrl(i) }) }
    epics.set(i.parent.key, e)
  }
  const forecasts = [...epics.values()].filter(e => e.remaining > 0).map(e => {
    const perWeek = e.doneRecent / throughputWeeks
    const weeks = perWeek > 0 ? e.remaining / perWeek : null
    const forecast = weeks == null ? null : new Date(Date.now() + weeks * 7 * DAY).toISOString().slice(0, 10)
    e.children.sort((a, b) => (b.inCurrent || 0) - (a.inCurrent || 0))
    return { key: e.key, summary: e.summary, team: e.team, total: e.total, done: e.done, remaining: e.remaining,
      throughputPerWeek: +perWeek.toFixed(2), forecastWeeks: weeks == null ? null : +weeks.toFixed(1), forecastDate: forecast,
      reason: weeks == null ? 'no children closed in the trailing window — no forecast possible' : `${e.remaining} children left at ${perWeek.toFixed(1)}/week`,
      children: e.children.slice(0, 20),
      stakeholderUpdate: `${e.key} (${e.summary || ''}): ${e.done}/${e.total} done. ${weeks == null ? 'No throughput in the last ' + throughputWeeks + ' weeks — this epic is not moving.' : `Forecast ${forecast} at the current rate (${perWeek.toFixed(1)} children/week).`} Top blocker: ${e.children[0]?.key || '—'} parked in "${e.children[0]?.status || '—'}" ${e.children[0]?.inCurrent || 0}d.` }
  }).sort((a, b) => (b.remaining - a.remaining))
  // (c) SCOPE LEDGER — chronological commitment-affecting events. Needs the non-status changelog items
  // (Sprint / Story Points / parent) that server-eng.mjs does not project today. Reopens ARE available.
  const ledger = (snap.issues || []).filter(i => (i.rework || 0) > 0 || (i.qaCycles || 0) >= 3).map(i => ({
    at: i.closedAt || i.curSince, key: i.key, team: i.project, summary: i.summary,
    event: (i.rework || 0) > 0 ? 're-entered In Progress / reopened' : 'QA bounced ≥3×',
    delta: (i.rework || 0) > 0 ? `${i.rework}× rework` : `${i.qaCycles} QA cycles`,
    url: jiraUrl(i),
  })).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 50)
  return { predictability, forecasts, ledger, ledgerPartial: true,
    note: 'added-mid-sprint and points-inflation rows require Sprint/Story-Point changelog items from server-eng.mjs (statusSegments keeps field==="status" only); rework/QA-bounce events are complete.' }
}

// The real thing: predictability + epic forecast + scope ledger, straight off server-eng.mjs's own
// changelog replay. Nothing is recomputed — this only reshapes it and attaches the copyable lines.
function commitmentsFromEng(snap, { sprintHistory = 6 } = {}) {
  // server-eng.mjs attributes every sprint to the project of the issues in it. A sprint with no project is
  // a data bug upstream — drop it. NEVER invent a team called "all" out of an unparseable sprint name.
  const teamOf = s => s.project || null
  const teams = [...new Set((snap.sprints || []).map(teamOf).filter(Boolean))].sort()
  const predictability = teams.map(team => {
    const rows = (snap.sprints || []).filter(s => teamOf(s) === team)
      .sort((a, b) => Date.parse(a.startDate || 0) - Date.parse(b.startDate || 0)).slice(-sprintHistory)
    const rs = rows.map(r => r.sayDoPct).filter(v => v != null)
    // MEDIAN, not mean: say/do is a ratio over a tiny, wildly varying pointed base (most tickets carry no
    // story points), so one thin sprint owns the mean. bandPts/bandPp is a spread of PERCENTAGES —
    // percentage points, never story points. It was being printed as "±2879 pts", which is not a unit.
    const mid = pct(rs, 50)
    const mean = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null
    const band = rs.length ? Math.round(Math.max(...rs) - Math.min(...rs)) : null
    const pointed = rows.reduce((a, s) => a + (s.committedPointed || 0), 0)
    const cnt = pct(rows.map(r => r.sayDoCountPct).filter(v => v != null), 50)
    return { team, sprints: rows.map(s => ({ sprint: s.name, state: s.state, startDate: s.startDate, endDate: s.endDate,
      committed: s.committed, committedPts: s.committedPts, committedPointed: s.committedPointed, added: s.added, addedPts: s.addedPts,
      delivered: s.delivered, deliveredPts: s.deliveredPts, addedDelivered: s.addedDelivered, shipped: s.shipped, shippedPts: s.shippedPts,
      carriedOver: s.carriedOver, preDone: s.preDone,
      injectionPct: s.injectionPct, sayDoPct: s.sayDoPct, sayDoCountPct: s.sayDoCountPct, keys: s.keys })),
      medianSayDoPct: mid == null ? null : Math.round(mid), medianSayDoCountPct: cnt == null ? null : Math.round(cnt),
      n: rs.length, pointedTickets: pointed,
      meanSayDoPct: mean == null ? null : Math.round(mean),   // kept for the committed UI contract — do not read it for a review
      bandPts: band, bandPp: band, red: band != null && band > 25,
      line: mid != null
        ? `${team}: median say/do ${Math.round(mid)}% of committed points over n=${rs.length} sprints (${pointed} pointed tickets)` +
          `${cnt == null ? '' : `, ${Math.round(cnt)}% by ticket count`}, spread ${band}pp${band > 25 ? ' — unpredictable' : ''}.`
        // a sprint with no pointed ticket has no points-based say/do — say that, rather than "no history"
        : cnt != null ? `${team}: no story points on any committed ticket in ${rows.length} sprint(s) — say/do by ticket count is ${Math.round(cnt)}%.`
        : `${team}: no sprint history yet.` }
  })
  const forecasts = (snap.epics || []).map(e => ({
    key: e.key, summary: e.summary, team: e.project, url: e.url, total: e.total, done: e.done, pctComplete: e.pctComplete,
    ptsRemaining: e.ptsRemaining, velocityPtsPerDay: e.velocityPtsPerDay, forecastDate: e.forecastDate,
    targetDate: e.targetDate, slipDays: e.slipDays, risk: e.risk, escapedBugs: e.escapedBugs,
    stakeholderUpdate: `${e.key} (${e.summary || ''}): ${e.pctComplete}% complete (${e.done}/${e.total}).` +
      (e.forecastDate ? ` Forecast ${String(e.forecastDate).slice(0, 10)}${e.targetDate ? ` vs committed ${String(e.targetDate).slice(0, 10)}` : ''}${e.slipDays ? ` — ${e.slipDays}d slip` : ''}.` : ' No velocity in the window — this epic is not moving.'),
  })).sort((a, b) => (b.slipDays || 0) - (a.slipDays || 0))
  // SCOPE LEDGER — every commitment-affecting event server-eng can evidence: scope added mid-sprint,
  // carried over, plus reopen/QA-bounce rework.
  const ledger = []
  for (const s of snap.sprints || []) {
    for (const k of s.keys?.added || []) ledger.push({ at: s.startDate, key: k, team: teamOf(s), event: 'added to sprint after it started', delta: `+1 into ${s.name}`, sprint: s.name })
    for (const k of s.keys?.carriedOver || []) ledger.push({ at: s.endDate || s.startDate, key: k, team: teamOf(s), event: 'carried over', delta: `did not land in ${s.name}`, sprint: s.name })
  }
  for (const i of snap.issues || []) if ((i.rework || 0) > 0 || (i.qaCycles || 0) >= 3)
    ledger.push({ at: i.closedAt || i.curSince, key: i.key, team: i.project, summary: i.summary,
      event: (i.rework || 0) > 0 ? 're-entered In Progress / reopened' : 'QA bounced ≥3×',
      delta: (i.rework || 0) > 0 ? `${i.rework}× rework` : `${i.qaCycles} QA cycles`, url: jiraUrl(i) })
  ledger.sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0))
  return { predictability, forecasts, ledger: ledger.slice(0, 80), ledgerPartial: false, source: 'server-eng sprint/epic rollup' }
}

// ═══ item 12 — ownership / bus factor ════════════════════════════════════════
const areaOf = f => { const s = String(f).split('/'); return s.length > 1 ? s[0] : '(root)' }
export function ownership(snap, { floor = OWNER_FLOOR, since = Date.now() - 90 * DAY } = {}) {
  const areas = new Map()
  for (const p of snap.prs || []) {
    if (!p.author || Date.parse(p.createdAt) < since) continue
    for (const f of p.files || []) {
      const a = areas.get(areaOf(f.path)) || { area: areaOf(f.path), touches: 0, by: {} }
      a.touches++; a.by[p.author] = (a.by[p.author] || 0) + 1
      areas.set(areaOf(f.path), a)
    }
  }
  const rows = [...areas.values()].map(a => {
    const owners = Object.entries(a.by).map(([login, touches]) => ({ login, touches }))
      .sort((x, y) => x.login.localeCompare(y.login))   // ALPHABETICAL — not a leaderboard
    const real = owners.filter(o => o.touches >= floor)
    return { area: a.area, touches: a.touches, contributors: owners.length, owners,
      busFactor: real.length, soleOwner: real.length === 1 ? real[0].login : null,
      risk: real.length === 1 ? 'single-owner' : real.length === 0 ? 'no-real-owner' : null }
  }).sort((a, b) => a.area.localeCompare(b.area))
  const people = [...new Set((snap.prs || []).map(p => p.author).filter(Boolean))].sort()
  const matrix = rows.map(r => ({ area: r.area, cells: Object.fromEntries(people.map(l => [l, r.owners.find(o => o.login === l)?.touches || 0])) }))
  const risks = rows.filter(r => r.risk === 'single-owner').map(r => ({
    area: r.area, owner: r.soleOwner, touches: r.touches,
    proposal: `Pair a second engineer into "${r.area}" — ${r.soleOwner} is currently its only contributor above ${floor} file-touches in 90d.` }))
  return { rows, people, matrix, floor, risks }
}

// ═══ item 14 — CI health ═════════════════════════════════════════════════════
// Pure over gh output so it is testable without gh. runs = [{id, headSha, conclusion, status, name, createdAt, updatedAt, url}]
export function ciFrom(runs = [], { days = 30 } = {}) {
  const since = Date.now() - days * DAY
  const rs = runs.filter(r => Date.parse(r.createdAt) >= since)
  const done = rs.filter(r => r.conclusion)
  const failed = done.filter(r => r.conclusion === 'failure')
  const bySha = {}
  for (const r of done) (bySha[r.headSha] ||= []).push(r)
  const flakyShas = Object.entries(bySha).filter(([, v]) => v.some(r => r.conclusion === 'failure') && v.some(r => r.conclusion === 'success'))
  const flakyJobs = {}
  for (const [, v] of flakyShas) for (const r of v) if (r.conclusion === 'failure') flakyJobs[r.name] = (flakyJobs[r.name] || 0) + 1
  const latest = [...rs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] || null
  // time-to-green after a red main
  const chron = [...done].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
  const greens = []
  for (let i = 0; i < chron.length; i++) if (chron[i].conclusion === 'failure') {
    const g = chron.slice(i + 1).find(r => r.conclusion === 'success')
    if (g) greens.push((Date.parse(g.updatedAt || g.createdAt) - Date.parse(chron[i].createdAt)) / 3600e3)
  }
  return {
    runs: rs.length, red: latest?.conclusion === 'failure', latest: latest && { id: latest.id, name: latest.name, conclusion: latest.conclusion, url: latest.url, at: latest.createdAt },
    failureRate: done.length ? +(failed.length / done.length).toFixed(3) : null,
    flakeRate: done.length ? +(flakyShas.length / Object.keys(bySha).length).toFixed(3) : null,
    medianHoursToGreen: pct(greens, 50),
    flaky: Object.entries(flakyJobs).map(([job, fails]) => ({ job, fails })).sort((a, b) => b.fails - a.fails).slice(0, 5),
    days,
  }
}
function ghRuns(repo) {
  const r = spawnSync('gh', ['run', 'list', '--repo', repo, '--branch', 'main', '--json', 'databaseId,headSha,conclusion,status,workflowName,createdAt,updatedAt,url', '--limit', '100'], { timeout: 45000, maxBuffer: 32 * 1024 * 1024 })
  if (r.status !== 0) throw new Error((r.stderr || '').toString().slice(0, 160))
  return JSON.parse(r.stdout.toString()).map(x => ({ id: x.databaseId, headSha: x.headSha, conclusion: x.conclusion, status: x.status, name: x.workflowName, createdAt: x.createdAt, updatedAt: x.updatedAt, url: x.url }))
}

// ═══ item 15 — sustainability early-warning (TEAM-AGGREGATE ONLY, min-N=5) ════
// Sourced ONLY from PR createdAt/mergedAt + JIRA `active` counts. Never keystrokes, never
// transcripts, never session times. Below MIN_N contributors the endpoint returns null — there
// is no per-person row to drill into, by construction.
const KSA = 3 * 3600e3
const outsideHours = ts => {
  const d = new Date(Date.parse(ts) + KSA)
  const dow = d.getUTCDay(), h = d.getUTCHours()
  return { weekend: dow === 5 || dow === 6, outside: h < 8 || h >= 19 }
}
export function sustainability(snap, { weeks = 12, minN = MIN_N, team = null } = {}) {
  // server-eng.mjs already buckets PR timestamps into weekly off-hours/weekend shares under the same
  // min-N=5 floor (snap.load). Consume it when present; re-apply the floor here anyway (defence in depth
  // — this endpoint owns the guarantee, and it must hold even if an upstream ever relaxes).
  const loads = Array.isArray(snap.load) ? snap.load : snap.load ? [{ project: null, ...snap.load }] : []
  const eng = loads.filter(l => !team || l.project === team || l.project == null)
  if (eng.length && eng.some(l => Array.isArray(l.weeks))) {
    const merged = new Map()
    for (const l of eng) for (const w of l.weeks || []) {
      const m = merged.get(w.week) || { week: w.week, contributors: 0, events: 0, outside: 0, weekend: 0 }
      m.contributors += w.contributors || 0
      if (!w.suppressed) { m.events += w.prs || 0; m.outside += (w.offHoursPct || 0) * (w.prs || 0); m.weekend += (w.weekendPct || 0) * (w.prs || 0) }
      merged.set(w.week, m)
    }
    const rows = [...merged.values()].sort((a, b) => a.week < b.week ? -1 : 1).map(m => {
      const suppressed = m.contributors < minN || !m.events
      return { week: m.week, contributors: m.contributors, suppressed,
        events: suppressed ? null : m.events,
        outsideHoursShare: suppressed ? null : +(m.outside / m.events).toFixed(3),
        weekendShare: suppressed ? null : +(m.weekend / m.events).toFixed(3) }
    })
    const live = rows.filter(r => !r.suppressed)
    const wipCounts = {}
    for (const i of snap.issues || []) if (i.active && i.assignee && (!team || i.project === team)) wipCounts[i.assignee.id] = (wipCounts[i.assignee.id] || 0) + 1
    const wipMedian = pct(Object.values(wipCounts), 50)
    const recent = live.slice(-2), base = live.slice(0, -2)
    const avg = a => a.length ? a.reduce((s, r) => s + (r.outsideHoursShare || 0), 0) / a.length : 0
    const firing = recent.length === 2 && recent.every(r => r.outsideHoursShare > Math.max(0.15, avg(base) * 1.5)) && (wipMedian || 0) > 4
    if (!live.length) return { available: false, suppressed: true, minN, contributors: Math.max(0, ...rows.map(r => r.contributors)), weeks: null,
      reason: `min-N suppression: every week in the window had fewer than ${minN} contributing engineers. This endpoint cannot produce a per-person breakdown.` }
    return { available: true, suppressed: false, minN, team, weeks: rows, contributors: Math.max(...rows.map(r => r.contributors)),
      teamWipMedian: wipMedian, firing, source: 'server-eng load rollup (PR timestamps)',
      note: 'Team aggregate, sourced from PR timestamps and JIRA WIP. This is an intervention prompt, not a performance signal. There is no per-person view and no drilldown — the endpoint cannot produce one.',
      opener: firing ? 'The team has been landing an unusual share of PRs outside working hours for two weeks running while WIP sits above 4. Worth asking what is forcing the overflow — scope, a review bottleneck, or a deadline nobody renegotiated.' : null }
  }
  const since = Date.now() - weeks * 7 * DAY
  const prs = (snap.prs || []).filter(p => Date.parse(p.createdAt) >= since && (!team || p.project === team))
  const contributors = new Set(prs.map(p => p.author).filter(Boolean))
  if (contributors.size < minN)
    return { available: false, suppressed: true, minN, contributors: contributors.size, weeks: null,
      reason: `min-N suppression: ${contributors.size} contributors < ${minN}. This endpoint cannot produce a per-person breakdown.` }
  const bw = new Map()
  for (const p of prs) {
    const evs = [{ at: p.createdAt }, ...(p.mergedAt ? [{ at: p.mergedAt }] : [])]
    for (const e of evs) {
      const k = weekKey(Date.parse(e.at))
      const w = bw.get(k) || { week: k, events: 0, outside: 0, weekend: 0, authors: new Set() }
      const f = outsideHours(e.at)
      w.events++; if (f.outside) w.outside++; if (f.weekend) w.weekend++
      if (p.author) w.authors.add(p.author)
      bw.set(k, w)
    }
  }
  // team WIP median — a distribution over anonymous counts, never a per-person row
  const wipCounts = {}
  for (const i of snap.issues || []) if (i.active && i.assignee && (!team || i.project === team)) wipCounts[i.assignee.id] = (wipCounts[i.assignee.id] || 0) + 1
  const wipMedian = pct(Object.values(wipCounts), 50)
  const rows = [...bw.values()].sort((a, b) => a.week < b.week ? -1 : 1).map(w => {
    const suppressed = w.authors.size < minN
    return { week: w.week, contributors: w.authors.size,
      events: suppressed ? null : w.events,
      outsideHoursShare: suppressed ? null : +(w.outside / w.events).toFixed(3),
      weekendShare: suppressed ? null : +(w.weekend / w.events).toFixed(3),
      suppressed }
  })
  const live = rows.filter(r => !r.suppressed)
  const recent = live.slice(-2)
  const base = live.slice(0, -2)
  const avg = (a, k) => a.length ? a.reduce((s, r) => s + (r[k] || 0), 0) / a.length : 0
  const firing = recent.length === 2
    && recent.every(r => r.outsideHoursShare > Math.max(0.15, avg(base, 'outsideHoursShare') * 1.5))
    && (wipMedian || 0) > 4
  return {
    available: true, suppressed: false, minN, team, weeks: rows, contributors: contributors.size,
    teamWipMedian: wipMedian, firing,
    note: 'Team aggregate, sourced from PR timestamps and JIRA WIP. This is an intervention prompt, not a performance signal. There is no per-person view and no drilldown — the endpoint cannot produce one.',
    opener: firing ? `The team has been landing an unusual share of PRs outside 08:00–19:00 for two weeks running while WIP sits above 4. Worth asking the team what is forcing the overflow — a scope problem, a review bottleneck, or a deadline nobody renegotiated.` : null,
  }
}

// ---------- routes ----------
const ok = (res, payload, where) => { try { res.json(guard(payload, where)) } catch (e) { res.status(500).json({ error: e.message }) } }
const fail = (res, e) => res.status(e.message === 'no-jira-creds' ? 200 : 500).json({ available: false, error: e.message })

export default function mountTeam(app) {
  app.get('/api/team/board', async (req, res) => {
    try { const s = await engSnapshot(); ok(res, { generatedAt: s.generatedAt, ...teamBoard(s) }, 'board') } catch (e) { fail(res, e) }
  })
  app.get('/api/team/review-flow', async (req, res) => {
    try { const s = await engSnapshot(); ok(res, { generatedAt: s.generatedAt, ...reviewFlow(s, { me: String(req.query.me || '') }) }, 'review-flow') } catch (e) { fail(res, e) }
  })
  app.get('/api/team/funnel', async (req, res) => {
    try { const s = await engSnapshot(); const days = Number(req.query.days) || 90; ok(res, { generatedAt: s.generatedAt, days, ...stageFunnel(s, { since: Date.now() - days * DAY }) }, 'funnel') } catch (e) { fail(res, e) }
  })
  app.get('/api/team/effort', async (req, res) => {
    try { const s = await engSnapshot(); const b = projectsCfg()?.effortBuckets; ok(res, { generatedAt: s.generatedAt, ...effortMix(s, b ? { ...DEFAULT_BUCKETS, ...b } : DEFAULT_BUCKETS) }, 'effort') } catch (e) { fail(res, e) }
  })
  app.get('/api/team/commitments', async (req, res) => {
    try { const s = await engSnapshot(); ok(res, { generatedAt: s.generatedAt, ...commitments(s) }, 'commitments') } catch (e) { fail(res, e) }
  })
  app.get('/api/team/ownership', async (req, res) => {
    try { const s = await engSnapshot(); ok(res, { generatedAt: s.generatedAt, ...ownership(s) }, 'ownership') } catch (e) { fail(res, e) }
  })
  app.get('/api/team/sustainability', async (req, res) => {
    try { const s = await engSnapshot(); ok(res, { generatedAt: s.generatedAt, ...sustainability(s, { team: req.query.team || null }) }, 'sustainability') } catch (e) { fail(res, e) }
  })
  app.get('/api/team/ci', async (req, res) => {
    try {
      const s = await engSnapshot()
      const days = Number(req.query.days) || 30
      let out
      if ((s.ci || []).length) {   // server-eng.mjs already fetched the runs — do not fetch them twice
        out = s.ci.map(c => ({ repo: c.repo, project: c.project, branch: c.branch,
          ...ciFrom((c.runs || []).map(r => ({ id: r.id, headSha: r.sha, conclusion: r.conclusion, status: r.status, name: r.name, createdAt: r.at, updatedAt: r.done || r.at, url: r.url })), { days }) }))
      } else {
        const repos = [...new Set((s.projects || []).map(p => p.githubRepo).filter(Boolean))]
        out = repos.map(repo => { try { return { repo, ...ciFrom(ghRuns(repo), { days }) } } catch (e) { return { repo, available: false, error: e.message } } })
      }
      ok(res, { generatedAt: s.generatedAt, repos: out, anyRed: out.some(r => r.red) }, 'ci')
    } catch (e) { fail(res, e) }
  })
  // WRITES (item 3). Default is the clipboard line. gh only fires when the project sets writes:true.
  const writable = (s, repo) => (projectsCfg()?.projects || []).some(p => p.writes === true && p.githubRepo === repo)
  app.post('/api/team/pr/:num/request-review', async (req, res) => {
    const { repo, reviewer } = req.body || {}
    const line = `@${reviewer} could you take ${repo}#${req.params.num}?`
    if (!repo || !reviewer) return res.status(400).json({ error: 'repo and reviewer required' })
    try {
      const s = await engSnapshot()
      if (!writable(s, repo)) return res.json({ ok: false, sent: false, copy: line, reason: 'writes disabled for this project — copy the line and send it yourself' })
      const r = spawnSync('gh', ['pr', 'edit', String(req.params.num), '--repo', repo, '--add-reviewer', reviewer], { timeout: 30000 })
      if (r.status !== 0) throw new Error((r.stderr || '').toString().slice(0, 160))
      res.json({ ok: true, sent: true, copy: line })
    } catch (e) { res.status(500).json({ error: e.message, copy: line }) }
  })
  app.post('/api/team/pr/:num/comment', async (req, res) => {
    const { repo, body } = req.body || {}
    if (!repo || !body) return res.status(400).json({ error: 'repo and body required' })
    try {
      const s = await engSnapshot()
      if (!writable(s, repo)) return res.json({ ok: false, sent: false, copy: body, reason: 'writes disabled for this project — copy the nudge and send it yourself' })
      const r = spawnSync('gh', ['pr', 'comment', String(req.params.num), '--repo', repo, '--body', body], { timeout: 30000 })
      if (r.status !== 0) throw new Error((r.stderr || '').toString().slice(0, 160))
      res.json({ ok: true, sent: true, copy: body })
    } catch (e) { res.status(500).json({ error: e.message, copy: body }) }
  })
}
