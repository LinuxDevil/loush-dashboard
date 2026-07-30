// src/lib/viewerModes.js — feature 073: which of Source / Preview / Diff are meaningful for THIS file.
//
// The decision lives here, out of the component, because it is the part with rules worth testing:
// "a .mjs has no preview" is a claim, and a claim needs a reason attached to it.
//
// Two house rules drive the shape of the return value:
//   * Unknown is a value. An extension we have no renderer for is not "probably text" — it is unknown,
//     and `available:false` carries a reason saying exactly that.
//   * No silent caps. The preview size cap and the binary sniff both produce a `warning` the segmented
//     control must render, not an invisible clamp.
//
// Crucially: a mode that is unavailable is DISABLED with a hover reason. It is never silently swapped
// for Source — a toggle that ignores your click looks broken, and an empty pane looks like a bug.

export const MODES = ['source', 'preview', 'diff']

// Extensions with a real rendered form in src/ui/viewers.jsx today.
const PREVIEWABLE = {
  md: 'rendered markdown',
  markdown: 'rendered markdown',
  html: 'sandboxed page',
  htm: 'sandboxed page',
  svg: 'rendered image',
  csv: 'sortable table',
  tsv: 'sortable table',
  json: 'parsed tree / table',
  jsx: 'live component sandbox',
  tsx: 'live component sandbox',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image',
  pdf: 'embedded document',
}

// Text formats we positively know have NO rendered form. Naming them separately from "unknown" matters:
// the reason we show the user is different, and only one of the two is a gap in our coverage.
const NO_PREVIEW = {
  mjs: 'a JavaScript module', js: 'a JavaScript file', cjs: 'a JavaScript module',
  ts: 'a TypeScript file', mts: 'a TypeScript module',
  py: 'a Python file', sh: 'a shell script', rb: 'a Ruby file', go: 'a Go file', rs: 'a Rust file',
  java: 'a Java file', c: 'a C file', h: 'a C header', cpp: 'a C++ file',
  css: 'a stylesheet', txt: 'a plain text file', log: 'a log file', jsonl: 'a JSON-lines stream',
  yml: 'a YAML file', yaml: 'a YAML file', toml: 'a TOML file', ini: 'a config file', env: 'an env file',
  lock: 'a lockfile', gitignore: 'a git ignore file',
}

// Rendering a 20MB markdown file locks the tab. The cap is enforced AND announced.
export const PREVIEW_MAX_BYTES = 2 * 1024 * 1024
// Past this, even syntax-highlighting the source is slow enough to feel broken.
export const SOURCE_MAX_BYTES = 8 * 1024 * 1024

const fmtBytes = n => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B')

/**
 * @param {{ext?:string, name?:string, size?:number|null, isBinary?:boolean|null, hasBaseline?:boolean, dirty?:boolean}} file
 * @returns {{
 *   modes: Array<{id:string, label:string, available:boolean, reason:string|null, warning:string|null}>,
 *   defaultMode: string,
 *   unknownType: boolean,
 * }}
 */
export function modeAvailability(file) {
  const f = file && typeof file === 'object' ? file : {}
  const rawExt = typeof f.ext === 'string' && f.ext
    ? f.ext
    : typeof f.name === 'string' && f.name.includes('.') ? f.name.split('.').pop() : ''
  const ext = String(rawExt || '').toLowerCase().replace(/^\./, '')
  const size = Number.isFinite(f.size) ? f.size : null   // null = we were not told; do not assume 0
  const isBinary = f.isBinary === true
  const previewKind = PREVIEWABLE[ext]
  const knownNoPreview = NO_PREVIEW[ext]
  const unknownType = !previewKind && !knownNoPreview
  const extLabel = ext ? '.' + ext : 'this file (no extension)'

  // --- source ---
  let source = { id: 'source', label: 'Source', available: true, reason: null, warning: null }
  if (isBinary)
    source = { id: 'source', label: 'Source', available: false, reason: `${extLabel} is binary — its bytes are not text, so a source view would show mojibake`, warning: null }
  else if (size !== null && size > SOURCE_MAX_BYTES)
    source.warning = `${fmtBytes(size)} file — the editor is capped at ${fmtBytes(SOURCE_MAX_BYTES)}; the rest is not shown`
  else if (size === null)
    source.warning = 'file size is unknown, so no size cap could be checked up front'

  // --- preview ---
  let preview
  if (previewKind) {
    preview = { id: 'preview', label: 'Preview', available: true, reason: null, warning: null }
    if (size !== null && size > PREVIEW_MAX_BYTES)
      preview.warning = `only the first ${fmtBytes(PREVIEW_MAX_BYTES)} of ${fmtBytes(size)} is rendered`
  } else if (knownNoPreview) {
    preview = { id: 'preview', label: 'Preview', available: false, warning: null,
      reason: `${extLabel} is ${knownNoPreview} — there is no rendered form of it, so Preview would show the same text as Source` }
  } else if (isBinary) {
    preview = { id: 'preview', label: 'Preview', available: false, warning: null,
      reason: `${extLabel} is binary and no viewer is registered for it — nothing can be rendered` }
  } else {
    // Unknown is a value: say we do not know, rather than guessing "probably text, show source".
    preview = { id: 'preview', label: 'Preview', available: false, warning: null,
      reason: `no preview renderer is registered for ${extLabel} — rather than guess at a format, this pane stays off` }
  }

  // --- diff ---
  let diff
  if (isBinary)
    diff = { id: 'diff', label: 'Diff', available: false, warning: null, reason: 'binary files have no line diff' }
  else if (f.hasBaseline === true)
    diff = { id: 'diff', label: 'Diff', available: true, reason: null,
      warning: f.dirty === false ? 'buffer matches the saved file — the diff will be empty' : null }
  else
    diff = { id: 'diff', label: 'Diff', available: false, warning: null,
      reason: 'no baseline to compare against — the file has not been loaded or saved in this session yet' }

  const modes = [source, preview, diff]
  // Default to the richest available view, but never to Diff: opening a file straight into a diff hides
  // the file itself, which is not what "open this artifact" means.
  const defaultMode = preview.available ? 'preview' : source.available ? 'source' : 'diff'
  return { modes, defaultMode, unknownType }
}

/**
 * Resolve a requested mode against current availability. Returns `changed:true` plus a reason whenever
 * the request could not be honoured, so the UI can say "Preview is off for .mjs — showing Source"
 * instead of just flipping the highlight and looking like it ignored the click.
 */
export function resolveMode(requested, availability) {
  const av = availability && Array.isArray(availability.modes) ? availability : modeAvailability({})
  const find = id => av.modes.find(m => m.id === id) || null
  const want = find(requested)
  if (!want)
    return { mode: av.defaultMode, changed: true, reason: `"${requested}" is not a view mode — using ${av.defaultMode}`, warning: find(av.defaultMode)?.warning || null }
  if (want.available) return { mode: want.id, changed: false, reason: null, warning: want.warning }
  const fallback = find(av.defaultMode)
  const usable = fallback && fallback.available ? fallback : av.modes.find(m => m.available)
  if (!usable)
    return { mode: null, changed: true, reason: `no view mode is available for this file: ${av.modes.map(m => `${m.label} — ${m.reason}`).join('; ')}`, warning: null }
  return { mode: usable.id, changed: true, reason: `${want.label} is unavailable (${want.reason}) — showing ${usable.label}`, warning: usable.warning }
}
