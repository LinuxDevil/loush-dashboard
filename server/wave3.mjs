// Routes for the modules built in the worktree batch.
//
// They live in one file rather than being scattered because they share one property: each is a
// read-only derivation over data the app already has, so none of them needs the approval/audit
// path that config writes go through. The two exceptions are marked at their route.
//
// Every handler follows the same rule the modules do: a computation that could not run returns
// its reason rather than an empty success. A 200 with zeros is indistinguishable from a real
// measurement of zero, and these endpoints feed headline numbers.

import fs from 'node:fs'
import path from 'node:path'
import { PROJECT, CLAUDE } from './dashboard-core.mjs'
import { checkAll, formatReport } from '../lib/contracts.mjs'
import { complexityOf, auditOverEngineering } from '../lib/repo-complexity.mjs'
import { toolEfficiency } from '../lib/tool-efficiency.mjs'
import { bucketUsage } from '../lib/usage-buckets.mjs'
import { ingestExecutionFile, summarizeRuns } from '../lib/ci-cost.mjs'
import { lintAll, proposedFixes } from '../lib/config-lint.mjs'
import { parseWorkLog, crossCheckWorkLog } from '../lib/work-log.mjs'
import { listBundles, getBundle, planInstall } from '../lib/hook-bundles.mjs'
import { RULES, routeAll, checkShadowing, validateRules } from '../lib/routing-policy.mjs'
import { parseMarkdownCriteria, validateAll, renderMarkdown, toCsv as acToCsv } from '../lib/acceptance-criteria.mjs'
import { status as gitStatus, listBranches, diff as gitDiff, repoRootOf } from '../lib/git-ops.mjs'
import { openFolder, resolveOpenTarget } from '../lib/open-folder.mjs'
import { computeContextReduction } from '../lib/context-reduction.mjs'

export default function mountWave3(app, deps = {}) {
  const collectUsage = deps.collectUsage
  // projectDirs() returns a Set in this codebase, not an array. Normalising here rather than at
  // each call site, because a guard that silently evaluates to "no roots" would either refuse
  // everything or — worse, depending on how it is written — allow everything.
  const rootList = () => {
    const r = deps.projectDirs ? deps.projectDirs() : [PROJECT]
    return r instanceof Set ? [...r] : Array.isArray(r) ? r : r ? [r] : []
  }

  // WATCHED_PROJECT is not necessarily a git checkout, and defaulting to it made /api/git/status
  // answer "not-a-git-repo" out of the box — which reads as the feature being broken rather than
  // as the default being wrong. The first configured project root is the useful default.
  // Not simply rootList()[0]: the configured roots here are ["/home/user", "/home/user/loush-
  // dashboard"], and the first is a parent directory that is not a checkout — so the git routes
  // answered "not-a-git-repo" by default, which reads as the feature being broken. Prefer a root
  // that actually is a repository, and prefer the one the server is running inside.
  const defaultDir = () => {
    const roots = rootList()
    const isRepo = d => { try { fs.statSync(path.join(d, '.git')); return true } catch { return false } }
    const cwd = process.cwd()
    const containing = roots.find(r => path.resolve(cwd) === path.resolve(r) && isRepo(r))
    return containing || roots.find(isRepo) || roots[0] || PROJECT
  }

  // Raw transcript records, for the analyses that need tool_use/tool_result blocks rather than
  // the usage rollup. collectUsage() returns priced entries, not records, so this reads the JSONL
  // directly — newest files first, and the bound is REPORTED so a partial scan cannot read as a
  // complete one.
  const MAX_TRANSCRIPT_FILES = 40
  const readRecords = () => {
    const base = path.join(CLAUDE, 'projects')
    const files = []
    const walk = d => {
      let ents
      try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
      for (const e of ents) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.name.endsWith('.jsonl')) { try { files.push({ p, m: fs.statSync(p).mtimeMs }) } catch {} }
      }
    }
    walk(base)
    files.sort((a, b) => b.m - a.m)
    const used = files.slice(0, MAX_TRANSCRIPT_FILES)
    const records = []
    let malformed = 0
    for (const f of used) {
      let text
      try { text = fs.readFileSync(f.p, 'utf8') } catch { continue }
      for (const line of text.split('\n')) {
        if (!line) continue
        try { records.push(JSON.parse(line)) } catch { malformed++ }
      }
    }
    return {
      records,
      scanned: { files: used.length, filesAvailable: files.length, malformedLines: malformed,
        truncated: files.length > used.length,
        note: files.length > used.length ? `only the ${used.length} most recently modified of ${files.length} transcript files were read` : null },
    }
  }

  // ---- 104: does the transcript format still look like what we parse? ----
  app.get('/api/contracts', (req, res) => {
    try {
      const r = checkAll()
      res.json({ ...r, report: formatReport(r) })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  // ---- 110: repo complexity + over-engineering audit ----
  app.get('/api/repo/complexity', (req, res) => {
    const dir = req.query.dir ? String(req.query.dir) : defaultDir()
    // The path is client-supplied and reaches the filesystem, so it is constrained to a
    // configured project root the same way every other path-taking route here is.
    const roots = rootList()
    const resolved = path.resolve(dir)
    if (!roots.some(r => resolved === path.resolve(r) || resolved.startsWith(path.resolve(r) + path.sep))) {
      return res.status(403).json({ error: 'not a configured project directory', dir: resolved, roots })
    }
    try {
      const score = complexityOf(resolved)
      res.json({ ...score, audit: auditOverEngineering ? auditOverEngineering(resolved) : null })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  // ---- 111 + 027: per-tool efficiency and usage buckets, over real transcripts ----
  app.get('/api/usage/tool-efficiency', (req, res) => {
    try {
      const { records, scanned } = readRecords()
      // toolEfficiency takes RAW RECORDS and runs extractToolCalls itself. Handing it already-
      // extracted calls returned zero tools over 32 real transcript files without erroring —
      // which is exactly the shape of failure that reads as "you made no tool calls".
      res.json({ ...toolEfficiency(records), scanned })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })
  app.get('/api/usage/buckets', (req, res) => {
    if (!collectUsage) return res.status(501).json({ error: 'usage collection is not wired into this server' })
    try {
      const { entries } = collectUsage()
      res.json(bucketUsage(entries, { allowFamilyFallback: req.query.familyFallback === '1' }))
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  // ---- 024: CI agent-run cost from an uploaded execution file ----
  app.post('/api/ci/execution', (req, res) => {
    try {
      const r = ingestExecutionFile(req.body?.content ?? req.body, { source: req.body?.source ?? null })
      res.status(r.ok ? 200 : 422).json(r)
    } catch (e) { res.status(500).json({ error: e.message }) }
  })
  app.post('/api/ci/execution/summary', (req, res) => {
    try { res.json(summarizeRuns(Array.isArray(req.body?.runs) ? req.body.runs : [])) }
    catch (e) { res.status(500).json({ error: e.message }) }
  })

  // ---- 120: config lint ----
  app.get('/api/config/lint', (req, res) => {
    try { res.json(lintAll()) } catch (e) { res.status(500).json({ error: e.message }) }
  })
  // Fixes are PROPOSED, never applied here — a linter that edits config on a GET is a linter that
  // silently rewrote something a human never reviewed.
  app.post('/api/config/lint/fixes', (req, res) => {
    try { res.json(proposedFixes(Array.isArray(req.body?.diagnostics) ? req.body.diagnostics : [])) }
    catch (e) { res.status(500).json({ error: e.message }) }
  })

  // ---- 052: work log as a second files-changed signal ----
  app.post('/api/work-log/parse', (req, res) => {
    try {
      const parsed = parseWorkLog(String(req.body?.md ?? ''))
      const observed = Array.isArray(req.body?.observedFiles) ? req.body.observedFiles : null
      res.json(observed ? crossCheckWorkLog(parsed, observed) : parsed)
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  // ---- 112: hook bundles ----
  app.get('/api/hooks/bundles', (req, res) => res.json(listBundles()))
  app.get('/api/hooks/bundles/:id', (req, res) => {
    const b = getBundle(req.params.id)
    if (!b) return res.status(404).json({ error: `no bundle "${req.params.id}"`, available: listBundles().map(x => x.id) })
    res.json(b)
  })
  // Plan only. Installing writes to a settings file, which belongs on the audited config path —
  // wiring that is a separate change, and shipping an unaudited write here would bypass it.
  app.post('/api/hooks/bundles/:id/plan', (req, res) => {
    try { res.json(planInstall(req.params.id, req.body?.settings ?? {})) }
    catch (e) { res.status(400).json({ error: e.message }) }
  })

  // ---- 113: agent routing policy ----
  app.get('/api/routing/policy', (req, res) => {
    res.json({ rules: RULES, validation: validateRules(RULES), shadowing: checkShadowing(RULES) })
  })
  app.post('/api/routing/route', (req, res) => {
    try { res.json(routeAll(Array.isArray(req.body?.signals) ? req.body.signals : [], req.body?.opts ?? {})) }
    catch (e) { res.status(400).json({ error: e.message }) }
  })

  // ---- 094: acceptance criteria as structured items ----
  app.post('/api/criteria/parse', (req, res) => {
    try {
      const parsed = parseMarkdownCriteria(String(req.body?.md ?? ''))
      const items = parsed.items ?? parsed
      const out = { ...parsed, validation: validateAll(items) }
      if (req.query.format === 'csv') {
        res.setHeader('content-type', 'text/csv; charset=utf-8')
        res.setHeader('content-disposition', 'attachment; filename="acceptance-criteria.csv"')
        return res.send(acToCsv(items))
      }
      if (req.query.format === 'md') return res.type('text/markdown').send(renderMarkdown(items))
      res.json(out)
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  // ---- 096: git status / branches / diff ----
  const repoGuard = (req, res) => {
    const dir = req.query.dir ? String(req.query.dir) : defaultDir()
    const roots = rootList()
    const resolved = path.resolve(dir)
    if (!roots.some(r => resolved === path.resolve(r) || resolved.startsWith(path.resolve(r) + path.sep))) {
      res.status(403).json({ error: 'not a configured project directory', dir: resolved, roots })
      return null
    }
    return resolved
  }
  app.get('/api/git/status', (req, res) => {
    const dir = repoGuard(req, res); if (!dir) return
    try { const r = gitStatus(dir); res.status(r.ok ? 200 : 422).json(r) }
    catch (e) { res.status(500).json({ error: e.message }) }
  })
  app.get('/api/git/branches', (req, res) => {
    const dir = repoGuard(req, res); if (!dir) return
    try { const r = listBranches(dir); res.status(r.ok ? 200 : 422).json(r) }
    catch (e) { res.status(500).json({ error: e.message }) }
  })
  app.get('/api/git/diff', (req, res) => {
    const dir = repoGuard(req, res); if (!dir) return
    try { const r = gitDiff(dir, { staged: req.query.staged === '1', file: req.query.file ? String(req.query.file) : undefined }); res.status(r.ok ? 200 : 422).json(r) }
    catch (e) { res.status(500).json({ error: e.message }) }
  })
  app.get('/api/git/root', (req, res) => {
    const dir = repoGuard(req, res); if (!dir) return
    try { res.json(repoRootOf(dir)) } catch (e) { res.status(500).json({ error: e.message }) }
  })

  // ---- 098: reveal a folder in the OS file manager ----
  // The highest-risk route here: it takes a client path and executes a program. The allowlist is
  // the configured project roots, checked on the resolved path, inside open-folder itself.
  app.post('/api/open-folder', (req, res) => {
    try {
      const r = openFolder(String(req.body?.path ?? ''), { roots: rootList() })
      res.status(r.ok ? 200 : 403).json(r)
    } catch (e) { res.status(500).json({ error: e.message }) }
  })
  app.post('/api/open-folder/resolve', (req, res) => {
    try { res.json(resolveOpenTarget(String(req.body?.path ?? ''), { roots: rootList() })) }
    catch (e) { res.status(500).json({ error: e.message }) }
  })

  // ---- 109: context reduction ----
  // NOT /api/context/reduction: session-forensics already owns /api/context/:sessionId, which is
  // mounted first and would match "reduction" as a session id and 404.
  app.get('/api/context-reduction', (req, res) => {
    try { res.json(computeContextReduction(deps.capabilityLedger ? deps.capabilityLedger() : null)) }
    catch (e) { res.status(500).json({ error: e.message }) }
  })
}
