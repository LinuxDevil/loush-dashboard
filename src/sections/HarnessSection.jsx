import React, { useEffect, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { api, tildify } from '../lib/api.js'
import Skeleton from '../ui/Skeleton.jsx'
import ProjectHub from './ProjectHub.jsx'

const MONO = "var(--mono)"
const HEAD = "var(--head)"
const PANEL = { background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 12, padding: '16px 18px' }
const kTok = n => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n ?? 0))
const OVR = () => <span style={{ font: `600 9px ${MONO}`, padding: '1px 6px', borderRadius: 5, background: 'var(--accent-bg)', color: 'var(--accent-light)' }}>OVR</span>
const MODEL_HUES = {
  'opus-4-8': ['var(--violet)', 'var(--violet-bg)'], 'sonnet-4-6': ['var(--accent-light)', 'var(--accent-bg)'],
  'sonnet-5': ['var(--accent-light)', 'var(--accent-bg)'], 'haiku-4-5': ['var(--blue)', 'var(--blue-bg)'],
}
const MODELS = Object.keys(MODEL_HUES)

function Ed({ value, onSave, type = 'text', width = 110, title = 'click to edit' }) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(value)
  const ref = useRef(null)
  useEffect(() => { if (editing) { setV(value); setTimeout(() => ref.current?.select(), 0) } }, [editing])
  const commit = () => {
    setEditing(false)
    const out = type === 'number' ? Number(v) : v
    if (out !== value && !(type === 'number' && Number.isNaN(out))) onSave(out)
  }
  if (!editing)
    return (
      <span role="button" tabIndex={0} className="hx-ed" title={title}
        onClick={() => setEditing(true)} onKeyDown={e => e.key === 'Enter' && setEditing(true)}
        style={{ font: `500 13px ${MONO}`, color: 'var(--text-primary)' }}>{String(value)}</span>
    )
  return (
    <input ref={ref} value={v} type={type} onChange={e => setV(e.target.value)} onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
      style={{ width, padding: '2px 6px', font: `500 12px ${MONO}`, background: 'var(--bg-inset)', border: '1px solid var(--accent)', borderRadius: 6, color: 'var(--text-primary)' }} />
  )
}

const Row = ({ label, children, ov }) => (
  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, padding: '9px 0', borderBottom: '1px solid var(--border-subtle)' }}>
    <span style={{ font: `400 12px ${MONO}`, color: 'var(--text-secondary)', flexShrink: 0, paddingTop: 1 }}>{label}</span>
    <span style={{ display: 'flex', alignItems: 'center', gap: 7, justifyContent: 'flex-end', textAlign: 'right' }}>{children}{ov && <OVR />}</span>
  </div>
)

const CardTitle = ({ children, hint }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
    <div style={{ font: `600 14px ${HEAD}` }}>{children}</div>
    {hint && <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>{hint}</span>}
  </div>
)

export default function HarnessSection() {
  const [data, setData] = useState(null)
  const [scope, setScope] = useState('global')
  const [editor, setEditor] = useState(null)
  const [busyGate, setBusyGate] = useState(null)
  const [view, setView] = useState('hub')
  const load = s => api.get('/api/harness?scope=' + encodeURIComponent(s ?? scope)).then(setData).catch(() => {})
  useEffect(() => { load(scope) }, [scope])
  if (!data) return <Skeleton tiles={3} rows={6} />

  const { resolved: r, overridden, meta, health, valid, verification, scopes } = data
  const ov = p => overridden.some(x => x === p || x.startsWith(p + '.'))
  const patch = (path, value) => api.patch('/api/harness', { scope, path, value }).then(() => load(scope)).catch(e => alert(e.message))
  const cur = scopes.find(s => s.id === scope) || scopes[0]
  const ovCount = cur.ovCount

  // ---- derived numbers for gauges ----
  const tp = r.turnPolicy, cx = r.context
  const compactPct = Math.round(cx.compactionThreshold * 100)
  const used = meta.usedTokens || 0
  const usedPct = Math.min(100, Math.round((used / cx.windowSize) * 100))
  const ctxDash = (238.8 * (1 - usedPct / 100)).toFixed(1)
  const compactMark = (238.8 * (1 - compactPct / 100)).toFixed(1)
  const healthDash = (194.8 * (1 - health.score / 100)).toFixed(1)
  const budget = cx.alwaysLoadedBudget
  const segs = [
    { name: 'system prompt', val: budget.systemPrompt, color: 'var(--accent)' },
    { name: 'CLAUDE.md', val: meta.claudeMdTokens, color: 'var(--violet)' },
    { name: 'tool defs', val: budget.toolDefs, color: 'var(--blue)' },
  ]
  const segTotal = segs.reduce((s, x) => s + x.val, 0)
  const permCounts = `${r.permissions.autoAllow.length} / ${r.permissions.askFirst.length} / ${r.permissions.denied.length}`

  const gmode = { BLOCK: ['var(--red)', 'var(--red-bg)'], DENY: ['var(--red)', 'var(--red-bg)'], ASK: ['var(--accent-light)', 'var(--accent-bg)'], ALLOW: ['var(--green)', 'var(--green-bg)'] }
  const cycleGuardrail = g => {
    const order = ['ALLOW', 'ASK', g.mode === 'BLOCK' || g.rule.includes('Destructive') ? 'BLOCK' : 'DENY']
    const next = order[(order.findIndex(m => m === g.mode || (m === 'BLOCK' && g.mode === 'DENY') || (m === 'DENY' && g.mode === 'BLOCK')) + 1) % 3]
    const lists = { allow: [...r.permissions.autoAllow], ask: [...r.permissions.askFirst], deny: [...r.permissions.denied] }
    for (const l of Object.keys(lists)) lists[l] = lists[l].filter(x => x !== g.pattern)
    lists[next === 'ALLOW' ? 'allow' : next === 'ASK' ? 'ask' : 'deny'].push(g.pattern)
    patch('permissions', lists)
  }
  const permList = title => (title === 'Auto-allow' ? 'allow' : title === 'Ask first' ? 'ask' : 'deny')
  const editPerm = (listKey, arr) => patch('permissions.' + listKey, arr)

  const runGate = async g => {
    setBusyGate(g.name)
    try { await api.post('/api/harness/verify', { scope, name: g.name, command: g.command }); await load(scope) } catch (e) { alert(e.message) }
    setBusyGate(null)
  }
  const gateColor = s => (s === 'passing' ? 'var(--green)' : s === 'failing' ? 'var(--red)' : s === 'hook' ? 'var(--violet)' : 'var(--text-secondary)')
  const gateIcon = s => (s === 'passing' ? '✓' : s === 'failing' ? '✕' : s === 'hook' ? '⑂' : '–')

  const chipStyle = kind => ({
    allow: { background: 'var(--green-bg)', color: 'var(--green)', border: '1px solid var(--green)' },
    ask: { background: 'var(--accent-bg)', color: 'var(--accent-light)', border: '1px solid var(--accent)' },
    deny: { background: 'var(--red-bg)', color: 'var(--red)', border: '1px solid var(--red)' },
  }[kind])

  return (
    <div className="hx" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, font: `600 18px ${HEAD}`, letterSpacing: '-0.02em' }}>
          {scope === 'global' ? 'Global harness' : cur.label + ' · harness'}
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ padding: '8px 14px', borderRadius: 6, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', font: `400 12px ${MONO}`, color: 'var(--text-secondary)' }}>{tildify(meta.configPath)}</div>
          <button onClick={() => api.get('/api/harness/raw?scope=' + encodeURIComponent(scope)).then(setEditor)}
            style={{ padding: '9px 16px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'transparent', color: 'var(--text-secondary)', font: "500 13px var(--body)", cursor: 'pointer' }}>Edit config</button>
        </div>
      </header>

      {}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ font: `600 10px ${MONO}`, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginRight: 2 }}>Scope</span>
        {scopes.map(s => {
          const active = s.id === scope
          return (
            <button key={s.id} onClick={() => setScope(s.id)} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 6, cursor: 'pointer',
              font: "500 13px var(--body)", transition: 'all .16s',
              border: `1px solid ${active ? 'var(--accent-bg)' : 'var(--bg-surface-active)'}`,
              background: active ? 'var(--accent-bg)' : 'var(--bg-surface)',
              color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}>
              <span style={{ fontSize: 13, opacity: 0.85 }}>{s.id === 'global' ? '◉' : '⌗'}</span>{s.label}
              {s.ovCount > 0 && <span style={{ font: `600 10px ${MONO}`, padding: '1px 6px', borderRadius: 5, background: 'var(--accent-bg)', color: 'var(--accent-light)' }}>{s.ovCount} override{s.ovCount === 1 ? '' : 's'}</span>}
            </button>
          )
        })}
        {scope !== 'global' && (
          <span style={{ display: 'flex', gap: 4, marginLeft: 6, padding: 3, borderRadius: 6, background: 'var(--bg-inset)', border: '1px solid var(--border-default)' }}>
            {['hub', 'config'].map(v => (
              <button key={v} onClick={() => setView(v)} style={{
                padding: '5px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', font: `600 11px ${MONO}`,
                background: view === v ? 'var(--accent-bg)' : 'transparent', color: view === v ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}>{v === 'hub' ? 'Project hub' : 'Config'}</button>
            ))}
          </span>
        )}
        <div style={{ marginLeft: 'auto', font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>
          {scope === 'global' ? 'baseline inherited by every project' : `${ovCount} field${ovCount === 1 ? '' : 's'} override global · rest inherited`}
        </div>
      </div>

      {scope !== 'global' && view === 'hub' ? <ProjectHub project={scope} /> : <>

      {}
      <div className="hx-overview">
        <div style={{ ...PANEL, display: 'flex', alignItems: 'center', gap: 16, animation: 'fadeUp .5s ease both' }}>
          <svg width="76" height="76" viewBox="0 0 76 76">
            <defs><linearGradient id="hring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--accent-light)" /><stop offset="1" stopColor="var(--accent)" /></linearGradient></defs>
            <circle cx="38" cy="38" r="31" fill="none" strokeWidth="7"  style={{ stroke: 'var(--text-secondary)' }} />
            <circle cx="38" cy="38" r="31" fill="none" stroke="url(#hring)" strokeWidth="7" strokeLinecap="round" strokeDasharray="194.8" strokeDashoffset={healthDash} transform="rotate(-90 38 38)" style={{ filter: 'drop-shadow(0 0 6px var(--accent-bg))', transition: 'stroke-dashoffset .5s' }} />
            <text x="38" y="36" textAnchor="middle" style={{ font: `600 18px ${HEAD}`, fill: 'var(--text-primary)' }}>{health.score}</text>
            <text x="38" y="50" textAnchor="middle" style={{ font: `500 9px ${MONO}`, fill: 'var(--text-secondary)' }}>/100</text>
          </svg>
          <div>
            <div style={{ font: `600 11px ${MONO}`, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Harness health</div>
            <div style={{ marginTop: 6, font: "500 13px var(--body)", color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              {health.failing.length === 0 ? 'All checks green. Well-formed harness.' : `To improve: ${health.failing.slice(0, 2).join(' · ')}${health.failing.length > 2 ? ` (+${health.failing.length - 2})` : ''}`}
            </div>
          </div>
        </div>
        {[
          ['Turn budget', tp.maxTurns, ov('harness.turnPolicy.maxTurns') ? 'var(--accent-light)' : 'var(--text-primary)', 'max turns / task', '0s'],
          ['Compaction', compactPct + '%', ov('harness.context.compactionThreshold') ? 'var(--accent-light)' : 'var(--violet)', `of ${kTok(cx.windowSize)} window`, '0.05s'],
          ['Tool policy', permCounts, 'var(--text-primary)', 'allow / ask / deny', '0.1s'],
          ['Recovery', tp.onError ? 'on' : 'off', tp.onError ? 'var(--green)' : 'var(--red)', tp.onError || 'no recovery policy', '0.15s'],
        ].map(([label, value, color, sub, delay]) => (
          <div key={label} style={{ ...PANEL, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 7, animation: 'fadeUp .5s ease both', animationDelay: delay }}>
            <span style={{ font: `600 11px ${MONO}`, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>{label}</span>
            <div style={{ font: `600 20px ${HEAD}`, letterSpacing: '-0.01em', color }}>{value}</div>
            <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>{sub}</div>
          </div>
        ))}
      </div>

      {}
      <div className="hx-2a">
        <div style={{ ...PANEL, animation: 'fadeUp .5s ease both', animationDelay: '.1s' }}>
          <CardTitle hint="react → act → observe">Agent loop &amp; turn policy</CardTitle>
          <div className="hx-loopgrid">
            <svg viewBox="0 0 240 240" style={{ width: '100%', height: 'auto', display: 'block' }}>
              <circle cx="120" cy="120" r="78" fill="none" strokeWidth="1.6" strokeDasharray="5 6" style={{ stroke: 'var(--accent)', animation: 'dashRot 2.4s linear infinite' }} />
              <circle r="4" style={{ fill: 'var(--accent-light)', filter: 'drop-shadow(0 0 5px var(--accent-light))' }}>
                <animateMotion dur="6s" repeatCount="indefinite" path="M 120 42 A 78 78 0 1 1 119.9 42" keyPoints="0;1" keyTimes="0;1" calcMode="linear" />
              </circle>
              {[
                { num: '1', label: 'context', x: 120, y: 42, color: 'var(--blue)' },
                { num: '2', label: 'reason', x: 198, y: 120, color: 'var(--violet)' },
                { num: '3', label: 'act', x: 120, y: 198, color: 'var(--accent)' },
                { num: '4', label: 'observe', x: 42, y: 120, color: 'var(--green)' },
              ].map(n => (
                <g key={n.num}>
                  <circle cx={n.x} cy={n.y} r="20" strokeWidth="2"  style={{ fill: 'var(--border-default)', stroke: (n.color) }} />
                  <text x={n.x} y={n.y + 5} textAnchor="middle" style={{ font: `600 14px ${HEAD}`, fill: n.color }}>{n.num}</text>
                  <text x={n.x} y={n.y < 70 ? n.y - 26 : n.y > 170 ? n.y + 32 : n.y + 34} textAnchor="middle" style={{ font: `500 10px ${MONO}`, fill: 'var(--text-secondary)' }}>{n.label}</text>
                </g>
              ))}
              <text x="120" y="116" textAnchor="middle" style={{ font: `600 12px ${HEAD}`, fill: 'var(--text-primary)' }}>agent</text>
              <text x="120" y="132" textAnchor="middle" style={{ font: `600 12px ${HEAD}`, fill: 'var(--text-primary)' }}>loop</text>
            </svg>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Row label="Max turns" ov={ov('harness.turnPolicy.maxTurns')}>
                <Ed value={tp.maxTurns} type="number" width={64} onSave={v => patch('harness.turnPolicy.maxTurns', v)} /><span style={{ font: `500 13px ${MONO}`, color: 'var(--text-primary)' }}> turns</span>
              </Row>
              <Row label="Stop when" ov={ov('harness.turnPolicy.stopConditions')}>
                <Ed value={tp.stopConditions.join(' · ')} width={220} onSave={v => patch('harness.turnPolicy.stopConditions', v.split('·').map(s => s.trim()).filter(Boolean))} />
              </Row>
              <Row label="Retry" ov={ov('harness.turnPolicy.retry')}>
                <Ed value={tp.retry} width={180} onSave={v => patch('harness.turnPolicy.retry', v)} />
              </Row>
              <Row label="On error" ov={ov('harness.turnPolicy.onError')}>
                <Ed value={tp.onError} width={180} onSave={v => patch('harness.turnPolicy.onError', v)} />
              </Row>
              <Row label="Checkpoint" ov={ov('harness.turnPolicy.checkpointInterval')}>
                <span style={{ font: `500 13px ${MONO}`, color: 'var(--text-primary)' }}>every </span>
                <Ed value={tp.checkpointInterval} type="number" width={52} onSave={v => patch('harness.turnPolicy.checkpointInterval', v)} />
                <span style={{ font: `500 13px ${MONO}`, color: 'var(--text-primary)' }}> turns</span>
              </Row>
            </div>
          </div>
        </div>

        <div style={{ ...PANEL, animation: 'fadeUp .5s ease both', animationDelay: '.15s' }}>
          <CardTitle>Context &amp; memory</CardTitle>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 18 }}>
            <svg width="96" height="96" viewBox="0 0 96 96" style={{ flexShrink: 0 }}>
              <circle cx="48" cy="48" r="38" fill="none" strokeWidth="8"  style={{ stroke: 'var(--text-secondary)' }} />
              <circle cx="48" cy="48" r="38" fill="none" strokeWidth="8" strokeLinecap="round" strokeDasharray="238.8" strokeDashoffset={ctxDash} transform="rotate(-90 48 48)" style={{ stroke: 'var(--violet)', filter: 'drop-shadow(0 0 6px var(--violet-bg))', transition: 'stroke-dashoffset .5s' }} />
              <circle cx="48" cy="48" r="38" fill="none" strokeWidth="8" strokeDasharray="2 236.8" strokeDashoffset={compactMark} transform="rotate(-90 48 48)" style={{ stroke: 'var(--accent-light)', opacity: 0.9 }} />
              <text x="48" y="45" textAnchor="middle" style={{ font: `600 16px ${HEAD}`, fill: 'var(--text-primary)' }}>{usedPct}%</text>
              <text x="48" y="59" textAnchor="middle" style={{ font: `500 8px ${MONO}`, fill: 'var(--text-secondary)' }}>WINDOW</text>
            </svg>
            <div style={{ flex: 1 }}>
              <div style={{ font: "500 13px var(--body)", color: 'var(--text-secondary)', lineHeight: 1.5 }}>{kTok(used)} of {kTok(cx.windowSize)} in use{meta.usedTokens == null && ' (no recent session)'}</div>
              <div style={{ marginTop: 6, font: `400 12px ${MONO}`, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                auto-compacts at <span style={{ color: 'var(--accent-light)' }}><Ed value={compactPct} type="number" width={48} onSave={v => patch('harness.context.compactionThreshold', v / 100)} />%</span>
                {ov('harness.context.compactionThreshold') && <> <OVR /></>} · keeps last <Ed value={cx.keepTurns} type="number" width={44} onSave={v => patch('harness.context.keepTurns', v)} /> turns + pinned notes
              </div>
            </div>
          </div>
          <div style={{ font: `600 10px ${MONO}`, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 9 }}>
            Always-loaded budget · {kTok(segTotal)} / <Ed value={kTok(budget.softCap)} width={54} onSave={v => patch('harness.context.alwaysLoadedBudget.softCap', Math.round(parseFloat(v) * (String(v).includes('k') ? 1000 : 1)))} /> soft cap
            {segTotal > budget.softCap && <span style={{ color: 'var(--red)', marginLeft: 8 }}>over budget</span>}
          </div>
          <div style={{ display: 'flex', height: 11, borderRadius: 6, overflow: 'hidden', background: 'var(--bg-surface-hover)', marginBottom: 11 }}>
            {segs.map(b => (
              <div key={b.name} style={{ width: `${((b.val / Math.max(segTotal, budget.softCap)) * 100).toFixed(1)}%`, background: b.color, transformOrigin: 'left', animation: 'grow .7s cubic-bezier(.2,.8,.2,1) both' }} />
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {segs.map(b => (
              <div key={b.name} style={{ display: 'flex', alignItems: 'center', gap: 7, font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: b.color }} />{b.name} <span style={{ color: 'var(--text-tertiary)' }}>{kTok(b.val)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {}
      <div className="hx-2">
        <div style={{ ...PANEL, animation: 'fadeUp .5s ease both', animationDelay: '.2s' }}>
          <CardTitle hint="task → model">Model routing</CardTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {r.modelRouting.map((row, i) => {
              const hue = MODEL_HUES[row.model] || ['var(--text-secondary)', 'var(--bg-surface-hover)']
              const save = (field, v) => {
                const next = r.modelRouting.map((x, j) => (j === i ? { ...x, [field]: v } : x))
                patch('harness.modelRouting', next)
              }
              return (
                <div key={row.task} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  <span style={{ width: 118, flexShrink: 0, font: "500 12px var(--body)", color: 'var(--text-secondary)' }}>{row.task}</span>
                  <select value={row.model} onChange={e => save('model', e.target.value)} aria-label={`model for ${row.task}`}
                    style={{ font: `600 11px ${MONO}`, padding: '3px 10px', borderRadius: 7, background: hue[1], color: hue[0], border: 'none', cursor: 'pointer', width: 'auto' }}>
                    {MODELS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <span style={{ marginLeft: 'auto', font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>
                    fallback{' '}
                    <select value={row.fallback} onChange={e => save('fallback', e.target.value)} aria-label={`fallback for ${row.task}`}
                      style={{ font: `400 11px ${MONO}`, background: 'transparent', color: 'var(--text-secondary)', border: 'none', cursor: 'pointer', width: 'auto', padding: 0 }}>
                      {MODELS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </span>
                  {ov('harness.modelRouting') && <OVR />}
                </div>
              )
            })}
          </div>
        </div>

        <div style={{ ...PANEL, animation: 'fadeUp .5s ease both', animationDelay: '.25s' }}>
          <CardTitle hint="confirmation gates">Guardrails &amp; safety</CardTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {r.guardrails.map(g => {
              const [color, bg] = gmode[g.mode] || gmode.ASK
              return (
                <div key={g.rule} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  <span style={{ flex: 1, minWidth: 0, font: "400 13px var(--body)", color: 'var(--text-secondary)' }}>{g.rule}</span>
                  <button onClick={() => cycleGuardrail(g)} title={`${g.pattern} — click to cycle mode`}
                    style={{ display: 'flex', alignItems: 'center', gap: 7, font: `600 10px ${MONO}`, letterSpacing: '0.06em', padding: '3px 10px', borderRadius: 7, color, background: bg, border: 'none', cursor: 'pointer' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />{g.mode}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {}
      <div className="hx-2">
        <div style={{ ...PANEL, animation: 'fadeUp .5s ease both', animationDelay: '.3s' }}>
          <CardTitle hint={`sandbox: ${r.permissions.sandbox}`}>Tools &amp; permissions</CardTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
            {[
              { title: 'Auto-allow', color: 'var(--green)', hint: 'no prompt', kind: 'allow', items: r.permissions.autoAllow },
              { title: 'Ask first', color: 'var(--accent-light)', hint: 'confirm each', kind: 'ask', items: r.permissions.askFirst },
              { title: 'Denied', color: 'var(--red)', hint: 'never', kind: 'deny', items: r.permissions.denied },
            ].map(p => (
              <PermGroup key={p.title} {...p} ov={ov('permissions.' + p.kind)}
                onChange={arr => editPerm(p.kind, arr)} chipStyle={chipStyle(p.kind)} />
            ))}
          </div>
        </div>

        <div style={{ ...PANEL, animation: 'fadeUp .5s ease both', animationDelay: '.35s' }}>
          <CardTitle hint={`${verification.length} gates`}>Verification &amp; self-checks</CardTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {verification.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>no hooks or gates configured — add via Edit config (harness.verification) or Hooks</div>}
            {verification.map(g => (
              <div key={g.name + g.command} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ width: 20, textAlign: 'center', fontSize: 13, color: gateColor(g.status) }}>{gateIcon(g.status)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: "500 13px var(--body)", color: 'var(--text-primary)' }}>{g.name}</div>
                  <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.command}</div>
                </div>
                <span style={{ font: `600 11px ${MONO}`, color: gateColor(g.status) }}>{busyGate === g.name ? 'running…' : g.status}</span>
                {g.kind === 'gate' && <button className="mini" onClick={() => runGate(g)} disabled={!!busyGate} title="run this check now">▸ run</button>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {}
      <div className="hx-2b">
        <div style={{ ...PANEL, animation: 'fadeUp .5s ease both', animationDelay: '.4s' }}>
          <CardTitle>Environment</CardTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Row label="working dir"><span style={{ font: `500 12px ${MONO}`, color: 'var(--text-primary)' }}>{tildify(r.environment.workingDir)}</span></Row>
            <Row label="sandbox" ov={ov('harness.environment.sandbox')}>
              <Ed value={r.environment.sandbox} width={190} onSave={v => patch('harness.environment.sandbox', v)} />
            </Row>
            <Row label="network" ov={ov('harness.environment.network')}>
              <Ed value={r.environment.network} width={190} onSave={v => patch('harness.environment.network', v)} />
            </Row>
            <Row label="shell"><span style={{ font: `500 12px ${MONO}`, color: 'var(--text-primary)' }}>{r.environment.shell}</span></Row>
            <Row label="env vars" ov={ov('env')}>
              <span style={{ font: `500 12px ${MONO}`, color: 'var(--text-primary)' }}>inherited + {r.environment.envVars} pinned</span>
            </Row>
            {r.model && <Row label="default model" ov={ov('model')}><span style={{ font: `500 12px ${MONO}`, color: 'var(--text-primary)' }}>{r.model}</span></Row>}
          </div>
        </div>

        <div style={{ ...PANEL, padding: 0, overflow: 'hidden', animation: 'fadeUp .5s ease both', animationDelay: '.45s' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '15px 20px', borderBottom: '1px solid var(--border-default)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ font: `600 14px ${HEAD}` }}>Instructions</span>
              <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>{tildify(meta.instrPath)}</span>
            </div>
            <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>
              {meta.claudeMd ? `${kTok(meta.claudeMdTokens)} tok${scope !== 'global' ? ' · appended to global' : ''}` : 'no CLAUDE.md'}
            </span>
          </div>
          <pre style={{ margin: 0, padding: '18px 20px', font: `400 12px/1.7 ${MONO}`, color: 'var(--text-secondary)', overflowX: 'auto', whiteSpace: 'pre-wrap', maxHeight: 280, overflowY: 'auto' }}>
            {meta.claudeMd || `# no instructions at this scope\n\nCreate ${tildify(meta.instrPath)} to add scoped guidance.`}
          </pre>
        </div>
      </div>

      </>}

      {}
      {editor && (
        <>
          <div className="drawer-overlay" onClick={() => setEditor(null)} />
          <div className="drawer" role="dialog" aria-label="edit settings.json" style={{ width: 560 }}>
            <div className="drawer-head">
              <h3>{tildify(editor.path)}</h3>
              <button className="ghost" onClick={() => setEditor(null)} aria-label="close">✕</button>
            </div>
            <div className="drawer-body" style={{ padding: 0 }}>
              <CodeMirror value={editor.content} height="100%" theme="dark" extensions={[json()]}
                onChange={v => setEditor(e => ({ ...e, content: v }))} className="editor" />
            </div>
            <div className="drawer-foot">
              <button onClick={() => setEditor(null)}>Cancel</button>
              <button className="primary" onClick={() =>
                api.put('/api/harness/raw', { scope, content: editor.content })
                  .then(() => { setEditor(null); load(scope) })
                  .catch(e => alert(e.message))}>Save</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function PermGroup({ title, color, hint, items, onChange, chipStyle, ov }) {
  const [adding, setAdding] = useState(false)
  const [val, setVal] = useState('')
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
        <span style={{ font: `600 10px var(--mono)`, letterSpacing: '0.08em', textTransform: 'uppercase', color }}>{title}</span>
        <span style={{ font: `400 10px var(--mono)`, color: 'var(--text-tertiary)' }}>{hint}</span>
        {ov && <span style={{ font: `600 9px var(--mono)`, padding: '1px 6px', borderRadius: 5, background: 'var(--accent-bg)', color: 'var(--accent-light)' }}>OVR</span>}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {items.map(c => (
          <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: "500 11px var(--mono)", padding: '4px 10px', borderRadius: 7, ...chipStyle }}>
            {c}
            <button aria-label={`remove ${c}`} onClick={() => onChange(items.filter(x => x !== c))}
              style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, font: 'inherit', opacity: 0.6 }}>✕</button>
          </span>
        ))}
        {adding ? (
          <input autoFocus value={val} placeholder="Bash(npm *) …" aria-label={`add ${title} rule`}
            onChange={e => setVal(e.target.value)}
            onBlur={() => setAdding(false)}
            onKeyDown={e => {
              if (e.key === 'Enter' && val.trim()) { onChange([...items, val.trim()]); setVal(''); setAdding(false) }
              if (e.key === 'Escape') setAdding(false)
            }}
            style={{ width: 150, padding: '3px 8px', font: "500 11px var(--mono)", background: 'var(--bg-inset)', border: '1px solid var(--accent)', borderRadius: 7, color: 'var(--text-primary)' }} />
        ) : (
          <button aria-label={`add ${title} rule`} onClick={() => setAdding(true)}
            style={{ font: "500 11px var(--mono)", padding: '4px 10px', borderRadius: 7, background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px dashed var(--border-default)', cursor: 'pointer' }}>+ add</button>
        )}
      </div>
    </div>
  )
}
