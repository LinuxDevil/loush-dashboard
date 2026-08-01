// src/lib/selectionChips.js — feature 077: the editor hands chat a selection; chat shows it as a
// removable chip above the input and injects it into the next prompt.
//
// This file is the whole guardrail layer, and every guardrail here is designed to be VISIBLE:
//
//   * `includeData` is opt-in. A chip carries structured `data` only when the editor said so. A chip
//     whose data was withheld says "data not included" — the user must be able to tell what the model
//     will actually see.
//   * 32 KiB total cap. When it bites, the affected chip is marked `truncated` with the byte counts.
//     A silently truncated payload is the worst outcome available: the model answers confidently about
//     rows 1-40 while the user believes it read all 900.
//   * Cyclic and non-JSON-serialisable values are stripped, and each strip is recorded in `dropped`
//     so the chip can show "3 values stripped" with a tooltip listing them.
//   * Serialisation NEVER throws. `JSON.stringify` on a cycle throws, and a throw here would take out
//     the chat input on a stray DOM node in a selection payload.

export const CHIP_TOTAL_CAP_BYTES = 32 * 1024
export const CHIP_LABEL_MAX = 120
export const CHIP_MAX_COUNT = 24
export const CHIP_MAX_DEPTH = 12

const byteLen = s => {
  // TextEncoder is the truth for a byte cap; the 2-bytes-per-char fallback keeps node --test happy on
  // any runtime that lacks it rather than silently measuring in code units.
  try { return new TextEncoder().encode(s).length } catch { return s.length * 2 }
}

/** Cut a string to a byte budget without splitting a surrogate pair (which would emit U+FFFD). */
function sliceToBytes(s, maxBytes) {
  if (byteLen(s) <= maxBytes) return s
  let lo = 0, hi = s.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (byteLen(s.slice(0, mid)) <= maxBytes) lo = mid; else hi = mid - 1
  }
  let out = s.slice(0, lo)
  const last = out.charCodeAt(out.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1) // lone high surrogate
  return out
}

/**
 * JSON-serialise anything without throwing. Cycles become a marker naming the path they point back to;
 * values JSON cannot carry are replaced by a marker and recorded.
 *
 * @returns {{text:string|null, bytes:number, dropped:Array<{path:string, why:string}>, reason:string|null}}
 */
export function safeSerialize(value, opts = {}) {
  const maxDepth = Number.isFinite(opts.maxDepth) ? opts.maxDepth : CHIP_MAX_DEPTH
  const dropped = []
  const drop = (path, why) => { if (dropped.length < 200) dropped.push({ path, why }) }
  // Ancestors only, not "everything seen" — a value referenced twice in a tree is legal JSON and must
  // not be reported as a cycle.
  const ancestors = new Map()

  const walk = (v, path, depth) => {
    if (v === null) return null
    const t = typeof v
    if (t === 'string' || t === 'boolean') return v
    if (t === 'number') {
      if (Number.isFinite(v)) return v
      drop(path, `${String(v)} is not representable in JSON`)
      return `[${String(v)}]`
    }
    if (t === 'bigint') { drop(path, 'BigInt cannot be JSON-encoded — sent as a decimal string'); return v.toString() }
    if (t === 'undefined') { drop(path, 'undefined has no JSON form'); return '[undefined]' }
    if (t === 'function') { drop(path, 'functions are not data'); return '[function]' }
    if (t === 'symbol') { drop(path, 'symbols have no JSON form'); return '[symbol]' }
    if (t !== 'object') { drop(path, `unsupported type ${t}`); return `[${t}]` }

    if (ancestors.has(v)) { drop(path, `cycle back to ${ancestors.get(v)}`); return `[cycle → ${ancestors.get(v)}]` }
    if (depth > maxDepth) { drop(path, `deeper than the ${maxDepth}-level nesting limit`); return '[too deep]' }

    if (v instanceof Date) return Number.isNaN(v.getTime()) ? (drop(path, 'invalid Date'), '[invalid date]') : v.toISOString()
    if (v instanceof RegExp) return String(v)
    if (v instanceof Error) return { name: v.name, message: v.message }

    ancestors.set(v, path)
    try {
      if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}[${i}]`, depth + 1))
      if (v instanceof Map) return { '[Map]': [...v.entries()].map(([k, x], i) => [walk(k, `${path}.key${i}`, depth + 1), walk(x, `${path}.val${i}`, depth + 1)]) }
      if (v instanceof Set) return { '[Set]': [...v].map((x, i) => walk(x, `${path}[${i}]`, depth + 1)) }
      // A DOM node's own enumerable keys are nothing useful and its graph is enormous.
      if (typeof v.nodeType === 'number' && typeof v.nodeName === 'string') { drop(path, 'DOM node — not serialisable data'); return `[<${String(v.nodeName).toLowerCase()}>]` }
      const out = {}
      let keys
      try { keys = Object.keys(v) } catch { drop(path, 'object refused key enumeration (exotic proxy?)'); return '[unreadable object]' }
      for (const k of keys) {
        let child
        // A throwing getter must not take the chat input down with it.
        try { child = v[k] } catch (e) { drop(`${path}.${k}`, `getter threw: ${e?.message || e}`); out[k] = '[getter threw]'; continue }
        if (typeof child === 'undefined') { drop(`${path}.${k}`, 'undefined property omitted'); continue }
        out[k] = walk(child, `${path}.${k}`, depth + 1)
      }
      return out
    } finally { ancestors.delete(v) }
  }

  let text = null, reason = null
  try {
    const safe = walk(value, '$', 0)
    text = JSON.stringify(safe, null, 2)
    if (typeof text !== 'string') { text = null; reason = 'the value has no JSON representation at all' }
  } catch (e) {
    // Belt and braces: the walk above should have removed every throwing case, but a stringify failure
    // must still degrade to a reason instead of an exception in a render path.
    text = null
    reason = `could not serialise: ${e?.message || e}`
  }
  return { text, bytes: text === null ? 0 : byteLen(text), dropped, reason }
}

/**
 * Validate one chip from the editor. Never throws; a rejected chip comes back with `ok:false` and a
 * reason the UI can show, because a chip that silently fails to appear looks like a broken button.
 */
export function normalizeChip(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, chip: null, reason: 'chip must be an object' }
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : null
  if (!id) return { ok: false, chip: null, reason: 'chip has no id — chat cannot dedupe or remove it' }

  const rawLabel = typeof raw.label === 'string' ? raw.label.replace(/\s+/g, ' ').trim() : ''
  const labelClipped = rawLabel.length > CHIP_LABEL_MAX
  return {
    ok: true,
    reason: null,
    chip: {
      id,
      // Unknown is a value: no label given means we say so, we do not invent one from the id.
      label: rawLabel ? (labelClipped ? rawLabel.slice(0, CHIP_LABEL_MAX - 1) + '…' : rawLabel) : '(unlabelled selection)',
      labelClipped,
      description: typeof raw.description === 'string' ? raw.description : null,
      icon: typeof raw.icon === 'string' && raw.icon ? raw.icon : '◈',
      includeData: raw.includeData === true, // opt-in, strictly — a truthy string does not count
      hasData: Object.prototype.hasOwnProperty.call(raw, 'data') && raw.data !== undefined,
      data: raw.data,
      source: typeof raw.source === 'string' ? raw.source : null, // e.g. the file path / tab id
      tabId: typeof raw.tabId === 'string' ? raw.tabId : null,
    },
  }
}

/**
 * Serialise a set of chips into a fixed byte budget.
 *
 * Budget order is chip order, so the earliest chips keep full fidelity and the user can see exactly
 * which one got cut. Every cut is recorded on the chip AND in `notes`.
 *
 * @returns {{chips:Array, totalBytes:number, capBytes:number, capHit:boolean, notes:string[], rejected:Array}}
 */
export function packChips(rawChips, opts = {}) {
  const capBytes = Number.isFinite(opts.capBytes) && opts.capBytes >= 0 ? Math.floor(opts.capBytes) : CHIP_TOTAL_CAP_BYTES
  const maxCount = Number.isFinite(opts.maxCount) && opts.maxCount > 0 ? Math.floor(opts.maxCount) : CHIP_MAX_COUNT
  const list = Array.isArray(rawChips) ? rawChips : []
  const notes = []
  const rejected = []

  const seen = new Set()
  const accepted = []
  for (const raw of list) {
    const n = normalizeChip(raw)
    if (!n.ok) { rejected.push({ raw, reason: n.reason }); continue }
    if (seen.has(n.chip.id)) { rejected.push({ raw, reason: `duplicate chip id "${n.chip.id}" — kept the first` }); continue }
    seen.add(n.chip.id)
    accepted.push(n.chip)
  }
  if (rejected.length) notes.push(`${rejected.length} selection${rejected.length > 1 ? 's were' : ' was'} not added — see the chip tray for why`)

  let overflow = []
  if (accepted.length > maxCount) {
    overflow = accepted.slice(maxCount)
    notes.push(`chip limit is ${maxCount} — ${overflow.length} more selection${overflow.length > 1 ? 's are' : ' is'} not attached`)
  }
  const kept = accepted.slice(0, maxCount)

  let used = 0
  const chips = kept.map(chip => {
    const out = {
      ...chip,
      payload: null,
      bytes: 0,
      truncated: false,
      truncatedFrom: null,
      dropped: [],
      note: null,
    }
    if (!chip.hasData) {
      out.note = 'no structured data was attached to this selection'
      return out
    }
    if (!chip.includeData) {
      // Opt-in, and visibly so. The chip still exists (the label is useful context); the payload does not.
      out.note = 'data not included — turn on “send data” for this chip to attach it'
      return out
    }
    const ser = safeSerialize(chip.data, opts)
    if (ser.text === null) {
      out.note = ser.reason || 'this selection’s data could not be serialised'
      out.dropped = ser.dropped
      return out
    }
    out.dropped = ser.dropped
    if (ser.dropped.length) out.note = `${ser.dropped.length} value${ser.dropped.length > 1 ? 's' : ''} stripped (cyclic or not JSON-safe)`

    const remaining = capBytes - used
    if (ser.bytes <= remaining) {
      out.payload = ser.text
      out.bytes = ser.bytes
      used += ser.bytes
      return out
    }
    // Cap bites. Say so on the chip, in bytes, and mark the payload as an excerpt — the truncated text
    // is no longer valid JSON, and passing it off as JSON would be its own small lie.
    out.payload = remaining > 0 ? sliceToBytes(ser.text, remaining) : ''
    out.bytes = byteLen(out.payload)
    out.truncated = true
    out.truncatedFrom = ser.bytes
    used += out.bytes
    out.note = `truncated: ${fmtKiB(out.bytes)} of ${fmtKiB(ser.bytes)} attached (32 KiB total budget) — the model will not see the rest`
    return out
  })

  const capHit = chips.some(c => c.truncated)
  if (capHit) notes.push(`the ${fmtKiB(capBytes)} attachment budget was reached — truncated chips are marked below`)

  return { chips, totalBytes: used, capBytes, capHit, notes, rejected, overflow }
}

const fmtKiB = n => (n >= 1024 ? (n / 1024).toFixed(1) + ' KiB' : n + ' B')

/**
 * Chips belong to editor tabs. When a tab closes its chips go — keeping them would inject a selection
 * from a file the user can no longer see, which they cannot audit and cannot remove by closing it again.
 * Returns the survivors plus a notice naming what went, so the disappearance is explained.
 */
export function chipsForOpenTabs(chips, openTabIds) {
  const list = Array.isArray(chips) ? chips : []
  const open = new Set(Array.isArray(openTabIds) ? openTabIds : [])
  const kept = [], removed = []
  for (const c of list) {
    // A chip with no tabId is not owned by any tab (e.g. pasted context) and survives.
    if (!c || !c.tabId || open.has(c.tabId)) kept.push(c); else removed.push(c)
  }
  return {
    kept,
    removed,
    notice: removed.length ? `${removed.length} chip${removed.length > 1 ? 's' : ''} removed because their editor tab${removed.length > 1 ? 's were' : ' was'} closed: ${removed.map(c => c.label).join(', ')}` : null,
  }
}

/**
 * Render packed chips into the block prepended to the user's next prompt. Truncation and stripping are
 * stated inside the prompt itself, so the model is told the data is partial too — not just the user.
 */
export function chipsToPrompt(packed) {
  const p = packed && Array.isArray(packed.chips) ? packed : { chips: [] }
  if (!p.chips.length) return ''
  const parts = ['<editor-selection>']
  for (const c of p.chips) {
    parts.push(`- ${c.label}${c.description ? ` — ${c.description}` : ''}${c.source ? ` (${c.source})` : ''}`)
    if (c.payload) {
      if (c.truncated) parts.push(`  NOTE: the data below is TRUNCATED at ${c.bytes} of ${c.truncatedFrom} bytes and is not valid JSON. Do not assume it is complete.`)
      if (c.dropped.length) parts.push(`  NOTE: ${c.dropped.length} value(s) were stripped as cyclic or non-JSON-serialisable.`)
      parts.push('  ```json', ...c.payload.split('\n').map(l => '  ' + l), '  ```')
    } else if (c.note) {
      parts.push(`  (${c.note})`)
    }
  }
  parts.push('</editor-selection>')
  return parts.join('\n')
}
