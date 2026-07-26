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
