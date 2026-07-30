// src/ui/criteriaParts.jsx — the tickable / filterable / exportable view of a structured
// acceptance-criteria set (094). Presentational only: it takes `items` and calls back with the
// next `items`. Persistence belongs to whoever wires it (see INTEGRATION-tickets.md).
//
// It imports lib/acceptance-criteria.mjs DIRECTLY — the same module the server uses. That module
// is dependency-free and hashes IDs with a pure function precisely so the browser and the server
// cannot disagree about which id a criterion has; a second client-side implementation would be a
// tick landing on the wrong row.
import React, { useMemo, useState } from 'react'
import {
  TEST_TYPES, PRIORITIES, VALIDATION_METHODS, BUCKET_HEADINGS,
  filterCriteria, renderMarkdown, toCsv, validateCriterion,
} from '../../lib/acceptance-criteria.mjs'

const MONO = 'var(--mono)'
const chip = (color) => ({
  font: `600 10px ${MONO}`, letterSpacing: '0.04em', padding: '2px 7px', borderRadius: 9999,
  color: color || 'var(--text-dim)', background: 'var(--bg-surface-active)', whiteSpace: 'nowrap',
})

/** A field with no value renders the word "unset", never a blank and never a guessed default —
 *  a blank cell reads as "false"/"none", which is the claim this data model refuses to make. */
export const FieldChip = ({ label, value, reason }) => (
  <span style={chip(value == null ? 'var(--text-faint)' : undefined)} title={value == null ? (reason || `${label} is not set`) : `${label}: ${value}`}>
    {label}: {value == null ? 'unset' : String(value)}
  </span>
)

export const Check = ({ checked, onChange, label }) => (
  <button
    role="checkbox" aria-checked={!!checked} aria-label={label}
    onClick={() => onChange(!checked)}
    style={{
      width: 16, height: 16, minWidth: 16, padding: 0, borderRadius: 4, cursor: 'pointer',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      border: `1px solid ${checked ? 'var(--green-solid)' : 'var(--border-active)'}`,
      background: checked ? 'var(--green-solid)' : 'transparent',
      color: '#fff', font: `700 10px ${MONO}`, lineHeight: 1,
    }}
  >{checked ? '✓' : ''}</button>
)

/**
 * One row. An item this module could not structure is rendered DIFFERENTLY and with its reason on
 * screen — it is not hidden, and it is not dressed up as a criterion it is not. Hiding it is how a
 * migration loses a requirement.
 */
export function CriterionRow({ item, onChange }) {
  const [open, setOpen] = useState(false)
  if (item.kind === 'unstructured') {
    return (
      <div style={{ padding: '6px 8px', borderLeft: '2px solid var(--amber-solid, #b7791f)', background: 'var(--bg-surface)', marginBottom: 4 }}>
        <div style={{ font: `12px ${MONO}`, whiteSpace: 'pre-wrap', opacity: 0.9 }}>{item.source?.raw ?? item.text}</div>
        <div style={{ font: `10px ${MONO}`, color: 'var(--text-faint)', marginTop: 3 }}>
          kept, not structured · line {item.source?.line} · {item.reason}
        </div>
      </div>
    )
  }
  if (item.kind === 'note') {
    return <div style={{ padding: '4px 8px', font: `12px ${MONO}`, color: 'var(--text-dim)' }}>· {item.text}</div>
  }

  const invalid = validateCriterion(item)
  return (
    <div style={{ padding: '6px 8px', marginBottom: 4, background: 'var(--bg-surface)', borderRadius: 4 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ paddingTop: 2 }}><Check checked={item.checked} label={item.text} onChange={c => onChange({ ...item, checked: c })} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: '13px/1.45 inherit', cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>{item.text}</div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 4 }}>
            <FieldChip label="type" value={item.test_type} reason={item.field_reasons?.test_type} />
            <FieldChip label="priority" value={item.priority} reason={item.field_reasons?.priority} />
            <FieldChip label="automated" value={item.automated} reason={item.field_reasons?.automated} />
            <FieldChip label="validation" value={item.validation_method} reason={item.field_reasons?.validation_method} />
            <span style={chip('var(--text-faint)')} title="content-derived id — it changes if the text is edited">{item.id}</span>
          </div>
          {open && (
            <ol style={{ margin: '6px 0 0 16px', font: `11px/1.6 ${MONO}`, color: 'var(--text-dim)' }}>
              {item.test_steps.map((s, i) => <li key={i}>{s}</li>)}
              <div style={{ marginTop: 4, color: 'var(--text-faint)' }}>steps: {item.provenance?.test_steps}</div>
            </ol>
          )}
          {!invalid.ok && (
            <div style={{ font: `10px ${MONO}`, color: 'var(--red-solid, #c53030)', marginTop: 4 }}>
              {invalid.errors.map(e => `${e.field}: ${e.reason}${e.allowed ? ` (allowed: ${e.allowed.join(', ')})` : ''}`).join(' · ')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const Select = ({ label, value, options, onChange }) => (
  <label style={{ font: `10px ${MONO}`, color: 'var(--text-dim)', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
    {label}
    <select value={value} onChange={e => onChange(e.target.value)} style={{ font: `10px ${MONO}` }}>
      <option value="">any</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  </label>
)

/**
 * The panel. Filters are applied through `filterCriteria`, which REJECTS an unknown enum value by
 * name rather than returning an empty list — an empty list from a typo'd filter reads as "there are
 * no security criteria", which is a false statement about the ticket.
 */
export function CriteriaPanel({ parsed, onChange, onExport }) {
  const items = parsed?.items ?? []
  const report = parsed?.report
  const [testType, setTestType] = useState('')
  const [priority, setPriority] = useState('')
  const [only, setOnly] = useState('all')      // all | open | done

  const filtered = useMemo(() => {
    const f = { }
    if (testType) f.testTypes = [testType]
    if (priority) f.priorities = [priority]
    if (only !== 'all') f.checked = only === 'done'
    const r = filterCriteria(items, f)
    return r.ok ? r : { ok: false, items: [], reason: r.reason, errors: r.errors }
  }, [items, testType, priority, only])

  if (!parsed?.ok) return <div style={{ font: `12px ${MONO}`, color: 'var(--text-dim)' }}>could not read the acceptance criteria: {parsed?.reason || 'no data'}</div>

  const setItem = next => onChange?.(items.map(i => (i.id === next.id ? next : i)))
  const buckets = ['acceptance', 'unspecified', 'notes', 'other', 'preamble']
  const shown = filtered.items
  const ticked = items.filter(i => i.kind === 'criterion' && i.checked).length
  const total = items.filter(i => i.kind === 'criterion').length

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ font: `11px ${MONO}` }}>{ticked}/{total} ticked</span>
        <Select label="type" value={testType} options={TEST_TYPES} onChange={setTestType} />
        <Select label="priority" value={priority} options={PRIORITIES} onChange={setPriority} />
        <Select label="state" value={only === 'all' ? '' : only} options={['open', 'done']} onChange={v => setOnly(v || 'all')} />
        <button style={{ font: `10px ${MONO}` }} onClick={() => onExport?.({ kind: 'markdown', ...renderMarkdown(items) })}>export md</button>
        <button style={{ font: `10px ${MONO}` }} onClick={() => onExport?.({ kind: 'csv', ...toCsv(items) })}>export csv</button>
      </div>

      {/* The migration report is shown, not logged. A user who cannot see that four lines were kept
          unstructured has no reason to go looking for them. */}
      {report?.counts?.unstructured > 0 && (
        <div style={{ font: `11px ${MONO}`, color: 'var(--text-dim)', marginBottom: 8 }}>
          {report.counts.unstructured} line(s) kept as unstructured — nothing was dropped.
        </div>
      )}

      {!filtered.ok && (
        <div style={{ font: `11px ${MONO}`, color: 'var(--red-solid, #c53030)', marginBottom: 8 }}>
          filter rejected: {filtered.reason} — {(filtered.errors || []).map(e => `${e.value} (allowed: ${e.allowed.join(', ')})`).join('; ')}
        </div>
      )}

      {buckets.map(b => {
        const rows = shown.filter(i => i.bucket === b)
        if (!rows.length) return null
        return (
          <section key={b} style={{ marginBottom: 12 }}>
            <h4 style={{ font: `600 11px ${MONO}`, letterSpacing: '0.05em', color: 'var(--text-dim)', margin: '0 0 6px' }}>
              {(BUCKET_HEADINGS[b] || `## ${b}`).replace(/^##\s*/, '').toUpperCase()}
            </h4>
            {rows.map(i => <CriterionRow key={i.id} item={i} onChange={setItem} />)}
          </section>
        )
      })}

      {shown.length === 0 && filtered.ok && (
        <div style={{ font: `11px ${MONO}`, color: 'var(--text-faint)' }}>
          no items match this filter (the set has {items.length} item{items.length === 1 ? '' : 's'}) — the filter is hiding them, they are not missing.
        </div>
      )}
      <div style={{ font: `10px ${MONO}`, color: 'var(--text-faint)', marginTop: 8 }}>
        validation methods: {VALIDATION_METHODS.join(' · ')} — unset until a human picks one.
      </div>
    </div>
  )
}
