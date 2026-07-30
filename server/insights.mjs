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
