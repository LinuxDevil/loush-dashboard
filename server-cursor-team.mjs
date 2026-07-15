// The team plane — PLANE A. See the plane rule at the top of server-cursor.mjs.
//
// This is the ONLY module in the Cursor dashboard allowed to serve multi-person data, and it is a
// deliberate, bounded exception: it reads the Cursor Admin API, which is ORG BILLING DATA the admin
// already sees in the billing console, plus the roster server-eng.mjs already holds in projects.json.
//
// WHAT IT MAY EMIT PER EMAIL — exactly three administrative facts a manager legitimately owns:
//     1. seat assigned (since / role / active)      2. client version      3. spend-to-date
//
// WHAT IT MAY NEVER EMIT PER EMAIL — enforced below in scrub(), not in the UI:
//     accept rate, AI/committed lines, session counts, prompt content, session times, hour-of-day,
//     latency, weekend activity, or any composite score. Every behavioral number is aggregated to
//     TEAM level behind a k>=5 floor BEFORE it leaves this process. The route physically cannot
//     return a per-email behavioral row, so no future UI change can leak one.
//
// IT IS NEVER JOINED TO PLANE B. Nothing in this file reads state.vscdb. There is no import of the
// local snapshot here, and there must not be one — that join is the thing the whole design forbids.
//
// No admin key => {available:false, reason:'not-configured'}. Never a fake zero.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const API = 'https://api.cursor.com'
const K = 5 // the k-anonymity floor. Below this, a cell renders "—" and the count is stated.

// admin key, read exactly the way server-eng.mjs reads the JIRA token. READ ONLY — we never write it.
function adminKey() {
  if (process.env.CURSOR_ADMIN_KEY) return process.env.CURSOR_ADMIN_KEY
  for (const file of ['.eng.local.json', 'config.json']) {
    try {
      const f = JSON.parse(fs.readFileSync(path.join(HERE, file), 'utf8'))
      const k = f.cursorAdminKey || f.cursorApiKey || f.cursorAdminApiKey
      if (k) return k
    } catch {}
  }
  return null
}
// roster server-eng.mjs already holds — used only to answer "seat but no team" / "team but no seat"
function roster() {
  const emails = new Set()
  try {
    const j = JSON.parse(fs.readFileSync(path.join(HERE, 'projects.json'), 'utf8'))
    for (const p of (Array.isArray(j) ? j : j.projects || []))
      for (const e of [...(p.devEmails || []), ...(p.qaEmails || []), ...(p.productEmails || [])]) emails.add(e.toLowerCase())
  } catch {}
  return emails
}

async function api(key, route, body) {
  const auth = 'Basic ' + Buffer.from(key + ':').toString('base64')
  const r = await fetch(API + route, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!r.ok) throw new Error(`cursor admin ${route}: ${r.status} ${(await r.text()).slice(0, 160)}`)
  return r.json()
}

// THE ENFORCEMENT POINT. Every per-email row leaving this module goes through here. If a field is not
// on this list it does not ship, no matter what the Admin API returned.
const ADMIN_FACTS = ['email', 'name', 'role', 'seatAssignedAt', 'clientVersion', 'spendCents', 'active']
const scrub = row => Object.fromEntries(ADMIN_FACTS.map(f => [f, row[f] ?? null]))
// k>=5 floor: an aggregate over fewer than K people is not emitted at all.
const kAgg = (n, value) => (n >= K ? value : null)

let cache = null
async function team() {
  const key = adminKey()
  if (!key) return { available: false, reason: 'not-configured', detail: 'No Cursor Admin API key. Add "cursorAdminKey" to .eng.local.json or set CURSOR_ADMIN_KEY. This endpoint shows nothing rather than showing zeros.' }
  if (cache && Date.now() - cache.at < 900_000) return cache.data

  const errors = []
  const get = async (route, body) => { try { return await api(key, route, body) } catch (e) { errors.push(e.message); return null } }
  const to = new Date(), from = new Date(Date.now() - 30 * 864e5)
  const [members, usage, spend] = await Promise.all([
    get('/teams/members'),
    get('/teams/daily-usage-data', { startDate: from.getTime(), endDate: to.getTime() }),
    get('/teams/spend'),
  ])
  if (!members) return { available: false, reason: 'admin-api-unreachable', errors }

  const mem = members.teamMembers || members.members || []
  const spendRows = spend?.teamMemberSpend || spend?.subscriptionCycleSpend || spend?.spend || []
  const spendBy = {}
  for (const s of spendRows) {
    const e = (s.email || s.userEmail || '').toLowerCase()
    if (e) spendBy[e] = s.spendCents ?? s.totalSpendCents ?? (s.spend != null ? Math.round(s.spend * 100) : null)
  }
  const usageRows = usage?.data || usage?.dailyUsage || []
  const activeDaysBy = {}, seenEmails = new Set()
  for (const u of usageRows) {
    const e = (u.email || u.userEmail || '').toLowerCase()
    if (!e) continue
    seenEmails.add(e)
    const busy = (u.totalLinesAdded || u.acceptedLinesAdded || u.totalApplies || u.chatRequests || 0) > 0
    if (busy) activeDaysBy[e] = (activeDaysBy[e] || 0) + 1
  }

  const team = roster()
  const rows = mem.map(m => {
    const email = (m.email || '').toLowerCase()
    return scrub({
      email, name: m.name || null, role: m.role || null,
      seatAssignedAt: m.createdAt || m.dateAdded || m.seatAssignedAt || null,
      clientVersion: m.clientVersion || m.version || null,
      spendCents: spendBy[email] ?? null,
      active: (activeDaysBy[email] || 0) > 0,
    })
  }).sort((a, b) => (a.email || '').localeCompare(b.email || '')) // alphabetical. Never ranked.

  const now = Date.now()
  const deadSeat = rows.filter(r => !r.active).map(r => ({ email: r.email, name: r.name, seatAssignedAt: r.seatAssignedAt, spendCents: r.spendCents }))
  const neverOnboarded = rows.filter(r => r.seatAssignedAt && now - Date.parse(r.seatAssignedAt) > 21 * 864e5 && !seenEmails.has(r.email))
    .map(r => ({ email: r.email, name: r.name, seatAssignedAt: r.seatAssignedAt }))

  // the two roster reconciliations
  const seatEmails = new Set(rows.map(r => r.email))
  const seatNoTeam = [...seatEmails].filter(e => e && !team.has(e))
  const teamNoSeat = [...team].filter(e => !seatEmails.has(e))

  // BEHAVIORAL — team level only, k>=5, no email anywhere in this object
  const n = rows.length
  const activeCount = rows.filter(r => r.active).length
  const behavioral = {
    k: K, members: n, suppressed: n < K,
    adoptionPct: kAgg(n, n ? +((activeCount / n) * 100).toFixed(1) : null),
    activeMembers: kAgg(n, activeCount),
    totalSpendCents: kAgg(n, rows.reduce((a, r) => a + (r.spendCents || 0), 0)),
    medianSpendCents: kAgg(n, (() => { const v = rows.map(r => r.spendCents).filter(x => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null })()),
    note: n < K ? `suppressed: only ${n} seats, below the k=${K} floor` : 'aggregate only — this object contains no email and no per-person behavioral field, by construction',
  }

  const data = {
    available: true, plane: 'team (Cursor Admin API — org billing data, never joined to local telemetry)',
    fetchedAt: new Date().toISOString(),
    contract: { perEmailFields: ADMIN_FACTS, k: K, forbidden: ['acceptRate', 'aiLines', 'sessionCount', 'sessionTimes', 'latency', 'promptText', 'weekendActivity', 'anyScore'] },
    members: rows, behavioral,
    outliers: { deadSeat, neverOnboarded },
    roster: { seatButNoTeam: seatNoTeam, teamButNoSeat: teamNoSeat },
    ...(errors.length ? { partial: true, errors } : {}),
  }
  cache = { at: Date.now(), data }
  return data
}

export default function mountCursorTeam(app) {
  app.get('/api/cursor/team', (req, res) => {
    // no user/email/machine parameter is accepted here — the route cannot be pointed at a person
    team().then(d => res.json(d)).catch(e => res.status(500).json({ available: false, reason: 'error', error: e.message }))
  })
}
