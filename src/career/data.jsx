import { useEffect, useState } from 'react'
import { api } from '../api.js'

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
    const now = Date.now(), d90 = now - 90 * 864e5

    const delivered = mine.filter(i => i.live && !i.isBug)
    const cycle = delivered.map(i => i.delivery).filter(x => x > 0)
    const escaped = mine.filter(i => i.isBug && i.ownerId === accountId)
    const shipped90 = delivered.filter(i => Date.parse(i.closedAt || 0) >= d90)
    const dora = {
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
    return { available: true, accountId, email, issues: mine, prs: myPrs, allIssues, dora }
  })()
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
export const useEngSelf = () => useCached('engSelf', loadEngSelf, d => !!d?.accountId)

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
export function resetCareerData() { _usage = null; _engSelf = null; cacheClear() }
