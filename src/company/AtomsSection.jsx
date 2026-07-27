import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import { Ring, StackedBar, Bars, Stepper, CoverageTreemap, DataTable, Facts } from '../ui/charts.jsx'

// Ask-the-project atoms explorer — feature catalog, grounded search, attestation triage.
// Rendered as tabs inside ConstitutionSection, so both the Claude and Cursor shells get it.
const MONO = "var(--mono)"
const HEAD = "var(--head)"
const SANS = 'var(--body)'
const PANEL = { background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 8, padding: 12, minWidth: 0 }
const KIND_COLOR = { constitution: 'var(--violet)', rule: 'var(--accent)', skill: 'var(--green)', workflow: 'var(--blue)' }
const TONE_COLOR = { must: 'var(--green)', 'must-not': 'var(--red)', should: 'var(--amber)', 'should-not': 'var(--accent)' }

const toneSegments = atoms => Object.entries(TONE_COLOR)
  .map(([tone, color]) => ({ label: tone, value: atoms.filter(a => a.tone === tone).length, color }))

// shared table columns for atom lists — tone | claim(+context) | flags | citation
const atomClaimCell = (a, accent) => (
  <div style={{ minWidth: 240 }}>
    <div style={{ font: `400 12px ${SANS}`, color: 'var(--text-primary)' }}>{a.claim}</div>
    {a.guidance && <Dim style={{ marginTop: 2 }}><span style={{ color: accent }}>guidance:</span> {a.guidance}</Dim>}
    {a.rationale && <Dim style={{ marginTop: 2 }}><span style={{ color: 'var(--text-secondary)' }}>why:</span> {a.rationale}</Dim>}
    {a.consequence && <Dim style={{ marginTop: 2 }}><span style={{ color: 'var(--accent)' }}>or else:</span> {a.consequence}</Dim>}
  </div>
)
const atomColumns = (accent, extra = []) => [
  { key: 'tone', label: 'tone', width: 68, render: a => a.tone ? <Chip text={a.tone} color={TONE_COLOR[a.tone] || 'var(--text-tertiary)'} /> : null },
  { key: 'claim', label: 'claim · guidance · why', render: a => atomClaimCell(a, accent), sortValue: a => a.claim || '' },
  {
    key: 'flags', label: 'flags', width: 66, align: 'center',
    render: a => <span style={{ display: 'inline-flex', gap: 4 }}>
      {a.origin === 'critic' && <Chip text="critic" color="var(--violet)" title="added by the critic pass" />}
      {a.attestStatus === 'insufficient' && <Chip text="⚠" color="var(--amber)" title="insufficient evidence — needs human review" />}
    </span>,
    sortValue: a => (a.origin === 'critic' ? 1 : 0) + (a.attestStatus === 'insufficient' ? 2 : 0),
  },
  {
    key: 'cite', label: 'citation', width: 200,
    render: a => a.cite?.path ? <span title={a.cite.snippet || ''} style={{ color: 'var(--text-secondary)', overflowWrap: 'anywhere', font: `400 10px ${MONO}` }}>{a.cite.path}{a.cite.lineRange ? ':' + a.cite.lineRange : ''}</span> : null,
    sortValue: a => a.cite?.path || '',
  },
  ...extra,
]

const Chip = ({ text, color = 'var(--text-tertiary)', title }) => (
  <span title={title} style={{ font: `500 10px ${MONO}`, color, border: `1px solid ${color}55`, borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap' }}>{text}</span>
)
const Dim = ({ children, style }) => <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)', ...style }}>{children}</div>
const pct = r => (r == null ? '—' : Math.round(r * 100) + '%')

// module-level index cache per repo — survives tab switches, server rebuilds on constitution mtime change
const idxCache = new Map()
function useIndex(repo) {
  const [state, setState] = useState({ idx: null, err: null })
  useEffect(() => {
    if (!repo) return
    setState({ idx: null, err: null })
    if (!idxCache.has(repo)) idxCache.set(repo, api.get('/api/atoms/index?repo=' + encodeURIComponent(repo)))
    idxCache.get(repo).then(idx => setState({ idx, err: null })).catch(e => { idxCache.delete(repo); setState({ idx: null, err: e.message }) })
  }, [repo])
  return state
}

// ---------- catalog: one card per workflow, expand to full atom detail ----------
function Catalog({ idx, accent }) {
  const [open, setOpen] = useState(null)
  const workflows = idx.sources.filter(s => s.type === 'workflow')

  if (open) {
    const s = idx.sources.find(x => x.id === open)
    if (!s) { setOpen(null); return null }
    const sections = []
    for (const a of s.atoms) {
      let sec = sections.find(x => x.name === (a.section || 'General'))
      if (!sec) sections.push(sec = { name: a.section || 'General', atoms: [] })
      sec.atoms.push(a)
    }
    return (
      <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <button onClick={() => setOpen(null)}>← catalog</button>
          <span style={{ font: `600 14px ${HEAD}`, color: KIND_COLOR.workflow }}>{s.name}</span>
          <Chip text={`${s.atoms.length} atoms`} color={accent} />
          <Chip text={`${pct(s.attest?.confirmedRate)} confirmed`} color={s.attest?.confirmedRate >= 0.95 ? 'var(--green)' : 'var(--amber)'} />
        </div>
        <div style={{ ...PANEL, display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <Ring value={s.attest?.confirmedRate} sub="confirmed" color={s.attest?.confirmedRate >= 0.95 ? 'var(--green)' : 'var(--amber)'} />
          <div style={{ flex: 1, minWidth: 280, display: 'grid', gap: 10 }}>
            <div style={{ font: `400 13px ${SANS}`, color: 'var(--text-primary)' }}>{s.description}</div>
            <Facts items={[
              { label: 'atoms', value: s.atoms.length },
              { label: 'never-do', value: s.atoms.filter(a => a.tone === 'must-not').length, color: 'var(--red)' },
              { label: 'critic-found', value: s.atoms.filter(a => a.origin === 'critic').length, color: 'var(--violet)' },
              { label: 'flagged', value: s.atoms.filter(a => a.attestStatus === 'insufficient').length, color: 'var(--amber)' },
              { label: 'sections', value: sections.length },
              { label: 'paths', value: s.paths.length },
            ]} />
            <StackedBar segments={toneSegments(s.atoms)} />
            {s.when_to_use && <Dim><span style={{ color: accent }}>when to use:</span> {s.when_to_use}</Dim>}
            {s.paths.length > 0 && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {s.paths.map(p => <Chip key={p} text={p} color="var(--text-secondary)" />)}
              </div>
            )}
          </div>
        </div>
        {s.keyInvariants?.length > 0 && (
          <div style={PANEL}>
            <div style={{ font: `600 12px ${HEAD}`, color: 'var(--text-primary)', marginBottom: 8 }}>Key invariants — must stay true no matter what</div>
            <DataTable columns={[
              { key: 'n', label: '#', width: 34, align: 'center', render: r => <span style={{ color: accent, font: `700 11px ${MONO}` }}>{r.n}</span> },
              { key: 'text', label: 'invariant', render: r => <span style={{ font: `400 12px ${SANS}`, color: 'var(--text-primary)' }}>{r.text}</span> },
            ]} rows={s.keyInvariants.map((text, i) => ({ n: i + 1, text, __key: i }))} />
          </div>
        )}
        {sections.map(sec => {
          const isSteps = /step/i.test(sec.name)
          return (
            <div key={sec.name} style={PANEL}>
              <div style={{ font: `600 12px ${HEAD}`, color: 'var(--text-primary)', marginBottom: 8 }}>
                {sec.name} <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)' }}>({sec.atoms.length})</span>
              </div>
              {isSteps ? (
                <>
                  <Stepper accent={accent}
                    steps={sec.atoms.map(a => ({ title: a.guidance || a.claim, sub: a.cite?.path ? `📎 ${a.cite.path}${a.cite.lineRange ? ':' + a.cite.lineRange : ''}` : null }))} />
                  <details style={{ marginTop: 10 }}>
                    <summary style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)', cursor: 'pointer' }}>full atom detail (claims, rationale, consequences)</summary>
                    <div style={{ marginTop: 8 }}>
                      <DataTable columns={atomColumns(accent)} rows={sec.atoms.map(a => ({ ...a, __key: a.id }))} />
                    </div>
                  </details>
                </>
              ) : <DataTable columns={atomColumns(accent)} rows={sec.atoms.map(a => ({ ...a, __key: a.id }))} />}
            </div>
          )
        })}
        {s.outputChecklist?.length > 0 && (
          <div style={PANEL}>
            <div style={{ font: `600 12px ${HEAD}`, color: 'var(--text-primary)', marginBottom: 8 }}>Output checklist — verify before calling it done</div>
            <DataTable columns={[
              { key: 'n', label: '', width: 34, align: 'center', render: () => <span style={{ color: 'var(--text-tertiary)' }}>☐</span> },
              { key: 'text', label: 'check', render: r => <span style={{ font: `400 12px ${SANS}`, color: 'var(--text-primary)' }}>{r.text}</span> },
            ]} rows={s.outputChecklist.map((text, i) => ({ text, __key: i }))} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
        {workflows.map(s => {
          const mustNot = s.atoms.filter(a => a.tone === 'must-not').length
          return (
            <div key={s.id} onClick={() => setOpen(s.id)} style={{ ...PANEL, cursor: 'pointer', display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: `600 13px ${HEAD}`, color: KIND_COLOR.workflow }}>{s.name}</div>
                  <div style={{ font: `400 11px ${SANS}`, color: 'var(--text-secondary)', marginTop: 4, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{s.description}</div>
                </div>
                <Ring value={s.attest?.confirmedRate} size={46} color={s.attest?.confirmedRate >= 0.95 ? 'var(--green)' : 'var(--amber)'}  style={{ stroke: (5) }} />
              </div>
              <StackedBar segments={toneSegments(s.atoms)} height={7} legend={false} />
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                <Chip text={`${s.atoms.length} atoms`} color={accent} />
                {mustNot > 0 && <Chip text={`${mustNot} never-do`} color="var(--red)" title="tone: must-not — things you must never do" />}
                <Chip text={`${s.paths.length} paths`} />
              </div>
            </div>
          )
        })}
      </div>
      {idx.demandSignals.length > 0 && (
        <div style={PANEL}>
          <div style={{ font: `600 12px ${HEAD}`, color: 'var(--text-primary)', marginBottom: 8 }}>Proposed skills — demand signals not yet generated ({idx.demandSignals.length})</div>
          <DataTable maxHeight="40vh" columns={[
            { key: 'name', label: 'proposed skill', width: 240, render: d => <span style={{ color: 'var(--green)', font: `500 11px ${MONO}` }}>{d.name}</span> },
            { key: 'kind', label: 'signal', width: 110, render: d => <Chip text={d.kind || '—'} /> },
            { key: 'description', label: 'why it keeps coming up', render: d => <span style={{ font: `400 11px ${SANS}`, color: 'var(--text-secondary)' }}>{d.description}</span> },
          ]} rows={idx.demandSignals.map((d, i) => ({ ...d, __key: i }))} />
        </div>
      )}
    </div>
  )
}

// ---------- ask: retrieval first, LLM only on demand and only with retrieved atoms ----------
function scoreAtom(terms, q, atom) {
  const claim = (atom.claim || '').toLowerCase()
  const rest = [atom.guidance, atom.rationale, atom.consequence, atom.section, atom.source, atom.cite?.path].filter(Boolean).join(' ').toLowerCase()
  let s = 0
  for (const t of terms) { if (claim.includes(t)) s += 3; if (rest.includes(t)) s += 1 }
  if (terms.length > 1 && claim.includes(q)) s += 5
  return s
}

const FILTERS = {
  type: ['all', 'workflow', 'rule', 'skill', 'constitution'],
  tone: ['all', 'must', 'must-not', 'should', 'should-not'],
  origin: ['all', 'original', 'critic'],
  attest: ['all', 'confirmed', 'insufficient'],
}

function Ask({ idx, repo, accent }) {
  const [q, setQ] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [f, setF] = useState({ type: 'all', source: 'all', tone: 'all', origin: 'all', attest: 'all' })
  const [explain, setExplain] = useState(null) // {busy, answer, err, ids}

  const allAtoms = useMemo(() => idx.sources.flatMap(s => s.atoms), [idx])
  const filtered = allAtoms.filter(a =>
    (f.type === 'all' || a.sourceType === f.type) &&
    (f.source === 'all' || a.source === f.source) &&
    (f.tone === 'all' || a.tone === f.tone) &&
    (f.origin === 'all' || a.origin === f.origin) &&
    (f.attest === 'all' || a.attestStatus === f.attest))

  const results = useMemo(() => {
    if (!submitted) return null
    const ql = submitted.toLowerCase()
    const terms = ql.split(/\W+/).filter(t => t.length > 1)
    return filtered.map(a => ({ score: scoreAtom(terms, ql, a), a })).filter(r => r.score > 0)
      .sort((x, y) => y.score - x.score).slice(0, 10)
  }, [submitted, allAtoms, f.type, f.source, f.tone, f.origin, f.attest])

  const doExplain = atoms => {
    setExplain({ busy: true, ids: atoms.map(a => a.id) })
    api.post('/api/atoms/explain', { question: submitted, atoms })
      .then(r => setExplain({ answer: r.answer, ids: atoms.map(a => a.id) }))
      .catch(e => setExplain({ err: e.message, ids: atoms.map(a => a.id) }))
  }

  const shown = submitted ? results : filtered.slice(0, 50).map(a => ({ a })) // no query yet → browse filtered atoms
  const maxScore = submitted && results.length ? results[0].score : 1
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="ask the project… e.g. what happens when a sale creation fails"
          onKeyDown={e => { if (e.key === 'Enter') { setSubmitted(q.trim()); setExplain(null) } }}
          style={{ font: `400 13px ${MONO}`, flex: 1, padding: '8px 12px' }} />
        <button onClick={() => { setSubmitted(q.trim()); setExplain(null) }}>search</button>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {Object.entries(FILTERS).map(([k, opts]) => (
          <label key={k} style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>
            {k}{' '}
            <select value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} style={{ font: `400 11px ${MONO}` }}>
              {opts.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        ))}
        <label style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>
          source{' '}
          <select value={f.source} onChange={e => setF({ ...f, source: e.target.value })} style={{ font: `400 11px ${MONO}`, maxWidth: 220 }}>
            <option value="all">all</option>
            {idx.sources.map(s => <option key={s.id} value={s.id}>{s.id}</option>)}
          </select>
        </label>
        <Dim style={{ marginLeft: 'auto' }}>{filtered.length} atoms in scope</Dim>
      </div>

      {explain && (
        <div style={{ ...PANEL, borderColor: accent + '44' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 6 }}>
            <div style={{ font: `600 12px ${HEAD}`, color: accent }}>Grounded answer</div>
            <Dim>from {explain.ids.length} atom{explain.ids.length > 1 ? 's' : ''} only — no outside knowledge</Dim>
            <button style={{ marginLeft: 'auto' }} onClick={() => setExplain(null)}>×</button>
          </div>
          {explain.busy && <Dim>asking the model…</Dim>}
          {explain.err && <div style={{ font: `400 12px ${MONO}`, color: 'var(--red)' }}>{explain.err}</div>}
          {explain.answer && <div style={{ font: `400 13px ${SANS}`, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>{explain.answer}</div>}
        </div>
      )}

      <div style={PANEL}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 4 }}>
          <div style={{ font: `600 12px ${HEAD}`, color: 'var(--text-primary)' }}>
            {submitted ? `Top matches for “${submitted}”` : 'Browse atoms (filtered)'}
          </div>
          {submitted && results?.length > 0 && <button style={{ marginLeft: 'auto' }} onClick={() => doExplain(results.map(r => r.a))}>✨ explain all results</button>}
        </div>
        {submitted && results?.length > 0 && (
          <div style={{ margin: '4px 0 10px' }}>
            <StackedBar segments={toneSegments(results.map(r => r.a))} height={8} />
          </div>
        )}
        <DataTable
          columns={[
            ...(submitted ? [{
              key: 'score', label: 'match', width: 70, sortValue: r => r.score ?? 0,
              render: r => (
                <span title={`relevance ${r.score}`} style={{ display: 'inline-block', width: 54, height: 6, background: 'var(--bg-surface-hover)', borderRadius: 3, overflow: 'hidden' }}>
                  <span className="chart-bar-fill" style={{ display: 'block', width: ((r.score ?? 0) / maxScore * 100) + '%', height: '100%', background: accent, borderRadius: 3 }} />
                </span>
              ),
            }] : []),
            { key: 'source', label: 'source', width: 150, sortValue: r => r.a.source, render: r => <Chip text={r.a.source} color={KIND_COLOR[r.a.sourceType]} /> },
            ...atomColumns(accent).map(c => ({ ...c, render: c.render ? r => c.render(r.a) : undefined, sortValue: c.sortValue ? r => c.sortValue(r.a) : undefined })),
            ...(submitted ? [{
              key: 'act', label: '', width: 80, align: 'center',
              render: r => <button style={{ font: `400 10px ${MONO}`, padding: '1px 6px' }} onClick={() => doExplain([r.a])}>explain</button>,
            }] : []),
          ]}
          rows={(shown || []).map(r => ({ ...r, __key: r.a.id }))} />
        {submitted && results?.length === 0 && <Dim style={{ marginTop: 8 }}>no atoms match — the knowledge base may not cover this.</Dim>}
      </div>
    </div>
  )
}

// ---------- triage: insufficient-evidence atoms with a persisted reviewed checkbox ----------
function Triage({ idx, repo, accent }) {
  const [reviewed, setReviewed] = useState(null)
  useEffect(() => { api.get('/api/atoms/reviewed?repo=' + encodeURIComponent(repo)).then(setReviewed).catch(() => setReviewed({})) }, [repo])
  if (reviewed === null) return <Dim>loading review state…</Dim>

  const toggle = (atomId, on) => {
    setReviewed({ ...reviewed, ...(on ? { [atomId]: { at: new Date().toISOString() } } : {}) , ...(on ? {} : (() => { const c = { ...reviewed }; delete c[atomId]; return c })()) })
    api.post('/api/atoms/reviewed?repo=' + encodeURIComponent(repo), { atomId, reviewed: on }).then(setReviewed).catch(() => {})
  }
  const done = idx.insufficient.filter(i => reviewed[i.atomId]).length
  const byArtifact = [...d3GroupCount(idx.insufficient, i => i.artifact)]
    .map(([label, value]) => ({ label, value, color: 'var(--amber)' })).sort((a, b) => b.value - a.value)
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ ...PANEL, display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <Ring value={idx.insufficient.length ? done / idx.insufficient.length : 1} label={`${done}/${idx.insufficient.length}`}
          sub="reviewed" size={76} color={done === idx.insufficient.length ? 'var(--green)' : accent} />
        <div style={{ flex: 1, minWidth: 260 }}>
          <Dim style={{ marginBottom: 6 }}>flagged atoms per artifact — where the extractor over-reached</Dim>
          <Bars items={byArtifact} color="var(--amber)" height={12} />
        </div>
      </div>
    <div style={PANEL}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 8 }}>
        <div style={{ font: `600 12px ${HEAD}`, color: 'var(--text-primary)' }}>Insufficient-evidence atoms — flagged for human review</div>
        <Chip text={`${done}/${idx.insufficient.length} reviewed`} color={done === idx.insufficient.length ? 'var(--green)' : accent} />
      </div>
      <DataTable
        columns={[
          {
            key: 'done', label: '✓', width: 36, align: 'center', sortValue: i => reviewed[i.atomId] ? 1 : 0,
            render: i => <input type="checkbox" checked={!!reviewed[i.atomId]} onChange={e => toggle(i.atomId, e.target.checked)} />,
          },
          { key: 'artifact', label: 'artifact', width: 150, render: i => <Chip text={i.artifact} color="var(--accent)" /> },
          {
            key: 'claim', label: 'claim · judge verdict', sortValue: i => i.claim,
            render: i => (
              <div style={{ opacity: reviewed[i.atomId] ? 0.45 : 1, minWidth: 240 }}>
                <div style={{ font: `400 12px ${SANS}`, color: 'var(--text-primary)' }}>{i.claim}</div>
                <Dim style={{ marginTop: 3 }}><span style={{ color: 'var(--amber)' }}>judge:</span> {i.reason}</Dim>
              </div>
            ),
          },
          { key: 'cite', label: 'citation', width: 200, sortValue: i => i.cite, render: i => <span style={{ color: 'var(--text-secondary)', font: `400 10px ${MONO}`, overflowWrap: 'anywhere' }}>{i.cite}</span> },
        ]}
        rows={idx.insufficient.map(i => ({ ...i, __key: i.atomId }))} />
      {idx.insufficient.length === 0 && <Dim>nothing flagged — all atoms confirmed.</Dim>}
    </div>
    </div>
  )
}

// tiny group-count without importing d3 here
function d3GroupCount(arr, key) {
  const m = new Map()
  for (const x of arr) m.set(key(x), (m.get(key(x)) || 0) + 1)
  return m
}

// ---------- gaps: repo folders with zero rule/workflow coverage ----------
function Gaps({ idx, accent }) {
  const gaps = idx.coverage.dirs.filter(d => d.sources.length === 0)
  const covered = idx.coverage.dirs.length - gaps.length
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ ...PANEL, display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <Ring value={idx.coverage.dirs.length ? covered / idx.coverage.dirs.length : 0} sub={`${covered}/${idx.coverage.dirs.length} dirs covered`} size={76}
          color={gaps.length === 0 ? 'var(--green)' : accent} />
        <div style={{ flex: 1, minWidth: 320 }}>
          <div style={{ font: `600 12px ${HEAD}`, color: 'var(--text-primary)', marginBottom: 8 }}>Coverage map — every source folder, colored by how many artifacts govern it</div>
          <CoverageTreemap dirs={idx.coverage.dirs} />
        </div>
      </div>
      <details style={PANEL} open={gaps.length > 0 && gaps.length <= 24}>
        <summary style={{ font: `600 12px ${HEAD}`, color: 'var(--text-primary)', cursor: 'pointer' }}>
          Zero-coverage folders <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)' }}>({gaps.length} of {idx.coverage.dirs.length} scanned dirs have no path-scoped guidance)</span>
        </summary>
        <div style={{ columns: '280px 3', gap: 24, marginTop: 8 }}>
          {gaps.map(g => <div key={g.dir} style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)', padding: '1px 0', overflowWrap: 'anywhere' }}>{g.dir}</div>)}
        </div>
        {gaps.length === 0 && <Dim>every scanned folder is covered by at least one artifact.</Dim>}
      </details>
    </div>
  )
}

export default function AtomsSection({ view, repo, accent = 'var(--amber)' }) {
  const { idx, err } = useIndex(repo)
  if (err) return <div style={{ font: `400 12px ${MONO}`, color: 'var(--red)' }}>{err}</div>
  if (!idx) return <Dim>indexing atoms…</Dim>
  return view === 'catalog' ? <Catalog idx={idx} accent={accent} />
    : view === 'ask' ? <Ask idx={idx} repo={repo} accent={accent} />
    : view === 'triage' ? <Triage idx={idx} repo={repo} accent={accent} />
    : <Gaps idx={idx} accent={accent} />
}
