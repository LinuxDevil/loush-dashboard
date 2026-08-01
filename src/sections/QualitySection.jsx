import React, { useEffect, useState } from 'react'
import { api, fmtDate } from '../lib/api.js'
import Skeleton from '../ui/Skeleton.jsx'
import { Tabs } from '../ui/tabs.jsx'

const MONO = "var(--mono)"
const HEAD = "var(--head)"
const PANEL = { background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 12, padding: '16px 18px' }

function useProjectPick() {
  const [scopes, setScopes] = useState([])
  const [project, setProject] = useState('')
  useEffect(() => { api.get('/api/harness').then(d => { const p = d.scopes.filter(s => s.id !== 'global'); setScopes(p); if (p[0] && !project) setProject(p[0].id) }).catch(() => {}) }, [])
  const picker = (
    <select value={project} onChange={e => setProject(e.target.value)}>
      {scopes.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
    </select>
  )
  return { project, picker }
}

export default function QualitySection() {
  const [tab, setTab] = useState('Analytics events')
  return (
    <div className="hx" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Tabs tabs={['Analytics events', 'Design drift', 'Review loop']} tab={tab} setTab={setTab} />
      {tab === 'Analytics events' && <Analytics />}
      {tab === 'Design drift' && <Design />}
      {tab === 'Review loop' && <Reviews />}
    </div>
  )
}

// ---------- 28: analytics instrumentation registry ----------
function Analytics() {
  const { project, picker } = useProjectPick()
  const [reg, setReg] = useState(null)
  const [drift, setDrift] = useState(null)
  const load = () => {
    setReg(null)
    api.get('/api/analytics/registry?project=' + encodeURIComponent(project)).then(setReg).catch(() => {})
    api.get('/api/analytics/drift?project=' + encodeURIComponent(project)).then(setDrift).catch(() => {})
  }
  useEffect(() => { if (project) load() }, [project])
  const bootstrap = () => api.post('/api/analytics/taxonomy', { project })
    .then(r => { alert(`taxonomy written: ${r.path} (${r.events} events) — edit it to add required properties`); load() }).catch(e => alert(e.message))
  if (!project) return <div style={{ font: `400 12px ${MONO}`, color: 'var(--text-tertiary)' }}>no projects</div>
  if (!reg) return <Skeleton tiles={0} rows={6} />
  const bad = reg?.events.filter(e => !e.ok) || []
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {picker}
        {reg && <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>
          {reg.events.length} events in {reg.filesScanned} files · convention: <b style={{ color: 'var(--accent-light)' }}>{reg.convention || 'none detected'}</b> · {reg.taxonomy ? 'taxonomy: .claude/analytics-taxonomy.json' : 'no taxonomy file'}
        </span>}
        {reg && !reg.taxonomy && <button className="mini" style={{ marginTop: 0 }} onClick={bootstrap}>bootstrap taxonomy from code</button>}
      </div>
      {drift?.added?.length > 0 && (
        <div style={{ ...PANEL, borderColor: 'var(--accent)' }}>
          <div style={{ font: `600 14px ${HEAD}`, color: 'var(--accent-light)', marginBottom: 8 }}>⚠ Uncommitted new events — check before committing</div>
          {drift.added.map((a, i) => (
            <div key={i} style={{ font: `400 12px ${MONO}`, padding: '3px 0' }}>
              <span style={{ color: 'var(--text-primary)' }}>{a.name}</span>
              {a.issues.length ? <span style={{ color: 'var(--red)' }}> — {a.issues.join(' · ')}</span> : <span style={{ color: 'var(--green)' }}> ✓ matches taxonomy</span>}
            </div>
          ))}
        </div>
      )}
      {!reg && <div style={{ font: `400 12px ${MONO}`, color: 'var(--text-tertiary)' }}>scanning source for tracking calls…</div>}
      {reg && (
        <div style={{ ...PANEL }}>
          <div style={{ font: `600 14px ${HEAD}`, marginBottom: 10 }}>Event registry <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>{bad.length ? `${bad.length} with issues` : 'all consistent'}</span></div>
          {reg.events.map(e => (
            <details key={e.name} style={{ padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <summary style={{ cursor: 'pointer', font: `500 12px ${MONO}` }}>
                <span style={{ color: e.ok ? 'var(--green)' : 'var(--red)' }}>{e.ok ? '✓' : '✗'}</span>{' '}
                <span style={{ color: 'var(--text-primary)' }}>{e.name}</span>{' '}
                <span style={{ color: 'var(--text-tertiary)' }}>· {e.count} call site{e.count === 1 ? '' : 's'}</span>
                {e.issues.map(i => <span key={i} style={{ color: 'var(--amber)' }}> · {i}</span>)}
              </summary>
              <div style={{ margin: '6px 0 4px 18px', font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>
                {e.props.length > 0 && <div>props: {e.props.join(', ')}</div>}
                {e.locations.map((l, i) => <div key={i}>{l.file}:{l.line} <span style={{ color: 'var(--text-tertiary)' }}>via {l.callee}()</span></div>)}
              </div>
            </details>
          ))}
          {reg.events.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>no tracking calls found (looks for .track / .capture / logEvent / trackEvent / recordEvent)</div>}
          {reg.missingFromCode.length > 0 && <div style={{ font: `400 11px ${MONO}`, color: 'var(--amber)', marginTop: 10 }}>in taxonomy but gone from code: {reg.missingFromCode.join(', ')}</div>}
        </div>
      )}
      <p className="small">registry computed live from source · taxonomy at .claude/analytics-taxonomy.json defines the convention + required properties per event · the drift panel checks uncommitted git changes so bad names never land</p>
    </div>
  )
}

// ---------- 29: design-system drift ----------
function Design() {
  const { project, picker } = useProjectPick()
  const [d, setD] = useState(null)
  const load = () => { setD(null); api.get('/api/design/drift?project=' + encodeURIComponent(project)).then(setD).catch(() => {}) }
  useEffect(() => { if (project) load() }, [project])
  const bootstrap = () => api.post('/api/design/manifest', { project })
    .then(r => { alert(`manifest written: ${r.path} (${r.components} components) — let a Figma MCP session enrich it with node ids & variants`); load() }).catch(e => alert(e.message))
  if (!project) return <div style={{ font: `400 12px ${MONO}`, color: 'var(--text-tertiary)' }}>no projects</div>
  if (!d) return <Skeleton tiles={0} rows={6} />
  const TYPE = { 'missing-in-code': 'var(--red)', 'prop-drift': 'var(--accent-light)', 'variant-drift': 'var(--accent-light)', undocumented: 'var(--violet)' }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {picker}
        {d && <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>{d.code} components in code · {d.manifest ? 'manifest: .claude/design-manifest.json' : 'no design manifest yet'}</span>}
        {d && !d.manifest && <button className="mini" style={{ marginTop: 0 }} onClick={bootstrap}>bootstrap manifest from code</button>}
        {d?.manifest && <button className="mini" style={{ marginTop: 0 }} onClick={load}>re-check now</button>}
      </div>
      {d && (
        <div className="hx-2a">
          <div style={{ ...PANEL }}>
            <div style={{ font: `600 14px ${HEAD}`, marginBottom: 10 }}>Drift vs Figma manifest <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>{d.drifts.length} finding{d.drifts.length === 1 ? '' : 's'} · feeds Recommendations</span></div>
            {d.drifts.map((x, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '7px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ font: `600 9px ${MONO}`, padding: '2px 6px', borderRadius: 4, color: TYPE[x.type], background: 'var(--bg-surface-hover)', flexShrink: 0 }}>{x.type}</span>
                <span style={{ font: `500 12px ${MONO}`, color: 'var(--text-primary)', flexShrink: 0 }}>{x.component}</span>
                <span style={{ font: "400 12px var(--body)", color: 'var(--text-secondary)', flex: 1 }}>{x.detail}</span>
                {}
                {x.figmaNode && (x.figmaFileKey
                  ? <a href={`https://www.figma.com/design/${encodeURIComponent(x.figmaFileKey)}/?node-id=${encodeURIComponent(x.figmaNode)}`} target="_blank" rel="noreferrer" style={{ font: `400 10px ${MONO}`, color: 'var(--blue)', flexShrink: 0 }}>frame ↗</a>
                  : <span title="no Figma fileKey in the manifest — add one to make this a link" style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)', flexShrink: 0 }}>node {x.figmaNode}</span>)}
              </div>
            ))}
            {}
            {d.status?.state === 'baseline-only' && (
              <div style={{ font: `400 12px ${MONO}`, color: 'var(--amber)', lineHeight: 1.6 }}>
                ⚠ cannot detect drift yet — this manifest was generated from the code, so diffing it
                against the code will always agree. 0 of {d.status.total} components have a figmaNode
                or variants. Have a Figma MCP session fill those in; drift becomes measurable from then on.
              </div>
            )}
            {d.status?.driftDetectable && d.drifts.length === 0 && (
              <div style={{ font: `400 12px ${MONO}`, color: 'var(--green)' }}>
                ✓ code and manifest agree <span style={{ color: 'var(--text-tertiary)' }}>· {d.status.enriched}/{d.status.total} components carry design-side data</span>
              </div>
            )}
            {!d.manifest && <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>bootstrap the manifest, then have a Figma MCP session fill in figmaNode ids and variants — drift is diffed against it from then on</div>}
          </div>
          <div style={{ ...PANEL }}>
            <div style={{ font: `600 14px ${HEAD}`, marginBottom: 10 }}>Figma MCP call budget</div>
            {[['today · this project', d.figmaCalls.day], ['7 days · this project', d.figmaCalls.week], ['today · all projects', d.figmaCalls.allProjectsDay]].map(([l, v]) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', font: `500 12px ${MONO}`, padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{l}</span><span style={{ color: 'var(--text-primary)' }}>{v} calls</span>
              </div>
            ))}
            <p className="small">counted from real session transcripts — watch this before batch design-to-code runs so you don't hit Figma's rate limit mid-run (Figma doesn't expose remaining quota via MCP)</p>
          </div>
        </div>
      )}
      {!d && <div style={{ font: `400 12px ${MONO}`, color: 'var(--text-tertiary)' }}>scanning components…</div>}
    </div>
  )
}

// ---------- 30: code review loop ----------
function Reviews() {
  const { project, picker } = useProjectPick()
  const [all, setAll] = useState(false)
  const [d, setD] = useState(null)
  useEffect(() => { setD(null); api.get('/api/reviews' + (all ? '' : '?project=' + encodeURIComponent(project))).then(setD).catch(() => {}) }, [project, all])
  const SEVC = { fixed: 'var(--green)', skipped: 'var(--amber)', no_change_needed: 'var(--text-secondary)' }
  if (!d) return <Skeleton tiles={0} rows={6} />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {!all && picker}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, font: `400 11px ${MONO}`, color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} style={{ width: 13 }} />all projects
        </label>
        {d && <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>{d.sessions.length} transcript passes · {d.totalFindings} findings{d.runReviews?.length ? ` · ${d.runReviews.length} loush review.json` : ''}</span>}
      </div>
      {d?.recurring.length > 0 && (
        <div style={{ ...PANEL, borderColor: 'var(--accent)' }}>
          <div style={{ font: `600 14px ${HEAD}`, color: 'var(--accent-light)', marginBottom: 8 }}>Recurring findings — automate these away</div>
          {d.recurring.map(r => (
            <div key={r.category} style={{ padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <div style={{ font: `500 12px ${MONO}`, color: 'var(--text-primary)' }}>{r.category} <span style={{ color: 'var(--text-tertiary)' }}>· {r.count} findings across {r.passes} review passes</span></div>
              <div style={{ font: "400 12px var(--body)", color: 'var(--text-secondary)', marginTop: 2 }}>e.g. {r.examples[0]} — consider a PreToolUse hook (Hooks → Library) or a CLAUDE.md rule to block this class automatically</div>
            </div>
          ))}
        </div>
      )}
      {d?.runReviews?.length > 0 && (
        <div style={{ ...PANEL, borderColor: 'var(--blue)' }}>
          <div style={{ font: `600 14px ${HEAD}`, color: 'var(--blue)', marginBottom: 8 }}>Loush code-reviewer · review.json</div>
          {d.runReviews.map((r, i) => (
            <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                <span style={{ font: `600 11px ${MONO}`, color: r.decision === 'APPROVE' ? 'var(--green)' : r.decision === 'REQUEST_CHANGES' ? 'var(--red)' : 'var(--amber)' }}>{r.decision}</span>
                <span style={{ font: "400 12px var(--body)", color: 'var(--text-secondary)', flex: 1 }}>{r.summary}</span>
                <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)' }}>{r.proj} · {r.findings.length} findings</span>
              </div>
              {r.findings.slice(0, 8).map((f, j) => (
                <div key={j} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '2px 0 2px 12px', font: `400 11px ${MONO}` }}>
                  <span style={{ color: f.severity === 'Critical' || f.severity === 'Required' ? 'var(--red)' : 'var(--text-secondary)', flexShrink: 0 }}>{f.severity}</span>
                  <span style={{ color: 'var(--text-secondary)', flex: 1 }}>{f.body}</span>
                  <span style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}>{f.file || (f.files || []).join(', ')}{f.line ? ':' + f.line : ''}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {!d && <div style={{ font: `400 12px ${MONO}`, color: 'var(--text-tertiary)' }}>scanning transcripts…</div>}
      {d?.sessions.map((s, i) => (
        <div key={i} style={{ ...PANEL, padding: '14px 18px' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', marginBottom: 8 }}>
            <span style={{ font: `600 13px ${HEAD}` }}>{s.findings.length} finding{s.findings.length === 1 ? '' : 's'}</span>
            <span className="badge project">{s.source}</span>
            {s.level && <span className="badge user">effort: {s.level}</span>}
            <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>{s.proj.split('-').slice(-2).join('-')} · {fmtDate(s.t)}</span>
            <span style={{ marginLeft: 'auto', font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>
              {s.fixed > 0 && <b style={{ color: 'var(--green)' }}>{s.fixed} fixed </b>}
              {s.dismissed > 0 && <b style={{ color: 'var(--amber)' }}>{s.dismissed} dismissed</b>}
            </span>
          </div>
          {s.findings.map((f, j) => (
            <div key={j} style={{ display: 'flex', gap: 9, alignItems: 'baseline', padding: '4px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ font: `600 9px ${MONO}`, padding: '1px 6px', borderRadius: 4, color: 'var(--violet)', background: 'var(--violet-bg)', flexShrink: 0 }}>{f.category}</span>
              <span style={{ font: "400 12px var(--body)", color: 'var(--text-secondary)', flex: 1 }}>{f.summary}</span>
              <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)', flexShrink: 0 }}>{f.file}{f.line ? ':' + f.line : ''}</span>
              {f.verdict && <span style={{ font: `400 9px ${MONO}`, color: f.verdict === 'CONFIRMED' ? 'var(--red)' : 'var(--accent-light)', flexShrink: 0 }}>{f.verdict}</span>}
              {f.outcome && <span style={{ font: `600 9px ${MONO}`, color: SEVC[f.outcome] || 'var(--text-secondary)', flexShrink: 0 }}>{f.outcome}</span>}
            </div>
          ))}
        </div>
      ))}
      {d && d.sessions.length === 0 && <div style={{ ...PANEL, font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>no review runs found — run /code-review or /security-review in a session and results land here</div>}
    </div>
  )
}
