import React, { useEffect, useMemo, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { api, tildify, fmtDate } from '../lib/api.js'

const MONO = "var(--mono)"
const HEAD = "var(--head)"
const PANEL = { background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 8, padding: 12 }
const kTok = n => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(Math.round(n ?? 0)))
const TYPE = {
  rule: 'var(--accent)', skill: 'var(--accent-light)', agent: 'var(--violet)', mcp: 'var(--blue)', adr: 'var(--green)', ref: 'var(--text-secondary)',
  system: 'var(--accent)', rules: 'var(--accent)', reference: 'var(--text-secondary)',
}
const SEV = { error: 'var(--red)', warning: 'var(--accent-light)', info: 'var(--text-secondary)' }
const OVR = () => <span style={{ font: `600 9px ${MONO}`, padding: '1px 6px', borderRadius: 5, background: 'var(--accent-bg)', color: 'var(--accent-light)' }}>OVR</span>

const CardTitle = ({ children, hint }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14, gap: 10 }}>
    <div style={{ font: `600 14px ${HEAD}` }}>{children}</div>
    {hint && <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)', textAlign: 'right' }}>{hint}</span>}
  </div>
)
const ScopeChip = ({ scope }) => scope === 'project'
  ? <span style={{ font: `600 8px ${MONO}`, padding: '1px 5px', borderRadius: 4, background: 'var(--accent-bg)', color: 'var(--accent-light)' }}>PROJ</span>
  : <span style={{ font: `600 8px ${MONO}`, padding: '1px 5px', borderRadius: 4, background: 'var(--bg-surface-hover)', color: 'var(--text-secondary)' }}>GLOBAL</span>

export default function ProjectHub({ project }) {
  const [d, setD] = useState(null)
  const [sel, setSel] = useState(null) // selected graph node id
  const [file, setFile] = useState(null) // {path, content}
  const [replay, setReplay] = useState(null)
  const [replayId, setReplayId] = useState(null)
  const load = () => api.get('/api/hub?project=' + encodeURIComponent(project)).then(setD).catch(() => {})
  useEffect(() => { setD(null); setSel(null); load() }, [project])
  // graph layout: center = project rules (or global), others on ellipse grouped by type
  const C = { x: 320, y: 205 }
  const gnodes = d?.graph.nodes || []
  const centerId = gnodes.find(n => n.type === 'rule' && n.label !== 'global rules')?.id || 'rules:global'
  const pos = useMemo(() => {
    const p = { [centerId]: C }
    const order = ['rule', 'skill', 'agent', 'mcp', 'adr', 'ref']
    const sorted = gnodes.filter(n => n.id !== centerId).sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))
    sorted.forEach((n, i) => {
      const ang = -Math.PI / 2 + (i * 2 * Math.PI) / sorted.length
      p[n.id] = { x: Math.round(C.x + 245 * Math.cos(ang)), y: Math.round(C.y + 155 * Math.sin(ang)) }
    })
    return p
  }, [gnodes.map(n => n.id).join()])
  if (!d) return <div style={{ font: `400 12px ${MONO}`, color: 'var(--text-tertiary)' }}>resolving project harness…</div>

  const openFile = p => p && api.get('/api/hub/file?path=' + encodeURIComponent(p)).then(setFile).catch(e => alert(e.message))
  const inv = d.inventory
  const healthDash = (194.8 * (1 - d.health / 100)).toFixed(1)
  const budgetPct = Math.min(100, Math.round((d.budget.alwaysOn / d.budget.softCap) * 100))
  const errs = d.findings.filter(f => f.severity === 'error').length
  const warns = d.findings.filter(f => f.severity === 'warning').length

  // ---- budget grouping ----
  const byKind = {}
  for (const c of d.budget.contributors) {
    const k = (byKind[c.kind] ||= { kind: c.kind, always: 0, onInvoke: 0, n: 0 })
    k.n++
    if (c.mode === 'always') k.always += c.tokens
    else if (c.mode === 'on-invoke') { k.always += c.tokens; k.onInvoke += c.onInvoke || 0 } // skill descriptions are always-loaded metadata
  }
  const segOrder = ['system', 'rules', 'skill', 'mcp']
  const segs = segOrder.filter(k => byKind[k]).map(k => ({ ...byKind[k], color: TYPE[k], label: k === 'skill' ? `skill metadata (${byKind[k].n})` : k === 'mcp' ? `MCP tool defs (${byKind[k].n})` : k }))
  const modeCols = [
    { title: 'always loaded', color: 'var(--accent)', items: d.budget.contributors.filter(c => c.mode === 'always').sort((a, b) => b.tokens - a.tokens).slice(0, 6), note: kTok(d.budget.alwaysOn) + ' total' },
    { title: 'on-invoke', color: 'var(--violet)', items: d.budget.contributors.filter(c => c.mode === 'on-invoke').sort((a, b) => (b.onInvoke || 0) - (a.onInvoke || 0)).slice(0, 6), note: kTok(d.budget.onInvoke) + ' if all fired' },
    { title: 'on-demand', color: 'var(--blue)', items: d.budget.contributors.filter(c => c.mode === 'on-demand').slice(0, 6), note: 'fetched when cited' },
  ]

  const W = 640, HT = 420
  const connected = new Set(sel ? d.graph.edges.filter(e => e.a === sel || e.b === sel).flatMap(e => [e.a, e.b]) : [])
  const selNode = d.graph.nodes.find(n => n.id === sel)

  const runReplay = id => {
    setReplayId(id); setReplay(null)
    api.get(`/api/hub/session?project=${encodeURIComponent(project)}&id=${id}`).then(setReplay).catch(() => setReplay({ error: true }))
  }

  const Item = ({ onClick, children, title }) => (
    <div role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} title={title}
      onClick={onClick} onKeyDown={e => onClick && e.key === 'Enter' && onClick()}
      style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 0', borderBottom: '1px solid var(--border-subtle)', cursor: onClick ? 'pointer' : 'default', minWidth: 0 }}>
      {children}
    </div>
  )

  return (
    <div className="hx" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* PHASE 1 — overview strip */}
      <div className="hx-overview">
        <div style={{ ...PANEL, display: 'flex', alignItems: 'center', gap: 16 }}>
          <svg width="76" height="76" viewBox="0 0 76 76">
            <circle cx="38" cy="38" r="31" fill="none" strokeWidth="7"  style={{ stroke: 'var(--text-secondary)' }} />
            <circle cx="38" cy="38" r="31" fill="none" strokeWidth="7" strokeLinecap="round" strokeDasharray="194.8" strokeDashoffset={healthDash} transform="rotate(-90 38 38)" style={{ stroke: (d.health >= 70 ? 'var(--green)' : d.health >= 45 ? 'var(--accent-light)' : 'var(--red)'), transition: 'stroke-dashoffset .5s' }} />
            <text x="38" y="36" textAnchor="middle" style={{ font: `600 18px ${HEAD}`, fill: 'var(--text-primary)' }}>{d.health}</text>
            <text x="38" y="50" textAnchor="middle" style={{ font: `500 9px ${MONO}`, fill: 'var(--text-secondary)' }}>/100</text>
          </svg>
          <div>
            <div style={{ font: `600 11px ${MONO}`, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Project harness health</div>
            <div style={{ marginTop: 6, font: "500 13px var(--body)", color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              {d.findings.length === 0 ? 'No findings — clean harness.' : `${errs} error${errs === 1 ? '' : 's'} · ${warns} warning${warns === 1 ? '' : 's'} · ${d.findings.length - errs - warns} notes — see audit below`}
            </div>
          </div>
        </div>
        {[
          ['Always-on context', kTok(d.budget.alwaysOn), budgetPct > 100 ? 'var(--red)' : 'var(--accent)', `${budgetPct}% of ${kTok(d.budget.softCap)} soft cap`],
          ['Artifacts', inv.skills.length + inv.agents.length + inv.mcps.length, 'var(--text-primary)', `${inv.skills.length} skills · ${inv.agents.length} agents · ${inv.mcps.length} MCPs`],
          ['Rules layers', inv.rules.filter(r => r.exists).length, 'var(--violet)', 'in load order'],
          ['Overrides', d.harness.overridden.length, d.harness.overridden.length ? 'var(--accent-light)' : 'var(--text-primary)', 'fields set at project scope'],
        ].map(([label, value, color, sub]) => (
          <div key={label} style={{ ...PANEL, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 7 }}>
            <span style={{ font: `600 11px ${MONO}`, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>{label}</span>
            <div style={{ font: `600 20px ${HEAD}`, color }}>{value}</div>
            <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* PHASE 1 — context budget composition */}
      <div style={{ ...PANEL }}>
        <CardTitle hint={`always-on ${kTok(d.budget.alwaysOn)} / ${kTok(d.budget.softCap)} soft cap${d.budget.alwaysOn > d.budget.softCap ? ' — over budget' : ''}`}>Context budget composition</CardTitle>
        <div style={{ display: 'flex', height: 13, borderRadius: 7, overflow: 'hidden', background: 'var(--bg-surface-hover)', marginBottom: 10 }}>
          {segs.map(s => (
            <div key={s.label} title={`${s.label}: ${kTok(s.always)}`} style={{ width: `${(s.always / Math.max(d.budget.alwaysOn, d.budget.softCap) * 100).toFixed(1)}%`, background: s.color, transformOrigin: 'left', animation: 'grow .7s cubic-bezier(.2,.8,.2,1) both' }} />
          ))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 18 }}>
          {segs.map(s => (
            <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 7, font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: s.color }} />{s.label} <span style={{ color: 'var(--text-tertiary)' }}>{kTok(s.always)}</span>
            </span>
          ))}
        </div>
        <div className="hx-2" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          {modeCols.map(col => (
            <div key={col.title}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9, paddingBottom: 8, borderBottom: '1px solid var(--border-default)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: col.color }} />
                <span style={{ font: `600 10px ${MONO}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>{col.title}</span>
                <span style={{ marginLeft: 'auto', font: `400 10px ${MONO}`, color: 'var(--text-tertiary)' }}>{col.note}</span>
              </div>
              {col.items.map((c, ci) => (
                <div key={ci + c.kind + c.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, font: `400 11px ${MONO}`, color: 'var(--text-secondary)', padding: '3px 0' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ color: TYPE[c.kind] || 'var(--text-secondary)' }}>●</span> {c.name}{c.est ? ' ~' : ''}
                  </span>
                  <span style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}>{c.mode === 'on-invoke' ? `${kTok(c.tokens)} + ${kTok(c.onInvoke || 0)}` : c.mode === 'on-demand' ? '0' : kTok(c.tokens)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* PHASE 1 — prompt preview + graph */}
      <div className="hx-2a">
        <div style={{ ...PANEL, padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '15px 20px', borderBottom: '1px solid var(--border-default)' }}>
            <span style={{ font: `600 14px ${HEAD}` }}>Effective prompt preview</span>
            <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>{d.promptBlocks.length} blocks · merged in load order</span>
          </div>
          <div style={{ maxHeight: 430, overflowY: 'auto' }}>
            {d.promptBlocks.map((b, i) => (
              <div key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 20px 0', font: `400 10px ${MONO}` }}>
                  <span style={{ color: b.layer === 'project' ? 'var(--accent-light)' : 'var(--violet)' }}>{b.source}</span>
                  <span style={{ color: 'var(--text-tertiary)' }}>·</span>
                  <span style={{ color: b.relation === 'overrides' ? 'var(--red)' : 'var(--green)' }}>{b.relation}</span>
                  {b.layer === 'project' && <OVR />}
                  <button className="mini" style={{ marginLeft: 'auto', marginTop: 0 }} onClick={() => openFile(b.path)}>edit</button>
                </div>
                <pre style={{ margin: 0, padding: '6px 20px 12px', font: `400 12px/1.65 ${MONO}`, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{b.text.trim()}</pre>
              </div>
            ))}
            {d.promptBlocks.length === 0 && <div style={{ padding: 20, font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>no rules files found</div>}
          </div>
        </div>

        <div style={{ ...PANEL, position: 'relative' }}>
          <CardTitle hint="click a node to inspect">Relationship graph</CardTitle>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', font: `400 10px ${MONO}`, color: 'var(--text-secondary)', marginBottom: 4 }}>
            {['rule', 'skill', 'agent', 'mcp', 'adr', 'ref'].map(t => (
              <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: TYPE[t] }} />{t}</span>
            ))}
          </div>
          <svg viewBox={`0 0 ${W} ${HT}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
            {d.graph.edges.map((e, i) => {
              const p = pos[e.a], q = pos[e.b]
              if (!p || !q) return null
              const dim = sel && !(e.a === sel || e.b === sel)
              return <path key={i} d={`M ${p.x} ${p.y} L ${q.x} ${q.y}`} fill="none" stroke={dim ? 'var(--bg-surface-hover)' : 'var(--accent-bg)'} strokeWidth="1.3" strokeDasharray="4 4" style={dim ? {} : { animation: 'dash 1.1s linear infinite' }} />
            })}
            {d.graph.nodes.map(n => {
              const p = pos[n.id]
              if (!p) return null
              const dim = sel && sel !== n.id && !connected.has(n.id)
              const isC = n.id === centerId
              return (
                <g key={n.id} onClick={() => setSel(sel === n.id ? null : n.id)} style={{ cursor: 'pointer', opacity: dim ? 0.25 : 1 }}>
                  <circle cx={p.x} cy={p.y} r={isC ? 22 : 14} strokeWidth={sel === n.id ? 2.5 : 1.5}  style={{ fill: (TYPE[n.type]), stroke: (sel === n.id ? 'var(--text-primary)' : 'var(--bg-surface-active)') }} />
                  <text x={p.x} y={p.y + 4} textAnchor="middle" style={{ font: `600 ${isC ? 12 : 10}px ${HEAD}`, fill: 'var(--bg-base)' }}>{n.label.charAt(0).toUpperCase()}</text>
                  <text x={p.x} y={p.y > C.y ? p.y + (isC ? 36 : 27) : p.y - (isC ? 30 : 21)} textAnchor="middle" style={{ font: `500 10px ${MONO}`, fill: dim ? 'var(--text-tertiary)' : 'var(--text-secondary)' }}>{n.label.slice(0, 20)}</text>
                </g>
              )
            })}
          </svg>
          {selNode && (
            <div style={{ position: 'absolute', bottom: 14, left: 20, right: 20, display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 6, background: 'var(--bg-base)', border: '1px solid var(--border-default)', font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: TYPE[selNode.type], flexShrink: 0 }} />
              <b>{selNode.label}</b>
              <span style={{ color: 'var(--text-tertiary)' }}>{d.graph.edges.filter(e => e.a === sel || e.b === sel).map(e => e.rel + ' ' + (e.a === sel ? d.graph.nodes.find(n => n.id === e.b)?.label : d.graph.nodes.find(n => n.id === e.a)?.label)).slice(0, 3).join(' · ') || 'no edges'}</span>
              {selNode.path && <button className="mini" style={{ marginLeft: 'auto', marginTop: 0 }} onClick={() => openFile(selNode.path)}>open</button>}
            </div>
          )}
        </div>
      </div>

      {/* PHASE 2 — inventory */}
      <div className="hx-2">
        <div style={{ ...PANEL }}>
          <CardTitle hint={`${inv.skills.length} available · sorted by recency`}>Skills</CardTitle>
          {[...inv.skills].sort((a, b) => b.mtime - a.mtime).slice(0, 8).map(s => (
            <Item key={s.scope + s.name} onClick={() => openFile(s.path)} title={s.trigger}>
              <span style={{ color: TYPE.skill }}>✦</span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: `500 12px ${MONO}`, color: 'var(--text-primary)' }}>{s.name}</span>
              <ScopeChip scope={s.scope} />
              <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)', flexShrink: 0 }}>{kTok(s.descTokens)} idle · {kTok(s.fullTokens)} loaded</span>
            </Item>
          ))}
          {inv.skills.length > 8 && <div style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)', paddingTop: 8 }}>+ {inv.skills.length - 8} more in the Skills section</div>}
        </div>
        <div style={{ ...PANEL }}>
          <CardTitle hint={`${inv.agents.length} defined`}>Agents / subagents</CardTitle>
          {inv.agents.slice(0, 8).map(a => (
            <Item key={a.scope + a.name} onClick={() => openFile(a.path)} title={a.desc}>
              <span style={{ color: TYPE.agent }}>◆</span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: `500 12px ${MONO}`, color: 'var(--text-primary)' }}>{a.name}</span>
              <ScopeChip scope={a.scope} />
              <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)', flexShrink: 0 }}>{a.model} · {a.tools.length || 'all'} tools · depth {a.depth}</span>
            </Item>
          ))}
          {inv.agents.length > 8 && <div style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)', paddingTop: 8 }}>+ {inv.agents.length - 8} more in the Agents section</div>}
        </div>
      </div>

      <div className="hx-2">
        <div style={{ ...PANEL }}>
          <CardTitle hint="load order · top wins nothing — later appends">Rules stack</CardTitle>
          {inv.rules.map(r => (
            <Item key={r.label} onClick={r.exists ? () => openFile(r.file) : undefined}>
              <span style={{ color: r.exists ? TYPE.rule : 'var(--text-tertiary)' }}>{r.exists ? '▤' : '○'}</span>
              <span style={{ flex: 1, font: `500 12px ${MONO}`, color: r.exists ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>{r.label}</span>
              {r.layer === 'project' && r.exists && <OVR />}
              <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)' }}>{r.exists ? kTok(r.tokens) + ' tok' : 'not present'}</span>
            </Item>
          ))}
          <div style={{ marginTop: 10, font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>effective result = all existing layers concatenated in this order (see prompt preview)</div>
        </div>
        <div style={{ ...PANEL }}>
          <CardTitle hint={inv.adrs.length ? `${inv.adrs.length} decisions` : 'no docs/adr directory'}>ADRs</CardTitle>
          {inv.adrs.slice(0, 8).map(a => (
            <Item key={a.id} onClick={() => openFile(a.path)} title={a.constrains}>
              <span style={{ font: `600 9px ${MONO}`, padding: '1px 6px', borderRadius: 4, flexShrink: 0, color: a.status === 'accepted' ? 'var(--green)' : a.status === 'superseded' ? 'var(--red)' : 'var(--accent-light)', background: 'var(--bg-surface-hover)' }}>{a.status.toUpperCase()}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: "500 12px var(--body)", color: 'var(--text-primary)' }}>{a.title}</span>
            </Item>
          ))}
          {inv.adrs.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>create docs/adr/*.md to track decisions — accepted ADRs feed the prompt preview and audit</div>}
        </div>
      </div>

      <div className="hx-2">
        <div style={{ ...PANEL }}>
          <CardTitle hint={`${inv.mcps.length} connected`}>MCP servers</CardTitle>
          {inv.mcps.map(m => (
            <Item key={m.scope + m.name}>
              <span style={{ color: TYPE.mcp }}>⇌</span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: `500 12px ${MONO}`, color: 'var(--text-primary)' }}>{m.name}</span>
              <ScopeChip scope={m.scope} />
              <span style={{ font: `400 10px ${MONO}`, color: m.usedBy.length ? 'var(--text-tertiary)' : 'var(--accent-light)', flexShrink: 0 }}>
                {m.transport} · {m.usedBy.length ? `used by ${m.usedBy.length}` : 'unreferenced'}
              </span>
            </Item>
          ))}
          {inv.mcps.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>none configured</div>}
        </div>
        <div style={{ ...PANEL }}>
          <CardTitle hint={`${inv.references.length} cited`}>References &amp; memory</CardTitle>
          {inv.references.slice(0, 5).map(r => (
            <Item key={r.url}>
              <span style={{ color: TYPE.ref }}>↗</span>
              <a href={r.url} target="_blank" rel="noreferrer" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: `400 12px ${MONO}`, color: 'var(--blue)', textDecoration: 'none' }}>{r.url.replace(/^https?:\/\//, '')}</a>
              <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)', flexShrink: 0 }}>cited by {r.citedBy.map(c => c.name).slice(0, 2).join(', ')}</span>
            </Item>
          ))}
          <div style={{ height: 8 }} />
          {inv.memory.map(m => (
            <Item key={m.name} onClick={m.path && !m.dir ? () => openFile(m.path) : undefined}>
              <span style={{ color: m.persists ? 'var(--green)' : 'var(--text-secondary)' }}>{m.persists ? '◈' : '◇'}</span>
              <span style={{ flex: 1, font: `500 12px ${MONO}`, color: 'var(--text-primary)' }}>{m.name}</span>
              <span style={{ font: `400 10px ${MONO}`, color: m.persists ? 'var(--green)' : 'var(--text-secondary)' }}>{m.persists ? 'persists' : 'ephemeral'}</span>
            </Item>
          ))}
        </div>
      </div>

      {/* PHASE 3 — trigger map + audit */}
      <div className="hx-2">
        <div style={{ ...PANEL }}>
          <CardTitle hint="event → activation">Trigger map</CardTitle>
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {d.triggers.map((t, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border-subtle)', font: `400 11px ${MONO}` }}>
                <span style={{ font: `600 8px ${MONO}`, padding: '1px 5px', borderRadius: 4, flexShrink: 0, color: t.kind === 'hook' ? 'var(--violet)' : t.kind === 'skill' ? 'var(--accent-light)' : 'var(--blue)', background: 'var(--bg-surface-hover)' }}>{t.kind.toUpperCase()}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{t.event}</span>
                <span style={{ color: 'var(--text-tertiary)' }}>→</span>
                <span style={{ maxWidth: '38%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{t.target}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ ...PANEL }}>
          <CardTitle hint={`drives the ${d.health}/100 score`}>Conflict &amp; redundancy audit</CardTitle>
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {d.findings.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: 'var(--green)' }}>✓ no conflicts, redundancy, or gaps found</div>}
            {d.findings.map((f, i) => (
              <div key={i} role={f.artifact?.path ? 'button' : undefined} tabIndex={f.artifact?.path ? 0 : undefined}
                onClick={() => f.artifact?.path && openFile(f.artifact.path)}
                onKeyDown={e => e.key === 'Enter' && f.artifact?.path && openFile(f.artifact.path)}
                style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border-subtle)', cursor: f.artifact?.path ? 'pointer' : 'default' }}>
                <span style={{ font: `600 9px ${MONO}`, padding: '1px 6px', borderRadius: 4, height: 'fit-content', flexShrink: 0, color: SEV[f.severity], background: 'var(--bg-surface-hover)' }}>{f.severity.toUpperCase()}</span>
                <span style={{ flex: 1, font: "400 12px var(--body)", color: 'var(--text-secondary)', lineHeight: 1.45 }}>{f.text}{f.artifact?.path && <span style={{ color: 'var(--text-tertiary)', font: `400 10px ${MONO}` }}> — open ↗</span>}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* PHASE 3 — session replay */}
      <div style={{ ...PANEL }}>
        <CardTitle hint="which config actually fired, per session">Session replay / provenance</CardTitle>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {d.sessions.map(s => (
            <button key={s.id} onClick={() => runReplay(s.id)} style={{
              font: `400 11px ${MONO}`, padding: '5px 11px', borderRadius: 8, cursor: 'pointer',
              border: `1px solid ${replayId === s.id ? 'var(--accent-bg)' : 'var(--bg-surface-active)'}`,
              background: replayId === s.id ? 'var(--accent-bg)' : 'var(--bg-surface)', color: replayId === s.id ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}>{fmtDate(s.mtime)}</button>
          ))}
          {d.sessions.length === 0 && <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>no sessions recorded for this project</span>}
        </div>
        {replayId && !replay && <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>parsing transcript…</div>}
        {replay && !replay.error && (
          <div className="hx-2" style={{ gridTemplateColumns: '1fr 1fr 1.2fr' }}>
            <div>
              <div style={{ font: `600 10px ${MONO}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 8 }}>Skills fired</div>
              {replay.skills.length ? replay.skills.map(s => <div key={s} style={{ font: `400 12px ${MONO}`, color: 'var(--accent-light)', padding: '2px 0' }}>✦ {s}</div>) : <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>none</span>}
              <div style={{ font: `600 10px ${MONO}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-secondary)', margin: '12px 0 8px' }}>Agents spawned</div>
              {replay.agents.length ? replay.agents.slice(0, 6).map((a, i) => <div key={i} style={{ font: `400 12px ${MONO}`, color: 'var(--violet)', padding: '2px 0' }}>◆ {String(a).slice(0, 40)}</div>) : <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>none</span>}
            </div>
            <div>
              <div style={{ font: `600 10px ${MONO}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 8 }}>Session</div>
              {[[replay.msgs, 'assistant turns'], [replay.compactions, 'compactions'], [replay.first ? Math.round((replay.last - replay.first) / 60000) + 'm' : '—', 'duration'], [inv.rules.filter(r => r.exists).length + ' layers', 'rules in effect (current stack)']].map(([v, l]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', font: `500 12px ${MONO}`, padding: '3px 0' }}><span style={{ color: 'var(--text-secondary)' }}>{l}</span><span style={{ color: 'var(--text-primary)' }}>{v}</span></div>
              ))}
            </div>
            <div>
              <div style={{ font: `600 10px ${MONO}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 8 }}>Tool usage</div>
              {Object.entries(replay.tools).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, n]) => {
                const max = Math.max(...Object.values(replay.tools))
                return (
                  <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
                    <span style={{ width: 130, font: `400 11px ${MONO}`, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name.replace(/^mcp__.*__/, 'mcp:')}</span>
                    <div style={{ flex: 1, height: 7, borderRadius: 4, background: 'var(--bg-surface-hover)' }}><div style={{ height: '100%', width: `${(n / max) * 100}%`, borderRadius: 4, background: 'var(--blue)' }} /></div>
                    <span style={{ width: 26, textAlign: 'right', font: `400 10px ${MONO}`, color: 'var(--text-tertiary)' }}>{n}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* artifact file editor drawer */}
      {file && (
        <>
          <div className="drawer-overlay" onClick={() => setFile(null)} />
          <div className="drawer" role="dialog" aria-label="edit artifact" style={{ width: 620 }}>
            <div className="drawer-head">
              <h3 style={{ font: `600 13px ${MONO}` }}>{tildify(file.path)}</h3>
              <button className="ghost" onClick={() => setFile(null)} aria-label="close">✕</button>
            </div>
            <div className="drawer-body" style={{ padding: 0 }}>
              <CodeMirror value={file.content} height="100%" theme="dark"
                extensions={[file.path.endsWith('.json') ? json() : markdown()]}
                onChange={v => setFile(f => ({ ...f, content: v }))} className="editor" />
            </div>
            <div className="drawer-foot">
              <button onClick={() => setFile(null)}>Cancel</button>
              <button className="primary" onClick={() => api.put('/api/hub/file', file).then(() => { setFile(null); load() }).catch(e => alert(e.message))}>Save</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
