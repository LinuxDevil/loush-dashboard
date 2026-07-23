import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import YAML from 'yaml'

// Memory Recall — read-only search over the "why" of your Claude Code practice.
// Two sources, zero new storage:
//   1. curated memory facts  ~/.claude/projects/<proj>/memory/*.md   (high signal, distilled decisions)
//   2. raw transcripts       ~/.claude/projects/<proj>/**/*.jsonl    (the full record, via ripgrep)
// ponytail: keyword ranking, not embeddings. Add sqlite-vec only if recall quality is bad in practice.

const HOME = os.homedir()
const PROJ_BASE = path.join(HOME, '.claude', 'projects')
const RG = 'rg' // ripgrep — already on this machine; far faster than scanning 360MB in Node

// transcript dir name -> a readable project label (last meaningful path segment)
const projLabel = dir => dir.replace(/^-Users-[^-]+-/, '').split('-').slice(-2).join('-') || dir

function parseFM(src) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src)
  if (!m) return { fm: {}, body: src }
  let fm = {}
  try { fm = YAML.parse(m[1]) || {} } catch { fm = {} }
  return { fm, body: src.slice(m[0].length) }
}

// score a memory file against the query terms; name/description weigh more than body
function scoreMem(terms, hay) {
  let s = 0
  for (const t of terms) {
    if (hay.name.includes(t)) s += 5
    if (hay.desc.includes(t)) s += 4
    const bodyHits = hay.body.split(t).length - 1
    if (bodyHits) s += Math.min(3, bodyHits)
  }
  return s
}

function searchMemories(terms, projFilter) {
  const out = []
  let dirs = []
  try { dirs = fs.readdirSync(PROJ_BASE, { withFileTypes: true }).filter(e => e.isDirectory()) } catch { return out }
  for (const d of dirs) {
    if (projFilter && d.name !== projFilter) continue
    const memDir = path.join(PROJ_BASE, d.name, 'memory')
    let files = []
    try { files = fs.readdirSync(memDir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md') } catch { continue }
    for (const f of files) {
      const p = path.join(memDir, f)
      let raw, st
      try { raw = fs.readFileSync(p, 'utf8'); st = fs.statSync(p) } catch { continue }
      const { fm, body } = parseFM(raw)
      const hay = {
        name: (fm.name || f).toLowerCase(),
        desc: String(fm.description || '').toLowerCase(),
        body: body.toLowerCase(),
      }
      const score = scoreMem(terms, hay)
      if (!score) continue
      out.push({
        source: 'memory',
        name: fm.name || f.replace(/\.md$/, ''),
        description: fm.description || '',
        type: fm.metadata?.type || 'memory',
        project: projLabel(d.name), projDir: d.name,
        mtime: st.mtimeMs, path: p, score,
        excerpt: body.trim().slice(0, 600),
      })
    }
  }
  return out
}

// pull readable text out of a matched transcript JSONL line
function transcriptText(line) {
  try {
    const j = JSON.parse(line)
    if (j.type !== 'user' && j.type !== 'assistant') return null
    const c = j.message?.content
    const text = typeof c === 'string' ? c
      : Array.isArray(c) ? c.filter(b => b.type === 'text').map(b => b.text).join(' ') : ''
    if (!text || text.startsWith('<')) return null // skip system-reminder / tool-result envelopes
    return { role: j.type, text: text.replace(/\s+/g, ' ').trim(), t: j.timestamp ? Date.parse(j.timestamp) : null }
  } catch { return null }
}

function searchTranscripts(query, projFilter, limit = 30) {
  const scope = projFilter ? path.join(PROJ_BASE, projFilter) : PROJ_BASE
  if (!fs.existsSync(scope)) return []
  // fixed-string, case-insensitive, capped per file — rg stays fast even over the full history
  const r = spawnSync(RG, ['-i', '-F', '--json', '-m', '3', '-g', '*.jsonl', query, scope],
    { maxBuffer: 64 * 1024 * 1024, timeout: 15000 })
  if (r.status !== 0 && !r.stdout?.length) return []
  const out = []
  for (const l of String(r.stdout).split('\n')) {
    if (out.length >= limit) break
    if (!l.trim()) continue
    let ev
    try { ev = JSON.parse(l) } catch { continue }
    if (ev.type !== 'match') continue
    const parsed = transcriptText(ev.data.lines.text)
    if (!parsed) continue
    const file = ev.data.path.text
    const projDir = path.relative(PROJ_BASE, file).split(path.sep)[0]
    const i = parsed.text.toLowerCase().indexOf(query.toLowerCase())
    const start = Math.max(0, i - 120)
    out.push({
      source: 'transcript',
      role: parsed.role,
      project: projLabel(projDir), projDir,
      sessionId: path.basename(file, '.jsonl'),
      t: parsed.t, mtime: parsed.t,
      excerpt: (start ? '…' : '') + parsed.text.slice(start, start + 400),
      path: file, score: 1,
    })
  }
  return out
}

// Grounding for inline chat (L1): top curated-memory hits for a query, scoped to a project when it
// has memories, else global. Curated facts only (never raw transcripts) — high-signal + self-authored.
export function retrieveContext(query, projFilter = null, limit = 3) {
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(t => t.length > 2)
  if (!terms.length) return []
  let hits = searchMemories(terms, projFilter)
  if (!hits.length && projFilter) hits = searchMemories(terms, null) // fall back to all projects
  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
    .map(h => ({ name: h.name, path: h.path, excerpt: h.excerpt.replace(/\s+/g, ' ').slice(0, 240) }))
}

export default function mountMemory(app) {
  // list projects that have curated memory, for the filter dropdown
  app.get('/api/memory/projects', (req, res) => {
    const out = []
    let dirs = []
    try { dirs = fs.readdirSync(PROJ_BASE, { withFileTypes: true }).filter(e => e.isDirectory()) } catch {}
    for (const d of dirs) {
      let n = 0
      try { n = fs.readdirSync(path.join(PROJ_BASE, d.name, 'memory')).filter(f => f.endsWith('.md') && f !== 'MEMORY.md').length } catch { continue }
      if (n) out.push({ dir: d.name, label: projLabel(d.name), count: n })
    }
    out.sort((a, b) => b.count - a.count)
    res.json(out)
  })

  // auto-surface: a project's curated memories, newest first — no query.
  // Accepts either the real project path (?path=) or the mangled transcript dir (?project=).
  app.get('/api/memory/recent', (req, res) => {
    const dir = req.query.project || (req.query.path ? String(req.query.path).replace(/[\\/:._]/g, '-') : '')
    const memDir = path.join(PROJ_BASE, dir, 'memory')
    let files = []
    try { files = fs.readdirSync(memDir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md') } catch { return res.json({ project: projLabel(dir), items: [] }) }
    const items = files.map(f => {
      const p = path.join(memDir, f)
      const { fm, body } = parseFM(fs.readFileSync(p, 'utf8'))
      return { name: fm.name || f.replace(/\.md$/, ''), description: fm.description || '', type: fm.metadata?.type || 'memory', mtime: fs.statSync(p).mtimeMs, path: p, excerpt: body.trim().slice(0, 600) }
    }).sort((a, b) => b.mtime - a.mtime).slice(0, Number(req.query.limit) || 6)
    res.json({ project: projLabel(dir), items })
  })

  // GET /api/memory/search?q=...&project=<dir>&sources=memory,transcript
  app.get('/api/memory/search', (req, res) => {
    const q = String(req.query.q || '').trim()
    if (q.length < 2) return res.json({ results: [] })
    const projFilter = req.query.project || null
    const sources = String(req.query.sources || 'memory,transcript').split(',')
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
    const results = []
    if (sources.includes('memory')) results.push(...searchMemories(terms, projFilter))
    if (sources.includes('transcript')) results.push(...searchTranscripts(q, projFilter))
    // memory hits first (curated), then by score, then most recent
    results.sort((a, b) =>
      (a.source === 'memory' ? 0 : 1) - (b.source === 'memory' ? 0 : 1) ||
      b.score - a.score || (b.mtime || 0) - (a.mtime || 0))
    res.json({ results: results.slice(0, 60), q })
  })

  // full body of one memory file, for the expand view
  app.get('/api/memory/file', (req, res) => {
    const p = path.resolve(String(req.query.path || ''))
    if (!p.startsWith(PROJ_BASE + path.sep)) return res.status(403).json({ error: 'out of scope' })
    try { res.json({ content: fs.readFileSync(p, 'utf8') }) }
    catch (e) { res.status(404).json({ error: e.message }) }
  })
}
