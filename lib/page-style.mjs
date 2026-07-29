// Post-processing for a live-page style capture (see server/page-capture.mjs).
//
// The idea this implements — describe a page by the CSS values it actually uses and how often,
// rather than by a screenshot — comes from the Perfect-Web-Clone / "Nexting" research writeup
// in RESEARCH_MERGED.md. That project ships no LICENSE file, so nothing here is derived from
// its source; this is written from the capability description alone.
//
// Everything in this file is pure. The browser-side collector hands over raw tallies and this
// turns them into ranked summaries, which is where the useful signal is: a value used 300 times
// is a design token, a value used once is a one-off.

// getComputedStyle already normalises colours to rgb()/rgba(), so the browser has done the hard
// part. This exists to fold `rgba(r,g,b,1)` into `rgb(r,g,b)` — the same colour written two ways
// would otherwise sit in the histogram as two separate tokens — and to give a hex for display.
export function normalizeColor(input) {
  const raw = String(input || '').trim()
  if (!raw) return null
  if (raw === 'transparent') return { key: 'transparent', hex: null, alpha: 0 }
  const m = raw.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)\s*(?:[,/]\s*([\d.%]+)\s*)?\)$/i)
  if (!m) {
    const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i)
    if (!hex) return { key: raw.toLowerCase(), hex: null, alpha: 1 } // keyword or gradient — keep verbatim
    let h = hex[1].toLowerCase()
    if (h.length === 3) h = h.split('').map(c => c + c).join('')
    const alpha = h.length === 8 ? Math.round((parseInt(h.slice(6, 8), 16) / 255) * 100) / 100 : 1
    const rgb = `#${h.slice(0, 6)}`
    return { key: alpha === 1 ? rgb : `${rgb}@${alpha}`, hex: rgb, alpha }
  }
  const [r, g, b] = [m[1], m[2], m[3]].map(n => Math.min(255, Math.round(parseFloat(n))))
  let alpha = 1
  if (m[4] != null) alpha = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
  alpha = Math.round(alpha * 100) / 100
  if (alpha === 0) return { key: 'transparent', hex: null, alpha: 0 }
  const hex = '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('')
  return { key: alpha === 1 ? hex : `${hex}@${alpha}`, hex, alpha }
}

// px values are the ones worth ranking — a spacing scale shows up as a handful of repeated
// numbers. Percentages and `auto` are layout decisions rather than tokens, so they're dropped.
export function parsePx(input) {
  const m = String(input || '').trim().match(/^(-?[\d.]+)px$/)
  if (!m) return null
  const n = parseFloat(m[1])
  return Number.isFinite(n) ? n : null
}

// { value: count } -> [{ value, count, share }] ranked by count. `share` is what makes a
// histogram readable: "#1a1a1a, 312 uses (41%)" says token, "used once (0.1%)" says accident.
export function rank(counts, { limit = 50, min = 1 } = {}) {
  const entries = Object.entries(counts || {}).filter(([, n]) => n >= min)
  const total = entries.reduce((s, [, n]) => s + n, 0)
  return entries
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count, share: total ? Math.round((count / total) * 1000) / 1000 : 0 }))
}

// Colour histogram, folding equivalent notations together before ranking.
export function rankColors(counts, opts) {
  const folded = {}
  const hexOf = {}
  for (const [value, n] of Object.entries(counts || {})) {
    const c = normalizeColor(value)
    if (!c || c.key === 'transparent') continue
    folded[c.key] = (folded[c.key] || 0) + n
    hexOf[c.key] = c.hex
  }
  return rank(folded, opts).map(r => ({ ...r, hex: hexOf[r.value] || null }))
}

// A spacing scale is the set of px values the page actually leans on. 0 is excluded because
// every page is mostly zeros and it drowns out the signal.
export function rankSpacing(counts, opts) {
  const folded = {}
  for (const [value, n] of Object.entries(counts || {})) {
    const px = parsePx(value)
    if (px == null || px === 0) continue
    folded[`${px}px`] = (folded[`${px}px`] || 0) + n
  }
  return rank(folded, opts).sort((a, b) => parsePx(a.value) - parsePx(b.value))
}

// Light or dark is decided from the page itself, not by asking the OS: plenty of pages ignore
// prefers-color-scheme entirely.
//
// The body background is the signal, and counting elements is not a substitute for it — on a
// white page with a coloured header and a few buttons, the brand colour wins a naive count and
// the page gets reported as dark. The histogram is only a fallback for when the body background
// is transparent or absent. Returns null when neither is legible, rather than defaulting to
// 'light': an unknown theme should read as unknown.
export function detectTheme(backgroundCounts, bodyBackground) {
  const body = normalizeColor(bodyBackground)
  let basis = null, from = null
  if (body?.hex && body.alpha === 1) { basis = body.hex; from = 'body' }
  else {
    const top = rankColors(backgroundCounts, { limit: 5 }).find(r => r.hex)
    if (top) { basis = top.hex; from = 'dominant' }
  }
  if (!basis) return { theme: null, basis: null, from: null }
  const h = basis.slice(1)
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))
  // Rec. 601 luma — cheap, and the decision only needs to be right about "closer to black or white".
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return { theme: luma < 0.5 ? 'dark' : 'light', basis, from, luma: Math.round(luma * 100) / 100 }
}

// Media-query breakpoints, deduped and ordered. Reading the widths a site actually responds at
// is far more reliable than guessing its framework from class names.
export function collectBreakpoints(mediaQueries) {
  const widths = new Map()
  for (const q of mediaQueries || []) {
    for (const m of String(q).matchAll(/\(\s*(min|max)-width\s*:\s*([\d.]+)(px|em|rem)\s*\)/gi)) {
      const px = m[3].toLowerCase() === 'px' ? parseFloat(m[2]) : parseFloat(m[2]) * 16
      const key = `${m[1].toLowerCase()}-${px}`
      if (!widths.has(key)) widths.set(key, { type: m[1].toLowerCase(), px, source: m[0] })
    }
  }
  return [...widths.values()].sort((a, b) => a.px - b.px || a.type.localeCompare(b.type))
}

// Turn the browser-side collection into the ranked summary that gets written to disk.
export function summarize(raw) {
  const c = raw?.counts || {}
  const backgrounds = rankColors(c.backgroundColor, { limit: 40 })
  return {
    colors: {
      text: rankColors(c.color, { limit: 40 }),
      background: backgrounds,
      border: rankColors(c.borderColor, { limit: 40 }),
    },
    typography: {
      family: rank(c.fontFamily, { limit: 20 }),
      size: rankSpacing(c.fontSize, { limit: 30 }),
      weight: rank(c.fontWeight, { limit: 15 }),
      lineHeight: rank(c.lineHeight, { limit: 20 }),
    },
    spacing: rankSpacing(c.spacing, { limit: 40 }),
    radii: rankSpacing(c.borderRadius, { limit: 20 }),
    shadows: rank(c.boxShadow, { limit: 20 }),
    theme: detectTheme(c.backgroundColor, raw?.bodyBackground),
    breakpoints: collectBreakpoints(raw?.mediaQueries),
    variableCount: Object.keys(raw?.cssVariables || {}).length,
    elementsSampled: raw?.elementsSampled || 0,
  }
}
