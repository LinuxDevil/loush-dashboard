// Stage 6 — `figma`. All REST, no browser (spec §1, "Figma, without a browser").
//
// Three findings from a real file shape every decision here, and re-deriving them costs a 2.4M-char
// download each time:
//   1. The raw page tree is ~2.4M chars and a depth-2 outline is ~29 lines. So the tree is never
//      fetched whole — `?depth=2` prunes at the API, not after.
//   2. Screen identity is the real gap: 19 of ~24 screens in one flow were all named `Desktop`. A
//      single section render is unreadable and a name is not an identity, so the ladder is section
//      overview → per-frame at ~1400px.
//   3. Dev-mode annotations have no REST surface. They are reported `unavailable` with a reason
//      rather than chased, because chasing them means adding a browser.
//
// Fetching needs no interpretation — flow groupings are declared Figma Sections and spec text arrives
// as text-layer names — so this stage only fetches and prunes. Reading is stage 8's job.

import fs from 'node:fs'
import path from 'node:path'
import { entry } from '../../lib/dossier.mjs'
import { figmaToken } from '../figma-capture.mjs'

const API = 'https://api.figma.com/v1'

// Caps exist so an unusually large file costs a bounded number of requests. Whatever they drop is
// named in the entry's reason — a silently truncated dossier reads as a complete one.
const MAX_FILES = 2, MAX_RENDERS = 12
const FRAME_PX = 1400, OVERVIEW_PX = 2000

const CONTAINERS = new Set(['SECTION', 'FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'GROUP'])

const docsDir = (repoDir, key) => path.join(repoDir, 'docs', String(key).toUpperCase())
const rel = (repoDir, p) => path.relative(repoDir, p)
const slug = s => String(s || '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'x'
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))
const scaleFor = (w, target) => Number(clamp(target / (w || target), 0.01, 4).toFixed(2))

function parseLink(url) {
  try {
    const u = new URL(url)
    const fileKey = u.pathname.match(/\/(?:design|file|proto|board)\/([^/]+)/)?.[1]
    const raw = u.searchParams.get('node-id')
    return fileKey ? { url, fileKey, nodeId: raw ? decodeURIComponent(raw).replace('-', ':') : null } : null
  } catch { return null }
}

/**
 * The Figma links, located through the manifest rather than by rebuilding `docs/<KEY>/links.json` —
 * the manifest is the index, and a hardcoded path stops working the day `links` renames its artifact.
 */
function figmaUrls(manifest, repoDir) {
  const up = manifest?.stages?.links
  if (!up) return { skip: 'the `links` stage has not run yet, so no Figma link is known' }
  if (up.status !== 'ok') return { skip: `the \`links\` stage is "${up.status}", so no Figma link is known` }
  const file = up.artifacts?.[0]
  if (!file) return { skip: 'the `links` stage recorded no artifact to read links from' }
  let data
  try { data = JSON.parse(fs.readFileSync(path.resolve(repoDir, file), 'utf8')) }
  catch (e) { return { skip: `the \`links\` artifact ${file} could not be read: ${e.message}` } }
  return { urls: (data.figma || []).map(String) }
}

async function getJson(f, url, token) {
  const res = await f(url, { headers: { 'X-Figma-Token': token } })
  let json = null
  try { json = await res.json() } catch {}
  return { ok: res.ok && !json?.err, status: res.status, json: json || {} }
}

/** depth-2 only: a root and its immediate children. Anything deeper is what made the raw tree 2.4M chars. */
const prune = node => ({
  id: node?.id, name: node?.name, type: node?.type,
  children: (node?.children || []).map(c => ({
    id: c.id, name: c.name, type: c.type,
    w: Math.round(c.absoluteBoundingBox?.width || 0), h: Math.round(c.absoluteBoundingBox?.height || 0),
    childCount: (c.children || []).length,
  })),
})

function outlineMarkdown(key, roots, renders, dropped) {
  const lines = [`# Figma — ${key}`, '', `Depth-2 outline. The full node tree is ~2.4M chars and is deliberately not fetched or stored.`, '']
  lines.push('Dev-mode annotations: **unavailable** — no Figma REST endpoint exposes them, and this pipeline has no browser stage.', '')
  for (const r of roots) {
    lines.push(`## ${r.name || '(unnamed)'} — ${r.type}`, `Source: ${r.url}`, '')
    for (const c of r.children) lines.push(`- ${c.name || '(unnamed)'} (${c.type}, ${c.id}, ${c.w}×${c.h}, ${c.childCount} children)`)
    lines.push('')
  }
  if (renders.length) {
    lines.push('## Screenshots (cache half, not git-tracked)', '')
    for (const r of renders) lines.push(`- ${r.kind} · ${r.name} (${r.id}, scale ${r.scale}) → \`${r.file}\``)
    lines.push('')
  }
  if (dropped.length) lines.push('## Not rendered', '', `Render cap ${MAX_RENDERS} reached:`, ...dropped.map(d => `- ${d}`), '')
  return lines.join('\n')
}

/** Threads via `parent_id`; resolved threads are counted, not printed — they are the noise `resolved_at` exists to filter. */
function commentsDigest(key, comments) {
  const tops = comments.filter(c => !c.parent_id)
  const open = tops.filter(c => !c.resolved_at)
  const anchored = open.filter(c => c.client_meta?.node_id).length
  const lines = [
    `# Figma comments — ${key}`, '',
    `${comments.length} comments · ${tops.length} threads · ${tops.length - open.length} resolved (omitted) · ${anchored}/${open.length} open threads node-anchored`, '',
  ]
  for (const c of open) {
    const at = c.client_meta?.node_id ? ` @${c.client_meta.node_id}` : ''
    lines.push(`## ${c.user?.handle || 'unknown'}${at} — ${c.created_at || ''}`, '', String(c.message || '').trim(), '')
    for (const r of comments.filter(r => r.parent_id === c.id)) {
      lines.push(`> **${r.user?.handle || 'unknown'}**: ${String(r.message || '').trim().replace(/\n/g, ' ')}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

/**
 * @param {object} ctx
 * @param {string} ctx.repoDir
 * @param {string} ctx.cacheDir
 * @param {string} ctx.key
 * @param {object} ctx.cfg
 * @param {object} ctx.manifest read-only
 * @param {object} [deps] injection seam for tests — no network, no token needed
 * @returns {Promise<object>} one manifest entry
 */
export async function figma(ctx, deps = {}) {
  const { repoDir, cacheDir, key, manifest } = ctx
  const tracked = manifest?.tracked !== false
  const mk = (status, reason, extra = {}) => entry({ stage: 'figma', status, reason, tracked, ...extra })

  const { skip, urls } = figmaUrls(manifest, repoDir)
  if (skip) return mk('skipped', skip)
  if (!urls.length) return mk('unavailable', 'the ticket links no Figma file')

  const token = 'token' in deps ? deps.token : figmaToken()
  if (!token) return mk('unavailable', 'no Figma API token — set FIGMA_TOKEN on the server or add a key in the Figma capture panel')
  const f = deps.fetch || globalThis.fetch

  const links = urls.map(parseLink).filter(Boolean)
  if (!links.length) return mk('failed', `none of the ${urls.length} Figma link(s) contained a file key`)
  const files = links.filter((l, i, a) => a.findIndex(x => x.fileKey === l.fileKey) === i)
  // `links` leaves Figma uncapped because stage 6 owns its own budget; over-cap files go in the
  // discovered-but-not-followed shape `links` already uses, not into a render-level note.
  const discovered = files.slice(MAX_FILES).map(l => ({ kind: 'figma', ref: l.url, why: `over this stage's cap of ${MAX_FILES} Figma file(s) — linked from the ticket but not fetched` }))
  const dropped = []

  fs.mkdirSync(cacheDir, { recursive: true })
  const cache = []
  const write = (name, data) => {
    const p = path.join(cacheDir, name)
    fs.writeFileSync(p, data)
    cache.push(p)
    return name
  }

  const roots = [], renders = []
  let comments = [], commentsReason = null

  for (const link of files.slice(0, MAX_FILES)) {
    const { fileKey, nodeId, url } = link
    const metaUrl = nodeId
      ? `${API}/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}&depth=2`
      : `${API}/files/${fileKey}?depth=2`
    const meta = await getJson(f, metaUrl, token)
    if (!meta.ok) {
      const why = meta.json?.err || meta.json?.message || `HTTP ${meta.status}`
      return mk(meta.status === 403 || meta.status === 404 ? 'unavailable' : 'failed', `Figma metadata for ${fileKey}: ${why}`, { sourceUrl: url })
    }
    write(`figma-${slug(fileKey)}-meta.json`, JSON.stringify(meta.json))

    const docs = nodeId ? [meta.json.nodes?.[nodeId]?.document].filter(Boolean) : (meta.json.document?.children || [])
    const fileRoots = docs.map(d => ({ ...prune(d), url }))
    roots.push(...fileRoots)

    // The zoom ladder. Sections are the declared flow groupings; their frames sit one level below the
    // depth-2 outline, so one extra depth-1 call per file buys the whole per-frame list.
    const outline = fileRoots.flatMap(r => r.children)
    const sections = outline.filter(c => c.type === 'SECTION')
    let frames = sections.length ? [] : outline.filter(c => CONTAINERS.has(c.type))
    if (sections.length) {
      const kids = await getJson(f, `${API}/files/${fileKey}/nodes?ids=${sections.map(s => encodeURIComponent(s.id)).join(',')}&depth=1`, token)
      if (kids.ok) {
        for (const s of sections) {
          for (const c of kids.json.nodes?.[s.id]?.document?.children || []) {
            if (CONTAINERS.has(c.type)) frames.push({ id: c.id, name: `${s.name} / ${c.name}`, w: Math.round(c.absoluteBoundingBox?.width || 0) })
          }
        }
      } else dropped.push(`frames inside ${sections.length} section(s) (listing them failed: HTTP ${kids.status})`)
    }

    const wanted = [
      ...sections.map(s => ({ kind: 'section overview', id: s.id, name: s.name, scale: scaleFor(s.w, OVERVIEW_PX) })),
      ...frames.map(fr => ({ kind: 'frame', id: fr.id, name: fr.name, scale: scaleFor(fr.w, FRAME_PX) })),
    ]
    const budget = Math.max(0, MAX_RENDERS - renders.length)
    for (const w of wanted.slice(budget)) dropped.push(`${w.kind} ${w.name} (${w.id})`)

    // The images endpoint takes one scale per request, so ids are grouped by the scale they need.
    const byScale = new Map()
    for (const w of wanted.slice(0, budget)) byScale.set(w.scale, [...(byScale.get(w.scale) || []), w])
    for (const [scale, group] of byScale) {
      const img = await getJson(f, `${API}/images/${fileKey}?ids=${group.map(g => encodeURIComponent(g.id)).join(',')}&format=png&scale=${scale}`, token)
      if (!img.ok) { dropped.push(`${group.length} render(s) at scale ${scale} (images call failed: ${img.json?.err || `HTTP ${img.status}`})`); continue }
      for (const g of group) {
        const src = img.json.images?.[g.id]
        if (!src) { dropped.push(`${g.kind} ${g.name} (Figma returned no image)`); continue }
        try {
          const png = Buffer.from(await (await f(src)).arrayBuffer())
          renders.push({ ...g, file: write(`figma-${slug(fileKey)}-${slug(g.id)}.png`, png) })
        } catch (e) { dropped.push(`${g.kind} ${g.name} (download failed: ${e.message})`) }
      }
    }

    const cm = await getJson(f, `${API}/files/${fileKey}/comments`, token)
    if (cm.ok) {
      write(`figma-${slug(fileKey)}-comments.json`, JSON.stringify(cm.json))
      comments = comments.concat(cm.json.comments || [])
    } else commentsReason = `comments for ${fileKey} could not be fetched: ${cm.json?.err || `HTTP ${cm.status}`}`
  }

  const dir = docsDir(repoDir, key)
  fs.mkdirSync(dir, { recursive: true })
  const artifacts = []
  const doc = (name, text) => {
    const p = path.join(dir, name)
    fs.writeFileSync(p, text)
    artifacts.push(rel(repoDir, p))
  }
  doc('figma-outline.md', outlineMarkdown(key, roots, renders, dropped))
  if (!commentsReason) doc('figma-comments.md', commentsDigest(key, comments))

  const notes = [
    dropped.length ? `${dropped.length} item(s) not fetched (render cap ${MAX_RENDERS}): ${dropped.join('; ')}` : null,
    discovered.length ? `${discovered.length} linked Figma file(s) over the cap of ${MAX_FILES} were recorded but not fetched` : null,
    commentsReason,
  ].filter(Boolean)

  return mk('ok', notes.join(' · ') || null, {
    sourceUrl: files[0].url,
    artifacts,
    provenance: {
      groundedIn: 'figma-rest',
      handoff: { passed: ['links'], excluded: [] },
      discovered,
      files: files.slice(0, MAX_FILES).map(l => l.fileKey),
      renders: renders.length,
      comments: comments.length,
      dropped,
      // Reported, not chased: adding a browser to reach these was rejected in spec §1.
      devModeAnnotations: { status: 'unavailable', reason: 'not exposed by the Figma REST API; no browser stage exists to read them' },
      cache,   // absolute: the cache half lives outside the repo, so a repo-relative path would lie
    },
  })
}

export const STAGES = { figma }
