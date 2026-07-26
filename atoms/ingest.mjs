// Ingest a repo's .wakeel/constitution atoms into one searchable index object.
// Used by server-atoms.mjs (in-memory, rebuilt on constitution mtime change) and
// runnable as a CLI: npm run atoms:index -- /path/to/repo  (writes atoms/index.json)
// ponytail: in-memory index, no SQLite — corpus is a few hundred atoms; revisit if it hits tens of thousands.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const constDir = repo => path.join(repo, '.wakeel', 'constitution')
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'))

function loadSource(file, type, name) {
  const doc = readJson(file)
  const fm = doc.frontmatter || {}
  const id = `${type}:${fm.name || name}`
  return {
    id,
    type,
    name: fm.name || name,
    description: fm.description || '',
    when_to_use: fm.when_to_use || '',
    paths: fm.paths || [],
    keyInvariants: fm.keyInvariants || [],
    outputChecklist: fm.outputChecklist || [],
    attest: doc.meta?.attest || null,
    openQuestions: doc.openQuestions || [],
    atoms: (doc.atoms || []).map(a => ({
      ...a,
      source: id,
      sourceType: type,
      origin: /critic/.test(a.id) || a.kindCovered ? 'critic' : 'original',
    })),
  }
}

function collectSources(root) {
  const sources = []
  try {
    for (const d of fs.readdirSync(path.join(root, 'workflows')).sort()) {
      const f = path.join(root, 'workflows', d, 'workflow.atoms.json')
      if (fs.existsSync(f)) sources.push(loadSource(f, 'workflow', d))
    }
  } catch {}
  try {
    for (const f of fs.readdirSync(path.join(root, 'rules')).filter(f => f.endsWith('.atoms.json')).sort())
      sources.push(loadSource(path.join(root, 'rules', f), 'rule', f.replace('.atoms.json', '')))
  } catch {}
  try {
    for (const d of fs.readdirSync(path.join(root, 'skills')).sort()) {
      const f = path.join(root, 'skills', d, 'SKILL.atoms.json')
      if (fs.existsSync(f)) sources.push(loadSource(f, 'skill', d))
    }
  } catch {}
  const c = path.join(root, 'constitution.atoms.json')
  if (fs.existsSync(c)) sources.push(loadSource(c, 'constitution', 'constitution'))
  return sources
}

// Parse the "## Insufficient-evidence atoms" section of attestation-report.md
function parseInsufficient(root) {
  let md
  try { md = fs.readFileSync(path.join(root, 'attestation-report.md'), 'utf8') } catch { return [] }
  const section = md.split(/^## Insufficient-evidence atoms.*$/m)[1] || ''
  const out = []
  const re = /^- \*\*(.+?)\*\* — atom `(.+?)`, cite: (.+)$\n(?:\s+- Claim: (.*)$)?\n?(?:\s+- Reason: (.*)$)?/gm
  let m
  while ((m = re.exec(section)))
    out.push({ artifact: m[1], atomId: m[2], cite: m[3], claim: m[4] || '', reason: m[5] || '' })
  return out
}

function loadDemandSignals(root) {
  const f = path.join(root, '.demand-signals.json')
  if (!fs.existsSync(f)) return []
  try {
    const d = readJson(f)
    const nodes = [...(d.index?.scaffoldClusters || []), ...(d.index?.registryNodes || [])]
    return nodes.map(n => ({ name: n.proposed?.name, description: n.proposed?.description, kind: n.kind }))
  } catch { return [] }
}

// Coverage: every governed path + repo source dirs (depth 3 under packages/) with zero coverage.
// ponytail: depth-3 scan only; go deeper if coverage gaps need finer granularity.
function computeCoverage(repo, sources) {
  const covered = new Map() // path -> [source ids]
  for (const s of sources)
    for (const p of s.paths) {
      const key = p.replace(/\/?\*+$/, '')
      if (!covered.has(key)) covered.set(key, [])
      covered.get(key).push(s.id)
    }
  const dirs = []
  const walk = (rel, depth) => {
    let entries
    try { entries = fs.readdirSync(path.join(repo, rel), { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue
      const d = `${rel}/${e.name}`
      dirs.push(d)
      if (depth < 3) walk(d, depth + 1)
    }
  }
  walk('packages', 1)
  const coveredPaths = [...covered.keys()]
  const dirCoverage = dirs.map(d => ({
    dir: d,
    sources: [...new Set(coveredPaths.filter(p => p === d || p.startsWith(d + '/') || d.startsWith(p + '/')).flatMap(p => covered.get(p)))],
  }))
  return {
    paths: [...covered.entries()].map(([p, s]) => ({ path: p, sources: s })).sort((a, b) => a.path.localeCompare(b.path)),
    dirs: dirCoverage,
  }
}

export function newestMtime(dir) {
  let newest = 0
  const visit = p => {
    const st = fs.statSync(p)
    if (st.mtimeMs > newest) newest = st.mtimeMs
    if (st.isDirectory()) for (const e of fs.readdirSync(p)) if (e !== 'node_modules') visit(path.join(p, e))
  }
  try { visit(dir) } catch {}
  return newest
}

export function buildIndex(repo) {
  const root = constDir(repo)
  const sources = collectSources(root)
  const insufficient = parseInsufficient(root)
  const insufficientIds = new Set(insufficient.map(i => i.atomId))
  for (const s of sources)
    for (const a of s.atoms) a.attestStatus = insufficientIds.has(a.id) ? 'insufficient' : 'confirmed'
  return {
    repo,
    builtAt: new Date().toISOString(),
    sourceMtime: newestMtime(root),
    atomCount: sources.reduce((n, s) => n + s.atoms.length, 0),
    sources,
    insufficient,
    demandSignals: loadDemandSignals(root),
    coverage: computeCoverage(repo, sources),
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repo = path.resolve(process.argv[2] || process.env.CONSTITUTION_REPO || '')
  if (!fs.existsSync(constDir(repo))) {
    console.error('usage: node atoms/ingest.mjs /path/to/repo   (repo must contain .wakeel/constitution/)')
    process.exit(1)
  }
  const idx = buildIndex(repo)
  const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.json')
  fs.writeFileSync(out, JSON.stringify(idx))
  console.log(`Indexed ${idx.atomCount} atoms from ${idx.sources.length} sources (${idx.insufficient.length} flagged insufficient) -> ${out}`)
}
