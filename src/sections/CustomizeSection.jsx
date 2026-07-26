import React, { useEffect, useMemo, useState } from 'react'
import { api, toast } from '../lib/api.js'

// ---------- Customize — one place to manage skills / commands / subagents / rules / mcp / hooks / plugins ----------
// Presentation only: the inventory + real enable/disable live behind /api/customize (server/index.mjs). A toggle
// here renames the file / edits the config that Claude actually reads, so "off" means Claude skips it — never
// a cosmetic flag. The existing Capabilities → Skills/Commands/Agents editors stay for deep editing.
const MONO = "var(--mono)"
const HEAD = "var(--head)"
const CATS = [
  { key: 'skills', label: 'Skills', icon: '◍', color: 'var(--violet)' },
  { key: 'mcp', label: 'MCPs', icon: '⚡', color: 'var(--green)' },
  { key: 'agents', label: 'Subagents', icon: '⬡', color: 'var(--blue)' },
  { key: 'rules', label: 'Rules', icon: '⚖', color: 'var(--amber)' },
  { key: 'commands', label: 'Commands', icon: '⌘', color: 'var(--blue)' },
  { key: 'hooks', label: 'Hooks', icon: '⑂', color: 'var(--pink)' },
  { key: 'plugins', label: 'Plugins', icon: '✦', color: 'var(--blue)' },
]
const META = Object.fromEntries(CATS.map(c => [c.key, c]))
const idOf = i => `${i.kind}:${i.scope}:${i.name}:${i.ref || ''}`
const DELETABLE = new Set(['skills', 'commands', 'agents', 'mcp'])

function Toggle({ on, busy, onClick }) {
  return (
    <button onClick={onClick} disabled={busy} title={on ? 'enabled — click to disable' : 'disabled — click to enable'}
      style={{ width: 38, height: 22, borderRadius: 6, border: 'none', cursor: busy ? 'wait' : 'pointer', padding: 0, position: 'relative', flexShrink: 0, background: on ? 'var(--green)' : 'var(--bg-surface-active)', opacity: busy ? 0.5 : 1, transition: 'background .18s' }}>
      <span style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 18, height: 18, borderRadius: 6, background: '#fff', transition: 'left .18s', boxShadow: 'var(--shadow-sm)' }} />
    </button>
  )
}

function Card({ item, busy, onToggle, onDelete, onCopy }) {
  const [menu, setMenu] = useState(false)
  const m = META[item.kind]
  const dot = item.enabled ? 'var(--green)' : 'var(--text-tertiary)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderBottom: '1px solid var(--border-subtle)' }}>
      <div style={{ position: 'relative', width: 34, height: 34, borderRadius: 6, background: m.color + '22', color: m.color, display: 'grid', placeItems: 'center', font: `600 14px ${HEAD}`, flexShrink: 0 }}>
        {m.icon}
        <span style={{ position: 'absolute', right: -2, bottom: -2, width: 9, height: 9, borderRadius: 5, background: dot, border: '2px solid var(--bg-base)' }} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ font: `500 14px ${MONO}`, color: item.enabled ? 'var(--text-primary)' : 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</span>
          <span style={{ font: `500 9px ${MONO}`, padding: '1px 6px', borderRadius: 4, background: 'var(--bg-surface-hover)', color: 'var(--text-secondary)', flexShrink: 0 }}>{item.scope}</span>
          {item.tokens > 0 && <span style={{ font: `400 9px ${MONO}`, color: 'var(--text-tertiary)', flexShrink: 0 }}>{item.tokens > 999 ? (item.tokens / 1000).toFixed(1) + 'k' : item.tokens} tok</span>}
        </div>
        {item.description && <div style={{ font: `400 11px var(--body)`, color: 'var(--text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>{item.description}</div>}
      </div>
      <Toggle on={item.enabled} busy={busy} onClick={() => onToggle(item)} />
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <button onClick={() => setMenu(v => !v)} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', font: `700 16px ${MONO}`, padding: '0 4px', lineHeight: 1 }}>⋯</button>
        {menu && (
          <>
            <div onClick={() => setMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 9 }} />
            <div style={{ position: 'absolute', right: 0, top: 22, zIndex: 10, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 6, padding: 4, minWidth: 150, boxShadow: 'var(--shadow-md)' }}>
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
  <button onClick={onClick} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '7px 10px', borderRadius: 6, font: `400 12px var(--body)`, color: danger ? 'var(--red)' : 'var(--text-primary)' }}
    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-surface-hover)'} onMouseLeave={e => e.currentTarget.style.background = 'none'}>{label}</button>
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
        <div style={{ display: 'flex', gap: 12, padding: '14px 16px', borderRadius: 6, border: '1px solid var(--blue)', background: 'linear-gradient(160deg,var(--bg-surface),var(--bg-inset))' }}>
          <span style={{ fontSize: 16 }}>✦</span>
          <div style={{ flex: 1 }}>
            <div style={{ font: `600 14px ${HEAD}`, color: 'var(--text-primary)' }}>Customize</div>
            <div style={{ font: `400 12px var(--body)`, color: 'var(--text-secondary)', marginTop: 2 }}>Enable, disable and manage skills, commands, subagents, rules, MCPs, hooks and plugins in one place. A toggle here changes what Claude actually loads.</div>
          </div>
          <button onClick={() => { setBanner(false); localStorage.setItem('customize-banner', 'off') }} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 16, alignSelf: 'flex-start' }}>×</button>
        </div>
      )}

      <input placeholder="Search everything you can customize…" value={q} onChange={e => setQ(e.target.value)}
        style={{ width: '100%', boxSizing: 'border-box', padding: '11px 15px', borderRadius: 6, border: '1px solid var(--blue)', background: 'var(--bg-base)', color: 'var(--text-primary)', font: `400 13px var(--body)`, outline: 'none' }} />

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        {[['all', 'All', null], ...CATS.map(c => [c.key, c.label, c.color])].map(([k, label, color]) => {
          const on = pill === k
          const n = k === 'all' ? Object.values(counts).reduce((a, b) => a + b, 0) : counts[k]
          return (
            <button key={k} onClick={() => setPill(k)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 13px', borderRadius: 999, cursor: 'pointer', font: `500 13px var(--body)`, border: `1px solid ${on ? (color || 'var(--blue)') + '88' : 'var(--bg-surface-active)'}`, background: on ? (color || 'var(--blue)') + '1e' : 'transparent', color: on ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
              {label}<span style={{ font: `500 10px ${MONO}`, color: 'var(--text-tertiary)' }}>{n || 0}</span>
            </button>
          )
        })}
      </div>

      {err && <div style={{ color: 'var(--red)', font: `400 12px ${MONO}` }}>error: {err}</div>}
      {!data && !err && <div style={{ color: 'var(--text-tertiary)', font: `400 12px ${MONO}`, padding: 20 }}>loading…</div>}

      {data && cats.map(kind => {
        const items = visible(kind)
        if (!items.length) return pill === 'all' ? null : <div key={kind} style={{ color: 'var(--text-tertiary)', font: `400 12px ${MONO}`, padding: 12 }}>Nothing under {META[kind].label}{q ? ' matching your search' : ''}.</div>
        return (
          <div key={kind} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: pill === 'all' ? 8 : 0 }}>
              <span style={{ color: META[kind].color, fontSize: 13 }}>{META[kind].icon}</span>
              <span style={{ font: `600 13px ${HEAD}`, color: 'var(--text-primary)' }}>{META[kind].label}</span>
              <span style={{ font: `500 11px ${MONO}`, color: 'var(--text-tertiary)' }}>{items.length}</span>
              <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)' }}>· {items.filter(i => i.enabled).length} on</span>
            </div>
            {groupsOf(items).map(([group, rows]) => (
              <div key={group} style={{ borderRadius: 6, border: '1px solid var(--blue)', background: 'linear-gradient(160deg,var(--bg-surface),var(--bg-inset))', overflow: 'hidden' }}>
                {groupsOf(items).length > 1 && <div style={{ font: `600 9px ${MONO}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-tertiary)', padding: '8px 14px 2px' }}>{group} · {rows.length}</div>}
                {rows.map(i => <Card key={idOf(i)} item={i} busy={busy === idOf(i)} onToggle={toggle} onDelete={del} onCopy={copy} />)}
              </div>
            ))}
          </div>
        )
      })}
      <p style={{ font: `400 11px var(--body)`, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
        Toggling is real and reversible: skills, commands, subagents and rules are disabled by renaming their file to <code style={{ font: `400 10px ${MONO}` }}>.off</code> (Claude then skips them); MCPs are parked out of <code style={{ font: `400 10px ${MONO}` }}>mcpServers</code>; plugins flip <code style={{ font: `400 10px ${MONO}` }}>enabledPlugins</code>; hooks move between the active and disabled hook lists. Every write is backed up first. Deep editing still lives in Capabilities → Skills / Commands / Agents.
      </p>
    </div>
  )
}
