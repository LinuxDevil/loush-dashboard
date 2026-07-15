import { useEffect, useState, useMemo, useCallback } from 'react'
import { api, toast } from '../api.js'

// ── Shared period (Year/Q1–Q4) ───────────────────────────────────────────────
// The header filter must scope EVERY panel's JIRA-derived data, not just the career snapshot.
// eng data is loaded once (all-time) and scoped per-period in useEngSelf, so all 18 panels react
// to the filter with no prop threading. The header calls setEngPeriod() when the filter changes.
let _engPeriod = ''
const _engSubs = new Set()
export function setEngPeriod(p) { p = p || ''; if (p === _engPeriod) return; _engPeriod = p; for (const fn of _engSubs) fn(p) }

// item 4 — the year clamp is DELETED. A period is `YYYY`, `Qn` (current year) or `YYYYQn`, exactly like
// the server's periodWindow(). Prior-year periods are first-class, because a single-period number cannot
// tell anyone whether an intervention worked.
export function engWindow(period) {
  const nowMs = Date.now(), curY = new Date().getFullYear()
  const m = /^(\d{4})?(?:Q([1-4]))?$/.exec(String(period || '').trim())
  const y = m && m[1] ? +m[1] : curY
  const q = m && m[2] ? +m[2] : null
  if (q) { const sm = (q - 1) * 3; return { start: Date.UTC(y, sm, 1), end: Math.min(nowMs, Date.UTC(y, sm + 3, 1)) } }
  return { start: Date.UTC(y, 0, 1), end: Math.min(nowMs, Date.UTC(y + 1, 0, 1)) }
}
// The period BEFORE this one — the denominator of every delta chip. Mirrors server priorPeriod().
export function priorPeriod(period) {
  const m = /^(\d{4})?(?:Q([1-4]))?$/.exec(String(period || '').trim())
  const y = m && m[1] ? +m[1] : new Date().getFullYear()
  const q = m && m[2] ? +m[2] : null
  if (!q) return String(y - 1)
  return q === 1 ? `${y - 1}Q4` : `${y}Q${q - 1}`
}
const _ms = x => { const t = x ? Date.parse(x) : NaN; return Number.isNaN(t) ? null : t }
// "This year's tickets" = created OR closed inside the window. Deliberately EXCLUDES ancient still-open
// carryovers so their lifetime daysIn no longer inflates "where time goes". ponytail: daysIn is still each
// ticket's lifetime total — true per-window clipping would need the changelog (server-side, deferred).
function issueInWindow(i, w) {
  const c = _ms(i.created), cl = _ms(i.closedAt)
  return (c != null && c >= w.start && c < w.end) || (cl != null && cl >= w.start && cl < w.end)
}

// ── localStorage stale-while-revalidate cache ────────────────────────────────────────────
// Repeat visits (even across full page reloads) paint instantly from the last-good payload,
// then revalidate in the background. Bump CACHE_V to invalidate old shapes.
const CACHE_V = 'v2'
const ckey = k => `career:${CACHE_V}:${k}`
function cacheGet(k) { try { const r = localStorage.getItem(ckey(k)); return r ? JSON.parse(r) : null } catch { return null } }
function cacheSet(k, data) { try { localStorage.setItem(ckey(k), JSON.stringify({ at: Date.now(), data })) } catch { /* quota / private mode — skip */ } }
function cacheClear() { try { for (const k of ['usage', 'engSelf']) localStorage.removeItem(ckey(k)) } catch {} }

// ── Shared, module-level cached loaders (one in-flight fetch per session, shared by panels) ─
let _usage, _engSelf

export function loadUsage() { return _usage ||= api.get('/api/usage').catch(() => null) }

const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const avg = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0

// Engineering-metrics dashboard, filtered to ME. Resolves my JIRA accountId from members[]/assignees
// by config email, persists it into career.json identity, then derives personal DORA. Returns a SLIM
// payload (no full 1203-issue snapshot) so it fits localStorage; `allIssues` keeps only the fields
// OKR epic-progress needs.
export function loadEngSelf() {
  return _engSelf ||= (async () => {
    const [snap, creds, cfg] = await Promise.all([
      api.get('/api/eng/snapshot?project=all').catch(() => null),
      api.get('/api/eng/creds').catch(() => ({})),
      api.get('/api/career/config').catch(() => ({})),
    ])
    if (!snap || !snap.available) return { available: false, reason: 'eng-unavailable' }
    const email = (cfg?.identity?.gitEmails?.[0] || creds?.email || '').toLowerCase()
    let accountId = cfg?.identity?.jiraAccountId || ''
    if (!accountId && email) {
      const byMember = (snap.members || []).find(m => (m.email || '').toLowerCase() === email)
      const byIssue = (snap.issues || []).map(i => i.assignee).find(a => (a?.email || '').toLowerCase() === email)
      accountId = byMember?.id || byIssue?.id || ''
      if (accountId) api.post('/api/career/config', { identity: { ...(cfg.identity || {}), jiraAccountId: accountId, gitEmails: email ? [email] : [] } }).catch(() => {})
    }
    if (!accountId) return { available: true, accountId: null, reason: 'identity-unresolved', email }

    const mine = (snap.issues || []).filter(i => i.assignee?.id === accountId || i.devAssignee?.id === accountId || i.ownerId === accountId || i.fixerId === accountId)
    const myKeys = new Set(mine.map(i => i.key))
    const myPrs = (snap.prs || []).filter(p => myKeys.has(p.ticket))
    // slim projection of ALL issues — only what OKR epic-progress needs (keeps the cache small)
    const allIssues = (snap.issues || []).map(i => ({ key: i.key, parent: i.parent ? { key: i.parent.key } : null, linkedKey: i.linkedKey, live: i.live, status: i.status, host: i.host }))
    // bug tax — the SAME field the game engine reads for the `better-than-before` badge (server-game.mjs
    // engEvents → snap.investment). Carried through so the career game block can name the number honestly.
    // null (not 0) when the snapshot didn't compute it — a missing comparison is not a passing one.
    const inv = snap.investment
    const bugTax = inv && inv.bugTaxPct != null && inv.bugTaxPrevPct != null ? { pct: inv.bugTaxPct, prevPct: inv.bugTaxPrevPct } : null
    return { available: true, accountId, email, issues: mine, prs: myPrs, allIssues, bugTax, dora: deriveDora(mine, myPrs, accountId) }
  })()
}

// Pure DORA derivation over a (possibly window-scoped) personal issue/PR set. Reused by useEngSelf so
// the period filter recomputes DORA for the selected window instead of always showing all-time numbers.
export function deriveDora(mine = [], myPrs = [], accountId) {
  const d90 = Date.now() - 90 * 864e5
  const delivered = mine.filter(i => i.live && !i.isBug)
  const cycle = delivered.map(i => i.delivery).filter(x => x > 0)
  const escaped = mine.filter(i => i.isBug && i.ownerId === accountId)
  const shipped90 = delivered.filter(i => Date.parse(i.closedAt || 0) >= d90)
  return {
    throughput90: shipped90.length,
    cycleMedian: +median(cycle).toFixed(1),
    cycleAvg: +avg(cycle).toFixed(1),
    changeFailRate: delivered.length ? escaped.length / delivered.length : 0,
    escapedBugs: escaped.length,
    reworkAvg: +avg(mine.map(i => i.rework || 0)).toFixed(2),
    estAcc: +avg(mine.map(i => i.estAcc).filter(x => x != null)).toFixed(0),
    prReviewRounds: +avg(myPrs.map(p => p.cycles || 1)).toFixed(1),
    prMergeDays: +median(myPrs.map(p => p.mergeDays).filter(x => x != null)).toFixed(1),
    prFirstReviewDays: +median(myPrs.map(p => p.firstReviewDays).filter(x => x != null)).toFixed(1),
    openNow: mine.filter(i => i.active).length,
  }
}

// SWR hook: seed synchronously from localStorage (instant paint), revalidate in background.
// `good(d)` decides whether a result is worth caching (don't clobber good cache with a down-state).
function useCached(key, loader, good) {
  const [state, setState] = useState(() => {
    const c = cacheGet(key)
    return { data: c?.data ?? null, loading: !c, revalidating: !!c, cachedAt: c?.at ?? null }
  })
  useEffect(() => {
    let live = true
    loader().then(d => {
      if (!live) return
      if (good(d)) { cacheSet(key, d); setState({ data: d, loading: false, revalidating: false, cachedAt: Date.now() }) }
      else setState(s => ({ data: s.data ?? d, loading: false, revalidating: false, cachedAt: s.cachedAt }))
    })
    return () => { live = false }
  }, [])
  return state
}
export const useUsage = () => useCached('usage', loadUsage, d => d != null && !!d.kpis)

// Eng data scoped to the current period. Loads once (all-time), then filters issues/PRs to the selected
// window and recomputes DORA — so the Year/Q filter reflects across EVERY panel and all JIRA data.
// item 4: the SAME derivation runs over the PRIOR window and ships as `priorDora`, so every eng tile can
// render a ± chip. A number with no denominator in time is not a measurement.
export function useEngSelf() {
  const base = useCached('engSelf', loadEngSelf, d => !!d?.accountId)
  const [period, setPeriod] = useState(_engPeriod)
  useEffect(() => { const fn = p => setPeriod(p); _engSubs.add(fn); setPeriod(_engPeriod); return () => { _engSubs.delete(fn) } }, [])
  const data = useMemo(() => {
    const d = base.data
    if (!d || !d.accountId || !Array.isArray(d.issues)) return d
    const scope = (p) => {
      const w = engWindow(p)
      const issues = d.issues.filter(i => issueInWindow(i, w))
      const keys = new Set(issues.map(i => i.key))
      const prs = (d.prs || []).filter(p2 => keys.has(p2.ticket))
      return { issues, prs, dora: deriveDora(issues, prs, d.accountId) }
    }
    const cur = scope(period), prev = scope(priorPeriod(period))
    return { ...d, ...cur, priorDora: prev.dora, priorPeriod: priorPeriod(period), period }
  }, [base.data, period])
  return { ...base, data }
}

// ── item 1 — one loader for every /api/team/* + /api/career/* panel ──────────────────────────
// No scope parameter exists, by design: scope is a property of the DATA (server-team.mjs enforces the
// plane boundary and the min-N floor), never a mode the user picks. This hook just fetches and caches.
const _mem = new Map()
export function useApi(pathOrNull, { poll = 0 } = {}) {
  const [state, setState] = useState(() => ({ data: pathOrNull ? _mem.get(pathOrNull) ?? null : null, loading: !!pathOrNull && !_mem.has(pathOrNull), error: null }))
  const [n, bump] = useState(0)
  useEffect(() => {
    if (!pathOrNull) { setState({ data: null, loading: false, error: null }); return }
    let live = true
    if (!_mem.has(pathOrNull)) setState(s => ({ ...s, loading: true }))
    api.get(pathOrNull)
      .then(d => { if (!live) return; _mem.set(pathOrNull, d); setState({ data: d, loading: false, error: null }) })
      .catch(e => { if (live) setState(s => ({ data: s.data, loading: false, error: e.message })) })
    const t = poll ? setInterval(() => bump(x => x + 1), poll) : null
    return () => { live = false; if (t) clearInterval(t) }
  }, [pathOrNull, n])
  const reload = useCallback(() => { if (pathOrNull) _mem.delete(pathOrNull); bump(x => x + 1) }, [pathOrNull])
  return { ...state, reload }
}
export function resetApiCache() { _mem.clear() }

// ── clipboard: every "action" in this dashboard is a line a human sends. There is no auto-ping. ──
export async function copy(text, label = 'copied') {
  try { await navigator.clipboard.writeText(String(text ?? '')); toast(label, 'success') }
  catch (e) { toast('clipboard blocked: ' + e.message, 'error') }
}
export const copyJson = (obj) => copy(JSON.stringify(obj, null, 2), 'panel JSON copied — reproduce the number in a terminal')

// ── derivations over the personal eng issue set (used by Overview/Delivery) ──────────────

export function timeAllocation(issues = []) {
  const statusDays = {}, statusColor = {}, statusKind = {}
  let active = 0, waiting = 0
  for (const i of issues) {
    active += i.activeDays || 0; waiting += i.waitDays || 0
    for (const [s, v] of Object.entries(i.daysIn || {})) { statusDays[s] = (statusDays[s] || 0) + v }
    statusColor[i.status] = i.statusColor
  }
  return { statusDays, statusColor, statusKind, active, waiting }
}

export function cycleTrend(issues = [], months = 6) {
  const now = new Date()
  const buckets = []
  for (let m = months - 1; m >= 0; m--) {
    const d = new Date(now.getFullYear(), now.getMonth() - m, 1)
    buckets.push({ y: d.getFullYear(), m: d.getMonth(), label: d.toLocaleString('en', { month: 'short' }), vals: [] })
  }
  for (const i of issues) {
    if (!i.live || i.isBug || !(i.delivery > 0) || !i.closedAt) continue
    const d = new Date(i.closedAt)
    const b = buckets.find(x => x.y === d.getFullYear() && x.m === d.getMonth())
    if (b) b.vals.push(i.delivery)
  }
  return buckets.map(b => ({ label: b.label, value: b.vals.length ? +median(b.vals).toFixed(1) : 0 }))
}

// header refresh → drop in-memory + localStorage caches so the next load re-fetches
export function resetCareerData() { _usage = null; _engSelf = null; _mem.clear(); cacheClear() }
