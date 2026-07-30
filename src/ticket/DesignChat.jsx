import React, { useRef, useState } from 'react'
import { marked } from 'marked'
import { api, toast } from '../lib/api.js'


const MONO = 'var(--mono)', HEAD = 'var(--head)'
const mini = { padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', cursor: 'pointer', font: '500 11px var(--body)', textAlign: 'left' }

const GLYPH = { 'add-node': '＋', 'remove-node': '−', 'rename-node': '~', 'set-note': '~', 'add-edge': '＋', 'remove-edge': '−' }
const COLOUR = { 'add-node': 'var(--green)', 'add-edge': 'var(--green)', 'remove-node': 'var(--red)', 'remove-edge': 'var(--red)', 'rename-node': 'var(--amber)', 'set-note': 'var(--amber)' }
const describe = o => {
  if (o.op === 'add-node') return `node ${o.id || o.label} — ${o.label}${o.type ? ` (${o.type})` : ''}`
  if (o.op === 'remove-node') return `node ${o.id} — also removes its connections`
  if (o.op === 'rename-node') return `${o.id} → “${o.label}”`
  if (o.op === 'set-note') return `note on ${o.id}`
  if (o.op === 'add-edge') return `${o.source} → ${o.target}${o.label ? ` “${o.label}”` : ''}`
  if (o.op === 'remove-edge') return `${o.source || ''} → ${o.target || o.id}`
  return o.op
}

export default function DesignChat({ tKey, workspace, graph, selected, rev, onApplied }) {
  const [log, setLog] = useState([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const taRef = useRef(null)

  const node = selected ? graph.nodes.find(n => n.id === selected) : null
  const seeds = node
    ? [`Split “${node.data.label}” — is it doing too much?`,
       `What calls “${node.data.label}”?`,
       `What error paths are missing around “${node.data.label}”?`]
    : [
        'What error or failure paths does this design miss?',
        graph.nodes.length ? `What breaks if “${[...graph.nodes].sort((a, b) => graph.edges.filter(e => e.target === b.id).length - graph.edges.filter(e => e.target === a.id).length)[0].data.label}” changes?` : null,
        'Which of these components could reuse something that already exists in the repo?',
        'Are any of these connections wrong?',
      ].filter(Boolean)

  const ask = async q => {
    const question = (q ?? text).trim()
    if (!question || busy) return
    setText(''); setBusy(true)
    setLog(l => [...l, { role: 'user', text: question }])
    try {
      const r = await api.post(`/api/ticket/${tKey}/design/chat?workspace=${workspace}`, { text: question, nodeIds: selected ? [selected] : [] })
      setLog(l => [...l, { role: 'assistant', text: r.text, cost: r.cost },
        ...(r.ops?.length ? [{ role: 'ops', ops: r.ops, chosen: new Set(r.ops.map((_, i) => i).filter(i => !String(r.ops[i].op).startsWith('remove'))) }] : [])])
    } catch (e) {
      setLog(l => [...l, { role: 'error', text: e.message }])
    } finally { setBusy(false) }
  }

  const apply = async (idx, entry) => {
    const ops = entry.ops.filter((_, i) => entry.chosen.has(i))
    if (!ops.length) return
    try {
      const out = await api.post(`/api/ticket/${tKey}/design/ops?workspace=${workspace}`, { ops, rev })
      const ok = (out.results || []).filter(r => r.ok).length
      const bad = (out.results || []).filter(r => !r.ok)
      setLog(l => l.map((e, i) => (i === idx ? { ...e, applied: { ok, bad } } : e)))
      onApplied(out)
      toast(bad.length ? `applied ${ok} of ${ops.length} — ${bad.length} could not be applied` : `applied ${ok} change${ok > 1 ? 's' : ''}`, bad.length ? 'info' : 'success')
    } catch (e) { toast(e.message, 'error') }
  }

  return (
    <div style={{ width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 8, maxHeight: 'min(62vh, 640px)' }}>
      <div style={{ padding: '9px 12px', borderBottom: '1px solid var(--border-default)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ font: `600 12px ${HEAD}`, color: 'var(--text-primary)' }}>Design chat</span>
        <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-secondary)' }}>proposes · you apply</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {log.length === 0 && (
          <>
            <div style={{ font: `400 11px/1.6 ${MONO}`, color: 'var(--text-secondary)' }}>
              Reads the design document and the repository. It can propose changes to the diagram; nothing is applied until you say so.
            </div>
            {seeds.map(s => <button key={s} style={mini} onClick={() => ask(s)}>▸ {s}</button>)}
          </>
        )}

        {log.map((e, i) => {
          if (e.role === 'user') return <div key={i} className="chat-msg user" style={{ maxWidth: '100%' }}>{e.text}</div>
          if (e.role === 'error') return <div key={i} className="chat-line err">{e.text}</div>
          if (e.role === 'assistant') return (
            <div key={i}>
              <div className="chat-msg assistant" style={{ maxWidth: '100%' }} dangerouslySetInnerHTML={{ __html: marked.parse(e.text || '') }} />
              {e.cost != null && <div style={{ font: `400 10px ${MONO}`, color: 'var(--text-secondary)', paddingLeft: 6 }}>${Number(e.cost).toFixed(3)}</div>}
            </div>
          )
          return (
            <div key={i} style={{ border: '1px solid var(--border-default)', borderRadius: 6, padding: 9, background: 'var(--bg-base)' }}>
              <div style={{ font: `600 10px ${MONO}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 6 }}>
                proposed changes · {e.ops.length}
              </div>
              {e.ops.map((o, j) => (
                <label key={j} style={{ display: 'flex', gap: 7, alignItems: 'flex-start', font: `400 11px ${MONO}`, color: 'var(--text-secondary)', padding: '2px 0', cursor: e.applied ? 'default' : 'pointer' }}>
                  <input type="checkbox" disabled={!!e.applied} checked={e.chosen.has(j)} style={{ width: 'auto', marginTop: 2 }}
                    onChange={ev => setLog(l => l.map((x, k) => {
                      if (k !== i) return x
                      const n = new Set(x.chosen); ev.target.checked ? n.add(j) : n.delete(j)
                      return { ...x, chosen: n }
                    }))} />
                  <span style={{ color: COLOUR[o.op] || 'var(--text-secondary)', width: 10 }}>{GLYPH[o.op] || '·'}</span>
                  <span style={{ flex: 1 }}>{describe(o)}</span>
                </label>
              ))}
              {}
              {e.applied
                ? <div style={{ font: `400 10px ${MONO}`, color: e.applied.bad.length ? 'var(--amber)' : 'var(--green)', marginTop: 6 }}>
                    ✓ applied {e.applied.ok}{e.applied.bad.length ? ` · ${e.applied.bad.length} could not be applied: ${e.applied.bad[0].error}` : ''}
                  </div>
                : <button className="primary" style={{ marginTop: 8, fontSize: 11, padding: '3px 9px' }} disabled={!e.chosen.size} onClick={() => apply(i, e)}>
                    Apply {e.chosen.size} of {e.ops.length}
                  </button>}
            </div>
          )
        })}
        {busy && <div className="chat-line dim">thinking…</div>}
      </div>

      <div style={{ display: 'flex', gap: 6, padding: 8, borderTop: '1px solid var(--border-default)' }}>
        <textarea ref={taRef} value={text} rows={2} disabled={busy}
          placeholder={node ? `Ask about “${node.data.label}”…` : 'Ask about the design…'}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask() } }}
          style={{ flex: 1, resize: 'none', font: '400 12px var(--body)' }} />
        <button className="primary" disabled={busy || !text.trim()} onClick={() => ask()}>Send</button>
      </div>
    </div>
  )
}
