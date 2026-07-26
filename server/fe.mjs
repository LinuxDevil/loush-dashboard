// server-fe.mjs — /api/fe/* — "The Working Set"
//
// WHY THIS EXISTS
// Five independent audits of this repo reached the same conclusion: the expensive parsing was already
// done and pointed at the wrong subject. server.mjs parses Edit/Write `structuredPatch` blocks — it has
// the file path AND up to 24 lines of real diff text per agent edit — and renders "lines · 7d", one
// integer summed across every project you own. Meanwhile nothing anywhere joins that history to the
// codebase it happened to.
//
// This module performs that join. It is the only thing in the app that answers a question about YOUR
// CODE rather than about your harness, your tokens, or your JIRA board.
//
// CONSTRAINTS (deliberate, and the reason the rest of the app fails the daily-use test)
//   * ZERO external config. No JIRA, no gh, no Slack, no team file, no tokens. One engineer, one laptop,
//     valuable five minutes after install. Everything here comes from ~/.claude transcripts + the repo on disk.
//   * NULL IS NOT ZERO. Every field that has no data is `null` and renders as "—". A dashboard that shows
//     a green 0% when it has never read a file is lying. `n` travels with every aggregate.
//   * NO MAGIC WEIGHTS IN THE DARK. The one ranking heuristic (REWORK_WEIGHTS) is exported, its inputs
//     are returned alongside the score, and the UI shows the arithmetic. It is labelled a rank, not a metric.
//   * EVERY ROW ENDS IN AN ACTION. Open the dossier, resume the session that made the mess, start a new
//     session pre-loaded with the blast radius, or mute the file. No dead-end numbers.
//
// PLANE: this is plane B (self-only harness data) joined to local source. No endpoint here accepts a
// user/machine/engineer parameter and no aggregate here is keyed by a person. Same boundary as server.mjs.

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'

const HOME = os.homedir()
const CLAUDE = path.join(HOME, '.claude')
const STORE = path.join(CLAUDE, 'fe-worksheet.json') // mutes only — inside the existing ~/.claude jail

// ---------------------------------------------------------------------------
// pure helpers (exported for test/fe-workingset.test.js)
// ---------------------------------------------------------------------------

export const SOURCE_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte'])
export const STYLE_EXTS = new Set(['.css', '.scss', '.sass', '.less', '.styl'])
export const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache',
  'coverage', '.nyc_output', 'vendor', '__snapshots__', '.venv', 'venv', '.output', 'storybook-static',
])

// Files that legitimately have zero importers — never flag these as orphans.
// `[cm]?` matters: without it `server.mjs` — this app's own entry point — is reported as dead code.
const ENTRY_RE = /(^|\/)(main|index|app|root|entry|server|middleware|layout|page|route|loading|error|not-found|template|default)\.[cm]?[jt]sx?$/i
const CONFIG_RE = /(^|\/)[\w.-]*\.config\.[cm]?[jt]sx?$/i
const ROUTE_DIR_RE = /(^|\/)(pages|app|routes)\//

export const isTestFile = f => /\.(test|spec)\.[cm]?[jt]sx?$/i.test(f) || /(^|\/)__tests__\//.test(f)
export const isStoryFile = f => /\.stories\.([cm]?[jt]sx?|mdx)$/i.test(f) || /(^|\/)__stories__\//.test(f)

export function classify(rel) {
  const ext = path.extname(rel).toLowerCase()
  if (isTestFile(rel)) return 'test'
  if (isStoryFile(rel)) return 'story'
  if (STYLE_EXTS.has(ext)) return 'style'
  if (SOURCE_EXTS.has(ext)) return 'source'
  if (ext === '.json' || ext === '.md' || ext === '.mdx') return 'doc'
  return 'other'
}

// Strip line/block comments so a commented-out import is not counted. Cheap and good enough;
// it is not an AST and does not claim to be — string literals containing "//" survive as noise.
const stripComments = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const IMPORT_RES = [
  // The clause before `from` must not cross a quote. With `[\s\S]*?` a side-effect import
  // (`import './a.css'`) gets swallowed into the NEXT statement's `from` and silently vanishes —
  // caught by test/fe-workingset.test.js. Newlines are still allowed, for multi-line destructuring.
  /\bimport\s+(?:[^'"]*?\sfrom\s*)??['"]([^'"\n]+)['"]/g, // import x from 'y' | import 'y'
  /\bexport\s+(?:\*|\{[\s\S]*?\})\s*from\s*['"]([^'"\n]+)['"]/g, // re-exports
  /\brequire\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  /\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/g, // dynamic import — code-splitting boundaries count
]

/** Every module specifier a source file references. Order-preserving, de-duplicated. */
export function extractImports(src) {
  const clean = stripComments(String(src || ''))
  const out = []
  const seen = new Set()
  for (const re of IMPORT_RES) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(clean))) {
      const s = m[1].trim()
      if (!s || seen.has(s)) continue
      seen.add(s)
      out.push(s)
    }
  }
  return out
}

const RESOLVE_EXTS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte']

/**
 * Resolve a specifier to a file we actually walked. Relative paths and the two alias conventions that
 * cover most FE repos (`@/` and `~/` → the repo's src root). Bare specifiers are external → null.
 * `fileSet` is the set of POSIX-style repo-relative paths that exist.
 */
export function resolveSpecifier(fromRel, spec, fileSet, aliasRoot = 'src') {
  if (!spec || typeof spec !== 'string') return null
  let base
  if (spec.startsWith('./') || spec.startsWith('../')) {
    base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec))
  } else if (spec.startsWith('@/') || spec.startsWith('~/')) {
    base = path.posix.normalize(path.posix.join(aliasRoot, spec.slice(2)))
  } else if (spec.startsWith('/')) {
    base = spec.replace(/^\/+/, '')
  } else {
    return null // bare specifier: npm dependency, not our code
  }
  if (base.startsWith('..')) return null
  for (const e of RESOLVE_EXTS) { const c = base + e; if (fileSet.has(c)) return c }
  for (const e of RESOLVE_EXTS.slice(1)) { const c = path.posix.join(base, 'index' + e); if (fileSet.has(c)) return c }
  return null
}

/**
 * sources: Map<relPath, sourceText>. fileSet: Set<relPath> of every file present (incl. non-source).
 * Returns importers (who imports me) and imports (who I import), plus resolution stats so the UI can
 * say how much of the graph it actually managed to resolve instead of implying certainty.
 */
export function buildImportGraph(sources, fileSet, aliasRoot = 'src') {
  const importers = new Map()
  const imports = new Map()
  let resolved = 0, external = 0, unresolved = 0
  for (const [rel, src] of sources) {
    const mine = new Set()
    for (const spec of extractImports(src)) {
      const target = resolveSpecifier(rel, spec, fileSet, aliasRoot)
      if (!target) {
        if (spec.startsWith('.') || spec.startsWith('@/') || spec.startsWith('~/')) unresolved++
        else external++
        continue
      }
      if (target === rel) continue
      resolved++
      mine.add(target)
      if (!importers.has(target)) importers.set(target, new Set())
      importers.get(target).add(rel)
    }
    imports.set(rel, mine)
  }
  return { importers, imports, stats: { resolved, external, unresolved } }
}

/** Does `rel` have a colocated story / test? Looks for sibling and __tests__/__stories__ conventions. */
export function siblingsFor(rel, fileSet) {
  const dir = path.posix.dirname(rel)
  const stem = path.posix.basename(rel).replace(/\.[cm]?[jt]sx?$|\.vue$|\.svelte$/i, '')
  const has = suffixes => suffixes.some(s => fileSet.has(path.posix.join(dir, stem + s)) ||
    fileSet.has(path.posix.join(dir, '__tests__', stem + s)) ||
    fileSet.has(path.posix.join(dir, '__stories__', stem + s)))
  const exts = ['.ts', '.tsx', '.js', '.jsx']
  return {
    hasTest: has([...exts.map(e => '.test' + e), ...exts.map(e => '.spec' + e)]),
    hasStory: has([...exts.map(e => '.stories' + e), '.stories.mdx']),
  }
}

// The one ranking heuristic in this module. Exported, shown in the UI, and every input is returned
// with the row so the number is never a black box.
//
//   revisitSessions  you came BACK to this file in a NEW session          (the agent did not get it right)
//   revisitDays      you came back on a DIFFERENT day                     (it was not one sitting)
//   failures         tool errors attributed to this exact file            (it actively fought you)
//   extraEdits       edits beyond one per session                         (thrash within a session)
//
// A file edited in exactly one session scores `null`, not 0 — that is work, not rework, and calling it
// 0 would rank it against files we do have evidence about.
export const REWORK_WEIGHTS = { revisitSession: 3, revisitDay: 2, failure: 2, extraEdit: 1 }
export const REWORK_MIN_SESSIONS = 2

export function reworkScore(row) {
  if (!row || (row.sessionCount || 0) < REWORK_MIN_SESSIONS) return null
  const w = REWORK_WEIGHTS
  const parts = {
    revisitSessions: Math.max(0, row.sessionCount - 1),
    revisitDays: Math.max(0, (row.days || 1) - 1),
    failures: row.failures || 0,
    extraEdits: Math.max(0, (row.edits || 0) - row.sessionCount),
  }
  return {
    score: parts.revisitSessions * w.revisitSession + parts.revisitDays * w.revisitDay +
      parts.failures * w.failure + parts.extraEdits * w.extraEdit,
    parts,
  }
}

const dayKey = t => { const d = new Date(t); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate() }

/**
 * The join. edits/errors are already-filtered arrays scoped to one repo.
 *   edits:  [{t, file(abs), add, del, hunk, sessionId, proj}]
 *   errors: [{t, file(abs), tool, text, sessionId}]
 * Returns one row per file the agent EDITED (reads are not evidence of difficulty).
 */
export function aggregateFiles({ edits = [], errors = [], root }) {
  const rows = new Map()
  const rel = abs => path.relative(root, abs).split(path.sep).join('/')
  const get = abs => {
    const r = rel(abs)
    let x = rows.get(r)
    if (!x) rows.set(r, x = {
      rel: r, abs, edits: 0, add: 0, del: 0, sessions: new Set(), dayset: new Set(),
      firstT: null, lastT: null, failures: 0, errSamples: [],
    })
    return x
  }
  for (const e of edits) {
    if (!e.file || !e.file.startsWith(root + path.sep)) continue
    const x = get(e.file)
    x.edits++
    x.add += e.add || 0
    x.del += e.del || 0
    if (e.sessionId) x.sessions.add(e.sessionId)
    if (e.t) { x.dayset.add(dayKey(e.t)); x.firstT = x.firstT == null ? e.t : Math.min(x.firstT, e.t); x.lastT = Math.max(x.lastT || 0, e.t) }
  }
  for (const er of errors) {
    if (!er.file || !er.file.startsWith(root + path.sep)) continue
    const r = rel(er.file)
    const x = rows.get(r)
    if (!x) continue // an error on a file the agent never successfully edited is not rework evidence
    x.failures++
    if (x.errSamples.length < 5) x.errSamples.push({ t: er.t, tool: er.tool, text: er.text, sessionId: er.sessionId })
  }
  return [...rows.values()].map(x => {
    const base = {
      rel: x.rel, abs: x.abs, kind: classify(x.rel),
      edits: x.edits, add: x.add, del: x.del,
      sessionCount: x.sessions.size, sessionIds: [...x.sessions],
      days: x.dayset.size, firstT: x.firstT, lastT: x.lastT,
      failures: x.failures, errSamples: x.errSamples,
    }
    const rw = reworkScore(base)
    return { ...base, score: rw ? rw.score : null, scoreParts: rw ? rw.parts : null }
  })
}

/**
 * Is this file exercised by a test / rendered by a story? Two signals, in order of strength:
 *   1. something that IS a test (or story) imports it — direct evidence, from the graph
 *   2. a file with the colocated naming convention exists next to it — weaker, but catches
 *      frameworks where the runner discovers files rather than importing them
 * Naming convention alone is not enough: `test/fe-workingset.test.js` covers `server-fe.mjs` and
 * shares no stem with it, so a sibling-only check reports "untested" about a tested file.
 */
export function coverageOf(rel, importerNames = [], fileSet = new Set()) {
  const testedBy = importerNames.filter(isTestFile)
  const storiedBy = importerNames.filter(isStoryFile)
  const sib = siblingsFor(rel, fileSet)
  return {
    hasTest: testedBy.length > 0 || sib.hasTest,
    hasStory: storiedBy.length > 0 || sib.hasStory,
    testedBy: testedBy.slice(0, 10),
    storiedBy: storiedBy.slice(0, 10),
  }
}

/** An orphan candidate is a source file nobody imports that is not an entry point, route, config, test or story. */
export function isOrphanCandidate(rel, importerCount) {
  if (importerCount !== 0) return false
  if (classify(rel) !== 'source') return false
  if (ENTRY_RE.test(rel) || CONFIG_RE.test(rel) || ROUTE_DIR_RE.test(rel)) return false
  return true
}

/** Prompt → edit → error, in time order, for one file. The causal chain git never recorded. */
export function buildTimeline({ file, edits, errors, prompts, limit = 60 }) {
  const ev = []
  for (const e of edits) if (e.file === file) ev.push({ kind: 'edit', t: e.t, sessionId: e.sessionId, add: e.add, del: e.del, hunk: e.hunk })
  for (const er of errors) if (er.file === file) ev.push({ kind: 'error', t: er.t, sessionId: er.sessionId, tool: er.tool, text: er.text })
  // the user prompt that immediately precedes an edit, within the same session — the instruction that caused it
  const bySession = new Map()
  for (const p of prompts) {
    if (!bySession.has(p.sessionId)) bySession.set(p.sessionId, [])
    bySession.get(p.sessionId).push(p)
  }
  const seen = new Set()
  for (const e of ev) {
    if (e.kind !== 'edit') continue
    const ps = bySession.get(e.sessionId)
    if (!ps) continue
    let best = null
    for (const p of ps) if (p.t <= e.t && (!best || p.t > best.t)) best = p
    if (!best) continue
    const key = best.sessionId + ':' + best.t
    if (seen.has(key)) continue
    seen.add(key)
    ev.push({ kind: 'prompt', t: best.t, sessionId: best.sessionId, text: best.text })
  }
  ev.sort((a, b) => a.t - b.t || (a.kind === 'prompt' ? -1 : 1))
  return ev.slice(-limit)
}

/** The paste-ready preamble: what this file is, who depends on it, and how the agent last changed it. */
export function contextBundle({ rel, importers = [], importsOf = [], hunks = [], failures = [] }) {
  const L = []
  L.push(`## Working context for \`${rel}\``, '')
  L.push(importers.length
    ? `**Blast radius — ${importers.length} file(s) import this. Changing its exports affects:**\n${importers.map(i => `- \`${i}\``).join('\n')}`
    : '**Blast radius — nothing in this repo imports it.** Verify it is an entry point before assuming it is safe to change.')
  L.push('')
  if (importsOf.length) L.push(`**It depends on:** ${importsOf.map(i => `\`${i}\``).join(', ')}`, '')
  if (failures.length) {
    L.push('**Tool errors previously hit on this exact file — do not repeat these:**')
    for (const f of failures.slice(0, 5)) L.push(`- \`${f.tool}\`: ${f.text}`)
    L.push('')
  }
  if (hunks.length) {
    L.push('**The most recent agent edits to this file:**', '')
    for (const h of hunks.slice(0, 3)) L.push('```diff', h, '```', '')
  }
  return L.join('\n')
}

// ---------------------------------------------------------------------------
// IO — async, capped, cached. (server.mjs makes 424 blocking sync fs calls; this module makes none
// on the request path. A dashboard that stalls its own event loop to draw a chart is not a tool.)
// ---------------------------------------------------------------------------

const WALK_CAP = 5000
const MAX_SRC_BYTES = 400_000
const repoCache = new Map() // root -> {at, data}
const REPO_TTL = 60_000

async function walkRepo(root) {
  const files = []
  const sources = new Map()
  let truncated = false
  const walk = async dir => {
    if (files.length >= WALK_CAP) { truncated = true; return }
    let ents
    try { ents = await fsp.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (files.length >= WALK_CAP) { truncated = true; return }
      if (e.name.startsWith('.') && e.name !== '.storybook') continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (!IGNORE_DIRS.has(e.name)) await walk(p); continue }
      if (!e.isFile()) continue
      const rel = path.relative(root, p).split(path.sep).join('/')
      files.push(rel)
      if (SOURCE_EXTS.has(path.extname(e.name).toLowerCase())) {
        try {
          const st = await fsp.stat(p)
          if (st.size <= MAX_SRC_BYTES) sources.set(rel, await fsp.readFile(p, 'utf8'))
        } catch {}
      }
    }
  }
  await walk(root)
  return { files, sources, truncated }
}

const git = (root, args) => new Promise(resolve => {
  execFile('git', args, { cwd: root, maxBuffer: 8 << 20, timeout: 10_000 }, (err, out) => resolve(err ? null : out))
})

async function dirtyFiles(root) {
  const out = await git(root, ['status', '--porcelain'])
  if (out == null) return null // not a git repo / git missing → null, NOT an empty array
  return out.split('\n').map(l => l.slice(3).trim()).filter(Boolean).map(l => l.split(' -> ').pop())
}

async function repoIndex(root, fresh) {
  const hit = repoCache.get(root)
  if (hit && !fresh && Date.now() - hit.at < REPO_TTL) return hit.data
  const { files, sources, truncated } = await walkRepo(root)
  const fileSet = new Set(files)
  const aliasRoot = files.some(f => f.startsWith('src/')) ? 'src' : files.some(f => f.startsWith('app/')) ? 'app' : ''
  const graph = buildImportGraph(sources, fileSet, aliasRoot)
  const dirty = await dirtyFiles(root)
  const data = { files, fileSet, graph, dirty: dirty ? new Set(dirty) : null, truncated, aliasRoot, at: Date.now() }
  repoCache.set(root, { at: Date.now(), data })
  return data
}

const readStore = () => { try { return JSON.parse(fs.readFileSync(STORE, 'utf8')) } catch { return { muted: {} } } }

// ---------------------------------------------------------------------------
// mount
// ---------------------------------------------------------------------------

export default function mountFe(app, deps = {}) {
  const { scanTranscripts, failStats, backup } = deps
  if (typeof scanTranscripts !== 'function' || typeof failStats !== 'function')
    throw new Error('mountFe requires { scanTranscripts, failStats }')

  // Everything the agent has ever edited, grouped by the repo it happened in. Zero config: the repo
  // list comes from the cwd recorded in your own transcripts.
  const harvest = days => {
    const all = scanTranscripts()
    const cutoff = days ? Date.now() - days * 86_400_000 : 0
    const cwdOf = new Map()
    for (const s of all.sessions) if (s.sessionId && s.cwd) cwdOf.set(s.sessionId, s.cwd)
    const edits = all.edits.filter(e => e.t >= cutoff && typeof e.file === 'string' && path.isAbsolute(e.file))
    const errors = []
    for (const rec of failStats()) {
      for (const er of rec.errs || []) {
        if (er.t < cutoff || !er.file || !path.isAbsolute(er.file)) continue
        errors.push({ ...er, sessionId: rec.sessionId })
      }
    }
    const prompts = all.prompts.filter(p => p.t >= cutoff)
    return { all, edits, errors, prompts, cwdOf }
  }

  // Which repos do we have agent history for? Ranked by edit volume, not session count —
  // "where did the agent change code" beats "where did you sit".
  const repoList = ({ edits, cwdOf }) => {
    const byRoot = new Map()
    const roots = [...new Set(cwdOf.values())].filter(c => { try { return fs.statSync(c).isDirectory() } catch { return false } })
    // longest-prefix match so a session started in a subdirectory still attributes to the repo root
    const sorted = [...roots].sort((a, b) => b.length - a.length)
    for (const e of edits) {
      const root = sorted.find(r => e.file.startsWith(r + path.sep))
      if (!root) continue
      const x = byRoot.get(root) || { root, name: path.basename(root), edits: 0, files: new Set(), sessions: new Set(), lastT: 0 }
      x.edits++; x.files.add(e.file); if (e.sessionId) x.sessions.add(e.sessionId); x.lastT = Math.max(x.lastT, e.t || 0)
      byRoot.set(root, x)
    }
    return [...byRoot.values()]
      .map(x => ({ root: x.root, name: x.name, edits: x.edits, files: x.files.size, sessions: x.sessions.size, lastT: x.lastT }))
      .sort((a, b) => b.lastT - a.lastT)
  }

  app.get('/api/fe/repos', (req, res) => {
    try {
      const h = harvest(Number(req.query.days) || 90)
      res.json({ repos: repoList(h), scannedEdits: h.edits.length })
    } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
  })

  app.get('/api/fe/workingset', async (req, res) => {
    try {
      const days = Math.max(1, Math.min(365, Number(req.query.days) || 30))
      const h = harvest(days)
      const repos = repoList(h)
      if (!repos.length) {
        // Honest empty state. Not a green all-clear, not a zero — a statement about what is missing.
        return res.json({
          available: false,
          reason: 'no-agent-history',
          detail: 'No Claude Code edit history found on this machine in the selected window. This screen is built entirely from transcripts in ~/.claude/projects — with none, there is nothing to report. It will populate the first time an agent edits a file in a repo.',
          repos: [], windowDays: days,
        })
      }
      const root = req.query.root && repos.some(r => r.root === req.query.root) ? req.query.root : repos[0].root
      const idx = await repoIndex(root, req.query.fresh === '1')
      const rows = aggregateFiles({ edits: h.edits, errors: h.errors, root })
      const muted = readStore().muted || {}

      for (const r of rows) {
        const importerSet = idx.graph.importers.get(r.rel)
        const known = idx.fileSet.has(r.rel)
        // A file we never walked (deleted, gitignored, outside the walk cap) gets null — not 0 importers.
        r.exists = known
        r.importers = known ? (importerSet ? importerSet.size : 0) : null
        r.importerFiles = known && importerSet ? [...importerSet].slice(0, 50) : null
        r.dirty = idx.dirty ? idx.dirty.has(r.rel) : null
        if (known && r.kind === 'source') {
          const cov = coverageOf(r.rel, importerSet ? [...importerSet] : [], idx.fileSet)
          r.hasTest = cov.hasTest
          r.hasStory = cov.hasStory
          r.testedBy = cov.testedBy
          r.storiedBy = cov.storiedBy
        } else { r.hasTest = null; r.hasStory = null; r.testedBy = null; r.storiedBy = null }
        // A test or story importing you is not blast radius — it is coverage. Product code that
        // depends on you is the number that should make you careful.
        // 0 when we walked the file and nothing imports it; null ONLY when we never saw the file.
        r.productImporters = !known ? null
          : importerSet ? [...importerSet].filter(f => !isTestFile(f) && !isStoryFile(f)).length : 0
        r.orphan = known ? isOrphanCandidate(r.rel, r.importers) : null
        r.muted = !!muted[root + '::' + r.rel]
        // exposure = how much PRODUCT code is downstream of a file the agent has been struggling with
        r.exposure = r.productImporters != null && r.score != null ? r.score * (1 + r.productImporters) : null
      }

      rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.edits - a.edits || b.lastT - a.lastT)

      const source = rows.filter(r => r.kind === 'source' && r.exists)
      res.json({
        available: true,
        root,
        repos,
        windowDays: days,
        generatedAt: Date.now(),
        weights: REWORK_WEIGHTS,
        minSessions: REWORK_MIN_SESSIONS,
        graph: {
          walkedFiles: idx.files.length,
          sourceFiles: idx.graph.imports.size,
          truncated: idx.truncated,
          walkCap: WALK_CAP,
          aliasRoot: idx.aliasRoot || null,
          ...idx.graph.stats,
        },
        counts: {
          filesTouched: rows.length,
          sourceTouched: source.length,
          rework: rows.filter(r => r.score != null && !r.muted).length,
          missingTest: source.length ? source.filter(r => r.hasTest === false).length : null,
          missingStory: source.length ? source.filter(r => r.hasStory === false).length : null,
          orphans: rows.filter(r => r.orphan).length,
          dirty: idx.dirty ? idx.dirty.size : null,
          gone: rows.filter(r => r.exists === false).length,
        },
        rows,
      })
    } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
  })

  app.get('/api/fe/dossier', async (req, res) => {
    try {
      const root = String(req.query.root || '')
      const rel = String(req.query.file || '')
      if (!root || !rel) return res.status(400).json({ error: 'root and file are required' })
      const abs = path.resolve(root, rel)
      if (!abs.startsWith(path.resolve(root) + path.sep)) return res.status(403).json({ error: 'file outside repo root' })

      const days = Math.max(1, Math.min(365, Number(req.query.days) || 90))
      const h = harvest(days)
      const idx = await repoIndex(root, false)
      const timeline = buildTimeline({ file: abs, edits: h.edits, errors: h.errors, prompts: h.prompts })
      const importerSet = idx.graph.importers.get(rel)
      const importers = importerSet ? [...importerSet] : []
      const importsOf = [...(idx.graph.imports.get(rel) || [])]
      const hunks = timeline.filter(e => e.kind === 'edit' && e.hunk).slice(-3).reverse().map(e => e.hunk)
      const failures = timeline.filter(e => e.kind === 'error').slice(-5)

      // Sessions that touched this file, newest first — this is what the resume action targets.
      const sessions = []
      const seen = new Set()
      for (const e of [...timeline].reverse()) {
        if (!e.sessionId || seen.has(e.sessionId)) continue
        seen.add(e.sessionId)
        const s = h.all.sessions.find(x => x.sessionId === e.sessionId)
        sessions.push({ sessionId: e.sessionId, cwd: s?.cwd || root, branch: s?.branch || null, last: s?.last || e.t })
      }

      res.json({
        root, rel, abs,
        exists: idx.fileSet.has(rel),
        kind: classify(rel),
        importers, importsOf,
        coverage: idx.fileSet.has(rel) ? coverageOf(rel, importers, idx.fileSet) : null,
        dirty: idx.dirty ? idx.dirty.has(rel) : null,
        timeline,
        sessions: sessions.slice(0, 10),
        bundle: contextBundle({ rel, importers, importsOf, hunks, failures }),
      })
    } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
  })

  // Mute a file so a known-noisy path (a generated file, a lockfile you keep regenerating) stops
  // dominating the rank. Backed up through the same versioned path as every other write in this app.
  app.post('/api/fe/mute', (req, res) => {
    try {
      const { root, file, muted } = req.body || {}
      if (!root || !file) return res.status(400).json({ error: 'root and file are required' })
      const store = readStore()
      store.muted ||= {}
      const key = root + '::' + file
      if (muted === false) delete store.muted[key]
      else store.muted[key] = { at: Date.now() }
      if (typeof backup === 'function') backup(STORE)
      fs.mkdirSync(path.dirname(STORE), { recursive: true })
      fs.writeFileSync(STORE, JSON.stringify(store, null, 2))
      res.json({ ok: true, muted: !!store.muted[key] })
    } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
  })
}
