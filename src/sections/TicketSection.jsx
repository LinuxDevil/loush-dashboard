import React, { useCallback, useEffect, useRef, useState } from 'react'
import Markdown from '../ui/Markdown.jsx'
import { marked } from 'marked'
import { api, toast, tildify } from '../lib/api.js'
import { Tabs } from '../ui/tabs.jsx'
import DesignCanvas, { TYPES } from '../ticket/DesignCanvas.jsx'
import RederivePreview from '../ticket/RederivePreview.jsx'
import DesignChat from '../ticket/DesignChat.jsx'
import { useGraphEditor } from '../ticket/useGraphEditor.js'


const MONO = 'var(--mono)', HEAD = 'var(--head)', BODY = 'var(--body)'
const PANEL = { background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 12 }
const mini = { padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', cursor: 'pointer', font: `500 11px ${BODY}`, whiteSpace: 'nowrap' }

const fdt = s => (s ? new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—')
const elapsed = ms => (ms == null ? '—' : ms >= 60000 ? `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s` : `${(ms / 1000).toFixed(0)}s`)
const money = c => (c == null ? '—' : '$' + Number(c).toFixed(2))

function normalizeKey(input) {
  let s = String(input || '').trim()
  if (!s) return null
  const url = /\/browse\/([A-Za-z][A-Za-z0-9_]*-\d+)/.exec(s) || /[?&]selectedIssue=([A-Za-z][A-Za-z0-9_]*-\d+)/.exec(s)
  if (url) return url[1].toUpperCase()
  s = s.replace(/^[<([]+|[>)\],.;:]+$/g, '').trim().replace(/[\s_.]+/g, '-').replace(/-+/g, '-')
  const m = /^([A-Za-z][A-Za-z0-9_]*)-(\d+)$/.exec(s)
  return m ? `${m[1].toUpperCase()}-${m[2]}` : null
}

function copyText(text) {
  const fallback = () => {
    try {
      const ta = document.createElement('textarea')
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      toast(ok ? 'copied' : 'could not copy — select the text and copy manually', ok ? 'success' : 'error')
    } catch { toast('could not copy — select the text and copy manually', 'error') }
  }
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => toast('copied', 'success'), fallback)
  else fallback()
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
  const [ws, setWs] = useState(() => { try { return localStorage.getItem('ticket.workspace') } catch { return null } })
  const [raw, setRaw] = useState('')
  const [key, setKey] = useState(null)
  const [t, setT] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState('Ticket')
  const inputRef = useRef(null)

  const loadIdx = useCallback(w => api.get(`/api/ticket/index${w ? `?workspace=${encodeURIComponent(w)}` : ''}`)
    .then(setIdx).catch(() => setIdx({ available: false, workspaces: [], boards: [], saved: [] })), [])
  useEffect(() => { loadIdx(ws) }, [ws, loadIdx])
  useEffect(() => { if (ws && !key && inputRef.current) inputRef.current.focus() }, [ws, key])
  const pickWorkspace = w => { setWs(w); setKey(null); setT(null); setRaw(''); setErr(null); try { localStorage.setItem('ticket.workspace', w) } catch {} }

  const open = useCallback((k, fresh) => {
    const norm = normalizeKey(k)
    if (!norm) { setErr({ reason: `"${k}" is not a JIRA key — expected something like ABC-1234` }); return }
    if (!ws) { setErr({ reason: 'select a project first — it decides the folder agents read and the JIRA host' }); return }
    setBusy(true); setErr(null); setKey(norm)
    if (!fresh) { setT(null); setTab('Ticket') }
    api.get(`/api/ticket/${norm}?workspace=${encodeURIComponent(ws)}${fresh ? '&fresh=1' : ''}`)
      .then(d => { setT(d); loadIdx(ws) })
      .catch(e => setErr({ reason: e.message, detail: e.detail }))
      .finally(() => setBusy(false))
  }, [ws, loadIdx])

  const saved = idx?.saved || []
  const cur = (idx?.workspaces || []).find(w => w.id === ws) || null
  const ghost = normalizeKey(raw)

  const forget = k => api.del(`/api/ticket/${k}/saved?workspace=${encodeURIComponent(ws)}`)
    .then(() => loadIdx(ws)).catch(e => toast(e.message, 'error'))

  if (idx && !idx.available) return <NotReady onNav={onNav} to="projects" cta="Open Projects →"
    reason="No projects are open on this machine. This tab works inside a folder you have started a Claude Code session in — that is the folder its agents read." />

  return (
    <div>
      {/* ---- 1. pick the project (a folder), 2. open a ticket in it ---- */}
      <div style={{ ...PANEL, padding: '14px 16px', marginBottom: 12 }}>
        <div style={{ font: `600 10px ${MONO}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 6 }}>
          1 · Project
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          {(idx?.workspaces || []).map(w => {
            const on = ws === w.id
            return (
              <button key={w.id} onClick={() => pickWorkspace(w.id)} aria-pressed={on}
                title={[w.dir, w.slug, w.jira ? `JIRA: ${w.jira.key}` : 'not linked to a JIRA board'].filter(Boolean).join('\n')}
                style={{ ...mini, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '7px 11px',
                  ...(on ? { borderColor: 'var(--border-active)', background: 'var(--bg-surface-active)' } : {}) }}>
                <span style={{ font: `600 12px ${MONO}`, color: on ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{w.name}</span>
                <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-secondary)' }}>
                  {}
                  {w.jira ? `${w.jira.key}${w.jiraBound ? '' : ' (matched)'}` : '— no JIRA board linked'}
                  {w.saved > 0 ? ` · ${w.saved} saved` : ''}
                </span>
              </button>
            )
          })}
        </div>

        {}
        {cur && !key && (
          <div style={{ marginBottom: 14, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ font: `600 10px ${MONO}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Tickets from</span>
            <select value={cur.jiraBound ? cur.jira.key : ''} style={{ font: `400 11px ${MONO}`, maxWidth: 420 }}
              aria-label="JIRA board for this project"
              onChange={e => api.post(`/api/ticket/workspace/${cur.id}/jira`, { jiraKey: e.target.value || null })
                .then(() => loadIdx(cur.id)).catch(er => toast(er.message, 'error'))}>
              <option value="">{cur.jiraBound ? '(clear — match by git remote)' : cur.jira ? `auto: ${cur.jira.key} — matched by git remote` : 'auto: nothing matched'}</option>
              {(idx?.boards || []).map(b => (
                <option key={b.key} value={b.key}>{b.key}{b.jiraHost ? ` — ${b.jiraHost}` : ''}</option>
              ))}
            </select>
            {cur.jiraBound && <span style={{ font: `400 10px ${MONO}`, color: 'var(--green)' }}>✓ board chosen by you</span>}
            {!idx?.boards?.length && <button style={mini} onClick={() => onNav?.('setup')}>no boards configured — Open Setup →</button>}
          </div>
        )}

        <div style={{ font: `600 10px ${MONO}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: ws ? 'var(--text-secondary)' : 'var(--text-tertiary)', marginBottom: 6 }}>
          2 · Ticket
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240, position: 'relative' }}>
            <input ref={inputRef} value={raw} disabled={!ws}
              placeholder={ws ? `${cur?.jira?.projectKey || cur?.jira?.key || 'ABC'}-1234` : 'select a project first'}
              aria-label="JIRA ticket key"
              onChange={e => { setRaw(e.target.value); setErr(null) }}
              onKeyDown={e => { if (e.key === 'Enter' && ghost) open(ghost) }}
              onPaste={e => { const v = normalizeKey(e.clipboardData.getData('text')); if (v && !raw.trim()) { e.preventDefault(); setRaw(v); open(v) } }}
              style={{ font: `500 13px ${MONO}`, opacity: ws ? 1 : 0.5 }} />
            {ghost && ghost !== raw.trim().toUpperCase() && (
              <span style={{ position: 'absolute', right: 10, top: 7, font: `400 11px ${MONO}`, color: 'var(--text-secondary)', pointerEvents: 'none' }}>→ {ghost}</span>
            )}
          </div>
          <button className="primary" disabled={!ghost || !ws || busy} onClick={() => open(ghost)}>{busy ? 'opening…' : 'Open'}</button>
        </div>
        <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)', marginTop: 6 }}>
          {ws
            ? <>paste a browse URL or type the key — lowercase and <code>ABC 1234</code> are fine</>
            : 'saved tickets, the folder agents read and the JIRA host are all per project'}
        </div>
        {err && <div style={{ marginTop: 10, background: 'var(--red-bg)', border: '1px solid var(--red)', borderRadius: 6, padding: '8px 10px', font: `400 11px ${MONO}`, color: 'var(--red)' }}>
          {err.reason}{err.detail ? <div style={{ color: 'var(--text-secondary)', marginTop: 4 }}>{err.detail}</div> : null}
        </div>}

        {}
        {cur && !key && (
          <div style={{ marginTop: 12, font: `400 11px ${MONO}`, color: 'var(--text-secondary)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <span title={cur.dir}>{tildify(cur.dir)}</span>
            {cur.slug ? <span>{cur.slug}</span> : <span style={{ color: 'var(--amber)' }}>{cur.isGit ? 'no origin remote' : 'not a git repo'}</span>}
            {cur.jira?.host && <span>{cur.jira.host}</span>}
            {cur.skills?.length > 0 && <span style={{ color: 'var(--green)' }}>{cur.skills.length} project skill{cur.skills.length > 1 ? 's' : ''} available to agents</span>}
          </div>
        )}
      </div>

      {/* ---- saved tickets, as cards ---- */}
      {cur && !key && (
        <Sec title={`Saved in ${cur.name}`}
          right={<span style={{ font: `400 10px ${MONO}`, color: 'var(--text-secondary)' }}>opens from cache · no JIRA call</span>}>
          {!saved.length
            ? <Empty text="Nothing saved here yet. Open a ticket above and everything you generate for it — description, criteria, tests, design — is kept in this project." />
            : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
                {saved.map(x => <SavedCard key={x.key} x={x} onOpen={() => { setRaw(x.key); open(x.key) }} onForget={() => forget(x.key)} />)}
              </div>
            )}
        </Sec>
      )}

      {t?.available && (
        <>
          <TicketRail t={t} busy={busy} onRefresh={() => open(t.key, true)} onClose={() => { setKey(null); setT(null); setRaw('') }} />
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
const age = iso => {
  if (!iso) return null
  const m = Math.floor((Date.now() - Date.parse(iso)) / 60000)
  if (!Number.isFinite(m)) return null
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`
}

// ---- saved ticket card -------------------------------------------------------------------------
function SavedCard({ x, onOpen, onForget }) {
  const [confirm, setConfirm] = useState(false)
  const badge = (on, label, title) => on
    ? <span title={title} style={{ font: `400 10px ${MONO}`, color: 'var(--green)' }}>{label}</span>
    : null
  return (
    <div style={{ position: 'relative', border: '1px solid var(--border-default)', borderRadius: 8, background: 'var(--bg-elevated)' }}>
      <button onClick={onOpen} title={x.summary || x.key}
        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', background: 'none', border: 0, borderRadius: 8, cursor: 'pointer', color: 'inherit' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, paddingRight: 20 }}>
          <b style={{ font: `600 12px ${MONO}`, color: 'var(--text-link)' }}>{x.key}</b>
          {x.type && <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-secondary)' }}>{x.type}</span>}
          {x.status && <span className="chip" style={{ marginLeft: 'auto' }}>{x.status}</span>}
        </div>
        {}
        <div style={{ font: `400 12px/1.45 ${BODY}`, color: 'var(--text-primary)', marginTop: 5, minHeight: 34,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {x.summary || <span style={{ color: 'var(--text-secondary)' }}>no summary saved</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginTop: 7, flexWrap: 'wrap' }}>
          {badge(x.hasAc, '✓ AC', 'acceptance criteria generated')}
          {badge(x.hasTests, '✓ tests', 'test cases generated')}
          {badge(x.hasDoc, '✓ design', 'a design document was written into the repo')}
          {x.nodes > 0 && <span title={`${x.nodes} components in the graph`} style={{ font: `400 10px ${MONO}`, color: 'var(--text-secondary)' }}>◈ {x.nodes}</span>}
          <span style={{ marginLeft: 'auto', font: `400 10px ${MONO}`, color: 'var(--text-secondary)' }}>{age(x.fetchedAt) || '—'}</span>
        </div>
      </button>
      {}
      <button aria-label={confirm ? `confirm forgetting ${x.key}` : `forget ${x.key}`} title={confirm ? 'click again to forget' : 'forget this ticket'}
        onClick={() => (confirm ? onForget() : setConfirm(true))} onBlur={() => setConfirm(false)}
        style={{ position: 'absolute', top: 6, right: 6, padding: '1px 5px', borderRadius: 4, border: 0, background: 'none', cursor: 'pointer',
          font: `400 11px ${MONO}`, color: confirm ? 'var(--red)' : 'var(--text-secondary)' }}>
        {confirm ? 'forget?' : '✕'}
      </button>
    </div>
  )
}

const TicketRail = ({ t, busy, onRefresh, onClose }) => (
  <div style={{ ...PANEL, padding: '10px 14px', marginBottom: 10 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {t.url ? <a href={t.url} target="_blank" rel="noreferrer" style={{ font: `600 12px ${MONO}`, color: 'var(--text-link)', textDecoration: 'none' }}>{t.key} ↗</a>
        : <span style={{ font: `600 12px ${MONO}`, color: 'var(--text-primary)' }}>{t.key}</span>}
      <span className="chip">{t.project?.key}</span>
      <span style={{ font: `500 11px ${MONO}`, color: 'var(--text-secondary)' }}>{t.status || '—'}</span>
      <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>{t.type || '—'}</span>
      {}
      <span title={t.repo?.dir || t.repo?.reason || ''}
        style={{ font: `400 11px ${MONO}`, color: t.repo?.dir ? 'var(--green)' : 'var(--red)' }}>
        {t.repo?.dir ? `${t.workspace?.name || tildify(t.repo.dir)} ✓` : `— ${t.repo?.reason || 'no folder'}`}
      </span>
      {}
      <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ font: `400 10px ${MONO}`, color: t.refreshError ? 'var(--amber)' : 'var(--text-secondary)' }}>
          {t.refreshError ? `refresh failed — showing the copy from ${age(t.fetchedAt)}`
            : t.cached ? `cached ${age(t.fetchedAt)} · no JIRA call` : `fetched ${age(t.fetchedAt) || 'just now'}`}
        </span>
        <button style={mini} disabled={busy} onClick={onRefresh} title="re-fetch this ticket from JIRA">{busy ? '…' : '↻'}</button>
        <button style={mini} onClick={onClose}>✕</button>
      </span>
    </div>
    <div style={{ font: `600 15px ${HEAD}`, color: 'var(--text-primary)', marginTop: 6, lineHeight: 1.35 }}>{t.summary}</div>
    {t.refreshError && <div style={{ font: `400 10px ${MONO}`, color: 'var(--amber)', marginTop: 4 }}>{t.refreshError}</div>}
    {}
    {t.keyPrefixMismatch && (
      <div style={{ font: `400 10px ${MONO}`, color: 'var(--amber)', marginTop: 4 }}>
        ⚠ this key starts with <b>{t.keyPrefixMismatch}</b>, but <b>{t.workspace?.name}</b> is linked to the <b>{t.project?.key}</b> board — it was opened against {t.project?.jiraHost || 'that host'}. Change the board or the project if that is wrong.
      </div>
    )}
    {}
    {t.repo?.skills?.length > 0 && (
      <div style={{ font: `400 10px ${MONO}`, color: 'var(--text-secondary)', marginTop: 5, display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
        <span>agents here will use this repo’s own skills:</span>
        {t.repo.skills.slice(0, 8).map(s => <span key={s} className="chip" style={{ color: 'var(--green)' }}>/{s}</span>)}
        {t.repo.skills.length > 8 && <span>+{t.repo.skills.length - 8}</span>}
      </div>
    )}
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

      {}
      <Sec title="Linked PRs" right={<span style={{ font: `400 10px ${MONO}`, color: pc.loaded ? 'var(--text-secondary)' : 'var(--amber)' }}>{pc.loaded ? 'from the last snapshot' : 'not loaded'}</span>}>
        {!pc.loaded
          ? <div style={{ font: `400 12px/1.6 ${BODY}`, color: 'var(--text-secondary)' }}>
              PR context needs a project snapshot (~65s of live JIRA + GitHub). It is not loaded, which is
              not the same as “no PRs”. Open the Delivery section to build one.
            </div>
          : t.prs?.length
            ? t.prs.map(p => (
                <div key={p.num} style={{ padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  {}
                  <div style={{ font: `500 12px ${MONO}`, color: 'var(--text-link)' }}>#{p.num} <span style={{ color: 'var(--text-secondary)' }}>{p.state} · {p.changedFiles ?? '—'} files</span></div>
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
const META = {
  ac: { title: 'Acceptance criteria', noun: 'acceptance criteria' },
  tests: { title: 'Test cases', noun: 'test cases' },
  decompose: { title: 'Task decomposition', noun: 'a task breakdown' },
  streams: { title: 'Parallel work streams', noun: 'a work-stream analysis' },
}
const GEN_ORDER = ['ac', 'tests', 'decompose', 'streams']
const SEV_TONE = { error: 'var(--red)', warn: 'var(--amber)', info: 'var(--text-secondary)' }

// The findings the document itself cannot show. A decomposition always reads as coherent — a
// dependency on a task that is not in the list, or two unordered tasks writing the same file, look
// like ordinary prose. So the checks run against the real checkout and their results sit above the
// document rather than inside it.
function ValidationPanel({ v }) {
  if (!v) return null
  const errs = v.problems.filter(p => p.severity === 'error')
  const warns = v.problems.filter(p => p.severity === 'warn')
  const infos = v.problems.filter(p => p.severity === 'info')
  return (
    <div style={{ border: `1px solid ${errs.length ? SEV_TONE.error : warns.length ? SEV_TONE.warn : 'var(--green)'}`, borderRadius: 10, padding: '9px 13px', marginBottom: 10 }}>
      <div style={{ font: `600 11px ${MONO}`, color: errs.length ? SEV_TONE.error : warns.length ? SEV_TONE.warn : 'var(--green)' }}>
        {v.counts.tasks} task(s) · {errs.length} error(s) · {warns.length} warning(s)
        {v.filesChecked ? ' · checked against the checkout' : ' · file scopes NOT checked'}
      </div>
      {v.note && <div style={{ font: `400 11px ${BODY}`, color: SEV_TONE.warn, marginTop: 4 }}>{v.note}</div>}
      {[...errs, ...warns, ...infos].map((p, i) => (
        <div key={i} style={{ font: `400 11px ${BODY}`, color: SEV_TONE[p.severity], marginTop: 4 }}>
          <span style={{ font: `600 10px ${MONO}` }}>{p.kind}</span> — {p.detail}
        </div>
      ))}
      {!v.problems.length && <div style={{ font: `400 11px ${BODY}`, color: 'var(--green)', marginTop: 4 }}>Every dependency resolves, no cycles, and no two unordered tasks touch the same file.</div>}
    </div>
  )
}

function CriteriaTab({ t, onUpdate }) {
  const [busy, setBusy] = useState('')
  const [edit, setEdit] = useState(null)
  const [err, setErr] = useState(null)
  const arts = t.artifacts || {}

  const setArt = (kind, a) => onUpdate({ ...t, artifacts: { ...(t.artifacts || {}), [kind]: a } })
  const grounded = !!t.repo?.dir
  const gen = kind => {
    setBusy(kind); setErr(null)
    const url = grounded
      ? `/api/ticket/${t.key}/generate?workspace=${t.workspace.id}`
      : `/api/eng/ticket/${t.key}/generate?project=${t.project.key}`
    api.post(url, { kind })
      .then(a => setArt(kind, a)).catch(e => setErr({ message: e.message, detail: e.detail })).finally(() => setBusy(''))
  }
  const save = (kind, md) => api.put(`/api/eng/ticket/${t.key}/artifact?project=${t.project.key}`, { kind, md })
    .then(a => { setArt(kind, a); setEdit(null) }).catch(e => setErr({ message: e.message, detail: e.detail }))
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
      {}
      {err && <div style={{ background: 'var(--red-bg)', border: '1px solid var(--red)', borderRadius: 6, padding: '8px 10px', font: `400 11px ${MONO}`, color: 'var(--red)', marginBottom: 12 }}>
        {err.message}
        {err.detail && <div style={{ color: 'var(--text-secondary)', marginTop: 4 }}>{err.detail}</div>}
      </div>}
      {GEN_ORDER.map(kind => {
        const a = arts[kind]
        const editing = edit?.kind === kind
        return (
          <Sec key={kind} title={META[kind].title} right={
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {a && !editing && <button style={mini} onClick={() => setEdit({ kind, md: a.md })}>edit</button>}
              {a && <button style={mini} onClick={() => copyText(a.md)}>copy</button>}
              {a && <button style={mini} onClick={() => download(kind, a.md)}>.md</button>}
              {a && (t.project?.writes
                ? <button style={mini} onClick={() => post(kind, a.md)}>post to JIRA</button>
                : <button style={{ ...mini, opacity: 0.5, cursor: 'default' }} disabled title='set "writes": true for this project in projects.json'>JIRA writes off</button>)}
              <button style={mini} disabled={busy === kind} onClick={() => gen(kind)}>{busy === kind ? 'generating…' : a ? 'regenerate' : 'generate'}</button>
            </div>
          }>
            {busy === kind && (
              <div style={{ font: `400 12px ${BODY}`, color: 'var(--text-secondary)' }}>
                {grounded
                  ? `Reading ${t.workspace?.name} and writing ${META[kind].noun} — this takes a few minutes because it greps the code first.`
                  : 'Generating from the ticket text alone — no local checkout resolved, so nothing can be checked against the code.'}
              </div>
            )}
            {!grounded && !busy && (
              <Banner>
                {t.repo?.reason || 'No project folder'} — so anything generated here is written from the ticket text
                alone and cannot cite a real file. Pick a project whose folder still exists on disk.
              </Banner>
            )}
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
                <ValidationPanel v={a.validation} />
                <Markdown source={a.md || ''} />
                <div style={{ font: `400 10px ${MONO}`, color: 'var(--text-secondary)', marginTop: 10, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
                  {a.edited ? '✎ hand-edited by you' : `◇ generated by ${a.model || 'claude'}`} · {fdt(a.at)}
                  {}
                  {a.groundedIn
                    ? <> · <span style={{ color: 'var(--green)' }}>read {a.groundedIn}</span>{a.cost != null ? ` · ${money(a.cost)}` : ''}</>
                    : ' · from the ticket text only — not checked against any code'}
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
  const [view, setView] = useState(null)
  const [doc, setDoc] = useState(null)
  const [starting, setStarting] = useState(false)
  const [applying, setApplying] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [multi, setMulti] = useState(() => new Set())
  const [live, setLive] = useState('')
  const [now, setNow] = useState(Date.now())
  const load = useCallback(() => api.get(`/api/ticket/${t.key}/design?workspace=${t.workspace.id}`).then(x => { setD(x); setRun(x.run) }).catch(() => {}), [t.key, t.workspace.id])
  useEffect(() => { load() }, [load])

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
    es.onerror = () => { es.close(); setTimeout(load, 2000) }
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => { es.close(); clearInterval(tick) }
  }, [run?.done, run?.startedAt, t.key, load])

  const move = useCallback(pos => {
    setD(prev => (prev?.graph ? { ...prev, graph: { ...prev.graph, nodes: prev.graph.nodes.map(n => (pos[n.id] ? { ...n, position: pos[n.id] } : n)) } } : prev))
    api.patch(`/api/ticket/${t.key}/design/layout?workspace=${t.workspace.id}`, { positions: pos })
      .catch(() => toast('could not save the new layout', 'error'))
  }, [t.key, t.workspace.id])
  const start = () => {
    setStarting(true)
    api.post(`/api/ticket/${t.key}/design/run?workspace=${t.workspace.id}`, {})
      .then(r => { setRun(r.run); setTail([]) })
      .catch(e => toast(e.message, 'error'))
      .finally(() => setStarting(false))
  }
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

  const ed = useGraphEditor({ tKey: t.key, workspace: t.workspace.id, graph: g, rev: d?.rev, onGraph: setD })
  useEffect(() => {
    const onKey = e => {
      const typing = /^(INPUT|TEXTAREA)$/.test(e.target?.tagName) || e.target?.isContentEditable
      if (typing || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
      e.preventDefault()
      e.shiftKey ? ed.redo() : ed.undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ed])

  const rederive = keep => {
    setApplying(true)
    api.post(`/api/ticket/${t.key}/design/rederive?workspace=${t.workspace.id}`, { action: 'apply', keep })
      .then(setD).catch(e => toast(e.message, 'error')).finally(() => setApplying(false))
  }
  const discard = () => {
    setApplying(true)
    api.post(`/api/ticket/${t.key}/design/rederive?workspace=${t.workspace.id}`, { action: 'discard' })
      .then(setD).catch(e => toast(e.message, 'error')).finally(() => setApplying(false))
  }
  const retryExtract = () => api.post(`/api/ticket/${t.key}/design/extract?workspace=${t.workspace.id}`, {})
    .then(x => { setD(x); toast('diagram extracted', 'success') })
    .catch(e => toast(e.message, 'error'))
  const toBoard = () => {
    if (!confirm(`Create a Task Board ticket for ${t.key} in ${t.workspace?.name}?`)) return
    api.post(`/api/ticket/${t.key}/board?workspace=${t.workspace.id}`, {})
      .then(() => { load(); toast('handed off to the Task Board', 'success') })
      .catch(e => toast(e.message, 'error'))
  }

  return (
    <>
      {running && (
        <Sec title="① Design document" right={<span style={{ font: `400 11px ${MONO}`, color: 'var(--blue)' }}>running · {elapsed(now - run.startedAt)}</span>}>
          <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)', marginBottom: 8 }}>reading {t.workspace?.name} at {tildify(run.cwd || t.repo.dir || '')}</div>
          <div className="logblock" style={{ maxHeight: 150, overflow: 'auto' }}>
            {tail.length ? tail.map((x, i) => <div key={i}>▸ {x}</div>) : <span style={{ color: 'var(--text-secondary)' }}>waiting for the first tool call…</span>}
          </div>
          {}
          <div style={{ display: 'flex', gap: 12, marginTop: 8, font: `400 10px ${MONO}`, color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
            <span>{run.tools} tool calls</span><span>{run.filesRead} files read</span><span>{money(run.cost)}</span>
            <button style={{ ...mini, marginLeft: 'auto' }} onClick={cancel}>Cancel run</button>
          </div>
        </Sec>
      )}

      {!running && (
        <Sec title="Design" right={
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {d?.doc?.exists && <button style={mini} onClick={() => api.get(`/api/ticket/${t.key}/design/doc?workspace=${t.workspace.id}`).then(r => setDoc(doc ? null : r)).catch(e => toast(e.message, 'error'))}>{doc ? 'hide document' : 'view document'}</button>}
            {nodes.length > 0 && <button style={mini} onClick={() => fetch(`/api/ticket/${t.key}/design/mermaid?workspace=${t.workspace.id}`).then(r => r.text()).then(x => { navigator.clipboard?.writeText(x); toast('mermaid copied', 'success') })}>copy mermaid</button>}
            {}
            <button style={mini} disabled={starting} onClick={start}>{starting ? 'starting…' : d?.doc ? 'regenerate' : 'run design'}</button>
          </div>
        }>
          {run?.cancelled && <Banner>Cancelled after {elapsed(run.ms)} · {run.tools} tool calls · {money(run.cost)}. This is a cancellation, not a failure.</Banner>}
          {}
          {run?.partial && (
            <Banner>
              That run wrote {run.partial.bytes.toLocaleString()} bytes to <code>{run.partial.rel}</code> before it stopped.
              It was NOT moved to the final path, so nothing half-written is sitting where a finished spec would be.
              <button style={{ ...mini, marginLeft: 8 }} onClick={() => api.del(`/api/ticket/${t.key}/design/partial?workspace=${t.workspace.id}`).then(load).catch(e => toast(e.message, 'error'))}>discard it</button>
            </Banner>
          )}
          {run?.error && <div style={{ background: 'var(--red-bg)', border: '1px solid var(--red)', borderRadius: 6, padding: '8px 10px', font: `400 11px ${MONO}`, color: 'var(--red)', marginBottom: 10 }}>The run failed: {run.error}</div>}
          {d?.doc?.gitignored && <Banner>The document was written to a gitignored path. Run <code>git add -f {d.doc.rel}</code> in {t.workspace?.name} to track it — this app will not run git on your repo.</Banner>}
          {d?.diverged && <Banner>The design document changed after this diagram was built. Regenerate to re-derive it; your node positions are preserved.</Banner>}

          {}
          {!d && <Empty text="Loading…" />}
          {d && !d.doc && !nodes.length && <Empty text="No design yet — run one to have an agent read the repository and write a spec." />}
          {d?.doc && !d.doc.exists && <Banner>The design document is gone from disk ({d.doc.rel}). The diagram below is preserved.</Banner>}
          {d?.doc?.exists && (
            <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>
              ◇ {d.doc.rel} · generated {fdt(d.doc.genAt)} · {d.lastRun?.tools ?? '—'} tool calls · {elapsed(d.lastRun?.ms)} · {money(d.lastRun?.cost)} · rev {d.rev} · not verified since generation
            </div>
          )}
          {}
          {d?.doc?.exists && !nodes.length && (
            <Banner>
              No diagram — the model’s graph could not be parsed{d.lastRun?.parseError ? `: ${d.lastRun.parseError}` : ''}. The document above is unaffected.
              {}
              {d.canRetryExtract && <button style={{ ...mini, marginLeft: 8 }} onClick={retryExtract}>retry extraction</button>}
            </Banner>
          )}
          {d?.board && (
            <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)', marginTop: 8 }}>
              {d.board.gone
                ? '⚠ the Task Board ticket for this key no longer exists'
                : <>▤ on the Task Board as <b style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{d.board.stage || 'unknown stage'}</b> · handed off {fdt(d.board.at)}</>}
            </div>
          )}
        </Sec>
      )}

      {}
      {d?.pending && <RederivePreview pending={d.pending} current={d.graph} onApply={rederive} onDiscard={discard} busy={applying} />}

      {doc && <Sec title={doc.path.split('/').slice(-1)[0]}><Markdown source={doc.md || ''} /></Sec>}

      {d?.warnings?.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {d.warnings.map((w, i) => (
            <span key={i} title={w.detail} style={{ font: `400 10px ${MONO}`, color: 'var(--amber)', background: 'var(--amber-bg)', border: '1px solid var(--amber)', borderRadius: 6, padding: '1px 8px' }}>{w.detail}</span>
          ))}
        </div>
      )}

      {nodes.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            <button style={{ ...mini, ...(mode === 'Outline' ? { borderColor: 'var(--border-active)', background: 'var(--bg-surface-active)' } : {}) }} onClick={() => setView('Outline')}>Outline</button>
            <button style={{ ...mini, ...(mode === 'Canvas' ? { borderColor: 'var(--border-active)', background: 'var(--bg-surface-active)' } : {}) }} onClick={() => setView('Canvas')}>Canvas</button>
            {}
            <button style={mini} disabled={!ed.canUndo} title="undo (⌘Z)" onClick={ed.undo}>↶{ed.undoDepth ? ` ${ed.undoDepth}` : ''}</button>
            <button style={mini} disabled={!ed.canRedo} title="redo (⌘⇧Z)" onClick={ed.redo}>↷</button>
            <button style={mini} onClick={() => { const l = prompt('New component name:'); if (l?.trim()) setSel(ed.addNode(l.trim())) }}>＋ component</button>
            {}
            {mode === 'Canvas' && <button style={mini} disabled={!nodes.length} onClick={ed.tidy}
              title="lay the graph out left-to-right by dependency (⌘Z to undo)">⇥ tidy</button>}
            <button style={{ ...mini, ...(chatOpen ? { borderColor: 'var(--border-active)', background: 'var(--bg-surface-active)' } : {}) }} onClick={() => setChatOpen(o => !o)}>◗ chat</button>
            <button style={mini} onClick={toBoard} title="create a Task Board ticket carrying the AC and the design doc">⤴ Task Board</button>
            {multi.size > 1 && <button style={{ ...mini, color: 'var(--red)' }} onClick={() => { ed.removeNodes([...multi]); setMulti(new Set()); setSel(null) }}>delete {multi.size}</button>}
            <span style={{ font: `400 10px ${MONO}`, color: ed.saving === 'error' ? 'var(--amber)' : 'var(--text-secondary)' }}>
              {ed.saving === 'saving' ? 'saving…' : ed.saving === 'error' ? 'unsaved'
                : multi.size > 1 ? `${multi.size} selected` : `${nodes.length} nodes · ${(g.edges || []).length} connections`}
              {!view && nodes.length > 15 && ' — showing the outline: past ~15 a graph is usually harder to read than a list'}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 320 }}>
              {mode === 'Canvas'
                ? <DesignCanvas graph={g} selected={sel} selection={multi} onSelect={id => { setSel(id); setMulti(id ? new Set([id]) : new Set()) }}
                    onSelection={s2 => { setMulti(s2); if (s2.size === 1) setSel([...s2][0]); else if (!s2.size) setSel(null) }}
                    focusId={multi.size > 1 ? null : sel} onMove={move} onConnect={ed.addEdge}
                    onDelete={id => (multi.size > 1 ? ed.removeNodes([...multi]) : ed.removeNode(id))}
                    announce={setLive} />
                : <Outline graph={g} selected={sel} selection={multi} onSelect={setSel}
                    onSelection={s2 => { setMulti(s2); if (s2.size === 1) setSel([...s2][0]); else if (!s2.size) setSel(null) }} />}
              <div aria-live="polite" style={{ font: `400 10px ${MONO}`, color: 'var(--text-secondary)', marginTop: 4, minHeight: 14 }}>{live}</div>
            </div>
            {sel && <Inspector node={nodes.find(n => n.id === sel)} graph={g} ed={ed} onClose={() => setSel(null)} onSelect={setSel} />}
            {chatOpen && <DesignChat tKey={t.key} workspace={t.workspace.id} graph={g} selected={sel} rev={d.rev} onApplied={setD} />}
          </div>
        </>
      )}
    </>
  )
}

function Outline({ graph, selected, selection, onSelect, onSelection }) {
  const edges = graph.edges || []
  const sel = selection instanceof Set ? selection : new Set(selected ? [selected] : [])
  return (
    <div style={{ ...PANEL, padding: 8 }} role="listbox" aria-multiselectable="true" aria-label={`Design components — ${graph.nodes.length}`}>
      {graph.nodes.map(n => {
        const t = TYPES[n.type] || TYPES.process
        const out = edges.filter(e => e.source === n.id)
        const isSel = sel.has(n.id)
        return (
          <button key={n.id} role="option" aria-selected={isSel}
            aria-label={`${n.data.label}. ${n.type}. ${out.length} outgoing connections.`}
            onClick={ev => {
              if (ev.shiftKey || ev.metaKey || ev.ctrlKey) { const s2 = new Set(sel); s2.has(n.id) ? s2.delete(n.id) : s2.add(n.id); onSelection?.(s2) }
              else onSelect(selected === n.id ? null : n.id)
            }}
            style={{ display: 'flex', gap: 8, alignItems: 'baseline', width: '100%', textAlign: 'left', padding: '6px 8px', border: 'none', borderRadius: 6, background: isSel ? 'var(--bg-surface-active)' : 'transparent', boxShadow: selected === n.id ? 'inset 0 0 0 1px var(--text-primary)' : isSel ? 'inset 0 0 0 1px var(--accent)' : 'none' }}>
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

function Inspector({ node, graph, ed, onClose, onSelect }) {
  const [label, setLabel] = useState('')
  const [note, setNote] = useState('')
  const [connect, setConnect] = useState('')
  useEffect(() => { setLabel(node?.data?.label || ''); setNote(node?.data?.note || ''); setConnect('') }, [node?.id])
  if (!node) return null
  const t = TYPES[node.type] || TYPES.process
  const inn = (graph.edges || []).filter(e => e.target === node.id)
  const out = (graph.edges || []).filter(e => e.source === node.id)
  const name = id => graph.nodes.find(n => n.id === id)?.data.label || id
  const origin = { generated: 'generated by the design run', user: 'added by you', assistant: 'proposed by the assistant, applied by you' }[node.data?.origin] || '—'
  const commitLabel = () => { const v = label.trim(); if (v && v !== node.data.label) ed.patchNode(node.id, { data: { label: v } }) }
  const commitNote = () => { if (note !== (node.data.note || '')) ed.patchNode(node.id, { data: { note } }) }
  return (
    <div style={{ ...PANEL, width: 320, flexShrink: 0, padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10, gap: 8 }}>
        <span style={{ color: t.accent, font: `600 13px ${MONO}` }} aria-hidden="true">{t.glyph}</span>
        <input value={label} aria-label="component name"
          onChange={e => setLabel(e.target.value)} onBlur={commitLabel}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setLabel(node.data.label); e.currentTarget.blur() } }}
          style={{ flex: 1, font: `600 13px ${HEAD}`, padding: '3px 6px' }} />
        <button style={mini} onClick={onClose}>✕</button>
      </div>
      <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)', marginBottom: 10 }}>{node.id}</div>

      <Label>Type</Label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {Object.entries(TYPES).map(([k, v]) => (
          <button key={k} title={k} onClick={() => ed.patchNode(node.id, { type: k })}
            style={{ ...mini, font: `500 10px ${MONO}`, padding: '2px 7px', ...(node.type === k ? { borderColor: 'var(--border-active)', background: 'var(--bg-surface-active)' } : {}) }}>
            <span style={{ color: v.accent }} aria-hidden="true">{v.glyph}</span> {k}
          </button>
        ))}
      </div>

      <Label>Note</Label>
      <textarea value={note} rows={2} placeholder="why this exists"
        onChange={e => setNote(e.target.value)} onBlur={commitNote}
        style={{ resize: 'vertical', font: `400 11px ${BODY}` }} />

      {node.data.files?.length > 0 && <>
        <Label>Files ({node.data.files.length})</Label>
        {node.data.files.map(f => (
          <div key={f.rel} title={f.rel} style={{ display: 'flex', gap: 6, font: `400 11px ${MONO}`, padding: '2px 0' }}>
            <span style={{ color: f.change === 'create' ? 'var(--text-secondary)' : 'var(--amber)' }}>{f.change === 'create' ? '＋' : '✎'}</span>
            <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.rel}</span>
          </div>
        ))}
      </>}

      <Label>Connections</Label>
      {}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {[...out.map(e => ({ e, dir: 'out' })), ...inn.map(e => ({ e, dir: 'in' }))].map(({ e, dir }) => (
          <li key={e.id} style={{ padding: '3px 0', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
              <button onClick={() => onSelect(dir === 'out' ? e.target : e.source)}
                aria-label={`${dir === 'out' ? 'Outgoing' : 'Incoming'}. ${e.label || 'unlabelled'}. ${dir === 'out' ? 'To' : 'From'} ${name(dir === 'out' ? e.target : e.source)}.${e.data?.isStatic === false ? ' Asserted by the model; no import edge backs it.' : ''}`}
                style={{ ...mini, flex: 1, font: `400 11px ${MONO}`, textAlign: 'left', padding: '2px 6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {dir === 'out' ? '→' : '←'} {name(dir === 'out' ? e.target : e.source)}{e.data?.isStatic === false ? ' ?' : ''}
              </button>
              <button style={{ ...mini, padding: '2px 6px', color: 'var(--red)' }} title="remove this connection" onClick={() => ed.removeEdge(e.id)}>✕</button>
            </div>
            {}
            <input defaultValue={e.label || ''} placeholder="what moves along this connection"
              aria-label={`label for the connection to ${name(dir === 'out' ? e.target : e.source)}`}
              onBlur={ev => { const v = ev.target.value.trim(); if (v !== (e.label || '')) ed.setEdgeLabel(e.id, v) }}
              onKeyDown={ev => { if (ev.key === 'Enter') ev.currentTarget.blur(); if (ev.key === 'Escape') { ev.currentTarget.value = e.label || ''; ev.currentTarget.blur() } }}
              style={{ font: `400 10px ${MONO}`, padding: '2px 6px', marginTop: 2 }} />
          </li>
        ))}
      </ul>
      {(inn.length > 0 || out.length > 0) && <div style={{ font: `400 10px ${MONO}`, color: 'var(--text-secondary)', marginTop: 4 }}>? = asserted by the model; no import edge backs it</div>}

      <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
        <select value={connect} onChange={e => setConnect(e.target.value)} style={{ flex: 1, font: `400 11px ${MONO}` }}>
          <option value="">connect to…</option>
          {graph.nodes.filter(n => n.id !== node.id && !out.some(e => e.target === n.id)).map(n => <option key={n.id} value={n.id}>{n.data.label}</option>)}
        </select>
        <button style={mini} disabled={!connect} onClick={() => { ed.addEdge(node.id, connect); setConnect('') }}>add</button>
      </div>

      <Label>Origin</Label>
      <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>
        {origin}{node.data?.orphaned ? ' · kept through a re-derive that dropped it' : ''}
      </div>

      <button className="danger" style={{ marginTop: 12, width: '100%' }}
        onClick={() => { ed.removeNode(node.id); onClose() }}>Delete component</button>
    </div>
  )
}
const Label = ({ children }) => <div style={{ font: `600 10px ${MONO}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)', margin: '12px 0 4px' }}>{children}</div>

// ---- Files ---------------------------------------------------------------------------------------
function FilesTab({ t }) {
  const [f, setF] = useState(null)
  useEffect(() => { api.get(`/api/ticket/${t.key}/files?workspace=${t.workspace.id}`).then(setF).catch(e => setF({ available: false, reason: e.message })) }, [t.key, t.workspace.id])
  if (!f) return <Empty text="Loading…" />
  if (!f.available) return <NotReady reason={f.reason} />

  const max = Math.max(1, ...[...f.verified, ...f.plannedEdit].map(x => x.importers || 0))
  const Row = ({ x, glyph, colour }) => (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '4px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <span style={{ color: colour, font: `600 11px ${MONO}`, width: 14 }}>{glyph}</span>
      <span title={x.rel} style={{ font: `500 11px ${MONO}`, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.rel}</span>
      {x.importers == null
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
      <Sec title={`Verified neighbours · ${f.verifiedTotal > f.verified.length ? `${f.verified.length} of ${f.verifiedTotal}` : f.verified.length}`}
        right={<span style={{ font: `400 10px ${MONO}`, color: 'var(--text-secondary)' }}>parsed from real imports</span>}>
        {f.verified.length ? f.verified.map(x => <Row key={x.rel} x={x} glyph="▤" colour="var(--blue)" />) : <Empty text="No imports resolved from the planned files." />}
      </Sec>
      {}
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
