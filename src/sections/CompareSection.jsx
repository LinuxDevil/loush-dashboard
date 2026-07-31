// Compare — run one prompt against N models, read the answers unlabelled, vote, then reveal.
//
// Written from a capability description and a screen recording of the upstream UI
// (docs/compare.webm); no Odysseus source was consulted for this file, so NOTICE clause 1 does not
// apply to it. Same footing as lib/chat-protocol.mjs. The server half, server/compare.mjs, DID read
// upstream and carries the attribution header.
//
// One component on purpose: the brief allows this file, server/compare.mjs and
// src/styles/compare.css and no others, so there is nowhere to put a `<Pane>` without putting a
// second component in a file.
//
// ponytail: no streaming panes, no model catalogue, no provider probe, no ELO. A run is one
// blocking POST that resolves when every model has answered.
import React, { useEffect, useState } from 'react'
import { api, fmtDate } from '../lib/api.js'
import Markdown from '../ui/Markdown.jsx'
import { Tabs } from '../ui/tabs.jsx'
import { modelName } from '../lib/modelName.js'

const DEFAULT_MODELS = 'opus, sonnet'
const MAX_MODELS = 6

export default function CompareSection() {
  const [scopes, setScopes] = useState([])
  const [cwd, setCwd] = useState('')
  const [prompt, setPrompt] = useState('')
  const [modelsText, setModelsText] = useState(DEFAULT_MODELS)
  const [list, setList] = useState([])
  const [cur, setCur] = useState(null)
  const [tab, setTab] = useState('A')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState(null)

  const models = modelsText.split(',').map(s => s.trim()).filter(Boolean)
  const loadList = () => api.get('/api/compare').then(setList).catch(() => {})

  useEffect(() => { loadList() }, [])
  useEffect(() => {
    api.get('/api/harness')
      .then(d => {
        const dirs = (d.scopes || []).filter(s => s.id !== 'global')
        setScopes(dirs)
        setCwd(c => c || dirs[0]?.id || '')
      })
      .catch(() => {})
  }, [])

  const open = async id => {
    setErr(null)
    try {
      const d = await api.get('/api/compare/' + id)
      setCur(d)
      setTab(d.panes[0]?.label || 'A')
    } catch (e) { setErr(e.message) }
  }

  const run = async () => {
    setErr(null)
    setBusy('running')
    try {
      const { id } = await api.post('/api/compare', { cwd, prompt, models })
      await open(id)
      loadList()
    } catch (e) { setErr(e.message) } finally { setBusy('') }
  }

  const vote = async label => {
    setErr(null)
    try { await api.post(`/api/compare/${cur.id}/vote`, { label }); await open(cur.id); loadList() }
    catch (e) { setErr(e.message) }
  }

  const synthesize = async () => {
    setErr(null)
    setBusy('synthesising')
    try { await api.post(`/api/compare/${cur.id}/synthesize`, {}); await open(cur.id) }
    catch (e) { setErr(e.message) } finally { setBusy('') }
  }

  const remove = async id => {
    if (!confirm('Delete this comparison?')) return
    setErr(null)
    try { await api.del('/api/compare/' + id); if (cur?.id === id) setCur(null); loadList() }
    catch (e) { setErr(e.message) }
  }

  return (
    <div className="hx cmp" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="panel cmp-form">
        <div className="sect-label">New comparison</div>
        <textarea rows={3} value={prompt} onChange={e => setPrompt(e.target.value)} disabled={!!busy}
          placeholder="one prompt, sent to every model below — e.g. “refactor this module and explain the seam you chose”" />
        <div className="cmp-controls">
          <select value={cwd} onChange={e => setCwd(e.target.value)} aria-label="working directory" disabled={!!busy}>
            {scopes.length === 0 && <option value="">no project configured</option>}
            {scopes.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <input value={modelsText} onChange={e => setModelsText(e.target.value)} disabled={!!busy}
            aria-label="models" placeholder="models, comma separated" />
          <span className="cmp-note">{models.length}/{MAX_MODELS} models</span>
          <button className="primary" onClick={run}
            disabled={!!busy || !prompt.trim() || !cwd || !models.length || models.length > MAX_MODELS}>
            {busy === 'running' ? 'running…' : 'Run blind'}
          </button>
        </div>
        <div className="cmp-note">
          {busy === 'running'
            ? 'every model is answering now — the panes appear when the slowest one is done'
            : 'answers arrive unlabelled. Model names, cost and latency stay hidden until you vote.'}
        </div>
        {err && <div className="cmp-err">{err}</div>}
      </div>

      {cur && (
        <div className="cmp-result">
          <div className="cmp-head">
            <span className="cmp-prompt">{cur.prompt}</span>
            <span className="cmp-note">{fmtDate(cur.at)}</span>
            {cur.voted
              ? <span className="cmp-badge won">voted {cur.vote.label} · {modelName(cur.vote.model)}</span>
              : <span className="cmp-badge">blind — not voted</span>}
            {cur.voted && (
              <button className="mini" onClick={synthesize} disabled={!!busy}>
                {busy === 'synthesising' ? 'synthesising…' : '✦ Synthesise'}
              </button>
            )}
          </div>

          {/* The tab bar is the narrow-viewport control; CSS hides it once the panes fit side by side. */}
          <div className="cmp-tabs"><Tabs tabs={cur.panes.map(p => p.label)} tab={tab} setTab={setTab} /></div>

          <div className="cmp-panes" style={{ '--cmp-n': cur.panes.length }}>
            {cur.panes.map(p => (
              <div key={p.label}
                className={['cmp-pane', p.label === tab ? 'active' : '', cur.vote?.label === p.label ? 'won' : ''].filter(Boolean).join(' ')}>
                <div className="cmp-pane-hd">
                  <span className="cmp-label">{p.label}</span>
                  <span className="cmp-model">{p.model ? modelName(p.model) : 'hidden until you vote'}</span>
                  {!cur.voted && <button className="mini" onClick={() => vote(p.label)}>vote {p.label}</button>}
                </div>
                {p.model && (
                  <div className="cmp-stats">
                    <span>${(p.cost || 0).toFixed(4)}</span>
                    <span>{((p.ms || 0) / 1000).toFixed(1)}s</span>
                    <span>{p.turns} turns</span>
                  </div>
                )}
                <div className="cmp-body">
                  {/* Pre-vote the server sends `failed` without the text, because the CLI's stderr
                      names the model it was invoked with. The fact of the failure is safe to show;
                      the reason has to wait, or a crashed pane identifies itself. */}
                  {p.failed
                    ? <div className="cmp-err">{p.error ? `this model failed: ${p.error}` : 'this model failed — the reason is hidden until you vote, because it can name the model'}</div>
                    : <Markdown source={p.text} />}
                </div>
              </div>
            ))}
          </div>

          {cur.synthesis && (
            <div className="panel cmp-synth">
              <div className="sect-label accent">
                Synthesis · {modelName(cur.synthesis.model)} · ${(cur.synthesis.cost || 0).toFixed(4)}
              </div>
              <Markdown source={cur.synthesis.text} />
            </div>
          )}
        </div>
      )}

      <div className="panel">
        <div className="sect-label">Past comparisons</div>
        {list.map(c => (
          <div key={c.id} className="cmp-row">
            <span role="button" tabIndex={0} className="cmp-row-prompt"
              onClick={() => open(c.id)} onKeyDown={e => e.key === 'Enter' && open(c.id)}>{c.prompt}</span>
            <span className="cmp-note">{c.models} models · {c.voted ? 'voted' : 'blind'} · {fmtDate(c.at)}</span>
            <button className="mini danger" onClick={() => remove(c.id)}>delete</button>
          </div>
        ))}
        {list.length === 0 && <div className="cmp-note">no comparisons yet — run one above</div>}
      </div>
    </div>
  )
}
