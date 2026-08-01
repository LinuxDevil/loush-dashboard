import fs from 'node:fs'
import path from 'node:path'

const STORY_RE = /\.stories\.tsx?$/
// ponytail: grep over source text, not an AST — the first figma.com URL in the file wins, so a
const FIGMA_URL_RE = /figma\.com\/(?:file|design)\/([A-Za-z0-9]+)\/[^"'\s]*?node-id=([^"'&\s]+)/

export const normaliseNodeId = raw => {
  const str = String(raw)
  let decoded
  try { decoded = decodeURIComponent(str) } catch { decoded = str }
  return decoded.replace(/-/g, ':')
}

export function harvestStories(dsRepo) {
  const dir = path.join(dsRepo, 'stories')
  let entries
  try { entries = fs.readdirSync(dir) } catch { return [] }
  const rows = []
  for (const file of entries.sort()) {
    if (!STORY_RE.test(file)) continue
    let src
    try { src = fs.readFileSync(path.join(dir, file), 'utf8') } catch { continue }
    const m = FIGMA_URL_RE.exec(src)
    if (!m) continue
    rows.push({
      component: file.replace(STORY_RE, ''),
      figma: { fileKey: m[1], nodeId: normaliseNodeId(m[2]) },
      source: 'story',
    })
  }
  return rows
}

const nodeKey = figma => figma ? `${figma.fileKey}|${figma.nodeId}` : null

const EMPTY_EVIDENCE = Object.freeze({ nameScore: 0, collisionWith: Object.freeze([]), verifiedAt: null })

export function markCollisions(rows) {
  const claimants = new Map()
  for (const r of rows) {
    const k = nodeKey(r.figma)
    if (!k) continue
    if (!claimants.has(k)) claimants.set(k, [])
    claimants.get(k).push(r.component)
  }
  return rows.map(r => {
    const k = nodeKey(r.figma)
    const others = k ? claimants.get(k).filter(c => c !== r.component) : []
    return { ...r, evidence: { ...EMPTY_EVIDENCE, ...r.evidence, collisionWith: others } }
  })
}

export function enumerateComponents(dsRepo) {
  const dir = path.join(dsRepo, 'src', 'components')
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory() && /^[A-Z]/.test(e.name))
      .map(e => e.name).sort()
  } catch { return [] }
}

const readJson = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return fallback } }

export function buildMap(dsRepo) {
  const pkg = readJson(path.join(dsRepo, 'package.json'), {})
  const harvested = new Map(markCollisions(harvestStories(dsRepo)).map(r => [r.component, r]))
  const importFrom = pkg.name || null

  const rows = enumerateComponents(dsRepo).map(component => {
    const hit = harvested.get(component)
    return {
      component,
      codePath: `src/components/${component}`,
      importFrom,
      figma: hit?.figma ?? null,
      source: hit ? 'story' : null,
      status: hit ? 'proposed' : 'unmapped',
      evidence: { ...EMPTY_EVIDENCE, collisionWith: hit?.evidence?.collisionWith ?? [] },
    }
  })

  for (const [component, hit] of harvested) {
    if (rows.some(r => r.component === component)) continue
    rows.push({
      component, codePath: null, importFrom,
      figma: hit.figma, source: 'story', status: 'proposed',
      evidence: { ...EMPTY_EVIDENCE, collisionWith: hit.evidence?.collisionWith ?? [] },
    })
  }

  rows.sort((a, b) => a.component.localeCompare(b.component))
  return { dsRepo, dsPackage: importFrom, dsVersion: pkg.version || null, rows }
}
