import fs from 'node:fs'
import path from 'node:path'

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const listJson = (dir) => { try { return fs.readdirSync(dir).filter(f => f.endsWith('.json')) } catch { return [] } }

// Parse one file, using mtime cache. Returns { val, fromDisk } or throws.
function cachedRead(file, cache) {
  const mt = fs.statSync(file).mtimeMs
  const hit = cache.get(file)
  if (hit && hit.mt === mt) return { val: hit.val, fromDisk: false }
  const val = readJson(file)                 // throws on malformed
  cache.set(file, { mt, val })
  return { val, fromDisk: true }
}

export function parseUsageData(dir, { mtimeCache } = {}) {
  const cache = mtimeCache || new Map()
  let parsed = 0
  const metaDir = path.join(dir, 'session-meta')
  const facetDir = path.join(dir, 'facets')
  let skipped = 0
  const metas = new Map()
  for (const f of listJson(metaDir)) {
    try {
      const { val: m, fromDisk } = cachedRead(path.join(metaDir, f), cache)
      metas.set(m.session_id, m)
      if (fromDisk) parsed++
    }
    catch { skipped++ }
  }
  const sessions = []
  for (const f of listJson(facetDir)) {
    let fa, fromDisk
    try { ({ val: fa, fromDisk } = cachedRead(path.join(facetDir, f), cache)) }
    catch { skipped++; continue }
    const meta = metas.get(fa.session_id)
    if (!meta) { skipped++; continue }       // orphan facet
    sessions.push({ ...meta, ...fa, session_id: fa.session_id })
    if (fromDisk) parsed++
  }
  return { sessions, skipped, parsed }
}

// ext → language, for the handful we care about; unknown ext falls through to itself
const EXT_LANG = { ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript',
  py: 'Python', go: 'Go', rs: 'Rust', java: 'Java', rb: 'Ruby', php: 'PHP', cs: 'C#', c: 'C', cpp: 'C++',
  html: 'HTML', css: 'CSS', scss: 'CSS', json: 'JSON', md: 'Markdown', sh: 'Shell', sql: 'SQL', yml: 'YAML', yaml: 'YAML' }
const RESP_GAP_CAP = 1800 // seconds; longer = user walked away, not a "response time"

// Derive a career session from ONE raw Claude Code transcript (.jsonl). Same shape as parseUsageData
// output, minus the LLM-judged facet fields (outcome/session_type/claude_helpfulness/friction_counts) —
// those only exist once `/insights` has written usage-data. Returns null for empty/noise transcripts.
// item 13 — the session→ticket→PR join key was in the Bash command strings all along.
// `git checkout -b TRN-123-foo`, `git commit -m "TRN-123 …"`, `git branch …` name the ticket;
// `gh pr create` names the PR (its URL comes back in the block's toolUseResult).
// STRONG: the ticket is in a branch/commit — the agent was demonstrably working ON that ticket.
const TICKET_STRONG = /(?:checkout\s+-b|switch\s+-c|commit\s+(?:-\w+\s+)*-m|branch)\s+["']?\S*?([A-Z]{2,10}-\d+)/g
// WEAK: any other git/gh command naming the ticket (e.g. `gh pr create --title "TRN-123 …"`, a push to a
// ticket branch). Still an ARTIFACT-backed join — never a mere prompt mention, which is the wrong-join trap
// career-retro.mjs's linkSessions() was right to refuse.
const TICKET_WEAK = /\b(?:git|gh)\b[^\n|&;]{0,200}?\b([A-Z]{2,10}-\d+)\b/g
const PR_URL = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/
const asText = v => typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v)

function sessionFromTranscript(file, sessionId) {
  const tools = {}, languages = {}
  const tickets = new Set(), prs = new Set()
  let git_commits = 0, git_pushes = 0, interrupts = 0, startTs = null, endTs = null, projectPath = null
  let inTok = 0, outTok = 0, cacheReadTok = 0, cacheWriteTok = 0, model = null
  const responseTimes = []
  let prevAsstT = null, hasActivity = false, sawGhPrCreate = false
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue
    let j; try { j = JSON.parse(line) } catch { continue }
    if (j.cwd && !projectPath) projectPath = j.cwd
    if (j.timestamp) { const t = Date.parse(j.timestamp); if (startTs == null || t < startTs) startTs = t; if (endTs == null || t > endTs) endTs = t }
    const role = j.message?.role, c = j.message?.content
    if (role === 'user') {
      const txt = typeof c === 'string' ? c : Array.isArray(c) ? c.map(b => typeof b === 'string' ? b : b?.text || b?.content || '').join(' ') : ''
      if (txt.includes('[Request interrupted')) interrupts++
      if (prevAsstT != null && j.timestamp) { const g = (Date.parse(j.timestamp) - prevAsstT) / 1000; if (g > 0 && g <= RESP_GAP_CAP) responseTimes.push(Math.round(g)); prevAsstT = null }
    } else if (role === 'assistant') {
      hasActivity = true
      if (j.timestamp) prevAsstT = Date.parse(j.timestamp)
      // real token usage — present on every assistant message and never read until now
      const u = j.message?.usage
      if (u) {
        inTok += u.input_tokens || 0; outTok += u.output_tokens || 0
        cacheReadTok += u.cache_read_input_tokens || 0; cacheWriteTok += u.cache_creation_input_tokens || 0
        model = j.message?.model || model
      }
      if (Array.isArray(c)) for (const b of c) if (b.type === 'tool_use') {
        tools[b.name] = (tools[b.name] || 0) + 1
        if (b.name === 'Bash') {
          const cmd = b.input?.command || ''
          if (/\bgit commit\b/.test(cmd)) git_commits++
          if (/\bgit push\b/.test(cmd)) git_pushes++
          if (/\bgh pr create\b/.test(cmd)) sawGhPrCreate = true
          for (const m of cmd.matchAll(TICKET_STRONG)) tickets.add(m[1].toUpperCase())
          for (const m of cmd.matchAll(TICKET_WEAK)) tickets.add(m[1].toUpperCase())
        }
      }
    }
    // gh pr create prints the PR URL into the tool result — that is the PR half of the join
    if (j.toolUseResult) {
      const m = PR_URL.exec(asText(j.toolUseResult.stdout ?? j.toolUseResult))
      if (m && sawGhPrCreate) prs.add(`${m[1]}#${m[2]}`)
    }
    const sp = j.toolUseResult?.structuredPatch
    if (Array.isArray(sp)) { const e = path.extname(j.toolUseResult?.filePath || '').slice(1).toLowerCase(); if (e) { const l = EXT_LANG[e] || e; languages[l] = (languages[l] || 0) + 1 } }
  }
  if (!hasActivity && !Object.keys(tools).length) return null // noise: no assistant turn, no tools
  return { session_id: sessionId, project_path: projectPath,
    start_time: startTs != null ? new Date(startTs).toISOString() : null,
    end_time: endTs != null ? new Date(endTs).toISOString() : null,
    tool_counts: tools, languages, git_commits, git_pushes,
    tickets: [...tickets], prs: [...prs],
    usage: { in: inTok, out: outTok, cacheRead: cacheReadTok, cacheWrite: cacheWriteTok, model },
    user_interruptions: interrupts, user_response_times: responseTimes, _derived: true }
}

// $ for a session's real token usage. Self-plane only — these numbers exist for exactly one laptop.
const PRICE_PER_M = m => (/opus|fable/.test(m || '') ? 15 : /haiku/.test(m || '') ? 0.8 : 3)
export function sessionCost(u = {}) {
  const p = PRICE_PER_M(u.model)
  return +(((u.in || 0) + (u.out || 0) * 5 + (u.cacheRead || 0) * 0.1 + (u.cacheWrite || 0) * 1.25) / 1e6 * p).toFixed(4)
}
// item 13 — ticket → {sessions, tokens, usd, prs}. The sink (career.json `ticketLinks`) already exists
// and is already passed to ticketRetro(); it was simply never populated.
export function ticketLinksFrom(sessions = []) {
  const links = {}
  for (const s of sessions) {
    for (const t of s.tickets || []) {
      const l = (links[t] ||= { ticket: t, sessions: [], prs: [], tokens: 0, usd: 0 })
      l.sessions.push({ id: s.session_id, at: s.start_time, endAt: s.end_time || null, project: s.project_path || null, via: 'branch/commit' })
      l.prs = [...new Set([...l.prs, ...(s.prs || [])])]
      l.tokens += (s.usage?.in || 0) + (s.usage?.out || 0) + (s.usage?.cacheRead || 0) + (s.usage?.cacheWrite || 0)
      l.usd = +(l.usd + sessionCost(s.usage)).toFixed(4)
    }
  }
  const linked = sessions.filter(s => (s.tickets || []).length).length
  return { links, coverage: sessions.length ? +(linked / sessions.length).toFixed(3) : 0, linkedSessions: linked, totalSessions: sessions.length }
}

// Walk ~/.claude/projects/**/*.jsonl (skipping subagent transcripts) → derived career sessions.
// mtime+size cached per file so refresh is incremental like the facet path.
export function deriveSessionsFromTranscripts(projectsDir, { mtimeCache } = {}) {
  const cache = mtimeCache || new Map()
  const sessions = []
  let parsed = 0, skipped = 0
  const walk = (d) => {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (e.name !== 'subagents') walk(p); continue }
      if (!e.name.endsWith('.jsonl') || p.includes('subagents')) continue
      let st; try { st = fs.statSync(p) } catch { continue }
      const hit = cache.get(p)
      let session
      if (hit && hit.mt === st.mtimeMs && hit.size === st.size) session = hit.session
      else {
        try { session = sessionFromTranscript(p, path.basename(p, '.jsonl')) } catch { skipped++; continue }
        cache.set(p, { mt: st.mtimeMs, size: st.size, session })
        parsed++
      }
      if (session) sessions.push(session)
    }
  }
  walk(projectsDir)
  return { sessions, parsed, skipped }
}

const bump = (obj, key, by = 1) => { if (key == null) return; obj[key] = (obj[key] || 0) + by }
const mergeCounts = (into, from) => { for (const [k, v] of Object.entries(from || {})) bump(into, k, v) }

export function groupByProject(sessions) {
  const g = new Map()
  for (const s of sessions) {
    const key = s.project_path || '(unknown)'
    if (!g.has(key)) g.set(key, { sessions: [], totals: {
      sessions: 0, gitCommits: 0, gitPushes: 0, interruptions: 0, responseTimes: [],
      outcomes: {}, friction: {}, sessionTypes: {}, tools: {}, languages: {},
    } })
    const p = g.get(key); const t = p.totals
    p.sessions.push(s)
    t.sessions++; t.gitCommits += s.git_commits || 0; t.gitPushes += s.git_pushes || 0
    t.interruptions += s.user_interruptions || 0
    t.responseTimes.push(...(s.user_response_times || []))
    bump(t.outcomes, s.outcome); bump(t.sessionTypes, s.session_type)
    mergeCounts(t.friction, s.friction_counts); mergeCounts(t.tools, s.tool_counts); mergeCounts(t.languages, s.languages)
  }
  for (const p of g.values()) {
    const rt = p.totals.responseTimes
    p.totals.avgResponseSec = rt.length ? rt.reduce((a, b) => a + b, 0) / rt.length : 0
    p.totals.interruptRate = p.totals.sessions ? p.totals.interruptions / p.totals.sessions : 0
  }
  return g
}
