import React, { useState } from 'react'

// Schema-aware renderers for plan/activity steps — NO raw JSON is ever shown to the user.
// Every value type gets a designed widget; the only JSON.stringify is the "copy raw" clipboard button.

const MONO = "var(--mono)"
const HEAD = "var(--head)"
export const KIND = { skill: 'var(--accent)', rule: 'var(--amber)', mcp: 'var(--green)', tool: 'var(--blue)', agent: 'var(--violet)' }
export const STATUS = { ok: 'var(--green)', error: 'var(--accent)', running: 'var(--amber)', warn: 'var(--amber)', idle: 'var(--text-secondary)' }

// ok / error / null — null means "no result captured yet"
export function statusOf(step) {
  if (!step) return null
  if (step.isError) return 'error'
  if (step.result != null || step.toolResult != null) return 'ok'
  return null
}
export const StatusDot = ({ status, size = 7, title }) => {
  if (!status) return null
  const c = STATUS[status] || STATUS.idle
  return <span title={title || status} style={{ width: size, height: size, borderRadius: '50%', background: c, boxShadow: `0 0 0 1px ${c}80`, display: 'inline-block', flexShrink: 0, animation: status === 'running' ? 'pulse 1.2s ease-in-out infinite' : 'none' }} />
}

const codeBox = { background: 'var(--bg-inset)', borderRadius: 8, padding: '7px 9px', font: `400 11px ${MONO}`, color: 'var(--text-secondary)', overflowX: 'auto', whiteSpace: 'pre', margin: 0 }
const label = { font: `600 10px ${MONO}`, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.4, margin: '12px 0 5px' }
const Pill = ({ children, hue = 'var(--text-secondary)' }) => <span style={{ font: `500 10px ${MONO}`, padding: '2px 7px', borderRadius: 5, color: hue, background: `${hue}18`, border: `1px solid ${hue}40`, whiteSpace: 'nowrap' }}>{children}</span>

export const FilePathChip = ({ path, onClick }) => {
  const s = String(path || ''); const i = s.lastIndexOf('/')
  return (
    <span onClick={onClick} title={s} style={{ font: `500 10px ${MONO}`, cursor: onClick ? 'pointer' : 'default', color: 'var(--text-secondary)', background: `${KIND.tool}14`, border: `1px solid ${KIND.tool}33`, borderRadius: 5, padding: '2px 7px', display: 'inline-flex', gap: 0, maxWidth: '100%', overflow: 'hidden' }}>
      <span style={{ color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', direction: 'rtl' }}>{i > 0 ? s.slice(0, i + 1) : ''}</span>
      <span style={{ color: 'var(--text-primary)', flexShrink: 0 }}>{i >= 0 ? s.slice(i + 1) : s}</span>
    </span>
  )
}

// collapse long / multi-line text; expandable, horizontally scrollable, never widens the panel
function Expandable({ text, lines = 2, mono = true, boxStyle }) {
  const [open, setOpen] = useState(false)
  const s = String(text ?? '')
  const long = s.length > 140 || (s.match(/\n/g) || []).length >= lines
  return (
    <div>
      <pre style={{ ...codeBox, ...boxStyle, whiteSpace: open ? 'pre-wrap' : 'pre', maxHeight: open ? 340 : lines * 15 + 14, overflowY: open ? 'auto' : 'hidden', font: mono ? codeBox.font : `400 11px ${HEAD}`, wordBreak: open ? 'break-word' : 'normal' }}>{open ? s : s.split('\n').slice(0, lines).join('\n')}</pre>
      {long && <button className="mini" style={{ marginTop: 2 }} onClick={() => setOpen(!open)}>{open ? '⌃ less' : '⌄ show all'}</button>}
    </div>
  )
}

const ShellBlock = ({ cmd }) => (
  <pre style={{ ...codeBox, maxHeight: 200, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}><span style={{ color: STATUS.ok }}>❯ </span>{String(cmd || '')}</pre>
)

// structuredPatch hunks OR a synthesized old/new pair → colored diff, clamped
function DiffView({ patch, oldStr, newStr }) {
  const [open, setOpen] = useState(false)
  let lines = []
  if (Array.isArray(patch)) {
    for (const h of patch) {
      lines.push({ t: 'hdr', s: `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@` })
      for (const l of h.lines || []) lines.push({ t: l[0] === '+' ? 'add' : l[0] === '-' ? 'del' : 'ctx', s: l })
    }
  } else {
    for (const l of String(oldStr ?? '').split('\n')) lines.push({ t: 'del', s: '-' + l })
    for (const l of String(newStr ?? '').split('\n')) lines.push({ t: 'add', s: '+' + l })
  }
  const CLAMP = 14, shown = open ? lines : lines.slice(0, CLAMP)
  const col = { add: STATUS.ok, del: STATUS.error, ctx: 'var(--text-secondary)', hdr: KIND.agent }
  return (
    <div>
      <pre style={{ ...codeBox, maxHeight: open ? 360 : 'none', overflowY: open ? 'auto' : 'visible' }}>{shown.map((l, i) => <div key={i} style={{ color: col[l.t], background: l.t === 'add' ? `${STATUS.ok}12` : l.t === 'del' ? `${STATUS.error}12` : 'transparent' }}>{l.s}</div>)}</pre>
      {lines.length > CLAMP && <button className="mini" style={{ marginTop: 2 }} onClick={() => setOpen(!open)}>{open ? '⌃ less' : `⌄ show all (${lines.length} lines)`}</button>}
    </div>
  )
}

// recursive key/value table; nested objects collapse to a "{N keys}" pill (max depth 3)
export function KVTable({ obj, depth = 0 }) {
  const [open, setOpen] = useState({})
  if (obj == null || typeof obj !== 'object') return <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>{String(obj)}</span>
  const entries = Array.isArray(obj) ? obj.map((v, i) => [i, v]) : Object.entries(obj)
  if (!entries.length) return <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>{Array.isArray(obj) ? '[ ]' : '{ }'}</span>
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px', font: `400 11px ${MONO}` }}>
      {entries.map(([k, v]) => {
        const nested = v && typeof v === 'object'
        const isOpen = open[k]
        return (
          <React.Fragment key={k}>
            <span style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{k}</span>
            <span style={{ color: 'var(--text-secondary)', minWidth: 0 }}>
              {!nested ? <span style={{ wordBreak: 'break-word' }}>{typeof v === 'string' && v.length > 120 ? v.slice(0, 120) + '…' : String(v)}</span>
                : depth >= 3 ? <Pill hue="var(--text-tertiary)">{Array.isArray(v) ? `[${v.length}]` : `{${Object.keys(v).length} keys}`}</Pill>
                  : <span onClick={() => setOpen({ ...open, [k]: !isOpen })} style={{ cursor: 'pointer' }}>
                      <Pill hue={KIND.agent}>{isOpen ? '▾' : '▸'} {Array.isArray(v) ? `${v.length} items` : `{${Object.keys(v).length} keys}`}</Pill>
                      {isOpen && <div style={{ marginTop: 4, paddingLeft: 8, borderLeft: '1px solid var(--border-default)' }}><KVTable obj={v} depth={depth + 1} /></div>}
                    </span>}
            </span>
          </React.Fragment>
        )
      })}
    </div>
  )
}

// dispatch params to a per-tool widget
export function ParamView({ tool, params, onOpenFile }) {
  const p = params || {}
  const has = Object.keys(p).length > 0
  if (!has) return <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>no parameters</div>
  const pills = []
  const add = (k, v) => { if (v != null && v !== '' && v !== false) pills.push(<Pill key={k}>{k}: {String(v)}</Pill>) }

  switch (tool) {
    case 'Bash':
      return <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{p.description && <div style={{ font: `400 11px ${HEAD}`, color: 'var(--text-secondary)' }}>{p.description}</div>}<ShellBlock cmd={p.command} />{(add('timeout', p.timeout), add('run_in_background', p.run_in_background), pills.length ? <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{pills}</div> : null)}</div>
    case 'Read':
      add('lines', p.offset || p.limit ? `${p.offset || 0}–${(p.offset || 0) + (p.limit || 0) || '∞'}` : null); add('pages', p.pages)
      return <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><FilePathChip path={p.file_path} onClick={onOpenFile && (() => onOpenFile(p.file_path))} /><div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{pills}</div></div>
    case 'Edit': case 'MultiEdit':
      return <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><FilePathChip path={p.file_path} />{p.replace_all && <div><Pill hue={STATUS.warn}>replace all</Pill></div>}<DiffView oldStr={p.old_string} newStr={p.new_string} /></div>
    case 'Write':
      return <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><FilePathChip path={p.file_path} /><Pill>{String(p.content || '').split('\n').length} lines</Pill><Expandable text={p.content} /></div>
    case 'Grep': case 'Glob':
      add('path', p.path); add('glob', p.glob); add('type', p.type); add('output_mode', p.output_mode); add('-i', p['-i'])
      return <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><div><Pill hue={KIND.tool}>⌕ {p.pattern || p.glob}</Pill></div><div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{pills}</div></div>
    case 'Task': case 'Agent':
      return <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><div><Pill hue={KIND.agent}>◆ {p.subagent_type || 'agent'}</Pill></div>{p.description && <div style={{ font: `400 11px ${HEAD}`, color: 'var(--text-secondary)' }}>{p.description}</div>}{p.prompt && <Expandable text={p.prompt} lines={3} mono={false} />}</div>
    default:
      return <KVTable obj={p} />
  }
}

// tool result: structuredPatch diff / stdout / stderr / plain text, error-highlighted
export function ResultSection({ step }) {
  const r = step.toolResult, err = step.isError
  const hasAny = r != null || step.result != null
  if (!hasAny) return null
  const title = <div style={{ ...label, color: err ? STATUS.error : 'var(--text-secondary)', display: 'flex', gap: 6, alignItems: 'center' }}>{err && <span>▲</span>}Result{err && <span style={{ font: `600 9px ${MONO}` }}>· error</span>}</div>
  if (r && Array.isArray(r.structuredPatch) && r.structuredPatch.length) return <div>{title}<DiffView patch={r.structuredPatch} /></div>
  if (r && (r.stdout || r.stderr)) return <div>{title}{r.stdout ? <Expandable text={r.stdout} lines={4} /> : null}{r.stderr ? <div style={{ marginTop: 4 }}><div style={{ font: `600 9px ${MONO}`, color: STATUS.warn, marginBottom: 2 }}>stderr</div><Expandable text={r.stderr} lines={4} boxStyle={{ color: 'var(--red)' }} /></div> : null}</div>
  return <div>{title}<Expandable text={step.result} lines={4} boxStyle={err ? { color: 'var(--red)', background: `${STATUS.error}10` } : undefined} /></div>
}
