import React, { useEffect, useMemo, useState } from 'react'
import { api, toast } from '../lib/api.js'

// ---------- Customize — one place to manage skills / commands / subagents / rules / mcp / hooks / plugins ----------
// Presentation only: the inventory + real enable/disable live behind /api/customize (server/index.mjs). A toggle
// here renames the file / edits the config that Claude actually reads, so "off" means Claude skips it — never
// a cosmetic flag. The existing Capabilities → Skills/Commands/Agents editors stay for deep editing.
const MONO = "'IBM Plex Mono', monospace"
const HEAD = "'Space Grotesk', sans-serif"
const CATS = [
  { key: 'skills', label: 'Skills', icon: '◍', color: '#a894f0' },
  { key: 'mcp', label: 'MCPs', icon: '⚡', color: '#5fd39a' },
  { key: 'agents', label: 'Subagents', icon: '⬡', color: '#5eb3f6' },
  { key: 'rules', label: 'Rules', icon: '⚖', color: '#f5c451' },
  { key: 'commands', label: 'Commands', icon: '⌘', color: '#8ec8ff' },
  { key: 'hooks', label: 'Hooks', icon: '⑂', color: '#f2a2c4' },
  { key: 'plugins', label: 'Plugins', icon: '✦', color: '#7c9bd6' },
]
const META = Object.fromEntries(CATS.map(c => [c.key, c]))
const idOf = i => `${i.kind}:${i.scope}:${i.name}:${i.ref || ''}`
const DELETABLE = new Set(['skills', 'commands', 'agents', 'mcp'])

function Toggle({ on, busy, onClick }) {
  return (
    <button onClick={onClick} disabled={busy} title={on ? 'enabled — click to disable' : 'disabled — click to enable'}
      style={{ width: 38, height: 22, borderRadius: 11, border: 'none', cursor: busy ? 'wait' : 'pointer', padding: 0, position: 'relative', flexShrink: 0, background: on ? '#3fb96a' : 'rgba(255,255,255,0.14)', opacity: busy ? 0.5 : 1, transition: 'background .18s' }}>
      <span style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 18, height: 18, borderRadius: 9, background: '#fff', transition: 'left .18s', boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }} />
    </button>
  )
}

function Card({ item, busy, onToggle, onDelete, onCopy }) {
  const [menu, setMenu] = useState(false)
  const m = META[item.kind]
  const dot = item.enabled ? '#3fb96a' : '#5c554f'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <div style={{ position: 'relative', width: 34, height: 34, borderRadius: 9, background: m.color + '22', color: m.color, display: 'grid', placeItems: 'center', font: `600 15px ${HEAD}`, flexShrink: 0 }}>
        {m.icon}
        <span style={{ position: 'absolute', right: -2, bottom: -2, width: 9, height: 9, borderRadius: 5, background: dot, border: '2px solid #0d1117' }} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ font: `500 13.5px ${MONO}`, color: item.enabled ? '#e7eef6' : '#8a807a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</span>
          <span style={{ font: `500 8.5px ${MONO}`, padding: '1px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.06)', color: '#9a8f86', flexShrink: 0 }}>{item.scope}</span>
          {item.tokens > 0 && <span style={{ font: `400 9px ${MONO}`, color: '#6a615a', flexShrink: 0 }}>{item.tokens > 999 ? (item.tokens / 1000).toFixed(1) + 'k' : item.tokens} tok</span>}
        </div>
        {item.description && <div style={{ font: `400 11px 'IBM Plex Sans'`, color: '#7f8578', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>{item.description}</div>}
      </div>
      <Toggle on={item.enabled} busy={busy} onClick={() => onToggle(item)} />
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <button onClick={() => setMenu(v => !v)} style={{ background: 'none', border: 'none', color: '#7f8578', cursor: 'pointer', font: `700 16px ${MONO}`, padding: '0 4px', lineHeight: 1 }}>⋯</button>
        {menu && (
          <>
            <div onClick={() => setMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 9 }} />
            <div style={{ position: 'absolute', right: 0, top: 22, zIndex: 10, background: '#1c1815', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 9, padding: 4, minWidth: 150, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
              <MenuItem label={item.enabled ? 'Disable' : 'Enable'} onClick={() => { setMenu(false); onToggle(item) }} />
              {item.path && <MenuItem label="Copy path" onClick={() => { setMenu(false); onCopy(item.path) }} />}
              {DELETABLE.has(item.kind) && <MenuItem label="Delete…" danger onClick={() => { setMenu(false); onDelete(item) }} />}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
const MenuItem = ({ label, danger, onClick }) => (
  <button onClick={onClick} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '7px 10px', borderRadius: 6, font: `400 12px 'IBM Plex Sans'`, color: danger ? '#f2777a' : '#d8cfc7' }}
    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'} onMouseLeave={e => e.currentTarget.style.background = 'none'}>{label}</button>
)

export default function CustomizeSection() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [pill, setPill] = useState('all')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(null) // id being toggled
  const [banner, setBanner] = useState(() => localStorage.getItem('customize-banner') !== 'off')

  const load = () => api.get('/api/customize').then(d => { setData(d); setErr('') }).catch(e => setErr(e.message))
  useEffect(() => { load() }, [])

  const counts = useMemo(() => Object.fromEntries(CATS.map(c => [c.key, (data?.[c.key] || []).length])), [data])
  const cats = pill === 'all' ? CATS.map(c => c.key) : [pill]

  const visible = kind => {
    const ql = q.trim().toLowerCase()
    return (data?.[kind] || []).filter(i => !ql || (i.name + ' ' + (i.description || '')).toLowerCase().includes(ql))
      .sort((a, b) => a.name.localeCompare(b.name))
  }
  const groupsOf = items => { // group by item.group, preserving first-seen order
    const g = new Map()
    for (const i of items) { const k = i.group || 'other'; (g.get(k) || g.set(k, []).get(k)).push(i) }
    return [...g.entries()]
  }

  const toggle = async item => {
    const id = idOf(item), next = !item.enabled
    setBusy(id)
    // optimistic
    setData(d => ({ ...d, [item.kind]: d[item.kind].map(x => idOf(x) === id ? { ...x, enabled: next } : x) }))
    try {
      const r = await api.post('/api/customize/toggle', { kind: item.kind, scope: item.scope, name: item.name, enable: next, ref: item.ref })
      if (r.error) throw new Error(r.error)
      toast(`${item.name} ${next ? 'enabled' : 'disabled'}`, 'success')
      load() // re-read truth (rename may have changed the backing path)
    } catch (e) {
      setData(d => ({ ...d, [item.kind]: d[item.kind].map(x => idOf(x) === id ? { ...x, enabled: !next } : x) }))
      toast('toggle failed: ' + e.message, 'error')
    } finally { setBusy(null) }
  }
  const del = async item => {
    if (!confirm(`Delete ${item.name}? A timestamped backup is made first.`)) return
    try {
      if (item.kind === 'mcp') await api.del(`/api/mcp/${encodeURIComponent(item.name)}`)
      else await api.del(`/api/res/${item.kind}/item?scope=${item.scope}&name=${encodeURIComponent(item.name)}`)
      toast(`${item.name} deleted`, 'success'); load()
    } catch (e) { toast('delete failed: ' + e.message, 'error') }
  }
  const copy = p => { navigator.clipboard?.writeText(p).catch(() => {}); toast('path copied', 'success') }

  const wrap = { maxWidth: 1080, margin: '0 auto' }
  return (
    <div style={{ ...wrap, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {banner && (
        <div style={{ display: 'flex', gap: 12, padding: '14px 16px', borderRadius: 12, border: '1px solid rgba(142,200,255,0.12)', background: 'linear-gradient(160deg,rgba(19,27,38,0.9),rgba(11,16,23,0.7))' }}>
          <span style={{ fontSize: 16 }}>✦</span>
          <div style={{ flex: 1 }}>
            <div style={{ font: `600 14px ${HEAD}`, color: '#eef4fb' }}>Customize</div>
            <div style={{ font: `400 12px 'IBM Plex Sans'`, color: '#9fb0c2', marginTop: 2 }}>Enable, disable and manage skills, commands, subagents, rules, MCPs, hooks and plugins in one place. A toggle here changes what Claude actually loads.</div>
          </div>
          <button onClick={() => { setBanner(false); localStorage.setItem('customize-banner', 'off') }} style={{ background: 'none', border: 'none', color: '#7f8ea1', cursor: 'pointer', fontSize: 16, alignSelf: 'flex-start' }}>×</button>
        </div>
      )}

      <input placeholder="Search everything you can customize…" value={q} onChange={e => setQ(e.target.value)}
        style={{ width: '100%', boxSizing: 'border-box', padding: '11px 15px', borderRadius: 11, border: '1px solid rgba(142,200,255,0.14)', background: 'rgba(10,15,22,0.7)', color: '#e7eef6', font: `400 13px 'IBM Plex Sans'`, outline: 'none' }} />

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        {[['all', 'All', null], ...CATS.map(c => [c.key, c.label, c.color])].map(([k, label, color]) => {
          const on = pill === k
          const n = k === 'all' ? Object.values(counts).reduce((a, b) => a + b, 0) : counts[k]
          return (
            <button key={k} onClick={() => setPill(k)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 13px', borderRadius: 999, cursor: 'pointer', font: `500 12.5px 'IBM Plex Sans'`, border: `1px solid ${on ? (color || '#8ec8ff') + '88' : 'rgba(255,255,255,0.1)'}`, background: on ? (color || '#8ec8ff') + '1e' : 'transparent', color: on ? '#eaf1f9' : '#93a2b4' }}>
              {label}<span style={{ font: `500 10px ${MONO}`, color: '#6a7686' }}>{n || 0}</span>
            </button>
          )
        })}
      </div>

      {err && <div style={{ color: '#f2777a', font: `400 12px ${MONO}` }}>error: {err}</div>}
      {!data && !err && <div style={{ color: '#7f8578', font: `400 12px ${MONO}`, padding: 20 }}>loading…</div>}

      {data && cats.map(kind => {
        const items = visible(kind)
        if (!items.length) return pill === 'all' ? null : <div key={kind} style={{ color: '#7f8578', font: `400 12px ${MONO}`, padding: 12 }}>Nothing under {META[kind].label}{q ? ' matching your search' : ''}.</div>
        return (
          <div key={kind} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: pill === 'all' ? 8 : 0 }}>
              <span style={{ color: META[kind].color, fontSize: 13 }}>{META[kind].icon}</span>
              <span style={{ font: `600 13px ${HEAD}`, color: '#eaf1f9' }}>{META[kind].label}</span>
              <span style={{ font: `500 11px ${MONO}`, color: '#6a7686' }}>{items.length}</span>
              <span style={{ font: `400 10px ${MONO}`, color: '#5c6675' }}>· {items.filter(i => i.enabled).length} on</span>
            </div>
            {groupsOf(items).map(([group, rows]) => (
              <div key={group} style={{ borderRadius: 12, border: '1px solid rgba(142,200,255,0.09)', background: 'linear-gradient(160deg,rgba(19,27,38,0.7),rgba(11,16,23,0.5))', overflow: 'hidden' }}>
                {groupsOf(items).length > 1 && <div style={{ font: `600 9px ${MONO}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#6a7686', padding: '8px 14px 2px' }}>{group} · {rows.length}</div>}
                {rows.map(i => <Card key={idOf(i)} item={i} busy={busy === idOf(i)} onToggle={toggle} onDelete={del} onCopy={copy} />)}
              </div>
            ))}
          </div>
        )
      })}
      <p style={{ font: `400 11px 'IBM Plex Sans'`, color: '#647285', lineHeight: 1.6 }}>
        Toggling is real and reversible: skills, commands, subagents and rules are disabled by renaming their file to <code style={{ font: `400 10px ${MONO}` }}>.off</code> (Claude then skips them); MCPs are parked out of <code style={{ font: `400 10px ${MONO}` }}>mcpServers</code>; plugins flip <code style={{ font: `400 10px ${MONO}` }}>enabledPlugins</code>; hooks move between the active and disabled hook lists. Every write is backed up first. Deep editing still lives in Capabilities → Skills / Commands / Agents.
      </p>
    </div>
  )
}
