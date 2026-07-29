import React, { useEffect, useState } from 'react'
import { api, fmtDate } from '../lib/api.js'
import Skeleton from '../ui/Skeleton.jsx'
import { Tabs } from '../ui/tabs.jsx'
import { modelName } from '../lib/modelName.js'

const MONO = "var(--mono)"
const HEAD = "var(--head)"
const PANEL = { background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 12, padding: '16px 18px' }
const kTok = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n || 0)))

function useScopes() {
  const [scopes, setScopes] = useState([])
  useEffect(() => { api.get('/api/harness').then(d => setScopes(d.scopes)).catch(() => {}) }, [])
  return scopes
}
const DaysPick = ({ days, setDays }) => (
  <select value={days} onChange={e => setDays(Number(e.target.value))}>
    {[7, 14, 30, 90].map(d => <option key={d} value={d}>{d} days</option>)}
  </select>
)

export default function ReliabilitySection() {
  const [tab, setTab] = useState('Failures')
  return (
    <div className="hx" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Tabs tabs={['Failures', 'Error causes', 'Traces', 'Evals', 'CI gate', 'Costs']} tab={tab} setTab={setTab} />
      {tab === 'Failures' && <Failures />}
      {tab === 'Error causes' && <ErrorCauses />}
      {tab === 'Traces' && <Traces />}
      {tab === 'Evals' && <Evals />}
      {tab === 'CI gate' && <CiGate />}
      {tab === 'Costs' && <Costs />}
    </div>
  )
}

function ErrorCauses() {
  const [days, setDays] = useState(30)
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { setD(null); api.get('/api/errors?days=' + days).then(setD).catch(e => setErr(e.message)) }, [days])
  if (err) return <div style={{ ...PANEL, color: 'var(--red)', font: `400 12px ${MONO}` }}>{err}</div>
  if (!d) return <Skeleton />
  const max = Math.max(1, ...d.groups.map(g => g.count))
  return (
    <div style={{ ...PANEL }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', marginBottom: 10 }}>
        <div style={{ font: `600 14px ${HEAD}` }}>Error causes</div>
        <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>{d.scanned} classified</span>
        <span style={{ marginLeft: 'auto' }}><DaysPick days={days} setDays={setDays} /></span>
      </div>
      {d.groups.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>no errors recorded in this window</div>}
      {d.groups.map(g => (
        <div key={g.category} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '5px 0', font: `400 11px ${MONO}` }}>
          <span style={{ width: 130, color: 'var(--text-secondary)' }}>{g.category.replace(/_/g, ' ')}</span>
          <div style={{ flex: 1, height: 6, background: 'var(--border-subtle)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${(g.count / max) * 100}%`, height: '100%', background: g.retryable ? 'var(--amber, #d79921)' : 'var(--red)' }} />
          </div>
          <span style={{ width: 46, textAlign: 'right', color: 'var(--text-secondary)' }}>{g.count}</span>
          {}
          <span style={{ width: 78, color: 'var(--text-tertiary)' }}>
            {g.retryable === true ? 'retryable' : g.retryable === false ? 'not retryable' : 'retryable?'}
          </span>
        </div>
      ))}
      <div style={{ marginTop: 10, font: `400 10px ${MONO}`, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
        {}
        {d.scope}
        {d.samplesCapped && <div>sample list capped at {d.sampleCap} — counts above are complete, examples are not</div>}
      </div>
    </div>
  )
}

function Failures() {
  const scopes = useScopes()
  const [days, setDays] = useState(30)
  const [project, setProject] = useState('')
  const [d, setD] = useState(null)
  useEffect(() => { api.get(`/api/gov/failures?days=${days}&project=${encodeURIComponent(project)}`).then(setD) }, [days, project])
  if (!d) return <div style={{ font: `400 12px ${MONO}`, color: 'var(--text-tertiary)' }}>scanning transcripts…</div>
  const maxHour = Math.max(1, ...Object.values(d.byHour))
  const maxTurns = Math.max(1, ...d.turnsDist)
  const buckets = new Array(10).fill(0)
  for (const t of d.turnsDist) buckets[Math.min(9, Math.floor(t / (maxTurns / 10 || 1)))]++
  const maxB = Math.max(1, ...buckets)
  return (
    <>
      <div style={{ display: 'flex', gap: 10 }}>
        <DaysPick days={days} setDays={setDays} />
        <select value={project} onChange={e => setProject(e.target.value)}>
          <option value="">all projects</option>
          {scopes.filter(s => s.id !== 'global').map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>
      <div className="hx-overview" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        {[['Sessions', d.sessions, 'var(--text-primary)'], ['Tool errors', Object.values(d.tools).reduce((s, t) => s + t.errors, 0), 'var(--red)'], ['Retries', d.retries, 'var(--accent-light)'], ['Compactions', d.compactions, 'var(--violet)']].map(([l, v, c]) => (
          <div key={l} style={{ ...PANEL, padding: '16px 18px' }}>
            <div style={{ font: `600 11px ${MONO}`, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>{l}</div>
            <div style={{ font: `600 20px ${HEAD}`, color: c, marginTop: 6 }}>{v}</div>
          </div>
        ))}
      </div>
      <div className="hx-2">
        <div style={{ ...PANEL }}>
          <div style={{ font: `600 14px ${HEAD}`, marginBottom: 14 }}>Tool error rates</div>
          {d.tools.map(t => (
            <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
              <span style={{ width: 190, font: `400 11px ${MONO}`, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name.replace(/^mcp__.*?__/, 'mcp:')}</span>
              <div style={{ flex: 1, height: 9, borderRadius: 5, background: 'var(--bg-surface-hover)', overflow: 'hidden', display: 'flex' }}>
                <div style={{ width: `${Math.min(100, t.rate * 100)}%`, background: t.rate > 0.15 ? 'var(--red)' : 'var(--accent-light)' }} />
              </div>
              <span style={{ width: 110, textAlign: 'right', font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>{t.errors}/{t.uses} · {(t.rate * 100).toFixed(0)}%</span>
            </div>
          ))}
          {d.tools.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>no tool activity in range</div>}
        </div>
        <div style={{ ...PANEL }}>
          <div style={{ font: `600 14px ${HEAD}`, marginBottom: 14 }}>Errors by weekday × hour</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto repeat(24, 1fr)', gap: 2, alignItems: 'center' }}>
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, di) => (
              <React.Fragment key={di}>
                <span style={{ font: `400 9px ${MONO}`, color: 'var(--text-tertiary)', paddingRight: 4 }}>{day}</span>
                {Array.from({ length: 24 }, (_, h) => {
                  const v = d.byHour[di + ':' + h] || 0
                  return <div key={h} title={`${v} errors`} style={{ aspectRatio: '1', borderRadius: 2, background: v ? `color-mix(in srgb, var(--red) ${Math.round((0.15 + 0.85 * (v / maxHour)) * 100)}%, transparent)` : 'var(--bg-surface-hover)' }} />
                })}
              </React.Fragment>
            ))}
          </div>
          <div style={{ font: `600 14px ${HEAD}`, margin: '20px 0 10px' }}>Turns per session</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 70 }}>
            {buckets.map((b, i) => (
              <div key={i} title={`${b} sessions`} style={{ flex: 1, height: `${(b / maxB) * 100}%`, minHeight: 2, borderRadius: '3px 3px 0 0', background: 'var(--blue)' }} />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', font: `400 9px ${MONO}`, color: 'var(--text-tertiary)', marginTop: 4 }}><span>1</span><span>{maxTurns} turns</span></div>
        </div>
      </div>
    </>
  )
}

function Traces() {
  const scopes = useScopes()
  const [project, setProject] = useState('')
  const [sessions, setSessions] = useState([])
  const [trace, setTrace] = useState(null)
  const [sid, setSid] = useState(null)
  useEffect(() => { if (scopes.length > 1 && !project) setProject(scopes[1].id) }, [scopes])
  useEffect(() => { if (project) api.get('/api/hub?project=' + encodeURIComponent(project)).then(d => setSessions(d.sessions)).catch(() => setSessions([])) }, [project])
  const open = id => { setSid(id); setTrace(null); api.get(`/api/gov/trace?project=${encodeURIComponent(project)}&id=${id}`).then(setTrace) }
  const KIND = { prompt: ['◈', 'var(--accent-light)'], reason: ['…', 'var(--violet)'], act: ['▸', 'var(--accent)'], observe: ['↩', 'var(--blue)'], checkpoint: ['⛃', 'var(--green)'] }
  return (
    <div className="hx-2a">
      <div style={{ ...PANEL }}>
        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          <select value={project} onChange={e => setProject(e.target.value)} style={{ flex: 1 }}>
            {scopes.filter(s => s.id !== 'global').map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        {sessions.map(s => (
          <div key={s.id} onClick={() => open(s.id)} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && open(s.id)}
            style={{ padding: '9px 10px', borderRadius: 8, cursor: 'pointer', marginBottom: 4, border: `1px solid ${sid === s.id ? 'var(--accent-bg)' : 'var(--bg-surface-hover)'}`, background: sid === s.id ? 'var(--accent-bg)' : 'var(--bg-surface)' }}>
            <div style={{ font: `500 12px ${MONO}`, color: 'var(--text-primary)' }}>{fmtDate(s.mtime)}</div>
            <div style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)' }}>{s.id.slice(0, 8)} · {(s.size / 1024).toFixed(0)} KB</div>
          </div>
        ))}
        {sessions.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>no sessions for this project</div>}
      </div>
      <div style={{ ...PANEL }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
          <div style={{ font: `600 14px ${HEAD}` }}>Trace {trace ? `· ${trace.total} steps` : ''}</div>
          {trace?.configVersion && <span style={{ font: `400 11px ${MONO}`, color: 'var(--accent-light)' }} title={trace.configVersion.file}>config: {trace.configVersion.summary} ({fmtDate(trace.configVersion.ts)})</span>}
          {trace && !trace.configVersion && <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>no tracked config version at session start</span>}
        </div>
        <div style={{ maxHeight: 520, overflowY: 'auto' }}>
          {!trace && sid && <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>parsing…</div>}
          {trace?.steps.map((s, i) => {
            const [icon, color] = KIND[s.kind] || ['·', 'var(--text-secondary)']
            return (
              <div key={i} style={{ display: 'flex', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', alignItems: 'flex-start' }}>
                <span style={{ color, width: 16, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
                <span style={{ font: `600 10px ${MONO}`, color, width: 76, flexShrink: 0 }}>{s.kind}{s.err ? ' ✕' : ''}</span>
                <span style={{ flex: 1, minWidth: 0, font: `400 11px ${MONO}`, color: s.err ? 'var(--red)' : 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name ? s.name + ' ' : ''}{s.text}</span>
                <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)', flexShrink: 0 }}>{s.tokens ? kTok(s.tokens) + ' tok · ' : ''}{s.latency != null ? (s.latency / 1000).toFixed(1) + 's' : ''}</span>
              </div>
            )
          })}
          {!sid && <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>pick a session on the left to step through prompt → act → observe</div>}
        </div>
      </div>
    </div>
  )
}

function Evals() {
  const scopes = useScopes()
  const [d, setD] = useState(null)
  const [scope, setScope] = useState('global')
  const [cmp, setCmp] = useState([])
  const load = () => api.get('/api/gov/evals').then(setD)
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t) }, [])
  if (!d) return <Skeleton tiles={4} rows={6} />
  const runs = d.runs
  const pick = id => setCmp(c => c.includes(id) ? c.filter(x => x !== id) : [...c.slice(-1), id])
  const [ra, rb] = cmp.map(id => runs.find(r => r.id === id)).filter(Boolean)
  const drop = ra && rb && (Math.max(ra.ts, rb.ts) === ra.ts ? ra.passRate - rb.passRate : rb.passRate - ra.passRate) <= -0.25
  return (
    <>
      <div className="hx-2a">
        <div style={{ ...PANEL }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
            <div style={{ font: `600 14px ${HEAD}` }}>Regression runs</div>
            <select value={scope} onChange={e => setScope(e.target.value)} style={{ marginLeft: 'auto' }}>
              {scopes.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <button className="primary" disabled={d.active.length > 0} onClick={() => api.post('/api/gov/evals/run', { scope }).then(load)}>
              {d.active.length ? `running ${d.active[0].done}/${d.active[0].total}…` : '▸ Run suite'}
            </button>
          </div>
          <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)', marginBottom: 12 }}>{d.tasks.length} fixed tasks run headless against the scope's resolved config · tick two runs to compare</div>
          {runs.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 6px', borderBottom: '1px solid var(--border-subtle)', borderRadius: 6, background: cmp.includes(r.id) ? 'var(--accent-bg)' : 'transparent' }}>
              <input type="checkbox" checked={cmp.includes(r.id)} onChange={() => pick(r.id)} style={{ width: 14 }} aria-label="compare" />
              <span style={{ font: `600 13px ${HEAD}`, color: r.passRate === 1 ? 'var(--green)' : r.passRate >= 0.5 ? 'var(--accent-light)' : 'var(--red)', width: 48 }}>{Math.round(r.passRate * 100)}%</span>
              <div style={{ flex: 1 }}>
                <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>{fmtDate(r.ts)} · {r.scope === 'global' ? 'global' : r.scope.split('/').pop()}</div>
                <div style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)' }}>{kTok(r.tokens)} tok · {r.turns} turns · ${Number(r.cost || 0).toFixed(3)}</div>
              </div>
            </div>
          ))}
          {runs.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>no runs yet</div>}
        </div>
        <div style={{ ...PANEL }}>
          <div style={{ font: `600 14px ${HEAD}`, marginBottom: 12 }}>Trend &amp; comparison</div>
          {runs.length > 1 && (
            <svg viewBox="0 0 100 34" preserveAspectRatio="none" style={{ width: '100%', height: 70, marginBottom: 14 }}>
              <polyline fill="none" strokeWidth="1.5" strokeLinejoin="round"
                points={[...runs].reverse().map((r, i, a) => `${(i / Math.max(1, a.length - 1)) * 100},${32 - r.passRate * 28}`).join(' ')}  style={{ stroke: 'var(--green)' }} />
            </svg>
          )}
          {ra && rb ? (
            <>
              {drop && <div style={{ font: `600 11px ${MONO}`, color: 'var(--red)', marginBottom: 10 }}>⚠ pass-rate drop ≥ 25 points — likely regression</div>}
              {['passRate', 'tokens', 'turns', 'cost'].map(k => {
                const [older, newer] = ra.ts <= rb.ts ? [ra, rb] : [rb, ra]
                const fmt = v => k === 'passRate' ? Math.round(v * 100) + '%' : k === 'cost' ? '$' + Number(v).toFixed(3) : kTok(v)
                return (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', font: `500 12px ${MONO}`, padding: '5px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>{k}</span>
                    <span style={{ color: 'var(--text-secondary)' }}>{fmt(older[k] || 0)} → <b style={{ color: 'var(--text-primary)' }}>{fmt(newer[k] || 0)}</b></span>
                  </div>
                )
              })}
              <div style={{ marginTop: 12, font: `600 10px ${MONO}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 6 }}>per-task (newest)</div>
              {(ra.ts > rb.ts ? ra : rb).results.map(t => (
                <div key={t.name} style={{ display: 'flex', gap: 8, font: `400 11px ${MONO}`, padding: '3px 0' }}>
                  <span style={{ color: t.pass ? 'var(--green)' : 'var(--red)' }}>{t.pass ? '✓' : '✕'}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{t.name}</span>
                  <span style={{ marginLeft: 'auto', color: 'var(--text-tertiary)' }}>{t.turns || '–'} turns · {(t.ms / 1000 || 0).toFixed(0)}s</span>
                </div>
              ))}
            </>
          ) : <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>select two runs to compare before/after a config change</div>}
        </div>
      </div>
    </>
  )
}

function CiGate() {
  const scopes = useScopes()
  const [project, setProject] = useState('')
  const [provider, setProvider] = useState('github')
  const [minPass, setMinPass] = useState(0.9)
  const [status, setStatus] = useState(null)
  const [preview, setPreview] = useState(null)
  const [runs, setRuns] = useState(null)
  useEffect(() => { if (scopes.length > 1 && !project) setProject(scopes[1].id) }, [scopes])
  const load = () => {
    if (!project) return
    api.get('/api/ci/status?project=' + encodeURIComponent(project)).then(s => { setStatus(s); if (s.workflow) { setProvider(s.workflow.provider); if (s.workflow.minPass) setMinPass(s.workflow.minPass) } }).catch(() => {})
    api.get('/api/ci/runs?project=' + encodeURIComponent(project)).then(setRuns).catch(() => {})
  }
  useEffect(() => { setPreview(null); setStatus(null); setRuns(null); load() }, [project])
  const gen = dryRun => api.post('/api/ci/generate', { project, provider, minPass, dryRun })
    .then(r => { if (dryRun) setPreview(r.files); else { setPreview(null); alert('written:\n' + r.written.join('\n') + '\n\n' + r.note); load() } })
    .catch(e => alert(e.message))
  return (
    <div className="hx-2a">
      <div style={{ ...PANEL, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ font: `600 14px ${HEAD}` }}>CI eval gating</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={project} onChange={e => setProject(e.target.value)}>
            {scopes.filter(s => s.id !== 'global').map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <select value={provider} onChange={e => { setProvider(e.target.value); setPreview(null) }}>
            <option value="github">GitHub Actions</option>
            <option value="gitlab">GitLab CI</option>
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>
            block merge below {Math.round(minPass * 100)}%
            <input type="range" min="0.5" max="1" step="0.05" value={minPass} onChange={e => { setMinPass(Number(e.target.value)); setPreview(null) }} style={{ width: 120, padding: 0 }} />
          </label>
        </div>
        {status && (
          <div style={{ font: `400 12px ${MONO}`, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
            <div>{status.workflow ? <span style={{ color: 'var(--green)' }}>✓ workflow installed ({status.workflow.provider}, gate {Math.round((status.workflow.minPass || 0) * 100)}%)</span> : <span style={{ color: 'var(--amber)' }}>no eval workflow in this repo yet</span>}</div>
            <div>{status.evalsInRepo ? '✓ .claude/harness-evals.json in repo' : '· eval tasks will be copied into the repo (CI needs them committed)'}</div>
            <div>{status.ghAvailable ? '✓ gh CLI available — run results shown here' : '· gh CLI not found — install it to see CI results inline'}</div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => gen(true)}>Preview (dry run)</button>
          <button className="primary" onClick={() => gen(false)} disabled={!preview}>{status?.workflow ? 'Update workflow' : 'Install workflow'}</button>
        </div>
        {preview && preview.map(f => (
          <details key={f.rel}>
            <summary style={{ font: `400 11px ${MONO}`, color: f.exists ? 'var(--amber)' : 'var(--green)', cursor: 'pointer' }}>{f.exists ? '⚠ overwrites' : '+ creates'} {f.rel}</summary>
            <pre style={{ margin: '6px 0 0', font: `400 10px/1.5 ${MONO}`, color: 'var(--text-secondary)', background: 'var(--bg-inset)', borderRadius: 8, padding: 10, maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{f.content}</pre>
          </details>
        ))}
        <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>runs headlessly on every PR touching .claude/ · fails the job (blocking merge) when pass rate drops under the gate · requires the ANTHROPIC_API_KEY repo secret</div>
      </div>
      <div style={{ ...PANEL }}>
        <div style={{ font: `600 14px ${HEAD}`, marginBottom: 12 }}>CI runs <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>via gh · tagged CI vs manual runs in Evals</span></div>
        {runs?.error && <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>{runs.error}</div>}
        {runs?.runs?.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
            <span style={{ font: `600 11px ${MONO}`, color: r.conclusion === 'success' ? 'var(--green)' : r.conclusion === 'failure' ? 'var(--red)' : 'var(--accent-light)', width: 70 }}>{r.conclusion || r.status}</span>
            <span className="badge project">CI</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: `400 12px ${MONO}`, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.displayTitle}</div>
              <div style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)' }}>{r.headBranch} · {fmtDate(Date.parse(r.createdAt))}</div>
            </div>
            <a href={r.url} target="_blank" rel="noreferrer" style={{ font: `400 11px ${MONO}`, color: 'var(--blue)' }}>open ↗</a>
          </div>
        ))}
        {runs && !runs.error && !runs.runs?.length && <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>no CI runs yet — they appear after the first PR touching .claude/</div>}
      </div>
    </div>
  )
}

function Costs() {
  const [days, setDays] = useState(14)
  const [d, setD] = useState(null)
  useEffect(() => { api.get('/api/gov/costs?days=' + days).then(setD) }, [days])
  if (!d) return <div style={{ font: `400 12px ${MONO}`, color: 'var(--text-tertiary)' }}>aggregating…</div>
  const dayKeys = Object.keys(d.byDay).sort()
  const maxDay = Math.max(1, ...dayKeys.map(k => d.byDay[k].usd))
  const setCap = (key, cur) => {
    const v = prompt(`${key} cap (empty to clear)`, cur ?? '')
    if (v === null) return
    api.patch('/api/harness', { scope: 'global', path: 'harness.budgets.' + key, value: v === '' ? null : Number(v) })
      .then(r => { if (r.proposed) alert('Global change proposed — approve it in Governance → Approvals'); api.get('/api/gov/costs?days=' + days).then(setD) })
  }
  return (
    <>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <DaysPick days={days} setDays={setDays} />
        <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>estimated API-equivalent cost (anthropic price ratios) — actual subscription spend may be flat</span>
      </div>
      {d.alerts.map((a, i) => (
        <div key={i} style={{ ...PANEL, borderColor: a.level === 'error' ? 'var(--red-bg)' : 'var(--accent-bg)', padding: '12px 18px', font: `500 12px ${MONO}`, color: a.level === 'error' ? 'var(--red)' : 'var(--accent-light)' }}>⚠ {a.text}</div>
      ))}
      <div className="hx-overview" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        {[['Today', '$' + d.todayUSD.toFixed(2), 'var(--accent)'], ['Today tokens', kTok(d.todayTokens), 'var(--violet)'],
          ['Daily $ cap', d.budgets.dailyUSD ? '$' + d.budgets.dailyUSD : 'none', 'var(--accent-light)', () => setCap('dailyUSD', d.budgets.dailyUSD)],
          ['Daily token cap', d.budgets.dailyTokens ? kTok(d.budgets.dailyTokens) : 'none', 'var(--blue)', () => setCap('dailyTokens', d.budgets.dailyTokens)]].map(([l, v, c, onClick]) => (
          <div key={l} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} style={{ ...PANEL, padding: '16px 18px', cursor: onClick ? 'pointer' : 'default' }} title={onClick ? 'click to set cap' : ''}>
            <div style={{ font: `600 11px ${MONO}`, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>{l}{onClick ? ' ✎' : ''}</div>
            <div style={{ font: `600 20px ${HEAD}`, color: c, marginTop: 6 }}>{v}</div>
          </div>
        ))}
      </div>
      <div className="hx-2a">
        <div style={{ ...PANEL }}>
          <div style={{ font: `600 14px ${HEAD}`, marginBottom: 14 }}>Spend per day</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 120 }}>
            {dayKeys.map(k => (
              <div key={k} title={`${k}: $${d.byDay[k].usd.toFixed(2)} · ${kTok(d.byDay[k].tok)} tok`} style={{ flex: 1, height: `${(d.byDay[k].usd / maxDay) * 100}%`, minHeight: 2, borderRadius: '3px 3px 0 0', background: 'var(--blue)' }} />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', font: `400 9px ${MONO}`, color: 'var(--text-tertiary)', marginTop: 5 }}><span>{dayKeys[0]}</span><span>{dayKeys[dayKeys.length - 1]}</span></div>
        </div>
        <div style={{ ...PANEL }}>
          <div style={{ font: `600 14px ${HEAD}`, marginBottom: 14 }}>By project &amp; model</div>
          {Object.entries(d.byProj).sort((a, b) => b[1].usd - a[1].usd).slice(0, 6).map(([p, v]) => (
            <div key={p} style={{ display: 'flex', justifyContent: 'space-between', font: `400 11px ${MONO}`, padding: '4px 0', color: 'var(--text-secondary)' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.split('-').pop()}</span>
              <span style={{ color: 'var(--text-secondary)' }}>${v.usd.toFixed(2)} · {kTok(v.tok)}</span>
            </div>
          ))}
          <div style={{ borderTop: '1px solid var(--border-default)', marginTop: 8, paddingTop: 8 }}>
            {Object.entries(d.byModel).sort((a, b) => b[1].usd - a[1].usd).map(([m, v]) => (
              <div key={m} style={{ display: 'flex', justifyContent: 'space-between', font: `400 11px ${MONO}`, padding: '4px 0', color: 'var(--violet)' }}>
                <span>{modelName(m)}</span>
                <span style={{ color: 'var(--text-secondary)' }}>${v.usd.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
