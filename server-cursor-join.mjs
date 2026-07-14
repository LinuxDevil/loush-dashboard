// The join engine — PLANE B (LOCAL, SELF-ONLY). See the plane rule at the top of server-cursor.mjs.
//
// One spine, one row type, rendered at every altitude above it:
//   session -> git commit -> branch -> ticket key -> PR/JIRA row
//
// Everything here is built from THIS machine's Cursor DB and THIS machine's git checkouts, joined to
// the GitHub/JIRA snapshot server-eng.mjs already fetches and caches for 2h. It is a join, not a fetch.
// It never attributes anything to a human other than the viewer, and no route below takes a user param.
//
// Ticket key comes from the SAME regex server-eng.mjs applies to branch names: /<JIRA_KEY>-\d+/i, built
// from projects.json + the same two defaults. projects.json is READ ONLY here — server-eng.mjs owns it.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { cursorSnapshot, blameRows, windowOf, inWin, weekKey, pct } from './server-cursor.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.DASH_PORT) || 5178

// ---- the ticket regex, reconstructed from the same config server-eng.mjs reads (no import, no edit) ----
const DEFAULT_KEYS = [{ key: 'AIR', repo: 'tajawal/ct-web-flights' }, { key: 'TRN', repo: 'tajawal/ct-web-transport' }]
function projectKeys() {
  const map = new Map(DEFAULT_KEYS.map(p => [p.key, p]))
  try {
    const j = JSON.parse(fs.readFileSync(path.join(HERE, 'projects.json'), 'utf8'))
    for (const p of (Array.isArray(j) ? j : j.projects || [])) {
      const k = (p.key || p.jiraProjectKey || '').toUpperCase()
      if (k) map.set(k, { key: k, repo: p.githubRepo || map.get(k)?.repo || '' })
    }
  } catch {}
  return [...map.values()].map(p => ({ ...p, re: new RegExp(`${p.key}-\\d+`, 'i') }))
}
const ticketOf = (s, keys) => { for (const p of keys) { const m = (s || '').match(p.re); if (m) return m[0].toUpperCase() } return null }

// ---- git: one `git log --all` per FOLDER covering that folder's whole session span, not one per session ----
const git = (folder, args, timeout = 20_000) => {
  const r = spawnSync('git', ['-C', folder, ...args], { timeout, maxBuffer: 32 * 1024 * 1024 })
  return r.status === 0 ? r.stdout.toString() : null
}
function repoCommits(folder, from, to) {
  if (!fs.existsSync(path.join(folder, '.git'))) return []
  const me = (git(folder, ['config', 'user.email']) || '').trim().toLowerCase()
  const out = git(folder, ['log', '--all', '--no-merges', `--since=${Math.floor(from / 1000)}`, `--until=${Math.floor(to / 1000)}`,
    ...(me ? [`--author=${me}`] : []), '--format=%H%x09%ct%x09%ae%x09%s'])
  if (!out) return []
  const commits = out.trim().split('\n').filter(Boolean).map(l => {
    const [sha, ct, email, ...rest] = l.split('\t')
    return { sha, ts: Number(ct) * 1000, email, message: rest.join('\t') }
  })
  if (!commits.length) return []
  // one extra spawn resolves every sha to a branch name — cheaper than `git branch --contains` per commit
  const nr = spawnSync('git', ['-C', folder, 'name-rev', '--name-only', '--refs=refs/heads/*', '--stdin'],
    { input: commits.map(c => c.sha).join('\n'), timeout: 30_000, maxBuffer: 16 * 1024 * 1024 })
  const names = nr.status === 0 ? nr.stdout.toString().trim().split('\n') : []
  commits.forEach((c, i) => {
    const n = (names[i] || '').replace(/[~^].*$/, '').trim()
    // name-rev echoes the sha (or "undefined") for a commit no branch head reaches — that is not a branch
    c.branch = !n || n === 'undefined' || n === c.sha ? null : n
  })
  return commits
}

// ---- the eng snapshot: fetched over the loopback so we reuse server-eng.mjs's own 2h cache and
// touch none of its code. If it is not there (no JIRA creds / no gh), we SAY SO — never a fake zero. ----
let engCache = null
async function engSnapshot() {
  if (engCache && Date.now() - engCache.at < 300_000) return engCache.data
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/eng/snapshot?key=all`)
    const j = await r.json()
    if (!j.available) throw new Error(j.error || 'eng snapshot unavailable')
    engCache = { at: Date.now(), data: j }
    return j
  } catch (e) {
    return { available: false, error: e.message, issues: [], prs: [] }
  }
}

// ---- THE SPINE ----
export async function joinRows(win) {
  const keys = projectKeys()
  const { sessions } = cursorSnapshot()
  const eng = await engSnapshot()
  const prByTicket = {}, issueByKey = {}
  for (const p of eng.prs || []) (prByTicket[p.ticket] ||= []).push(p)
  for (const i of eng.issues || []) issueByKey[i.key] = i

  const inw = sessions.filter(s => inWin(s.lastUpdatedAt, win) && s.folder)
  // blame is Cursor's OWN attribution: exact AI-vs-human lines per commit, and the conversationId(s)
  // that produced them. Where it exists it wins over anything we infer from git.
  const blame = blameRows(null)
  const blameBySha = Object.fromEntries(blame.map(b => [b.sha, b]))
  const blameBySession = {}
  for (const b of blame) for (const sid of b.sessions) (blameBySession[sid] ||= []).push(b)

  // group sessions by folder so git is spawned once per repo, not once per session
  const byFolder = {}
  for (const s of inw) (byFolder[s.folder] ||= []).push(s)

  const rows = []
  for (const [folder, ss] of Object.entries(byFolder)) {
    const from = Math.min(...ss.map(s => s.createdAt || s.lastUpdatedAt))
    const to = Math.max(...ss.map(s => s.lastUpdatedAt))
    const commits = repoCommits(folder, from, to)
    const claimed = new Set()

    for (const s of ss) {
      const start = s.createdAt || s.lastUpdatedAt, end = s.lastUpdatedAt
      // 1) commits Cursor itself attributed to this session — exact
      const mine = [...(blameBySession[s.id] || [])]
      // 2) commits landing inside the session's wall-clock window in that repo — inferred
      for (const c of commits) if (c.ts >= start && c.ts <= end && !mine.some(b => b.sha === c.sha)) mine.push(c)
      for (const c of mine) claimed.add(c.sha)

      if (!mine.length) {
        rows.push({
          sessionId: s.id, name: s.name, folder, repo: null, commitSha: null, branch: null, ticketKey: null,
          pr: null, costCents: s.costCents, aiLines: 0, humanLines: 0, attribution: 'none',
          model: s.model, ts: s.lastUpdatedAt, bucket: 'experimentation', // cost, zero commits
        })
        continue
      }
      for (const c of mine) {
        const b = blameBySha[c.sha]
        const branch = b?.branch || c.branch || null
        const ticketKey = ticketOf(branch, keys) || ticketOf(c.message || b?.message, keys)
        const prs = prByTicket[ticketKey] || []
        const pr = prs.find(p => p.branch === branch) || prs[0] || null
        rows.push({
          sessionId: s.id, name: s.name, folder,
          repo: b?.repo || null, commitSha: c.sha, branch, ticketKey,
          pr: pr ? { num: pr.num, repo: pr.repo, state: pr.state, additions: pr.additions, deletions: pr.deletions, comments: pr.comments, firstReviewDays: pr.firstReviewDays, mergeDays: pr.mergeDays, mergedAt: pr.mergedAt, cycles: pr.cycles ?? null } : null,
          ticket: ticketKey && issueByKey[ticketKey] ? {
            key: ticketKey, type: issueByKey[ticketKey].type, isBug: !!issueByKey[ticketKey].isBug,
            pts: issueByKey[ticketKey].pts ?? null, status: issueByKey[ticketKey].status,
            activeDays: issueByKey[ticketKey].activeDays ?? null, cycleDays: issueByKey[ticketKey].delivery ?? null,
            qaCycles: issueByKey[ticketKey].qaCycles ?? null, live: !!issueByKey[ticketKey].live,
          } : null,
          // cost is the session's, spread across the commits it produced — never double-counted
          costCents: +(s.costCents / mine.length).toFixed(2),
          // blame is exact; without it we fall back to the composer's own line counters and SAY it is estimated
          aiLines: b ? b.aiLinesAdded : s.linesAdded,
          humanLines: b ? b.humanLinesAdded : null,
          attribution: b ? 'cursorBlame' : 'window-inferred',
          model: s.model, ts: c.ts,
          bucket: !ticketKey ? 'toil' : issueByKey[ticketKey]?.isBug ? 'bug' : 'product',
        })
      }
    }
  }
  const unclaimed = blame.filter(b => !rows.some(r => r.commitSha === b.sha)).length
  return {
    rows: rows.sort((a, b) => (b.ts || 0) - (a.ts || 0)),
    sources: {
      eng: eng.available ? {
        available: true, issues: (eng.issues || []).length, prs: (eng.prs || []).length, generatedAt: eng.generatedAt,
        // server-eng.mjs's safe() swallows a gh failure to console.error, so a dead GitHub auth looks
        // like "this team has no PRs". Say it out loud instead of rendering a confident empty table.
        ...((eng.prs || []).length === 0 ? { prsUnavailable: true, note: 'JIRA is joined, GitHub returned ZERO PRs — this is almost certainly a gh auth/fetch failure, not a team with no pull requests. Every PR-derived number (ship rate, review cycles, the AI-heavy cohort) is UNAVAILABLE, not zero.' } : {}),
      } : { available: false, error: eng.error, note: 'ticket/PR columns are BLANK, not zero — JIRA/gh is not reachable' },
      cursorBlame: { commits: blame.length, unmatchedToSession: unclaimed },
      sessions: inw.length,
    },
  }
}

const sum = (a, f) => a.reduce((x, r) => x + (f(r) || 0), 0)
const MIN_N = 20 // both views refuse to render a comparison below n=20 per bucket, and print the n

export default function mountCursorJoin(app) {
  const guard = h => (req, res, next) => Promise.resolve().then(() => h(req, res, next)).catch(e => { try { res.status(500).json({ error: e.message }) } catch {} })

  // item 11: the join's slice of the export hatch. Registered before server-cursor.mjs's handler,
  // and next()s every other kind straight through to it.
  app.get('/api/cursor/export', guard(async (req, res, next) => {
    if (req.query.kind !== 'join') return next()
    const { rows } = await joinRows(windowOf(req.query))
    res.type('application/x-ndjson').set('Content-Disposition', 'attachment; filename="cursor-join.ndjson"')
    for (const r of rows) res.write(JSON.stringify(r) + '\n')
    res.end()
  }))

  // ---- item 5: the raw spine. The IC's "Ship log" reads this directly. ----
  app.get('/api/cursor/join', guard(async (req, res) => {
    const win = windowOf(req.query)
    const { rows, sources } = await joinRows(win)
    res.json({ window: win, plane: 'local (self-only)', sources, rows })
  }))

  // ---- item 4 (denominator half): ship rate = accepted AI lines / merged-PR additions, per REPO+WEEK.
  // The join key is (repo, week) and never (person, week) — there is no per-person value in existence. ----
  app.get('/api/cursor/ship', guard(async (req, res) => {
    const win = windowOf(req.query)
    const eng = await engSnapshot()
    const ai = {} // repo|week -> {lines, commits} from cursorBlame (Cursor's own exact attribution)
    for (const b of blameRows(win)) {
      if (!b.repo || !b.ts) continue
      const k = b.repo + '|' + weekKey(b.ts)
      const e = (ai[k] ||= { lines: 0, commits: 0 })
      e.lines += b.aiLinesAdded; e.commits++
    }
    const cells = {}
    for (const p of (eng.prs || [])) {
      if (!p.mergedAt) continue
      const t = Date.parse(p.mergedAt)
      if (!inWin(t, win)) continue
      const k = p.repo + '|' + weekKey(t)
      const c = (cells[k] ||= { repo: p.repo, week: weekKey(t), mergedAdditions: 0, prs: 0, reviewCycles: [], firstReviewDays: [] })
      c.mergedAdditions += p.additions || 0; c.prs++
      if (p.cycles != null) c.reviewCycles.push(p.cycles)
      if (p.firstReviewDays != null) c.firstReviewDays.push(p.firstReviewDays)
    }
    for (const [k, c] of Object.entries(cells)) {
      const a = ai[k]
      // A week where Cursor scored NO commits has no ship rate — it does not have a ship rate of 0.
      // Emitting 0 here would print "LOW — the tool is a drafting toy" over a week we simply cannot see.
      c.scoredCommits = a?.commits || 0
      c.aiLinesAccepted = a ? a.lines : null
      c.shipRate = a && c.mergedAdditions ? +(a.lines / c.mergedAdditions).toFixed(4) : null
      c.coverage = a ? 'cursorBlame' : 'NO DATA — cursorBlame scored no commits for this repo/week; the rate is unknown, not zero'
      // never rendered alone: a rising ship rate next to rising review cycles is a warning, not a win
      c.medianReviewCycles = pct(c.reviewCycles, 50)
      c.p90FirstReviewDays = pct(c.firstReviewDays, 90)
      c.flag = c.shipRate == null ? null : c.shipRate < 0.15 ? 'LOW — the tool is a drafting toy in this repo'
        : c.shipRate > 0.60 ? 'HIGH — read this beside review depth, not as a trophy' : null
      delete c.reviewCycles; delete c.firstReviewDays
    }
    res.json({
      window: win, granularity: 'repo+week (never per person)',
      engAvailable: eng.available !== false,
      ...(eng.available === false ? { error: eng.error, note: 'ship rate needs merged-PR additions from the eng snapshot — denominator missing, so no rate is emitted' } : {}),
      cells: Object.values(cells).sort((a, b) => b.week.localeCompare(a.week)),
      caveat: 'numerator is cursorBlame agentLinesAdded, which exists for only the commits Cursor scored on this machine — treat as a floor, not a census',
    })
  }))

  // ---- item 6: outcomes. Two renderings of the spine, one pipeline. ----
  app.get('/api/cursor/outcomes', guard(async (req, res) => {
    const win = windowOf(req.query)
    const { rows, sources } = await joinRows(win)

    // PM ALTITUDE — one row per shipped ticket, sortable by $
    const byTicket = {}
    for (const r of rows) {
      if (!r.ticketKey) continue
      const t = (byTicket[r.ticketKey] ||= {
        key: r.ticketKey, type: r.ticket?.type || null, isBug: !!r.ticket?.isBug, pts: r.ticket?.pts ?? null,
        status: r.ticket?.status || null, live: !!r.ticket?.live, cycleDays: r.ticket?.cycleDays ?? null,
        devDays: r.ticket?.activeDays ?? null, qaCycles: r.ticket?.qaCycles ?? null,
        sessions: new Set(), cents: 0, aiLines: 0, humanLines: 0, commits: 0, prs: new Set(),
      })
      t.sessions.add(r.sessionId); t.cents += r.costCents; t.aiLines += r.aiLines
      t.humanLines += r.humanLines || 0; t.commits++
      if (r.pr) t.prs.add(r.pr.repo + '#' + r.pr.num)
    }
    const tickets = Object.values(byTicket).map(t => ({ ...t, sessions: t.sessions.size, prs: [...t.prs] }))
    const p90cents = pct(tickets.map(t => t.cents), 90)
    for (const t of tickets) {
      t.flags = [
        ...(p90cents && t.cents > p90cents && !t.live ? ['EXPENSIVE & STILL OPEN'] : []),
        ...(t.pts >= 5 && t.sessions === 0 ? ['BIG SP, ZERO AI SESSIONS'] : []),
      ]
    }

    // Effort mix by week, split Product / Bug / Toil / Experimentation. Carries BOTH cents and commit
    // counts on purpose: local usageData stopped being written in Jan, so a cents-only mix renders as
    // four flat zeros for every recent week — a chart that says "no work happened". Commits still tell
    // the truth when the money doesn't, and `centsAvailable` says which series is safe to plot.
    const mix = {}
    for (const r of rows) {
      const wk = weekKey(r.ts)
      const m = (mix[wk] ||= { week: wk, centsAvailable: false, cents: { product: 0, bug: 0, toil: 0, experimentation: 0 }, commits: { product: 0, bug: 0, toil: 0, experimentation: 0 } })
      m.cents[r.bucket] += r.costCents
      m.commits[r.bucket]++
      if (r.costCents > 0) m.centsAvailable = true
    }

    // LEAD ALTITUDE — merged PRs only, and the AI-heavy-vs-rest comparison, which REFUSES below n=20
    const merged = rows.filter(r => r.pr && r.pr.mergedAt)
    const seen = new Set(), prRows = []
    for (const r of merged) {
      const k = r.pr.repo + '#' + r.pr.num
      if (seen.has(k)) continue
      seen.add(k)
      const aiFor = merged.filter(x => x.pr.repo + '#' + x.pr.num === k)
      const ai = sum(aiFor, x => x.aiLines)
      prRows.push({
        pr: k, ticketKey: r.ticketKey, additions: r.pr.additions, deletions: r.pr.deletions,
        comments: r.pr.comments, cycles: r.pr.cycles, firstReviewDays: r.pr.firstReviewDays, mergeDays: r.pr.mergeDays,
        aiLines: ai, aiSharePct: r.pr.additions ? +((ai / r.pr.additions) * 100).toFixed(1) : null,
        cents: sum(aiFor, x => x.costCents), sessions: new Set(aiFor.map(x => x.sessionId)).size,
      })
    }
    const heavy = prRows.filter(p => p.aiSharePct >= 30), rest = prRows.filter(p => p.aiSharePct < 30)
    const cohort = g => ({
      n: g.length,
      medianReviewCycles: pct(g.map(p => p.cycles).filter(x => x != null), 50),
      p90FirstReviewDays: pct(g.map(p => p.firstReviewDays).filter(x => x != null), 90),
      commentsPer100Loc: sum(g, p => p.additions) ? +((sum(g, p => p.comments) / sum(g, p => p.additions)) * 100).toFixed(2) : null,
    })
    const underpowered = heavy.length < MIN_N || rest.length < MIN_N

    res.json({
      window: win, sources, plane: 'local (self-only) — no per-person row exists in this payload',
      pm: {
        tickets: tickets.sort((a, b) => b.cents - a.cents),
        costPerShippedTicket: (() => { const live = tickets.filter(t => t.live); return live.length ? +(sum(live, t => t.cents) / live.length).toFixed(1) : null })(),
        shippedTickets: tickets.filter(t => t.live).length,
        effortMix: Object.values(mix).sort((a, b) => a.week.localeCompare(b.week)),
      },
      lead: {
        prs: prRows.sort((a, b) => (b.cycles || 0) - (a.cycles || 0)),
        comparison: {
          aiHeavy: cohort(heavy), rest: cohort(rest), minN: MIN_N, underpowered,
          // this string travels with any copy/export of the table so a weak comparison cannot be laundered
          caveat: underpowered
            ? `UNDERPOWERED: n=${heavy.length} AI-heavy vs n=${rest.length} others, below the n=${MIN_N} floor. No delta is rendered. Correlational either way — Cursor sessions are not randomly assigned to PRs.`
            : `Correlational, not causal. n=${heavy.length} AI-heavy vs n=${rest.length} others. AI-heavy = accepted AI lines >= 30% of PR additions.`,
          delta: underpowered ? null : {
            reviewCycles: (cohort(heavy).medianReviewCycles ?? 0) - (cohort(rest).medianReviewCycles ?? 0),
          },
        },
      },
    })
  }))
}
