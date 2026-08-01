import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api, fmtDate, toast } from '../lib/api.js'
import AgentLive from '../ui/AgentLive.jsx'
import Skeleton from '../ui/Skeleton.jsx'
import { useFreshest, useVisiblePoll } from '../lib/hooks.js'
import { useWorkScope } from '../ui/WorkScopeBar.jsx'

const MONO = "var(--mono)"
const HEAD = "var(--head)"
const PANEL = { background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 12, padding: '16px 18px' }
const STAGE_C = { backlog: 'var(--text-secondary)', 'in-progress': 'var(--blue)', 'code-review': 'var(--amber)', fixing: 'var(--accent-light)', 'ready-for-qa': 'var(--violet)', 'qa-running': 'var(--blue)', 'bug-reported': 'var(--red)', 'ready-for-release': 'var(--green)', released: 'var(--text-tertiary)' }
const TYPE_C = { feature: 'var(--blue)', sub: 'var(--text-secondary)', bug: 'var(--red)' }
const MODELS = ['haiku', 'sonnet', 'opus']
const hrs = ms => (ms / 3600_000).toFixed(1) + 'h'
const age = t => { const d = Math.floor((Date.now() - t) / 86400_000); return d === 0 ? 'today' : d + 'd' }
const lbl = s => s.replace(/-/g, ' ')

function useProjects() {
  const [scopes, setScopes] = useState([])
  // `.catch(() => {})` around a `.then()` that also does the filtering meant a shape change in
  // /api/harness — or any throw inside the filter — rendered "no projects" forever, with the
  // error surfaced nowhere. An empty board that is actually a broken fetch is indistinguishable
  // from an empty board, so the failure is now carried out to the caller.
  const [error, setError] = useState(null)
  useEffect(() => {
    api.get('/api/harness')
      .then(d => {
        if (!d || !Array.isArray(d.scopes)) throw new Error('/api/harness did not return a scopes array')
        setScopes(d.scopes.filter(s => s.id !== 'global'))
        setError(null)
      })
      .catch(e => { setError(e.message || String(e)); setScopes([]) })
  }, [])
  return Object.assign(scopes, { error })
}
const H2 = ({ children }) => <div style={{ font: `600 12px ${HEAD}`, marginBottom: 6 }}>{children}</div>

const SEV_C = { critical: 'var(--red)', high: 'var(--red)', medium: 'var(--amber)', low: 'var(--text-secondary)' }
const CLASS_LABEL = {
  code: { text: 'fixable here', color: 'var(--accent-light)' },
  'needs-human': { text: 'needs a human', color: 'var(--violet)' },
  'pre-existing': { text: 'pre-existing', color: 'var(--text-tertiary)' },
}

/**
 * Findings, grouped by what can actually happen to them next.
 *
 * A flat list of nine rows says nothing about which of them the loop is still chasing. Open,
 * awaiting-re-review, parked and resolved are four different states with four different owners, and
 * the pile that matters — what the next fix run will touch — is usually two of the nine.
 */
function Findings({ t, onAct }) {
  const [busy, setBusy] = useState(null)
  const all = t.findings || []
  const decide = (f, body) => {
    setBusy(f.id)
    onAct('post', `/api/board/tickets/${t.id}/findings/${encodeURIComponent(f.id)}`, body).finally(() => setBusy(null))
  }
  const groups = [
    { key: 'open', title: 'Open — the fix agent works on the highest severity of these', rows: all.filter(f => f.status === 'open') },
    { key: 'fix-attempted', title: 'Addressed — unconfirmed until the next review', rows: all.filter(f => f.status === 'fix-attempted') },
    { key: 'acked', title: 'Accepted — recorded, no longer blocking', rows: all.filter(f => f.status === 'acked') },
    { key: 'resolved', title: 'Resolved — a later review stopped raising them', rows: all.filter(f => f.status === 'resolved') },
  ].filter(g => g.rows.length)
  return (
    <div>
      <H2>Review findings ({all.filter(f => f.status !== 'resolved').length} live · {all.length} seen)</H2>
      {groups.map(g => (
        <div key={g.key} style={{ marginBottom: 8 }}>
          <div style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)', marginBottom: 3 }}>{g.title}</div>
          {g.rows.map(f => {
            const cls = CLASS_LABEL[f.class] || CLASS_LABEL.code
            const stale = g.key === 'resolved'
            return (
              <div key={f.id} style={{ font: `400 11px ${MONO}`, padding: '3px 0', opacity: stale ? 0.5 : 1, display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ color: SEV_C[f.severity] || 'var(--text-secondary)' }}>[{f.severity}]</span>
                <span style={{ color: cls.color }}>{cls.text}</span>
                {/* Seen three times means the loop is not converging on it — the number is the
                    signal that a human, not another fix round, is what this needs. */}
                {f.seenCount > 1 && <span title={`raised in ${f.seenCount} reviews`} style={{ color: f.seenCount > 2 ? 'var(--amber)' : 'var(--text-tertiary)' }}>×{f.seenCount}</span>}
                <span style={{ color: 'var(--accent-light)' }}>{(f.file || '').split('/').pop()}</span>
                <span style={{ color: 'var(--text-secondary)', flex: 1, minWidth: 200 }}>{f.summary}</span>
                {f.ackNote && <span style={{ color: 'var(--violet)' }}>“{f.ackNote}”</span>}
                {g.key !== 'resolved' && (
                  <span style={{ display: 'flex', gap: 4 }}>
                    {f.status !== 'acked'
                      ? <button className="mini" style={{ marginTop: 0 }} disabled={busy === f.id}
                          title="accept this finding as known — it stops blocking and stops being re-raised, and the decision is recorded"
                          onClick={() => decide(f, { status: 'acked', note: prompt('Why is this accepted? (recorded on the ticket)') || null })}>accept</button>
                      : <button className="mini" style={{ marginTop: 0 }} disabled={busy === f.id} onClick={() => decide(f, { status: 'open' })}>reopen</button>}
                    {f.class === 'code' && <button className="mini" style={{ marginTop: 0 }} disabled={busy === f.id}
                      title="no agent can fix this from inside the repo — park it for a person"
                      onClick={() => decide(f, { class: 'needs-human' })}>not fixable here</button>}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
const Meta = ({ children, color = 'var(--text-tertiary)' }) => <span style={{ font: `400 11px ${MONO}`, color }}>{children}</span>
const ModelInput = props => (<><input list="board-models" placeholder="model (blank = default)" {...props} /><datalist id="board-models">{MODELS.map(m => <option key={m} value={m} />)}</datalist></>)

/** Paste a JIRA link; intake follows what it points at and reports what it could not reach. */
function JiraIntake({ project, teams, model, team, onDone }) {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const go = () => {
    setBusy(true); setResult(null)
    api.post('/api/ticket/intake', { project, input: input.trim(), team: team || null, model: model || null })
      .then(r => { setResult(r); setInput(''); onDone() })
      .catch(e => setResult({ error: e.message })).finally(() => setBusy(false))
  }
  const s = result?.sources
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && input.trim() && !busy) go() }}
          placeholder="paste a JIRA link — https://…/browse/AIR-10817, a board URL, or just the key" style={{ flex: 1 }} />
        <button className="primary" onClick={go} disabled={busy || !input.trim()}>{busy ? 'fetching…' : 'Fetch & file'}</button>
      </div>
      <Meta>follows what the ticket points at: linked tickets, Confluence pages, the content sheet, and the Figma frames</Meta>
      {result?.error && <Meta color="var(--red)">{result.error}</Meta>}
      {s && <Meta color="var(--green)">
        filed {result.key} · {result.designRefs?.figma?.length || 0} figma · sheet {s.sheet} · {s.confluence.length} confluence · {s.jira.length} linked
        {s.unresolved?.length ? ` · ${s.unresolved.length} not readable: ${s.unresolved.join('; ')}` : ''}
      </Meta>}
    </div>
  )
}

function Intake({ project, teams, onDone }) {
  const [title, setTitle] = useState(''); const [desc, setDesc] = useState(''); const [team, setTeam] = useState(''); const [model, setModel] = useState('')
  const submit = () => api.post('/api/board/tickets', { project, title, desc, team: team || null, model: model || null })
    .then(() => { setTitle(''); setDesc(''); onDone() }).catch(e => alert(e.message))
  return (
    <div style={{ ...PANEL, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ font: `600 14px ${HEAD}` }}>New ticket</div>
      <JiraIntake project={project} teams={teams} team={team} model={model} onDone={onDone} />
      <div style={{ borderTop: '1px solid var(--bg-surface-hover)', paddingTop: 10, font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>or write one by hand</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="title" style={{ flex: 1 }} />
        <select value={team} onChange={e => setTeam(e.target.value)}><option value="">no team (general agent)</option>{teams.map(t => <option key={t.id} value={t.id}>{t.name} v{t.version}</option>)}</select>
        <ModelInput value={model} onChange={e => setModel(e.target.value)} style={{ width: 160 }} />
      </div>
      <textarea rows={4} value={desc} onChange={e => setDesc(e.target.value)} placeholder="paste JIRA content — description, acceptance criteria, links. The analyze step proposes a sub-ticket breakdown from this." />
      <button className="primary" style={{ alignSelf: 'flex-start' }} onClick={submit} disabled={!title.trim()}>Create ticket</button>
    </div>
  )
}

/** A title that is just the URL the ticket came from tells you nothing a card has room for. */
const cardTitle = t => {
  const s = String(t.title || '').trim()
  if (!/^https?:\/\//.test(s)) return s
  const key = (/\/browse\/([A-Z][A-Z0-9_]*-\d+)/i.exec(s) || /[?&]selectedIssue=([A-Z][A-Z0-9_]*-\d+)/i.exec(s) || [])[1]
  return key ? `${key.toUpperCase()} — untitled (created from a link, not fetched)` : s
}

const CHIP = tone => ({
  font: '600 9px var(--mono)', padding: '1px 5px', borderRadius: 3, whiteSpace: 'nowrap',
  color: `var(--${tone})`, background: `var(--${tone}-bg, var(--bg-surface-hover))`,
})

/**
 * What the ticket carries with it. The point of these is the NEGATIVE case: "sheet ↗" means the
 * copy deck was linked and could not be read, which is exactly the thing that silently produces an
 * implementation with invented strings.
 */
function SourceChips({ t }) {
  const s = t.sources || {}
  const figma = t.designRefs?.figma?.length || 0
  const chips = []
  if (figma) chips.push(<span key="f" style={CHIP('accent-light')} title={t.designRefs.figma.join('\n')}>◇ figma{figma > 1 ? ` ×${figma}` : ''}</span>)
  if (t.designRefs?.captures?.length) chips.push(<span key="c" style={CHIP('accent-light')} title={t.designRefs.captures.join('\n')}>▣ captures ×{t.designRefs.captures.length}</span>)
  if (t.designRefs?.contentCsv) chips.push(<span key="s" style={CHIP('green')} title={t.designRefs.contentCsv}>▤ sheet</span>)
  else if (s.sheet === 'link-only') chips.push(<span key="s" style={CHIP('amber')} title="linked but not shared — export it by hand">▤ sheet ↗</span>)
  if (s.confluence?.length) chips.push(<span key="w" style={CHIP('blue')} title={s.confluence.join('\n')}>❐ confluence ×{s.confluence.length}</span>)
  if (s.jira?.length) chips.push(<span key="j" style={CHIP('blue')} title={s.jira.join('\n')}>⇄ {s.jira.length} linked</span>)
  if (s.unresolved?.length) chips.push(<span key="u" style={CHIP('red')} title={s.unresolved.join('\n')}>⚠ {s.unresolved.length} unread</span>)
  if (!chips.length) return null
  return <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{chips}</div>
}

function Card({ t, all, onOpen, selected }) {
  const kids = all.filter(x => x.parent === t.id)
  const doneKids = kids.filter(x => x.stage === 'released').length
  return (
    <div onClick={() => onOpen(t.id)} style={{
      background: selected ? 'var(--accent-bg)' : 'var(--bg-inset)', border: `1px solid ${t.blocked ? 'var(--red-bg)' : selected ? 'var(--accent-bg)' : 'var(--bg-surface-hover)'}`,
      borderRadius: 6, padding: '8px 10px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{ font: `600 9px ${MONO}`, color: TYPE_C[t.type] || 'var(--text-secondary)' }}>{(t.type || 'feature').toUpperCase()}</span>
        {t.running && <span style={{ font: `600 9px ${MONO}`, color: 'var(--blue)' }}>◐ {t.running.kind}</span>}
        {t.blocked && <span style={{ font: `600 9px ${MONO}`, color: 'var(--red)' }}>⛔ blocked</span>}
        {!t.running && !t.blocked && ['code-review', 'ready-for-qa', 'ready-for-release'].includes(t.stage) && <span style={{ font: `600 9px ${MONO}`, color: 'var(--amber)' }}>⏸ your click</span>}
        {t.conflictRisk?.length > 0 && <span title={t.conflictRisk.map(c => c.title + ': ' + c.files.join(', ')).join('\n')} style={{ font: `600 9px ${MONO}`, color: 'var(--accent-light)' }}>⚠ overlap</span>}
        {t.depBlocked?.length > 0 && <span style={{ font: `600 9px ${MONO}`, color: 'var(--text-secondary)' }}>🔒 deps</span>}
      </div>
      {/* A pasted JIRA URL used to be the whole title, wrapping to three lines of hostname. The key
          is the part anyone reads, so it leads, and the title is clamped rather than allowed to set
          the card's height. */}
      {t.jiraKey && <span style={{ font: `600 10px ${MONO}`, color: 'var(--accent-light)' }}>{t.jiraKey}</span>}
      <div title={t.title} style={{
        font: '500 12px var(--body)', color: 'var(--text-primary)', overflowWrap: 'anywhere',
        display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>{cardTitle(t)}</div>
      <SourceChips t={t} />
      <Meta>{t.model || 'default'}{t.team ? ' · team' : ''}{kids.length ? ` · ${doneKids}/${kids.length} subs` : ''} · {age(t.createdAt)}</Meta>
    </div>
  )
}

function QaForm({ t, onRun }) {
  const [q, setQ] = useState({ baseUrl: t.qa?.baseUrl || t.preview?.url || '', env: t.qa?.env || 'staging', scope: t.qa?.scope || '', notes: t.qa?.notes || '' })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <H2>QA inputs</H2>
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={q.baseUrl} onChange={e => setQ({ ...q, baseUrl: e.target.value })} placeholder="base URL (auto-filled from preview env)" style={{ flex: 2 }} />
        <select value={q.env} onChange={e => setQ({ ...q, env: e.target.value })}><option>staging</option><option>preview</option><option>prod</option></select>
        <input value={q.scope} onChange={e => setQ({ ...q, scope: e.target.value })} placeholder="pages / flows in scope" style={{ flex: 1.5 }} />
      </div>
      <input value={q.notes} onChange={e => setQ({ ...q, notes: e.target.value })} placeholder="login / test-account notes, anything else" />
      <button className="primary" style={{ alignSelf: 'flex-start' }} onClick={() => onRun(q)}>▶ Run QA</button>
    </div>
  )
}

/**
 * The ticket panel, as a drawer over the board rather than a block pushed in above it.
 *
 * Inline, opening a ticket moved every lane down the page — you clicked a card and the board you
 * were reading jumped. A drawer leaves the columns where they are, which matters most when the
 * thing you opened the ticket to do is drag it somewhere else afterwards.
 */
function Drawer({ onClose, children }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.38)', zIndex: 60 }} />
      <aside role="dialog" aria-modal="true" style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(720px, 94vw)', zIndex: 61,
        background: 'var(--bg-surface)', borderLeft: '1px solid var(--bg-surface-hover)',
        boxShadow: '-18px 0 46px rgba(0,0,0,0.28)', overflowY: 'auto', padding: 16,
      }}>{children}</aside>
    </>
  )
}

const elapsed = ms => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`)

/**
 * Branch and base, per ticket.
 *
 * Only editable before the worktree is cut, which is also the only time the answer can still
 * change anything — so once it exists this collapses to a read-only line rather than an input that
 * looks live and is refused by the server.
 */
function BranchEditor({ t, cfg, parent, onSave }) {
  const [open, setOpen] = useState(false)
  const [branch, setBranch] = useState(t.branch || '')
  const [base, setBase] = useState(t.base || '')
  const cut = !!t.worktree
  const defaultBranch = `${cfg?.branchPrefix ?? 'ticket/'}${t.branchKey || t.jiraKey || t.id}`
  // A sub-ticket's default base is its parent's branch, created when the first child starts.
  const parentBranch = parent ? parent.branch || `${cfg?.branchPrefix ?? 'ticket/'}${parent.branchKey || parent.jiraKey || parent.id}` : null
  const defaultBase = parentBranch || cfg?.base || 'main'
  useEffect(() => { setBranch(t.branch || ''); setBase(t.base || '') }, [t.id, t.branch, t.base])

  if (cut) return <Meta>branch <b>{t.branch}</b> off <b>{t.basedOn || t.base || defaultBase}</b> · fixed once the worktree exists</Meta>
  if (!open) {
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Meta>will branch <b>{branch || defaultBranch}</b> off <b>{base || defaultBase}</b></Meta>
        <button className="mini" style={{ marginTop: 0 }} onClick={() => setOpen(true)}>change</button>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}><Meta>branch</Meta>
        <input value={branch} onChange={e => setBranch(e.target.value)} placeholder={defaultBranch} style={{ width: 260 }} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}><Meta>base — branches from it, merges back into it</Meta>
        <input value={base} onChange={e => setBase(e.target.value)} placeholder={defaultBase} style={{ width: 200 }} />
      </label>
      {parentBranch && !base && <Meta color="var(--accent-light)">stacked on its parent · only the parent branch merges to {cfg?.base || 'main'}</Meta>}
      <button className="primary" onClick={() => { onSave({ branch: branch.trim() || null, base: base.trim() || null }); setOpen(false) }}>save</button>
      <button onClick={() => { setBranch(t.branch || ''); setBase(t.base || ''); setOpen(false) }}>cancel</button>
      <Meta>blank = the project default</Meta>
    </div>
  )
}

function Detail({ t, all, teams, cfg, onRefresh, onClose, bare }) {
  const [reply, setReply] = useState('')
  const [escModel, setEscModel] = useState('')
  const [subs, setSubs] = useState(null)
  // `alert(e.message)` threw away everything that made the failure actionable. "no sub-ticket could
  // start" is a summary; the server also says WHICH child and WHY for each one, and that detail was
  // being dropped on the floor — leaving a dead end where the answer had already been computed.
  const [failure, setFailure] = useState(null)
  const call = (m, url, body) => api[m](url, body)
    .then(r => { setFailure(null); onRefresh(); return r })
    .catch(e => setFailure({ message: e.message, detail: e.detail || null, skipped: e.body?.skipped || null }))
  const act = (action, body) => call('post', `/api/board/tickets/${t.id}/${action}`, body || {})
  const patch = body => call('patch', '/api/board/tickets/' + t.id, body)
  const kids = all.filter(x => x.parent === t.id)
  // Named consequences, not "are you sure": what is destroyed (worktrees, sub-tickets) and what
  // survives (the branch and its commits) are the two things you actually need before answering.
  const del = () => {
    const lines = [`Delete "${t.title}"?`, '']
    if (kids.length) lines.push(`· its ${kids.length} sub-ticket${kids.length === 1 ? '' : 's'} go too`)
    if (t.worktree) lines.push('· the worktree is removed')
    if (t.branch) lines.push(`· the branch ${t.branch} and its commits are KEPT`)
    if (!window.confirm(lines.join('\n'))) return
    api.del('/api/board/tickets/' + t.id)
      .then(r => { onClose(); onRefresh(); if (r.branchesKept?.length) toast(`deleted · ${r.branchesKept.join(', ')} kept`, 'success') })
      .catch(e => alert(e.message))
  }
  const lastQa = t.qaResults?.slice(-1)[0]
  const proposal = subs ?? t.proposal
  // Inline, the description had to be a 140px scroll box or it pushed the whole board down the
  // page. In the drawer it can run its full length — but then it goes LAST, because a 10k-character
  // JIRA description between you and the "Start dev agent" button is its own kind of broken.
  const desc = t.desc ? (
    <pre style={{ margin: 0, font: `400 11px/1.6 ${MONO}`, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: bare ? 'none' : 140, overflow: bare ? 'visible' : 'auto' }}>{t.desc}</pre>
  ) : null
  return (
    <div style={{ ...(bare ? {} : PANEL), display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ font: `600 9px ${MONO}`, color: TYPE_C[t.type] || 'var(--text-secondary)', marginTop: 4 }}>{(t.type || 'feature').toUpperCase()}</span>
        <span style={{ font: `600 14px ${HEAD}`, flex: 1, minWidth: 200, overflowWrap: 'anywhere' }}>{cardTitle(t)}</span>
        <button className="mini" style={{ marginTop: 0, color: 'var(--red)' }} onClick={del} title="removes the ticket and its worktree — the branch and its commits are kept">🗑 delete</button>
        <button className="mini" style={{ marginTop: 0 }} onClick={onClose}>✕</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Meta color={STAGE_C[t.stage] || 'var(--text-secondary)'}>● {lbl(t.stage)}</Meta>
        {t.branch && <Meta>{t.branch}{t.basedOn && t.basedOn !== 'main' ? ` (stacked on ${t.basedOn})` : ''}</Meta>}
        <Meta>{t.pipelineVersion}</Meta>
        <SourceChips t={t} />
      </div>
      <BranchEditor t={t} cfg={cfg} parent={t.parent ? all.find(x => x.id === t.parent) : null} onSave={patch} />

      {failure && (
        <div style={{ background: 'var(--red-bg)', border: '1px solid var(--red)', borderRadius: 6, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ font: `600 12px ${MONO}`, color: 'var(--red)', flex: 1 }}>{failure.message}</span>
            <button className="mini" style={{ marginTop: 0 }} onClick={() => setFailure(null)}>dismiss</button>
          </div>
          {failure.detail && <Meta color="var(--text-secondary)">{failure.detail}</Meta>}
          {failure.skipped?.map(s => (
            <div key={s.id} style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>· <b>{s.title}</b> — {s.why}</div>
          ))}
        </div>
      )}
      {!bare && desc}

      {t.blocked && (
        <div style={{ background: 'var(--red-bg)', border: '1px solid var(--red)', borderRadius: 6, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ font: `600 12px ${MONO}`, color: 'var(--red)' }}>⛔ blocked by {t.blocked.by} ({t.blocked.category}) · {fmtDate(t.blocked.at)}</div>
          <pre style={{ margin: 0, font: `400 11px/1.5 ${MONO}`, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto' }}>{t.blocked.needed || t.blocked.reason}</pre>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={reply} onChange={e => setReply(e.target.value)} placeholder="answer the question / provide the missing decision — resumes the agent with this injected" style={{ flex: 1 }} />
            <button className="primary" onClick={() => act('unblock', { reply })} disabled={!reply.trim()}>↩ reply & resume</button>
            <button onClick={() => patch({ blocked: null })} title="take over manually — restores the stage so you can re-run triggers yourself">clear block</button>
          </div>
        </div>
      )}

      {proposal?.length > 0 && (
        <div style={{ background: 'var(--blue-bg)', border: '1px solid var(--blue)', borderRadius: 6, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <H2>Proposed sub-ticket breakdown — edit, then accept</H2>
          {proposal.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 6 }}>
              <input value={s.title} onChange={e => setSubs(proposal.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} style={{ flex: 1 }} />
              <input value={s.desc || ''} onChange={e => setSubs(proposal.map((x, j) => j === i ? { ...x, desc: e.target.value } : x))} style={{ flex: 2 }} />
              <Meta>{s.deps?.length ? 'after #' + s.deps.map(d => d + 1).join(',#') : ''}</Meta>
              <button className="mini" style={{ marginTop: 0 }} onClick={() => setSubs(proposal.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="primary" onClick={() => act('breakdown', { subs: proposal })}>✓ accept — create {proposal.length} sub-tickets</button>
            <button className="mini" style={{ marginTop: 0 }} onClick={() => setSubs(proposal.concat({ title: '', desc: '', deps: [] }))}>+ add</button>
            <button className="mini" style={{ marginTop: 0 }} onClick={() => { setSubs(null); patch({}) }}>dismiss</button>
          </div>
        </div>
      )}

      {/* The old copy here pointed at Reliability → Traces "once the session appears", which is a
          different screen, a different mental model, and only true after the fact. The transcript
          is tailable from the moment the agent starts, so the answer to "what is it doing" belongs
          on the ticket doing it. */}
      {(t.running || t.worktree || t.runs?.length > 0) && <AgentLive ticketId={t.id} running={t.running} onStopped={onRefresh} />}

      {t.running ? null : !t.blocked && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {t.resumeSessionId && !t.running && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="primary" onClick={() => act('start', { resume: t.resumeSessionId, ...(escModel ? { model: escModel } : {}) })} title="picks the stopped session back up with its context intact">▸ Resume stopped agent</button>
              <Meta>stopped session {t.resumeSessionId.slice(0, 8)} · resuming keeps what it had already worked out</Meta>
            </div>
          )}
          {t.stage === 'backlog' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="primary" onClick={() => act('start', escModel ? { model: escModel } : {})} disabled={t.depBlocked?.length > 0}
                title={t.depBlocked?.length ? 'blocked by unfinished dependencies' : kids.length ? 'starts each sub-ticket in its own worktree — the parent itself runs no agent' : 'creates an isolated worktree branch and starts the dev agent'}>
                {kids.length ? `▸ Start ${kids.length} sub-ticket${kids.length === 1 ? '' : 's'}` : '▸ Start dev agent'}
              </button>
              <button onClick={() => act('analyze')} title="agent proposes an independently-workable sub-ticket breakdown">✂ Analyze into sub-tickets</button>
              <ModelInput value={escModel} onChange={e => setEscModel(e.target.value)} style={{ width: 150 }} />
            </div>
          )}
          {t.stage === 'code-review' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="primary" onClick={() => act('review')}>▶ Run code review</button>
              {}
              {t.findings?.some(f => f.status === 'open' && f.class === 'code' && ['critical', 'high'].includes(f.severity)) &&
                <button onClick={() => act('fix')} title="fixes the highest open severity band only, then you re-run review to confirm — accepted and needs-human findings are not sent">⚒ Auto-fix findings</button>}
            </div>
          )}
          {t.stage === 'ready-for-qa' && (t.designRefs?.figma?.length || t.designRefs?.captures?.length || t.designRefs?.contentCsv) && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="primary" onClick={() => act('designqa')} title="compares the running branch against the Figma frames and the agreed copy — failures come back as review findings, not bugs">◧ Run design QA</button>
              <Meta>{t.designQa?.pass ? `design QA passed · ${t.designQa.cases?.length || 0} checks` : 'not checked against the design yet'}</Meta>
            </div>
          )}
          {t.stage === 'ready-for-qa' && <QaForm t={t} onRun={q => act('qa', q)} />}
          {t.stage === 'ready-for-release' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="primary" onClick={() => api.post(`/api/board/tickets/${t.id}/release`).then(r => { if (r.prCmd) { navigator.clipboard.writeText(r.prCmd); alert('PR flow — gh pr create command copied') } onRefresh() }).catch(e => alert(e.message))}>🚀 Release</button>
              <Meta>human gate — merges {t.branch} via the project's merge queue (or copies a PR command if require-PR is on)</Meta>
            </div>
          )}
        </div>
      )}

      {t.preview?.url && <Meta color="var(--green)">⬢ preview: <a href={t.preview.url} target="_blank" rel="noreferrer" style={{ color: 'var(--green)' }}>{t.preview.url}</a> <button className="mini" style={{ marginTop: 0, marginLeft: 8 }} onClick={() => call('del', `/api/board/tickets/${t.id}/preview`)}>stop</button></Meta>}

      {}
      {t.verdict && (() => {
        const spend = (t.runs || []).reduce((s, r) => s + (r.cost || 0), 0)
        const tone = t.verdict.action === 'advance' ? 'var(--green)' : t.verdict.action === 'fix' ? 'var(--amber)' : 'var(--red)'
        return (
          <div style={{ borderLeft: `3px solid ${tone}`, paddingLeft: 10, font: `400 11px ${MONO}` }}>
            <span style={{ color: tone, fontWeight: 600 }}>{t.verdict.action}</span>
            <span style={{ color: 'var(--text-secondary)' }}> — {t.verdict.reason}</span>
            <div style={{ color: 'var(--text-tertiary)', marginTop: 2 }}>
              {(t.reviewRounds || []).length} review round{(t.reviewRounds || []).length === 1 ? '' : 's'} · ${spend.toFixed(2)} spent on this ticket
              {t.reviewedSha ? ` · reviewed @ ${String(t.reviewedSha).slice(0, 7)}` : ''}
            </div>
          </div>
        )
      })()}

      {t.findings?.length > 0 && <Findings t={t} onAct={call} />}

      {lastQa && (
        <div>
          <H2>QA run {fmtDate(lastQa.at)} — {lastQa.pass ? <span style={{ color: 'var(--green)' }}>all {lastQa.cases.length} passed</span> : <span style={{ color: 'var(--red)' }}>{lastQa.cases.filter(c => c.pass === false).length}/{lastQa.cases.length} failed → bugs auto-filed</span>}</H2>
          {lastQa.cases.map((c, i) => (
            <div key={i} style={{ font: `400 11px ${MONO}`, padding: '2px 0', color: 'var(--text-secondary)' }}>
              {c.pass === false ? '✗' : c.kind === 'manual' ? '◻' : '✓'} <span style={{ color: c.pass === false ? 'var(--red)' : 'var(--text-primary)' }}>{c.name}</span> <span style={{ color: 'var(--text-tertiary)' }}>({c.kind})</span>{c.evidence ? <span style={{ color: 'var(--text-tertiary)' }}> — {String(c.evidence).slice(0, 120)}</span> : ''}
            </div>
          ))}
          <Meta>saved as this ticket's regression pack — future QA runs on related tickets can reuse it</Meta>
        </div>
      )}

      {kids.length > 0 && <div><H2>Sub-tickets</H2>{kids.map(k => <div key={k.id} style={{ font: `400 11px ${MONO}`, padding: '2px 0' }}><span style={{ color: STAGE_C[k.stage] }}>●</span> <span style={{ color: 'var(--text-primary)' }}>{k.title}</span> <Meta>{lbl(k.stage)}{k.deps?.length ? ' · after ' + k.deps.length + ' dep(s)' : ''}</Meta></div>)}</div>}

      {t.runs?.length > 0 && (
        <details>
          <summary style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)', cursor: 'pointer' }}>{t.runs.length} agent runs · ${t.runs.reduce((s, r) => s + (r.cost || 0), 0).toFixed(2)} · every run audited with its context handoff</summary>
          {t.runs.map((r, i) => (
            <div key={i} style={{ margin: '8px 0', padding: '8px 10px', background: 'var(--bg-inset)', borderRadius: 8 }}>
              <div style={{ font: `600 11px ${MONO}`, color: r.status === 'ok' ? 'var(--green)' : 'var(--red)' }}>{r.kind} · {r.model} · {r.status} · ${(r.cost || 0).toFixed(3)} · {r.turns} turns · {Math.round((r.ms || 0) / 1000)}s {r.sessionId ? '· ' + r.sessionId.slice(0, 8) : ''} · {fmtDate(r.at)}</div>
              {r.handoff && <Meta>passed: {r.handoff.passed.join(', ')} — excluded: {r.handoff.excluded.join(', ') || 'nothing'}</Meta>}
              <pre style={{ margin: '4px 0 0', font: `400 10px/1.5 ${MONO}`, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', maxHeight: 110, overflow: 'auto' }}>{r.summary}</pre>
            </div>
          ))}
        </details>
      )}

      {bare && desc && <details open>
        <summary style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)', cursor: 'pointer' }}>ticket description</summary>
        <div style={{ marginTop: 8 }}>{desc}</div>
      </details>}

      <details>
        <summary style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)', cursor: 'pointer' }}>timeline · admin</summary>
        {(t.history || []).map((h, i) => <div key={i} style={{ font: `400 11px ${MONO}`, color: h.to.startsWith('blocked') ? 'var(--red)' : 'var(--text-secondary)', padding: '1px 0' }}>{fmtDate(h.at)} — {h.from || '·'} → {h.to}{h.note ? ' · ' + h.note : ''}</div>)}
        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
          <select value={t.stage} onChange={e => patch({ stage: e.target.value })} title="manual move">{(t.stages || []).map(s => <option key={s}>{s}</option>)}</select>
          <select value={t.team || ''} onChange={e => patch({ team: e.target.value || null })}><option value="">no team</option>{teams.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          <ModelInput value={t.model || ''} onChange={e => patch({ model: e.target.value || null })} style={{ width: 140 }} title="escalate mid-flight — next run uses this model, state kept" />
        </div>
      </details>
    </div>
  )
}

function Analytics({ project }) {
  const [days, setDays] = useState(30)
  const [a, setA] = useState(null)
  const fresh = useFreshest(setA)
  useEffect(() => { fresh(api.get(`/api/board/analytics?days=${days}${project ? '&project=' + encodeURIComponent(project) : ''}`)).catch(() => {}) }, [project, days, fresh])
  if (!a) return <Skeleton tiles={5} rows={5} />
  const kpi = (label, val, sub) => (
    <div style={{ ...PANEL, padding: '14px 18px', flex: 1, minWidth: 150 }}>
      <div style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ font: `600 20px ${HEAD}`, color: 'var(--text-primary)', margin: '4px 0' }}>{val ?? '—'}</div>
      {sub && <Meta>{sub}</Meta>}
    </div>
  )
  const bars = (obj, unit, color) => {
    const entries = Object.entries(obj).filter(([, v]) => (v.avg ?? v) > 0)
    const max = Math.max(...entries.map(([, v]) => v.avg ?? v), 0.01)
    return entries.map(([k, v]) => (
      <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
        <Meta>{lbl(k).padEnd(2)}</Meta>
        <div style={{ flex: 1, height: 8, background: 'var(--bg-surface-hover)', borderRadius: 4 }}>
          <div style={{ width: Math.max(2, ((v.avg ?? v) / max) * 100) + '%', height: '100%', background: color || 'var(--accent)', borderRadius: 4 }} />
        </div>
        <Meta color="var(--text-secondary)">{(v.avg ?? v)}{unit}{v.p90 != null ? ` · p90 ${v.p90}${unit}` : ''}{v.n ? ` · n=${v.n}` : ''}</Meta>
      </div>
    ))
  }
  const table = (title, data) => Object.keys(data).length > 0 && (
    <div style={{ ...PANEL }}>
      <H2>{title}</H2>
      <table style={{ width: '100%', font: `400 11px ${MONO}`, color: 'var(--text-secondary)', borderSpacing: 0 }}>
        <thead><tr style={{ color: 'var(--text-tertiary)', textAlign: 'left' }}><th>who</th><th>released</th><th>avg cycle</th><th>bug ratio</th><th>findings</th><th>escalations</th><th>touches</th><th>cost</th></tr></thead>
        <tbody>{Object.entries(data).map(([k, o]) => (
          <tr key={k}><td style={{ color: 'var(--text-primary)', padding: '3px 8px 3px 0' }}>{k}</td><td>{o.released}</td><td>{o.avgCycleH ?? '—'}h</td>
            <td style={{ color: o.bugRatio > 1 ? 'var(--red)' : undefined }}>{o.bugRatio ?? '—'}</td><td>{o.findings}</td><td>{o.escalations}</td><td>{o.touches}</td><td>${o.cost.toFixed(2)}</td></tr>
        ))}</tbody>
      </table>
    </div>
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8 }}>{[7, 30, 90].map(d => <button key={d} className={days === d ? 'primary' : ''} onClick={() => setDays(d)}>{d}d</button>)}</div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {kpi('released', a.cycle.released, `${a.total} tickets in window`)}
        {kpi('cycle p50 / p90', a.cycle.p50h != null ? `${a.cycle.p50h}h` : null, a.cycle.p90h != null ? `p90 ${a.cycle.p90h}h` : 'backlog → released')}
        {kpi('bug ratio', a.bugRatio, 'QA bugs ÷ released')}
        {kpi('cost / released', a.costPerReleased != null ? '$' + a.costPerReleased.toFixed(2) : null, `$${a.costSunkUnreleased.toFixed(2)} sunk in unreleased`)}
        {kpi('blocked now', a.blockedNow.length, a.blockedNow[0] ? a.blockedNow[0].title.slice(0, 26) : 'nothing stuck')}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ ...PANEL }}><H2>Live funnel — tickets per column</H2>{bars(a.columns, '', 'var(--blue)')}</div>
        <div style={{ ...PANEL }}><H2>Avg time-in-column</H2>{bars(a.timeInStageH, 'h')}</div>
        <div style={{ ...PANEL }}><H2>Blocked time by reason</H2>{Object.keys(a.blockedByReasonH).length ? bars(a.blockedByReasonH, 'h', 'var(--red)') : <Meta>none recorded</Meta>}<Meta>recurring reasons are a project-config smell — fix at the source</Meta></div>
        <div style={{ ...PANEL }}><H2>QA cycles per released ticket</H2>{bars(a.qaCyclesDist, '', 'var(--violet)')}<Meta>0 = shipped bug-free on first QA pass · {a.staleRegressionCases} regression case(s) never failed in ≥2 runs (possibly stale)</Meta></div>
      </div>
      {table('By team', a.byTeam)}
      {table('By model', a.byModel)}
      <div style={{ ...PANEL }}>
        <H2>Cost by stage</H2>
        <Meta color="var(--text-secondary)">dev ${a.costByStage.dev.toFixed(2)} · review ${a.costByStage.review.toFixed(2)} · QA ${a.costByStage.qa.toFixed(2)}</Meta>
        {Object.keys(a.throughputPerDay).length > 0 && <div style={{ marginTop: 10 }}><H2>Throughput — released per day</H2>{bars(a.throughputPerDay, '', 'var(--green)')}</div>}
      </div>
    </div>
  )
}

function Setup({ project, board, onRefresh }) {
  const [cfg, setCfg] = useState(board.config || {})
  const [team, setTeam] = useState(null)
  const [pipe, setPipe] = useState(null)
  useEffect(() => setCfg(board.config || {}), [board.config])
  const saveCfg = () => api.post('/api/board/config', { project, ...cfg, previewIdleMin: Number(cfg.previewIdleMin) || 240, costCap: Number(cfg.costCap) || 0 }).then(onRefresh).catch(e => alert(e.message))
  const F = ({ label, k, w, ph }) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, width: w || 160 }}>
      <Meta>{label}</Meta>
      <input value={cfg[k] ?? ''} onChange={e => setCfg({ ...cfg, [k]: e.target.value })} placeholder={ph} />
    </label>
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ ...PANEL, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ font: `600 14px ${HEAD}` }}>Project pipeline & branches — {project.split('/').pop()}</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}><Meta>pipeline template</Meta>
            <select value={cfg.pipeline || 'default'} onChange={e => setCfg({ ...cfg, pipeline: e.target.value })}>{board.pipelines.map(p => <option key={p.id} value={p.id}>{p.name} v{p.version} ({p.stages.length} stages)</option>)}</select>
          </label>
          {F({ label: 'base branch', k: 'base', ph: 'main', w: 110 })}
          {F({ label: 'branch prefix', k: 'branchPrefix', ph: 'ticket/', w: 110 })}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}><Meta>merge method</Meta>
            <select value={cfg.mergeMethod || 'merge'} onChange={e => setCfg({ ...cfg, mergeMethod: e.target.value })}><option value="merge">merge commit</option><option value="squash">squash</option><option value="rebase">rebase (ff-only)</option></select>
          </label>
          {F({ label: 'default model', k: 'defaultModel', ph: 'sonnet', w: 110 })}
          {}
          {F({ label: 'cost cap $/ticket', k: 'costCap', ph: '0 = none', w: 110 })}
          <label style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)', display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={!!cfg.requirePr} onChange={e => setCfg({ ...cfg, requirePr: e.target.checked })} title="the board never pushes and never opens a PR. With this on, Release stops merging locally and copies a push + gh pr create command for you to run." />never merge locally — copy a push + PR command instead</label>
          <label style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)', display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={!!cfg.qaSeesFindings} onChange={e => setCfg({ ...cfg, qaSeesFindings: e.target.checked })} title="context handoff opt-in: by default QA tests behavior unbiased by implementation detail" />QA sees review findings</label>
          <label style={{ font: `400 11px ${MONO}`, color: cfg.autopilot ? 'var(--accent-light)' : 'var(--text-secondary)', display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={!!cfg.autopilot} onChange={e => setCfg({ ...cfg, autopilot: e.target.checked })} title="every 20s, advance each ticket to its next stage. Stops at: a blocked ticket, QA-reported bugs, and the release gate — those stay yours." />autopilot</label>
        </div>
        {cfg.autopilot ? <Meta>autopilot advances tickets on its own: analyze → breakdown → dev → review → fix → design QA → QA. It stops and waits for you on a <b>blocked</b> ticket (an agent asked a question), on <b>QA-reported bugs</b>, and at the <b>release gate</b> — it never merges.</Meta> : null}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {F({ label: 'preview env command (plug-in point: docker compose / vercel / your CI script — $BRANCH $TICKET $WORKTREE env vars; first URL printed becomes the QA base URL)', k: 'previewCmd', ph: 'docker compose -p $TICKET up', w: 520 })}
          {F({ label: 'stop command (optional)', k: 'previewStopCmd', ph: 'docker compose -p $TICKET down', w: 240 })}
          {F({ label: 'idle teardown (min)', k: 'previewIdleMin', ph: '240', w: 110 })}
        </div>
        <button className="primary" style={{ alignSelf: 'flex-start' }} onClick={saveCfg}>Save project config</button>
        <Meta>in-flight tickets keep the pipeline version they started on — changing the template never breaks them</Meta>
      </div>

      <div style={{ ...PANEL, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ font: `600 14px ${HEAD}` }}>Agent teams <Meta>· which agent/model handles which stage; versioned like profiles</Meta></div>
        {board.teams.map(x => (
          <div key={x.id} style={{ display: 'flex', gap: 10, alignItems: 'center', font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>
            <span style={{ color: 'var(--text-primary)', width: 140 }}>{x.name} v{x.version}</span>
            {['dev', 'review', 'qa'].map(s => <span key={s}>{s}: {x.stages?.[s]?.model || 'default'}</span>)}
            <button className="mini" style={{ marginTop: 0, marginLeft: 'auto' }} onClick={() => setTeam(x)}>edit</button>
            <button className="mini danger" style={{ marginTop: 0 }} onClick={() => api.del('/api/board/teams/' + x.id).then(onRefresh)}>✕</button>
          </div>
        ))}
        {team ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--bg-inset)', borderRadius: 6, padding: 10 }}>
            <input value={team.name || ''} onChange={e => setTeam({ ...team, name: e.target.value })} placeholder="team name" style={{ width: 220 }} />
            {['dev', 'review', 'qa'].map(s => (
              <div key={s} style={{ display: 'flex', gap: 6 }}>
                <Meta>{s.padEnd(6)}</Meta>
                <ModelInput value={team.stages?.[s]?.model || ''} onChange={e => setTeam({ ...team, stages: { ...team.stages, [s]: { ...team.stages?.[s], model: e.target.value } } })} style={{ width: 120 }} />
                <input value={team.stages?.[s]?.instructions || ''} onChange={e => setTeam({ ...team, stages: { ...team.stages, [s]: { ...team.stages?.[s], instructions: e.target.value } } })} placeholder={`stage-specific instructions / skills / MCP notes for the ${s} agent`} style={{ flex: 1 }} />
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="primary" onClick={() => api.post('/api/board/teams', team).then(() => { setTeam(null); onRefresh() }).catch(e => alert(e.message))} disabled={!team.name?.trim()}>save team</button>
              <button onClick={() => setTeam(null)}>cancel</button>
            </div>
          </div>
        ) : <button className="mini" style={{ alignSelf: 'flex-start' }} onClick={() => setTeam({ name: '', stages: {} })}>+ new team</button>}
      </div>

      <div style={{ ...PANEL, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ font: `600 14px ${HEAD}` }}>Pipeline templates <Meta>· stages are ordered building blocks — skip review for low-stakes projects, insert custom sign-off columns</Meta></div>
        {board.pipelines.map(p => (
          <div key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'center', font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>
            <span style={{ color: 'var(--text-primary)', width: 160 }}>{p.name} v{p.version}</span>
            <span style={{ flex: 1 }}>{p.stages.join(' → ')}</span>
            {Object.keys(p.wip || {}).length > 0 && <Meta>WIP: {Object.entries(p.wip).map(([k, v]) => `${k}=${v}`).join(' ')}</Meta>}
            <button className="mini" style={{ marginTop: 0 }} onClick={() => setPipe({ ...p, stagesText: p.stages.join(', '), wipText: Object.entries(p.wip || {}).map(([k, v]) => `${k}=${v}`).join(', ') })}>edit</button>
          </div>
        ))}
        {pipe ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--bg-inset)', borderRadius: 6, padding: 10 }}>
            <input value={pipe.name} onChange={e => setPipe({ ...pipe, name: e.target.value })} placeholder="template name" style={{ width: 220 }} />
            <input value={pipe.stagesText} onChange={e => setPipe({ ...pipe, stagesText: e.target.value })} placeholder="stages, comma-separated, in order — e.g. backlog, in-progress, design-signoff, ready-for-release, released" />
            <input value={pipe.wipText} onChange={e => setPipe({ ...pipe, wipText: e.target.value })} placeholder="WIP limits — e.g. in-progress=3, qa-running=2 (caps concurrent cost & preview envs)" />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="primary" onClick={() => api.post('/api/board/pipelines', {
                id: pipe.id, name: pipe.name,
                stages: pipe.stagesText.split(',').map(s => s.trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean),
                wip: Object.fromEntries(pipe.wipText.split(',').map(s => s.split('=').map(x => x.trim())).filter(([k, v]) => k && Number(v)).map(([k, v]) => [k, Number(v)])),
              }).then(() => { setPipe(null); onRefresh() }).catch(e => alert(e.message))} disabled={!pipe.name?.trim()}>save template</button>
              <button onClick={() => setPipe(null)}>cancel</button>
            </div>
          </div>
        ) : <button className="mini" style={{ alignSelf: 'flex-start' }} onClick={() => setPipe({ name: '', stagesText: DEFAULTS_TXT, wipText: '' })}>+ new template</button>}
      </div>
    </div>
  )
}
const DEFAULTS_TXT = 'backlog, in-progress, code-review, fixing, ready-for-qa, qa-running, bug-reported, ready-for-release, released'

export default function BoardSection() {
  const projects = useProjects()
  // The section's project, not this pane's. The scope key is the absolute path, which is exactly
  // what a harness scope id already is — so this needs no translation, only the honesty check
  // below that the path is a repo the board actually knows about.
  const project = useWorkScope().path || ''
  const [tab, setTab] = useState('board')
  const [board, setBoard] = useState(null)
  const [open, setOpen] = useState(null)
  const [fAttention, setFAttention] = useState(false)
  const [dragOver, setDragOver] = useState(null)
  // Switching project while the previous board is still in flight would otherwise repaint the old
  // project's lanes under the new project's name.
  const fresh = useFreshest(setBoard)
  const load = () => { if (project) fresh(api.get('/api/board?project=' + encodeURIComponent(project))).catch(() => {}) }
  const move = (id, stage) => { const t = board?.tickets.find(x => x.id === id); if (t && t.stage !== stage) api.patch('/api/board/tickets/' + id, { stage }).then(load).catch(e => toast(e.message, 'error')) }
  // Clearing first matters: without it the previous project's lanes stay on screen under the new
  // project's name until the fetch lands.
  useEffect(() => { setBoard(null); setOpen(null) }, [project])
  useVisiblePoll(load, 5000, [project])

  const stages = useMemo(() => {
    if (!board) return []
    const pipe = board.pipelines.find(p => p.id === (board.config?.pipeline || 'default')) || board.pipelines[0]
    const extra = [...new Set(board.tickets.map(t => t.stage))].filter(s => !pipe.stages.includes(s))
    return [...pipe.stages, ...extra]
  }, [board])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {}
        {projects.error
          ? <Meta color="var(--red)">projects could not be loaded — {projects.error}</Meta>
          : !project ? <Meta color="var(--amber)">no project selected above</Meta>
            : !projects.some(p => p.id === project)
              ? <Meta color="var(--amber)">{project.split('/').pop()} has no Claude Code settings — the board still works, nothing is scoped to it</Meta>
              : <Meta>{projects.find(p => p.id === project)?.label}</Meta>}
        {['board', 'analytics', 'setup'].map(x => <button key={x} className={tab === x ? 'primary' : ''} onClick={() => setTab(x)}>{x}</button>)}
        {tab === 'board' && board && board.tickets.some(t => t.running) && (
          <button className="primary" style={{ background: 'var(--red)', borderColor: 'var(--red)', marginLeft: 'auto' }}
            title="kills every running agent on this project — each keeps its session id and can be resumed"
            onClick={() => {
              const live = board.tickets.filter(t => t.running)
              if (!window.confirm(`Stop ${live.length} running agent${live.length === 1 ? '' : 's'} on this project?\n\n${live.map(t => `· ${cardTitle(t)} (${t.running.kind})`).join('\n')}\n\nEach keeps its session id and can be resumed.`)) return
              api.post('/api/board/stop-all', { project }).then(r => { toast(`stopped ${r.stopped} agent${r.stopped === 1 ? '' : 's'}`, 'success'); load() }).catch(e => alert(e.message))
            }}>■ stop all {board.tickets.filter(t => t.running).length} running</button>
        )}
        {tab === 'board' && board && (
          <label style={{ font: `400 11px ${MONO}`, color: 'var(--amber)', display: 'flex', gap: 5, alignItems: 'center', marginLeft: board.tickets.some(t => t.running) ? 0 : 'auto' }}>
            <input type="checkbox" checked={fAttention} onChange={e => setFAttention(e.target.checked)} />
            attention only ({board.tickets.filter(t => t.blocked || (!t.running && ['code-review', 'ready-for-qa', 'ready-for-release'].includes(t.stage))).length})
          </label>
        )}
      </div>
      {!project ? <div style={{ ...PANEL, font: `400 12px ${MONO}`, color: 'var(--text-tertiary)' }}>open a project in Claude Code first — the board is scoped per project</div>
        : !board ? <Skeleton tiles={0} rows={6} />
        : tab === 'analytics' ? <Analytics project={project} />
        : tab === 'setup' ? <Setup project={project} board={board} onRefresh={load} />
        : (
        <>
          <Intake project={project} teams={board.teams} onDone={load} />
          {open && board.tickets.find(t => t.id === open) && <Drawer onClose={() => setOpen(null)}>
            <Detail bare t={board.tickets.find(t => t.id === open)} all={board.tickets} teams={board.teams} cfg={board.config} onRefresh={load} onClose={() => setOpen(null)} />
          </Drawer>}
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', alignItems: 'flex-start', paddingBottom: 6 }}>
            {/* Nine lanes at a 200px floor is 1800px of board, and on a ticket that has not started
                yet eight of them are empty — so the one column with anything in it sat off the left
                edge behind a horizontal scrollbar. Empty lanes keep their label and stay drop
                targets, at a width that fits the word rather than a card. */}
            {stages.map(s => {
              const col = board.tickets.filter(t => t.stage === s && (!fAttention || t.blocked || (!t.running && ['code-review', 'ready-for-qa', 'ready-for-release'].includes(t.stage))))
              return (
                <div key={s}
                  onDragOver={e => { e.preventDefault(); if (dragOver !== s) setDragOver(s) }}
                  onDragLeave={() => setDragOver(o => (o === s ? null : o))}
                  onDrop={e => { e.preventDefault(); setDragOver(null); const id = e.dataTransfer.getData('text/plain'); if (id) move(id, s) }}
                  style={{
                    // A lane holding cards is a fixed 248px — wide enough for a title, and it never
                    // stretches to swallow the row. Empty lanes are the slack: they shrink first
                    // when the board runs out of width, so the columns with work in them keep it.
                    flex: col.length ? '0 0 248px' : '0 1 84px', minWidth: col.length ? 248 : 44,
                    opacity: col.length ? 1 : 0.55, display: 'flex', flexDirection: 'column', gap: 8,
                    borderRadius: 6, outline: dragOver === s ? '1px dashed var(--blue)' : 'none', outlineOffset: 4,
                  }}>
                  <div title={`${lbl(s)} — ${col.length}`} style={{ font: `600 10px ${MONO}`, color: STAGE_C[s] || 'var(--violet)', textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lbl(s)} <span style={{ color: 'var(--text-tertiary)' }}>{col.length}</span></div>
                  {col.map(t => (
                    <div key={t.id} draggable onDragStart={e => e.dataTransfer.setData('text/plain', t.id)} style={{ cursor: 'grab' }}>
                      <Card t={t} all={board.tickets} onOpen={id => setOpen(id === open ? null : id)} selected={open === t.id} />
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
          <p className="small">board lives in ~/.claude/taskboard.json (every write versioned) · dev agents run headless claude in isolated git worktrees under ~/.claude/board-worktrees · review, design QA & QA are manual triggers unless <b>autopilot</b> is on for this project (setup tab) · release is always a human gate with a per-repo merge queue · blocked ≠ idle: blocked cards surface in Inbox as errors, idle-waiting as info</p>
        </>
      )}
    </div>
  )
}
