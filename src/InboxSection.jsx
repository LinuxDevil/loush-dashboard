import React, { useEffect, useState } from 'react'
import { api, fmtDate } from './api.js'
import { Tabs } from './GovernanceSection.jsx'

const MONO = "'IBM Plex Mono', monospace"
const HEAD = "'Space Grotesk', sans-serif"
const PANEL = { background: 'rgba(28,24,21,0.55)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: '18px 20px', backdropFilter: 'blur(10px)' }
const SEV = { error: '#e5484d', warning: '#e5a03a', info: '#8a807a' }
const KIND_ICON = { approval: '☑', budget: '¤', eval: '𝜎', session: '⌨', recommendation: '❒' }
const fmtTok = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n)))

export default function InboxSection({ onNav }) {
  const [tab, setTab] = useState('Inbox')
  return (
    <div className="hx" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Tabs tabs={['Inbox', 'Daily digest', 'Notifications']} tab={tab} setTab={setTab} />
      {tab === 'Inbox' && <Inbox onNav={onNav} />}
      {tab === 'Daily digest' && <Digest onNav={onNav} />}
      {tab === 'Notifications' && <Notify />}
    </div>
  )
}

function Inbox({ onNav }) {
  const [items, setItems] = useState(null)
  const [showDone, setShowDone] = useState(false)
  const load = () => api.get('/api/inbox').then(setItems).catch(() => {})
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t) }, [])
  const mark = async (it, done) => { await api.post('/api/inbox/done', { key: it.key, done }); load() }
  if (!items) return <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>collecting…</div>
  const open = items.filter(i => !i.done)
  const shown = showDone ? items : open
  return (
    <div style={{ ...PANEL }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={{ font: `600 15px ${HEAD}` }}>Everything that needs you <span style={{ font: `400 11px ${MONO}`, color: '#8a807a' }}>{open.length} open · all projects</span></div>
        <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, font: `400 11px ${MONO}`, color: '#8a807a', cursor: 'pointer' }}>
          <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} style={{ width: 13 }} />show cleared
        </label>
      </div>
      {shown.map(it => (
        <div key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 4px', borderBottom: '1px solid rgba(255,255,255,0.045)', opacity: it.done ? 0.45 : 1 }}>
          <span style={{ width: 26, height: 26, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', font: `600 13px ${HEAD}`, color: SEV[it.severity], background: 'rgba(255,255,255,0.04)', flexShrink: 0 }}>{KIND_ICON[it.kind] || '•'}</span>
          <span style={{ font: `600 9px ${MONO}`, padding: '2px 6px', borderRadius: 4, color: SEV[it.severity], background: 'rgba(255,255,255,0.04)', flexShrink: 0 }}>{it.severity.toUpperCase()}</span>
          <span style={{ flex: 1, font: "400 12.5px 'IBM Plex Sans'", color: '#c8bdb4' }}>{it.text}</span>
          <span style={{ font: `400 10px ${MONO}`, color: '#6a615a', flexShrink: 0 }}>{fmtDate(it.ts)}</span>
          <button className="mini" style={{ marginTop: 0 }} onClick={() => onNav?.(it.section)}>open</button>
          <button className="mini" style={{ marginTop: 0 }} onClick={() => mark(it, !it.done)}>{it.done ? 'reopen' : 'clear'}</button>
        </div>
      ))}
      {shown.length === 0 && <div style={{ font: `400 12px ${MONO}`, color: '#3fb96a' }}>✓ inbox zero — nothing is waiting on you</div>}
      <p className="small">aggregates: sessions waiting for input · pending global approvals · budget alerts · failed eval runs · error-level recommendations. Clearing here only hides the item; fix it via "open".</p>
    </div>
  )
}

function Digest({ onNav }) {
  const [days, setDays] = useState(1)
  const [d, setD] = useState(null)
  useEffect(() => { setD(null); api.get('/api/digest?days=' + days).then(setD).catch(() => {}) }, [days])
  if (!d) return <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>assembling digest…</div>
  const line = (label, value) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', font: `500 12px ${MONO}`, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ color: '#8a807a' }}>{label}</span><span style={{ color: '#eee3da' }}>{value}</span>
    </div>
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <select value={days} onChange={e => setDays(Number(e.target.value))}><option value={1}>last 24h</option><option value={7}>last 7d</option></select>
        <span style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>the state of every project without opening each one — generated live</span>
      </div>
      <div className="hx-2">
        <div style={{ ...PANEL }}>
          <div style={{ font: `600 15px ${HEAD}`, marginBottom: 10 }}>Shipped</div>
          {d.commits.map(c => (
            <div key={c.project} style={{ padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <div style={{ font: `600 12px ${MONO}`, color: '#eee3da' }}>{c.project} <span style={{ color: '#3fb96a' }}>+{c.count} commit{c.count === 1 ? '' : 's'}</span></div>
              <div style={{ font: `400 11px ${MONO}`, color: '#7a716a', marginTop: 2 }}>{c.latest}</div>
            </div>
          ))}
          {d.commits.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: '#5a514a' }}>no commits in range</div>}
          {line('lines changed (edit tools)', `+${fmtTok(d.lines.add)} / −${fmtTok(d.lines.del)}`)}
        </div>
        <div style={{ ...PANEL }}>
          <div style={{ font: `600 15px ${HEAD}`, marginBottom: 10 }}>Spent</div>
          {line('cost', '$' + d.cost.toFixed(2))}
          {line('output tokens', fmtTok(d.tokens))}
          {line('assistant messages', fmtTok(d.msgs))}
          {line('eval runs', d.evals.runs + (d.evals.passRate != null ? ` · ${Math.round(d.evals.passRate * 100)}% pass` : ''))}
          <div style={{ font: `600 13px ${HEAD}`, margin: '14px 0 6px' }}>By project</div>
          {d.byProj.map(([p, v]) => line(p.split('-').slice(-2).join('-'), `$${v.cost.toFixed(2)} · ${fmtTok(v.out)} tok`))}
        </div>
      </div>
      <div className="hx-2">
        <div style={{ ...PANEL }}>
          <div style={{ font: `600 15px ${HEAD}`, marginBottom: 10 }}>Drift detected</div>
          {d.drift.map(x => (
            <div key={x.project} style={{ display: 'flex', justifyContent: 'space-between', font: `500 12px ${MONO}`, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ color: '#e8a06a' }}>{x.project}</span>
              <span style={{ color: '#c8bdb4' }}>{x.fields} field{x.fields === 1 ? '' : 's'} off baseline <button className="mini" style={{ marginLeft: 8, marginTop: 0 }} onClick={() => onNav?.('governance')}>review</button></span>
            </div>
          ))}
          {d.drift.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: '#3fb96a' }}>✓ all baselined projects in sync</div>}
        </div>
        <div style={{ ...PANEL }}>
          <div style={{ font: `600 15px ${HEAD}`, marginBottom: 10 }}>Needs attention</div>
          {d.attention.map(i => (
            <div key={i.key} style={{ display: 'flex', gap: 9, alignItems: 'baseline', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ font: `600 9px ${MONO}`, color: SEV[i.severity] }}>{i.severity.toUpperCase()}</span>
              <span style={{ font: "400 12px 'IBM Plex Sans'", color: '#c8bdb4', flex: 1 }}>{i.text}</span>
            </div>
          ))}
          {d.attention.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: '#3fb96a' }}>✓ nothing open</div>}
        </div>
      </div>
    </div>
  )
}

function Notify() {
  const [cfg, setCfg] = useState(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => { api.get('/api/notify').then(setCfg).catch(() => {}) }, [])
  if (!cfg) return null
  const save = async next => {
    setCfg(next)
    await api.put('/api/notify', next).catch(e => alert(e.message))
    setSaved(true); setTimeout(() => setSaved(false), 1500)
  }
  const askDesktop = async () => {
    const perm = await Notification.requestPermission()
    if (perm === 'granted') { new Notification('claude-dashboard', { body: 'Desktop notifications enabled' }); save({ ...cfg, desktop: true }) }
    else alert('browser permission denied — allow notifications for this site')
  }
  return (
    <div style={{ ...PANEL, maxWidth: 640 }}>
      <div style={{ font: `600 15px ${HEAD}`, marginBottom: 14 }}>Notifications {saved && <span style={{ font: `400 11px ${MONO}`, color: '#3fb96a' }}>saved</span>}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="checkbox" checked={cfg.desktop} onChange={e => e.target.checked ? askDesktop() : save({ ...cfg, desktop: false })} style={{ width: 14 }} />
          <div>
            <div style={{ font: "500 13px 'IBM Plex Sans'", color: '#e5dbd2' }}>Desktop notifications</div>
            <div style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>fires while the dashboard tab is open, for new error/warning inbox items (agent needs input, budget hit, eval failed)</div>
          </div>
        </div>
        <div>
          <div style={{ font: "500 13px 'IBM Plex Sans'", color: '#e5dbd2', marginBottom: 6 }}>Slack webhook</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={cfg.slackWebhook || ''} onChange={e => setCfg({ ...cfg, slackWebhook: e.target.value })} onBlur={() => save(cfg)} placeholder="https://hooks.slack.com/services/…" />
            <button className="mini" style={{ marginTop: 0, flexShrink: 0 }} onClick={() => api.post('/api/notify/test').then(r => alert(r.ok ? 'sent ✓' : 'slack replied ' + r.status)).catch(e => alert(e.message))}>test</button>
          </div>
          <div style={{ font: `400 11px ${MONO}`, color: '#7a716a', marginTop: 6 }}>the server pushes new error/warning inbox items every minute while running · leave empty to disable</div>
        </div>
      </div>
    </div>
  )
}
