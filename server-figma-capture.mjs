// Figma Capture & Annotation — reads/writes per-repo Captures (screenshot + Figma node tree +
// metadata + Annotations). Which repos are pickable is the same list as Workspaces > Projects
// (GET /api/projects) — the frontend calls that directly rather than this file re-deriving its
// own repo list. Captures can come from the /figma-capture skill (MCP tool access) OR be created
// straight from this server via the Figma REST API — /api/figma-capture/create needs FIGMA_TOKEN.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

const capturesDir = repo => path.join(repo, '.claude', 'figma-captures')
const captureDir = (repo, slug) => path.join(capturesDir(repo), slug)

const readJson = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return fallback } }

function contextMarkdown(capture, annotations) {
  const rows = annotations.map(a =>
    `| ${a.region.x},${a.region.y} ${a.region.w}×${a.region.h} | ${a.nodeId || '—'} | ${a.component || '—'} | ${(a.note || '').replace(/\|/g, '\\|')} |`).join('\n')
  return `# ${capture.frameName}\n\nFigma: ${capture.figmaLink}\nScreenshot: ${capture.screenshotFile}\nCaptured: ${capture.fetchedAt}\n\n| region | node id | component | note |\n|---|---|---|---|\n${rows}\n`
}

function currentBranch(repo) {
  const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo, encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : null
}

function parseFigmaLink(link) {
  const u = new URL(link)
  const fileKey = u.pathname.match(/\/(?:design|file|proto)\/([^/]+)/)?.[1]
  const rawNode = u.searchParams.get('node-id')
  const nodeId = rawNode ? decodeURIComponent(rawNode).replace('-', ':') : null
  if (!fileKey || !nodeId) throw Object.assign(new Error('link must include a file key and a node-id (select a frame in Figma, then Share > Copy link)'), { status: 400 })
  return { fileKey, nodeId }
}

const slugify = s => String(s || 'frame').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'frame'
const shortHash = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 8)

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.turbo', '.output', 'out', 'coverage', '.cache', '.claude'])
const COMPONENT_EXTS = new Set(['.jsx', '.tsx', '.js', '.ts'])
const MAX_FILES_SCANNED = 6000, MAX_PROJECT_COMPONENTS = 400
// heuristic, not a parser: an exported PascalCase function/const/class is almost always a
// component in a JS/TS UI codebase. ponytail: regex over source text, no AST — good enough to
// populate a picker, not to guarantee completeness.
const COMPONENT_EXPORT_RES = [
  /export\s+default\s+function\s+([A-Z]\w*)/g,
  /export\s+function\s+([A-Z]\w*)/g,
  /export\s+const\s+([A-Z]\w*)\s*[:=]/g,
  /export\s+class\s+([A-Z]\w*)\s+extends/g,
]

function scanProjectComponents(repo) {
  const out = []
  let filesScanned = 0
  const walk = dir => {
    if (out.length >= MAX_PROJECT_COMPONENTS || filesScanned >= MAX_FILES_SCANNED) return
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (out.length >= MAX_PROJECT_COMPONENTS || filesScanned >= MAX_FILES_SCANNED) return
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (!IGNORE_DIRS.has(e.name) && !e.name.startsWith('.')) walk(p); continue }
      if (!COMPONENT_EXTS.has(path.extname(e.name))) continue
      filesScanned++
      let src
      try { src = fs.readFileSync(p, 'utf8') } catch { continue }
      const names = new Set()
      for (const re of COMPONENT_EXPORT_RES) for (const m of src.matchAll(re)) names.add(m[1])
      for (const name of names) out.push({ name, file: path.relative(repo, p) })
    }
  }
  walk(repo)
  return out
}

const projectComponentsCache = new Map() // repo -> { at, components }
const PROJECT_COMPONENTS_TTL = 5 * 60_000
function cachedProjectComponents(repo, fresh) {
  const hit = projectComponentsCache.get(repo)
  if (hit && !fresh && Date.now() - hit.at < PROJECT_COMPONENTS_TTL) return hit.components
  const components = scanProjectComponents(repo)
  projectComponentsCache.set(repo, { at: Date.now(), components })
  return components
}

// flatten Figma's node tree into { id, name, x, y, w, h } with coordinates relative to the
// captured root node — matches how the cropped screenshot PNG is framed.
function flattenNode(n, ox, oy, out) {
  const b = n.absoluteBoundingBox
  if (b) out.push({ id: n.id, name: n.name, x: b.x - ox, y: b.y - oy, w: b.width, h: b.height })
  for (const c of n.children || []) flattenNode(c, ox, oy, out)
}

async function fetchCapture({ figmaLink, token }) {
  const { fileKey, nodeId } = parseFigmaLink(figmaLink)
  const headers = { 'X-Figma-Token': token }

  const nodesRes = await fetch(`https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`, { headers })
  const nodesJson = await nodesRes.json()
  if (!nodesRes.ok) throw Object.assign(new Error(nodesJson.err || nodesJson.message || 'Figma API error fetching node metadata'), { status: nodesRes.status })
  const root = nodesJson.nodes?.[nodeId]?.document
  if (!root) throw Object.assign(new Error(`node ${nodeId} not found in file ${fileKey}`), { status: 404 })
  const ox = root.absoluteBoundingBox?.x || 0, oy = root.absoluteBoundingBox?.y || 0
  const nodeTree = []
  flattenNode(root, ox, oy, nodeTree)

  const imgRes = await fetch(`https://api.figma.com/v1/images/${fileKey}?ids=${encodeURIComponent(nodeId)}&format=png`, { headers })
  const imgJson = await imgRes.json()
  if (!imgRes.ok || imgJson.err) throw Object.assign(new Error(imgJson.err || 'Figma API error rendering screenshot'), { status: imgRes.status })
  const imageUrl = imgJson.images?.[nodeId]
  if (!imageUrl) throw Object.assign(new Error('Figma did not return a rendered image for this node'), { status: 502 })
  const png = Buffer.from(await (await fetch(imageUrl)).arrayBuffer())

  return {
    frameName: root.name, fileKey, nodeId, nodeTree, png,
    capture: { figmaLink, fileKey, nodeId, frameName: root.name, fetchedAt: new Date().toISOString(), screenshotFile: 'screenshot.png', nodeTree },
  }
}

export default function mountFigmaCapture(app) {
  const resolveRepo = req => {
    const repo = path.resolve(String(req.query.repo || req.body?.repo || ''))
    if (!fs.existsSync(capturesDir(repo))) throw Object.assign(new Error('no .claude/figma-captures under ' + repo), { status: 404 })
    return repo
  }
  const resolveCapture = (req, slug) => {
    const repo = resolveRepo(req)
    const dir = captureDir(repo, slug)
    if (!fs.existsSync(path.join(dir, 'capture.json'))) throw Object.assign(new Error('no such capture: ' + slug), { status: 404 })
    return { repo, dir }
  }

  app.get('/api/figma-capture/catalog', (req, res) => {
    const DIR = path.dirname(new URL(import.meta.url).pathname)
    res.json(readJson(path.join(DIR, 'design-system-catalog.json'), { components: [] }))
  })

  app.get('/api/figma-capture/project-components', (req, res) => {
    try {
      const repo = path.resolve(String(req.query.repo || ''))
      if (!fs.existsSync(repo)) throw Object.assign(new Error('repo not found: ' + repo), { status: 404 })
      res.json(cachedProjectComponents(repo, req.query.fresh === '1'))
    } catch (e) { res.status(e.status || 500).json({ error: e.message }) }
  })

  app.get('/api/figma-capture/branch', (req, res) => {
    try { res.json({ branch: currentBranch(path.resolve(String(req.query.repo || ''))) }) }
    catch (e) { res.status(500).json({ error: e.message }) }
  })

  // no .claude/figma-captures/ yet is a normal, common state for a freshly-picked project —
  // an empty list, not an error (the UI's "+ create capture" button is how you get your first one).
  app.get('/api/figma-capture/list', (req, res) => {
    try {
      const repo = path.resolve(String(req.query.repo || ''))
      const dir = capturesDir(repo)
      const slugs = fs.existsSync(dir) ? fs.readdirSync(dir).filter(s => fs.existsSync(path.join(dir, s, 'capture.json'))) : []
      res.json(slugs.map(slug => {
        const capture = readJson(path.join(dir, slug, 'capture.json'), {})
        const annotations = readJson(path.join(dir, slug, 'annotations.json'), [])
        return { slug, ...capture, annotationCount: annotations.length }
      }).sort((a, b) => (b.fetchedAt || '').localeCompare(a.fetchedAt || '')))
    } catch (e) { res.status(e.status || 500).json({ error: e.message }) }
  })

  app.post('/api/figma-capture/create', async (req, res) => {
    const token = process.env.FIGMA_TOKEN
    if (!token) return res.status(400).json({ error: 'FIGMA_TOKEN is not set on the dashboard server — either set it and restart, or run the /figma-capture skill from a Claude Code session in that repo instead.' })
    const repo = path.resolve(String(req.body?.repo || ''))
    const figmaLink = String(req.body?.figmaLink || '')
    if (!repo || !figmaLink) return res.status(400).json({ error: 'repo and figmaLink required' })
    try {
      const { frameName, fileKey, nodeId, capture, png } = await fetchCapture({ figmaLink, token })
      const slug = `${slugify(frameName)}-${shortHash(fileKey + nodeId)}`
      const dir = captureDir(repo, slug)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'capture.json'), JSON.stringify(capture, null, 2))
      fs.writeFileSync(path.join(dir, 'screenshot.png'), png)
      if (!fs.existsSync(path.join(dir, 'annotations.json'))) fs.writeFileSync(path.join(dir, 'annotations.json'), '[]')
      res.json({ slug })
    } catch (e) { res.status(e.status || 500).json({ error: e.message }) }
  })

  app.get('/api/figma-capture/:slug', (req, res) => {
    try {
      const { dir } = resolveCapture(req, req.params.slug)
      res.json({ capture: readJson(path.join(dir, 'capture.json'), {}), annotations: readJson(path.join(dir, 'annotations.json'), []) })
    } catch (e) { res.status(e.status || 500).json({ error: e.message }) }
  })

  app.get('/api/figma-capture/:slug/screenshot', (req, res) => {
    try {
      const { dir } = resolveCapture(req, req.params.slug)
      const capture = readJson(path.join(dir, 'capture.json'), {})
      const file = path.join(dir, capture.screenshotFile || 'screenshot.png')
      if (!fs.existsSync(file)) return res.status(404).end()
      res.sendFile ? res.sendFile(file) : res.send(fs.readFileSync(file))
    } catch (e) { res.status(e.status || 500).json({ error: e.message }) }
  })

  app.post('/api/figma-capture/:slug/annotations', (req, res) => {
    try {
      const { dir } = resolveCapture(req, req.params.slug)
      const annotations = Array.isArray(req.body?.annotations) ? req.body.annotations : []
      fs.writeFileSync(path.join(dir, 'annotations.json'), JSON.stringify(annotations, null, 2))
      res.json(annotations)
    } catch (e) { res.status(e.status || 500).json({ error: e.message }) }
  })

  app.post('/api/figma-capture/:slug/context', (req, res) => {
    try {
      const { dir } = resolveCapture(req, req.params.slug)
      const capture = readJson(path.join(dir, 'capture.json'), {})
      const annotations = readJson(path.join(dir, 'annotations.json'), [])
      const md = contextMarkdown(capture, annotations)
      fs.writeFileSync(path.join(dir, 'context.md'), md)
      res.json({ contextMd: md })
    } catch (e) { res.status(e.status || 500).json({ error: e.message }) }
  })
}
