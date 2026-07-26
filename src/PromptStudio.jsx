import React, { useEffect, useState } from 'react'
import { useDebounced } from './hooks.js'
import { api, fmtDate } from './api.js'

const MONO = "'IBM Plex Mono', monospace"
const HEAD = "'Space Grotesk', sans-serif"
const PANEL = { background: 'rgba(28,24,21,0.55)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: '18px 20px', backdropFilter: 'blur(10px)' }
const CHIP = { text: ['✎', '#e8a06a'], url: ['↗', '#5eb3f6'], file: ['▤', '#8b7cf6'], image: ['▣', '#3fb96a'], artifact: ['✦', '#d97757'] }

const empty = { id: null, title: '', tags: [], project: null, inputs: [], template: 'implementation', tone: 'direct', acceptance: '', output: '', versions: [] }

export default function PromptStudio() {
  const [doc, setDoc] = useState(empty)
  const [list, setList] = useState([])
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState('text')
  const [val, setVal] = useState('')
  const [busy, setBusy] = useState(false)
  const [scopes, setScopes] = useState([])
  const dq = useDebounced(q)
  const loadList = () => api.get('/api/prompts?q=' + encodeURIComponent(q)).then(setList).catch(() => {})
  useEffect(() => { api.get('/api/prompts?q=' + encodeURIComponent(dq)).then(setList).catch(() => {}) }, [dq]) // debounced: one fetch per pause, not per keystroke
  useEffect(() => { api.get('/api/harness').then(d => setScopes(d.scopes)).catch(() => {}) }, [])

  const addInput = async () => {
    if (!val.trim() && adding !== 'image') return
    let input = { type: adding, value: val.trim() }
    if (adding === 'url') {
      setBusy(true)
      input.meta = await api.post('/api/prompts/url-meta', { url: val.trim() }).catch(() => ({}))
      setBusy(false)
    }
    setDoc(d => ({ ...d, inputs: [...d.inputs, input] }))
    setVal('')
  }
  const addImage = async file => {
    const dataUrl = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file) })
    const saved = await api.post('/api/prompts/asset', { name: file.name, dataUrl }).catch(e => (alert(e.message), null))
    if (saved) setDoc(d => ({ ...d, inputs: [...d.inputs, { type: 'image', value: saved.path, meta: { name: file.name, dataUrl: dataUrl.length < 400000 ? dataUrl : null } }] }))
  }
  const generate = async () => {
    setBusy(true)
    const saved = await api.post('/api/prompts', doc).catch(e => (alert(e.message), null))
    setBusy(false)
    if (saved) { setDoc(saved); loadList() }
  }
  const open = async id => setDoc(await api.get('/api/prompts/' + id))
  const copy = () => navigator.clipboard.writeText(doc.output).then(() => alert('copied'))
  const download = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([doc.output], { type: 'text/markdown' }))
    a.download = (doc.title || 'prompt').replace(/\W+/g, '-') + '.md'
    a.click()
  }

  return (
    <div className="hx" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="hx-2a">
        {/* composer */}
        <div style={{ ...PANEL, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <input value={doc.title} onChange={e => setDoc(d => ({ ...d, title: e.target.value }))} placeholder="prompt title…" style={{ flex: 1, font: `600 15px ${HEAD}` }} />
            <button className="mini" style={{ marginTop: 0 }} onClick={() => setDoc(empty)}>new</button>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select value={doc.template} onChange={e => setDoc(d => ({ ...d, template: e.target.value }))} aria-label="template">
              {['implementation', 'bugfix', 'research', 'review'].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={doc.tone} onChange={e => setDoc(d => ({ ...d, tone: e.target.value }))} aria-label="tone">
              {['direct', 'thorough', 'cautious'].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={doc.project || ''} onChange={e => setDoc(d => ({ ...d, project: e.target.value || null }))} aria-label="project">
              <option value="">no project</option>
              {scopes.filter(s => s.id !== 'global').map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <input value={(doc.tags || []).join(', ')} onChange={e => setDoc(d => ({ ...d, tags: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))} placeholder="tags, comma separated" style={{ flex: 1, minWidth: 140 }} />
          </div>
          {/* input chips */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {doc.inputs.map((inp, i) => {
              const [icon, color] = CHIP[inp.type] || ['·', '#8a807a']
              return (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: `500 11px ${MONO}`, padding: '4px 10px', borderRadius: 7, background: 'rgba(255,255,255,0.04)', border: `1px solid ${color}44`, color: '#c8bdb4', maxWidth: 280 }} title={inp.value}>
                  {inp.meta?.dataUrl
                    ? <img src={inp.meta.dataUrl} alt={inp.meta.name} style={{ width: 26, height: 26, objectFit: 'cover', borderRadius: 4 }} />
                    : <span style={{ color }}>{icon}</span>}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inp.meta?.title || inp.meta?.name || inp.value.slice(0, 42)}</span>
                  <button aria-label="remove input" onClick={() => setDoc(d => ({ ...d, inputs: d.inputs.filter((_, j) => j !== i) }))}
                    style={{ background: 'none', border: 'none', color: '#8a807a', cursor: 'pointer', padding: 0 }}>✕</button>
                </span>
              )
            })}
            {doc.inputs.length === 0 && <span style={{ font: `400 11px ${MONO}`, color: '#5a514a' }}>no inputs yet — add text, URLs, files, screenshots, or harness artifacts below</span>}
          </div>
          {/* add input row */}
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={adding} onChange={e => setAdding(e.target.value)} aria-label="input type">
              {['text', 'url', 'file', 'artifact', 'image'].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            {adding === 'image' ? (
              <input type="file" accept="image/*" onChange={e => e.target.files[0] && addImage(e.target.files[0])} style={{ flex: 1 }} />
            ) : adding === 'text' ? (
              <textarea rows={2} value={val} onChange={e => setVal(e.target.value)} placeholder="free text — first text block becomes the Goal" style={{ flex: 1 }} />
            ) : (
              <input value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => e.key === 'Enter' && addInput()}
                placeholder={adding === 'url' ? 'https://… (fetched for title/summary)' : adding === 'file' ? 'src/path/to/file.ts' : 'rule / ADR / skill name'} style={{ flex: 1 }} />
            )}
            {adding !== 'image' && <button className="mini" style={{ marginTop: 0 }} onClick={addInput} disabled={busy}>{busy ? '…' : '+ add'}</button>}
          </div>
          <textarea rows={2} value={doc.acceptance} onChange={e => setDoc(d => ({ ...d, acceptance: e.target.value }))} placeholder="acceptance criteria, one per line (optional)" />
          <button className="primary" onClick={generate} disabled={busy}>{doc.id ? '↻ Regenerate & save revision' : '✦ Generate prompt'}</button>
          {doc.versions?.length > 0 && (
            <div>
              <div style={{ font: `600 10px ${MONO}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#7a716a', marginBottom: 6 }}>Revisions</div>
              {doc.versions.slice().reverse().map((v, i) => (
                <button key={i} className="mini" style={{ marginRight: 6 }} title={`restore output from ${fmtDate(v.ts)}`}
                  onClick={() => setDoc(d => ({ ...d, output: v.output, tone: v.tone, template: v.template }))}>{fmtDate(v.ts)}</button>
              ))}
            </div>
          )}
        </div>
        {/* output */}
        <div style={{ ...PANEL, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ font: `600 14px ${HEAD}` }}>Generated prompt</span>
            {doc.quality && (() => {
              const s = doc.quality.score, c = s >= 9 ? '#3fb96a' : s >= 7 ? '#e5a03a' : '#e5484d'
              const tip = doc.quality.gaps?.length ? `to reach 10: ${doc.quality.gaps.join(', ')}` : 'full marks — plan-first, output expectations, behavioural AC, constraints all present'
              return <span title={tip} style={{ font: `700 11px ${MONO}`, color: c, border: `1px solid ${c}55`, borderRadius: 6, padding: '2px 8px', cursor: 'help' }}>quality {s}/10</span>
            })()}
            <span style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>{doc.output ? `~${Math.ceil(doc.output.length / 4)} tok` : ''}</span>
            {doc.quality?.needsGoal && <span style={{ font: `400 10.5px ${MONO}`, color: '#e5a03a' }}>add a goal (first text block) to clear 9/10</span>}
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button className="mini" style={{ marginTop: 0 }} onClick={copy} disabled={!doc.output}>copy</button>
              <button className="mini" style={{ marginTop: 0 }} onClick={download} disabled={!doc.output}>export .md</button>
            </span>
          </div>
          <pre style={{ margin: 0, padding: '16px 20px', font: `400 12px/1.7 ${MONO}`, color: '#c8bdb4', whiteSpace: 'pre-wrap', overflowY: 'auto', flex: 1, minHeight: 300, maxHeight: 520 }}>
            {doc.output || 'assembled prompt appears here — goal → context → references → constraints → acceptance criteria'}
          </pre>
        </div>
      </div>

      {/* saved library */}
      <div style={{ ...PANEL }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', marginBottom: 12 }}>
          <div style={{ font: `600 15px ${HEAD}` }}>Saved prompts</div>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="search title / tags…" style={{ marginLeft: 'auto', width: 240 }} />
        </div>
        {list.map(p => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 4px', borderBottom: '1px solid rgba(255,255,255,0.045)' }}>
            <span role="button" tabIndex={0} onClick={() => open(p.id)} onKeyDown={e => e.key === 'Enter' && open(p.id)}
              style={{ font: "500 13px 'IBM Plex Sans'", color: '#eee3da', cursor: 'pointer', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
            {p.tags.map(t => <span key={t} style={{ font: `500 9px ${MONO}`, padding: '1px 7px', borderRadius: 5, background: 'rgba(139,124,246,0.14)', color: '#a78bfa' }}>{t}</span>)}
            <span style={{ font: `400 10px ${MONO}`, color: '#7a716a', flexShrink: 0 }}>{p.inputs} inputs · {p.versions} revisions{p.project ? ' · ' + p.project.split('/').pop() : ''} · {fmtDate(p.updatedAt)}</span>
            <button className="mini" style={{ marginTop: 0 }} onClick={async () => { const full = await api.get('/api/prompts/' + p.id); setDoc({ ...full, id: null, title: full.title + ' copy', versions: [] }) }}>duplicate</button>
            <button className="mini danger" style={{ marginTop: 0 }} onClick={() => confirm('Delete prompt?') && api.del('/api/prompts/' + p.id).then(loadList)}>delete</button>
          </div>
        ))}
        {list.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: '#5a514a' }}>no saved prompts yet</div>}
      </div>
    </div>
  )
}
