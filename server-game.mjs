// ─────────────────────────────────────────────────────────────────────────────
// THE XP ENGINE — outcomes only, self only. Read this before editing.
//
// WHY THE OLD ONE WAS DELETED: XP was all-time assistant MESSAGE COUNT. The fastest
//   way to level up was a long, thrashing, unproductive conversation. It paid you for
//   exactly the behaviour this tool exists to reduce. Never again:
//
//   RULE 1 — every XP event is an OUTCOME, not an activity. A thing shipped, merged,
//     reviewed, fixed, unstuck, archived or made green. Never "you sent N messages",
//     never "you typed N lines", never "you had a session". If an event can be earned
//     by talking to Claude for longer, it is not an event — delete it.
//   RULE 2 — SELF-ONLY, like the rest of Plane B. XP/levels/streaks/achievements are
//     the viewer's own, measured against the VIEWER'S OWN PAST. There is no leaderboard,
//     no ranking of humans, and no XP for another engineer. Plane-A rows are filtered to
//     `me` (jiraAccountId / gh login) BEFORE any aggregation — see mine() below. The only
//     comparison this engine will ever make is you-vs-your-own-trailing-mark.
//   RULE 3 — nothing here is ever emitted at team scope. /api/game answers for one laptop.
//     Do not import server-team.mjs. Do not accept a user/engineer parameter. Ever.
//
// TWO KINDS OF EVENT:
//   DERIVED — recomputed from source on every call, carries a stable id + a real date
//     (issue.closedAt, pr.mergedAt, reviewEvent.at, session.last, versions-log ts). Idempotent,
//     needs no storage, and is auditable: every one points at an artifact you can open.
//   DELTA — a harness improvement measured against a persisted MARK of your own past
//     (always-on token tax, error-signature recurrence, red main, flaky jobs, inbox, stalls).
//     These cannot be recomputed after the fact — the source only shows the new state — so
//     they are APPENDED to ~/.claude/game.json once and kept forever.
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import * as eng from './server-eng.mjs'

const CLAUDE = path.join(os.homedir(), '.claude')
const GAME_FILE = path.join(CLAUDE, 'game.json')
const META_FILE = path.join(CLAUDE, 'dashboard-meta.json')
const VERSIONS_FILE = path.join(CLAUDE, 'dashboard-versions.jsonl')
const CAREER_FILE = path.join(CLAUDE, 'career.json')
const DAY = 864e5
const GAME_TTL = 120_000 // it walks JIRA + GitHub + transcripts + the versions log

const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return d } }
const dayKey = ms => new Date(ms).toLocaleDateString('en-CA') // local YYYY-MM-DD, not UTC
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))

// ---------- persistence (versioned write, same shape as career.json / taskboard.json) ----------
const BLANK = { version: 1, updatedAt: 0, earned: [], banked: [], marks: null, unlocked: {}, seen: [] }
function load() {
  const g = readJson(GAME_FILE, null)
  if (!g || g.version !== 1) return { ...BLANK }
  return { ...BLANK, ...g }
}
function save(g) {
  g.version = 1
  g.updatedAt = Date.now()
  fs.mkdirSync(CLAUDE, { recursive: true })
  const tmp = GAME_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(g, null, 2))
  fs.renameSync(tmp, GAME_FILE) // atomic: a crash mid-write never leaves a half-parsed ledger
  return g
}

// ---------- identity: who is "me"? (RULE 2 — everything downstream filters on this) ----------
let ID
function me() {
  if (ID) return ID
  const car = readJson(CAREER_FILE, {}).identity || {}
  const cfg = readJson(path.join(path.dirname(new URL(import.meta.url).pathname), 'config.json'), {})
  const emails = new Set([...(car.gitEmails || []), cfg.email].filter(Boolean).map(e => e.toLowerCase()))
  let gh = car.githubHandle || ''
  if (!gh) { const r = spawnSync('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf8' }); gh = (r.stdout || '').trim() }
  ID = { emails, gh: gh.toLowerCase(), jira: car.jiraAccountId || '' }
  return ID
}
const mineIssue = i => { const m = me(); return (i.ownerId && i.ownerId === m.jira) || (i.owner?.email && m.emails.has(i.owner.email.toLowerCase())) }
const minePr = p => me().gh && String(p.author || '').toLowerCase() === me().gh
const mineLogin = l => me().gh && String(l || '').toLowerCase() === me().gh

// ---------- the taxonomy ----------
// xp: flat award. dash: which dashboard's page credits it. Every one is a verifiable outcome.
const EV = {
  ship:          { xp: 40, dash: 'eng',    icon: '🚢', label: 'shipped a ticket' },       // + story points, when they exist
  shipClean:     { xp: 25, dash: 'eng',    icon: '🛡️', label: 'shipped with no escaped defect' },
  bugfix:        { xp: 30, dash: 'eng',    icon: '🐛', label: 'fixed a bug' },
  qaFirstPass:   { xp: 15, dash: 'eng',    icon: '✅', label: 'cleared QA first pass' },
  prMerged:      { xp: 25, dash: 'eng',    icon: '🔀', label: 'merged a PR' },
  reviewGiven:   { xp: 20, dash: 'eng',    icon: '👀', label: 'reviewed a teammate\'s PR' }, // the contribution nobody credits
  reviewFast:    { xp: 10, dash: 'eng',    icon: '⚡', label: 'reviewed within a day' },
  unblock:       { xp: 15, dash: 'eng',    icon: '🔓', label: 'first review on a stalled PR' },
  unstick:       { xp: 15, dash: 'eng',    icon: '🔧', label: 'unstuck a stalled ticket' },
  ciGreen:       { xp: 40, dash: 'eng',    icon: '🟢', label: 'turned a red main green' },
  flakyKilled:   { xp: 30, dash: 'eng',    icon: '🎲', label: 'killed a flaky test' },
  capArchive:    { xp: 30, dash: 'claude', icon: '🗄️', label: 'archived a dead capability' },
  taxCut:        { xp: 0,  dash: 'claude', icon: '✂️', label: 'cut always-on context tax' }, // scaled by tokens reclaimed
  sigKilled:     { xp: 25, dash: 'claude', icon: '🔍', label: 'drove an error signature to zero' },
  sigReduced:    { xp: 10, dash: 'claude', icon: '📉', label: 'reduced an error signature' },
  inboxCleared:  { xp: 5,  dash: 'claude', icon: '📥', label: 'cleared an attention item' },
  cleanSession:  { xp: 8,  dash: 'claude', icon: '✨', label: 'session ended with no error' },
  cacheWin:      { xp: 6,  dash: 'claude', icon: '🔥', label: 'kept the cache warm' },
  cursorAccept:  { xp: 10, dash: 'cursor', icon: '🖱️', label: 'Cursor accept rate improved' },
  bugTaxDown:    { xp: 50, dash: 'career', icon: '📈', label: 'bug tax down on the prior period' },
}
const mk = (kind, id, at, subject, xp, extra) => ({ id, event: kind, xp: xp ?? EV[kind].xp, at, subject, dash: EV[kind].dash, icon: EV[kind].icon, label: EV[kind].label, ...extra })

// ---------- DERIVED: Plane A (JIRA + GitHub), filtered to me ----------
function engEvents(snap) {
  const out = []
  if (!snap?.available) return out
  const escapedFor = new Set() // tickets that produced an escaped bug — those don't get shipClean
  for (const i of snap.issues) if (i.isBug && i.qaReported === false && i.linkedKey) escapedFor.add(i.linkedKey)

  for (const i of snap.issues) {
    if (!mineIssue(i) || i.statusKind !== 'done') continue
    const at = Date.parse(i.closedAt || i.liveAt || 0)
    if (!at) continue
    const sub = `${i.key} ${i.summary || ''}`.slice(0, 90)
    if (i.isBug) out.push(mk('bugfix', 'bug:' + i.key, at, sub))
    else {
      // 89% of tickets carry no points — the flat 40 is the real path, points are a bonus, capped so a
      // 13-pointer can't out-earn three real ships.
      out.push(mk('ship', 'ship:' + i.key, at, sub, EV.ship.xp + clamp((i.pts || 0) * 6, 0, 60), { pts: i.pts || 0 }))
      if (!escapedFor.has(i.key)) out.push(mk('shipClean', 'clean:' + i.key, at, sub))
    }
    if (!i.qaCycles && !i.rework) out.push(mk('qaFirstPass', 'qa:' + i.key, at, sub))
  }

  for (const p of snap.prs) {
    const created = Date.parse(p.createdAt || 0)
    if (minePr(p) && p.mergedAt) out.push(mk('prMerged', `pr:${p.repo}#${p.num}`, Date.parse(p.mergedAt), `#${p.num} ${p.title || ''}`.slice(0, 90)))
    // reviews GIVEN — one per PR (not per comment), so a chatty review can't be farmed.
    const events = (p.reviewEvents || []).filter(r => mineLogin(r.login)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    const first = events[0]
    if (!first || minePr(p)) continue // don't pay yourself for reviewing your own PR
    const at = Date.parse(first.at)
    const sub = `#${p.num} ${p.title || ''}`.slice(0, 90)
    out.push(mk('reviewGiven', `rev:${p.repo}#${p.num}`, at, sub))
    if (created && at - created < DAY) out.push(mk('reviewFast', `revf:${p.repo}#${p.num}`, at, sub))
    // unblocker: nobody had touched it for 3+ days and yours was the first review on the PR.
    const allFirst = [...(p.reviewEvents || [])].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0]
    if (created && allFirst && allFirst.login === first.login && at - created > 3 * DAY) out.push(mk('unblock', `unb:${p.repo}#${p.num}`, at, sub))
  }

  // career: your own prior period is the only baseline (RULE 2). bug tax = % of effort spent on bugs.
  const inv = snap.investment
  if (inv && inv.bugTaxPrevPct != null && inv.bugTaxPct < inv.bugTaxPrevPct) {
    const q = new Date().toISOString().slice(0, 7)
    out.push(mk('bugTaxDown', 'tax:' + q, Date.now(), `bug tax ${inv.bugTaxPrevPct}% → ${inv.bugTaxPct}% vs your prior period`))
  }
  return out
}

// ---------- DERIVED: Plane B (this laptop) ----------
function harnessEvents(sessions, versions) {
  const out = []
  // capability archives are a dated, backed-up, reversible governance write — the audit log IS the event.
  for (const v of versions) {
    const m = /^archive (\S+)\/(\S+)/.exec(v.summary || '')
    if (m) out.push(mk('capArchive', 'cap:' + v.id, v.ts, `${m[1]}/${m[2]}`))
  }
  // a session that ended with no error. Capped at 3/day: this is the one event closest to "activity",
  // so the cap is what stops it degenerating into "open lots of tiny sessions".
  const perDay = {}
  for (const s of [...sessions].sort((a, b) => a.last - b.last)) {
    if (s.errors !== 0 || (s.toolCalls || 0) < 5) continue // a session that did nothing can't "end clean"
    const d = dayKey(s.last)
    if ((perDay[d] = (perDay[d] || 0) + 1) > 3) continue
    out.push(mk('cleanSession', 'sess:' + s.sessionId, s.last, `${s.project} — ${s.toolCalls} tool calls, 0 errors`))
  }
  // cache-read %: the one harness number that is pure win — same work, fewer fresh tokens. Once/day, best session.
  const best = {}
  for (const s of sessions) { const d = dayKey(s.last); if (s.cacheReadPct >= 0.9 && (!best[d] || s.cacheReadPct > best[d].cacheReadPct)) best[d] = s }
  for (const [d, s] of Object.entries(best)) out.push(mk('cacheWin', 'cache:' + d, s.last, `${Math.round(s.cacheReadPct * 100)}% cache read`))
  return out
}

// ---------- DELTA: harness improvements vs your own persisted mark ----------
// The source only ever shows the CURRENT state, so an improvement is invisible unless we remember
// where you were. mark = that memory. Award once, append to the ledger, re-mark.
function markOf(caps, forensics, snap, meta, cursor) {
  const sigs = {}
  for (const f of forensics.failures || []) sigs[f.sig] = f.recent ?? f.count
  const ci = {}, flaky = {}
  for (const c of snap?.ci || []) { ci[c.project] = { red: !!c.red, at: Date.now() }; flaky[c.project] = (c.flaky || []).length }
  return {
    at: Date.now(),
    alwaysOnTokens: caps.headline?.alwaysOnTokens ?? 0,
    sigs, ci, flaky,
    inboxCleared: Object.values(meta.inboxDone || {}).filter(v => v === true || v === null || (v && v.until === null)).length,
    stalls: (snap?.triage || []).filter(t => mineIssue({ ownerId: t.owner?.id, owner: t.owner })).map(t => t.id),
    acceptRate: cursor?.totals?.acceptRate ?? null,
  }
}
function deltaEvents(prev, now, seenIds) {
  const out = []
  if (!prev) return out // first run: mark the baseline, award nothing. You get credit for the NEXT improvement.
  const push = (kind, id, subject, xp) => { if (!seenIds.has(id)) out.push(mk(kind, id, now.at, subject, xp)) }
  const stamp = now.at.toString(36)

  const cut = prev.alwaysOnTokens - now.alwaysOnTokens
  if (cut >= 25) push('taxCut', 'tax:' + stamp, `${cut.toLocaleString()} always-on tokens reclaimed, every session`, clamp(Math.round(cut / 25), 1, 200))

  for (const [sig, was] of Object.entries(prev.sigs || {})) {
    const is = now.sigs[sig] ?? 0
    if (was > 0 && is === 0) push('sigKilled', `sig0:${sig}:${stamp}`, sig.slice(0, 70))
    else if (was > 0 && is < was) push('sigReduced', `sigd:${sig}:${stamp}`, `${sig.slice(0, 60)} — ${was}→${is}`)
  }
  for (const [proj, was] of Object.entries(prev.ci || {})) {
    if (was.red && now.ci[proj] && !now.ci[proj].red) {
      const mins = Math.round((now.at - was.at) / 60000)
      push('ciGreen', `ci:${proj}:${stamp}`, `${proj} main green again (red for ~${mins}m)`)
      out[out.length - 1] && (out[out.length - 1].redMins = mins) // feeds the under-the-hour achievement
    }
  }
  for (const [proj, was] of Object.entries(prev.flaky || {})) {
    const is = now.flaky[proj] ?? 0
    for (let k = 0; k < was - is; k++) push('flakyKilled', `flk:${proj}:${stamp}:${k}`, `${proj} — one fewer flaky job`)
  }
  for (let k = 0; k < now.inboxCleared - (prev.inboxCleared || 0); k++) push('inboxCleared', `inb:${stamp}:${k}`, 'attention item cleared')

  const gone = (prev.stalls || []).filter(id => !now.stalls.includes(id))
  for (const id of gone) push('unstick', `stall:${id}`, id.replace(/^[a-z-]+:/, '') + ' unstuck')

  if (prev.acceptRate != null && now.acceptRate != null && now.acceptRate > prev.acceptRate + 0.02)
    push('cursorAccept', 'cur:' + stamp, `accept rate ${Math.round(prev.acceptRate * 100)}% → ${Math.round(now.acceptRate * 100)}%`)
  return out
}

// ---------- levels ----------
// Honest curve: level N→N+1 costs 250 + 150·(N−1). Early levels land fast (a first ship + a review is
// visible progress), late levels take a real quarter of outcomes. No exponential wall, no message count.
const LEVELS = ['Newcomer', 'Contributor', 'Builder', 'Shipper', 'Craftsperson', 'Maintainer', 'Multiplier', 'Steward', 'Architect', 'Principal', 'Keystone', 'Luminary']
const levelName = n => LEVELS[Math.min(n, LEVELS.length) - 1] + (n > LEVELS.length ? ` +${n - LEVELS.length}` : '')
function levelOf(xp) {
  let lvl = 1, floor = 0, cost = 250
  while (xp >= floor + cost) { floor += cost; lvl++; cost = 250 + 150 * (lvl - 1) }
  const into = xp - floor
  return { level: lvl, levelName: levelName(lvl), intoLevel: into, toNext: cost - into, span: cost, pct: Math.round((into / cost) * 100) }
}

// ---------- streaks: consecutive days with a real OUTCOME (not "a session existed") ----------
function streakOf(events, g) {
  const days = [...new Set(events.map(e => dayKey(e.at)))].sort().reverse()
  if (!days.length) return { current: 0, best: g.bestStreak || 0, lastActive: null, days: [] }
  const today = dayKey(Date.now()), yest = dayKey(Date.now() - DAY)
  let cur = 0
  if (days[0] === today || days[0] === yest) { // an idle TODAY does not break a streak — you still have today.
    cur = 1
    for (let i = 1; i < days.length; i++) {
      if (Date.parse(days[i - 1]) - Date.parse(days[i]) === DAY) cur++
      else break
    }
  }
  let best = 0, run = 0
  for (let i = 0; i < days.length; i++) {
    run = i && Date.parse(days[i - 1]) - Date.parse(days[i]) === DAY ? run + 1 : 1
    best = Math.max(best, run)
  }
  return { current: cur, best: Math.max(best, g.bestStreak || 0), lastActive: days[0], days: days.slice(0, 60) }
}

// ---------- achievements ----------
// Every one carries PROGRESS {have, need} so a locked badge tells you how close you are, and every one
// is a thing you DID, never a thing you accumulated by talking.
const T = { B: 'bronze', S: 'silver', G: 'gold' }
function achievements(c) {
  const A = (id, name, desc, icon, tier, dash, have, need) => ({ id, name, desc, icon, tier, dash, progress: { have: Math.min(have, need), need }, unlocked: have >= need })
  return [
    // ── delivery
    A('first-ship', 'First Ship', 'Ship your first ticket', '🚢', T.B, 'eng', c.ship, 1),
    A('ten-ships', 'Ten Deep', 'Ship 10 tickets', '📦', T.S, 'eng', c.ship, 10),
    A('fifty-ships', 'Freight Train', 'Ship 50 tickets', '🚂', T.G, 'eng', c.ship, 50),
    A('pointed', 'Weight Class', 'Ship 25 story points', '🎯', T.S, 'eng', c.pts, 25),
    A('clean-ten', 'No Escapes', '10 ships in a row with no escaped defect', '🛡️', T.S, 'eng', c.shipClean, 10),
    A('clean-sprint', 'Immaculate Sprint', 'Close a sprint with zero escaped defects', '🧼', T.G, 'eng', c.cleanSprints, 1),
    A('bug-slayer', 'Bug Slayer', 'Fix 5 bugs', '🐛', T.B, 'eng', c.bugfix, 5),
    A('exterminator', 'Exterminator', 'Fix 20 bugs', '🪲', T.S, 'eng', c.bugfix, 20),
    A('first-pass', 'First Pass', '10 tickets through QA with zero rework loops', '✅', T.S, 'eng', c.qaFirstPass, 10),
    A('unstick-5', 'Unsticker', 'Unstick 5 stalled tickets', '🔧', T.B, 'eng', c.unstick, 5),
    A('unstick-20', 'Logjam Breaker', 'Unstick 20 stalled tickets', '🪓', T.G, 'eng', c.unstick, 20),
    // ── PRs + review (the contribution nobody credits — it is the best-paid line in this list)
    A('first-merge', 'Merged', 'Merge your first PR', '🔀', T.B, 'eng', c.prMerged, 1),
    A('merge-25', 'Mainline', 'Merge 25 PRs', '🚀', T.S, 'eng', c.prMerged, 25),
    A('reviewer-5', 'Second Pair of Eyes', 'Give 5 code reviews', '👀', T.B, 'eng', c.reviewGiven, 5),
    A('reviewer-25', 'Gatekeeper', 'Give 25 code reviews', '🧐', T.S, 'eng', c.reviewGiven, 25),
    A('reviewer-100', 'Institution', 'Give 100 code reviews', '🏛️', T.G, 'eng', c.reviewGiven, 100),
    A('fast-lane', 'Fast Lane', '10 reviews returned inside a day', '⚡', T.S, 'eng', c.reviewFast, 10),
    A('unblocker', 'Unblocker', 'Be the first review on 5 PRs left waiting 3+ days', '🔓', T.S, 'eng', c.unblock, 5),
    A('reciprocator', 'Reciprocator', 'Give at least as many reviews as you receive (min 10)', '🤝', T.G, 'eng', c.reciprocal ? 1 : 0, 1),
    // ── CI / reliability
    A('green-again', 'Green Again', 'Turn a red main green', '🟢', T.B, 'eng', c.ciGreen, 1),
    A('under-the-hour', 'Under the Hour', 'Turn a red main green inside an hour', '⏱️', T.G, 'eng', c.ciFast, 1),
    A('flake-killer', 'Flake Killer', 'Kill a flaky test', '🎲', T.S, 'eng', c.flakyKilled, 1),
    A('flake-hunter', 'Determinist', 'Kill 5 flaky tests', '🧹', T.G, 'eng', c.flakyKilled, 5),
    // ── the harness (Claude)
    A('first-archive', 'Spring Clean', 'Archive a dead capability', '🗄️', T.B, 'claude', c.capArchive, 1),
    A('archivist', 'Archivist', 'Archive 10 dead capabilities', '📚', T.S, 'claude', c.capArchive, 10),
    A('dead-weight', 'Dead Weight', `${c.deadCount} capabilities are DEAD and still bill you every session — get it under 10`, '⚰️', T.G, 'claude', c.deadPruned, c.deadToPrune),
    A('tax-cut', 'Tax Cut', 'Halve your always-on token tax against your own baseline', '✂️', T.G, 'claude', Math.round(c.taxCutPct), 50),
    A('signature-hunter', 'Signature Hunter', 'Drive an error signature to zero', '🔍', T.S, 'claude', c.sigKilled, 1),
    A('quiet-week', 'Quiet Week', '7 days with no error signature biting', '🌤️', T.S, 'claude', c.quietDays, 7),
    A('inbox-25', 'Attention Router', 'Clear 25 attention items', '📥', T.S, 'claude', c.inboxCleared, 25),
    A('clean-run', 'Clean Run', 'End a session with zero errors', '✨', T.B, 'claude', c.cleanSession, 1),
    A('clean-fifty', 'Steady Hands', '50 sessions ended clean', '🧊', T.G, 'claude', c.cleanSession, 50),
    A('cache-warm', 'Cache Warm', 'A session at 90%+ cache read', '🔥', T.B, 'claude', c.cacheWin, 1),
    A('cache-master', 'Cache Master', '30-day cache read averaging 95%+', '❄️', T.G, 'claude', Math.round(c.cache30), 95),
    // ── career (you vs your own prior period — never vs a colleague)
    A('better-than-before', 'Better Than Before', 'Cut your bug tax against your prior period', '📈', T.G, 'career', c.bugTaxDown, 1),
    A('brag-keeper', 'Receipts', 'Keep 10 entries in the brag log', '📝', T.B, 'career', c.brag, 10),
    A('reflective', 'Reflective', 'Write 5 retros', '🪞', T.S, 'career', c.retros, 5),
    // ── cursor
    A('accept-60', 'Tab Tab Tab', 'Cursor accept rate over 60%', '🖱️', T.B, 'cursor', Math.round(c.acceptPct), 60),
    A('accept-80', 'In The Groove', 'Cursor accept rate over 80%', '🎹', T.S, 'cursor', Math.round(c.acceptPct), 80),
    // ── streaks
    A('streak-3', 'Warm', '3 straight days with a real outcome', '🔥', T.B, 'claude', c.bestStreak, 3),
    A('streak-7', 'Hot', '7 straight days with a real outcome', '🔥', T.S, 'claude', c.bestStreak, 7),
    A('streak-30', 'Furnace', '30 straight days with a real outcome', '🌋', T.G, 'claude', c.bestStreak, 30),
  ]
}

// ---------- lifetime banking (BUG-1 fix) ----------
// DERIVED events are recomputed from WINDOWED sources every call (sessions?days=90, the eng snapshot's
// rolling JQL). Left alone, an old ship / PR / review / clean-session that ages out of its window takes
// its XP with it, and a LIFETIME level derived from that would go DOWN. It must never go down. So we
// fold every not-yet-seen derived event into a permanent store keyed by its STABLE id, freezing its XP
// and real date, and score from the union of that store with the current call — deduped by id, banked
// copy winning, so a fresh event and its banked twin never double-count.
//
// Every derived id IS stable and independent of the per-call clock, so banking is idempotent:
//   ship:/clean:/bug:/qa:KEY, pr:/rev:/revf:/unb:REPO#NUM, cap:VERSION, sess:SESSIONID,
//   cache:YYYY-MM-DD, tax:YYYY-MM. bugTaxDown + cache/session events carry at=Date.now()/s.last, but
//   their id is date-window-keyed, not clock-keyed, so re-seeing them re-banks NOTHING. (The DELTA
//   events in g.earned embed now.at in their id and are NOT derived — they are never banked here, so
//   there is exactly one source of truth for them.)
function bankDerived(g, derived) {
  if (!g.banked) g.banked = []
  const seen = new Set(g.banked.map(e => e.id))
  for (const e of derived) if (!seen.has(e.id)) { g.banked.push(e); seen.add(e.id) }
  return g.banked
}
function lifetimeEvents(g, derived) {
  const byId = new Map() // banked first → the frozen copy wins over the live (windowed) recompute
  for (const e of [...(g.banked || []), ...derived, ...(g.earned || [])]) if (!byId.has(e.id)) byId.set(e.id, e)
  return [...byId.values()].sort((a, b) => a.at - b.at)
}

// ---------- assemble ----------
let cache = null
async function build() {
  const g = load()
  const snap = await eng.snapshotAll().catch(() => ({ available: false, issues: [], prs: [] }))
  const caps = readCaps()
  const forensics = readForensics()
  const sessions = readSessions()
  const cursor = readCursorAccept()
  const meta = readJson(META_FILE, {})
  const versions = readVersions()

  // your own starting point, recorded once — the ONLY baseline this engine ever compares you to (RULE 2)
  if (!g.baselineTax) g.baselineTax = caps.headline?.alwaysOnTokens ?? 0
  if (g.baselineDead == null) g.baselineDead = caps.headline?.deadCount ?? 0

  const derived = [...engEvents(snap), ...harnessEvents(sessions, versions)]
  const nowMark = markOf(caps, forensics, snap, meta, cursor)
  const seenIds = new Set(g.earned.map(e => e.id))
  const fresh = deltaEvents(g.marks, nowMark, seenIds)
  if (fresh.length) g.earned.push(...fresh)
  g.marks = nowMark
  if (g.earned.length > 2000) g.earned = g.earned.slice(-2000)

  // BUG-1 fix: bank the derived events permanently (dedup by stable id), then score from the lifetime
  // union so XP/level are non-decreasing forever even after events leave the source window. On the very
  // first run under this code g.banked is empty, so it simply absorbs whatever is currently visible —
  // the number never lurches, and unlocked/seen/marks/bestStreak are untouched.
  bankDerived(g, derived)
  const events = lifetimeEvents(g, derived)
  const xp = events.reduce((s, e) => s + e.xp, 0)
  const lvl = levelOf(xp)
  const streak = streakOf(events, g)
  g.bestStreak = streak.best

  // counters → achievement progress
  const n = k => events.filter(e => e.event === k).length
  const car = readJson(CAREER_FILE, {})
  const revd = (snap.review?.reviewers || []).find(r => mineLogin(r.login))
  const sig30 = (forensics.failures || []).filter(f => f.biting).length
  const c = {
    ship: n('ship'), shipClean: n('shipClean'), bugfix: n('bugfix'), qaFirstPass: n('qaFirstPass'),
    prMerged: n('prMerged'), reviewGiven: n('reviewGiven'), reviewFast: n('reviewFast'), unblock: n('unblock'),
    unstick: n('unstick'), ciGreen: n('ciGreen'), flakyKilled: n('flakyKilled'), capArchive: n('capArchive'),
    sigKilled: n('sigKilled'), inboxCleared: n('inboxCleared'), cleanSession: n('cleanSession'), cacheWin: n('cacheWin'),
    bugTaxDown: n('bugTaxDown'),
    pts: events.filter(e => e.event === 'ship').reduce((s, e) => s + (e.pts || 0), 0),
    ciFast: events.filter(e => e.event === 'ciGreen' && e.redMins != null && e.redMins <= 60).length,
    cleanSprints: cleanSprints(snap),
    reciprocal: revd ? revd.given90 >= 10 && revd.given90 >= revd.received90 : false,
    deadCount: caps.headline?.deadCount ?? 0,
    // both of these compare you to YOUR OWN starting point, recorded the first time this ran (RULE 2).
    deadPruned: clamp((g.baselineDead ?? 0) - (caps.headline?.deadCount ?? 0), 0, 1e6),
    deadToPrune: Math.max(1, (g.baselineDead ?? 0) - 10),
    taxCutPct: g.baselineTax ? clamp(((g.baselineTax - (caps.headline?.alwaysOnTokens ?? 0)) / g.baselineTax) * 100, 0, 100) : 0,
    quietDays: 7 - Math.min(7, sig30), // each error signature still biting costs you a day of the quiet week
    cache30: avgCache(sessions) * 100,
    acceptPct: (cursor?.totals?.acceptRate ?? 0) * 100,
    brag: (car.brag || []).length, retros: (car.retros || []).length,
    bestStreak: streak.best,
  }
  const list = achievements(c)
  const newly = []
  for (const a of list) {
    if (a.unlocked && !g.unlocked[a.id]) { g.unlocked[a.id] = Date.now(); newly.push(a.id) }
    a.unlockedAt = g.unlocked[a.id] || null
  }
  save(g)

  const locked = list.filter(a => !a.unlocked && a.progress.need)
    .sort((a, b) => b.progress.have / b.progress.need - a.progress.have / a.progress.need)
  const per = d => {
    const evs = events.filter(e => e.dash === d)
    // per-plane closest badge, so GameStats can show THIS plane's own next badge (or none) instead of
    // borrowing the global top-3 when a plane's badge doesn't rank globally (BUG-2).
    return { xp: evs.reduce((s, e) => s + e.xp, 0), events: evs.length, unlocked: list.filter(a => a.dash === d && a.unlocked).length, total: list.filter(a => a.dash === d).length, next: locked.find(a => a.dash === d) || null }
  }

  return {
    xp, ...lvl,
    streak: { current: streak.current, best: streak.best, lastActive: streak.lastActive, days: streak.days },
    achievements: list.map(a => ({ ...a, unlockedAt: a.unlockedAt })),
    recent: events.slice(-40).reverse().map(e => ({ event: e.event, xp: e.xp, at: e.at, subject: e.subject, icon: e.icon, label: e.label, dash: e.dash })),
    newlyUnlocked: list.filter(a => a.unlocked && !(g.seen || []).includes(a.id)),
    nextUp: locked.slice(0, 3),
    perDashboard: { claude: per('claude'), eng: per('eng'), career: per('career'), cursor: per('cursor') },
    generatedAt: Date.now(),
    plane: 'self-only — your own outcomes, measured against your own past. No leaderboard, ever.',
  }
}

// ---------- source readers (all local; none of them can see another human's harness) ----------
const safe = f => { try { return f() } catch { return null } }
function readVersions() {
  return safe(() => fs.readFileSync(VERSIONS_FILE, 'utf8').split('\n').filter(Boolean).map(l => safe(() => JSON.parse(l))).filter(Boolean)) || []
}
function cleanSprints(snap) {
  // a closed sprint where everything shipped and nothing came back as an escaped bug
  const escaped = new Set((snap.issues || []).filter(i => i.isBug && !i.qaReported && i.linkedKey).map(i => i.linkedKey))
  return (snap.sprints || []).filter(s => s.state === 'closed' && s.shipped > 0 && !(s.keys?.shipped || []).some(k => escaped.has(k))).length
}
const avgCache = ss => { const r = ss.filter(s => s.cacheReadPct != null); return r.length ? r.reduce((s, x) => s + x.cacheReadPct, 0) / r.length : 0 }

// These three are owned by server.mjs / server-cursor.mjs. We do not import those (server.mjs starts a
// listener on import), so we fetch them over the loopback the same way the browser does — one hop, cached.
let PORT = Number(process.env.DASH_PORT) || 5178
const local = async (p, d) => { try { const r = await fetch(`http://127.0.0.1:${PORT}${p}`); return r.ok ? await r.json() : d } catch { return d } }
let CAPS = { headline: {} }, FOR = { failures: [] }, SESS = [], CUR = null
async function refreshLocal() {
  CAPS = await local('/api/capabilities', CAPS)
  FOR = await local('/api/forensics?days=30', FOR)
  const s = await local('/api/sessions?days=90&limit=200', { sessions: [] })
  SESS = s.sessions || []
  CUR = await local('/api/cursor/accept', CUR)
}
const readCaps = () => CAPS
const readForensics = () => FOR
const readSessions = () => SESS
const readCursorAccept = () => CUR

// ---------- routes ----------
export default function mountGame(app, deps = {}) {
  if (deps.port) PORT = deps.port
  app.get('/api/game', async (req, res) => {
    try {
      if (!cache || Date.now() - cache.at > GAME_TTL || req.query.fresh) {
        await refreshLocal()
        cache = { at: Date.now(), data: await build() }
      }
      res.set('x-cached-at', String(cache.at))
      res.json(cache.data)
    } catch (e) { res.status(500).json({ error: e.message }) }
  })
  // acknowledge unlock toasts so a NEW unlock fires exactly once
  app.post('/api/game/seen', (req, res) => {
    const g = load()
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : Object.keys(g.unlocked)
    g.seen = [...new Set([...(g.seen || []), ...ids])]
    save(g)
    if (cache) cache.data.newlyUnlocked = cache.data.newlyUnlocked.filter(a => !g.seen.includes(a.id))
    res.json({ ok: true, seen: g.seen.length })
  })
}
export { build as gameSnapshot, levelOf, streakOf, EV, bankDerived, lifetimeEvents, mk }
