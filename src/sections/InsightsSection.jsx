import React, { useEffect, useState } from 'react'
import { api, fmtDate } from '../lib/api.js'
import Skeleton from '../ui/Skeleton.jsx'
import { Tabs } from '../ui/tabs.jsx'

const MONO = "var(--mono)"
const HEAD = "var(--head)"
const PANEL = { background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 8, padding: 12 }
const A = 'var(--accent)'
const fmtTok = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n)))
// null/undefined must not render as 0%. `Math.round((x || 0) * 100)` made "not measured" and
// "measured, and it is zero" indistinguishable — the idiom that laundered every honest null.
const pct = x => (x == null ? '—' : Math.round(x * 100) + '%')
const fmtDur = ms => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m` : m + 'm' }
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const TIER_COLOR = { simple: 'var(--text-tertiary)', standard: 'var(--accent-light)', complex: 'var(--amber, #d79921)', reasoning: 'var(--red)' }

// What tier of work you are asking for, scored offline from prompt text alone. Deliberately
// shows a distribution and not a dollar figure: the boundaries have never been fitted against
// real data, and pricing an uncalibrated classifier would dress a guess up as an invoice.
function Complexity() {
  const [days, setDays] = useState(30)
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { setD(null); api.get('/api/complexity?days=' + days).then(setD).catch(e => setErr(e.message)) }, [days])
  if (err) return <div style={{ ...PANEL, color: 'var(--red)', font: `400 12px ${MONO}` }}>{err}</div>
  if (!d) return <Skeleton />
  const dist = d.distribution || { counts: {} }
  const total = dist.total || 0
  return (
    <div style={{ ...PANEL }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', marginBottom: 10 }}>
        <div style={{ font: `600 14px ${HEAD}` }}>Prompt complexity</div>
        <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>{d.turns} turns scored</span>
        <select style={{ marginLeft: 'auto' }} value={days} onChange={e => setDays(Number(e.target.value))}>
          {[7, 14, 30, 90].map(n => <option key={n} value={n}>{n} days</option>)}
        </select>
      </div>
      {total === 0 && <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>no scoreable turns in this window</div>}
      {['simple', 'standard', 'complex', 'reasoning'].map(t => {
        const n = dist.counts?.[t] || 0
        return (
          <div key={t} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '5px 0', font: `400 11px ${MONO}` }}>
            <span style={{ width: 90, color: 'var(--text-secondary)' }}>{t}</span>
            <div style={{ flex: 1, height: 6, background: 'var(--border-subtle)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: total ? `${(n / total) * 100}%` : 0, height: '100%', background: TIER_COLOR[t] }} />
            </div>
            <span style={{ width: 70, textAlign: 'right', color: 'var(--text-secondary)' }}>{n} · {total ? Math.round((n / total) * 100) : 0}%</span>
          </div>
        )
      })}
      <div style={{ marginTop: 10, font: `400 10px ${MONO}`, color: 'var(--amber, #d79921)', lineHeight: 1.6 }}>
        {/* The caveat is read from the API, not restated, so it cannot drift from the truth. */}
        {!d.calibrated && <div>⚠ {d.caveat}</div>}
        {dist.unknown > 0 && <div style={{ color: 'var(--text-tertiary)' }}>{dist.unknown} turn(s) unscoreable — counted separately, not folded into simple</div>}
        {dist.lowConfidence > 0 && <div style={{ color: 'var(--text-tertiary)' }}>{dist.lowConfidence} of {total} scored below the confidence threshold</div>}
        {d.capped && <div style={{ color: 'var(--text-tertiary)' }}>capped at {d.turnCap} turns — older turns in this window were not scored</div>}
      </div>
    </div>
  )
}

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
      <Tabs tabs={['Stats', 'Duplicate prompts', 'Prompt complexity']} tab={tab} setTab={setTab} />
      {tab === 'Stats' && <Stats />}
      {tab === 'Duplicate prompts' && <Dupes />}
      {tab === 'Prompt complexity' && <Complexity />}
    </div>
  )
}

function Kpi({ label, value, sub, color = 'var(--text-primary)' }) {
  return (
    <div style={{ ...PANEL, padding: '15px 17px' }}>
      <div style={{ font: `600 11px ${MONO}`, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>{label}</div>
      <div style={{ marginTop: 7, font: `600 20px ${HEAD}`, color }}>{value}</div>
      <div style={{ marginTop: 2, font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>{sub}</div>
    </div>
  )
}

const Bars = ({ data, fmt = fmtTok }) => {
  const max = Math.max(...data.map(d => d.value), 1e-9)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {data.map(d => (
        <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 11, font: `500 11px ${MONO}` }}>
          <span style={{ width: 130, textAlign: 'right', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
          <div style={{ flex: 1, height: 9, borderRadius: 6, background: 'var(--bg-surface-hover)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: (d.value / max) * 100 + '%', borderRadius: 6, background: `linear-gradient(90deg,${d.color || A},${d.color || A}bb)`, transformOrigin: 'left', animation: 'grow .7s cubic-bezier(.2,.8,.2,1) both' }} />
          </div>
          <span style={{ width: 58, textAlign: 'right', color: 'var(--text-secondary)' }}>{fmt(d.value)}</span>
        </div>
      ))}
      {data.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>no data in range</div>}
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
  if (!s) return <Skeleton tiles={4} rows={6} />
  const heatMax = Math.max(...s.heat.flat(), 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>{controls}<span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>computed live from session transcripts — nothing stored</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12 }}>
        <Kpi label="Chats" value={s.chats} sub={`${s.activeDays} active days`} color={A} />
        <Kpi label="Messages" value={fmtTok(s.msgs)} sub={`${s.avgMsgs.toFixed(1)} avg / chat`} color="var(--accent-light)" />
        <Kpi label="Avg session" value={fmtDur(s.avgSessionMs)} sub={`${s.toolsPerChat.toFixed(0)} tool calls / chat`} color="var(--blue)" />
        <Kpi label="One-shot rate" value={pct(s.oneShotRate)} sub="resolved in a single prompt" color="var(--green)" />
        <Kpi label="Cost" value={'$' + s.cost.toFixed(2)} sub={`$${s.costPerChat.toFixed(2)} / chat`} color="var(--violet)" />
        <Kpi label="Tokens" value={fmtTok(s.tokOut)} sub={`out · ${fmtTok(s.tokIn)} in+cache`} color="var(--amber)" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12 }}>
        <Kpi label="Prompt reuse" value={pct(s.reuseRate)} sub={`${s.dupClusters} duplicate clusters`} color={s.dupClusters > 5 ? 'var(--amber)' : 'var(--green)'} />
        <Kpi label="Correction rate" value={pct(s.repromptRate)} sub="immediate rephrasing — friction" color={s.repromptRate > 0.1 ? 'var(--red)' : 'var(--green)'} />
        <Kpi label="Abandonment" value={pct(s.abandonRate)} sub="one prompt, nothing ran" color={s.abandonRate > 0.15 ? 'var(--amber)' : 'var(--green)'} />
      </div>
      <div className="hx-2a">
        <div style={{ ...PANEL }}>
          <div style={{ font: `600 14px ${HEAD}`, marginBottom: 12 }}>Activity heatmap <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>prompts by day × hour</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: '34px repeat(24, 1fr)', gap: 3 }}>
            {s.heat.map((row, d) => (
              <React.Fragment key={d}>
                <span style={{ font: `400 9px ${MONO}`, color: 'var(--text-tertiary)', alignSelf: 'center' }}>{DAYS[d]}</span>
                {row.map((v, h) => (
                  <div key={h} title={`${DAYS[d]} ${h}:00 — ${v} prompts`} style={{ aspectRatio: '1', borderRadius: 2, background: v === 0 ? 'var(--bg-surface-hover)' : `color-mix(in srgb, var(--accent) ${Math.round((0.25 + Math.sqrt(v / heatMax) * 0.65) * 100)}%, transparent)` }} />
                ))}
              </React.Fragment>
            ))}
          </div>
          <div style={{ marginTop: 8, font: `400 10px ${MONO}`, color: 'var(--text-tertiary)' }}>peak hour: {s.byHour.indexOf(Math.max(...s.byHour))}:00 ({Math.max(...s.byHour)} prompts)</div>
        </div>
        <div style={{ ...PANEL }}>
          <div style={{ font: `600 14px ${HEAD}`, marginBottom: 12 }}>Cost by model</div>
          <Bars data={s.byModel.map(([m, v], i) => ({ label: m.replace(/^claude-/, ''), value: v, color: ['var(--violet)', 'var(--blue)', 'var(--green)', 'var(--accent-light)', A, 'var(--violet)'][i] }))} fmt={v => '$' + v.toFixed(2)} />
          <div style={{ font: `600 14px ${HEAD}`, margin: '18px 0 12px' }}>Cost by project</div>
          <Bars data={s.byProj.map(([p, v], i) => ({ label: p.split('-').slice(-2).join('-'), value: v, color: ['var(--blue)', 'var(--green)', 'var(--violet)', 'var(--accent-light)', A, 'var(--violet)'][i] }))} fmt={v => '$' + v.toFixed(2)} />
        </div>
      </div>
      <div className="hx-2">
        <div style={{ ...PANEL }}>
          <div style={{ font: `600 14px ${HEAD}`, marginBottom: 12 }}>Longest chats</div>
          {s.longest.map(l => (
            <div key={l.sessionId} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border-subtle)', font: `400 11px ${MONO}` }}>
              <span style={{ color: 'var(--accent-light)', width: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.proj.split('-').slice(-2).join('-')}</span>
              <span style={{ color: 'var(--text-secondary)', flex: 1 }}>{l.userMsgs} prompts · {l.toolCalls} tool calls</span>
              <span style={{ color: 'var(--text-tertiary)' }}>{fmtDate(l.last)}</span>
            </div>
          ))}
          {s.longest.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>no chats in range</div>}
        </div>
        <div style={{ ...PANEL }}>
          <div style={{ font: `600 14px ${HEAD}`, marginBottom: 12 }}>Most-reused prompts</div>
          {s.topPrompts.map(p => (
            <div key={p.text} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border-subtle)', alignItems: 'baseline' }}>
              <span style={{ font: `600 11px ${MONO}`, color: A, flexShrink: 0 }}>{p.count}×</span>
              <span style={{ font: "400 12px var(--body)", color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.text}</span>
            </div>
          ))}
          {s.topPrompts.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>no repeated prompts — nice</div>}
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

  if (!data) return <Skeleton tiles={0} rows={8} />

  const saveAsCommand = async c => {
    const name = prompt('Command name (creates ~/.claude/commands/<name>.md):', '')
    if (!name) return
    const content = `---\ndescription: recurring prompt promoted from chat history (used ${c.count}×)\n---\n\n${c.canonical}\n\n$ARGUMENTS\n`
    await api.post('/api/res/commands', { scope: 'user', name, content }).then(() => alert(`saved — type /${name} in any session`)).catch(e => alert(e.message))
  }
  const toPromptStudio = async c => {
    await api.post('/api/prompts', { title: c.canonical.slice(0, 60), tags: ['from-dupes'], inputs: [{ type: 'text', value: c.canonical }] })
      .then(() => alert('sent to Authoring')).catch(e => alert(e.message))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {controls}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>
          similarity {Math.round(sim * 100)}%
          <input type="range" min="0.4" max="1" step="0.05" value={sim} onChange={e => setSim(Number(e.target.value))} style={{ width: 130, padding: 0 }} />
        </label>
        {data && <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>{data.scanned} prompts scanned · {data.clusters.length} clusters · recurring prompts are candidates for a command or skill</span>}
      </div>
      {!data && <div style={{ font: `400 12px ${MONO}`, color: 'var(--text-tertiary)' }}>clustering prompts…</div>}
      {data?.clusters.map((c, i) => (
        <div key={i} style={{ ...PANEL, padding: '14px 18px' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <span style={{ font: `600 14px ${HEAD}`, color: A, flexShrink: 0 }}>{c.count}×</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: "400 13px var(--body)", color: 'var(--text-primary)', lineHeight: 1.5, cursor: 'pointer' }} onClick={() => setOpen(open === i ? null : i)}>{c.canonical.slice(0, 220)}{c.canonical.length > 220 ? '…' : ''}</div>
              <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)', marginTop: 4 }}>
                {c.exact ? 'exact duplicates' : 'near-identical'} · {c.sessions} chats · {c.projects.length} project{c.projects.length === 1 ? '' : 's'} · {fmtDate(c.first)} → {fmtDate(c.last)}
              </div>
              {open === i && (
                <div style={{ marginTop: 10, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
                  {c.items.map((it, j) => (
                    <div key={j} style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)', padding: '3px 0' }}>
                      <span style={{ color: 'var(--accent-light)' }}>{it.proj.split('-').slice(-2).join('-')}</span> · {fmtDate(it.t)} — <span style={{ color: 'var(--text-secondary)' }}>{it.text.slice(0, 130)}</span>
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
      {data && data.clusters.length === 0 && <div style={{ ...PANEL, font: `400 12px ${MONO}`, color: 'var(--green)' }}>✓ no duplicated prompts in this range — nothing worth promoting</div>}
    </div>
  )
}
