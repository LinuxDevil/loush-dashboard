import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import { api, toast } from '../lib/api.js'
import { Tabs } from '../ui/tabs.jsx'
import DesignCanvas, { TYPES } from '../ticket/DesignCanvas.jsx'

// Ticket — type a JIRA key and go.
//
// The gap this closes is REACHABILITY, not capability: fetching a ticket and generating AC/tests
// already existed in server/eng.mjs, but the only UI was a drawer reachable by clicking a row on a
// board that needs full project config plus a ~65s JIRA+GitHub snapshot. See docs/ticket-tab/.
//
// Four tabs, not five: acceptance criteria and test cases are one artifact class with one
// generate → review → export loop, and merging them is what makes the AC→test link visible.

const MONO = 'var(--mono)', HEAD = 'var(--head)', BODY = 'var(--body)'
const PANEL = { background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 8 }
const mini = { padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', cursor: 'pointer', font: `500 11px ${BODY}`, whiteSpace: 'nowrap' }

const fdt = s => (s ? new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—')
const elapsed = ms => (ms == null ? '—' : ms >= 60000 ? `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s` : `${(ms / 1000).toFixed(0)}s`)
const money = c => (c == null ? '—' : '$' + Number(c).toFixed(2))

// Mirrors server/ticket.mjs normalizeKey so the user sees what will be fetched BEFORE pressing Enter.
function normalizeKey(input) {
  let s = String(input || '').trim()
  if (!s) return null
  const url = /\/browse\/([A-Za-z][A-Za-z0-9_]*-\d+)/.exec(s) || /[?&]selectedIssue=([A-Za-z][A-Za-z0-9_]*-\d+)/.exec(s)
  if (url) return url[1].toUpperCase()
  s = s.replace(/^[<([]+|[>)\],.;:]+$/g, '').trim().replace(/[\s_.]+/g, '-').replace(/-+/g, '-')
  const m = /^([A-Za-z][A-Za-z0-9_]*)-(\d+)$/.exec(s)
  return m ? `${m[1].toUpperCase()}-${m[2]}` : null
}

const Empty = ({ text }) => <div style={{ padding: 18, textAlign: 'center', font: `400 12px ${BODY}`, color: 'var(--text-secondary)' }}>{text}</div>
const Sec = ({ title, right, children }) => (
  <div style={{ ...PANEL, padding: '13px 15px', marginBottom: 12 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
      <div style={{ font: `600 12px ${HEAD}`, color: 'var(--text-primary)' }}>{title}</div>{right}
    </div>
    {children}
  </div>
)
// A reason is not an action: every not-configured state offers the route out.
const NotReady = ({ reason, detail, onNav, to = 'setup', cta = 'Open Setup →' }) => (
  <div style={{ ...PANEL, padding: '16px 18px' }}>
    <div style={{ font: `600 13px ${HEAD}`, color: 'var(--text-primary)', marginBottom: 6 }}>Not configured</div>
    <div style={{ font: `400 12px/1.6 ${BODY}`, color: 'var(--text-secondary)' }}>{reason}</div>
    {detail && <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)', marginTop: 6 }}>{detail}</div>}
    {onNav && <button style={{ ...mini, marginTop: 12 }} onClick={() => onNav(to)}>{cta}</button>}
  </div>
)

export default function TicketSection({ onNav }) {
  const [idx, setIdx] = useState(null)
  const [raw, setRaw] = useState('')
  const [key, setKey] = useState(null)
  const [t, setT] = useState(null)          // ticket payload
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState('Ticket')
  const inputRef = useRef(null)

  useEffect(() => { api.get('/api/ticket/index').then(setIdx).catch(() => setIdx({ available: false, projects: [] })) }, [])
  useEffect(() => { if (!key && inputRef.current) inputRef.current.focus() }, [key])

  const open = useCallback(k => {
    const norm = normalizeKey(k)
    if (!norm) { setErr({ reason: `"${k}" is not a JIRA key — expected something like ABC-1234` }); return }
    setBusy(true); setErr(null); setT(null); setKey(norm); setTab('Ticket')
    api.get(`/api/ticket/${norm}`)
      .then(d => { setT(d); try { const r = JSON.parse(localStorage.getItem('ticket.recent') || '[]'); localStorage.setItem('ticket.recent', JSON.stringify([norm, ...r.filter(x => x !== norm)].slice(0, 8))) } catch {} })
      .catch(e => setErr({ reason: e.message }))
      .finally(() => setBusy(false))
  }, [])

  const recent = useMemo(() => { try { return JSON.parse(localStorage.getItem('ticket.recent') || '[]') } catch { return [] } }, [key])
  const ghost = normalizeKey(raw)

  if (idx && !idx.available) return <NotReady onNav={onNav} reason="No projects are configured. This tab needs at least one project with a JIRA host and a project key." />

  return (
    <div>
      {/* ---- key entry ---- */}
      <div style={{ ...PANEL, padding: '14px 16px', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240, position: 'relative' }}>
            <input ref={inputRef} value={raw} placeholder="ABC-1234"
              aria-label="JIRA ticket key"
              onChange={e => { setRaw(e.target.value); setErr(null) }}
              onKeyDown={e => { if (e.key === 'Enter' && ghost) open(ghost) }}
              onPaste={e => { const v = normalizeKey(e.clipboardData.getData('text')); if (v && !raw.trim()) { e.preventDefault(); setRaw(v); open(v) } }}
              style={{ font: `500 13px ${MONO}` }} />
            {ghost && ghost !== raw.trim().toUpperCase() && (
              <span style={{ position: 'absolute', right: 10, top: 7, font: `400 11px ${MONO}`, color: 'var(--text-secondary)', pointerEvents: 'none' }}>→ {ghost}</span>
            )}
          </div>
          <button className="primary" disabled={!ghost || busy} onClick={() => open(ghost)}>{busy ? 'opening…' : 'Open'}</button>
        </div>
        <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)', marginTop: 6 }}>
          paste a browse URL or type the key — lowercase and <code>ABC 1234</code> are fine
        </div>
        {err && <div style={{ marginTop: 10, background: 'var(--red-bg)', border: '1px solid var(--red)', borderRadius: 6, padding: '8px 10px', font: `400 11px ${MONO}`, color: 'var(--red)' }}>
          {err.reason}{err.detail ? <div style={{ color: 'var(--text-secondary)', marginTop: 4 }}>{err.detail}</div> : null}
        </div>}
        {recent.length > 0 && !key && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            <span style={{ font: `600 10px ${MONO}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Recent</span>
            {recent.map(k => <button key={k} style={{ ...mini, font: `500 11px ${MONO}` }} onClick={() => { setRaw(k); open(k) }}>{k}</button>)}
          </div>
        )}
        {idx && !key && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {idx.projects.map(p => (
              <div key={p.key} style={{ display: 'flex', gap: 8, alignItems: 'baseline', font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>
                <b style={{ color: 'var(--text-primary)', minWidth: 44 }}>{p.key}</b>
                <span>{p.jiraHost || 'no host'}</span>
                <span style={{ color: 'var(--text-secondary)' }}>{p.githubRepo || 'no repo'}</span>
                {/* the ONE place the user learns why Design/Files may be unavailable */}
                <span style={{ color: p.repoDir ? 'var(--green)' : 'var(--text-secondary)' }}>
                  {p.repoDir ? `✓ checkout resolved${p.repoHow === 'basename' ? ' (by name)' : ''}` : '— no local checkout'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {t?.available && (
        <>
          <TicketRail t={t} onClose={() => { setKey(null); setT(null); setRaw('') }} />
          <Tabs tabs={['Ticket', 'Criteria', 'Design', 'Files']} tab={tab} setTab={setTab} />
          <div style={{ marginTop: 12 }}>
            {tab === 'Ticket' && <TicketTab t={t} />}
            {tab === 'Criteria' && <CriteriaTab t={t} onUpdate={setT} />}
            {tab === 'Design' && <DesignTab t={t} onNav={onNav} />}
            {tab === 'Files' && <FilesTab t={t} />}
          </div>
        </>
      )}
    </div>
  )
}

// ---- rail -------------------------------------------------------------------------------------
const TicketRail = ({ t, onClose }) => (
  <div style={{ ...PANEL, padding: '10px 14px', marginBottom: 10 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {t.url ? <a href={t.url} target="_blank" rel="noreferrer" style={{ font: `600 12px ${MONO}`, color: 'var(--text-link)', textDecoration: 'none' }}>{t.key} ↗</a>
        : <span style={{ font: `600 12px ${MONO}`, color: 'var(--text-primary)' }}>{t.key}</span>}
      <span className="chip">{t.project?.key}</span>
      <span style={{ font: `500 11px ${MONO}`, color: 'var(--text-secondary)' }}>{t.status || '—'}</span>
      <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>{t.type || '—'}</span>
      {t.project?.githubRepo && (
        <span style={{ font: `400 11px ${MONO}`, color: t.repo?.dir ? 'var(--green)' : 'var(--text-secondary)' }}>
          {t.project.githubRepo} {t.repo?.dir ? '✓' : '— not resolved'}
        </span>
      )}
      <button style={{ ...mini, marginLeft: 'auto' }} onClick={onClose}>✕</button>
    </div>
    <div style={{ font: `600 15px ${HEAD}`, color: 'var(--text-primary)', marginTop: 6, lineHeight: 1.35 }}>{t.summary}</div>
  </div>
)

// ---- Ticket -------------------------------------------------------------------------------------
function TicketTab({ t }) {
  const pc = t.prContext || {}
  return (
    <>
      <Sec title="Description">
        {t.description
          ? <div style={{ font: `400 12px/1.7 ${BODY}`, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{t.description}</div>
          : <Empty text="This ticket has no description." />}
      </Sec>

      <Sec title={`Comments (${t.comments?.length || 0})`}>
        {!t.comments?.length ? <Empty text="No comments." /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {t.comments.map((c, i) => (
              <div key={i} style={{ borderLeft: '2px solid var(--border-default)', paddingLeft: 10 }}>
                <div style={{ font: `600 10px ${MONO}`, color: 'var(--text-secondary)' }}>{c.author} · {fdt(c.at)}</div>
                <div style={{ font: `400 12px/1.6 ${BODY}`, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{c.body}</div>
              </div>
            ))}
          </div>
        )}
      </Sec>

      {/* PR context has FOUR states. "not loaded" and "zero PRs" are different facts and look
          different — README.md "Honesty rules" §1. */}
      <Sec title="Linked PRs" right={<span style={{ font: `400 10px ${MONO}`, color: pc.loaded ? 'var(--text-secondary)' : 'var(--amber)' }}>{pc.loaded ? 'from the last snapshot' : 'not loaded'}</span>}>
        {!pc.loaded
          ? <div style={{ font: `400 12px/1.6 ${BODY}`, color: 'var(--text-secondary)' }}>
              PR context needs a project snapshot (~65s of live JIRA + GitHub). It is not loaded, which is
              not the same as “no PRs”. Open the Delivery section to build one.
            </div>
          : t.prs?.length
            ? t.prs.map(p => (
                <div key={p.num} style={{ padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  <div style={{ font: `500 12px ${MONO}`, color: 'var(--text-link)' }}>#{p.num} <span style={{ color: 'var(--text-secondary)' }}>{p.state} · {p.changedFiles || 0} files</span></div>
                  <div style={{ font: `400 11px ${BODY}`, color: 'var(--text-secondary)' }}>{p.title}</div>
                </div>
              ))
            : <Empty text={`No PRs reference ${t.key} in the last snapshot.`} />}
      </Sec>

      <Sec title="History">
        {!t.history?.length ? <Empty text="No transitions recorded." /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 260, overflow: 'auto' }}>
            {t.history.map((h, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, font: `400 11px ${MONO}` }}>
                <span style={{ color: 'var(--text-secondary)', width: 112, flexShrink: 0 }}>{fdt(h.at)}</span>
                <span style={{ color: 'var(--text-secondary)' }}>{h.field === 'status' ? '' : h.field + ': '}{h.from ? `${h.from} → ` : ''}<b style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{h.to}</b></span>
              </div>
            ))}
          </div>
        )}
      </Sec>
    </>
  )
}

// ---- Criteria (AC + tests) ----------------------------------------------------------------------
const META = { ac: { title: 'Acceptance criteria', noun: 'acceptance criteria' }, tests: { title: 'Test cases', noun: 'test cases' } }

function CriteriaTab({ t, onUpdate }) {
  const [busy, setBusy] = useState('')
  const [edit, setEdit] = useState(null)
  const [err, setErr] = useState(null)
  const arts = t.artifacts || {}

  const setArt = (kind, a) => onUpdate({ ...t, artifacts: { ...(t.artifacts || {}), [kind]: a } })
  const gen = kind => {
    setBusy(kind); setErr(null)
    api.post(`/api/eng/ticket/${t.key}/generate?project=${t.project.key}`, { kind })
      .then(a => setArt(kind, a)).catch(e => setErr(e.message)).finally(() => setBusy(''))
  }
  const save = (kind, md) => api.put(`/api/eng/ticket/${t.key}/artifact?project=${t.project.key}`, { kind, md })
    .then(a => { setArt(kind, a); setEdit(null) }).catch(e => setErr(e.message))
  const post = (kind, md) => {
    if (!confirm(`Post these ${META[kind].noun} as a comment on ${t.key}?`)) return
    api.post(`/api/eng/ticket/${t.key}/comment?project=${t.project.key}`, { md })
      .then(r => toast(`posted to ${t.key}`, 'success')).catch(e => toast(e.message, 'error'))
  }
  const download = (kind, md) => {
    const b = new Blob([md], { type: 'text/markdown' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(b); a.download = `${t.key}-${kind}.md`; a.click(); URL.revokeObjectURL(a.href)
  }

  return (
    <>
      {err && <div style={{ background: 'var(--red-bg)', border: '1px solid var(--red)', borderRadius: 6, padding: '8px 10px', font: `400 11px ${MONO}`, color: 'var(--red)', marginBottom: 12 }}>{err}</div>}
      {['ac', 'tests'].map(kind => {
        const a = arts[kind]
        const editing = edit?.kind === kind
        return (
          <Sec key={kind} title={META[kind].title} right={
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {a && !editing && <button style={mini} onClick={() => setEdit({ kind, md: a.md })}>edit</button>}
              {a && <button style={mini} onClick={() => { navigator.clipboard?.writeText(a.md); toast('copied', 'success') }}>copy</button>}
              {a && <button style={mini} onClick={() => download(kind, a.md)}>.md</button>}
              {a && (t.project?.writes
                ? <button style={mini} onClick={() => post(kind, a.md)}>post to JIRA</button>
                : <button style={{ ...mini, opacity: 0.5, cursor: 'default' }} disabled title='set "writes": true for this project in projects.json'>JIRA writes off</button>)}
              <button style={mini} disabled={busy === kind} onClick={() => gen(kind)}>{busy === kind ? 'generating…' : a ? 'regenerate' : 'generate'}</button>
            </div>
          }>
            {busy === kind && <div style={{ font: `400 12px ${BODY}`, color: 'var(--text-secondary)' }}>Asking claude — this blocks until it returns.</div>}
            {!a && busy !== kind && !editing && <Empty text={`No ${META[kind].noun} yet — generate them from the ticket.`} />}
            {editing ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <textarea value={edit.md} onChange={e => setEdit({ kind, md: e.target.value })} rows={14} style={{ resize: 'vertical', fontFamily: MONO, fontSize: 12 }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="primary" onClick={() => save(kind, edit.md)}>save</button>
                  <button style={mini} onClick={() => setEdit(null)}>cancel</button>
                </div>
              </div>
            ) : a && (
              <>
                {a.stale === true && <Banner tone="amber">The ticket’s summary or description changed after this was generated. <b>Regenerate</b> to refresh it.</Banner>}
                {a.stale === null && <Banner tone="amber">{a.staleReason}</Banner>}
                {a.partialInput && <Banner tone="amber">{a.partialInput}</Banner>}
                <div className="md" dangerouslySetInnerHTML={{ __html: marked.parse(a.md || '') }} />
                <div style={{ font: `400 10px ${MONO}`, color: 'var(--text-secondary)', marginTop: 10, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
                  {a.edited ? '✎ hand-edited by you' : `◇ generated by ${a.model || 'claude'}`} · {fdt(a.at)} · not verified against the repo
                </div>
              </>
            )}
          </Sec>
        )
      })}
    </>
  )
}

const Banner = ({ tone = 'amber', children }) => (
  <div style={{ background: `var(--${tone}-bg)`, border: `1px solid var(--${tone})`, borderRadius: 6, padding: '7px 10px', font: `400 11px ${MONO}`, color: 'var(--text-secondary)', marginBottom: 10 }}>{children}</div>
)

// ---- Design ------------------------------------------------------------------------------------
function DesignTab({ t, onNav }) {
  const [d, setD] = useState(null)
  const [run, setRun] = useState(null)
  const [tail, setTail] = useState([])
  const [sel, setSel] = useState(null)
  const [view, setView] = useState(null)     // null = auto by node count
  const [doc, setDoc] = useState(null)
  const [now, setNow] = useState(Date.now())
  const load = useCallback(() => api.get(`/api/ticket/${t.key}/design?project=${t.project.key}`).then(x => { setD(x); setRun(x.run) }).catch(() => {}), [t.key, t.project.key])
  useEffect(() => { load() }, [load])

  // A run is server-owned, so reattaching after a remount is just a new EventSource — it replays.
  useEffect(() => {
    if (!run || run.done) return
    const es = new EventSource(`/api/ticket/${t.key}/design/events`)
    es.onmessage = e => {
      try {
        const ev = JSON.parse(e.data)
        if (ev.type === 'assistant' && Array.isArray(ev.message?.content)) {
          const tools = ev.message.content.filter(c => c.type === 'tool_use')
            .map(c => `${c.name} ${String(c.input?.file_path || c.input?.pattern || c.input?.command || '').slice(0, 60)}`)
          if (tools.length) setTail(x => [...x, ...tools].slice(-6))
        }
        if (ev.type === 'closed') { es.close(); load() }
      } catch {}
    }
    es.onerror = () => es.close()
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => { es.close(); clearInterval(tick) }
  }, [run?.done, run?.startedAt, t.key, load])

  const start = () => api.post(`/api/ticket/${t.key}/design/run?project=${t.project.key}`, {})
    .then(r => { setRun(r.run); setTail([]) }).catch(e => toast(e.message, 'error'))
  const cancel = () => api.post(`/api/ticket/${t.key}/design/cancel`, {}).then(load).catch(() => {})

  if (!t.repo?.dir) return (
    <NotReady onNav={onNav} to="projects" cta="Open Projects →"
      reason={t.repo?.reason || 'No local checkout resolved for this project’s repository.'}
      detail="A design run reads the repository, and the files view parses it. Neither is possible without one. Resolution matches the git origin remote across the repos registered with Claude Code." />
  )

  const g = d?.graph
  const nodes = g?.nodes || []
  const auto = nodes.length > 15 ? 'Outline' : 'Canvas'
  const mode = view || auto
  const running = run && !run.done

  return (
    <>
      {running && (
        <Sec title="① Design document" right={<span style={{ font: `400 11px ${MONO}`, color: 'var(--blue)' }}>running · {elapsed(now - run.startedAt)}</span>}>
          <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)', marginBottom: 8 }}>reading {t.project.githubRepo} at {run.cwd || t.repo.dir}</div>
          <div className="logblock" style={{ maxHeight: 150, overflow: 'auto' }}>
            {tail.length ? tail.map((x, i) => <div key={i}>▸ {x}</div>) : <span style={{ color: 'var(--text-secondary)' }}>waiting for the first tool call…</span>}
          </div>
          {/* no percentage: there is no denominator, and a fabricated one is a lie with pixels */}
          <div style={{ display: 'flex', gap: 12, marginTop: 8, font: `400 10px ${MONO}`, color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
            <span>{run.tools} tool calls</span><span>{run.filesRead} files read</span><span>{money(run.cost)}</span>
            <button style={{ ...mini, marginLeft: 'auto' }} onClick={cancel}>Cancel run</button>
          </div>
        </Sec>
      )}

      {!running && (
        <Sec title="Design" right={
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {d?.doc?.exists && <button style={mini} onClick={() => api.get(`/api/ticket/${t.key}/design/doc?project=${t.project.key}`).then(r => setDoc(doc ? null : r)).catch(e => toast(e.message, 'error'))}>{doc ? 'hide document' : 'view document'}</button>}
            {nodes.length > 0 && <button style={mini} onClick={() => fetch(`/api/ticket/${t.key}/design/mermaid?project=${t.project.key}`).then(r => r.text()).then(x => { navigator.clipboard?.writeText(x); toast('mermaid copied', 'success') })}>copy mermaid</button>}
            <button style={mini} onClick={start}>{d?.doc ? 'regenerate' : 'run design'}</button>
          </div>
        }>
          {run?.cancelled && <Banner>Cancelled after {elapsed(run.ms)} · {run.tools} tool calls · {money(run.cost)}. This is a cancellation, not a failure.</Banner>}
          {run?.error && <div style={{ background: 'var(--red-bg)', border: '1px solid var(--red)', borderRadius: 6, padding: '8px 10px', font: `400 11px ${MONO}`, color: 'var(--red)', marginBottom: 10 }}>The run failed: {run.error}</div>}
          {d?.doc?.gitignored && <Banner>The document was written to a gitignored path. Run <code>git add -f {d.doc.rel}</code> in {t.project.githubRepo} to track it — this app will not run git on your repo.</Banner>}
          {d?.diverged && <Banner>The design document changed after this diagram was built. Regenerate to re-derive it; your node positions are preserved.</Banner>}

          {!d?.doc && !nodes.length && <Empty text="No design yet — run one to have an agent read the repository and write a spec." />}
          {d?.doc && !d.doc.exists && <Banner>The design document is gone from disk ({d.doc.rel}). The diagram below is preserved.</Banner>}
          {d?.doc?.exists && (
            <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>
              ◇ {d.doc.rel} · generated {fdt(d.doc.genAt)} · {d.lastRun?.tools ?? '—'} tool calls · {elapsed(d.lastRun?.ms)} · {money(d.lastRun?.cost)} · rev {d.rev} · not verified since generation
            </div>
          )}
          {/* extraction failure degrades to "document without diagram" — never a blank canvas,
              which would read as "your design has no components" */}
          {d?.doc?.exists && !nodes.length && (
            <Banner>No diagram — the model’s graph could not be parsed{d.lastRun?.parseError ? `: ${d.lastRun.parseError}` : ''}. The document above is unaffected.</Banner>
          )}
        </Sec>
      )}

      {doc && <Sec title={doc.path.split('/').slice(-1)[0]}><div className="md" dangerouslySetInnerHTML={{ __html: marked.parse(doc.md || '') }} /></Sec>}

      {d?.warnings?.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {d.warnings.map((w, i) => (
            <span key={i} title={w.detail} style={{ font: `400 10px ${MONO}`, color: 'var(--amber)', background: 'var(--amber-bg)', border: '1px solid var(--amber)', borderRadius: 9999, padding: '1px 8px' }}>{w.detail}</span>
          ))}
        </div>
      )}

      {nodes.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            <button style={{ ...mini, ...(mode === 'Outline' ? { borderColor: 'var(--border-active)', background: 'var(--bg-surface-active)' } : {}) }} onClick={() => setView('Outline')}>Outline</button>
            <button style={{ ...mini, ...(mode === 'Canvas' ? { borderColor: 'var(--border-active)', background: 'var(--bg-surface-active)' } : {}) }} onClick={() => setView('Canvas')}>Canvas</button>
            <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-secondary)' }}>
              {nodes.length} nodes · {(g.edges || []).length} connections
              {!view && nodes.length > 15 && ' — showing the outline: past ~15 a graph is usually harder to read than a list'}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 320 }}>
              {mode === 'Canvas'
                ? <DesignCanvas graph={g} selected={sel} onSelect={setSel} focusId={null}
                    onMove={pos => api.patch(`/api/ticket/${t.key}/design/layout?project=${t.project.key}`, { positions: pos }).catch(() => {})} />
                : <Outline graph={g} selected={sel} onSelect={setSel} />}
            </div>
            {sel && <Inspector node={nodes.find(n => n.id === sel)} graph={g} onClose={() => setSel(null)} />}
          </div>
        </>
      )}
    </>
  )
}

// The outline is the fallback for big graphs, the jump list, AND the accessible representation of
// the same model — one implementation, three jobs.
function Outline({ graph, selected, onSelect }) {
  const edges = graph.edges || []
  return (
    <div style={{ ...PANEL, padding: 8 }} role="tree" aria-label="Design components">
      {graph.nodes.map(n => {
        const t = TYPES[n.type] || TYPES.process
        const out = edges.filter(e => e.source === n.id)
        return (
          <button key={n.id} role="treeitem" aria-selected={selected === n.id}
            onClick={() => onSelect(selected === n.id ? null : n.id)}
            style={{ display: 'flex', gap: 8, alignItems: 'baseline', width: '100%', textAlign: 'left', padding: '6px 8px', border: 'none', borderRadius: 6, background: selected === n.id ? 'var(--bg-surface-active)' : 'transparent' }}>
            <span style={{ color: t.accent, font: `600 11px ${MONO}`, width: 14 }} aria-hidden="true">{t.glyph}</span>
            <span style={{ font: `500 12px ${BODY}`, color: 'var(--text-primary)', minWidth: 150 }}>{n.data.label}</span>
            <span style={{ font: `600 9px ${MONO}`, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>{n.type}</span>
            <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {out.length ? '→ ' + out.map(e => graph.nodes.find(x => x.id === e.target)?.data.label).filter(Boolean).join(', ') : ''}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function Inspector({ node, graph, onClose }) {
  if (!node) return null
  const t = TYPES[node.type] || TYPES.process
  const inn = (graph.edges || []).filter(e => e.target === node.id)
  const out = (graph.edges || []).filter(e => e.source === node.id)
  const name = id => graph.nodes.find(n => n.id === id)?.data.label || id
  const origin = { generated: 'generated by the design run', user: 'added by you', assistant: 'proposed by the assistant, applied by you' }[node.data?.origin] || '—'
  return (
    <div style={{ ...PANEL, width: 320, flexShrink: 0, padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <div style={{ font: `600 13px ${HEAD}`, color: 'var(--text-primary)' }}><span style={{ color: t.accent }} aria-hidden="true">{t.glyph}</span> {node.data.label}</div>
        <button style={mini} onClick={onClose}>✕</button>
      </div>
      <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)', marginBottom: 10 }}>{node.id} · {node.type}</div>
      {node.data.note && <div style={{ font: `400 12px/1.6 ${BODY}`, color: 'var(--text-secondary)', marginBottom: 10 }}>{node.data.note}</div>}

      {node.data.files?.length > 0 && <>
        <Label>Files ({node.data.files.length})</Label>
        {node.data.files.map(f => (
          <div key={f.rel} title={f.rel} style={{ display: 'flex', gap: 6, font: `400 11px ${MONO}`, padding: '2px 0' }}>
            <span style={{ color: f.change === 'create' ? 'var(--text-secondary)' : 'var(--amber)' }}>{f.change === 'create' ? '＋' : '✎'}</span>
            <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.rel}</span>
          </div>
        ))}
      </>}

      {(inn.length > 0 || out.length > 0) && <>
        <Label>Connections</Label>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {out.map(e => <li key={e.id} style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)', padding: '2px 0' }}>→ {name(e.target)} <i style={{ fontStyle: 'normal', color: 'var(--text-secondary)' }}>“{e.label || 'unlabelled'}”</i>{e.data?.isStatic === false ? ' ?' : ''}</li>)}
          {inn.map(e => <li key={e.id} style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)', padding: '2px 0' }}>← {name(e.source)} <i style={{ fontStyle: 'normal' }}>“{e.label || 'unlabelled'}”</i>{e.data?.isStatic === false ? ' ?' : ''}</li>)}
        </ul>
        <div style={{ font: `400 10px ${MONO}`, color: 'var(--text-secondary)', marginTop: 4 }}>? = asserted by the model; no import edge backs it</div>
      </>}

      <Label>Origin</Label>
      <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>{origin}</div>
    </div>
  )
}
const Label = ({ children }) => <div style={{ font: `600 10px ${MONO}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)', margin: '12px 0 4px' }}>{children}</div>

// ---- Files ---------------------------------------------------------------------------------------
function FilesTab({ t }) {
  const [f, setF] = useState(null)
  useEffect(() => { api.get(`/api/ticket/${t.key}/files?project=${t.project.key}`).then(setF).catch(e => setF({ available: false, reason: e.message })) }, [t.key, t.project.key])
  if (!f) return <Empty text="Loading…" />
  if (!f.available) return <NotReady reason={f.reason} />

  const max = Math.max(1, ...[...f.verified, ...f.plannedEdit].map(x => x.importers || 0))
  const Row = ({ x, glyph, colour }) => (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '4px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <span style={{ color: colour, font: `600 11px ${MONO}`, width: 14 }}>{glyph}</span>
      <span title={x.rel} style={{ font: `500 11px ${MONO}`, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.rel}</span>
      {x.importers == null
        // NEVER 0 — there is no source to parse, so nothing was measured (server/fe.mjs:466 sets
        // importers:null for exactly this reason).
        ? <><span style={{ font: `400 10px ${MONO}`, color: 'var(--text-secondary)', width: 130 }}>planned — does not exist yet</span>
            <span title="not measured — this file does not exist" style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)', width: 30, textAlign: 'right' }}>—</span></>
        : <><span style={{ width: 130 }}><span style={{ display: 'block', height: 6, borderRadius: 3, background: 'var(--bg-surface-active)' }}>
              <span style={{ display: 'block', height: '100%', borderRadius: 3, width: `${Math.round((x.importers / max) * 100)}%`, background: 'var(--blue)' }} /></span></span>
            <span style={{ font: `500 11px ${MONO}`, color: 'var(--text-secondary)', width: 30, textAlign: 'right' }}>←{x.importers}</span></>}
    </div>
  )

  return (
    <>
      {f.warnings?.length > 0 && f.warnings.map((w, i) => <Banner key={i}>{w.detail}</Banner>)}
      <Sec title={`Planned edits · ${f.plannedEdit.length}`} right={<span style={{ font: `400 10px ${MONO}`, color: 'var(--text-secondary)' }}>exists · this design changes it · importer counts are real</span>}>
        {f.plannedEdit.length ? f.plannedEdit.map(x => <Row key={x.rel} x={x} glyph="✎" colour="var(--amber)" />) : <Empty text="The design does not name any existing file." />}
      </Sec>
      <Sec title={`Verified neighbours · ${f.verified.length}`} right={<span style={{ font: `400 10px ${MONO}`, color: 'var(--text-secondary)' }}>parsed from real imports</span>}>
        {f.verified.length ? f.verified.map(x => <Row key={x.rel} x={x} glyph="▤" colour="var(--blue)" />) : <Empty text="No imports resolved from the planned files." />}
      </Sec>
      {/* five redundant signals that these do not exist: dashed container, transparent background,
          prose explainer, ＋ glyph, per-row text, and — for every metric */}
      <div style={{ border: '1px dashed var(--border-default)', borderRadius: 8, padding: '13px 15px', background: 'transparent', marginBottom: 12 }}>
        <div style={{ font: `600 12px ${HEAD}`, color: 'var(--text-primary)', marginBottom: 4 }}>Planned — new · {f.plannedNew.length}</div>
        <div style={{ font: `400 11px/1.6 ${MONO}`, color: 'var(--text-secondary)', marginBottom: 10 }}>
          These do not exist yet. No metrics, no importers, and no data-flow edges are drawn between them — there is no source to parse.
        </div>
        {f.plannedNew.length ? f.plannedNew.map(x => <Row key={x.rel} x={x} glyph="＋" colour="var(--text-secondary)" />) : <Empty text="The design does not propose any new file." />}
      </div>
      <div style={{ font: `400 10px ${MONO}`, color: 'var(--text-secondary)' }}>
        walked {f.stats.walked} source files in {f.repo.dir}{f.stats.truncated ? ' (truncated at the walk cap)' : ''}
      </div>
    </>
  )
}
