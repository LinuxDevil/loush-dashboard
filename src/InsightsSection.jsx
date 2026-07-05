import React, { useEffect, useState } from 'react'
import { api, fmtDate } from './api.js'
import { Tabs } from './GovernanceSection.jsx'

const MONO = "'IBM Plex Mono', monospace"
const HEAD = "'Space Grotesk', sans-serif"
const PANEL = { background: 'rgba(28,24,21,0.55)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: '18px 20px', backdropFilter: 'blur(10px)' }
const A = '#d97757'
const fmtTok = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n)))
const pct = x => Math.round((x || 0) * 100) + '%'
const fmtDur = ms => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m` : m + 'm' }
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function useFilters() {
  const [scopes, setScopes] = useState([])
  const [project, setProject] = useState('')
  const [days, setDays] = useState(30)
  useEffect(() => { api.get('/api/harness').then(d => setScopes(d.scopes)).catch(() => {}) }, [])
  const controls = (
    <>
      <select value={project} onChange={e => setProject(e.target.value)}>
        <option value="">all projects</option>
        {scopes.filter(s => s.id !== 'global').map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <select value={days} onChange={e => setDays(Number(e.target.value))}>
        {[7, 30, 90, 365].map(d => <option key={d} value={d}>{d}d</option>)}
      </select>
    </>
  )
  return { project, days, controls }
}

export default function InsightsSection() {
  const [tab, setTab] = useState('Stats')
  return (
    <div className="hx" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Tabs tabs={['Stats', 'Duplicate prompts']} tab={tab} setTab={setTab} />
      {tab === 'Stats' && <Stats />}
      {tab === 'Duplicate prompts' && <Dupes />}
    </div>
  )
}

function Kpi({ label, value, sub, color = '#f6efe9' }) {
  return (
    <div style={{ ...PANEL, padding: '15px 17px' }}>
      <div style={{ font: `600 10.5px ${MONO}`, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8a807a' }}>{label}</div>
      <div style={{ marginTop: 7, font: `600 24px ${HEAD}`, color }}>{value}</div>
      <div style={{ marginTop: 2, font: `400 10.5px ${MONO}`, color: '#7a716a' }}>{sub}</div>
    </div>
  )
}

const Bars = ({ data, fmt = fmtTok }) => {
  const max = Math.max(...data.map(d => d.value), 1e-9)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {data.map(d => (
        <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 11, font: `500 11px ${MONO}` }}>
          <span style={{ width: 130, textAlign: 'right', color: '#c8bdb4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
          <div style={{ flex: 1, height: 9, borderRadius: 6, background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: (d.value / max) * 100 + '%', borderRadius: 6, background: `linear-gradient(90deg,${d.color || A},${d.color || A}bb)`, transformOrigin: 'left', animation: 'grow .7s cubic-bezier(.2,.8,.2,1) both' }} />
          </div>
          <span style={{ width: 58, textAlign: 'right', color: '#8a807a' }}>{fmt(d.value)}</span>
        </div>
      ))}
      {data.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: '#5a514a' }}>no data in range</div>}
    </div>
  )
}

function Stats() {
  const { project, days, controls } = useFilters()
  const [s, setS] = useState(null)
  useEffect(() => {
    setS(null)
    api.get(`/api/chatstats?days=${days}&project=${encodeURIComponent(project)}`).then(setS).catch(() => {})
  }, [project, days])
  if (!s) return <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>computing from transcripts…</div>
  const heatMax = Math.max(...s.heat.flat(), 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>{controls}<span style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>computed live from session transcripts — nothing stored</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12 }}>
        <Kpi label="Chats" value={s.chats} sub={`${s.activeDays} active days`} color={A} />
        <Kpi label="Messages" value={fmtTok(s.msgs)} sub={`${s.avgMsgs.toFixed(1)} avg / chat`} color="#e8a06a" />
        <Kpi label="Avg session" value={fmtDur(s.avgSessionMs)} sub={`${s.toolsPerChat.toFixed(0)} tool calls / chat`} color="#5eb3f6" />
        <Kpi label="One-shot rate" value={pct(s.oneShotRate)} sub="resolved in a single prompt" color="#3fb96a" />
        <Kpi label="Cost" value={'$' + s.cost.toFixed(2)} sub={`$${s.costPerChat.toFixed(2)} / chat`} color="#8b7cf6" />
        <Kpi label="Tokens" value={fmtTok(s.tokOut)} sub={`out · ${fmtTok(s.tokIn)} in+cache`} color="#f0b455" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12 }}>
        <Kpi label="Prompt reuse" value={pct(s.reuseRate)} sub={`${s.dupClusters} duplicate clusters`} color={s.dupClusters > 5 ? '#e5a03a' : '#3fb96a'} />
        <Kpi label="Correction rate" value={pct(s.repromptRate)} sub="immediate rephrasing — friction" color={s.repromptRate > 0.1 ? '#e5484d' : '#3fb96a'} />
        <Kpi label="Abandonment" value={pct(s.abandonRate)} sub="one prompt, nothing ran" color={s.abandonRate > 0.15 ? '#e5a03a' : '#3fb96a'} />
      </div>
      <div className="hx-2a">
        <div style={{ ...PANEL }}>
          <div style={{ font: `600 15px ${HEAD}`, marginBottom: 12 }}>Activity heatmap <span style={{ font: `400 11px ${MONO}`, color: '#8a807a' }}>prompts by day × hour</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: '34px repeat(24, 1fr)', gap: 3 }}>
            {s.heat.map((row, d) => (
              <React.Fragment key={d}>
                <span style={{ font: `400 9px ${MONO}`, color: '#7a716a', alignSelf: 'center' }}>{DAYS[d]}</span>
                {row.map((v, h) => (
                  <div key={h} title={`${DAYS[d]} ${h}:00 — ${v} prompts`} style={{ aspectRatio: '1', borderRadius: 2, background: v === 0 ? 'rgba(255,255,255,0.04)' : `rgba(217,119,87,${(0.25 + Math.sqrt(v / heatMax) * 0.65).toFixed(2)})` }} />
                ))}
              </React.Fragment>
            ))}
          </div>
          <div style={{ marginTop: 8, font: `400 10px ${MONO}`, color: '#6a615a' }}>peak hour: {s.byHour.indexOf(Math.max(...s.byHour))}:00 ({Math.max(...s.byHour)} prompts)</div>
        </div>
        <div style={{ ...PANEL }}>
          <div style={{ font: `600 15px ${HEAD}`, marginBottom: 12 }}>Cost by model</div>
          <Bars data={s.byModel.map(([m, v], i) => ({ label: m.replace(/^claude-/, ''), value: v, color: ['#8b7cf6', '#5eb3f6', '#3fb96a', '#e8a06a', A, '#c98bf6'][i] }))} fmt={v => '$' + v.toFixed(2)} />
          <div style={{ font: `600 15px ${HEAD}`, margin: '18px 0 12px' }}>Cost by project</div>
          <Bars data={s.byProj.map(([p, v], i) => ({ label: p.split('-').slice(-2).join('-'), value: v, color: ['#5eb3f6', '#3fb96a', '#8b7cf6', '#e8a06a', A, '#c98bf6'][i] }))} fmt={v => '$' + v.toFixed(2)} />
        </div>
      </div>
      <div className="hx-2">
        <div style={{ ...PANEL }}>
          <div style={{ font: `600 15px ${HEAD}`, marginBottom: 12 }}>Longest chats</div>
          {s.longest.map(l => (
            <div key={l.sessionId} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', font: `400 11px ${MONO}` }}>
              <span style={{ color: '#e8a06a', width: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.proj.split('-').slice(-2).join('-')}</span>
              <span style={{ color: '#c8bdb4', flex: 1 }}>{l.userMsgs} prompts · {l.toolCalls} tool calls</span>
              <span style={{ color: '#7a716a' }}>{fmtDate(l.last)}</span>
            </div>
          ))}
          {s.longest.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: '#5a514a' }}>no chats in range</div>}
        </div>
        <div style={{ ...PANEL }}>
          <div style={{ font: `600 15px ${HEAD}`, marginBottom: 12 }}>Most-reused prompts</div>
          {s.topPrompts.map(p => (
            <div key={p.text} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', alignItems: 'baseline' }}>
              <span style={{ font: `600 11px ${MONO}`, color: A, flexShrink: 0 }}>{p.count}×</span>
              <span style={{ font: "400 12px 'IBM Plex Sans'", color: '#b0a69e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.text}</span>
            </div>
          ))}
          {s.topPrompts.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: '#5a514a' }}>no repeated prompts — nice</div>}
        </div>
      </div>
    </div>
  )
}

function Dupes() {
  const { project, days, controls } = useFilters()
  const [sim, setSim] = useState(0.75)
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(null)
  useEffect(() => {
    setData(null)
    const t = setTimeout(() => api.get(`/api/dupes?days=${days}&project=${encodeURIComponent(project)}&sim=${sim}`).then(setData).catch(() => {}), 200)
    return () => clearTimeout(t)
  }, [project, days, sim])

  const saveAsCommand = async c => {
    const name = prompt('Command name (creates ~/.claude/commands/<name>.md):', '')
    if (!name) return
    const content = `---\ndescription: recurring prompt promoted from chat history (used ${c.count}×)\n---\n\n${c.canonical}\n\n$ARGUMENTS\n`
    await api.post('/api/res/commands', { scope: 'user', name, content }).then(() => alert(`saved — type /${name} in any session`)).catch(e => alert(e.message))
  }
  const toPromptStudio = async c => {
    await api.post('/api/prompts', { title: c.canonical.slice(0, 60), tags: ['from-dupes'], inputs: [{ type: 'text', value: c.canonical }] })
      .then(() => alert('sent to Prompt Studio')).catch(e => alert(e.message))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {controls}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, font: `400 11px ${MONO}`, color: '#8a807a' }}>
          similarity {Math.round(sim * 100)}%
          <input type="range" min="0.4" max="1" step="0.05" value={sim} onChange={e => setSim(Number(e.target.value))} style={{ width: 130, padding: 0 }} />
        </label>
        {data && <span style={{ font: `400 10.5px ${MONO}`, color: '#7a716a', marginLeft: 'auto' }}>{data.scanned} prompts scanned · {data.clusters.length} clusters · recurring prompts are candidates for a command or skill</span>}
      </div>
      {!data && <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>clustering prompts…</div>}
      {data?.clusters.map((c, i) => (
        <div key={i} style={{ ...PANEL, padding: '14px 18px' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <span style={{ font: `600 15px ${HEAD}`, color: A, flexShrink: 0 }}>{c.count}×</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: "400 13px 'IBM Plex Sans'", color: '#e5dbd2', lineHeight: 1.5, cursor: 'pointer' }} onClick={() => setOpen(open === i ? null : i)}>{c.canonical.slice(0, 220)}{c.canonical.length > 220 ? '…' : ''}</div>
              <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a', marginTop: 4 }}>
                {c.exact ? 'exact duplicates' : 'near-identical'} · {c.sessions} chats · {c.projects.length} project{c.projects.length === 1 ? '' : 's'} · {fmtDate(c.first)} → {fmtDate(c.last)}
              </div>
              {open === i && (
                <div style={{ marginTop: 10, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 8 }}>
                  {c.items.map((it, j) => (
                    <div key={j} style={{ font: `400 10.5px ${MONO}`, color: '#8a807a', padding: '3px 0' }}>
                      <span style={{ color: '#e8a06a' }}>{it.proj.split('-').slice(-2).join('-')}</span> · {fmtDate(it.t)} — <span style={{ color: '#b0a69e' }}>{it.text.slice(0, 130)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button className="mini" style={{ marginTop: 0 }} onClick={() => saveAsCommand(c)}>save as command</button>
              <button className="mini" style={{ marginTop: 0 }} onClick={() => toPromptStudio(c)}>→ prompt studio</button>
            </div>
          </div>
        </div>
      ))}
      {data && data.clusters.length === 0 && <div style={{ ...PANEL, font: `400 12px ${MONO}`, color: '#3fb96a' }}>✓ no duplicated prompts in this range — nothing worth promoting</div>}
    </div>
  )
}
