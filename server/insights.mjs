import { PROJECT, readMeta, writeMeta } from './dashboard-core.mjs'
import { SIGNALS, deriveLessons } from '../lib/lessons.mjs'
import { applyFilters, hardExclusionRules, parseResultsJson } from '../lib/security-findings.mjs'
import { attributeSession, listWorktrees } from '../lib/worktree.mjs'
import { auditRepo } from '../lib/freeze-audit.mjs'
import { buildMap } from '../lib/design-map.mjs'
import { classifyConversation, tierDistribution } from '../lib/complexity.mjs'
import { classifyError } from '../lib/error-taxonomy.mjs'
import fs from 'node:fs'
import { groupEvents } from '../lib/event-grouping.mjs'
import { contextByTool, contextDiff, BYTES_PER_TOKEN, BYTES_PER_TOKEN_RANGE, TOKEN_ESTIMATE_NOTE, CONTEXT_DIFF_VISIBILITY_NOTE } from '../lib/context-analysis.mjs'
import { scanSkillContent, checkReferencedPaths } from '../lib/governance-guards.mjs'
import { searchTranscripts, detectAbnormalEnd, compactionEvents } from '../lib/session-search.mjs'
import { cacheHitRate, costByProjectBranch, subagentUsage, anonymiseUsage } from '../lib/usage-report.mjs'
import { toCsv } from '../lib/csv.mjs'
import path from 'node:path'

let collectUsage, parsedRecords, transcriptsSince

function detectStacks(dir) {
  const stacks = new Set(), because = {}
  const mark = (tag, why) => { stacks.add(tag); (because[tag] ||= []).push(why) }
  const has = f => { try { return fs.existsSync(path.join(dir, f)) } catch { return false } }
  let pkg = null
  try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) } catch {}
  if (pkg) {
    mark('npm', 'package.json')
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
    if (deps.react || deps['react-dom']) mark('react', 'react in dependencies')
    if (deps['@playwright/test'] || deps.playwright) mark('playwright', 'playwright in dependencies')
    if (Object.keys(deps).some(d => d.includes('supabase'))) mark('supabase', 'supabase in dependencies')
    if (Object.keys(deps).some(d => d.includes('discord'))) mark('discord', 'discord in dependencies')
    if (Object.keys(deps).some(d => /(^|\W)(pg|postgres)/.test(d))) mark('postgres', 'postgres client in dependencies')
  }
  if (has('index.html') || has('public/index.html')) mark('web', 'index.html present')
  if (has('railway.json') || has('railway.toml')) mark('railway', 'railway config present')
  if (has('STATE.md') || has('CONTEXT.md')) mark('ccbf', 'claude-code-build-framework state files present')
  return { stacks: [...stacks].sort(), because }
}

export default function mountInsights(app, deps) {
  ({ collectUsage, parsedRecords, transcriptsSince } = deps)

app.get('/api/worktrees', async (req, res) => {
  try {
    const repo = path.resolve(String(req.query.repo || PROJECT))
    const list = await listWorktrees(repo)
    if (list.status !== 'ok') {
      return res.json({ repo, status: list.status, code: list.code, reason: list.reason, worktrees: null, sessions: [] })
    }
    const { files } = collectUsage()
    const sessions = files.filter(f => !f.isAgent && f.cwd).slice(0, 200).map(f => {
      const wt = attributeSession(f.cwd, list.worktrees)
      return {
        sessionId: path.basename(f.path, '.jsonl'), cwd: f.cwd, mtime: f.mtime, msgs: f.msgs, cost: f.cost,
        worktree: wt ? { path: wt.path, branch: wt.branchName || wt.branch || null, detached: !!wt.detached } : null,
      }
    })
    const counts = {}
    for (const s of sessions) { const k = s.worktree?.path || '(unattributed)'; counts[k] = (counts[k] || 0) + 1 }
    res.json({ repo, status: 'ok', worktrees: list.worktrees, sessions, sessionCounts: counts, argv: list.argv })
  } catch (e) { res.status(e.status || 500).json({ error: e.message }) }
})

// ---------- security findings ----------

app.get('/api/security/findings', (req, res) => {
  try {
    const file = req.query.file ? path.resolve(String(req.query.file)) : null
    if (!file) return res.status(400).json({ error: 'file required — path to a claudecode-results.json artifact' })
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'not found: ' + file })
    const parsed = parseResultsJson(fs.readFileSync(file, 'utf8'))
    const filtered = applyFilters(parsed.findings || [], {})
    res.json({ file, ...parsed, localFilter: filtered, rules: hardExclusionRules().map(r => ({ id: r.id, reason: r.reason })) })
  } catch (e) { res.status(e.status || 500).json({ error: e.message }) }
})

// ---------- session events ----------

app.get('/api/session/events', async (req, res) => {
  try {
    const id = String(req.query.session || '')
    if (!id || !/^[\w.-]+$/.test(id)) return res.status(400).json({ error: 'session id required' })
    const { files } = collectUsage()
    const hit = files.find(f => path.basename(f.path, '.jsonl') === id)
    if (!hit) return res.status(404).json({ error: 'no such session: ' + id })
    const { records, malformed } = await parsedRecords(hit.path)
    const grouped = groupEvents(records, {})
    res.json({ session: id, cwd: hit.cwd, ...grouped, unparsableLines: malformed })
  } catch (e) { res.status(e.status || 500).json({ error: e.message }) }
})

// ---------- lessons ----------

// Search every transcript ever written, not just the listed ones. Tool inputs are searched but
// their values are never returned: that is where "which session ran that command" lives, and
// also where a token would be.
app.get('/api/search/sessions', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim()
    if (!q) return res.status(400).json({ error: 'q required' })
    const days = Math.min(365, Number(req.query.days) || 90)
    const { files } = transcriptsSince(Date.now() - days * 24 * 3600_000)
    const hits = []
    let scanned = 0, unparsable = 0
    for (const f of files) {
      const { records, malformed } = await parsedRecords(f)
      if (!records.length) continue
      scanned++; unparsable += malformed
      const r = searchTranscripts(records, q, { limit: 40 })
      for (const h of (r.results || [])) hits.push({ ...h, sessionId: path.basename(f, '.jsonl') })
    }
    hits.sort((a, b) => (b.ts || 0) - (a.ts || 0))
    const CAP = 300
    res.json({ query: q, days, sessionsScanned: scanned, hits: hits.slice(0, CAP), total: hits.length, cap: CAP, truncated: hits.length > CAP, unparsableLines: unparsable })
  } catch (e) { res.status(e.status || 500).json({ error: e.message }) }
})

// Sessions that stopped mid-turn, plus every compaction and what it reclaimed.
app.get('/api/sessions/health', async (req, res) => {
  try {
    const days = Math.min(365, Number(req.query.days) || 30)
    const now = Date.now()
    const { files } = transcriptsSince(now - days * 24 * 3600_000)
    const out = []
    for (const f of files) {
      const { records } = await parsedRecords(f)
      if (!records.length) continue
      const end = detectAbnormalEnd(records, { now })
      const comp = compactionEvents(records)
      out.push({ sessionId: path.basename(f, '.jsonl'), ended: end.ended, reason: end.reason, compactions: comp.events || [] })
    }
    res.json({
      days, sessions: out,
      counts: out.reduce((a, s) => { a[s.ended] = (a[s.ended] || 0) + 1; return a }, {}),
      // No compaction exists on this machine, so those field names are inferred from documented
      // shapes rather than observed. Said out loud so a zero is not read as "never compacted".
      compactionFieldsVerified: false,
    })
  } catch (e) { res.status(e.status || 500).json({ error: e.message }) }
})

// Cost by project and branch, cache hit rate, and which subagent type costs the most.
app.get('/api/usage/report', (req, res) => {
  try {
    const { entries, files } = collectUsage()
    const byBranch = costByProjectBranch(files)
    if (req.query.format === 'csv') {
      // Field names taken from the real response shape, not assumed: projects carry `proj`/
      // `label`, branches carry `label` with `branchKnown` distinguishing "no branch" from
      // "not recorded". tokensComplete rides along because the collector only stores `out` per
      // branch, so an incomplete token count must not read as a measured zero.
      const rows = (byBranch.projects || []).flatMap(p => (p.branches || []).map(b => ({
        project: p.label ?? p.proj,
        branch: b.label,
        branchKnown: b.branchKnown,
        cost: b.cost,
        messages: b.msgs,
        outputTokens: b.tokens?.out ?? null,
        tokensComplete: b.tokensComplete,
      })))
      const anon = req.query.anonymised === '1'
      const body = toCsv(anon ? (anonymiseUsage(rows).rows || rows) : rows)
      res.setHeader('content-type', 'text/csv; charset=utf-8')
      res.setHeader('content-disposition', `attachment; filename="usage-by-branch${anon ? '-anonymised' : ''}.csv"`)
      return res.send(body)
    }
    res.json({ cache: cacheHitRate(entries), byProjectBranch: byBranch, subagents: subagentUsage(entries, files) })
  } catch (e) { res.status(e.status || 500).json({ error: e.message }) }
})

// Where the context window actually went, per tool, for one session. Token figures are an
// estimate from byte counts — there is no tokenizer in-process — so the range travels with them.
app.get('/api/context/breakdown', async (req, res) => {
  try {
    const id = String(req.query.session || '')
    if (!id || !/^[\w.-]+$/.test(id)) return res.status(400).json({ error: 'session id required' })
    const { files } = collectUsage()
    const hit = files.find(f => path.basename(f.path, '.jsonl') === id)
    if (!hit) return res.status(404).json({ error: 'no such session: ' + id })
    const { records } = await parsedRecords(hit.path)
    const byTool = contextByTool(records)
    const diff = req.query.diff === '1' ? contextDiff(records) : null
    res.json({
      session: id, byTool, diff,
      estimation: { bytesPerToken: BYTES_PER_TOKEN, range: BYTES_PER_TOKEN_RANGE, note: TOKEN_ESTIMATE_NOTE },
      // System prompt and tool schemas are re-sent every turn and appear in no transcript, so a
      // large share of growth is genuinely unattributable. Saying so beats implying we saw it all.
      visibility: CONTEXT_DIFF_VISIBILITY_NOTE,
    })
  } catch (e) { res.status(e.status || 500).json({ error: e.message }) }
})

// Scans installed skills for instructions that would exfiltrate, bypass governance, or grant
// themselves tools. Local authorship is deliberately NOT a trust exemption.
app.get('/api/security/skill-audit', (req, res) => {
  try {
    const roots = [path.join(process.env.HOME || '', '.claude', 'skills'), path.join(PROJECT, '.claude', 'skills')]
    const out = []
    let scanned = 0
    const walk = d => {
      let entries
      try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        const p2 = path.join(d, e.name)
        if (e.isDirectory()) { walk(p2); continue }
        if (!e.name.endsWith('.md')) continue
        scanned++
        let text
        try { text = fs.readFileSync(p2, 'utf8') } catch { continue }
        const findings = scanSkillContent(text, {})
        if (findings.length) out.push({ file: p2, findings })
      }
    }
    for (const r of roots) walk(r)
    res.json({
      roots, scanned, flagged: out.length, results: out,
      // Every rule errs toward a miss rather than a false accusation, so a clean result means
      // "nothing matched these rules", not "this skill is safe".
      note: 'Rules are deliberately narrow; a clean scan means nothing matched, not that a skill is safe.',
    })
  } catch (e) { res.status(e.status || 500).json({ error: e.message }) }
})

// Every path any config references, checked against the filesystem. A hook that points at a
// deleted script fails silently at runtime; this is what makes that visible.
app.get('/api/gov/references', (req, res) => {
  try {
    const CLAUDE_DIR = path.join(process.env.HOME || '', '.claude')
    const entries = []
    const addSettings = (file, scope) => {
      let j
      try { j = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return }
      for (const [event, groups] of Object.entries(j.hooks || {}))
        for (const g of (Array.isArray(groups) ? groups : []))
          for (const h of (g.hooks || []))
            if (h.command) entries.push({ source: `${scope} settings.json (${event})`, kind: 'hook', path: String(h.command).split(/\s+/)[0].replace(/^["']|["']$/g, '') })
    }
    addSettings(path.join(CLAUDE_DIR, 'settings.json'), 'user')
    addSettings(path.join(PROJECT, '.claude', 'settings.json'), 'project')
    try {
      const cj = JSON.parse(fs.readFileSync(path.join(CLAUDE_DIR, '.claude.json'), 'utf8'))
      for (const [name, cfg] of Object.entries(cj.mcpServers || {}))
        if (cfg?.command) entries.push({ source: `.claude.json mcpServers.${name}`, kind: 'mcp', path: cfg.command })
    } catch {}
    // A bare binary name resolves via PATH, so only absolute/relative paths are checkable —
    // reporting `node` as missing would be noise, not a finding.
    const checkable = entries.filter(e => e.path.includes('/') || e.path.includes('\\'))
    const result = checkReferencedPaths(checkable, p2 => { try { return fs.existsSync(p2.startsWith('~') ? p2.replace('~', process.env.HOME || '') : p2) } catch { return false } })
    res.json({ ...result, skippedPathless: entries.length - checkable.length })
  } catch (e) { res.status(e.status || 500).json({ error: e.message }) }
})

app.get('/api/lessons', async (req, res) => {
  try {
    const days = Math.min(90, Number(req.query.days) || 14)
    const { files } = transcriptsSince(Date.now() - days * 24 * 3600_000)
    const all = [], perSession = []
    for (const f of files) {
      const { records } = await parsedRecords(f)
      if (!records.length) continue
      const r = deriveLessons(records, {})
      if (r.lessons?.length) {
        const sid = path.basename(f, '.jsonl')
        for (const l of r.lessons) all.push({ ...l, sessionId: sid })
        perSession.push({ sessionId: sid, count: r.lessons.length, stats: r.stats })
      }
    }
    all.sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
    res.json({ days, lessons: all, sessions: perSession, signals: SIGNALS })
  } catch (e) { res.status(e.status || 500).json({ error: e.message }) }
})

// ---------- design map ----------

app.get('/api/design-map', (req, res) => {
  try {
    const dsRepo = path.resolve(String(req.query.repo || ''))
    if (!req.query.repo) return res.status(400).json({ error: 'repo required — the path to a design-system checkout' })
    if (!fs.existsSync(dsRepo)) return res.status(404).json({ error: 'repo not found: ' + dsRepo })
    const map = buildMap(dsRepo)
    const rows = Array.isArray(map) ? map : map.rows || []
    res.json({
      repo: dsRepo,
      rows,
      summary: {
        total: rows.length,
        mapped: rows.filter(r => r.figma).length,
        unmapped: rows.filter(r => !r.figma).length,
        collisions: rows.filter(r => r.evidence?.collisionWith?.length).length,
      },
      importFrom: rows[0]?.importFrom ?? null,
    })
  } catch (e) { res.status(e.status || 500).json({ error: e.message }) }
})

// ---------- freeze audit ----------

app.get('/api/gov/freeze-audit', async (req, res) => {
  try {
    const dir = path.resolve(String(req.query.project || PROJECT))
    if (!fs.existsSync(dir)) return res.status(404).json({ error: 'project not found: ' + dir })
    const detected = detectStacks(dir)
    const declared = req.query.stacks != null ? String(req.query.stacks).split(',').map(t => t.trim()).filter(Boolean) : detected.stacks
    const ticked = readMeta().freezeAuditTicked?.[dir] || []
    const audit = await auditRepo(dir, { stacks: declared, ticked })
    res.json({ ...audit, detectedStacks: detected.stacks, stackEvidence: detected.because, declaredStacks: declared, ticked })
  } catch (e) { res.status(e.status || 500).json({ error: e.message }) }
})

app.put('/api/gov/freeze-audit/tick', (req, res) => {
  try {
    const dir = path.resolve(String(req.body?.project || PROJECT))
    const id = String(req.body?.id || '')
    if (!/^FA-\d{3}$/.test(id)) return res.status(400).json({ error: 'id must look like FA-001' })
    const meta = readMeta()
    meta.freezeAuditTicked ||= {}
    const set = new Set(meta.freezeAuditTicked[dir] || [])
    req.body?.ticked === false ? set.delete(id) : set.add(id)
    meta.freezeAuditTicked[dir] = [...set]
    writeMeta(meta)
    res.json({ ok: true, ticked: meta.freezeAuditTicked[dir] })
  } catch (e) { res.status(e.status || 500).json({ error: e.message }) }
})

// ---------- prompt complexity ----------

app.get('/api/complexity', async (req, res) => {
  const days = Math.min(90, Number(req.query.days) || 7)
  const since = Date.now() - days * 24 * 3600_000
  const { files } = transcriptsSince(since)
  const MAX_TURNS = 500
  const turns = []
  let capped = false, unparsable = 0
  for (const f of files) {
    const { records, malformed } = await parsedRecords(f)
    unparsable += malformed
    for (const j of records) {
      if (j.type !== 'user' || j.isSidechain) continue
      const t = Date.parse(j.timestamp || 0)
      if (!t || t < since) continue
      const c = j.message?.content
      const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b?.type === 'text').map(b => b.text).join('\n') : ''
      if (!text.trim()) continue
      if (turns.length >= MAX_TURNS) { capped = true; break }
      turns.push(text)
    }
    if (capped) break
  }
  const results = classifyConversation(turns)
  res.json({
    days, turns: turns.length, turnCap: MAX_TURNS, capped, unparsableLines: unparsable,
    distribution: tierDistribution(results),
    calibrated: true,
    calibration: { method: 'fitted to a hand-labelled fixture set', sampleSize: 21, fixture: 'test/fixtures/complexity-labelled.mjs' },
    caveat: 'Boundaries are fitted to 21 hand-labelled prompts, not to user-confirmed ground truth. Tier counts are directional; disagree with a label and the fixture is where to change it.',
  })
})

// ---------- error taxonomy ----------

app.get('/api/errors', async (req, res) => {
  const days = Math.min(90, Number(req.query.days) || 7)
  const since = Date.now() - days * 24 * 3600_000
  const { base, files } = transcriptsSince(since)
  const byCategory = {}, samples = []
  let scanned = 0, capped = false, unparsable = 0
  const MAX_SAMPLES = 200
  for (const f of files) {
    const proj = path.relative(base, f).split(path.sep)[0]
    const { records, malformed } = await parsedRecords(f)
    unparsable += malformed
    for (const j of records) {
      const t = Date.parse(j.timestamp || 0)
      if (!t || t < since) continue
      const blocks = Array.isArray(j.message?.content) ? j.message.content : []
      for (const b of blocks) {
        if (!b || b.is_error !== true) continue
        scanned++
        const text = typeof b.content === 'string' ? b.content : JSON.stringify(b.content || '')
        const c = classifyError({ message: text, is_error: true })
        const cat = c.category || 'unknown'
        const g = (byCategory[cat] ||= { category: cat, count: 0, retryable: c.retryable })
        g.count++
        if (samples.length < MAX_SAMPLES) samples.push({ t, proj, category: cat, retryable: c.retryable, confidence: c.confidence, text: text.slice(0, 200) })
        else capped = true
      }
    }
  }
  const groups = Object.values(byCategory).sort((a, b) => b.count - a.count)
  res.json({
    days, scanned, groups, samples, unparsableLines: unparsable,
    sampleCap: MAX_SAMPLES, samplesCapped: capped,
    scope: 'tool-level errors recorded in transcripts; provider API errors are not captured here',
  })
})

// ---------- live board ----------
}
