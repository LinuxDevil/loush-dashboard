import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api.js'
import { buildBlocks, Block } from './ChatSection.jsx'

// ---------- visual system (from the Agent Teams mockup) ----------
const PANEL = { background: 'rgba(28,24,21,0.55)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: '18px 20px', backdropFilter: 'blur(10px)' }
const MONO = "'IBM Plex Mono', monospace"
const HEAD = "'Space Grotesk', sans-serif"
const STATUS = {
  working: { color: '#d97757', glow: 'rgba(217,119,87,0.3)' },
  planning: { color: '#5eb3f6', glow: 'rgba(94,179,246,0.28)' },
  idle: { color: '#6a6f78', glow: 'rgba(120,120,130,0.18)' },
  failed: { color: '#e5484d', glow: 'rgba(229,72,77,0.3)' },
  shutdown: { color: '#5a514a', glow: 'rgba(120,120,130,0.12)' },
}
const st = s => STATUS[s] || STATUS.idle
const HUES = [
  ['linear-gradient(135deg,#e8a06a,#d97757)', '#d97757', '#e8a06a'],
  ['linear-gradient(135deg,#7cc4f7,#5eb3f6)', '#5eb3f6', '#7cc4f7'],
  ['linear-gradient(135deg,#e8a06a,#c96a44)', '#c96a44', '#e8a06a'],
  ['linear-gradient(135deg,#e0895f,#c25a38)', '#c25a38', '#e0895f'],
  ['linear-gradient(135deg,#7a7f88,#565b63)', '#565b63', '#9aa0a8'],
  ['linear-gradient(135deg,#6fd39a,#3fb96a)', '#3fb96a', '#6fd39a'],
  ['linear-gradient(135deg,#f0c56a,#e5a03a)', '#e5a03a', '#f0c56a'],
]
const LEAD_HUE = ['linear-gradient(135deg,#a78bfa,#7c5cff)', '#7c5cff', '#a78bfa']
const hueOf = (name, members) => {
  const i = members.filter(m => !m.isLead).findIndex(m => m.name === name)
  return i < 0 ? LEAD_HUE : HUES[i % HUES.length]
}
const initialOf = n => (n || '?').charAt(0).toUpperCase()
const fmtTok = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(0) + 'k' : String(n || 0))
const rel = ts => {
  const s = Math.max(0, (Date.now() - ts) / 1000)
  return s < 60 ? Math.round(s) + 's' : s < 3600 ? Math.round(s / 60) + 'm' : Math.round(s / 3600) + 'h' + Math.round((s % 3600) / 60) + 'm'
}
const sparkPts = (arr, h = 40) => {
  const mx = Math.max(...arr, 1), mn = Math.min(...arr, 0), rng = mx - mn || 1, n = arr.length
  return arr.map((v, i) => `${((i / (n - 1)) * 100).toFixed(1)},${(h - 3 - ((v - mn) / rng) * (h - 6)).toFixed(1)}`).join(' ')
}

function Kpi({ label, value, unit, color, sub, delay }) {
  return (
    <div style={{ ...PANEL, padding: '16px 18px', animation: 'fadeUp .5s ease both', animationDelay: delay }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, font: `600 11px ${MONO}`, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8a807a' }}>{label}</div>
      <div style={{ marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ font: `600 26px ${HEAD}`, color }}>{value}</span>
        {unit && <span style={{ font: `500 12px ${MONO}`, color: '#7a716a' }}>{unit}</span>}
      </div>
      <div style={{ marginTop: 3, font: `400 11px ${MONO}`, color: '#7a716a' }}>{sub}</div>
    </div>
  )
}

// ---------- communication graph ----------
function Graph({ members, messages, selected, onSelect }) {
  const C = { x: 320, y: 205 }
  const mates = members.filter(m => !m.isLead)
  const pos = useMemo(() => {
    const p = { [members.find(m => m.isLead)?.name || 'lead']: C }
    mates.forEach((m, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(mates.length, 1)
      p[m.name] = { x: Math.round(C.x + 215 * Math.cos(a)), y: Math.round(C.y + 152 * Math.sin(a)) }
    })
    return p
  }, [members.map(m => m.name).join()])
  const leadName = members.find(m => m.isLead)?.name || 'lead'
  const at = n => pos[n] || C
  // edges = channels that have carried at least one message, plus lead<->everyone
  const chans = new Set(mates.map(m => [leadName, m.name].sort().join('|')))
  for (const m of messages) if (pos[m.from] && pos[m.to]) chans.add([m.from, m.to].sort().join('|'))
  const edges = [...chans].map(k => {
    const [a, b] = k.split('|')
    const peer = a !== leadName && b !== leadName
    return { p: at(a), q: at(b), stroke: peer ? 'rgba(139,124,246,0.4)' : 'rgba(217,119,87,0.35)' }
  })
  // pulses = the most recent real messages travelling their edge
  const pulses = messages.slice(0, 8).filter(m => pos[m.from] && pos[m.to]).map((m, i) => ({
    p: at(m.from), q: at(m.to),
    color: m.from === leadName || m.to === leadName ? '#a78bfa' : hueOf(m.from, members)[1],
    dur: (3 + (i % 3) * 0.3).toFixed(1) + 's', begin: (i * 0.45).toFixed(2) + 's',
  }))
  const node = m => {
    const p = at(m.name), lead = m.isLead
    const s = st(m.status)
    const fill = lead ? 'url(#leadG)' : s.color
    const sel = selected === m.name
    return (
      <g key={m.name} onClick={() => onSelect(m.name)} style={{ cursor: 'pointer' }}>
        <circle cx={p.x} cy={p.y} r={lead ? 34 : 28} fill={lead ? 'rgba(139,124,246,0.28)' : s.glow} style={{ transformOrigin: `${p.x}px ${p.y}px`, animation: 'nodeGlow 2.6s ease-in-out infinite' }} />
        <circle cx={p.x} cy={p.y} r={lead ? 26 : 21} fill={fill} stroke={sel ? '#f6efe9' : lead ? 'rgba(167,139,250,0.5)' : 'rgba(255,255,255,0.18)'} strokeWidth={sel ? 2.5 : 2} />
        <text x={p.x} y={p.y + 5} textAnchor="middle" style={{ font: `600 14px ${HEAD}`, fill: '#fff' }}>{initialOf(m.name)}</text>
        <text x={p.x} y={p.y > C.y ? p.y + (lead ? 46 : 40) : p.y - 32} textAnchor="middle" style={{ font: `500 11px ${MONO}`, fill: sel ? '#f6efe9' : '#c8bdb4' }}>{lead ? `${m.name} (lead)` : m.name}</text>
      </g>
    )
  }
  return (
    <div style={{ position: 'relative', ...PANEL, animation: 'fadeUp .5s ease both', animationDelay: '.1s' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <div style={{ font: `600 15px ${HEAD}` }}>Communication topology</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, font: `400 10px ${MONO}`, color: '#8a807a' }}>
          {[['#d97757', 'working'], ['#5eb3f6', 'planning'], ['#6a6f78', 'idle'], ['#e5484d', 'failed']].map(([c, l]) => (
            <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: c }} />{l}</span>
          ))}
        </div>
      </div>
      <svg viewBox="0 0 640 430" style={{ width: '100%', height: 'auto', display: 'block' }}>
        <defs>
          <radialGradient id="leadG" cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#a78bfa" /><stop offset="1" stopColor="#7c5cff" /></radialGradient>
        </defs>
        {edges.map((e, i) => (
          <path key={i} d={`M ${e.p.x} ${e.p.y} L ${e.q.x} ${e.q.y}`} fill="none" stroke={e.stroke} strokeWidth="1.4" strokeDasharray="4 4" style={{ animation: 'dash 1.1s linear infinite', opacity: 0.5 }} />
        ))}
        {pulses.map((p, i) => (
          <circle key={i} r="3.4" fill={p.color} style={{ filter: `drop-shadow(0 0 5px ${p.color})` }}>
            <animateMotion dur={p.dur} begin={p.begin} repeatCount="indefinite" path={`M ${p.p.x} ${p.p.y} L ${p.q.x} ${p.q.y}`} keyPoints="0;1" keyTimes="0;1" calcMode="linear" />
          </circle>
        ))}
        {members.map(node)}
      </svg>
      <div style={{ position: 'absolute', bottom: 18, left: 20, font: `400 10px ${MONO}`, color: '#6a615a' }}>edges = direct SendMessage channels · pulses = live messages</div>
    </div>
  )
}

// ---------- roster ----------
function Roster({ members, selected, onSelect }) {
  return (
    <div style={{ ...PANEL, animation: 'fadeUp .5s ease both', animationDelay: '.15s', display: 'flex', flexDirection: 'column' }}>
      <div style={{ font: `600 15px ${HEAD}`, marginBottom: 14 }}>
        Roster <span style={{ font: `400 12px ${MONO}`, color: '#8a807a' }}>{members.filter(m => !m.isLead).length} teammates + lead</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, overflowY: 'auto' }}>
        {members.map(m => {
          const s = st(m.status), sel = selected === m.name
          return (
            <div key={m.name} onClick={() => onSelect(m.name)} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px', borderRadius: 12, cursor: 'pointer',
              background: m.isLead ? 'rgba(139,124,246,0.06)' : 'rgba(255,255,255,0.02)',
              border: `1px solid ${sel ? 'rgba(217,119,87,0.5)' : m.isLead ? 'rgba(139,124,246,0.2)' : 'rgba(255,255,255,0.05)'}`,
            }}>
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <div style={{ width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', font: `600 15px ${HEAD}`, color: '#fff', background: hueOf(m.isLead ? '' : m.name, members)[0] }}>{initialOf(m.name)}</div>
                <span style={{ position: 'absolute', bottom: -2, right: -2, width: 11, height: 11, borderRadius: '50%', background: s.color, border: '2px solid #17130f', animation: m.status === 'idle' || m.status === 'shutdown' ? 'none' : 'blink 2s infinite' }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ font: `600 13px ${MONO}`, color: '#eee3da' }}>{m.name}</span>
                  {m.isLead && <span style={{ font: `600 8px ${MONO}`, letterSpacing: '0.08em', padding: '1px 6px', borderRadius: 5, background: 'rgba(139,124,246,0.2)', color: '#a78bfa' }}>LEAD</span>}
                </div>
                <div style={{ font: `400 11px ${MONO}`, color: m.status === 'failed' ? '#e5484d' : '#8a807a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.status === 'failed' ? (m.error || 'failed') : (m.currentTask || '—')}</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ font: `600 11px ${MONO}`, color: s.color }}>{m.status}</div>
                <div style={{ font: `400 10px ${MONO}`, color: '#6a615a' }}>{m.model || ''}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------- task board ----------
function TaskBoard({ tasks, members }) {
  const byId = Object.fromEntries(tasks.map(t => [t.id, t]))
  const cols = [
    { title: 'pending', color: '#8a807a', match: s => s === 'pending' },
    { title: 'in progress', color: '#d97757', match: s => s === 'in_progress' },
    { title: 'completed', color: '#3fb96a', match: s => s === 'completed' },
  ]
  const done = tasks.filter(t => t.status === 'completed').length
  const active = tasks.filter(t => t.status === 'in_progress').length
  const blocked = tasks.filter(t => t.status !== 'completed' && (t.blockedBy || []).some(id => byId[id] && byId[id].status !== 'completed')).length
  return (
    <div style={{ background: 'rgba(28,24,21,0.4)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 16, padding: '18px 20px', animation: 'fadeUp .5s ease both', animationDelay: '.2s' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
        <div style={{ font: `600 15px ${HEAD}` }}>Shared task list</div>
        <div style={{ font: `400 12px ${MONO}`, color: '#8a807a' }}>{done} done · {active} active · {blocked} blocked by deps</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
        {cols.map(col => {
          const list = tasks.filter(t => col.match(t.status))
          return (
            <div key={col.title}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 11, paddingBottom: 9, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: col.color }} />
                <span style={{ font: `600 11px ${MONO}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#b0a69e' }}>{col.title}</span>
                <span style={{ font: `500 11px ${MONO}`, color: '#7a716a' }}>{list.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {list.map(t => {
                  const unresolved = (t.blockedBy || []).filter(id => byId[id] && byId[id].status !== 'completed')
                  const hue = t.owner ? hueOf(t.owner, members) : null
                  const accent = t.status === 'completed' ? '#3fb96a' : hue ? hue[1] : 'rgba(255,255,255,0.08)'
                  return (
                    <div key={t.id} style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)', borderLeft: `3px solid ${accent}`, borderRadius: 10, padding: '11px 12px' }} title={t.description}>
                      <div style={{ font: "500 12.5px 'IBM Plex Sans'", color: '#eee3da', lineHeight: 1.4, marginBottom: 8 }}>{t.subject}</div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6, font: `400 10px ${MONO}`, color: t.status === 'completed' ? '#3fb96a' : t.owner ? '#e8a06a' : '#7a716a' }}>
                          <span style={{ width: 16, height: 16, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', font: `600 9px ${HEAD}`, color: '#fff', background: hue ? hue[1] : 'rgba(255,255,255,0.08)' }}>{t.owner ? initialOf(t.owner) : '?'}</span>
                          {t.owner || '—'}
                        </span>
                        {unresolved.length > 0 && (
                          <span style={{ font: `400 9px ${MONO}`, color: '#8a807a', padding: '2px 7px', borderRadius: 5, background: 'rgba(229,72,77,0.1)' }}>⛓ {unresolved.map(id => byId[id]?.subject || '#' + id).join(', ').slice(0, 40)}</span>
                        )}
                      </div>
                    </div>
                  )
                })}
                {list.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: '#5a514a', padding: '6px 2px' }}>none</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------- mailbox ----------
function Mailbox({ messages, members }) {
  return (
    <div style={{ ...PANEL, animation: 'fadeUp .5s ease both', animationDelay: '.25s' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
        <div style={{ font: `600 15px ${HEAD}` }}>Mailbox <span style={{ font: `400 12px ${MONO}`, color: '#8a807a' }}>live feed</span></div>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, font: `400 10px ${MONO}`, color: '#3fb96a' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3fb96a', animation: 'blink 1.6s infinite' }} />streaming
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 340, overflowY: 'auto' }}>
        {messages.map((m, i) => {
          const fh = hueOf(m.fromLead ? '' : m.from, members), th = hueOf(m.toLead ? '' : m.to, members)
          return (
            <div key={i} style={{ display: 'flex', gap: 11 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', font: `600 11px ${HEAD}`, color: '#fff', background: fh[1] }}>{initialOf(m.from)}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, font: `400 11px ${MONO}`, marginBottom: 3 }}>
                  <span style={{ color: fh[2] }}>{m.from}</span><span style={{ color: '#5a514a' }}>→</span><span style={{ color: th[2] }}>{m.to}</span>
                  <span style={{ marginLeft: 'auto', color: '#6a615a' }}>{rel(m.ts)}</span>
                </div>
                <div style={{ font: "400 12.5px 'IBM Plex Sans'", color: '#b0a69e', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{String(m.text).slice(0, 400)}</div>
              </div>
            </div>
          )
        })}
        {messages.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: '#5a514a' }}>no messages yet</div>}
      </div>
    </div>
  )
}

// ---------- analytics ----------
function Analytics({ members, messages, tasks }) {
  const bars = members.map(m => ({ name: m.name, tok: m.tokens || 0, color: hueOf(m.isLead ? '' : m.name, members)[1] })).sort((a, b) => b.tok - a.tok)
  const tmax = Math.max(...bars.map(b => b.tok), 1)
  // messages per 5-minute bucket over the last hour
  const buckets = new Array(12).fill(0)
  const now = Date.now()
  for (const m of messages) { const i = Math.floor((now - m.ts) / 300000); if (i >= 0 && i < 12) buckets[11 - i]++ }
  const done = tasks.filter(t => t.status === 'completed').length, total = tasks.length || 1
  const dash = 226.2, off = dash * (1 - done / total)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ ...PANEL, animation: 'fadeUp .5s ease both', animationDelay: '.3s' }}>
        <div style={{ font: `600 15px ${HEAD}`, marginBottom: 14 }}>Tokens by teammate</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {bars.map(b => (
            <div key={b.name} style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <span style={{ width: 118, font: `500 11px ${MONO}`, color: '#c8bdb4', flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</span>
              <div style={{ flex: 1, height: 9, borderRadius: 6, background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${((b.tok / tmax) * 100).toFixed(0)}%`, borderRadius: 6, background: `linear-gradient(90deg,${b.color},${b.color}bb)`, transformOrigin: 'left', animation: 'grow .8s cubic-bezier(.2,.8,.2,1) both' }} />
              </div>
              <span style={{ width: 44, textAlign: 'right', font: `500 11px ${MONO}`, color: '#8a807a' }}>{fmtTok(b.tok)}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ ...PANEL, padding: '16px 18px', animation: 'fadeUp .5s ease both', animationDelay: '.35s' }}>
          <div style={{ font: `600 12px ${HEAD}`, color: '#c8bdb4', marginBottom: 10 }}>Messages / 5m</div>
          <svg viewBox="0 0 100 40" preserveAspectRatio="none" style={{ width: '100%', height: 48 }}>
            <polyline points={sparkPts(buckets)} fill="none" stroke="#8b7cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div style={{ marginTop: 8, font: `600 20px ${HEAD}` }}>{messages.length} <span style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>total</span></div>
        </div>
        <div style={{ ...PANEL, padding: '16px 18px', animation: 'fadeUp .5s ease both', animationDelay: '.4s', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="88" height="88" viewBox="0 0 88 88">
            <circle cx="44" cy="44" r="36" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="8" />
            <circle cx="44" cy="44" r="36" fill="none" stroke="#3fb96a" strokeWidth="8" strokeLinecap="round" strokeDasharray={dash} strokeDashoffset={off} transform="rotate(-90 44 44)" style={{ filter: 'drop-shadow(0 0 6px rgba(63,185,106,0.5))' }} />
            <text x="44" y="41" textAnchor="middle" style={{ font: `600 19px ${HEAD}`, fill: '#f6efe9' }}>{done}/{tasks.length}</text>
            <text x="44" y="55" textAnchor="middle" style={{ font: `500 8px ${MONO}`, fill: '#8a807a' }}>TASKS</text>
          </svg>
          <div style={{ marginTop: 6, font: `400 10px ${MONO}`, color: '#7a716a' }}>{Math.round((done / total) * 100)}% throughput</div>
        </div>
      </div>
    </div>
  )
}

// ---------- agent detail drawer ----------
function AgentDetail({ team, member, members, messages, tasks, onClose }) {
  const [detail, setDetail] = useState(null)
  const [msg, setMsg] = useState('')
  const [feedback, setFeedback] = useState('')
  const endRef = useRef(null)
  useEffect(() => {
    let live = true
    const load = () => api.get(`/api/team/agent?team=${encodeURIComponent(team)}&name=${encodeURIComponent(member.name)}`).then(d => live && setDetail(d)).catch(() => {})
    load()
    const t = setInterval(load, 2000)
    return () => { live = false; clearInterval(t) }
  }, [team, member.name])
  useEffect(() => { endRef.current?.scrollIntoView() }, [detail?.events?.length])
  const act = (action, body) => api.post(`/api/team/${action}`, { team, name: member.name, ...body }).catch(e => alert(e.message))
  const s = st(member.status)
  const sent = messages.filter(m => m.from === member.name).length
  const recv = messages.filter(m => m.to === member.name).length
  const myTasks = tasks.filter(t => t.owner === member.name)
  const blocks = detail ? buildBlocks(detail.events || []) : []
  const label = (l, v) => (
    <div><div style={{ font: `600 9px ${MONO}`, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6a615a' }}>{l}</div>
      <div style={{ font: `500 12px ${MONO}`, color: '#c8bdb4', marginTop: 2 }}>{v || '—'}</div></div>
  )
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(680px, 92vw)', height: '100vh', overflowY: 'auto', background: '#14110f', borderLeft: '1px solid rgba(255,255,255,0.08)' }}>
      <div style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 16, minHeight: '100%' }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 46, height: 46, borderRadius: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', font: `600 19px ${HEAD}`, color: '#fff', background: hueOf(member.isLead ? '' : member.name, members)[0] }}>{initialOf(member.name)}</div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, font: `600 17px ${HEAD}` }}>
              {member.name}
              {member.isLead && <span style={{ font: `600 8px ${MONO}`, letterSpacing: '0.08em', padding: '1px 6px', borderRadius: 5, background: 'rgba(139,124,246,0.2)', color: '#a78bfa' }}>LEAD</span>}
              <span style={{ font: `600 11px ${MONO}`, color: s.color, marginLeft: 4 }}>● {member.status}</span>
            </div>
            <div style={{ font: `400 11px ${MONO}`, color: '#8a807a', marginTop: 2 }}>up {member.startedAt ? rel(member.startedAt) : '—'}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.1)', color: '#c8bdb4', borderRadius: 9, padding: '6px 12px', cursor: 'pointer', font: `500 12px ${MONO}` }}>✕</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, ...PANEL, padding: '14px 16px' }}>
          {label('agent type', member.agentType)}
          {label('model', member.model)}
          {label('effort', member.effort)}
          {label('permissions', member.permissionMode)}
        </div>
        {member.status === 'failed' && (
          <div style={{ ...PANEL, borderColor: 'rgba(229,72,77,0.35)', background: 'rgba(229,72,77,0.07)' }}>
            <div style={{ font: `600 11px ${MONO}`, color: '#e5484d', marginBottom: 6 }}>FAILED</div>
            <div style={{ font: `400 12px ${MONO}`, color: '#e8a5a7', whiteSpace: 'pre-wrap' }}>{member.error || 'no error text captured'}</div>
          </div>
        )}
        {/* now */}
        <div style={{ ...PANEL }}>
          <div style={{ font: `600 13px ${HEAD}`, marginBottom: 8 }}>Now</div>
          <div style={{ font: `400 12px ${MONO}`, color: '#c8bdb4' }}>{member.currentTask || 'no claimed task'}</div>
          {detail?.currentTool && <div style={{ font: `400 11px ${MONO}`, color: '#e8a06a', marginTop: 5 }}>▸ {detail.currentTool} <span style={{ animation: 'blink 1.2s infinite' }}>▮</span></div>}
        </div>
        {/* transcript */}
        <div style={{ ...PANEL, flex: 1, minHeight: 220, display: 'flex', flexDirection: 'column' }}>
          <div style={{ font: `600 13px ${HEAD}`, marginBottom: 10 }}>Session transcript <span style={{ font: `400 11px ${MONO}`, color: '#8a807a' }}>live tail</span></div>
          <div className="chat-log" style={{ flex: 1, maxHeight: 320, border: 'none', background: 'rgba(0,0,0,0.25)', borderRadius: 10 }}>
            {blocks.map((b, i) => <Block key={i} b={b} />)}
            {!detail && <div style={{ font: `400 11px ${MONO}`, color: '#5a514a' }}>loading transcript…</div>}
            {detail && blocks.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: '#5a514a' }}>no transcript found for this teammate</div>}
            <div ref={endRef} />
          </div>
        </div>
        {/* history + counters */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ ...PANEL, padding: '14px 16px' }}>
            <div style={{ font: `600 13px ${HEAD}`, marginBottom: 8 }}>Tasks</div>
            {myTasks.map(t => (
              <div key={t.id} style={{ display: 'flex', gap: 8, font: `400 11px ${MONO}`, color: '#b0a69e', padding: '3px 0' }}>
                <span style={{ color: t.status === 'completed' ? '#3fb96a' : '#d97757' }}>{t.status === 'completed' ? '✓' : '◐'}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</span>
              </div>
            ))}
            {myTasks.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: '#5a514a' }}>none claimed</div>}
          </div>
          <div style={{ ...PANEL, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ font: `600 13px ${HEAD}` }}>Counters</div>
            {[[`${fmtTok(member.tokens || 0)}`, 'tokens'], [`${sent} sent · ${recv} recv`, 'messages'], [`${myTasks.filter(t => t.status === 'completed').length}/${myTasks.length}`, 'tasks done']].map(([v, l]) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', font: `500 12px ${MONO}` }}><span style={{ color: '#8a807a' }}>{l}</span><span style={{ color: '#eee3da' }}>{v}</span></div>
            ))}
          </div>
        </div>
        {/* actions */}
        {!member.isLead && (
          <div style={{ ...PANEL, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {member.status === 'planning' && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input value={feedback} onChange={e => setFeedback(e.target.value)} placeholder="plan feedback (optional for approve, required to reject)"
                  style={{ flex: 1, background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(94,179,246,0.3)', borderRadius: 8, color: '#f6efe9', padding: '8px 10px', font: `400 12px ${MONO}` }} />
                <button onClick={() => act('plan', { approve: true, feedback })} style={{ background: 'rgba(63,185,106,0.15)', color: '#3fb96a', border: '1px solid rgba(63,185,106,0.35)', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', font: `600 12px ${MONO}` }}>approve plan</button>
                <button onClick={() => feedback.trim() ? act('plan', { approve: false, feedback }) : alert('feedback required to reject')} style={{ background: 'rgba(229,72,77,0.12)', color: '#e5484d', border: '1px solid rgba(229,72,77,0.3)', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', font: `600 12px ${MONO}` }}>reject</button>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={msg} onChange={e => setMsg(e.target.value)} placeholder={`message ${member.name}…`}
                onKeyDown={e => { if (e.key === 'Enter' && msg.trim()) { act('message', { text: msg }); setMsg('') } }}
                style={{ flex: 1, background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#f6efe9', padding: '8px 10px', font: "400 13px 'IBM Plex Sans'" }} />
              <button onClick={() => { if (msg.trim()) { act('message', { text: msg }); setMsg('') } }} style={{ background: 'linear-gradient(135deg,#d97757,#b8532f)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', font: "600 12px 'IBM Plex Sans'" }}>send</button>
              <button onClick={() => act('interrupt')} title="interrupt current turn" style={{ background: 'rgba(229,160,58,0.12)', color: '#e5a03a', border: '1px solid rgba(229,160,58,0.3)', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', font: `600 12px ${MONO}` }}>interrupt</button>
              <button onClick={() => confirm(`Request graceful shutdown of ${member.name}?`) && act('shutdown')} style={{ background: 'rgba(229,72,77,0.12)', color: '#e5484d', border: '1px solid rgba(229,72,77,0.3)', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', font: `600 12px ${MONO}` }}>shut down</button>
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  )
}

// ---------- empty state ----------
function Empty({ teams, onPick }) {
  return (
    <div style={{ ...PANEL, maxWidth: 640, padding: '30px 34px' }}>
      <div style={{ font: `600 18px ${HEAD}`, marginBottom: 10 }}>No agent team active</div>
      <div style={{ font: "400 13.5px 'IBM Plex Sans'", color: '#b0a69e', lineHeight: 1.65 }}>
        Agent teams is an experimental Claude Code feature where a lead session spawns teammates that share a task list and message each other. To use it:
      </div>
      <ol style={{ font: `400 12.5px ${MONO}`, color: '#c8bdb4', lineHeight: 2, paddingLeft: 20 }}>
        <li>enable the flag: <code style={{ color: '#e8a06a' }}>{'{"env":{"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS":"1"}}'}</code> in settings.json</li>
        <li>start a Claude Code session and ask it to <i>“create an agent team to …”</i></li>
        <li>this page picks up the team from <code style={{ color: '#e8a06a' }}>~/.claude/teams/</code> automatically</li>
      </ol>
      {teams.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ font: `600 11px ${MONO}`, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8a807a', marginBottom: 8 }}>Past teams on disk</div>
          {teams.map(t => (
            <div key={t} onClick={() => onPick(t)} style={{ font: `500 12px ${MONO}`, color: '#e8a06a', padding: '5px 0', cursor: 'pointer' }}>⧉ {t}</div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- main section ----------
export default function TeamsSection() {
  const [data, setData] = useState(null)
  const [team, setTeam] = useState('') // '' = newest
  const [selected, setSelected] = useState(null)
  useEffect(() => {
    let live = true
    const load = () => api.get('/api/team' + (team ? '?team=' + encodeURIComponent(team) : '')).then(d => live && setData(d)).catch(() => {})
    load()
    const t = setInterval(load, 2000)
    return () => { live = false; clearInterval(t) }
  }, [team])

  if (!data) return <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>loading…</div>
  if (!data.team) return <Empty teams={data.teams || []} onPick={setTeam} />

  const { members, tasks, messages } = data
  const leadName = members.find(m => m.isLead)?.name
  const active = members.filter(m => !m.isLead && (m.status === 'working' || m.status === 'planning')).length
  const idle = members.filter(m => !m.isLead && m.status === 'idle').length
  const done = tasks.filter(t => t.status === 'completed').length
  const inProg = tasks.filter(t => t.status === 'in_progress').length
  const byId = Object.fromEntries(tasks.map(t => [t.id, t]))
  const blocked = tasks.filter(t => t.status !== 'completed' && (t.blockedBy || []).some(id => byId[id]?.status !== 'completed')).length
  const leadMsgs = messages.filter(m => m.from === leadName || m.to === leadName).length
  const tokens = members.reduce((s, m) => s + (m.tokens || 0), 0)
  const selMember = members.find(m => m.name === selected)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ margin: 0, font: `600 27px ${HEAD}`, letterSpacing: '-0.02em' }}>{data.team.name}</h1>
          <span style={{ font: `500 11px ${MONO}`, letterSpacing: '0.06em', padding: '2px 8px', borderRadius: 6, background: 'rgba(139,124,246,0.15)', color: '#a78bfa' }}>experimental</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {(data.teams || []).length > 1 && (
            <select value={team || data.team.name} onChange={e => setTeam(e.target.value)} style={{ background: 'rgba(28,24,21,0.6)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 11, color: '#c8bdb4', padding: '8px 12px', font: `500 12px ${MONO}` }}>
              {data.teams.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 14px', borderRadius: 11, background: 'rgba(28,24,21,0.6)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: data.live ? '#3fb96a' : '#6a6f78', boxShadow: data.live ? '0 0 8px #3fb96a' : 'none', animation: data.live ? 'blink 2.4s infinite' : 'none' }} />
            <span style={{ font: `500 12px ${MONO}`, color: '#c8bdb4' }}>{data.live ? 'team live' : 'inactive'} · {rel(data.team.createdAt)}</span>
          </div>
          <button onClick={() => alert('Teammates are spawned by the lead session.\nAsk the lead: "spawn a teammate to …"')} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 11, border: 'none', background: 'linear-gradient(135deg,#d97757,#b8532f)', color: '#fff', font: "600 13px 'IBM Plex Sans'", cursor: 'pointer', boxShadow: '0 0 22px -6px rgba(217,119,87,0.7)' }}>+ Spawn teammate</button>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14 }}>
        <Kpi label="Teammates" value={active} unit={`/ ${members.length - 1}`} color="#d97757" sub={`${idle} idle · lead ${st(members.find(m => m.isLead)?.status).color === '#6a6f78' ? 'idle' : 'active'}`} delay="0s" />
        <Kpi label="Tasks" value={done} unit={`/ ${tasks.length}`} color="#3fb96a" sub={`${inProg} in progress · ${blocked} blocked`} delay="0.05s" />
        <Kpi label="Messages" value={messages.length} color="#8b7cf6" sub={`${leadMsgs} lead · ${messages.length - leadMsgs} peer-to-peer`} delay="0.1s" />
        <Kpi label="Tokens" value={fmtTok(tokens)} color="#e8a06a" sub={`~${fmtTok(Math.round(tokens / Math.max(active, 1)))} / active teammate`} delay="0.15s" />
        <Kpi label="Uptime" value={rel(data.team.createdAt)} color="#5eb3f6" sub={`spawned ${new Date(data.team.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`} delay="0.2s" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16 }}>
        <Graph members={members} messages={messages} selected={selected} onSelect={setSelected} />
        <Roster members={members} selected={selected} onSelect={setSelected} />
      </div>

      <TaskBoard tasks={tasks} members={members} />

      <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 16 }}>
        <Mailbox messages={messages} members={members} />
        <Analytics members={members} messages={messages} tasks={tasks} />
      </div>

      {selMember && <AgentDetail team={data.team.name} member={selMember} members={members} messages={messages} tasks={tasks} onClose={() => setSelected(null)} />}
    </div>
  )
}
