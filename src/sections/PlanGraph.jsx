import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import { planLayout, turnMetrics, filesTouched } from '../lib/plan.js'
import { ParamView, ResultSection, KVTable, StatusDot, statusOf, STATUS } from '../ui/planWidgets.jsx'

const fmtTok = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n)
const fmtDur = ms => ms == null ? null : ms >= 60000 ? Math.round(ms / 60000) + 'm' : ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms'

const MONO = "var(--mono)"
const HEAD = "var(--head)"
const PANEL = { background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 8, padding: 12 }
const C = { skill: 'var(--accent)', rule: 'var(--amber)', mcp: 'var(--green)', tool: 'var(--blue)' }
const CW = 212, CH = 132, COLW = 262, ROWH = 156, PAD = 20

const Chip = ({ type, label, onClick }) => (
  <span onClick={onClick} title={`${type}: ${label}`}
    style={{ font: `500 10px ${MONO}`, padding: '2px 7px', borderRadius: 5, cursor: onClick ? 'pointer' : 'default',
      color: C[type], background: `${C[type]}18`, border: `1px solid ${C[type]}40`, whiteSpace: 'nowrap', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis' }}>
    {label}
  </span>
)

export default function PlanGraph({ steps, cwd, derived, diagnostics }) {
  const [hub, setHub] = useState(null)   // { promptBlocks, skillScope: {name->scope} }
  const [mcps, setMcps] = useState({})   // name -> config
  const [sel, setSel] = useState(null)   // selected step_id
  const [chip, setChip] = useState(null) // { type, name, body|obj, loading }
  const [drill, setDrill] = useState([]) // stack of { label, steps } — drilling into subagent graphs
  const [hi, setHi] = useState(null)     // Set of step_ids highlighted from a diagnosis finding
  const [lane, setLane] = useState(null) // null | 'files' | 'cost' — docked aggregate panel

  // new session / plan → reset the whole view
  useEffect(() => { setDrill([]); setSel(null); setChip(null); setHi(null) }, [steps])
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
    if (type === 'mcp') return setChip({ type, name, obj: mcps[name] ?? { note: 'not configured' } })
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
  // activity/subagent graphs (steps carry `column`) render as a flow-laid timeline; real plans keep the DAG
  const useTimeline = activeSteps.some(s => typeof s.column === 'number')
  const metrics = useMemo(() => turnMetrics(activeSteps), [activeSteps])
  const files = useMemo(() => lane === 'files' ? filesTouched(activeSteps) : [], [lane, activeSteps])

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <div style={{ ...PANEL, flex: 1, overflow: 'auto', maxHeight: '70vh' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: drill.length ? 6 : 12, flexWrap: 'wrap' }}>
          <div style={{ font: `600 14px ${HEAD}` }}>{drill.length ? 'Subagent graph' : derived ? 'Session activity' : 'Execution plan'} <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>{activeSteps.length} {useTimeline ? 'actions · grouped by turn, in execution order' : 'steps · left→right = dependency order'} · click a step for details</span></div>
          {useTimeline && <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button className="mini" style={{ marginTop: 0, color: lane === 'files' ? 'var(--blue)' : undefined }} onClick={() => setLane(lane === 'files' ? null : 'files')}>▤ files</button>
            <button className="mini" style={{ marginTop: 0, color: lane === 'cost' ? 'var(--blue)' : undefined }} onClick={() => setLane(lane === 'cost' ? null : 'cost')}>◫ cost</button>
          </div>}
        </div>
        {drill.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', font: `500 11px ${MONO}`, marginBottom: 12 }}>
            <span onClick={() => { setDrill([]); setSel(null); setChip(null) }} style={{ cursor: 'pointer', color: 'var(--text-secondary)' }}>{derived ? 'session' : 'plan'}</span>
            {drill.map((d, i) => (
              <React.Fragment key={i}>
                <span style={{ color: 'var(--text-tertiary)' }}>›</span>
                <span onClick={() => { setDrill(drill.slice(0, i + 1)); setSel(null); setChip(null) }} style={{ cursor: 'pointer', color: i === drill.length - 1 ? 'var(--violet)' : 'var(--text-secondary)' }}>◆ {d.label}</span>
              </React.Fragment>
            ))}
          </div>
        )}
        {drill.length === 0 && diagnostics && diagnostics.length > 0 && (
          <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ font: `600 11px ${HEAD}`, color: 'var(--text-primary)' }}>Diagnosis <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-secondary)' }}>what could be better</span></div>
            {diagnostics.map((d, i) => {
              const col = d.level === 'warn' ? STATUS.warn : d.level === 'good' ? STATUS.ok : 'var(--blue)'
              const ids = d.stepIds || []
              const active = ids.length > 0
              return (
                <div key={i} onClick={() => { if (active) { setHi(new Set(ids)); setSel(ids[0]); setChip(null) } }}
                  style={{ display: 'flex', gap: 8, padding: '6px 9px', borderRadius: 8, background: `${col}12`, border: `1px solid ${col}30`, cursor: active ? 'pointer' : 'default' }}>
                  <span style={{ color: col, flexShrink: 0 }}>{d.level === 'warn' ? '▲' : d.level === 'good' ? '✓' : 'ℹ'}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ font: `600 11px ${HEAD}`, color: 'var(--text-primary)' }}>{d.title}{active && <span style={{ font: `500 10px ${MONO}`, color: col, marginLeft: 6 }}>→ {ids.length} step{ids.length > 1 ? 's' : ''}</span>}</div>
                    <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>{d.detail}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {useTimeline ? <ActivityTimeline steps={activeSteps} sel={sel} setSel={setSel} hi={hi} openSubgraph={openSubgraph} metrics={metrics} /> : <div style={{ position: 'relative', width: W, height: H }}>
          <svg width={W} height={H} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            {activeSteps.flatMap(s => (s.dependencies || []).filter(d => byId.has(d)).map(d => {
              const p = pos.get(d), t = pos.get(s.step_id)
              if (!p || !t) return null
              const lit = sel === d || sel === s.step_id
              const stroke = lit ? 'var(--text-primary)' : 'var(--bg-surface-active)', sw = lit ? 2 : 1.3
              // same column → connect bottom→top (vertical thread); different columns → right→left
              const sameCol = Math.abs(p.x - t.x) < 1
              const dpath = sameCol
                ? (() => { const x1 = p.x + CW / 2, y1 = p.y + CH, x2 = t.x + CW / 2, y2 = t.y, my = (y1 + y2) / 2; return `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}` })()
                : (() => { const x1 = p.x + CW, y1 = p.y + 26, x2 = t.x, y2 = t.y + 26, mx = (x1 + x2) / 2; return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}` })()
              return <path key={d + '-' + s.step_id} d={dpath} fill="none" strokeWidth={sw} markerEnd="url(#pg-arrow)"  style={{ stroke: (stroke) }} />
            }))}
            <defs><marker id="pg-arrow" markerWidth="7" markerHeight="7" refX="5.5" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 z"  style={{ fill: 'var(--text-secondary)' }} /></marker></defs>
          </svg>
          {activeSteps.map(s => {
            const p = pos.get(s.step_id), isSel = sel === s.step_id
            const hasSub = s.subplan && s.subplan.length > 0
            const lit = hi && hi.has(s.step_id)
            const st = statusOf(s)
            const border = isSel ? 'var(--text-primary)' : lit ? STATUS.warn : hasSub ? 'var(--violet-bg)' : st === 'error' ? `${STATUS.error}88` : 'var(--bg-surface-active)'
            return (
              <div key={s.step_id} onClick={() => setSel(isSel ? null : s.step_id)} onDoubleClick={() => hasSub && openSubgraph(s)}
                style={{ position: 'absolute', left: p.x, top: p.y, width: CW, height: CH, boxSizing: 'border-box',
                  cursor: 'pointer', borderRadius: 6, padding: '9px 11px', overflow: 'hidden',
                  background: 'var(--bg-surface)', border: `1px solid ${border}`,
                  boxShadow: isSel ? '0 0 0 1px var(--text-primary)' : lit ? `0 0 0 1px ${STATUS.warn}` : 'none', transition: 'border-color .15s' }}>
                <div style={{ position: 'absolute', top: 10, right: 10 }}><StatusDot status={st} title={st === 'error' ? 'errored' : 'ok'} /></div>
                <div style={{ font: `600 11px ${HEAD}`, color: 'var(--text-primary)', marginBottom: 4, paddingRight: 12 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>#{s.step_id}</span> {hasSub ? <span style={{ color: 'var(--violet)' }}>◆ </span> : ''}{s.description || '(no description)'}
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
        </div>}
      </div>

      {lane === 'files' && <FilesPanel files={files} onClose={() => setLane(null)} />}
      {lane === 'cost' && <CostPanel metrics={metrics} onClose={() => setLane(null)} />}

      {(selStep || chip) && (
        <div style={{ ...PANEL, width: 340, maxHeight: '70vh', overflow: 'auto', flexShrink: 0 }}>
          {chip ? (
            <>
              <button className="mini" style={{ marginTop: 0, marginBottom: 10 }} onClick={() => setChip(null)}>‹ back to step</button>
              <div style={{ font: `600 13px ${HEAD}`, color: C[chip.type], marginBottom: 8 }}>{chip.type}: {chip.name}</div>
              {chip.loading ? <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>loading…</div>
                : chip.obj != null ? <KVTable obj={chip.obj} />
                  : <pre style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{chip.body}</pre>}
            </>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                <div style={{ font: `600 14px ${HEAD}`, color: 'var(--text-primary)' }}>Step #{selStep.step_id}</div>
                <button className="mini" style={{ marginTop: 0 }} onClick={() => setSel(null)}>✕</button>
              </div>
              <div style={{ font: `400 12px ${HEAD}`, color: 'var(--text-secondary)', marginBottom: 10, display: 'flex', gap: 8, alignItems: 'baseline' }}>
                {statusOf(selStep) && <StatusDot status={statusOf(selStep)} />}
                <span>{selStep.description}</span>
              </div>
              {selStep.tool_to_call && <div style={{ marginBottom: 8 }}><span style={{ font: `500 10px ${MONO}`, color: C.tool, background: `${C.tool}18`, border: `1px solid ${C.tool}40`, borderRadius: 5, padding: '2px 7px' }}>▸ {selStep.tool_to_call}</span></div>}
              <Field label="MCP server" v={selStep.mcp_server} onClick={selStep.mcp_server ? () => openChip('mcp', selStep.mcp_server) : null} color={C.mcp} />
              <ChipRow label="Skills" items={selStep.expected_skill} type="skill" onClick={openChip} />
              <ChipRow label="Rules" items={selStep.active_rules} type="rule" onClick={openChip} />
              <ChipRow label="Depends on" items={(selStep.dependencies || []).map(String)} type="tool" onClick={(_, n) => setSel(Number(n))} />
              {selStep.subplan && selStep.subplan.length > 0 && (
                <button className="mini" style={{ marginTop: 4, marginBottom: 4, color: 'var(--violet)', borderColor: 'var(--violet)' }} onClick={() => openSubgraph(selStep)}>
                  ◆ open subagent graph ({selStep.subplan.length} actions) →
                </button>
              )}
              <div style={{ font: `600 10px ${MONO}`, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.4, margin: '12px 0 5px' }}>Params</div>
              <ParamView tool={selStep.tool_to_call} params={selStep.expected_params} />
              <ResultSection step={selStep} />
            </>
          )}
        </div>
      )}
    </div>
  )
}

const Field = ({ label, v, onClick, color }) => v ? (
  <div style={{ marginBottom: 8 }}>
    <div style={{ font: `600 10px ${MONO}`, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
    <Chip type={label === 'Tool' ? 'tool' : 'mcp'} label={v} onClick={onClick} />
  </div>
) : null

const ChipRow = ({ label, items, type, onClick }) => (items && items.length) ? (
  <div style={{ marginBottom: 8 }}>
    <div style={{ font: `600 10px ${MONO}`, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {items.map(n => <Chip key={n} type={type} label={n} onClick={() => onClick(type, n)} />)}
    </div>
  </div>
) : null

// ---- activity / subagent timeline (flow-laid; turn bands + compact rows) ----
const GLYPH = { Bash: '❯', Read: '▤', Edit: '✎', MultiEdit: '✎', Write: '＋', Grep: '⌕', Glob: '⌕', Task: '◆', Agent: '◆', Skill: '/', TaskCreate: '☑', TaskUpdate: '☑', TodoWrite: '☑' }
const glyphOf = s => s.subplan ? '◆' : GLYPH[s.tool_to_call] || (s.mcp_server ? '⬡' : '▸')
const hueOf = s => s.subplan ? 'var(--violet)' : (s.expected_skill && s.expected_skill.length) ? C.skill : s.mcp_server ? C.mcp : C.tool

function TimelineRow({ s, depth, sel, setSel, hi, openSubgraph }) {
  const [open, setOpen] = useState(false)
  const st = statusOf(s)
  const isSel = sel === s.step_id, lit = hi && hi.has(s.step_id)
  const hue = hueOf(s)
  const hasSub = s.subplan && s.subplan.length > 0
  const inlineable = hasSub && s.subplan.length <= 8
  return (
    <>
      <div onClick={() => setSel(isSel ? null : s.step_id)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, height: 30, padding: '0 10px 0 ' + (10 + depth * 16) + 'px', cursor: 'pointer',
          borderRadius: 7, background: isSel ? `${hue}1f` : lit ? `${STATUS.warn}1a` : 'transparent',
          boxShadow: isSel ? `inset 0 0 0 1px ${hue}` : lit ? `inset 0 0 0 1px ${STATUS.warn}80` : 'none' }}
        onMouseEnter={e => { if (!isSel && !lit) e.currentTarget.style.background = 'var(--bg-surface)' }}
        onMouseLeave={e => { if (!isSel && !lit) e.currentTarget.style.background = 'transparent' }}>
        <span style={{ width: 6, height: 6, borderRadius: 2, background: hue, flexShrink: 0 }} />
        <span style={{ font: `600 11px ${MONO}`, color: hue, width: 14, textAlign: 'center', flexShrink: 0 }}>{glyphOf(s)}</span>
        <span title={s.expected_params?.file_path || s.description} style={{ font: `500 11px ${MONO}`, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{s.description || s.tool_to_call}</span>
        {hasSub && (inlineable
          ? <button className="mini" style={{ marginTop: 0, padding: '1px 6px' }} onClick={e => { e.stopPropagation(); setOpen(!open) }}>{open ? '▾' : '▸'} {s.subplan.length}</button>
          : <button className="mini" style={{ marginTop: 0, padding: '1px 6px', color: 'var(--violet)' }} onClick={e => { e.stopPropagation(); openSubgraph(s) }}>◆ {s.subplan.length} →</button>)}
        <StatusDot status={st} title={st === 'error' ? 'errored' : 'ok'} />
      </div>
      {inlineable && open && s.subplan.map(c => <TimelineRow key={c.step_id} s={c} depth={depth + 1} sel={sel} setSel={setSel} hi={hi} openSubgraph={() => openSubgraph(s)} />)}
    </>
  )
}

const LANE = { ...PANEL, width: 300, maxHeight: '70vh', overflow: 'auto', flexShrink: 0 }
const LaneHead = ({ title, sub, onClose }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
    <div style={{ font: `600 14px ${HEAD}`, color: 'var(--text-primary)' }}>{title} {sub && <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-secondary)' }}>{sub}</span>}</div>
    <button className="mini" style={{ marginTop: 0 }} onClick={onClose}>✕</button>
  </div>
)

function FilesPanel({ files, onClose }) {
  return (
    <div style={LANE}>
      <LaneHead title="Files touched" sub={`${files.length}`} onClose={onClose} />
      {files.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>no files read or written</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {files.map(f => {
          const seg = f.path.split('/'), base = seg.pop()
          // keep the filename whole and let the leading directories be the thing that gets clipped —
          // truncating a long absolute path from the right hides the only part worth reading.
          const dir = seg.slice(-1).join('/')
          return (
            <div key={f.path} title={f.path} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', borderRadius: 6 }}>
              <span style={{ color: f.writes ? 'var(--accent)' : 'var(--blue)', font: `600 11px ${MONO}`, flexShrink: 0 }}>{f.writes ? '✎' : '▤'}</span>
              <span style={{ font: `500 11px ${MONO}`, whiteSpace: 'nowrap', overflow: 'hidden', flex: 1, minWidth: 0, display: 'flex', gap: 1 }}>
                <span style={{ color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{dir ? '…/' + dir + '/' : ''}</span>
                <span style={{ color: 'var(--text-primary)', flexShrink: 0 }}>{base}</span>
              </span>
              {f.reads > 0 && <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-secondary)' }}>{f.reads}r</span>}
              {f.added > 0 && <span style={{ font: `400 10px ${MONO}`, color: STATUS.ok }}>+{f.added}</span>}
              {f.removed > 0 && <span style={{ font: `400 10px ${MONO}`, color: STATUS.error }}>−{f.removed}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CostPanel({ metrics, onClose }) {
  const rows = [...metrics.entries()].sort((a, b) => a[0] - b[0]).map(([col, m]) => ({ col, ...m }))
  const total = rows.reduce((n, r) => n + r.tokens, 0)
  const cached = rows.reduce((n, r) => n + r.cached, 0)
  const maxT = Math.max(1, ...rows.map(r => r.tokens))
  return (
    <div style={LANE}>
      <LaneHead title="Tokens by turn" sub={total > 0 ? fmtTok(total) + ' fresh' : 'no usage data'} onClose={onClose} />
      {total === 0
        ? <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>No token usage in this transcript (older sessions and live streams omit it).</div>
        : <div style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)', marginBottom: 10 }}>input + output + cache writes. {fmtTok(cached)} read from cache.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {rows.map(r => (
          <div key={r.col}>
            <div style={{ display: 'flex', justifyContent: 'space-between', font: `400 10px ${MONO}`, color: 'var(--text-secondary)', marginBottom: 2 }}>
              <span>Turn {r.col + 1}</span>
              <span>{r.tokens > 0 ? fmtTok(r.tokens) + ' tok' : '—'}{fmtDur(r.ms) ? ` · ${fmtDur(r.ms)}` : ''}</span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-surface-hover)' }}>
              <div style={{ height: '100%', borderRadius: 3, width: `${Math.round((r.tokens / maxT) * 100)}%`, background: 'var(--blue)' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ActivityTimeline({ steps, sel, setSel, hi, openSubgraph, metrics }) {
  const [collapsed, setCollapsed] = useState(() => new Set())
  const turns = []
  for (const s of steps) {
    const col = s.column || 0
    const band = turns[turns.length - 1]
    if (band && band.col === col) band.rows.push(s)
    else turns.push({ col, rows: [s] })
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {turns.map((band, i) => {
        const isCol = collapsed.has(i)
        const m = metrics && metrics.get(band.col)
        const dur = m && fmtDur(m.ms)
        return (
          <div key={i} style={{ border: '1px solid var(--border-default)', borderRadius: 6, overflow: 'hidden', background: 'var(--bg-surface)' }}>
            <div onClick={() => { const n = new Set(collapsed); n.has(i) ? n.delete(i) : n.add(i); setCollapsed(n) }}
              style={{ position: 'sticky', top: 0, zIndex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '7px 11px', cursor: 'pointer',
                background: 'var(--bg-surface)', borderBottom: isCol ? 'none' : '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-secondary)', font: `600 10px ${MONO}` }}>{isCol ? '▸' : '▾'}</span>
              <span style={{ font: `600 11px ${HEAD}`, color: 'var(--text-primary)' }}>Turn {band.col + 1}</span>
              <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-secondary)' }}>{band.rows.length} action{band.rows.length > 1 ? 's' : ''}</span>
              {m && m.tokens > 0 && <span style={{ font: `400 10px ${MONO}`, color: 'var(--blue)' }}>· {fmtTok(m.tokens)} tok</span>}
              {dur && <span style={{ font: `400 10px ${MONO}`, color: 'var(--amber)' }}>· {dur}</span>}
            </div>
            {!isCol && (
              <div style={{ padding: '5px 8px', display: 'flex', flexDirection: 'column', gap: 1, borderLeft: '2px solid var(--border-default)', margin: '0 0 0 10px' }}>
                {band.rows.map(s => <TimelineRow key={s.step_id} s={s} depth={0} sel={sel} setSel={setSel} hi={hi} openSubgraph={openSubgraph} />)}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
