// lib/design-map.mjs — the design-system ⇄ Figma ⇄ code mapping.
//
// WHY THIS EXISTS
// ct-web-design-system's stories already carry `parameters.design.figma.url` for 47 of 52
// components — and they resolve to only 19 unique Figma nodes. Node 601:5 alone is claimed by
// seven components (Button, VoucherCodeField, InputFieldDesktop, IconButton, Autocomplete,
// Dropdown, DropdownDesktop). So the seed data LOOKS like 90% coverage and is ~40% correct at
// best. Every function here treats a story link as a CLAIM to be checked, never as a fact.
//
// Pure by design: paths and an injected fetch-shaped function in, data out. No Express, no
// process.env, no ambient network — that is what makes it testable without a Figma token.
import fs from 'node:fs'
import path from 'node:path'

const STORY_RE = /\.stories\.tsx?$/
// Matches both /file/ and /design/ URLs. The node id stops at a quote, &, or whitespace so a
// trailing &t=<tracking> is not swallowed into the id.
// ponytail: grep over source text, not an AST — the first figma.com URL in the file wins, so a
// stray commented-out or draft reference earlier in the file would be picked up instead of the
// real one. Parse the `parameters.design` object properly if that ever bites.
const FIGMA_URL_RE = /figma\.com\/(?:file|design)\/([A-Za-z0-9]+)\/[^"'\s]*?node-id=([^"'&\s]+)/

// Figma writes the same node id three ways: "601:5", "601%3A5" and "601-5". Normalise to colons
// so a collision check can actually see duplicates. Node ids contain no other dashes.
// A hand-copied link can carry a malformed %-escape (e.g. "601%3"); decodeURIComponent throws on
// those, and one bad row must degrade to a wrong-but-harmless id, not abort the whole harvest.
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

// The one definition of "unset" evidence. markCollisions here, buildMap (Task 4), and verifyRows
// (Task 6) are all writers of a row's `evidence` field — every one of them must build its object
// starting from this constant rather than repeating the literal, or the meaning of "unscored" /
// "unverified" will silently drift the day someone changes one copy and not the others.
// The nested array is frozen too: EMPTY_EVIDENCE is a shared module-level object, so an unfrozen
// [] handed out by spread would be one mutable array reference shared across every row that takes
// this default — freezing turns an accidental shared mutation into an immediate TypeError instead
// of a cross-row data-corruption bug.
const EMPTY_EVIDENCE = Object.freeze({ nameScore: 0, collisionWith: Object.freeze([]), verifiedAt: null })

// A node claimed by more than one component means the story link was copy-pasted from a sibling.
// Costs zero Figma API calls and is the single highest-signal check in L0: on the real repo it
// flags 37 components across 9 nodes.
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
    // collisionWith is recomputed from scratch every call, so it comes AFTER the spread of any
    // existing evidence — a stale list from a previous run must never win.
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

// Harvest + enumerate + collide, in one pass. Produces a complete map where every component has a
// row: `unmapped` when no story link exists, `proposed` when one does. Nothing is ever `confirmed`
// here — confirmation requires either a Figma check (verifyRows) or a human (the review queue).
export function buildMap(dsRepo) {
  const pkg = readJson(path.join(dsRepo, 'package.json'), {})
  const harvested = new Map(markCollisions(harvestStories(dsRepo)).map(r => [r.component, r]))
  const importFrom = pkg.name || '@tajawal/ct-web-design-system'

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

  // A story can name a component with no src/components dir (Colors, Tokens, TypographyList in the
  // real repo). Keep those rows — they are real mappings, just not directories.
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
