import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import express from 'express'

const HOME = os.homedir()
const CLAUDE_JSON = path.join(HOME, '.claude.json')
const CURSOR_WS = path.join(HOME, 'Library', 'Application Support', 'Cursor', 'User', 'workspaceStorage')
const DEBT_RE = /@ts-nocheck|@ts-ignore|\bv1\b|deprecated|legacy|MUST be migrated|phased out|migration/i

const constDir = repo => path.join(repo, '.wakeel', 'constitution')
const hasConstitution = repo => { try { return fs.existsSync(path.join(constDir(repo), 'constitution.md')) } catch { return false } }

function candidateRepos() {
  const dirs = new Set()
  try { for (const d of Object.keys(JSON.parse(fs.readFileSync(CLAUDE_JSON, 'utf8')).projects || {})) dirs.add(d) } catch {}
  try {
    for (const id of fs.readdirSync(CURSOR_WS)) {
      try {
        const f = decodeURIComponent(String(JSON.parse(fs.readFileSync(path.join(CURSOR_WS, id, 'workspace.json'), 'utf8')).folder || '').replace(/^file:\/\//, ''))
        if (f) dirs.add(f)
      } catch {}
    }
  } catch {}
  return [...dirs].filter(hasConstitution).sort()
}

function fm(mdFile) {
  let src; try { src = fs.readFileSync(mdFile, 'utf8') } catch { return { paths: [] } }
  const m = src.match(/^---\n([\s\S]*?)\n---/)
  if (!m) return { paths: [] }
  const paths = []
  let inPaths = false
  for (const line of m[1].split('\n')) {
    if (/^paths:\s*$/.test(line)) { inPaths = true; continue }
    if (inPaths) {
      const mm = line.match(/^\s+-\s+(.+)$/)
      if (mm) paths.push(mm[1].trim().replace(/^["']|["']$/g, ''))
      else inPaths = false
    }
  }
  const scalar = key => m[1].match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1].trim().replace(/^["']|["']$/g, '') || ''
  return { paths, description: scalar('description'), whenToUse: scalar('when_to_use') }
}

function mdPath(root, kind, name) {
  if (/[\\/]|\.\./.test(name)) throw Object.assign(new Error('bad name'), { status: 400 })
  return kind === 'constitution' ? path.join(root, 'constitution.md')
    : kind === 'rule' ? path.join(root, 'rules', name + '.md')
    : kind === 'skill' ? path.join(root, 'skills', name, 'SKILL.md')
    : path.join(root, 'workflows', name, 'workflow.md')
}

function* collectArtifacts(root) {
  yield { kind: 'constitution', name: 'constitution', md: path.join(root, 'constitution.md'), atoms: path.join(root, 'constitution.atoms.json') }
  try {
    for (const f of fs.readdirSync(path.join(root, 'rules')).filter(f => f.endsWith('.atoms.json')).sort()) {
      const name = f.replace('.atoms.json', '')
      yield { kind: 'rule', name, md: path.join(root, 'rules', name + '.md'), atoms: path.join(root, 'rules', f) }
    }
  } catch {}
  for (const [dir, kind, base] of [['skills', 'skill', 'SKILL'], ['workflows', 'workflow', 'workflow']]) {
    try {
      for (const d of fs.readdirSync(path.join(root, dir)).sort()) {
        const atoms = path.join(root, dir, d, base + '.atoms.json')
        if (fs.existsSync(atoms)) yield { kind, name: d, md: path.join(root, dir, d, base + '.md'), atoms }
      }
    } catch {}
  }
}

function buildInsights(repo) {
  const root = constDir(repo)
  const artifacts = []
  const fileCites = new Map()
  const coverage = new Map()
  const wfFiles = {}
  const debt = []

  for (const a of collectArtifacts(root)) {
    let data; try { data = JSON.parse(fs.readFileSync(a.atoms, 'utf8')) } catch { continue }
    const atoms = data.atoms || []
    const { paths, description, whenToUse } = fm(a.md)
    const label = `${a.kind}:${a.name}`
    artifacts.push({ kind: a.kind, name: a.name, label, paths, atoms: atoms.length, description, whenToUse })
    for (const p of paths) {
      const key = p.replace(/\/?\*+$/, '')
      if (!coverage.has(key)) coverage.set(key, new Set())
      coverage.get(key).add(label)
    }
    if (a.kind === 'workflow') wfFiles[a.name] = new Set(paths)
    for (const atom of atoms) {
      const cp = atom.cite?.path
      if (cp) {
        if (!fileCites.has(cp)) fileCites.set(cp, new Map())
        const by = fileCites.get(cp)
        by.set(label, (by.get(label) || 0) + 1)
      }
      const text = [atom.claim, atom.rationale, atom.consequence].filter(Boolean).join(' ')
      if (DEBT_RE.test(text))
        debt.push({ artifact: label, claim: String(atom.claim || '').slice(0, 300), cite: cp ? `${cp}:${atom.cite.lineRange || ''}` : '', tone: atom.tone || '' })
    }
  }

  const hotFiles = [...fileCites.entries()]
    .map(([file, by]) => ({
      file,
      citations: [...by.values()].reduce((s, n) => s + n, 0),
      artifacts: by.size,
      citedBy: [...by.keys()].sort((x, y) => by.get(y) - by.get(x)),
    }))
    .sort((x, y) => y.artifacts - x.artifacts || y.citations - x.citations)

  const wfNames = Object.keys(wfFiles).sort()
  const workflowOverlaps = []
  for (let i = 0; i < wfNames.length; i++)
    for (let j = i + 1; j < wfNames.length; j++) {
      const shared = [...wfFiles[wfNames[i]]].filter(f => wfFiles[wfNames[j]].has(f))
      if (shared.length) workflowOverlaps.push({ a: wfNames[i], b: wfNames[j], shared: shared.sort() })
    }
  workflowOverlaps.sort((x, y) => y.shared.length - x.shared.length)

  const nodes = artifacts.map(a => ({ id: a.label, kind: a.kind, atoms: a.atoms }))
  const links = []
  for (const f of hotFiles) {
    nodes.push({ id: f.file, kind: 'file', artifacts: f.artifacts, citations: f.citations })
    for (const label of f.citedBy) links.push({ source: label, target: f.file, n: fileCites.get(f.file).get(label) })
  }

  return {
    repo,
    totals: { artifacts: artifacts.length, atoms: artifacts.reduce((s, a) => s + a.atoms, 0), citedFiles: hotFiles.length, debtAtoms: debt.length },
    artifacts,
    hotFiles: hotFiles.slice(0, 60),
    coverage: [...coverage.entries()].map(([p, arts]) => ({ path: p, artifacts: [...arts].sort() })).sort((x, y) => x.path.localeCompare(y.path)),
    workflowOverlaps: workflowOverlaps.slice(0, 40),
    debt,
    graph: { nodes, links },
  }
}

const cache = new Map() // repo -> {at, data}  // ponytail: 5-min TTL memo, mtime-watching if staleness ever bites
export default function mountConstitution(app) {
  app.get('/api/constitution/repos', (req, res) => res.json(candidateRepos()))

  app.get('/api/constitution/insights', (req, res) => {
    const repo = path.resolve(String(req.query.repo || ''))
    if (!hasConstitution(repo)) return res.status(404).json({ error: 'no .wakeel/constitution/constitution.md under ' + repo })
    const hit = cache.get(repo)
    if (hit && req.query.fresh !== '1' && Date.now() - hit.at < 300_000) { res.set('x-cached-at', String(hit.at)); return res.json(hit.data) }
    try {
      const data = buildInsights(repo)
      cache.set(repo, { at: Date.now(), data })
      res.set('x-cached-at', String(Date.now()))
      res.json(data)
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  app.post('/api/constitution/export', express.json({ limit: '300mb' }), (req, res) => {
    try {
      const { name, files } = req.body || {}
      if (!Array.isArray(files) || !files.length) return res.status(400).json({ error: 'no files' })
      const dir = path.join(HOME, 'Downloads', String(name || 'constitution-export').replace(/[^\w.-]+/g, '_'))
      fs.mkdirSync(dir, { recursive: true })
      for (const f of files) fs.writeFileSync(path.join(dir, String(f.name).replace(/[^\w.-]+/g, '_')), String(f.html))
      res.json({ dir, count: files.length })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  app.get('/api/constitution/artifact', (req, res) => {
    try {
      const repo = path.resolve(String(req.query.repo || ''))
      if (!hasConstitution(repo)) return res.status(404).json({ error: 'no constitution under ' + repo })
      const file = mdPath(constDir(repo), String(req.query.kind || ''), String(req.query.name || ''))
      res.json({ content: fs.readFileSync(file, 'utf8') })
    } catch (e) { res.status(e.status || 500).json({ error: e.message }) }
  })
}
