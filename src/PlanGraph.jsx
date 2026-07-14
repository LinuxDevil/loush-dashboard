import React, { useEffect, useMemo, useState } from 'react'
import { api } from './api.js'
import { planLayout } from './plan.js'

const MONO = "'IBM Plex Mono', monospace"
const HEAD = "'Space Grotesk', sans-serif"
const PANEL = { background: 'rgba(28,24,21,0.55)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: '18px 20px', backdropFilter: 'blur(10px)' }
const C = { skill: '#d97757', rule: '#e5a03a', mcp: '#3fb96a', tool: '#5eb3f6' }
const CW = 212, CH = 132, COLW = 262, ROWH = 156, PAD = 20

const Chip = ({ type, label, onClick }) => (
  <span onClick={onClick} title={`${type}: ${label}`}
    style={{ font: `500 9.5px ${MONO}`, padding: '2px 7px', borderRadius: 5, cursor: onClick ? 'pointer' : 'default',
      color: C[type], background: `${C[type]}18`, border: `1px solid ${C[type]}40`, whiteSpace: 'nowrap', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis' }}>
    {label}
  </span>
)

export default function PlanGraph({ steps, cwd, derived, diagnostics }) {
  const [hub, setHub] = useState(null)   // { promptBlocks, skillScope: {name->scope} }
  const [mcps, setMcps] = useState({})   // name -> config
  const [sel, setSel] = useState(null)   // selected step_id
  const [chip, setChip] = useState(null) // { type, name, body, loading }
  const [drill, setDrill] = useState([]) // stack of { label, steps } — drilling into subagent graphs

  // new session / plan → reset the whole view
  useEffect(() => { setDrill([]); setSel(null); setChip(null) }, [steps])
  const activeSteps = drill.length ? drill[drill.length - 1].steps : steps

  useEffect(() => {
    if (!cwd) return
    api.get('/api/hub?project=' + encodeURIComponent(cwd)).then(h => {
      const skillScope = Object.fromEntries((h.inventory?.skills || []).map(s => [s.name, s.scope]))
      setHub({ promptBlocks: h.promptBlocks || [], skillScope })
    }).catch(() => setHub({ promptBlocks: [], skillScope: {} }))
    api.get('/api/mcp').then(list => setMcps(Object.fromEntries(list.map(m => [m.name, m.config])))).catch(() => {})
  }, [cwd])

  const { pos, W, H } = useMemo(() => {
    // Explicit `column` (derived activity graphs) wins; otherwise lay out by dependency depth (real plans).
    const useCol = activeSteps.some(s => typeof s.column === 'number')
    const { depth } = useCol ? { depth: null } : planLayout(activeSteps)
    const colOf = s => useCol ? (s.column || 0) : (depth.get(s.step_id) || 0)
    const rowOf = {}
    const pos = new Map()
    for (const s of [...activeSteps].sort((a, b) => a.step_id - b.step_id)) {
      const c = colOf(s)
      const row = rowOf[c] = (rowOf[c] ?? -1) + 1
      pos.set(s.step_id, { x: PAD + c * COLW, y: PAD + row * ROWH })
    }
    const cols = Math.max(0, ...activeSteps.map(colOf)) + 1
    const rows = Math.max(1, ...Object.values(rowOf).map(r => r + 1))
    return { pos, W: PAD * 2 + cols * COLW, H: PAD * 2 + rows * ROWH }
  }, [activeSteps])

  const openChip = (type, name) => {
    if (type === 'mcp') return setChip({ type, name, body: JSON.stringify(mcps[name] ?? { note: 'not configured' }, null, 2) })
    if (type === 'rule') {
      const blk = (hub?.promptBlocks || []).find(b => b.heading.toLowerCase().includes(String(name).toLowerCase()))
      return setChip({ type, name, body: blk ? blk.text : 'No matching CLAUDE.md section found.' })
    }
    if (type === 'tool') return setChip({ type, name, body: `Tool: ${name}\n(built-in — no source file; see the step's params)` })
    // skill: fetch the SKILL.md body on demand
    const scope = hub?.skillScope?.[name] || 'user'
    setChip({ type, name, loading: true })
    api.get(`/api/res/skills/item?scope=${scope}&name=${encodeURIComponent(name)}`)
      .then(r => setChip({ type, name, body: r.body || r.content || '(empty)' }))
      .catch(() => setChip({ type, name, body: `Skill "${name}" not found in ${scope} scope.` }))
  }

  const byId = new Map(activeSteps.map(s => [s.step_id, s]))
  const selStep = sel != null ? byId.get(sel) : null
  const openSubgraph = s => { setDrill([...drill, { label: (s.description || 'subagent').split(':')[0].split(' (')[0], steps: s.subplan }]); setSel(null); setChip(null) }

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <div style={{ ...PANEL, flex: 1, overflow: 'auto', maxHeight: '70vh' }}>
        <div style={{ font: `600 14px ${HEAD}`, marginBottom: drill.length ? 6 : 12 }}>{drill.length ? 'Subagent graph' : derived ? 'Session activity' : 'Execution plan'} <span style={{ font: `400 11px ${MONO}`, color: '#8a807a' }}>{activeSteps.length} {drill.length || derived ? 'actions · left→right = turns · top→bottom = order' : 'steps · left→right = dependency order'} · click a step, then a chip</span></div>
        {drill.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', font: `500 11px ${MONO}`, marginBottom: 12 }}>
            <span onClick={() => { setDrill([]); setSel(null); setChip(null) }} style={{ cursor: 'pointer', color: '#8a807a' }}>{derived ? 'session' : 'plan'}</span>
            {drill.map((d, i) => (
              <React.Fragment key={i}>
                <span style={{ color: '#5a514a' }}>›</span>
                <span onClick={() => { setDrill(drill.slice(0, i + 1)); setSel(null); setChip(null) }} style={{ cursor: 'pointer', color: i === drill.length - 1 ? '#a78bfa' : '#8a807a' }}>◆ {d.label}</span>
              </React.Fragment>
            ))}
          </div>
        )}
        {drill.length === 0 && diagnostics && diagnostics.length > 0 && (
          <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ font: `600 11px ${HEAD}`, color: '#f6efe9' }}>Diagnosis <span style={{ font: `400 10px ${MONO}`, color: '#8a807a' }}>what could be better</span></div>
            {diagnostics.map((d, i) => {
              const col = d.level === 'warn' ? '#e5a03a' : d.level === 'good' ? '#3fb96a' : '#5eb3f6'
              return (
                <div key={i} style={{ display: 'flex', gap: 8, padding: '6px 9px', borderRadius: 8, background: `${col}12`, border: `1px solid ${col}30` }}>
                  <span style={{ color: col, flexShrink: 0 }}>{d.level === 'warn' ? '▲' : d.level === 'good' ? '✓' : 'ℹ'}</span>
                  <div>
                    <div style={{ font: `600 11px ${HEAD}`, color: '#e8ded6' }}>{d.title}</div>
                    <div style={{ font: `400 10.5px ${MONO}`, color: '#8a807a' }}>{d.detail}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <div style={{ position: 'relative', width: W, height: H }}>
          <svg width={W} height={H} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            {activeSteps.flatMap(s => (s.dependencies || []).filter(d => byId.has(d)).map(d => {
              const p = pos.get(d), t = pos.get(s.step_id)
              if (!p || !t) return null
              const lit = sel === d || sel === s.step_id
              const stroke = lit ? '#f6efe9' : 'rgba(255,255,255,0.22)', sw = lit ? 2 : 1.3
              // same column → connect bottom→top (vertical thread); different columns → right→left
              const sameCol = Math.abs(p.x - t.x) < 1
              const dpath = sameCol
                ? (() => { const x1 = p.x + CW / 2, y1 = p.y + CH, x2 = t.x + CW / 2, y2 = t.y, my = (y1 + y2) / 2; return `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}` })()
                : (() => { const x1 = p.x + CW, y1 = p.y + 26, x2 = t.x, y2 = t.y + 26, mx = (x1 + x2) / 2; return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}` })()
              return <path key={d + '-' + s.step_id} d={dpath} fill="none" stroke={stroke} strokeWidth={sw} markerEnd="url(#pg-arrow)" />
            }))}
            <defs><marker id="pg-arrow" markerWidth="7" markerHeight="7" refX="5.5" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 z" fill="rgba(255,255,255,0.35)" /></marker></defs>
          </svg>
          {activeSteps.map(s => {
            const p = pos.get(s.step_id), isSel = sel === s.step_id
            const hasSub = s.subplan && s.subplan.length > 0
            return (
              <div key={s.step_id} onClick={() => setSel(isSel ? null : s.step_id)} onDoubleClick={() => hasSub && openSubgraph(s)}
                style={{ position: 'absolute', left: p.x, top: p.y, width: CW, height: CH, boxSizing: 'border-box',
                  cursor: 'pointer', borderRadius: 12, padding: '9px 11px', overflow: 'hidden',
                  background: 'rgba(20,17,15,0.9)', border: `1px solid ${isSel ? '#f6efe9' : hasSub ? 'rgba(167,139,250,0.5)' : 'rgba(255,255,255,0.12)'}`,
                  boxShadow: isSel ? '0 0 0 1px #f6efe9' : 'none', transition: 'border-color .15s' }}>
                <div style={{ font: `600 11px ${HEAD}`, color: '#f6efe9', marginBottom: 4 }}>
                  <span style={{ color: '#8a807a' }}>#{s.step_id}</span> {hasSub ? <span style={{ color: '#a78bfa' }}>◆ </span> : ''}{s.description || '(no description)'}
                </div>
                {s.tool_to_call && <div style={{ font: `500 10px ${MONO}`, color: C.tool, marginBottom: 3 }}>▸ {s.tool_to_call}</div>}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {(s.expected_skill || []).map(n => <Chip key={'s' + n} type="skill" label={n} />)}
                  {(s.active_rules || []).map(n => <Chip key={'r' + n} type="rule" label={n} />)}
                  {s.mcp_server && <Chip type="mcp" label={s.mcp_server} />}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {(selStep || chip) && (
        <div style={{ ...PANEL, width: 340, maxHeight: '70vh', overflow: 'auto', flexShrink: 0 }}>
          {chip ? (
            <>
              <button className="mini" style={{ marginTop: 0, marginBottom: 10 }} onClick={() => setChip(null)}>‹ back to step</button>
              <div style={{ font: `600 13px ${HEAD}`, color: C[chip.type], marginBottom: 8 }}>{chip.type}: {chip.name}</div>
              {chip.loading ? <div style={{ font: `400 11px ${MONO}`, color: '#8a807a' }}>loading…</div>
                : <pre style={{ font: `400 10.5px ${MONO}`, color: '#c9bfb7', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{chip.body}</pre>}
            </>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                <div style={{ font: `600 14px ${HEAD}`, color: '#f6efe9' }}>Step #{selStep.step_id}</div>
                <button className="mini" style={{ marginTop: 0 }} onClick={() => setSel(null)}>✕</button>
              </div>
              <div style={{ font: `400 12px ${HEAD}`, color: '#c9bfb7', marginBottom: 12 }}>{selStep.description}</div>
              <Field label="Tool" v={selStep.tool_to_call} onClick={selStep.tool_to_call ? () => openChip('tool', selStep.tool_to_call) : null} color={C.tool} />
              <Field label="MCP server" v={selStep.mcp_server} onClick={selStep.mcp_server ? () => openChip('mcp', selStep.mcp_server) : null} color={C.mcp} />
              <ChipRow label="Skills" items={selStep.expected_skill} type="skill" onClick={openChip} />
              <ChipRow label="Rules" items={selStep.active_rules} type="rule" onClick={openChip} />
              <ChipRow label="Depends on" items={(selStep.dependencies || []).map(String)} type="tool" onClick={(_, n) => setSel(Number(n))} />
              {selStep.subplan && selStep.subplan.length > 0 && (
                <button className="mini" style={{ marginTop: 4, marginBottom: 4, color: '#a78bfa', borderColor: 'rgba(167,139,250,0.4)' }} onClick={() => openSubgraph(selStep)}>
                  ◆ open subagent graph ({selStep.subplan.length} actions) →
                </button>
              )}
              {selStep.expected_params && Object.keys(selStep.expected_params).length > 0 && (
                <>
                  <div style={{ font: `600 10px ${MONO}`, color: '#8a807a', textTransform: 'uppercase', margin: '12px 0 5px' }}>Params</div>
                  <pre style={{ font: `400 10.5px ${MONO}`, color: '#c9bfb7', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{JSON.stringify(selStep.expected_params, null, 2)}</pre>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

const Field = ({ label, v, onClick, color }) => v ? (
  <div style={{ marginBottom: 8 }}>
    <div style={{ font: `600 10px ${MONO}`, color: '#8a807a', textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
    <Chip type={label === 'Tool' ? 'tool' : 'mcp'} label={v} onClick={onClick} />
  </div>
) : null

const ChipRow = ({ label, items, type, onClick }) => (items && items.length) ? (
  <div style={{ marginBottom: 8 }}>
    <div style={{ font: `600 10px ${MONO}`, color: '#8a807a', textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {items.map(n => <Chip key={n} type={type} label={n} onClick={() => onClick(type, n)} />)}
    </div>
  </div>
) : null
