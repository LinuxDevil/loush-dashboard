import React, { useEffect, useRef, useState } from 'react'
import { toolName, shortArg } from '../lib/plan.js'

// Per-session activity tree: what skills/rules/mcps fired, the model's own reasoning text, and which
// files got edited — one flat chronological list (subagent calls nest their children) with a
// play/pause/resume scrubber, same rAF-cursor idiom as the Context Window Explorer.
const RULE_FILES = /(CLAUDE|AGENTS)\.md$|\.cursorrules$/
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const STYLE = {
  thought: { icon: '💭', color: '#8a807a', label: 'thought' },
  skill: { icon: '◍', color: '#a894f0', label: 'skill' },
  mcp: { icon: '⚡', color: '#5fd39a', label: 'mcp' },
  rule: { icon: '⚖', color: '#f5c451', label: 'rule' },
  file: { icon: '✎', color: '#d97757', label: 'file' },
  agent: { icon: '◆', color: '#5eb3f6', label: 'subagent' },
  tool: { icon: '▸', color: '#7f8578', label: 'tool' },
}

// One block -> one (or more, for a subagent's children) timeline node(s).
function classify(b) {
  if (b.kind === 'text' && b.text?.trim()) return { type: 'thought', text: b.text.trim(), ts: b.ts }
  if (b.kind !== 'tool' || !b.name) return null
  const path = b.input?.file_path || b.input?.path
  if (b.name === 'Skill') return { type: 'skill', text: `/${b.input?.skill || 'skill'}`, ts: b.ts, result: b.result, isError: b.isError }
  if (b.name.startsWith('mcp__')) return { type: 'mcp', text: `${toolName(b)} · ${shortArg(b.input)}`.trim(), ts: b.ts, result: b.result, isError: b.isError }
  if (path && RULE_FILES.test(path)) return { type: 'rule', text: path.split('/').pop(), ts: b.ts, result: b.result, isError: b.isError }
  if (EDIT_TOOLS.has(b.name)) return { type: 'file', text: path || shortArg(b.input), ts: b.ts, result: b.result, isError: b.isError }
  if ((b.name === 'Task' || b.name === 'Agent') && b.children) {
    return { type: 'agent', text: `${b.input?.subagent_type || 'agent'}: ${shortArg(b.input) || 'subagent'}`, ts: b.ts, result: b.result, isError: b.isError, children: buildTimeline(b.children) }
  }
  return { type: 'tool', text: `${toolName(b)}${shortArg(b.input) ? ' · ' + shortArg(b.input) : ''}`, ts: b.ts, result: b.result, isError: b.isError }
}
export function buildTimeline(blocks) {
  return blocks.map(classify).filter(Boolean)
}

function Node({ n, i, active, onHover }) {
  const s = STYLE[n.type]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div onMouseEnter={() => onHover(i)} onMouseLeave={() => onHover(null)}
        style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 8px', borderRadius: 7, background: active ? s.color + '1c' : 'transparent' }}>
        <span style={{ color: s.color, fontSize: 13, flexShrink: 0, width: 16, textAlign: 'center' }}>{s.icon}</span>
        <span style={{ font: `500 9px 'IBM Plex Mono', monospace`, color: s.color, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 2, width: 46 }}>{s.label}</span>
        <span style={{ font: `400 12.5px ${n.type === 'thought' ? "'IBM Plex Sans'" : "'IBM Plex Mono', monospace"}`, color: n.isError ? '#f2777a' : '#d8cfc7', whiteSpace: 'pre-wrap', wordBreak: 'break-word', flex: 1 }}>
          {n.text.length > 240 ? n.text.slice(0, 240) + '…' : n.text}
        </span>
      </div>
      {n.children && n.children.length > 0 && (
        <div style={{ marginLeft: 30, paddingLeft: 10, borderLeft: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {n.children.map((c, j) => <Node key={j} n={c} i={`${i}.${j}`} active={active === `${i}.${j}`} onHover={onHover} />)}
        </div>
      )}
    </div>
  )
}

export default function ActivityTimeline({ blocks }) {
  const [cursor, setCursor] = useState(-1) // -1 = show all
  const [playing, setPlaying] = useState(false)
  const [hover, setHover] = useState(null)
  const rafRef = useRef(null)
  const timeline = buildTimeline(blocks)
  const n = timeline.length

  useEffect(() => {
    if (!playing) return
    let last = performance.now()
    const step = now => {
      if (now - last > 260) { last = now; setCursor(c => (c + 1 >= n ? (setPlaying(false), n - 1) : c + 1)) }
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing, n])

  if (!n) return <div className="dim" style={{ padding: 16 }}>nothing to show yet.</div>

  const shown = cursor >= 0 ? timeline.slice(0, cursor + 1) : timeline
  const counts = timeline.reduce((m, e) => (m[e.type] = (m[e.type] || 0) + 1, m), {})

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button className="mini" style={{ marginTop: 0 }} onClick={() => { if (cursor < 0) setCursor(0); setPlaying(p => !p) }}>{playing ? '⏸ pause' : cursor >= 0 && cursor < n - 1 ? '▶ resume' : '▶ play'}</button>
        {cursor >= 0 && <button className="mini" style={{ marginTop: 0 }} onClick={() => { setPlaying(false); setCursor(-1) }}>show all</button>}
        <span className="dim" style={{ font: `400 11px 'IBM Plex Mono', monospace` }}>
          {Object.entries(counts).map(([t, c]) => `${STYLE[t].icon} ${c}`).join('  ')}
        </span>
        {cursor >= 0 && <span className="dim" style={{ font: `400 11px 'IBM Plex Mono', monospace`, marginLeft: 'auto' }}>{cursor + 1} / {n}</span>}
      </div>
      {cursor >= 0 && (
        <input type="range" min={0} max={n - 1} value={cursor} onChange={e => { setPlaying(false); setCursor(Number(e.target.value)) }} style={{ width: '100%' }} />
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {shown.map((node, i) => <Node key={i} n={node} i={String(i)} active={hover === String(i)} onHover={setHover} />)}
      </div>
    </div>
  )
}
