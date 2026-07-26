import React, { useEffect, useMemo, useState } from 'react'
import { api, fmtDate, toast } from '../lib/api.js'
import Skeleton from '../ui/Skeleton.jsx'

const MONO = "'IBM Plex Mono', monospace"
const HEAD = "'Space Grotesk', sans-serif"
const PANEL = { background: 'rgba(28,24,21,0.55)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: '18px 20px', backdropFilter: 'blur(10px)' }
const STAGE_C = { backlog: '#8a807a', 'in-progress': '#5eb3f6', 'code-review': '#e5a03a', fixing: '#e8a06a', 'ready-for-qa': '#c792ea', 'qa-running': '#7cc4f7', 'bug-reported': '#e5484d', 'ready-for-release': '#3fb96a', released: '#6a6f78' }
const TYPE_C = { feature: '#5eb3f6', sub: '#8a807a', bug: '#e5484d' }
const MODELS = ['haiku', 'sonnet', 'opus']
const hrs = ms => (ms / 3600_000).toFixed(1) + 'h'
const age = t => { const d = Math.floor((Date.now() - t) / 86400_000); return d === 0 ? 'today' : d + 'd' }
const lbl = s => s.replace(/-/g, ' ')

function useProjects() {
  const [scopes, setScopes] = useState([])
  useEffect(() => { api.get('/api/harness').then(d => setScopes(d.scopes.filter(s => s.id !== 'global'))).catch(() => {}) }, [])
  return scopes
}
const H2 = ({ children }) => <div style={{ font: `600 12px ${HEAD}`, marginBottom: 6 }}>{children}</div>
const Meta = ({ children, color = '#7a716a' }) => <span style={{ font: `400 10.5px ${MONO}`, color }}>{children}</span>
const ModelInput = props => (<><input list="board-models" placeholder="model (blank = default)" {...props} /><datalist id="board-models">{MODELS.map(m => <option key={m} value={m} />)}</datalist></>)

function Intake({ project, teams, onDone }) {
  const [title, setTitle] = useState(''); const [desc, setDesc] = useState(''); const [team, setTeam] = useState(''); const [model, setModel] = useState('')
  const submit = () => api.post('/api/board/tickets', { project, title, desc, team: team || null, model: model || null })
    .then(() => { setTitle(''); setDesc(''); onDone() }).catch(e => alert(e.message))
  return (
    <div style={{ ...PANEL, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ font: `600 15px ${HEAD}` }}>New ticket</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="title" style={{ flex: 1 }} />
        <select value={team} onChange={e => setTeam(e.target.value)}><option value="">no team (general agent)</option>{teams.map(t => <option key={t.id} value={t.id}>{t.name} v{t.version}</option>)}</select>
        <ModelInput value={model} onChange={e => setModel(e.target.value)} style={{ width: 160 }} />
      </div>
      <textarea rows={4} value={desc} onChange={e => setDesc(e.target.value)} placeholder="paste JIRA content — description, acceptance criteria, links. The analyze step proposes a sub-ticket breakdown from this." />
      <button className="primary" style={{ alignSelf: 'flex-start' }} onClick={submit} disabled={!title.trim()}>Create ticket</button>
    </div>
  )
}

function Card({ t, all, onOpen, selected }) {
  const kids = all.filter(x => x.parent === t.id)
  const doneKids = kids.filter(x => x.stage === 'released').length
  return (
    <div onClick={() => onOpen(t.id)} style={{
      background: selected ? 'rgba(217,119,87,0.10)' : 'rgba(0,0,0,0.25)', border: `1px solid ${t.blocked ? 'rgba(229,72,77,0.5)' : selected ? 'rgba(217,119,87,0.5)' : 'rgba(255,255,255,0.06)'}`,
      borderRadius: 10, padding: '8px 10px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{ font: `600 8.5px ${MONO}`, color: TYPE_C[t.type] || '#8a807a' }}>{(t.type || 'feature').toUpperCase()}</span>
        {t.running && <span style={{ font: `600 8.5px ${MONO}`, color: '#5eb3f6' }}>◐ {t.running.kind}</span>}
        {t.blocked && <span style={{ font: `600 8.5px ${MONO}`, color: '#e5484d' }}>⛔ blocked</span>}
        {!t.running && !t.blocked && ['code-review', 'ready-for-qa', 'ready-for-release'].includes(t.stage) && <span style={{ font: `600 8.5px ${MONO}`, color: '#e5a03a' }}>⏸ your click</span>}
        {t.conflictRisk?.length > 0 && <span title={t.conflictRisk.map(c => c.title + ': ' + c.files.join(', ')).join('\n')} style={{ font: `600 8.5px ${MONO}`, color: '#e8a06a' }}>⚠ overlap</span>}
        {t.depBlocked?.length > 0 && <span style={{ font: `600 8.5px ${MONO}`, color: '#8a807a' }}>🔒 deps</span>}
      </div>
      <div style={{ font: "500 12px 'IBM Plex Sans'", color: '#e5dbd2' }}>{t.title}</div>
      <Meta>{t.model || 'default'}{t.team ? ' · team' : ''}{kids.length ? ` · ${doneKids}/${kids.length} subs` : ''} · {age(t.createdAt)}</Meta>
    </div>
  )
}

function QaForm({ t, onRun }) {
  const [q, setQ] = useState({ baseUrl: t.qa?.baseUrl || t.preview?.url || '', env: t.qa?.env || 'staging', scope: t.qa?.scope || '', notes: t.qa?.notes || '' })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <H2>QA inputs</H2>
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={q.baseUrl} onChange={e => setQ({ ...q, baseUrl: e.target.value })} placeholder="base URL (auto-filled from preview env)" style={{ flex: 2 }} />
        <select value={q.env} onChange={e => setQ({ ...q, env: e.target.value })}><option>staging</option><option>preview</option><option>prod</option></select>
        <input value={q.scope} onChange={e => setQ({ ...q, scope: e.target.value })} placeholder="pages / flows in scope" style={{ flex: 1.5 }} />
      </div>
      <input value={q.notes} onChange={e => setQ({ ...q, notes: e.target.value })} placeholder="login / test-account notes, anything else" />
      <button className="primary" style={{ alignSelf: 'flex-start' }} onClick={() => onRun(q)}>▶ Run QA</button>
    </div>
  )
}

function Detail({ t, all, teams, onRefresh, onClose }) {
  const [reply, setReply] = useState('')
  const [escModel, setEscModel] = useState('')
  const [subs, setSubs] = useState(null)
  const call = (m, url, body) => api[m](url, body).then(onRefresh).catch(e => alert(e.message))
  const act = (action, body) => call('post', `/api/board/tickets/${t.id}/${action}`, body || {})
  const patch = body => call('patch', '/api/board/tickets/' + t.id, body)
  const kids = all.filter(x => x.parent === t.id)
  const lastQa = t.qaResults?.slice(-1)[0]
  const proposal = subs ?? t.proposal
  return (
    <div style={{ ...PANEL, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ font: `600 9px ${MONO}`, color: TYPE_C[t.type] || '#8a807a' }}>{(t.type || 'feature').toUpperCase()}</span>
        <span style={{ font: `600 15px ${HEAD}`, flex: 1 }}>{t.title}</span>
        <Meta color={STAGE_C[t.stage] || '#8a807a'}>● {lbl(t.stage)}</Meta>
        {t.branch && <Meta>{t.branch}{t.basedOn && t.basedOn !== 'main' ? ` (stacked on ${t.basedOn})` : ''}</Meta>}
        <Meta>{t.pipelineVersion}</Meta>
        <button className="mini" style={{ marginTop: 0 }} onClick={onClose}>✕</button>
      </div>
      {t.desc && <pre style={{ margin: 0, font: `400 11px/1.5 ${MONO}`, color: '#b0a69e', whiteSpace: 'pre-wrap', maxHeight: 140, overflow: 'auto' }}>{t.desc}</pre>}

      {t.blocked && (
        <div style={{ background: 'rgba(229,72,77,0.06)', border: '1px solid rgba(229,72,77,0.25)', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ font: `600 12px ${MONO}`, color: '#e5484d' }}>⛔ blocked by {t.blocked.by} ({t.blocked.category}) · {fmtDate(t.blocked.at)}</div>
          <pre style={{ margin: 0, font: `400 10.5px/1.5 ${MONO}`, color: '#b0a69e', whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto' }}>{t.blocked.needed || t.blocked.reason}</pre>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={reply} onChange={e => setReply(e.target.value)} placeholder="answer the question / provide the missing decision — resumes the agent with this injected" style={{ flex: 1 }} />
            <button className="primary" onClick={() => act('unblock', { reply })} disabled={!reply.trim()}>↩ reply & resume</button>
            <button onClick={() => patch({ blocked: null })} title="take over manually — restores the stage so you can re-run triggers yourself">clear block</button>
          </div>
        </div>
      )}

      {proposal?.length > 0 && (
        <div style={{ background: 'rgba(94,179,246,0.05)', border: '1px solid rgba(94,179,246,0.2)', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <H2>Proposed sub-ticket breakdown — edit, then accept</H2>
          {proposal.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 6 }}>
              <input value={s.title} onChange={e => setSubs(proposal.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} style={{ flex: 1 }} />
              <input value={s.desc || ''} onChange={e => setSubs(proposal.map((x, j) => j === i ? { ...x, desc: e.target.value } : x))} style={{ flex: 2 }} />
              <Meta>{s.deps?.length ? 'after #' + s.deps.map(d => d + 1).join(',#') : ''}</Meta>
              <button className="mini" style={{ marginTop: 0 }} onClick={() => setSubs(proposal.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="primary" onClick={() => act('breakdown', { subs: proposal })}>✓ accept — create {proposal.length} sub-tickets</button>
            <button className="mini" style={{ marginTop: 0 }} onClick={() => setSubs(proposal.concat({ title: '', desc: '', deps: [] }))}>+ add</button>
            <button className="mini" style={{ marginTop: 0 }} onClick={() => { setSubs(null); patch({}) }}>dismiss</button>
          </div>
        </div>
      )}

      {t.running ? <Meta color="#5eb3f6">◐ {t.running.kind} agent running since {fmtDate(t.running.startedAt)} — watch live in Reliability → Traces once the session appears</Meta> : !t.blocked && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {t.stage === 'backlog' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="primary" onClick={() => act('start', escModel ? { model: escModel } : {})} disabled={t.depBlocked?.length > 0} title={t.depBlocked?.length ? 'blocked by unfinished dependencies' : 'creates an isolated worktree branch and starts the dev agent'}>▸ Start dev agent</button>
              <button onClick={() => act('analyze')} title="agent proposes an independently-workable sub-ticket breakdown">✂ Analyze into sub-tickets</button>
              <ModelInput value={escModel} onChange={e => setEscModel(e.target.value)} style={{ width: 150 }} />
            </div>
          )}
          {t.stage === 'code-review' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="primary" onClick={() => act('review')}>▶ Run code review</button>
              {t.findings?.some(f => ['critical', 'high'].includes(f.severity)) && <button onClick={() => act('fix')} title="dev agent auto-fixes the findings, then you re-run review — capped at 3 loops">⚒ Auto-fix findings</button>}
            </div>
          )}
          {t.stage === 'ready-for-qa' && <QaForm t={t} onRun={q => act('qa', q)} />}
          {t.stage === 'ready-for-release' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="primary" onClick={() => api.post(`/api/board/tickets/${t.id}/release`).then(r => { if (r.prCmd) { navigator.clipboard.writeText(r.prCmd); alert('PR flow — gh pr create command copied') } onRefresh() }).catch(e => alert(e.message))}>🚀 Release</button>
              <Meta>human gate — merges {t.branch} via the project's merge queue (or copies a PR command if require-PR is on)</Meta>
            </div>
          )}
        </div>
      )}

      {t.preview?.url && <Meta color="#3fb96a">⬢ preview: <a href={t.preview.url} target="_blank" rel="noreferrer" style={{ color: '#3fb96a' }}>{t.preview.url}</a> <button className="mini" style={{ marginTop: 0, marginLeft: 8 }} onClick={() => call('del', `/api/board/tickets/${t.id}/preview`)}>stop</button></Meta>}

      {t.findings?.length > 0 && (
        <div>
          <H2>Review findings ({t.findings.length})</H2>
          {t.findings.map((f, i) => (
            <div key={i} style={{ font: `400 11px ${MONO}`, padding: '2px 0' }}>
              <span style={{ color: ['critical', 'high'].includes(f.severity) ? '#e5484d' : '#e5a03a' }}>[{f.severity}]</span>{' '}
              <span style={{ color: '#e8a06a' }}>{f.file}</span> <span style={{ color: '#b0a69e' }}>{f.summary}</span>
            </div>
          ))}
        </div>
      )}

      {lastQa && (
        <div>
          <H2>QA run {fmtDate(lastQa.at)} — {lastQa.pass ? <span style={{ color: '#3fb96a' }}>all {lastQa.cases.length} passed</span> : <span style={{ color: '#e5484d' }}>{lastQa.cases.filter(c => c.pass === false).length}/{lastQa.cases.length} failed → bugs auto-filed</span>}</H2>
          {lastQa.cases.map((c, i) => (
            <div key={i} style={{ font: `400 11px ${MONO}`, padding: '2px 0', color: '#b0a69e' }}>
              {c.pass === false ? '✗' : c.kind === 'manual' ? '◻' : '✓'} <span style={{ color: c.pass === false ? '#e5484d' : '#e5dbd2' }}>{c.name}</span> <span style={{ color: '#7a716a' }}>({c.kind})</span>{c.evidence ? <span style={{ color: '#7a716a' }}> — {String(c.evidence).slice(0, 120)}</span> : ''}
            </div>
          ))}
          <Meta>saved as this ticket's regression pack — future QA runs on related tickets can reuse it</Meta>
        </div>
      )}

      {kids.length > 0 && <div><H2>Sub-tickets</H2>{kids.map(k => <div key={k.id} style={{ font: `400 11px ${MONO}`, padding: '2px 0' }}><span style={{ color: STAGE_C[k.stage] }}>●</span> <span style={{ color: '#e5dbd2' }}>{k.title}</span> <Meta>{lbl(k.stage)}{k.deps?.length ? ' · after ' + k.deps.length + ' dep(s)' : ''}</Meta></div>)}</div>}

      {t.runs?.length > 0 && (
        <details>
          <summary style={{ font: `400 11px ${MONO}`, color: '#7a716a', cursor: 'pointer' }}>{t.runs.length} agent runs · ${t.runs.reduce((s, r) => s + (r.cost || 0), 0).toFixed(2)} · every run audited with its context handoff</summary>
          {t.runs.map((r, i) => (
            <div key={i} style={{ margin: '8px 0', padding: '8px 10px', background: 'rgba(0,0,0,0.25)', borderRadius: 8 }}>
              <div style={{ font: `600 11px ${MONO}`, color: r.status === 'ok' ? '#3fb96a' : '#e5484d' }}>{r.kind} · {r.model} · {r.status} · ${(r.cost || 0).toFixed(3)} · {r.turns} turns · {Math.round((r.ms || 0) / 1000)}s {r.sessionId ? '· ' + r.sessionId.slice(0, 8) : ''} · {fmtDate(r.at)}</div>
              {r.handoff && <Meta>passed: {r.handoff.passed.join(', ')} — excluded: {r.handoff.excluded.join(', ') || 'nothing'}</Meta>}
              <pre style={{ margin: '4px 0 0', font: `400 10px/1.5 ${MONO}`, color: '#8a807a', whiteSpace: 'pre-wrap', maxHeight: 110, overflow: 'auto' }}>{r.summary}</pre>
            </div>
          ))}
        </details>
      )}

      <details>
        <summary style={{ font: `400 11px ${MONO}`, color: '#7a716a', cursor: 'pointer' }}>timeline · admin</summary>
        {(t.history || []).map((h, i) => <div key={i} style={{ font: `400 10.5px ${MONO}`, color: h.to.startsWith('blocked') ? '#e5484d' : '#8a807a', padding: '1px 0' }}>{fmtDate(h.at)} — {h.from || '·'} → {h.to}{h.note ? ' · ' + h.note : ''}</div>)}
        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
          <select value={t.stage} onChange={e => patch({ stage: e.target.value })} title="manual move">{(t.stages || []).map(s => <option key={s}>{s}</option>)}</select>
          <select value={t.team || ''} onChange={e => patch({ team: e.target.value || null })}><option value="">no team</option>{teams.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          <ModelInput value={t.model || ''} onChange={e => patch({ model: e.target.value || null })} style={{ width: 140 }} title="escalate mid-flight — next run uses this model, state kept" />
          <button className="mini danger" style={{ marginTop: 0, marginLeft: 'auto' }} onClick={() => confirm('Delete ticket (removes its worktree)?') && call('del', '/api/board/tickets/' + t.id)}>delete</button>
        </div>
      </details>
    </div>
  )
}

function Analytics({ project }) {
  const [days, setDays] = useState(30)
  const [a, setA] = useState(null)
  useEffect(() => { api.get(`/api/board/analytics?days=${days}${project ? '&project=' + encodeURIComponent(project) : ''}`).then(setA).catch(() => {}) }, [project, days])
  if (!a) return <Skeleton tiles={5} rows={5} />
  const kpi = (label, val, sub) => (
    <div style={{ ...PANEL, padding: '14px 18px', flex: 1, minWidth: 150 }}>
      <div style={{ font: `400 10px ${MONO}`, color: '#7a716a', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ font: `600 24px ${HEAD}`, color: '#e5dbd2', margin: '4px 0' }}>{val ?? '—'}</div>
      {sub && <Meta>{sub}</Meta>}
    </div>
  )
  const bars = (obj, unit, color) => {
    const entries = Object.entries(obj).filter(([, v]) => (v.avg ?? v) > 0)
    const max = Math.max(...entries.map(([, v]) => v.avg ?? v), 0.01)
    return entries.map(([k, v]) => (
      <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
        <Meta>{lbl(k).padEnd(2)}</Meta>
        <div style={{ flex: 1, height: 8, background: 'rgba(255,255,255,0.04)', borderRadius: 4 }}>
          <div style={{ width: Math.max(2, ((v.avg ?? v) / max) * 100) + '%', height: '100%', background: color || '#d97757', borderRadius: 4 }} />
        </div>
        <Meta color="#b0a69e">{(v.avg ?? v)}{unit}{v.p90 != null ? ` · p90 ${v.p90}${unit}` : ''}{v.n ? ` · n=${v.n}` : ''}</Meta>
      </div>
    ))
  }
  const table = (title, data) => Object.keys(data).length > 0 && (
    <div style={{ ...PANEL }}>
      <H2>{title}</H2>
      <table style={{ width: '100%', font: `400 11px ${MONO}`, color: '#b0a69e', borderSpacing: 0 }}>
        <thead><tr style={{ color: '#7a716a', textAlign: 'left' }}><th>who</th><th>released</th><th>avg cycle</th><th>bug ratio</th><th>findings</th><th>escalations</th><th>touches</th><th>cost</th></tr></thead>
        <tbody>{Object.entries(data).map(([k, o]) => (
          <tr key={k}><td style={{ color: '#e5dbd2', padding: '3px 8px 3px 0' }}>{k}</td><td>{o.released}</td><td>{o.avgCycleH ?? '—'}h</td>
            <td style={{ color: o.bugRatio > 1 ? '#e5484d' : undefined }}>{o.bugRatio ?? '—'}</td><td>{o.findings}</td><td>{o.escalations}</td><td>{o.touches}</td><td>${o.cost.toFixed(2)}</td></tr>
        ))}</tbody>
      </table>
    </div>
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8 }}>{[7, 30, 90].map(d => <button key={d} className={days === d ? 'primary' : ''} onClick={() => setDays(d)}>{d}d</button>)}</div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {kpi('released', a.cycle.released, `${a.total} tickets in window`)}
        {kpi('cycle p50 / p90', a.cycle.p50h != null ? `${a.cycle.p50h}h` : null, a.cycle.p90h != null ? `p90 ${a.cycle.p90h}h` : 'backlog → released')}
        {kpi('bug ratio', a.bugRatio, 'QA bugs ÷ released')}
        {kpi('cost / released', a.costPerReleased != null ? '$' + a.costPerReleased.toFixed(2) : null, `$${a.costSunkUnreleased.toFixed(2)} sunk in unreleased`)}
        {kpi('blocked now', a.blockedNow.length, a.blockedNow[0] ? a.blockedNow[0].title.slice(0, 26) : 'nothing stuck')}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ ...PANEL }}><H2>Live funnel — tickets per column</H2>{bars(a.columns, '', '#5eb3f6')}</div>
        <div style={{ ...PANEL }}><H2>Avg time-in-column</H2>{bars(a.timeInStageH, 'h')}</div>
        <div style={{ ...PANEL }}><H2>Blocked time by reason</H2>{Object.keys(a.blockedByReasonH).length ? bars(a.blockedByReasonH, 'h', '#e5484d') : <Meta>none recorded</Meta>}<Meta>recurring reasons are a project-config smell — fix at the source</Meta></div>
        <div style={{ ...PANEL }}><H2>QA cycles per released ticket</H2>{bars(a.qaCyclesDist, '', '#c792ea')}<Meta>0 = shipped bug-free on first QA pass · {a.staleRegressionCases} regression case(s) never failed in ≥2 runs (possibly stale)</Meta></div>
      </div>
      {table('By team', a.byTeam)}
      {table('By model', a.byModel)}
      <div style={{ ...PANEL }}>
        <H2>Cost by stage</H2>
        <Meta color="#b0a69e">dev ${a.costByStage.dev.toFixed(2)} · review ${a.costByStage.review.toFixed(2)} · QA ${a.costByStage.qa.toFixed(2)}</Meta>
        {Object.keys(a.throughputPerDay).length > 0 && <div style={{ marginTop: 10 }}><H2>Throughput — released per day</H2>{bars(a.throughputPerDay, '', '#3fb96a')}</div>}
      </div>
    </div>
  )
}

function Setup({ project, board, onRefresh }) {
  const [cfg, setCfg] = useState(board.config || {})
  const [team, setTeam] = useState(null)
  const [pipe, setPipe] = useState(null)
  useEffect(() => setCfg(board.config || {}), [board.config])
  const saveCfg = () => api.post('/api/board/config', { project, ...cfg, previewIdleMin: Number(cfg.previewIdleMin) || 240 }).then(onRefresh).catch(e => alert(e.message))
  const F = ({ label, k, w, ph }) => ( // plain function, not <Component> — keeps input focus across re-renders
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, width: w || 160 }}>
      <Meta>{label}</Meta>
      <input value={cfg[k] ?? ''} onChange={e => setCfg({ ...cfg, [k]: e.target.value })} placeholder={ph} />
    </label>
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ ...PANEL, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ font: `600 15px ${HEAD}` }}>Project pipeline & branches — {project.split('/').pop()}</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}><Meta>pipeline template</Meta>
            <select value={cfg.pipeline || 'default'} onChange={e => setCfg({ ...cfg, pipeline: e.target.value })}>{board.pipelines.map(p => <option key={p.id} value={p.id}>{p.name} v{p.version} ({p.stages.length} stages)</option>)}</select>
          </label>
          {F({ label: 'base branch', k: 'base', ph: 'main', w: 110 })}
          {F({ label: 'branch prefix', k: 'branchPrefix', ph: 'ticket/', w: 110 })}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}><Meta>merge method</Meta>
            <select value={cfg.mergeMethod || 'merge'} onChange={e => setCfg({ ...cfg, mergeMethod: e.target.value })}><option value="merge">merge commit</option><option value="squash">squash</option><option value="rebase">rebase (ff-only)</option></select>
          </label>
          {F({ label: 'default model', k: 'defaultModel', ph: 'sonnet', w: 110 })}
          <label style={{ font: `400 11px ${MONO}`, color: '#b0a69e', display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={!!cfg.requirePr} onChange={e => setCfg({ ...cfg, requirePr: e.target.checked })} />release via human-approved PR (never auto-merge)</label>
          <label style={{ font: `400 11px ${MONO}`, color: '#b0a69e', display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={!!cfg.qaSeesFindings} onChange={e => setCfg({ ...cfg, qaSeesFindings: e.target.checked })} title="context handoff opt-in: by default QA tests behavior unbiased by implementation detail" />QA sees review findings</label>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {F({ label: 'preview env command (plug-in point: docker compose / vercel / your CI script — $BRANCH $TICKET $WORKTREE env vars; first URL printed becomes the QA base URL)', k: 'previewCmd', ph: 'docker compose -p $TICKET up', w: 520 })}
          {F({ label: 'stop command (optional)', k: 'previewStopCmd', ph: 'docker compose -p $TICKET down', w: 240 })}
          {F({ label: 'idle teardown (min)', k: 'previewIdleMin', ph: '240', w: 110 })}
        </div>
        <button className="primary" style={{ alignSelf: 'flex-start' }} onClick={saveCfg}>Save project config</button>
        <Meta>in-flight tickets keep the pipeline version they started on — changing the template never breaks them</Meta>
      </div>

      <div style={{ ...PANEL, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ font: `600 15px ${HEAD}` }}>Agent teams <Meta>· which agent/model handles which stage; versioned like profiles</Meta></div>
        {board.teams.map(x => (
          <div key={x.id} style={{ display: 'flex', gap: 10, alignItems: 'center', font: `400 11px ${MONO}`, color: '#b0a69e' }}>
            <span style={{ color: '#e5dbd2', width: 140 }}>{x.name} v{x.version}</span>
            {['dev', 'review', 'qa'].map(s => <span key={s}>{s}: {x.stages?.[s]?.model || 'default'}</span>)}
            <button className="mini" style={{ marginTop: 0, marginLeft: 'auto' }} onClick={() => setTeam(x)}>edit</button>
            <button className="mini danger" style={{ marginTop: 0 }} onClick={() => api.del('/api/board/teams/' + x.id).then(onRefresh)}>✕</button>
          </div>
        ))}
        {team ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: 'rgba(0,0,0,0.25)', borderRadius: 10, padding: 10 }}>
            <input value={team.name || ''} onChange={e => setTeam({ ...team, name: e.target.value })} placeholder="team name" style={{ width: 220 }} />
            {['dev', 'review', 'qa'].map(s => (
              <div key={s} style={{ display: 'flex', gap: 6 }}>
                <Meta>{s.padEnd(6)}</Meta>
                <ModelInput value={team.stages?.[s]?.model || ''} onChange={e => setTeam({ ...team, stages: { ...team.stages, [s]: { ...team.stages?.[s], model: e.target.value } } })} style={{ width: 120 }} />
                <input value={team.stages?.[s]?.instructions || ''} onChange={e => setTeam({ ...team, stages: { ...team.stages, [s]: { ...team.stages?.[s], instructions: e.target.value } } })} placeholder={`stage-specific instructions / skills / MCP notes for the ${s} agent`} style={{ flex: 1 }} />
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="primary" onClick={() => api.post('/api/board/teams', team).then(() => { setTeam(null); onRefresh() }).catch(e => alert(e.message))} disabled={!team.name?.trim()}>save team</button>
              <button onClick={() => setTeam(null)}>cancel</button>
            </div>
          </div>
        ) : <button className="mini" style={{ alignSelf: 'flex-start' }} onClick={() => setTeam({ name: '', stages: {} })}>+ new team</button>}
      </div>

      <div style={{ ...PANEL, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ font: `600 15px ${HEAD}` }}>Pipeline templates <Meta>· stages are ordered building blocks — skip review for low-stakes projects, insert custom sign-off columns</Meta></div>
        {board.pipelines.map(p => (
          <div key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'center', font: `400 11px ${MONO}`, color: '#b0a69e' }}>
            <span style={{ color: '#e5dbd2', width: 160 }}>{p.name} v{p.version}</span>
            <span style={{ flex: 1 }}>{p.stages.join(' → ')}</span>
            {Object.keys(p.wip || {}).length > 0 && <Meta>WIP: {Object.entries(p.wip).map(([k, v]) => `${k}=${v}`).join(' ')}</Meta>}
            <button className="mini" style={{ marginTop: 0 }} onClick={() => setPipe({ ...p, stagesText: p.stages.join(', '), wipText: Object.entries(p.wip || {}).map(([k, v]) => `${k}=${v}`).join(', ') })}>edit</button>
          </div>
        ))}
        {pipe ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: 'rgba(0,0,0,0.25)', borderRadius: 10, padding: 10 }}>
            <input value={pipe.name} onChange={e => setPipe({ ...pipe, name: e.target.value })} placeholder="template name" style={{ width: 220 }} />
            <input value={pipe.stagesText} onChange={e => setPipe({ ...pipe, stagesText: e.target.value })} placeholder="stages, comma-separated, in order — e.g. backlog, in-progress, design-signoff, ready-for-release, released" />
            <input value={pipe.wipText} onChange={e => setPipe({ ...pipe, wipText: e.target.value })} placeholder="WIP limits — e.g. in-progress=3, qa-running=2 (caps concurrent cost & preview envs)" />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="primary" onClick={() => api.post('/api/board/pipelines', {
                id: pipe.id, name: pipe.name,
                stages: pipe.stagesText.split(',').map(s => s.trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean),
                wip: Object.fromEntries(pipe.wipText.split(',').map(s => s.split('=').map(x => x.trim())).filter(([k, v]) => k && Number(v)).map(([k, v]) => [k, Number(v)])),
              }).then(() => { setPipe(null); onRefresh() }).catch(e => alert(e.message))} disabled={!pipe.name?.trim()}>save template</button>
              <button onClick={() => setPipe(null)}>cancel</button>
            </div>
          </div>
        ) : <button className="mini" style={{ alignSelf: 'flex-start' }} onClick={() => setPipe({ name: '', stagesText: DEFAULTS_TXT, wipText: '' })}>+ new template</button>}
      </div>
    </div>
  )
}
const DEFAULTS_TXT = 'backlog, in-progress, code-review, fixing, ready-for-qa, qa-running, bug-reported, ready-for-release, released'

export default function BoardSection() {
  const projects = useProjects()
  const [project, setProject] = useState('')
  const [tab, setTab] = useState('board')
  const [board, setBoard] = useState(null)
  const [open, setOpen] = useState(null)
  const [fAttention, setFAttention] = useState(false)
  const [dragOver, setDragOver] = useState(null)
  const load = () => project && api.get('/api/board?project=' + encodeURIComponent(project)).then(setBoard).catch(() => {})
  const move = (id, stage) => { const t = board?.tickets.find(x => x.id === id); if (t && t.stage !== stage) api.patch('/api/board/tickets/' + id, { stage }).then(load).catch(e => toast(e.message, 'error')) }
  useEffect(() => { setBoard(null); setOpen(null); load(); const t = setInterval(() => { if (!document.hidden) load() }, 5000); return () => clearInterval(t) }, [project]) // pause while tab hidden
  useEffect(() => { if (!project && projects.length) setProject(projects[0].id) }, [projects])

  const stages = useMemo(() => {
    if (!board) return []
    const pipe = board.pipelines.find(p => p.id === (board.config?.pipeline || 'default')) || board.pipelines[0]
    const extra = [...new Set(board.tickets.map(t => t.stage))].filter(s => !pipe.stages.includes(s)) // in-flight tickets on an older template still show
    return [...pipe.stages, ...extra]
  }, [board])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <select value={project} onChange={e => setProject(e.target.value)}>{!projects.length && <option value="">no projects</option>}{projects.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
        {['board', 'analytics', 'setup'].map(x => <button key={x} className={tab === x ? 'primary' : ''} onClick={() => setTab(x)}>{x}</button>)}
        {tab === 'board' && board && (
          <label style={{ font: `400 11px ${MONO}`, color: '#e5a03a', display: 'flex', gap: 5, alignItems: 'center', marginLeft: 'auto' }}>
            <input type="checkbox" checked={fAttention} onChange={e => setFAttention(e.target.checked)} />
            attention only ({board.tickets.filter(t => t.blocked || (!t.running && ['code-review', 'ready-for-qa', 'ready-for-release'].includes(t.stage))).length})
          </label>
        )}
      </div>
      {!project ? <div style={{ ...PANEL, font: `400 12px ${MONO}`, color: '#7a716a' }}>open a project in Claude Code first — the board is scoped per project</div>
        : !board ? <Skeleton tiles={0} rows={6} />
        : tab === 'analytics' ? <Analytics project={project} />
        : tab === 'setup' ? <Setup project={project} board={board} onRefresh={load} />
        : (
        <>
          <Intake project={project} teams={board.teams} onDone={load} />
          {open && board.tickets.find(t => t.id === open) && <Detail t={board.tickets.find(t => t.id === open)} all={board.tickets} teams={board.teams} onRefresh={load} onClose={() => setOpen(null)} />}
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', alignItems: 'flex-start', paddingBottom: 6 }}>
            {stages.map(s => {
              const col = board.tickets.filter(t => t.stage === s && (!fAttention || t.blocked || (!t.running && ['code-review', 'ready-for-qa', 'ready-for-release'].includes(t.stage))))
              return (
                <div key={s}
                  onDragOver={e => { e.preventDefault(); if (dragOver !== s) setDragOver(s) }}
                  onDragLeave={() => setDragOver(o => (o === s ? null : o))}
                  onDrop={e => { e.preventDefault(); setDragOver(null); const id = e.dataTransfer.getData('text/plain'); if (id) move(id, s) }}
                  style={{ minWidth: 200, flex: '1 0 200px', display: 'flex', flexDirection: 'column', gap: 8, borderRadius: 10, outline: dragOver === s ? '1px dashed rgba(124,196,247,0.6)' : 'none', outlineOffset: 4 }}>
                  <div style={{ font: `600 10px ${MONO}`, color: STAGE_C[s] || '#c792ea', textTransform: 'uppercase', letterSpacing: 0.5 }}>{lbl(s)} <span style={{ color: '#7a716a' }}>{col.length}</span></div>
                  {col.map(t => (
                    <div key={t.id} draggable onDragStart={e => e.dataTransfer.setData('text/plain', t.id)} style={{ cursor: 'grab' }}>
                      <Card t={t} all={board.tickets} onOpen={id => setOpen(id === open ? null : id)} selected={open === t.id} />
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
          <p className="small">board lives in ~/.claude/taskboard.json (every write versioned) · dev agents run headless claude in isolated git worktrees under ~/.claude/board-worktrees · review & QA are always manual triggers · release is a human gate with a per-repo merge queue · blocked ≠ idle: blocked cards surface in Inbox as errors, idle-waiting as info</p>
        </>
      )}
    </div>
  )
}
