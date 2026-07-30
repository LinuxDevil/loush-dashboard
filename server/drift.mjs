import { exec, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { mangle, readJson, track } from './dashboard-core.mjs'
import path from 'node:path'
import { git as gitSafe } from '../lib/git-safe.mjs'

let projectDirs, scanTranscripts

const TRACK_RE = /(?:\.|\b)(track|capture|logEvent|trackEvent|recordEvent)\s*\(\s*['"`]([\w .:/-]{3,60})['"`]/

const SRC_EXT = /\.(js|jsx|ts|tsx|py|swift|kt|java|vue|rb)$/

function scanTracking(project) {
  const events = new Map()
  let filesScanned = 0
  const walkT = (d, depth) => {
    if (depth > 6 || filesScanned > 4000) return
    let entries; try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith('.') || ['node_modules', 'dist', 'build', 'vendor', 'coverage'].includes(e.name)) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) { walkT(p, depth + 1); continue }
      if (!SRC_EXT.test(e.name) || filesScanned > 4000) continue
      filesScanned++
      let src; try { src = fs.readFileSync(p, 'utf8') } catch { continue }
      if (src.length > 1024 * 1024) continue
      src.split('\n').forEach((line, i) => {
        const m = TRACK_RE.exec(line)
        if (!m) return
        const ev = events.get(m[2]) || { name: m[2], locations: [], props: new Set() }
        if (ev.locations.length < 20) ev.locations.push({ file: path.relative(project, p), line: i + 1, callee: m[1] })
        const propM = /\{([^{}]*)\}/.exec(line.slice(m.index))
        if (propM) for (const k of propM[1].split(',').map(s => s.split(':')[0].trim()).filter(s => /^\w+$/.test(s))) ev.props.add(k)
        events.set(m[2], ev)
      })
    }
  }
  walkT(project, 0)
  return { events: [...events.values()].map(e => ({ ...e, props: [...e.props] })), filesScanned }
}

const caseOf = n => /^[a-z0-9]+(_[a-z0-9]+)*$/.test(n) ? 'snake_case' : /^[a-z0-9]+([A-Z][a-z0-9]*)+$/.test(n) ? 'camelCase' : /^[\w]+([./:][\w]+)+$/.test(n) ? 'dot.separated' : /^[A-Z]/.test(n) ? 'TitleCase' : 'other'

const taxonomyPath = project => path.join(project, '.claude', 'analytics-taxonomy.json')

function analyticsRegistry(project) {
  const { events, filesScanned } = scanTracking(project)
  const tax = readJson(taxonomyPath(project), null)
  const convention = tax?.convention || (() => {
    const c = {}; for (const e of events) c[caseOf(e.name)] = (c[caseOf(e.name)] || 0) + 1
    return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || null
  })()
  const known = new Set((tax?.events || []).map(e => e.name))
  const checked = events.map(e => {
    const issues = []
    if (convention && caseOf(e.name) !== convention) issues.push(`naming: ${caseOf(e.name)} — convention is ${convention}`)
    if (tax && !known.has(e.name)) issues.push('not in taxonomy')
    const req = (tax?.events || []).find(x => x.name === e.name)?.required || []
    for (const r of req) if (!e.props.includes(r)) issues.push(`missing required property "${r}"`)
    const twin = events.find(o => o !== e && o.name.toLowerCase().replace(/[_.\s-]/g, '') === e.name.toLowerCase().replace(/[_.\s-]/g, ''))
    if (twin) issues.push(`near-duplicate of "${twin.name}"`)
    return { ...e, count: e.locations.length, issues, ok: issues.length === 0 }
  })
  const missing = (tax?.events || []).filter(e => !events.some(x => x.name === e.name)).map(e => e.name)
  return { events: checked.sort((a, b) => b.count - a.count), convention, taxonomy: tax ? taxonomyPath(project) : null, missingFromCode: missing, filesScanned }
}

const manifestPath = project => path.join(project, '.claude', 'design-manifest.json')

function scanComponents(project) {
  const comps = new Map()
  let n = 0
  let dirs = ['src/components', 'src/ui', 'components', 'app/components', 'src'].map(d => path.join(project, d)).filter(fs.existsSync)
  if (!dirs.length) dirs = [project]
  const walkC = (d, depth) => {
    if (depth > 4 || n > 1500) return
    let entries; try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) { walkC(p, depth + 1); continue }
      if (!/\.(jsx|tsx|vue|swift)$/.test(e.name)) continue
      n++
      let src; try { src = fs.readFileSync(p, 'utf8') } catch { continue }
      for (const m of src.matchAll(/export (?:default )?(?:function|const) ([A-Z]\w+)/g)) {
        const name = m[1]
        const propM = new RegExp(`(?:function ${name}|const ${name} =[^(]*)\\(\\s*\\{([^}]*)\\}`).exec(src)
        const props = propM ? propM[1].split(',').map(s => s.split(/[:=]/)[0].trim()).filter(s => /^\w+$/.test(s)) : []
        if (!comps.has(name)) comps.set(name, { name, file: path.relative(project, p), props })
      }
    }
  }
  for (const d of [...new Set(dirs)]) walkC(d, 0)
  return [...comps.values()]
}

function manifestStatus(manifest) {
  if (!manifest) return { state: 'none', enriched: 0, total: 0, driftDetectable: false }
  const comps = Object.values(manifest.components || {})
  const enriched = comps.filter(c => c.figmaNode || (c.variants || []).length).length
  if (manifest.generatedFrom === 'code' && enriched === 0)
    return { state: 'baseline-only', enriched: 0, total: comps.length, driftDetectable: false }
  return { state: 'enriched', enriched, total: comps.length, driftDetectable: true }
}

const fileKeyFor = (manifest, spec) => spec.figmaFileKey || manifest.figmaFileKey || null

function designDrift(project) {
  const manifest = readJson(manifestPath(project), null)
  const code = scanComponents(project)
  const status = manifestStatus(manifest)
  if (!manifest) return { manifest: null, code: code.length, drifts: [], status }
  if (!status.driftDetectable) return { manifest: manifestPath(project), code: code.length, drifts: [], status }
  const drifts = []
  const byName = Object.fromEntries(code.map(c => [c.name, c]))
  for (const [name, spec] of Object.entries(manifest.components || {})) {
    const c = byName[name]
    if (!c) { drifts.push({ component: name, type: 'missing-in-code', detail: 'in the Figma manifest but not implemented', figmaNode: spec.figmaNode || null, figmaFileKey: fileKeyFor(manifest, spec) }); continue }
    for (const p of spec.props || []) if (!c.props.includes(p)) drifts.push({ component: name, type: 'prop-drift', detail: `manifest prop "${p}" not in code (${c.file}) — renamed or dropped?`, figmaNode: spec.figmaNode || null, figmaFileKey: fileKeyFor(manifest, spec) })
    if ((spec.variants || []).length && !c.props.includes('variant'))
      drifts.push({
        component: name, type: 'variant-drift', figmaNode: spec.figmaNode || null, figmaFileKey: fileKeyFor(manifest, spec),
        detail: `manifest declares ${spec.variants.length} variant(s) (${spec.variants.slice(0, 4).join(', ')}) but ${c.file} takes no "variant" prop`,
      })
  }
  for (const c of code) if (!manifest.components?.[c.name] && c.props.length) drifts.push({ component: c.name, type: 'undocumented', detail: `${c.file} — in code but not in the Figma manifest`, figmaNode: null })
  return { manifest: manifestPath(project), code: code.length, drifts: drifts.slice(0, 80), status }
}

function reviewData(project) {
  const { reviews } = scanTranscripts()
  const proj = project ? mangle(project) : null
  const rel = reviews.filter(r => !proj || r.proj === proj).sort((a, b) => b.t - a.t)
  const sessions = rel.slice(0, 60).map(r => ({
    t: r.t, proj: r.proj, sessionId: r.sessionId, source: r.isAgent ? 'subagent' : 'main', level: r.level,
    findings: r.findings,
    fixed: r.findings.filter(f => f.outcome === 'fixed').length,
    dismissed: r.findings.filter(f => f.outcome === 'skipped' || f.outcome === 'no_change_needed').length,
  }))
  const byCat = {}
  for (const r of rel) for (const f of r.findings) { const c = byCat[f.category] ||= { category: f.category, count: 0, passes: new Set(), examples: [] }; c.count++; c.passes.add(r.sessionId); if (c.examples.length < 3) c.examples.push(f.summary) }
  const recurring = Object.values(byCat).filter(c => c.passes.size >= 3).map(c => ({ category: c.category, count: c.count, passes: c.passes.size, examples: c.examples }))
    .sort((a, b) => b.count - a.count)
  const runReviews = []
  for (const proj of (project ? [path.resolve(project)] : [...projectDirs()])) {
    try {
      const rj = JSON.parse(fs.readFileSync(path.join(proj, '.loush', 'review.json'), 'utf8'))
      runReviews.push({ proj: path.basename(proj), decision: rj.decision, summary: rj.summary, headSha: rj.head_sha, findings: rj.findings || [] })
    } catch {}
  }
  return { sessions, recurring, totalFindings: rel.reduce((s, r) => s + r.findings.length, 0), runReviews }
}

export default function mountDrift(app, deps) {
  ({ projectDirs, scanTranscripts } = deps)

app.get('/api/analytics/registry', (req, res) => {
  const project = req.query.project
  if (!project || !fs.existsSync(project)) return res.status(400).json({ error: 'unknown project' })
  res.json(analyticsRegistry(project))
})

app.post('/api/analytics/taxonomy', (req, res) => {
  const project = req.body.project
  if (!project || !fs.existsSync(project)) return res.status(400).json({ error: 'unknown project' })
  const reg = analyticsRegistry(project)
  const tax = { convention: reg.convention, events: reg.events.map(e => ({ name: e.name, required: e.props.slice(0, 8) })) }
  track(taxonomyPath(project), JSON.stringify(tax, null, 2), { scope: project, summary: 'bootstrap analytics taxonomy from code' })
  res.json({ ok: true, path: taxonomyPath(project), events: tax.events.length })
})

app.get('/api/analytics/drift', (req, res) => {
  const project = req.query.project
  if (!project || !fs.existsSync(project)) return res.status(400).json({ error: 'unknown project' })
  const r = gitSafe(project, ['diff', 'HEAD', '--unified=0'], { timeout: 10000, maxBuffer: 8 * 1024 * 1024 })
  const tax = readJson(taxonomyPath(project), null)
  const known = new Set((tax?.events || []).map(e => e.name))
  const added = []
  for (const line of (r.stdout || '').toString().split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue
    const m = TRACK_RE.exec(line)
    if (m) added.push({ name: m[2], issues: [tax && !known.has(m[2]) && 'not in taxonomy', tax?.convention && caseOf(m[2]) !== tax.convention && `naming: ${caseOf(m[2])} vs ${tax.convention}`].filter(Boolean) })
  }
  res.json({ added, hasTaxonomy: !!tax })
})

// ---------- 29: design-system drift vs Figma manifest + MCP call budget ----------

app.get('/api/design/drift', (req, res) => {
  const project = req.query.project
  if (!project || !fs.existsSync(project)) return res.status(400).json({ error: 'unknown project' })
  const { invocations } = scanTranscripts()
  const proj = mangle(project)
  const figma = invocations.filter(i => i.kind === 'mcp' && /figma/i.test(i.name))
  const day = Date.now() - 86400_000, week = Date.now() - 7 * 86400_000
  res.json({
    ...designDrift(project),
    figmaCalls: { day: figma.filter(i => i.proj === proj && i.t >= day).length, week: figma.filter(i => i.proj === proj && i.t >= week).length, allProjectsDay: figma.filter(i => i.t >= day).length },
  })
})

app.post('/api/design/manifest', (req, res) => {
  const project = req.body.project
  if (!project || !fs.existsSync(project)) return res.status(400).json({ error: 'unknown project' })
  const comps = scanComponents(project)
  const manifest = {
    generatedFrom: 'code', createdAt: Date.now(),
    _note: 'Bootstrapped FROM THE CODE. Until figmaNode ids and variants are filled in from the design side, this file cannot detect drift — it is a copy of the code, and diffing it against the code will always agree. /api/design/drift reports status.state="baseline-only" until then.',
    components: Object.fromEntries(comps.map(c => [c.name, { props: c.props, variants: [], figmaNode: null }])),
  }
  track(manifestPath(project), JSON.stringify(manifest, null, 2), { scope: project, summary: 'bootstrap design manifest from code' })
  res.json({ ok: true, path: manifestPath(project), components: comps.length, driftDetectable: false })
})

// ---------- 30: code review loop — /review & /security-review history from transcripts ----------

app.get('/api/reviews', (req, res) => res.json(reviewData(req.query.project)))

}

export { designDrift, reviewData }
