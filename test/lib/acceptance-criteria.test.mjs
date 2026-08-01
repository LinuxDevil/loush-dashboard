// test/lib/acceptance-criteria.test.mjs — 094. Pure: no fs, no express, no React.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  TEST_TYPES, VALIDATION_METHODS, PRIORITIES, BUCKETS,
  parseMarkdownCriteria, renderMarkdown, validateCriterion, validateAll,
  criterionId, splitGivenWhenThen, diffCriteria, filterCriteria, toCsv,
} from '../../lib/acceptance-criteria.mjs'

// A realistic artifact in the shape server/prompts/ac.md actually asks for.
const MD = `## Acceptance criteria
- [ ] Given a ticket with no acceptance criteria, when the user opens the Ticket tab, then the AC panel shows an empty state and a Generate button
- [x] The /api/ticket/:key/board route rejects a request when the repo directory cannot be resolved
- [ ] Latency of the ticket list stays under 400 ms for 200 tickets
-    a stray line the generator wrapped badly
- [ ]

## Unspecified — needs an answer
- [ ] Should a regenerated AC set preserve ticks made against the previous version?

## Notes from the code
- \`server/ticket.mjs:912\` — the JIRA comment path concatenates \`art.ac.md\` verbatim
- \`src/sections/TicketSection.jsx:406\` — META already treats ac and tests as one artifact class
`

test('enums are closed sets and buckets cover every section ac.md emits', () => {
  assert.ok(TEST_TYPES.includes('e2e') && TEST_TYPES.includes('security'))
  assert.ok(VALIDATION_METHODS.includes('manual-verification'))
  assert.deepEqual(PRIORITIES, ['must', 'should', 'could'])
  for (const b of ['acceptance', 'unspecified', 'notes']) assert.ok(BUCKETS.includes(b))
})

test('parse never throws on malformed input — it returns {ok:false, reason}', () => {
  for (const bad of [null, undefined, 42, {}, [], true]) {
    const r = parseMarkdownCriteria(bad)
    assert.equal(r.ok, false)
    assert.match(r.reason, /expected a markdown string/)
  }
  // An empty document is a legitimate answer, not a failure.
  const empty = parseMarkdownCriteria('   \n\n')
  assert.equal(empty.ok, true)
  assert.deepEqual(empty.items, [])
})

test('a real checklist becomes structured items in the right buckets', () => {
  const r = parseMarkdownCriteria(MD)
  assert.equal(r.ok, true)
  const acc = r.items.filter(i => i.bucket === 'acceptance' && i.kind === 'criterion')
  assert.equal(acc.length, 3)
  assert.equal(acc[1].checked, true)                 // - [x]
  assert.equal(acc[0].checked, false)
  assert.equal(r.items.filter(i => i.bucket === 'unspecified' && i.kind === 'criterion').length, 1)
  assert.equal(r.items.filter(i => i.bucket === 'notes' && i.kind === 'note').length, 2)
})

test('HOUSE RULE 4 — an unparseable line is KEPT as unstructured with a reason, never dropped', () => {
  const r = parseMarkdownCriteria(MD)
  const un = r.items.filter(i => i.kind === 'unstructured')
  assert.ok(un.length >= 2, 'both the stray bullet and the empty checkbox must survive')

  const stray = un.find(i => /stray line/.test(i.text))
  assert.ok(stray, 'the badly-wrapped bullet is still present')
  assert.match(stray.reason, /not a `- \[ \]` checklist item/)
  assert.equal(stray.source.raw, '-    a stray line the generator wrapped badly')

  const emptyBox = un.find(i => /checkbox with no text/.test(i.reason))
  assert.ok(emptyBox, 'an empty checkbox is reported, not swallowed')

  // The report tells the caller, in words, that nothing was lost.
  assert.equal(r.report.counts.unstructured, un.length)
  assert.match(r.report.note, /KEPT as unstructured/)
  assert.match(r.report.note, /Nothing was dropped/)
  assert.equal(r.report.unstructured.length, un.length)
  for (const u of r.report.unstructured) assert.ok(u.reason && u.raw !== undefined && u.line > 0)
})

test('HOUSE RULE 2 — the parser applies no cap, and says so', () => {
  const r = parseMarkdownCriteria(MD)
  assert.match(r.report.limits.note, /no cap is applied/)
  // Every non-blank, non-heading source line is accounted for by exactly one item.
  const bodyLines = MD.split('\n').filter(l => l.trim() && !/^#{1,6}\s/.test(l))
  assert.equal(r.items.length, bodyLines.length)
})

test('IDs are STABLE across re-parses of the same content', () => {
  const a = parseMarkdownCriteria(MD), b = parseMarkdownCriteria(MD)
  assert.deepEqual(a.items.map(i => i.id), b.items.map(i => i.id))
  assert.ok(a.items.every(i => /^ac_[0-9a-f]{12}/.test(i.id)))
})

test('IDs survive whitespace, wrapping and case changes but NOT a text edit', () => {
  const base = '## Acceptance criteria\n- [ ] The list shows an empty state\n'
  const spaced = '## Acceptance criteria\n-   [ ]    The   list shows an  empty state   \n'
  const cased = '## Acceptance criteria\n- [ ] the LIST shows an empty state\n'
  const ticked = '## Acceptance criteria\n- [x] The list shows an empty state\n'
  const edited = '## Acceptance criteria\n- [ ] The list shows an empty state and a button\n'

  const id = md => parseMarkdownCriteria(md).items[0].id
  assert.equal(id(spaced), id(base), 'whitespace is not semantic')
  assert.equal(id(cased), id(base), 'capitalisation is not semantic')
  assert.equal(id(ticked), id(base), 'ticking a box must not change the id it is stored against')
  assert.notEqual(id(edited), id(base), 'editing the text DOES change the id — documented, not hidden')
})

test('diffCriteria says a lost id is "changed or removed", and never auto-carries a tick', () => {
  const before = parseMarkdownCriteria('## Acceptance criteria\n- [x] The list shows an empty state\n').items
  const after = parseMarkdownCriteria('## Acceptance criteria\n- [ ] The list shows an empty state and a button\n').items
  const d = diffCriteria(before, after)
  assert.equal(d.ok, true)
  assert.equal(d.gone.length, 1)
  assert.equal(d.gone[0].checked, true)
  assert.match(d.note, /changed or removed/)
  assert.match(d.note, /1 of them were ticked/)
  assert.equal(diffCriteria('nope', []).ok, false)
})

test('identical lines get distinct ids and the duplication is REPORTED, not merged away', () => {
  const r = parseMarkdownCriteria('## Acceptance criteria\n- [ ] Same line\n- [ ] Same line\n')
  assert.equal(r.items.length, 2)
  assert.notEqual(r.items[0].id, r.items[1].id)
  assert.equal(r.report.duplicates.length, 1)
  assert.equal(r.report.duplicates[0].duplicate_of, criterionId('acceptance', 'Same line'))
})

test('Given/When/Then becomes test_steps; a plain statement becomes one honest step', () => {
  const r = parseMarkdownCriteria(MD)
  const gwt = r.items.find(i => i.given)
  assert.equal(gwt.test_steps.length, 3)
  assert.match(gwt.test_steps[0], /^Given a ticket with no acceptance criteria$/)
  assert.match(gwt.test_steps[2], /^Then the AC panel shows/)
  assert.equal(gwt.provenance.test_steps, 'derived-from-given-when-then')

  const plain = r.items.find(i => i.kind === 'criterion' && !i.given)
  assert.equal(plain.test_steps.length, 1, 'a one-thing criterion is one step, not padded to three')
  assert.equal(plain.provenance.test_steps, 'derived-from-statement')
  assert.equal(splitGivenWhenThen('no keywords here'), null)
  assert.equal(splitGivenWhenThen('Given a thing, then a result, when reversed'), null)
})

test('HOUSE RULE 1 — fields the markdown never carried are null WITH a reason, not defaulted', () => {
  const r = parseMarkdownCriteria('## Acceptance criteria\n- [ ] The panel renders\n')
  const it = r.items[0]
  assert.equal(it.validation_method, null)
  assert.equal(it.priority, null)
  assert.equal(it.automated, null)
  assert.equal(it.provenance.priority, 'absent')
  assert.equal(it.provenance.automated, 'absent')
  assert.match(it.field_reasons.priority, /RFC-2119 keyword not present/)
  assert.match(it.field_reasons.automated, /nothing in the text says/)
  assert.deepEqual(r.report.fieldsAbsentFromSource, ['test_type', 'validation_method', 'priority', 'automated'])
})

test('an inferred field carries the evidence it was inferred from', () => {
  const r = parseMarkdownCriteria('## Acceptance criteria\n- [ ] Latency stays under 400 ms and must be verified manually\n')
  const it = r.items[0]
  assert.equal(it.test_type, 'performance')
  assert.match(it.provenance.test_type, /^inferred-from-text:/)
  assert.equal(it.priority, 'must')
  assert.equal(it.automated, false)
  assert.match(it.provenance.automated, /manual/)
})

test('unknown enum values are rejected BY NAME with the allowed set listed', () => {
  const good = parseMarkdownCriteria(MD).items[0]
  assert.equal(validateCriterion(good).ok, true)

  const v = validateCriterion({ ...good, test_type: 'functional', priority: 'P0', validation_method: 'vibes' })
  assert.equal(v.ok, false)
  const tt = v.errors.find(e => e.field === 'test_type')
  assert.match(tt.reason, /"functional" is not a valid test_type/)
  assert.deepEqual(tt.allowed, TEST_TYPES)
  assert.deepEqual(v.errors.find(e => e.field === 'priority').allowed, PRIORITIES)
  assert.deepEqual(v.errors.find(e => e.field === 'validation_method').allowed, VALIDATION_METHODS)

  // null is a VALUE, not an error.
  assert.equal(validateCriterion({ ...good, test_type: null, priority: null, automated: null }).ok, true)
  // and it never throws on rubbish
  assert.equal(validateCriterion(null).ok, false)
  assert.equal(validateCriterion([]).ok, false)
  assert.equal(validateAll('nope').ok, false)
  assert.equal(validateAll(parseMarkdownCriteria(MD).items).ok, true)
})

test('ROUND TRIP — render → parse yields the same ids, text and ticks', () => {
  const first = parseMarkdownCriteria(MD)
  const rendered = renderMarkdown(first)
  assert.equal(rendered.ok, true)
  const second = parseMarkdownCriteria(rendered.md)

  assert.deepEqual(second.items.map(i => i.id), first.items.map(i => i.id))
  assert.deepEqual(second.items.map(i => i.text), first.items.map(i => i.text))
  assert.deepEqual(second.items.map(i => i.checked), first.items.map(i => i.checked))
  assert.deepEqual(second.items.map(i => i.bucket), first.items.map(i => i.bucket))

  // and it is a fixed point: a third pass changes nothing.
  assert.equal(renderMarkdown(second).md, rendered.md)
})

test('ROUND TRIP keeps the unstructured lines verbatim — that is what makes it lossless', () => {
  const md = renderMarkdown(parseMarkdownCriteria(MD)).md
  assert.ok(md.includes('-    a stray line the generator wrapped badly'), 'raw line preserved byte-for-byte')
  assert.ok(md.includes('## Acceptance criteria'))
  assert.ok(md.includes('## Unspecified — needs an answer'))
  assert.ok(md.includes('## Notes from the code'))
  assert.ok(md.includes('- [x] The /api/ticket/:key/board route'))
  assert.equal(renderMarkdown('nope').ok, false)
})

test('a tick made in the UI round-trips back into the markdown', () => {
  const p = parseMarkdownCriteria(MD)
  const target = p.items.find(i => i.kind === 'criterion' && !i.checked)
  const edited = p.items.map(i => (i.id === target.id ? { ...i, checked: true } : i))
  const md = renderMarkdown(edited).md
  const back = parseMarkdownCriteria(md)
  assert.equal(back.items.find(i => i.id === target.id).checked, true)
})

test('continuation lines are folded in, and the id covers the FULL text', () => {
  const wrapped = '## Acceptance criteria\n- [ ] Given a ticket with no criteria, when opened,\n      then the panel shows an empty state\n'
  const flat = '## Acceptance criteria\n- [ ] Given a ticket with no criteria, when opened, then the panel shows an empty state\n'
  const w = parseMarkdownCriteria(wrapped), f = parseMarkdownCriteria(flat)
  assert.equal(w.items.length, 1)
  assert.equal(w.items[0].id, f.items[0].id, 're-wrapping the source must not orphan the tick')
  assert.equal(w.items[0].test_steps.length, 3)
})

test('filter rejects an unknown enum by name instead of quietly matching nothing', () => {
  const items = parseMarkdownCriteria(MD).items
  const bad = filterCriteria(items, { testTypes: ['functional'] })
  assert.equal(bad.ok, false)
  assert.deepEqual(bad.errors[0].allowed, TEST_TYPES)

  const good = filterCriteria(items, { buckets: ['acceptance'], kind: 'criterion' })
  assert.equal(good.ok, true)
  assert.equal(good.matched, 3)
  assert.equal(good.of, items.length)
  assert.equal(filterCriteria(items, { checked: true }).matched, 1)
  assert.equal(filterCriteria('nope').ok, false)
})

test('CSV export writes the literal "null", never an empty cell that reads as false', () => {
  const { ok, csv } = toCsv(parseMarkdownCriteria('## Acceptance criteria\n- [ ] The panel renders\n').items)
  assert.equal(ok, true)
  const [head, row] = csv.split('\n')
  assert.ok(head.startsWith('id,bucket,kind,checked'))
  assert.ok(row.includes('"null"'), 'an unset priority exports as null, not as blank')
  assert.equal(toCsv('nope').ok, false)
})

test('content outside the known sections is retained under its own heading', () => {
  const md = '## Something else\n- [ ] a criterion under an unknown heading\n'
  const r = parseMarkdownCriteria(md)
  assert.equal(r.items[0].bucket, 'other')
  assert.equal(r.items[0].heading, 'Something else')
  assert.ok(renderMarkdown(r).md.includes('## Something else'))
})
