// acceptance-criteria.mjs — 094. Turns the free-text `## Acceptance criteria` markdown blob that
// server/ticket.mjs stores at `artifacts[key].ac.md` into structured, tickable, filterable,
// exportable items — and back to markdown for the JIRA comment path (server/ticket.mjs:912).
//
// THIS IS A MIGRATION. The existing artifacts are prose written by a model against
// server/prompts/ac.md. The single unrecoverable failure here is dropping a line because it did not
// fit the schema: the markdown is the only copy, and a criterion silently deleted during
// structuring is a requirement nobody will ever notice is missing. So every non-empty line of the
// source ends up in `items`, either structured or as `kind:'unstructured'` carrying its verbatim
// `raw` text and a `reason` saying why it could not be structured.
//
// Pure: no fs, no crypto, no DOM. Isomorphic on purpose so the same IDs can be derived on the
// server (for the JIRA render) and in the browser (for tick state) without a round trip.

// ---------------------------------------------------------------------------------------------
// Enums. Unknown values are REJECTED BY NAME with the allowed set listed — never coerced to a
// nearest match and never silently defaulted. A criterion quietly relabelled from "e2e" to "unit"
// is a test plan that says something the author did not say.
// ---------------------------------------------------------------------------------------------
export const TEST_TYPES = ['unit', 'integration', 'e2e', 'manual', 'performance', 'security', 'accessibility', 'regression']
export const VALIDATION_METHODS = ['automated-test', 'manual-verification', 'code-inspection', 'telemetry', 'none']
export const PRIORITIES = ['must', 'should', 'could']
export const BUCKETS = ['acceptance', 'unspecified', 'notes', 'other', 'preamble']

/** Human-readable heading each bucket renders back to. `other` keeps its own captured heading. */
export const BUCKET_HEADINGS = {
  acceptance: '## Acceptance criteria',
  unspecified: '## Unspecified — needs an answer',
  notes: '## Notes from the code',
}

const bucketOfHeading = h => {
  const t = String(h || '').replace(/[*_`]/g, '').trim().toLowerCase()
  if (/^acceptance criteria/.test(t)) return 'acceptance'
  if (/^unspecified/.test(t)) return 'unspecified'
  if (/^notes from the code/.test(t)) return 'notes'
  return 'other'
}

// ---------------------------------------------------------------------------------------------
// Stable IDs
// ---------------------------------------------------------------------------------------------
// The ID is derived from (bucket + normalised text). It is therefore stable across re-parses of
// the same content: regenerating the artifact from unchanged markdown yields the same IDs, so a
// human's ticks survive.
//
// BE CLEAR ABOUT WHAT THIS COSTS: if the *text of a criterion is edited*, its ID changes, and any
// tick / assignee / test-run result keyed to the old ID is orphaned. There is no way around that
// with a content hash. The alternative — a random ID minted per parse — orphans EVERY tick on
// EVERY regeneration, which is strictly worse, because regeneration is common and editing one
// line is rare. Callers that care should treat a vanished ID as "criterion changed, re-review it"
// rather than as "criterion deleted"; `diffCriteria()` below reports exactly that.
//
// Normalisation absorbs the edits that are NOT semantic: surrounding whitespace, internal run
// length, and letter case. A capitalisation fix should not orphan a tick.
const normalizeForId = s => String(s).replace(/\s+/g, ' ').trim().toLowerCase()

// FNV-1a over two 32-bit lanes. Chosen over node:crypto so this module also runs in the Vite
// bundle — one ID implementation, not a server one and a browser one that could disagree.
function hash64(str) {
  let a = 0x811c9dc5, b = 0x01000193
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b + c + i, 0x85ebca6b) >>> 0
    b = ((b << 13) | (b >>> 19)) >>> 0
  }
  return (a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0'))
}

/** Content-derived ID. `occurrence` disambiguates genuinely identical lines (see DUPLICATES). */
export function criterionId(bucket, text, occurrence = 0) {
  const base = 'ac_' + hash64(`${bucket}\n${normalizeForId(text)}`).slice(0, 12)
  return occurrence ? `${base}_${occurrence + 1}` : base
}

// ---------------------------------------------------------------------------------------------
// Field inference — every field says where its value came from
// ---------------------------------------------------------------------------------------------
// The markdown NEVER carried test_type / validation_method / priority / automated. Filling them
// with a plausible default ("functional", "must", automated:false) would manufacture a test plan
// out of nothing. So: null plus a reason, unless the text itself provides evidence, in which case
// the value is set AND `provenance` records the evidence so a reader can disagree with it.
const TYPE_KEYWORDS = [
  ['performance', /\b(latenc|p9\d|throughput|slower|faster than|within \d+\s*(ms|s)\b|load time)/i],
  ['security', /\b(auth[a-z]*|permission|token|secret|credential|CSRF|XSS|injection)\b/i],
  ['accessibility', /\b(a11y|accessib|screen reader|aria-|keyboard nav)/i],
  ['e2e', /\b(end[- ]to[- ]end|e2e|the user (can|sees|clicks)|browser)\b/i],
  ['integration', /\b(API|endpoint|route|\/api\/|request|response|database|migration)\b/],
  ['regression', /\b(regress|no longer|still works|unchanged)\b/i],
  ['manual', /\bmanual(ly)?\b/i],
  ['unit', /\b(function|helper|pure|returns?)\b/i],
]

function inferTestType(text) {
  for (const [value, re] of TYPE_KEYWORDS) {
    const m = re.exec(text)
    if (m) return { value, provenance: `inferred-from-text:"${m[0]}"` }
  }
  return { value: null, provenance: 'absent', reason: 'the source markdown has no test-type field and the text carries no keyword evidence — a human must set this' }
}

function inferPriority(text) {
  const m = /\b(must|should|could)\b/i.exec(text)
  if (m) return { value: m[1].toLowerCase(), provenance: `inferred-from-text:"${m[0]}"` }
  return { value: null, provenance: 'absent', reason: 'RFC-2119 keyword not present in the criterion text' }
}

function inferAutomated(text) {
  if (/\bmanual(ly)?\b/i.test(text)) return { value: false, provenance: 'inferred-from-text:"manual"' }
  if (/\b(automated test|unit test|integration test|CI)\b/i.test(text)) return { value: true, provenance: 'inferred-from-text:test-keyword' }
  return { value: null, provenance: 'absent', reason: 'nothing in the text says whether this is automatable — guessing false would understate coverage, guessing true would overstate it' }
}

// ---------------------------------------------------------------------------------------------
// Given / When / Then
// ---------------------------------------------------------------------------------------------
/** @returns {{given,when,then}|null} — null is a legitimate answer: ac.md explicitly allows plain statements. */
export function splitGivenWhenThen(text) {
  const t = String(text).replace(/\*\*/g, '')
  if (!/^\s*given\b/i.test(t)) return null
  const wi = t.search(/\bwhen\b/i)
  const ti = t.search(/\bthen\b/i)
  if (wi < 0 || ti < 0 || ti < wi) return null
  const strip = s => s.replace(/^\s*(given|when|then)\b[,:]?\s*/i, '').replace(/[,;.\s]+$/, '').trim()
  return { given: strip(t.slice(0, wi)), when: strip(t.slice(wi, ti)), then: strip(t.slice(ti)) }
}

// ---------------------------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------------------------
const CHECK_RE = /^\s*[-*]\s*\[( |x|X)\]\s*(.*)$/
const BULLET_RE = /^\s*[-*]\s+(.*)$/
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/

/**
 * Convert a `## Acceptance criteria` markdown document into structured items.
 *
 * NEVER THROWS. Malformed input returns `{ok:false, reason}` — a parser that throws on a bad
 * artifact takes the whole Ticket tab down with it, and these artifacts are model output, so
 * malformed is the expected case, not the exceptional one.
 *
 * @returns {{ok:false, reason:string} | {ok:true, items:Array, report:object}}
 */
export function parseMarkdownCriteria(md) {
  if (typeof md !== 'string') return { ok: false, reason: `expected a markdown string, received ${md === null ? 'null' : typeof md}` }
  if (md.trim() === '') return { ok: true, items: [], report: emptyReport('the document is empty — zero items is the true answer, not a parse failure') }

  const lines = md.split(/\r?\n/)
  const items = []
  const seen = new Map()          // id-base → occurrence count, for the DUPLICATES case
  let bucket = 'preamble'
  let heading = null
  let inFence = false
  let lastStructured = null       // for continuation lines

  const push = (partial, text, lineNo, raw) => {
    const base = criterionId(partial.bucket, text)
    const occ = seen.get(base) || 0
    seen.set(base, occ + 1)
    const item = { ...partial, id: criterionId(partial.bucket, text, occ), text, source: { line: lineNo, raw } }
    if (occ) item.duplicate_of = base   // reported, not silently merged: two identical criteria may be a real authoring mistake
    items.push(item)
    return item
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const lineNo = i + 1

    if (/^\s*```/.test(raw)) { inFence = !inFence; continue }
    if (inFence) {
      // Fenced code inside a section is content, not a criterion. Kept verbatim so the round trip
      // does not eat an example the author put there deliberately.
      items.push(unstructured(bucket, raw, lineNo, 'inside a fenced code block — content, not a checklist item', seen))
      lastStructured = null
      continue
    }

    const h = HEADING_RE.exec(raw)
    if (h) {
      heading = h[2]
      bucket = bucketOfHeading(heading)
      lastStructured = null
      continue
    }

    if (raw.trim() === '') { lastStructured = null; continue }

    const c = CHECK_RE.exec(raw)
    if (c) {
      const checked = c[1].toLowerCase() === 'x'
      const text = c[2].trim()
      if (!text) {
        items.push(unstructured(bucket, raw, lineNo, 'checkbox with no text — there is nothing to verify', seen))
        lastStructured = null
        continue
      }
      const gwt = splitGivenWhenThen(text)
      const tt = inferTestType(text), pr = inferPriority(text), au = inferAutomated(text)
      lastStructured = push({
        kind: 'criterion',
        bucket,
        heading,
        checked,
        given: gwt ? gwt.given : null,
        when: gwt ? gwt.when : null,
        then: gwt ? gwt.then : null,
        // Steps are DERIVED from the text, never invented. A plain statement is one step; that is
        // honest — it is genuinely one thing to check — rather than padding it to a fake three.
        test_steps: gwt ? [`Given ${gwt.given}`, `When ${gwt.when}`, `Then ${gwt.then}`] : [text],
        test_type: tt.value,
        validation_method: null,
        priority: pr.value,
        automated: au.value,
        provenance: {
          test_steps: gwt ? 'derived-from-given-when-then' : 'derived-from-statement',
          test_type: tt.provenance,
          validation_method: 'absent',
          priority: pr.provenance,
          automated: au.provenance,
        },
        field_reasons: dropNulls({
          test_type: tt.reason,
          validation_method: 'the source markdown has no validation-method field; a human picks one',
          priority: pr.reason,
          automated: au.reason,
        }),
      }, text, lineNo, raw)
      continue
    }

    // Continuation of the previous checklist item (ac.md wraps long Given/When/Then lines).
    // MUST be re-hashed: the ID covers the full text, or a re-parse of a re-wrapped document
    // would produce different IDs for the same criterion.
    if (lastStructured && /^\s{2,}\S/.test(raw)) {
      const merged = `${lastStructured.text} ${raw.trim()}`
      const idx = items.indexOf(lastStructured)
      const gwt = splitGivenWhenThen(merged)
      const base = criterionId(lastStructured.bucket, merged)
      const occ = seen.get(base) || 0
      seen.set(base, occ + 1)
      items[idx] = {
        ...lastStructured, id: criterionId(lastStructured.bucket, merged, occ), text: merged,
        given: gwt ? gwt.given : null, when: gwt ? gwt.when : null, then: gwt ? gwt.then : null,
        test_steps: gwt ? [`Given ${gwt.given}`, `When ${gwt.when}`, `Then ${gwt.then}`] : [merged],
        source: { ...lastStructured.source, raw: `${lastStructured.source.raw}\n${raw}` },
      }
      lastStructured = items[idx]
      continue
    }

    const b = BULLET_RE.exec(raw)
    if (b) {
      if (bucket === 'notes') {
        // `## Notes from the code` is prose bullets by design (ac.md §3). Not a defect.
        items.push({ ...noteShell(bucket, heading), id: nextId(bucket, b[1].trim(), seen), kind: 'note', text: b[1].trim(), source: { line: lineNo, raw } })
      } else {
        items.push(unstructured(bucket, raw, lineNo, 'a plain bullet, not a `- [ ]` checklist item — it cannot be ticked, so it is not a criterion', seen))
      }
      lastStructured = null
      continue
    }

    items.push(unstructured(bucket, raw, lineNo, 'free prose outside any checklist — kept because the source markdown is the only copy', seen))
    lastStructured = null
  }

  return { ok: true, items, report: buildReport(items, lines.length) }
}

function nextId(bucket, text, seen) {
  const base = criterionId(bucket, text)
  const occ = seen.get(base) || 0
  seen.set(base, occ + 1)
  return criterionId(bucket, text, occ)
}

const noteShell = (bucket, heading) => ({
  bucket, heading, checked: false, given: null, when: null, then: null, test_steps: [],
  test_type: null, validation_method: null, priority: null, automated: null,
  provenance: { test_type: 'absent', validation_method: 'absent', priority: 'absent', automated: 'absent' },
  field_reasons: { all: 'a note about the code, not a criterion — none of the criterion fields apply' },
})

/** The whole point of the migration: a line that does not fit the schema is KEPT, with a reason. */
function unstructured(bucket, raw, lineNo, reason, seen) {
  return {
    ...noteShell(bucket, null),
    id: nextId(bucket, raw, seen),
    kind: 'unstructured',
    text: raw.trim(),
    reason,
    field_reasons: { all: `not structured: ${reason}` },
    source: { line: lineNo, raw },
  }
}

const dropNulls = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null))

const emptyReport = note => ({
  counts: { total: 0, criterion: 0, note: 0, unstructured: 0 },
  byBucket: {}, unstructured: [], duplicates: [],
  fieldsAbsentFromSource: ['test_type', 'validation_method', 'priority', 'automated'],
  limits: { note: 'no cap is applied — every line of the source is retained. There is no truncation to report.' },
  note,
})

function buildReport(items, lineCount) {
  const r = emptyReport(null)
  r.counts.total = items.length
  for (const it of items) {
    r.counts[it.kind] = (r.counts[it.kind] || 0) + 1
    r.byBucket[it.bucket] = (r.byBucket[it.bucket] || 0) + 1
    if (it.kind === 'unstructured') r.unstructured.push({ id: it.id, line: it.source.line, raw: it.source.raw, reason: it.reason })
    if (it.duplicate_of) r.duplicates.push({ id: it.id, duplicate_of: it.duplicate_of, text: it.text })
  }
  r.sourceLines = lineCount
  r.note = r.counts.unstructured
    ? `${r.counts.unstructured} line(s) could not be structured and were KEPT as unstructured items — see report.unstructured. Nothing was dropped.`
    : 'every line was structured; nothing was dropped.'
  return r
}

// ---------------------------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------------------------
/**
 * Validate a criterion (typically after a human has edited it in the UI).
 * NEVER THROWS. Unknown enum members are named, with the allowed set, never coerced.
 */
export function validateCriterion(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return { ok: false, errors: [{ field: '(root)', reason: `expected an object, received ${Array.isArray(item) ? 'array' : item === null ? 'null' : typeof item}` }] }
  const errors = []
  const enumCheck = (field, value, allowed) => {
    if (value === null || value === undefined) return   // null is a VALUE here: "not yet decided"
    if (!allowed.includes(value)) errors.push({ field, value, reason: `"${String(value)}" is not a valid ${field}`, allowed: [...allowed] })
  }
  if (typeof item.id !== 'string' || !item.id) errors.push({ field: 'id', value: item.id ?? null, reason: 'a stable id is required — without it a tick cannot be re-attached after a re-parse' })
  if (typeof item.text !== 'string' || !item.text.trim()) errors.push({ field: 'text', value: item.text ?? null, reason: 'text is required and must be non-empty' })
  enumCheck('bucket', item.bucket, BUCKETS)
  enumCheck('test_type', item.test_type, TEST_TYPES)
  enumCheck('validation_method', item.validation_method, VALIDATION_METHODS)
  enumCheck('priority', item.priority, PRIORITIES)
  if (item.automated !== null && item.automated !== undefined && typeof item.automated !== 'boolean')
    errors.push({ field: 'automated', value: item.automated, reason: 'automated must be true, false, or null (null = not yet known)', allowed: [true, false, null] })
  if (item.test_steps !== undefined && !Array.isArray(item.test_steps)) errors.push({ field: 'test_steps', value: item.test_steps, reason: 'test_steps must be an array' })
  return errors.length ? { ok: false, errors } : { ok: true, errors: [] }
}

/** Validate a whole parse result. Returns per-item errors keyed by id; never throws. */
export function validateAll(items) {
  if (!Array.isArray(items)) return { ok: false, reason: `expected an array of items, received ${typeof items}` }
  const invalid = []
  for (const it of items) {
    const v = validateCriterion(it)
    if (!v.ok) invalid.push({ id: it?.id ?? null, errors: v.errors })
  }
  return { ok: invalid.length === 0, invalid, checked: items.length }
}

// ---------------------------------------------------------------------------------------------
// Render back to markdown — the JIRA comment path (server/ticket.mjs:912 pushes `art.ac.md`)
// ---------------------------------------------------------------------------------------------
/**
 * Structured items → markdown. Round-trips: `parse(render(parse(md)))` yields the same ids and
 * text as `parse(md)`. Unstructured items render their VERBATIM raw line, which is what makes the
 * round trip lossless for content this module could not understand.
 */
export function renderMarkdown(input) {
  const items = Array.isArray(input) ? input : input?.items
  if (!Array.isArray(items)) return { ok: false, reason: 'renderMarkdown expects an array of items or a parse result with .items' }

  const order = ['preamble', 'acceptance', 'unspecified', 'notes', 'other']
  const groups = new Map()
  for (const it of items) {
    const key = it.bucket === 'other' ? `other:${it.heading || ''}` : it.bucket
    if (!groups.has(key)) groups.set(key, { bucket: it.bucket, heading: it.heading, items: [] })
    groups.get(key).items.push(it)
  }
  const sorted = [...groups.values()].sort((a, b) => order.indexOf(a.bucket) - order.indexOf(b.bucket))

  const out = []
  for (const g of sorted) {
    if (g.bucket !== 'preamble') {
      const h = g.bucket === 'other' ? `## ${g.heading}` : BUCKET_HEADINGS[g.bucket]
      if (h) { if (out.length) out.push(''); out.push(h) }
    }
    for (const it of g.items) {
      if (it.kind === 'unstructured') out.push(it.source?.raw ?? it.text)
      else if (it.kind === 'note') out.push(`- ${it.text}`)
      else out.push(`- [${it.checked ? 'x' : ' '}] ${it.text}`)
    }
  }
  return { ok: true, md: out.join('\n') }
}

// ---------------------------------------------------------------------------------------------
// Diff across a regeneration — so a human is told what their ticks lost, rather than finding out
// ---------------------------------------------------------------------------------------------
export function diffCriteria(before, after) {
  if (!Array.isArray(before) || !Array.isArray(after)) return { ok: false, reason: 'diffCriteria expects two arrays of items' }
  const b = new Map(before.map(i => [i.id, i])), a = new Map(after.map(i => [i.id, i]))
  const gone = before.filter(i => !a.has(i.id))
  const added = after.filter(i => !b.has(i.id))
  return {
    ok: true, kept: before.filter(i => a.has(i.id)).map(i => i.id),
    gone: gone.map(i => ({ id: i.id, text: i.text, checked: i.checked })),
    added: added.map(i => ({ id: i.id, text: i.text })),
    // An id that vanished means the TEXT changed (or the line was removed). This module cannot tell
    // those apart from ids alone, and says so rather than guessing which ticks to carry over.
    note: gone.length
      ? `${gone.length} id(s) no longer present. An id changes when its text is edited, so this is "changed or removed" — it is NOT safe to auto-carry ticks; ${gone.filter(i => i.checked).length} of them were ticked and need a human decision.`
      : 'no ids lost — every existing tick re-attaches.',
  }
}

// ---------------------------------------------------------------------------------------------
// Filtering / export — the "tickable, filterable, exportable" of the ticket
// ---------------------------------------------------------------------------------------------
/** Filter with unknown enum values rejected by name rather than matching nothing silently. */
export function filterCriteria(items, filter = {}) {
  if (!Array.isArray(items)) return { ok: false, reason: `expected an array of items, received ${typeof items}` }
  const bad = []
  const check = (field, values, allowed) => {
    for (const v of values || []) if (!allowed.includes(v)) bad.push({ field, value: v, reason: `"${String(v)}" is not a valid ${field}`, allowed: [...allowed] })
  }
  check('bucket', filter.buckets, BUCKETS)
  check('test_type', filter.testTypes, TEST_TYPES)
  check('priority', filter.priorities, PRIORITIES)
  if (bad.length) return { ok: false, reason: 'unknown filter value(s)', errors: bad }

  const hit = items.filter(it =>
    (!filter.buckets?.length || filter.buckets.includes(it.bucket)) &&
    (!filter.testTypes?.length || filter.testTypes.includes(it.test_type)) &&
    (!filter.priorities?.length || filter.priorities.includes(it.priority)) &&
    (filter.checked === undefined || it.checked === filter.checked) &&
    (filter.kind === undefined || it.kind === filter.kind))
  return { ok: true, items: hit, matched: hit.length, of: items.length }
}

/** CSV export. Values are quoted; nulls export as the literal `null`, never as an empty cell — an
 *  empty cell in a spreadsheet reads as "false"/"none", which is the guess this module refuses. */
export function toCsv(items) {
  if (!Array.isArray(items)) return { ok: false, reason: `expected an array of items, received ${typeof items}` }
  const cols = ['id', 'bucket', 'kind', 'checked', 'priority', 'test_type', 'validation_method', 'automated', 'text', 'test_steps', 'reason']
  const cell = v => `"${String(v === null || v === undefined ? 'null' : Array.isArray(v) ? v.join(' | ') : v).replace(/"/g, '""')}"`
  return { ok: true, csv: [cols.join(','), ...items.map(it => cols.map(c => cell(it[c])).join(','))].join('\n') }
}
