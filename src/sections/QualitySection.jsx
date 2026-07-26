import React, { useEffect, useState } from 'react'
import { api, fmtDate } from '../lib/api.js'
import Skeleton from '../ui/Skeleton.jsx'
import { Tabs } from '../ui/tabs.jsx'

const MONO = "'IBM Plex Mono', monospace"
const HEAD = "'Space Grotesk', sans-serif"
const PANEL = { background: 'rgba(28,24,21,0.55)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: '18px 20px', backdropFilter: 'blur(10px)' }

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
  if (!project) return <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>no projects</div>
  if (!reg) return <Skeleton tiles={0} rows={6} />
  const bad = reg?.events.filter(e => !e.ok) || []
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {picker}
        {reg && <span style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>
          {reg.events.length} events in {reg.filesScanned} files · convention: <b style={{ color: '#e8a06a' }}>{reg.convention || 'none detected'}</b> · {reg.taxonomy ? 'taxonomy: .claude/analytics-taxonomy.json' : 'no taxonomy file'}
        </span>}
        {reg && !reg.taxonomy && <button className="mini" style={{ marginTop: 0 }} onClick={bootstrap}>bootstrap taxonomy from code</button>}
      </div>
      {drift?.added?.length > 0 && (
        <div style={{ ...PANEL, borderColor: 'rgba(232,160,106,0.35)' }}>
          <div style={{ font: `600 14px ${HEAD}`, color: '#e8a06a', marginBottom: 8 }}>⚠ Uncommitted new events — check before committing</div>
          {drift.added.map((a, i) => (
            <div key={i} style={{ font: `400 11.5px ${MONO}`, padding: '3px 0' }}>
              <span style={{ color: '#eee3da' }}>{a.name}</span>
              {a.issues.length ? <span style={{ color: '#e5484d' }}> — {a.issues.join(' · ')}</span> : <span style={{ color: '#3fb96a' }}> ✓ matches taxonomy</span>}
            </div>
          ))}
        </div>
      )}
      {!reg && <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>scanning source for tracking calls…</div>}
      {reg && (
        <div style={{ ...PANEL }}>
          <div style={{ font: `600 15px ${HEAD}`, marginBottom: 10 }}>Event registry <span style={{ font: `400 11px ${MONO}`, color: '#8a807a' }}>{bad.length ? `${bad.length} with issues` : 'all consistent'}</span></div>
          {reg.events.map(e => (
            <details key={e.name} style={{ padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.045)' }}>
              <summary style={{ cursor: 'pointer', font: `500 12px ${MONO}` }}>
                <span style={{ color: e.ok ? '#3fb96a' : '#e5484d' }}>{e.ok ? '✓' : '✗'}</span>{' '}
                <span style={{ color: '#eee3da' }}>{e.name}</span>{' '}
                <span style={{ color: '#7a716a' }}>· {e.count} call site{e.count === 1 ? '' : 's'}</span>
                {e.issues.map(i => <span key={i} style={{ color: '#e5a03a' }}> · {i}</span>)}
              </summary>
              <div style={{ margin: '6px 0 4px 18px', font: `400 10.5px ${MONO}`, color: '#8a807a' }}>
                {e.props.length > 0 && <div>props: {e.props.join(', ')}</div>}
                {e.locations.map((l, i) => <div key={i}>{l.file}:{l.line} <span style={{ color: '#5a514a' }}>via {l.callee}()</span></div>)}
              </div>
            </details>
          ))}
          {reg.events.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: '#5a514a' }}>no tracking calls found (looks for .track / .capture / logEvent / trackEvent / recordEvent)</div>}
          {reg.missingFromCode.length > 0 && <div style={{ font: `400 11px ${MONO}`, color: '#e5a03a', marginTop: 10 }}>in taxonomy but gone from code: {reg.missingFromCode.join(', ')}</div>}
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
  if (!project) return <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>no projects</div>
  if (!d) return <Skeleton tiles={0} rows={6} />
  const TYPE = { 'missing-in-code': '#e5484d', 'prop-drift': '#e8a06a', 'variant-drift': '#e8a06a', undocumented: '#8b7cf6' }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {picker}
        {d && <span style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>{d.code} components in code · {d.manifest ? 'manifest: .claude/design-manifest.json' : 'no design manifest yet'}</span>}
        {d && !d.manifest && <button className="mini" style={{ marginTop: 0 }} onClick={bootstrap}>bootstrap manifest from code</button>}
        {d?.manifest && <button className="mini" style={{ marginTop: 0 }} onClick={load}>re-check now</button>}
      </div>
      {d && (
        <div className="hx-2a">
          <div style={{ ...PANEL }}>
            <div style={{ font: `600 15px ${HEAD}`, marginBottom: 10 }}>Drift vs Figma manifest <span style={{ font: `400 11px ${MONO}`, color: '#8a807a' }}>{d.drifts.length} finding{d.drifts.length === 1 ? '' : 's'} · feeds Recommendations</span></div>
            {d.drifts.map((x, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.045)' }}>
                <span style={{ font: `600 9px ${MONO}`, padding: '2px 6px', borderRadius: 4, color: TYPE[x.type], background: 'rgba(255,255,255,0.04)', flexShrink: 0 }}>{x.type}</span>
                <span style={{ font: `500 12px ${MONO}`, color: '#eee3da', flexShrink: 0 }}>{x.component}</span>
                <span style={{ font: "400 12px 'IBM Plex Sans'", color: '#b0a69e', flex: 1 }}>{x.detail}</span>
                {/* A Figma URL needs the file key, which the manifest does not carry — the old link
                    was https://www.figma.com/design/?node-id=… with no file, so it could never
                    resolve. Show the node id (copyable) unless a real fileKey is present. */}
                {x.figmaNode && (x.figmaFileKey
                  ? <a href={`https://www.figma.com/design/${encodeURIComponent(x.figmaFileKey)}/?node-id=${encodeURIComponent(x.figmaNode)}`} target="_blank" rel="noreferrer" style={{ font: `400 10px ${MONO}`, color: '#7cc4f7', flexShrink: 0 }}>frame ↗</a>
                  : <span title="no Figma fileKey in the manifest — add one to make this a link" style={{ font: `400 10px ${MONO}`, color: '#7a716a', flexShrink: 0 }}>node {x.figmaNode}</span>)}
              </div>
            ))}
            {/* A code-generated baseline cannot disagree with the code it was generated from, so an
                empty drift list there is not an all-clear — it is "no measurement was possible". */}
            {d.status?.state === 'baseline-only' && (
              <div style={{ font: `400 12px ${MONO}`, color: '#e5a03a', lineHeight: 1.6 }}>
                ⚠ cannot detect drift yet — this manifest was generated from the code, so diffing it
                against the code will always agree. 0 of {d.status.total} components have a figmaNode
                or variants. Have a Figma MCP session fill those in; drift becomes measurable from then on.
              </div>
            )}
            {d.status?.driftDetectable && d.drifts.length === 0 && (
              <div style={{ font: `400 12px ${MONO}`, color: '#3fb96a' }}>
                ✓ code and manifest agree <span style={{ color: '#7a716a' }}>· {d.status.enriched}/{d.status.total} components carry design-side data</span>
              </div>
            )}
            {!d.manifest && <div style={{ font: `400 11px ${MONO}`, color: '#5a514a' }}>bootstrap the manifest, then have a Figma MCP session fill in figmaNode ids and variants — drift is diffed against it from then on</div>}
          </div>
          <div style={{ ...PANEL }}>
            <div style={{ font: `600 15px ${HEAD}`, marginBottom: 10 }}>Figma MCP call budget</div>
            {[['today · this project', d.figmaCalls.day], ['7 days · this project', d.figmaCalls.week], ['today · all projects', d.figmaCalls.allProjectsDay]].map(([l, v]) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', font: `500 12px ${MONO}`, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <span style={{ color: '#8a807a' }}>{l}</span><span style={{ color: '#eee3da' }}>{v} calls</span>
              </div>
            ))}
            <p className="small">counted from real session transcripts — watch this before batch design-to-code runs so you don't hit Figma's rate limit mid-run (Figma doesn't expose remaining quota via MCP)</p>
          </div>
        </div>
      )}
      {!d && <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>scanning components…</div>}
    </div>
  )
}

// ---------- 30: code review loop ----------
function Reviews() {
  const { project, picker } = useProjectPick()
  const [all, setAll] = useState(false)
  const [d, setD] = useState(null)
  useEffect(() => { setD(null); api.get('/api/reviews' + (all ? '' : '?project=' + encodeURIComponent(project))).then(setD).catch(() => {}) }, [project, all])
  const SEVC = { fixed: '#3fb96a', skipped: '#e5a03a', no_change_needed: '#8a807a' }
  if (!d) return <Skeleton tiles={0} rows={6} />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {!all && picker}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, font: `400 11px ${MONO}`, color: '#8a807a', cursor: 'pointer' }}>
          <input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} style={{ width: 13 }} />all projects
        </label>
        {d && <span style={{ font: `400 11px ${MONO}`, color: '#7a716a', marginLeft: 'auto' }}>{d.sessions.length} transcript passes · {d.totalFindings} findings{d.runReviews?.length ? ` · ${d.runReviews.length} loush review.json` : ''}</span>}
      </div>
      {d?.recurring.length > 0 && (
        <div style={{ ...PANEL, borderColor: 'rgba(232,160,106,0.35)' }}>
          <div style={{ font: `600 14px ${HEAD}`, color: '#e8a06a', marginBottom: 8 }}>Recurring findings — automate these away</div>
          {d.recurring.map(r => (
            <div key={r.category} style={{ padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <div style={{ font: `500 12px ${MONO}`, color: '#eee3da' }}>{r.category} <span style={{ color: '#7a716a' }}>· {r.count} findings across {r.passes} review passes</span></div>
              <div style={{ font: "400 11.5px 'IBM Plex Sans'", color: '#9a9089', marginTop: 2 }}>e.g. {r.examples[0]} — consider a PreToolUse hook (Hooks → Library) or a CLAUDE.md rule to block this class automatically</div>
            </div>
          ))}
        </div>
      )}
      {d?.runReviews?.length > 0 && (
        <div style={{ ...PANEL, borderColor: 'rgba(124,196,247,0.3)' }}>
          <div style={{ font: `600 14px ${HEAD}`, color: '#7cc4f7', marginBottom: 8 }}>Loush code-reviewer · review.json</div>
          {d.runReviews.map((r, i) => (
            <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                <span style={{ font: `600 11px ${MONO}`, color: r.decision === 'APPROVE' ? '#3fb96a' : r.decision === 'REQUEST_CHANGES' ? '#e5484d' : '#e5a03a' }}>{r.decision}</span>
                <span style={{ font: "400 12px 'IBM Plex Sans'", color: '#c8bdb4', flex: 1 }}>{r.summary}</span>
                <span style={{ font: `400 10px ${MONO}`, color: '#7a716a' }}>{r.proj} · {r.findings.length} findings</span>
              </div>
              {r.findings.slice(0, 8).map((f, j) => (
                <div key={j} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '2px 0 2px 12px', font: `400 10.5px ${MONO}` }}>
                  <span style={{ color: f.severity === 'Critical' || f.severity === 'Required' ? '#e5484d' : '#8a807a', flexShrink: 0 }}>{f.severity}</span>
                  <span style={{ color: '#c8bdb4', flex: 1 }}>{f.body}</span>
                  <span style={{ color: '#7a716a', flexShrink: 0 }}>{f.file || (f.files || []).join(', ')}{f.line ? ':' + f.line : ''}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {!d && <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>scanning transcripts…</div>}
      {d?.sessions.map((s, i) => (
        <div key={i} style={{ ...PANEL, padding: '14px 18px' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', marginBottom: 8 }}>
            <span style={{ font: `600 13px ${HEAD}` }}>{s.findings.length} finding{s.findings.length === 1 ? '' : 's'}</span>
            <span className="badge project">{s.source}</span>
            {s.level && <span className="badge user">effort: {s.level}</span>}
            <span style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>{s.proj.split('-').slice(-2).join('-')} · {fmtDate(s.t)}</span>
            <span style={{ marginLeft: 'auto', font: `400 10.5px ${MONO}`, color: '#8a807a' }}>
              {s.fixed > 0 && <b style={{ color: '#3fb96a' }}>{s.fixed} fixed </b>}
              {s.dismissed > 0 && <b style={{ color: '#e5a03a' }}>{s.dismissed} dismissed</b>}
            </span>
          </div>
          {s.findings.map((f, j) => (
            <div key={j} style={{ display: 'flex', gap: 9, alignItems: 'baseline', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.035)' }}>
              <span style={{ font: `600 9px ${MONO}`, padding: '1px 6px', borderRadius: 4, color: '#a78bfa', background: 'rgba(139,124,246,0.12)', flexShrink: 0 }}>{f.category}</span>
              <span style={{ font: "400 12px 'IBM Plex Sans'", color: '#c8bdb4', flex: 1 }}>{f.summary}</span>
              <span style={{ font: `400 10px ${MONO}`, color: '#7a716a', flexShrink: 0 }}>{f.file}{f.line ? ':' + f.line : ''}</span>
              {f.verdict && <span style={{ font: `400 9px ${MONO}`, color: f.verdict === 'CONFIRMED' ? '#e5484d' : '#e8a06a', flexShrink: 0 }}>{f.verdict}</span>}
              {f.outcome && <span style={{ font: `600 9px ${MONO}`, color: SEVC[f.outcome] || '#8a807a', flexShrink: 0 }}>{f.outcome}</span>}
            </div>
          ))}
        </div>
      ))}
      {d && d.sessions.length === 0 && <div style={{ ...PANEL, font: `400 11px ${MONO}`, color: '#5a514a' }}>no review runs found — run /code-review or /security-review in a session and results land here</div>}
    </div>
  )
}
