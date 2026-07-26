import React, { useEffect, useMemo, useState } from 'react'
import { api, toast } from '../lib/api.js'
import Skeleton from '../ui/Skeleton.jsx'
import { usePager } from '../ui/Pager.jsx'

// ---------- The Working Set — what the agent did to YOUR CODE, and what to do about it ----------
//
// Every other screen in this app is scoped to the harness (tokens, sessions, messages) or to JIRA.
// This one is scoped to the codebase. It is the only panel here that a frontend engineer opens in the
// middle of a ticket rather than at the end of a quarter.
//
// The spine is the Rework Radar: one row per file an agent EDITED, ranked by how many times you had to
// come back to it. A component the agent rewrote six times across four sessions is a component whose
// prop API nobody can guess — and that signal is invisible to git, which only kept the attempt that
// survived. It is also invisible to GitHub, Linear, Sentry and your IDE, none of which can see your
// local transcripts. That join is the entire reason this screen exists.
//
// HONESTY RULES enforced here (the audits found all three broken elsewhere in this app):
//   1. null renders as "—", never as 0 and never as a green tick. "No data" is a distinct state.
//   2. The rank shows its own arithmetic on hover. No black-box score.
//   3. No panel claims coverage it does not have — the walk cap and unresolved-import count are
//      printed on screen, because a graph that silently truncates is a poster, not an instrument.

const MONO = "'IBM Plex Mono', monospace"
const HEAD = "'Space Grotesk', sans-serif"
const RED = '#e5484d', GOLD = '#e5a03a', GREEN = '#3fb96a', DIM = '#8a807a', ACCENT = '#d97757'

const ago = t => {
  if (!t) return '—'
  const d = Math.round((Date.now() - t) / 86400_000)
  return d < 1 ? 'today' : d === 1 ? 'yesterday' : d + 'd ago'
}
// null-safe cell: undefined/null is "unknown", which is NOT zero.
const N = (v, render = x => x) => (v == null ? <span style={{ color: DIM }}>—</span> : render(v))

const FILTERS = [
  ['rework', 'Rework', 'files you came back to in more than one session — ranked'],
  ['risky', 'High blast radius', 'reworked files that many other files import'],
  ['untested', 'No test', 'source files the agent edited that have no colocated test'],
  ['nostory', 'No story', 'source files the agent edited that have no Storybook story'],
  ['orphan', 'Orphaned', 'nothing imports them, and they are not entry points or routes'],
  ['dirty', 'Uncommitted', 'edited by the agent and still dirty in your working tree'],
  ['all', 'Everything', 'every file the agent touched in the window'],
]

export default function WorkingSet({ onNav }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState(null)
  const [root, setRoot] = useState(null)
  const [days, setDays] = useState(30)
  const [filter, setFilter] = useState('rework')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null)      // dossier: {rel} while loading, then the payload
  const [busy, setBusy] = useState(false)

  const load = (r = root, dd = days) => {
    setD(null); setErr(null)
    const qs = new URLSearchParams({ days: String(dd) })
    if (r) qs.set('root', r)
    api.get('/api/fe/workingset?' + qs).then(x => { setD(x); if (x.root) setRoot(x.root) }).catch(e => setErr(e.message))
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    if (!d?.rows) return []
    const term = q.trim().toLowerCase()
    return d.rows.filter(r => {
      if (r.muted && filter !== 'all') return false
      if (term && !r.rel.toLowerCase().includes(term)) return false
      switch (filter) {
        case 'rework': return r.score != null
        case 'risky': return r.score != null && (r.importers || 0) > 0
        case 'untested': return r.kind === 'source' && r.hasTest === false
        case 'nostory': return r.kind === 'source' && r.hasStory === false
        case 'orphan': return r.orphan === true
        case 'dirty': return r.dirty === true
        default: return true
      }
    }).sort((a, b) => filter === 'risky'
      ? (b.exposure ?? -1) - (a.exposure ?? -1)
      : (b.score ?? -1) - (a.score ?? -1) || b.edits - a.edits)
  }, [d, filter, q])
  const pg = usePager(rows, 20)

  if (err) return <div style={card}><b style={{ color: RED }}>Could not build the working set</b><div style={{ color: DIM, marginTop: 8 }}>{err}</div></div>
  if (!d) return <Skeleton tiles={4} rows={12} />

  // The honest empty state. Not a green all-clear — a statement about what is missing and why.
  if (d.available === false) return (
    <div style={card}>
      <div style={{ fontFamily: HEAD, fontSize: 18, marginBottom: 10 }}>No agent history yet</div>
      <p style={{ color: DIM, lineHeight: 1.6, maxWidth: 620, margin: 0 }}>{d.detail}</p>
      <p style={{ color: DIM, marginTop: 14, fontSize: 13 }}>
        Nothing is fabricated here: no score, no zero, no chart. This screen stays empty until there is
        something true to say.
      </p>
    </div>
  )

  const c = d.counts
  const openDossier = rel => {
    setOpen({ rel, loading: true })
    api.get(`/api/fe/dossier?root=${encodeURIComponent(d.root)}&file=${encodeURIComponent(rel)}`)
      .then(x => setOpen(x)).catch(e => { toast(e.message, 'error'); setOpen(null) })
  }
  const mute = async (rel, muted) => {
    try {
      await api.post('/api/fe/mute', { root: d.root, file: rel, muted })
      setD({ ...d, rows: d.rows.map(r => (r.rel === rel ? { ...r, muted } : r)) })
      toast(muted ? `muted ${rel}` : `unmuted ${rel}`, 'success')
    } catch (e) { toast(e.message, 'error') }
  }

  return (
    <div>
      {/* ---- controls ---- */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <select value={d.root} onChange={e => { setRoot(e.target.value); load(e.target.value, days) }} style={sel}>
          {d.repos.map(r => <option key={r.root} value={r.root}>{r.name} — {r.edits} agent edits</option>)}
        </select>
        <select value={days} onChange={e => { setDays(+e.target.value); load(root, +e.target.value) }} style={sel}>
          {[7, 30, 90, 365].map(n => <option key={n} value={n}>last {n} days</option>)}
        </select>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="filter by path…" style={{ ...sel, minWidth: 200, fontFamily: MONO }} />
        <div style={{ flex: 1 }} />
        <span style={{ color: DIM, fontSize: 12, fontFamily: MONO }}>
          {d.graph.sourceFiles} source files walked · {d.graph.resolved} internal imports resolved
          {d.graph.unresolved > 0 && <span style={{ color: GOLD }}> · {d.graph.unresolved} unresolved</span>}
          {d.graph.truncated && <span style={{ color: GOLD }}> · walk hit the {d.graph.walkCap}-file cap</span>}
        </span>
      </div>

      {/* ---- tiles: every one is a filter, not a decoration ---- */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 16 }}>
        <Tile label="in rework" value={c.rework} hint={`edited across ≥${d.minSessions} sessions`} tone={c.rework ? GOLD : DIM} onClick={() => setFilter('rework')} />
        <Tile label="files touched" value={c.filesTouched} hint={`by an agent in ${d.windowDays}d`} onClick={() => setFilter('all')} />
        <Tile label="no test" value={c.missingTest} hint="of the source files it edited" tone={c.missingTest ? GOLD : DIM} onClick={() => setFilter('untested')} />
        <Tile label="no story" value={c.missingStory} hint="of the source files it edited" tone={DIM} onClick={() => setFilter('nostory')} />
        <Tile label="orphaned" value={c.orphans} hint="nothing imports them" tone={c.orphans ? GOLD : DIM} onClick={() => setFilter('orphan')} />
        <Tile label="uncommitted" value={c.dirty} hint="dirty in your working tree" tone={c.dirty ? ACCENT : DIM} onClick={() => setFilter('dirty')} />
      </div>

      {/* ---- filter chips ---- */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {FILTERS.map(([id, label, hint]) => (
          <button key={id} title={hint} onClick={() => setFilter(id)} style={{ ...chip, ...(filter === id ? chipOn : null) }}>{label}</button>
        ))}
      </div>

      {/* ---- the radar ---- */}
      {!rows.length ? (
        <div style={card}>
          <span style={{ color: DIM }}>
            No file matches <b style={{ color: '#e8e0d8' }}>{FILTERS.find(f => f[0] === filter)?.[1]}</b> in the last {d.windowDays} days.
            {filter === 'rework' && ` Every file the agent touched here was edited inside a single session — that is work, not rework, so nothing is ranked.`}
          </span>
        </div>
      ) : (
        <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: DIM, fontFamily: MONO, fontSize: 11, textTransform: 'uppercase', letterSpacing: .5 }}>
                <Th title={`revisitSessions×${d.weights.revisitSession} + revisitDays×${d.weights.revisitDay} + failures×${d.weights.failure} + extraEdits×${d.weights.extraEdit}. Null below ${d.minSessions} sessions — one session is work, not rework.`}>rank</Th>
                <Th>file</Th>
                <Th title="Edit/Write events from your transcripts">edits</Th>
                <Th title="distinct sessions that edited this file — the core rework signal">sessions</Th>
                <Th title="distinct calendar days">days</Th>
                <Th title="lines added / removed, summed from structuredPatch diffs">±</Th>
                <Th title="tool errors attributed to this exact file">fails</Th>
                <Th title="how many files in this repo import it (null = file not found in the walk)">importers</Th>
                <Th title="colocated test / Storybook story">t/s</Th>
                <Th>last</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {pg.slice.map(r => (
                <tr key={r.rel} style={{ borderTop: '1px solid rgba(255,255,255,.06)' }}>
                  <td style={{ ...td, fontFamily: MONO, fontWeight: 700, color: r.score >= 10 ? RED : r.score >= 5 ? GOLD : DIM }}
                      title={r.scoreParts ? `${r.scoreParts.revisitSessions} revisits ×${d.weights.revisitSession} + ${r.scoreParts.revisitDays} days ×${d.weights.revisitDay} + ${r.scoreParts.failures} failures ×${d.weights.failure} + ${r.scoreParts.extraEdits} extra edits ×${d.weights.extraEdit}` : 'below the minimum session count — not ranked'}>
                    {N(r.score)}
                  </td>
                  <td style={{ ...td, fontFamily: MONO, maxWidth: 380 }}>
                    <button onClick={() => openDossier(r.rel)} style={linkBtn} title="open the dossier: prompt → diff → error, in order">{r.rel}</button>
                    {r.dirty && <span style={pill(ACCENT)}>dirty</span>}
                    {r.exists === false && <span style={pill(DIM)} title="the agent edited this path but it is not in the repo now — deleted, renamed or gitignored">gone</span>}
                    {r.orphan && <span style={pill(GOLD)} title="nothing in this repo imports it, and it is not an entry point, route or config">orphan</span>}
                  </td>
                  <td style={td}>{r.edits}</td>
                  <td style={{ ...td, color: r.sessionCount > 2 ? GOLD : 'inherit' }}>{r.sessionCount}</td>
                  <td style={td}>{r.days}</td>
                  <td style={{ ...td, fontFamily: MONO, fontSize: 12 }}>
                    <span style={{ color: GREEN }}>+{r.add}</span> <span style={{ color: RED }}>−{r.del}</span>
                  </td>
                  <td style={{ ...td, color: r.failures ? RED : DIM }}>{r.failures || '·'}</td>
                  <td style={td}>{N(r.importers)}</td>
                  <td style={{ ...td, fontFamily: MONO, fontSize: 11 }}>
                    {r.kind !== 'source' || r.exists === false ? <span style={{ color: DIM }}>—</span> : <>
                      <span title={r.hasTest ? 'has a colocated test' : 'no colocated test found'} style={{ color: r.hasTest ? GREEN : GOLD }}>{r.hasTest ? 'T' : 't'}</span>
                      <span title={r.hasStory ? 'has a Storybook story' : 'no story found'} style={{ color: r.hasStory ? GREEN : DIM }}>{r.hasStory ? 'S' : 's'}</span>
                    </>}
                  </td>
                  <td style={{ ...td, color: DIM, whiteSpace: 'nowrap' }}>{ago(r.lastT)}</td>
                  <td style={td}>
                    <button onClick={() => mute(r.rel, !r.muted)} style={{ ...ghostBtn, color: DIM }} title={r.muted ? 'unmute' : 'mute — stop this path dominating the rank'}>{r.muted ? '◌' : '⊘'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pg.controls}
        </div>
      )}

      <p style={{ color: DIM, fontSize: 12, marginTop: 12, lineHeight: 1.6, maxWidth: 760 }}>
        Built from Edit/Write <code style={{ fontFamily: MONO }}>structuredPatch</code> blocks in your own
        transcripts, joined to an import graph parsed from the repo on disk. No JIRA, no GitHub, no network.
        <b style={{ color: '#e8e0d8' }}> Rank is a heuristic, not a measurement</b> — its inputs are in the
        row and its arithmetic is on the tooltip.
      </p>

      {open && <Dossier d={open} root={d.root} onClose={() => setOpen(null)} onNav={onNav} busy={busy} setBusy={setBusy} />}
    </div>
  )
}

// ---------- dossier: the causal chain git never recorded ----------
function Dossier({ d, root, onClose, onNav, busy, setBusy }) {
  if (d.loading) return <Modal onClose={onClose}><Skeleton tiles={1} rows={8} /></Modal>

  // Real loop closure: resume the actual session that last edited this file, in-app. Chat owns the
  // session lifecycle, so hand it the id rather than spawning a chat this component cannot attach to.
  // Three other panels in this app still hand you a `claude --resume <id>` string to paste into a
  // terminal — the endpoint to do it properly has existed the whole time.
  const resume = s => {
    setBusy(true)
    window.dispatchEvent(new CustomEvent('chat-open', { detail: { sessionId: s.sessionId, cwd: s.cwd || root } }))
    toast(`resuming ${s.sessionId.slice(0, 8)} — opening Chat`, 'success')
    onNav?.('chat')
    onClose()
  }
  // Start a NEW session already holding the blast radius, the recent diffs and the errors to avoid,
  // pre-filled in the composer so you can edit the ask before spending anything.
  const startWithContext = () => {
    setBusy(true)
    window.dispatchEvent(new CustomEvent('chat-open', { detail: { cwd: root, prefill: d.bundle + '\n\n' } }))
    toast('new session started with the context bundle', 'success')
    onNav?.('chat')
    onClose()
  }

  return (
    <Modal onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontFamily: MONO, fontSize: 15, color: '#e8e0d8' }}>{d.rel}</div>
        {d.dirty && <span style={pill(ACCENT)}>dirty</span>}
        {d.exists === false && <span style={pill(DIM)}>not in repo</span>}
        <div style={{ flex: 1 }} />
        <button onClick={onClose} style={ghostBtn}>✕</button>
      </div>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', margin: '12px 0 4px', fontSize: 12, color: DIM }}>
        <span><b style={{ color: '#e8e0d8' }}>{d.importers.length}</b> importers</span>
        <span>imports <b style={{ color: '#e8e0d8' }}>{d.importsOf.length}</b> local files</span>
        {d.coverage && <>
          <span style={{ color: d.coverage.hasTest ? GREEN : GOLD }}
                title={d.coverage.testedBy?.length ? 'tested by ' + d.coverage.testedBy.join(', ') : 'no test imports this file and no colocated test file exists'}>
            {d.coverage.hasTest ? 'has a test' : 'no test'}
          </span>
          <span style={{ color: d.coverage.hasStory ? GREEN : DIM }}
                title={d.coverage.storiedBy?.length ? 'story: ' + d.coverage.storiedBy.join(', ') : 'no story imports this file'}>
            {d.coverage.hasStory ? 'has a story' : 'no story'}
          </span>
        </>}
      </div>

      {/* actions — every one changes something, none are clipboard-only */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0 16px' }}>
        {d.sessions[0] && (
          <button disabled={busy} onClick={() => resume(d.sessions[0])} style={primaryBtn}
                  title={`resume ${d.sessions[0].sessionId.slice(0, 8)} — the session that last edited this file`}>
            ▸ Resume the session that last edited this
          </button>
        )}
        <button disabled={busy} onClick={startWithContext} style={btn} title="new session, pre-loaded with importers, recent diffs and the errors already hit here">
          ✦ New session with this context
        </button>
        <button onClick={() => { navigator.clipboard.writeText(d.bundle).then(() => toast('context bundle copied', 'success'), () => toast('clipboard blocked by the browser', 'error')) }} style={btn}>
          ⧉ Copy bundle
        </button>
      </div>

      {d.importers.length > 0 && (
        <details style={{ marginBottom: 14 }}>
          <summary style={{ cursor: 'pointer', color: DIM, fontSize: 12 }}>Blast radius — {d.importers.length} file(s) import this</summary>
          <div style={{ fontFamily: MONO, fontSize: 12, color: DIM, marginTop: 8, lineHeight: 1.7 }}>
            {d.importers.map(i => <div key={i}>{i}</div>)}
          </div>
        </details>
      )}

      <div style={{ fontFamily: HEAD, fontSize: 13, color: DIM, margin: '4px 0 10px' }}>
        Timeline — prompt → diff → error, in order. {d.timeline.length ? '' : 'No recorded history for this file in the window.'}
      </div>
      <div style={{ maxHeight: '46vh', overflowY: 'auto', display: 'grid', gap: 8 }}>
        {d.timeline.map((e, i) => (
          <div key={i} style={{ borderLeft: `2px solid ${e.kind === 'error' ? RED : e.kind === 'prompt' ? ACCENT : 'rgba(255,255,255,.15)'}`, paddingLeft: 10 }}>
            <div style={{ fontSize: 10, color: DIM, fontFamily: MONO, textTransform: 'uppercase', letterSpacing: .6 }}>
              {e.kind} · {new Date(e.t).toLocaleString()} {e.kind === 'edit' && <span><span style={{ color: GREEN }}>+{e.add}</span> <span style={{ color: RED }}>−{e.del}</span></span>}
            </div>
            {e.kind === 'prompt' && <div style={{ fontSize: 13, color: '#e8e0d8', marginTop: 3 }}>{e.text}</div>}
            {e.kind === 'error' && <div style={{ fontSize: 12, color: RED, marginTop: 3, fontFamily: MONO }}>{e.tool}: {e.text}</div>}
            {e.kind === 'edit' && e.hunk && (
              <pre style={{ margin: '4px 0 0', fontFamily: MONO, fontSize: 11, lineHeight: 1.5, background: 'rgba(0,0,0,.25)', padding: 8, borderRadius: 6, overflowX: 'auto' }}>
                {e.hunk.split('\n').map((l, k) => (
                  <div key={k} style={{ color: l[0] === '+' ? GREEN : l[0] === '-' ? RED : DIM }}>{l}</div>
                ))}
              </pre>
            )}
          </div>
        ))}
      </div>
    </Modal>
  )
}

// ---------- bits ----------
const card = { background: 'rgba(28,24,21,.55)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: 16 }
const td = { padding: '8px 10px', verticalAlign: 'top' }
const sel = { background: 'rgba(0,0,0,.3)', color: '#e8e0d8', border: '1px solid rgba(255,255,255,.12)', borderRadius: 8, padding: '6px 10px', fontSize: 13 }
const chip = { ...sel, cursor: 'pointer', fontSize: 12, padding: '4px 10px', color: DIM }
const chipOn = { color: '#12100e', background: ACCENT, borderColor: ACCENT, fontWeight: 600 }
const btn = { ...sel, cursor: 'pointer', fontSize: 12.5 }
const primaryBtn = { ...btn, background: ACCENT, color: '#12100e', borderColor: ACCENT, fontWeight: 600 }
const ghostBtn = { background: 'none', border: 'none', color: DIM, cursor: 'pointer', fontSize: 14, padding: '2px 6px' }
const linkBtn = { background: 'none', border: 'none', color: '#e8e0d8', cursor: 'pointer', font: 'inherit', padding: 0, textAlign: 'left', textDecoration: 'underline', textDecorationColor: 'rgba(255,255,255,.2)' }
const pill = c => ({ marginLeft: 6, fontSize: 9.5, fontFamily: MONO, textTransform: 'uppercase', color: c, border: `1px solid ${c}55`, borderRadius: 4, padding: '1px 4px', letterSpacing: .5 })

const Th = ({ children, title }) => <th title={title} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 500, cursor: title ? 'help' : 'default' }}>{children}</th>

function Tile({ label, value, hint, tone, onClick }) {
  return (
    <button onClick={onClick} style={{ ...card, padding: 12, textAlign: 'left', cursor: 'pointer', display: 'block' }}>
      <div style={{ fontFamily: HEAD, fontSize: 24, color: value == null ? DIM : (tone || '#e8e0d8') }}>
        {value == null ? '—' : value}
      </div>
      <div style={{ fontSize: 12, color: '#e8e0d8', marginTop: 2 }}>{label}</div>
      <div style={{ fontSize: 10.5, color: DIM, marginTop: 2 }}>{hint}</div>
    </button>
  )
}

function Modal({ children, onClose }) {
  useEffect(() => {
    const k = e => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 60, display: 'grid', placeItems: 'start center', paddingTop: '6vh', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ ...card, width: 'min(900px,92vw)', marginBottom: '6vh' }}>{children}</div>
    </div>
  )
}
