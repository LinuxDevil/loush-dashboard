import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api, fmtDate, toast } from '../lib/api.js'
import AgentLive from '../ui/AgentLive.jsx'
import Skeleton from '../ui/Skeleton.jsx'
import { useFreshest, useVisiblePoll } from '../lib/hooks.js'
import { useWorkScope } from '../ui/WorkScopeBar.jsx'

const MONO = "var(--mono)"
const HEAD = "var(--head)"
const PANEL = { background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 12, padding: '16px 18px' }
const MODELS = ['haiku', 'sonnet', 'opus']
const age = t => { const d = Math.floor((Date.now() - t) / 86400_000); return d === 0 ? 'today' : d + 'd' }
const lbl = s => s.replace(/-/g, ' ')

/**
 * The board pane carries its own palette and type scale.
 *
 * Everything else in the dashboard is system-font and CSS-var themed; the board was designed
 * against a fixed dark spec, so its colours are literal rather than themed. Confined to this pane
 * on purpose — nothing here leaks into the sidebar or the other sections.
 */
const PM = "'IBM Plex Mono', ui-monospace, monospace"
const PS = "'IBM Plex Sans', system-ui, sans-serif"
const C = {
  panel: '#0c0d10', card: '#101216', line: '#1b1e23', line2: '#23262b', inset: '#15181c',
  text: '#e6e8ea', sec: '#b8bdc4', muted: '#8b9199', meta: '#6b727c', faint: '#565c65', dim: '#4a5058',
  blue: '#7aa2f7', blueLt: '#a9c4ff', purple: '#b39ce8', amber: '#d9a13b', green: '#7fcf9a', red: '#e07a7a',
}
const STAGE_C = {
  backlog: '#565c65', 'in-progress': '#7aa2f7', 'code-review': '#a78bde', fixing: '#d9a13b',
  'ready-for-qa': '#5ec2b3', 'qa-running': '#5ec2b3', 'bug-reported': '#e07a7a',
  'ready-for-release': '#7fcf9a', released: '#4ea86f',
}
const STAGE_N = {
  backlog: 'Backlog', 'in-progress': 'In progress', 'code-review': 'Code review', fixing: 'Fixing',
  'ready-for-qa': 'Ready for QA', 'qa-running': 'QA running', 'bug-reported': 'Bug reported',
  'ready-for-release': 'Ready for release', released: 'Released',
}
const stageC = s => STAGE_C[s] || C.purple
// Sentence case, so a custom pipeline stage reads like the built-in ones rather than like an id.
const stageN = s => STAGE_N[s] || String(s).replace(/-/g, ' ').replace(/^./, c => c.toUpperCase())

const BTN = { font: `500 12.5px ${PS}`, border: `1px solid ${C.line2}`, background: 'transparent', color: C.sec, borderRadius: 7, padding: '6px 12px', cursor: 'pointer', margin: 0 }
const BTN_P = { ...BTN, border: '1px solid #2b3a5c', background: '#16203a', color: C.blueLt }
const BTN_S = { ...BTN, font: `500 12px ${PS}`, borderRadius: 6, padding: '5px 11px' }
const FIELD = { font: `400 12.5px ${PM}`, background: '#0c0d10', border: `1px solid ${C.line2}`, borderRadius: 7, padding: '9px 12px', color: C.text }

const TONE = {
  dim: { background: C.inset, border: `1px solid ${C.line2}`, color: C.muted },
  blue: { background: '#141c2e', border: '1px solid #26334d', color: '#9db4e8' },
  amber: { background: '#1e1710', border: '1px solid #3b2d18', color: C.amber },
  green: { background: '#101a13', border: '1px solid #1f3527', color: C.green },
  purple: { background: '#191428', border: '1px solid #2e2547', color: C.purple },
  red: { background: '#1e1213', border: '1px solid #45292b', color: C.red },
}
const chipStyle = tone => ({ font: `400 10.5px ${PM}`, borderRadius: 4, padding: '2px 6px', whiteSpace: 'nowrap', ...(TONE[tone] || TONE.dim) })
const BADGE = { font: `500 9.5px ${PM}`, letterSpacing: '0.1em', textTransform: 'uppercase', borderRadius: 4, padding: '2px 6px' }
const typeBadge = ty => ({ ...BADGE, ...(ty === 'sub' ? TONE.purple : ty === 'bug' ? TONE.red : TONE.blue) })
const typeName = ty => (ty === 'sub' ? 'Sub' : ty === 'bug' ? 'Bug' : 'Feature')
// A left stripe next to a `border` shorthand makes React warn and repaint inconsistently on
// re-render, so every striped box states its four sides.
const edges = (all, left) => ({ borderTop: all, borderRight: all, borderBottom: all, borderLeft: left })
const keyOf = t => t.jiraKey || t.branchKey || String(t.id).slice(0, 8)

const HUMAN_STAGES = ['code-review', 'ready-for-qa', 'ready-for-release']
/**
 * Why this card wants you, in three words or fewer — or null, which is most cards.
 *
 * Blocked and unread are failures of input: the agent stopped, or the ticket points at something
 * nobody could read. "Your call" is the third and much commoner case — nothing is wrong, the
 * pipeline has simply run out of things it is allowed to do without a human.
 */
const attentionOf = t => t.blocked ? 'Blocked'
  : t.sources?.unresolved?.length ? `${t.sources.unresolved.length} unread`
    : (!t.running && HUMAN_STAGES.includes(t.stage)) ? 'Your call' : null

const agentOf = (t, board) => {
  const started = t.branch || t.worktree || t.runs?.length || t.running
  if (!started) return 'unassigned'
  const who = board.teams?.find(x => x.id === t.team)?.name || 'general'
  return `${who} · ${t.model || board.config?.defaultModel || 'default'}`
}
const shortPath = p => (p ? String(p).replace(/^\/(?:Users|home)\/[^/]+/, '~') : '—')

/**
 * What the ticket carries with it, as chips — rendered only where there is something to render.
 *
 * The point of several of these is the NEGATIVE case: "Sheet not shared" means the copy deck was
 * linked and could not be read, which is exactly what silently produces an implementation with
 * invented strings.
 */
function chipsFor(t) {
  const s = t.sources || {}, d = t.designRefs || {}, out = []
  const n = a => (Array.isArray(a) ? a.length : 0)
  if (n(d.figma)) out.push([`Figma${d.figma.length > 1 ? ` ×${d.figma.length}` : ''}`, 'blue', d.figma.join('\n')])
  if (n(d.captures)) out.push([`Captures ×${d.captures.length}`, 'blue', d.captures.join('\n')])
  if (d.contentCsv) out.push(['Content sheet', 'purple', d.contentCsv])
  else if (s.sheet === 'link-only') out.push(['Sheet not shared', 'amber', 'linked but not shared — export it by hand'])
  if (n(s.confluence)) out.push([`Confluence ×${s.confluence.length}`, 'blue', s.confluence.join('\n')])
  if (n(s.jira)) out.push([`${s.jira.length} linked`, 'blue', s.jira.join('\n')])
  if (n(s.unresolved)) out.push([`${s.unresolved.length} unread`, 'amber', s.unresolved.join('\n')])
  if (n(t.depBlocked)) out.push([`After ${t.depBlocked.length} dep${t.depBlocked.length === 1 ? '' : 's'}`, 'amber', 'waiting on unfinished dependencies'])
  if (n(t.conflictRisk)) out.push(['File overlap', 'amber', t.conflictRisk.map(c => `${c.title}: ${c.files.join(', ')}`).join('\n')])
  const live = (t.findings || []).filter(f => f.status !== 'resolved').length
  if (live) out.push([`${live} finding${live === 1 ? '' : 's'}`, 'green'])
  if (t.running) out.push([`${t.running.kind} running`, 'blue'])
  else {
    const r = t.runs?.length ? t.runs[t.runs.length - 1] : null
    if (r && r.status !== 'ok') out.push([`${r.kind} ${r.status}`, r.status === 'error' ? 'red' : 'amber', r.unfinished || r.blocked || r.summary || ''])
  }
  return out
}
const Chips = ({ items }) => items.length > 0 && (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
    {items.map(([label, tone, title], i) => <span key={i} title={title || undefined} style={chipStyle(tone)}>{label}</span>)}
  </div>
)

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

const SEV_TONE = { critical: 'red', high: 'red', medium: 'amber', low: 'dim' }
const SEV_STRIPE = { critical: C.red, high: C.red, medium: C.amber, low: C.dim }
const CLASS_LABEL = { code: 'code', 'needs-human': 'needs-human', 'pre-existing': 'pre-existing' }
const STATUS_LABEL = { 'fix-attempted': 'fix attempted', acked: 'accepted', resolved: 'resolved' }

/**
 * One card per finding, severity on the left edge.
 *
 * The three actions are the only three things that can happen to a finding: another fix round, a
 * person, or a recorded decision to live with it. Resolved and accepted findings stay on the list
 * dimmed — a finding that vanishes when it is dealt with makes "9 seen, 0 open" unexplainable.
 */
function FindingCards({ t, onAct, onFix }) {
  const [busy, setBusy] = useState(null)
  const all = t.findings || []
  const decide = (f, body) => {
    setBusy(f.id)
    onAct('post', `/api/board/tickets/${t.id}/findings/${encodeURIComponent(f.id)}`, body).finally(() => setBusy(null))
  }
  return all.map(f => {
    const done = f.status === 'resolved' || f.status === 'acked'
    return (
      <div key={f.id} style={{
        borderRadius: 9, padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: 9,
        background: C.card, ...edges(`1px solid ${C.line}`, `2px solid ${SEV_STRIPE[f.severity] || C.dim}`), opacity: done ? 0.6 : 1,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ ...chipStyle(SEV_TONE[f.severity] || 'dim'), fontSize: 10, letterSpacing: '0.09em', textTransform: 'uppercase' }}>{f.severity}</span>
          <span style={{ font: `400 11.5px ${PM}`, color: '#ccd1d7', overflowWrap: 'anywhere' }}>{(f.file || '').split('/').pop() || 'no file'}</span>
          {/* Seen three times means the loop is not converging on it — the number is the signal
              that a human, not another fix round, is what this needs. */}
          {f.seenCount > 1 && <span title={`raised in ${f.seenCount} reviews`} style={{ font: `400 10.5px ${PM}`, color: f.seenCount > 2 ? C.amber : C.meta }}>×{f.seenCount}</span>}
          <span style={{ marginLeft: 'auto', font: `400 10.5px ${PM}`, color: C.meta }}>
            {CLASS_LABEL[f.class] || 'code'}{STATUS_LABEL[f.status] ? ` · ${STATUS_LABEL[f.status]}` : ''}
          </span>
        </div>
        <p style={{ margin: 0, font: `400 13px/1.6 ${PS}`, color: '#aeb4bb', textWrap: 'pretty', maxWidth: '72ch' }}>{f.summary}</p>
        {f.ackNote && <div style={{ font: `400 11.5px ${PM}`, color: C.purple }}>“{f.ackNote}”</div>}
        {f.status !== 'resolved' && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {/* The fix agent takes a severity band, not a single finding — there is no per-finding
                fix endpoint, and inventing one here would lie about what the button does. */}
            <button style={{ ...BTN_S, ...(f.class === 'code' && f.status === 'open' ? { border: '1px solid #2b3a5c', background: '#16203a', color: C.blueLt } : { opacity: 0.4, cursor: 'not-allowed' }) }}
              disabled={f.class !== 'code' || f.status !== 'open' || !!t.running}
              title="runs a fix agent over the highest open severity band on this ticket — accepted and needs-human findings are not sent"
              onClick={onFix}>Send to fix agent</button>
            <button style={BTN_S} disabled={busy === f.id || f.class === 'needs-human'}
              title="no agent can fix this from inside the repo — park it for a person"
              onClick={() => decide(f, { class: 'needs-human' })}>Needs a human</button>
            <button style={{ ...BTN_S, color: C.meta }} disabled={busy === f.id}
              title={f.status === 'acked' ? 'put it back on the open pile' : 'accept as known — it stops blocking and stops being re-raised, and the decision is recorded'}
              onClick={() => decide(f, f.status === 'acked' ? { status: 'open' } : { status: 'acked', note: window.prompt('Why is this dismissed? (recorded on the ticket)') || null })}>
              {f.status === 'acked' ? 'Reopen' : 'Dismiss'}
            </button>
          </div>
        )}
      </div>
    )
  })
}
const Meta = ({ children, color = 'var(--text-tertiary)' }) => <span style={{ font: `400 11px ${MONO}`, color }}>{children}</span>
const ModelInput = props => (<><input list="board-models" placeholder="model (blank = default)" {...props} /><datalist id="board-models">{MODELS.map(m => <option key={m} value={m} />)}</datalist></>)

const MetaM = ({ children, color = C.meta }) => <span style={{ font: `400 11.5px ${PM}`, color }}>{children}</span>

/**
 * New ticket, as a strip rather than a form that lives on the board forever.
 *
 * The old always-open panel cost the board four lanes' worth of vertical space to serve the one
 * action you take a handful of times a day. Paste-a-link is the path that is actually used, so it
 * is the only thing open by default; the hand-written form is one click behind it.
 */
function Compose({ project, teams, onDone, onClose }) {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [manual, setManual] = useState(false)
  const [f, setF] = useState({ title: '', desc: '', team: '', model: '' })
  const go = () => {
    setBusy(true); setResult(null)
    api.post('/api/ticket/intake', { project, input: input.trim(), team: f.team || null, model: f.model || null })
      .then(r => { setResult(r); setInput(''); onDone() })
      .catch(e => setResult({ error: e.message })).finally(() => setBusy(false))
  }
  const submit = () => api.post('/api/board/tickets', { project, title: f.title, desc: f.desc, team: f.team || null, model: f.model || null })
    .then(() => { setF({ ...f, title: '', desc: '' }); setManual(false); onDone() }).catch(e => toast(e.message, 'error'))
  const s = result?.sources
  return (
    <div style={{ border: `1px solid ${C.line2}`, borderRadius: 10, background: C.card, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ font: `600 13.5px ${PS}`, color: C.text }}>New ticket</div>
        <MetaM>Paste a JIRA link or key — it follows linked tickets, Confluence, the content sheet, and Figma frames.</MetaM>
        <button onClick={onClose} style={{ ...BTN, marginLeft: 'auto', border: 'none', color: C.meta, font: `400 13px ${PM}`, padding: '0 4px' }}>✕</button>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && input.trim() && !busy) go() }}
          placeholder="https://…/browse/AIR-10817" style={{ ...FIELD, flex: 1, minWidth: 240 }} />
        <button style={BTN_P} onClick={go} disabled={busy || !input.trim()}>{busy ? 'Fetching…' : 'Fetch & file'}</button>
        <button style={BTN} onClick={() => setManual(m => !m)}>Write by hand</button>
      </div>
      {result?.error && <MetaM color={C.red}>{result.error}</MetaM>}
      {s && <MetaM color={C.green}>
        filed {result.key} · {result.designRefs?.figma?.length || 0} figma · sheet {s.sheet} · {s.confluence.length} confluence · {s.jira.length} linked
        {s.unresolved?.length ? ` · ${s.unresolved.length} not readable: ${s.unresolved.join('; ')}` : ''}
      </MetaM>}
      {manual && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: `1px solid ${C.line}`, paddingTop: 10 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="title" style={{ ...FIELD, flex: 1, minWidth: 200, fontFamily: PS }} />
            <select value={f.team} onChange={e => setF({ ...f, team: e.target.value })} style={{ ...FIELD, fontFamily: PS }}>
              <option value="">no team (general agent)</option>{teams.map(t => <option key={t.id} value={t.id}>{t.name} v{t.version}</option>)}
            </select>
            <ModelInput value={f.model} onChange={e => setF({ ...f, model: e.target.value })} style={{ ...FIELD, width: 150 }} />
          </div>
          <textarea rows={4} value={f.desc} onChange={e => setF({ ...f, desc: e.target.value })} style={{ ...FIELD, fontFamily: PS, resize: 'vertical' }}
            placeholder="paste JIRA content — description, acceptance criteria, links. The analyze step proposes a sub-ticket breakdown from this." />
          <button style={{ ...BTN_P, alignSelf: 'flex-start' }} onClick={submit} disabled={!f.title.trim()}>Create ticket</button>
        </div>
      )}
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

/**
 * Four fixed parts in a fixed order: who/what, the title, where it hangs, what it carries, and a
 * footer. The order never changes between cards, so a lane of eight is scannable by position
 * rather than by reading each one.
 */
function Card({ t, board, onOpen, selected }) {
  const kids = board.tickets.filter(x => x.parent === t.id)
  const doneKids = kids.filter(x => x.stage === 'released').length
  const parent = t.parent ? board.tickets.find(x => x.id === t.parent) : null
  const att = attentionOf(t)
  return (
    <div draggable onDragStart={e => e.dataTransfer.setData('text/plain', t.id)} onClick={() => onOpen(t.id)}
      style={{
        borderRadius: 9, padding: '11px 12px 10px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8,
        // Dashed means "this one is not moving on its own" — an agent that stopped to ask, or
        // dependencies that have not landed. Both need you; neither is an error. Written per-side
        // rather than as a shorthand plus borderLeft, which React re-renders inconsistently.
        background: C.card, ...edges((t.blocked || t.depBlocked?.length) ? '1px dashed #3b2d18' : `1px solid ${C.line2}`, `2px solid ${selected ? C.blue : stageC(t.stage) + '55'}`),
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
        <span style={typeBadge(t.type)}>{typeName(t.type)}</span>
        <span style={{ font: `400 11.5px ${PM}`, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{keyOf(t)}</span>
        {att && (
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, font: `400 10.5px ${PM}`, color: C.amber, whiteSpace: 'nowrap' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.amber }} />{att}
          </span>
        )}
      </div>
      {/* A pasted JIRA URL used to be the whole title, wrapping to three lines of hostname —
          cardTitle keeps the key and says plainly that nothing was fetched. */}
      <div title={t.title} style={{
        font: `500 13.5px/1.4 ${PS}`, letterSpacing: '-0.008em', textWrap: 'pretty', color: C.text, overflowWrap: 'anywhere',
        display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>{cardTitle(t)}</div>
      {parent && (
        <div onClick={e => { e.stopPropagation(); onOpen(parent.id) }} title="open the parent ticket"
          style={{ font: `400 11px ${PM}`, color: C.meta, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', alignSelf: 'flex-start' }}>
          <span style={{ color: C.dim }}>↳</span>{keyOf(parent)}
        </div>
      )}
      <Chips items={chipsFor(t)} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderTop: `1px solid ${C.line}`, paddingTop: 8, font: `400 10.5px ${PM}`, color: C.meta, minWidth: 0 }}>
        <span style={{ color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agentOf(t, board)}</span>
        <span style={{ color: '#383d45' }}>·</span>
        <span style={{ whiteSpace: 'nowrap' }}>{age(t.createdAt)}</span>
        {kids.length > 0 && <span style={{ marginLeft: 'auto', color: '#9db4e8', whiteSpace: 'nowrap' }}>{doneKids}/{kids.length} subs</span>}
      </div>
    </div>
  )
}

function QaForm({ t, onRun }) {
  const [q, setQ] = useState({ baseUrl: t.qa?.baseUrl || t.preview?.url || '', env: t.qa?.env || 'staging', scope: t.qa?.scope || '', notes: t.qa?.notes || '' })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <input value={q.baseUrl} onChange={e => setQ({ ...q, baseUrl: e.target.value })} placeholder="base URL (auto-filled from preview env)" style={{ ...FIELD, flex: 2, minWidth: 200 }} />
        <select value={q.env} onChange={e => setQ({ ...q, env: e.target.value })} style={{ ...FIELD, fontFamily: PS }}><option>staging</option><option>preview</option><option>prod</option></select>
        <input value={q.scope} onChange={e => setQ({ ...q, scope: e.target.value })} placeholder="pages / flows in scope" style={{ ...FIELD, flex: 1.5, minWidth: 140 }} />
      </div>
      <input value={q.notes} onChange={e => setQ({ ...q, notes: e.target.value })} placeholder="login / test-account notes, anything else" style={FIELD} />
      <button style={{ ...BTN_P, alignSelf: 'flex-start' }} onClick={() => onRun(q)}>Run QA with these inputs</button>
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
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 780, maxWidth: '62vw', zIndex: 61,
        background: '#0d0f12', borderLeft: `1px solid ${C.line2}`, boxShadow: '-32px 0 80px rgba(0,0,0,0.55)',
        display: 'flex', flexDirection: 'column', color: C.text, fontFamily: PS,
      }}>{children}</aside>
    </>
  )
}

/**
 * Branch, base and worktree — the three answers the fact grid shows, edited where they are shown.
 *
 * All three are only editable before the worktree is cut, which is also the only window in which
 * changing them does anything: afterwards the label would move and the checkout would not. So
 * after the cut the grid drops the Change buttons rather than offering inputs the server refuses.
 *
 * Blank means "the project default", and the defaults are shown as placeholders, so the common
 * case is to read this and close it.
 */
function FactsEditor({ t, cfg, parent, onSave, onClose, focus }) {
  const [f, setF] = useState({ branch: t.branch || '', base: t.base || '', worktree: t.worktree || '' })
  const defaultBranch = `${cfg?.branchPrefix ?? 'ticket/'}${t.branchKey || t.jiraKey || t.id}`
  // A sub-ticket's default base is its parent's branch, created when the first child starts.
  const parentBranch = parent ? parent.branch || `${cfg?.branchPrefix ?? 'ticket/'}${parent.branchKey || parent.jiraKey || parent.id}` : null
  const defaultBase = parentBranch || cfg?.base || 'main'
  const fields = [
    ['branch', 'Branch', defaultBranch, 'the branch this ticket commits to', 260],
    ['base', 'Base', defaultBase, 'branches from it, merges back into it', 200],
    ['worktree', 'Worktree', '~/.claude/board-worktrees/' + t.id, 'absolute path — where the checkout is created', 300],
  ]
  return (
    <div style={{ marginTop: 10, border: `1px solid ${C.line2}`, borderRadius: 9, background: C.card, padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {fields.map(([k, label, ph, hint, w]) => (
          <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: `1 1 ${w}px` }}>
            <span style={{ font: `400 9.5px ${PM}`, letterSpacing: '0.11em', textTransform: 'uppercase', color: C.faint }}>{label}</span>
            <input autoFocus={focus === k} value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} placeholder={ph} style={{ ...FIELD, padding: '7px 10px' }} />
            <MetaM color={C.dim}>{hint}</MetaM>
          </label>
        ))}
      </div>
      {parentBranch && !f.base.trim() && <MetaM color={C.blueLt}>stacked on its parent · only the parent branch merges to {cfg?.base || 'main'}</MetaM>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button style={BTN_P} onClick={() => { onSave({ branch: f.branch.trim() || null, base: f.base.trim() || null, worktree: f.worktree.trim() || null }); onClose() }}>Save</button>
        <button style={BTN} onClick={onClose}>Cancel</button>
        <MetaM>blank = the project default · all three freeze once the worktree is cut</MetaM>
      </div>
    </div>
  )
}

/**
 * The ticket description, as prose.
 *
 * JIRA text arrives as one blob with "Context:" and "## In scope" headings buried in it. In a
 * monospace <pre> a 3k-character description is a wall nobody reads, so headings become sections
 * and dash-prefixed lines become bullets. Anything unrecognised stays a paragraph — this can only
 * improve the text's shape, never drop a line of it.
 */
function parseDesc(desc) {
  const out = []
  let cur = { title: null, blocks: [] }
  for (const raw of String(desc || '').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const h = /^#{1,4}\s+(.+?):?$/.exec(line) || /^\*{0,2}([A-Za-z][\w &/'-]{0,38}):\*{0,2}$/.exec(line)
    if (h) { if (cur.title || cur.blocks.length) out.push(cur); cur = { title: h[1].trim(), blocks: [] }; continue }
    const b = /^(?:[-*•–—]|\d+[.)])\s+(.+)$/.exec(line)
    cur.blocks.push({ bullet: !!b, text: b ? b[1] : line })
  }
  if (cur.title || cur.blocks.length) out.push(cur)
  return out
}

const LINK_CHIP = { display: 'flex', alignItems: 'center', gap: 7, border: `1px solid ${C.line2}`, background: C.card, borderRadius: 7, padding: '7px 11px', font: `400 12.5px ${PS}`, color: '#ccd1d7', textDecoration: 'none' }

/**
 * Where the ticket's inputs live. A chip with no URL is still rendered — "the copy deck is a local
 * export, not a link" is a fact worth showing, and a missing chip would read as "there is no sheet".
 */
function LinkChips({ t }) {
  const d = t.designRefs || {}, s = t.sources || {}
  const links = []
  // Nothing stores the JIRA base URL on a ticket, so the link only exists when intake happened to
  // record the issue's own URL among its sources.
  if (t.jiraKey) links.push(['JIRA', t.jiraKey, (s.jira || []).find(u => u.includes(t.jiraKey)) || (/^https?:\/\//.test(t.title || '') ? t.title : null)])
  ;(d.figma || []).forEach((u, i) => links.push(['Figma', d.figma.length > 1 ? `Frame ${i + 1}` : 'Frames', u]))
  if (d.contentCsv) links.push(['Sheet', 'Agreed copy', /^https?:\/\//.test(d.contentCsv) ? d.contentCsv : null])
  else if (s.sheet === 'link-only') links.push(['Sheet', 'linked, not readable', null])
  ;(s.confluence || []).forEach((u, i) => links.push(['Confluence', `Page ${i + 1}`, u]))
  if (!links.length) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {links.map(([kind, label, href], i) => {
        const inner = (<>
          <span style={{ font: `400 10px ${PM}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.blue }}>{kind}</span>
          {label}<span style={{ color: C.dim }}>{href ? '↗' : ''}</span>
        </>)
        return href
          ? <a key={i} href={href} target="_blank" rel="noreferrer" title={href} style={LINK_CHIP}>{inner}</a>
          : <span key={i} title="no URL recorded for this — it came in as a local file or was never fetched" style={{ ...LINK_CHIP, opacity: 0.55 }}>{inner}</span>
      })}
    </div>
  )
}

const EMPTY = { border: `1px dashed ${C.line2}`, borderRadius: 9, padding: 22, textAlign: 'center', color: C.meta, font: `400 12px/1.6 ${PM}` }
const CARD_BOX = { border: `1px solid ${C.line}`, background: C.card, borderRadius: 9, padding: '12px 14px' }
const SECTION_H = { font: `400 10.5px ${PM}`, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.faint }

function Detail({ t, board, onRefresh, onClose, onOpen }) {
  const all = board.tickets, teams = board.teams, cfg = board.config
  const [tab, setTab] = useState('desc')
  const [reply, setReply] = useState('')
  const [escModel, setEscModel] = useState('')
  const [subs, setSubs] = useState(null)
  // Opening a different card must not land you on the previous ticket's Agent-session tab, staring
  // at an empty panel and reading it as "this ticket has no agent".
  const [editing, setEditing] = useState(null)
  useEffect(() => { setTab('desc'); setSubs(null); setReply(''); setEditing(null) }, [t.id])
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
  const parent = t.parent ? all.find(x => x.id === t.parent) : null
  const live = (t.findings || []).filter(f => f.status !== 'resolved')
  const spend = (t.runs || []).reduce((s, r) => s + (r.cost || 0), 0)
  const rounds = (t.reviewRounds || []).length
  const sessionId = t.resumeSessionId || (t.runs || []).slice().reverse().find(r => r.sessionId)?.sessionId || null
  const hasDesign = !!(t.designRefs?.figma?.length || t.designRefs?.captures?.length || t.designRefs?.contentCsv)
  const sections = parseDesc(t.desc)
  // Before the cut these are intentions, not facts, and they are shown as such: the default the
  // board would use, in the cell, editable in place. After it they are where the agent actually
  // is, and the Change buttons go away with the ability to change anything.
  const defaultBranch = `${cfg?.branchPrefix ?? 'ticket/'}${t.branchKey || t.jiraKey || t.id}`
  const facts = [
    ['Agent', agentOf(t, board), null],
    ['Branch', t.branch || defaultBranch, 'branch'],
    ['Worktree', t.worktree ? shortPath(t.worktree) : '—', 'worktree'],
    ['Base', t.basedOn || t.base || parent?.branch || cfg?.base || 'main', 'base'],
  ]
  const tabs = [
    { id: 'desc', label: 'Description' },
    ...(kids.length ? [{ id: 'subs', label: 'Sub-tickets', count: kids.length }] : []),
    { id: 'findings', label: 'Review findings', count: live.length || null },
    { id: 'agent', label: 'Agent session' },
  ]

  // Stage-driven actions sit with the fact grid, above the tabs: what is running where and what you
  // can do about it are the same question, and neither should scroll away behind a description.
  const actions = []
  if (!t.running && !t.blocked) {
    if (t.resumeSessionId) actions.push(
      <button key="resume" style={BTN_P} title={`picks stopped session ${t.resumeSessionId.slice(0, 8)} back up with its context intact`}
        onClick={() => act('start', { resume: t.resumeSessionId, ...(escModel ? { model: escModel } : {}) })}>Resume stopped agent</button>)
    if (t.stage === 'backlog') actions.push(
      <button key="start" style={{ ...BTN_P, ...(t.depBlocked?.length ? { opacity: 0.4, cursor: 'not-allowed' } : {}) }} disabled={t.depBlocked?.length > 0}
        title={t.depBlocked?.length ? 'blocked by unfinished dependencies' : kids.length ? 'starts each sub-ticket in its own worktree — the parent itself runs no agent' : 'creates an isolated worktree branch and starts the dev agent'}
        onClick={() => act('start', escModel ? { model: escModel } : {})}>{kids.length ? `Start ${kids.length} sub-ticket${kids.length === 1 ? '' : 's'}` : 'Start dev agent'}</button>,
      <button key="analyze" style={BTN} title="agent proposes an independently-workable sub-ticket breakdown" onClick={() => act('analyze')}>Analyze into sub-tickets</button>,
      <ModelInput key="model" value={escModel} onChange={e => setEscModel(e.target.value)} style={{ ...FIELD, width: 150, padding: '6px 10px' }} />)
    if (t.stage === 'code-review') actions.push(<button key="review" style={BTN_P} onClick={() => act('review')}>Run code review</button>)
    if (t.stage === 'ready-for-release') actions.push(
      <button key="release" style={BTN_P} title={`human gate — merges ${t.branch} via the project's merge queue, or copies a PR command if require-PR is on`}
        onClick={() => api.post(`/api/board/tickets/${t.id}/release`).then(r => { if (r.prCmd) { navigator.clipboard.writeText(r.prCmd); toast('PR flow — gh pr create command copied', 'success') } onRefresh() }).catch(e => toast(e.message, 'error'))}>Release</button>)
  }

  const banner = (tone, children) => (
    <div style={{ border: `1px solid ${TONE[tone].border.split(' ').pop()}`, background: TONE[tone].background, borderRadius: 9, padding: '11px 13px', display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
  )
  return (
    <>
      <div style={{ padding: '18px 22px 0', borderBottom: `1px solid ${C.line}` }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={typeBadge(t.type)}>{typeName(t.type)}</span>
              <span style={{ font: `400 12px ${PM}`, color: C.muted }}>{keyOf(t)}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, font: `400 11px ${PM}`, borderRadius: 5, padding: '3px 8px', color: stageC(t.stage), background: C.card, border: `1px solid ${C.line2}` }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />{stageN(t.stage)}
              </span>
              {parent && <span onClick={() => onOpen(parent.id)} title="open the parent ticket" style={{ font: `400 11px ${PM}`, color: C.meta, cursor: 'pointer' }}>↳ {keyOf(parent)}</span>}
            </div>
            <h2 style={{ margin: 0, font: `600 20px/1.25 ${PS}`, letterSpacing: '-0.02em', textWrap: 'pretty', overflowWrap: 'anywhere', color: C.text }}>{cardTitle(t)}</h2>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={{ ...BTN, color: C.muted }} onClick={del} title="removes the ticket and its worktree — the branch and its commits are kept">Delete</button>
            <button style={{ ...BTN, color: C.muted }} onClick={onClose}>Close</button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 1, background: C.line, border: `1px solid ${C.line}`, borderRadius: 9, overflow: 'hidden', marginTop: 16 }}>
          {facts.map(([k, v, field]) => (
            <div key={k} style={{ background: C.card, padding: '9px 11px', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, font: `400 9.5px ${PM}`, letterSpacing: '0.11em', textTransform: 'uppercase', color: C.faint }}>
                {k}
                {field && !t.worktreeCut && (
                  <button onClick={() => setEditing(editing === field ? null : field)} title={`change the ${field} before the worktree is cut`}
                    style={{ ...BTN, marginLeft: 'auto', border: 'none', padding: 0, background: 'none', font: `400 9.5px ${PM}`, letterSpacing: '0.11em', textTransform: 'uppercase', color: editing === field ? C.blueLt : C.dim }}>Change</button>
                )}
              </span>
              <span title={typeof v === 'string' ? v : undefined} style={{ font: `400 11.5px ${PM}`, color: t.branch || !field ? '#ccd1d7' : C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span>
            </div>
          ))}
        </div>
        {editing && !t.worktreeCut && (
          <FactsEditor t={t} cfg={cfg} parent={parent} focus={editing} onSave={patch} onClose={() => setEditing(null)} />
        )}
        {!t.branch && !t.worktreeCut && !editing && (
          <div style={{ marginTop: 8 }}><MetaM>nothing is cut yet — the ticket will branch <span style={{ color: '#ccd1d7' }}>{t.branch || defaultBranch}</span> off <span style={{ color: '#ccd1d7' }}>{t.basedOn || t.base || parent?.branch || cfg?.base || 'main'}</span> when an agent starts</MetaM></div>
        )}

        {actions.length > 0 && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>{actions}</div>}

        <div style={{ display: 'flex', gap: 20, marginTop: 16, flexWrap: 'wrap' }}>
          {tabs.map(tb => (
            <div key={tb.id} onClick={() => setTab(tb.id)} style={{
              display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 10, cursor: 'pointer',
              font: `${tab === tb.id ? 500 : 400} 13px ${PS}`, color: tab === tb.id ? '#ffffff' : C.muted,
              borderBottom: `2px solid ${tab === tb.id ? C.blue : 'transparent'}`,
            }}>
              {tb.label}
              {tb.count ? <span style={{ font: `400 10.5px ${PM}`, background: '#191c21', borderRadius: 4, padding: '1px 5px', color: '#a5abb4' }}>{tb.count}</span> : null}
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px 22px 40px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {failure && banner('red', <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ font: `500 12.5px ${PS}`, color: C.red, flex: 1 }}>{failure.message}</span>
            <button style={{ ...BTN_S, color: C.muted }} onClick={() => setFailure(null)}>Dismiss</button>
          </div>
          {failure.detail && <MetaM color={C.sec}>{failure.detail}</MetaM>}
          {failure.skipped?.map(s => <div key={s.id} style={{ font: `400 11.5px ${PM}`, color: C.sec }}>· <b>{s.title}</b> — {s.why}</div>)}
        </>)}

        {t.blocked && banner('red', <>
          <div style={{ font: `500 12.5px ${PS}`, color: C.red }}>Blocked by {t.blocked.by} ({t.blocked.category}) · {fmtDate(t.blocked.at)}</div>
          <pre style={{ margin: 0, font: `400 11.5px/1.55 ${PM}`, color: C.sec, whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{t.blocked.needed || t.blocked.reason}</pre>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input value={reply} onChange={e => setReply(e.target.value)} style={{ ...FIELD, flex: 1, minWidth: 220, fontFamily: PS }}
              placeholder="answer the question / provide the missing decision — resumes the agent with this injected" />
            <button style={BTN_P} onClick={() => act('unblock', { reply })} disabled={!reply.trim()}>Reply &amp; resume</button>
            <button style={BTN} onClick={() => patch({ blocked: null })} title="take over manually — restores the stage so you can re-run triggers yourself">Clear block</button>
          </div>
        </>)}

        {proposal?.length > 0 && banner('blue', <>
          <div style={{ font: `500 12.5px ${PS}`, color: C.blueLt }}>Proposed sub-ticket breakdown — edit, then accept</div>
          {proposal.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <input value={s.title} onChange={e => setSubs(proposal.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} style={{ ...FIELD, flex: 1, minWidth: 160, fontFamily: PS }} />
              <input value={s.desc || ''} onChange={e => setSubs(proposal.map((x, j) => j === i ? { ...x, desc: e.target.value } : x))} style={{ ...FIELD, flex: 2, minWidth: 200, fontFamily: PS }} />
              <MetaM>{s.deps?.length ? 'after #' + s.deps.map(d => d + 1).join(',#') : ''}</MetaM>
              <button style={{ ...BTN_S, color: C.meta }} onClick={() => setSubs(proposal.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button style={BTN_P} onClick={() => act('breakdown', { subs: proposal })}>Accept — create {proposal.length} sub-tickets</button>
            <button style={BTN_S} onClick={() => setSubs(proposal.concat({ title: '', desc: '', deps: [] }))}>+ Add</button>
            <button style={{ ...BTN_S, color: C.meta }} onClick={() => { setSubs(null); patch({}) }}>Dismiss</button>
          </div>
        </>)}

        {tab === 'desc' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <LinkChips t={t} />
            {t.preview?.url && (
              <div style={{ font: `400 11.5px ${PM}`, color: C.green }}>
                preview <a href={t.preview.url} target="_blank" rel="noreferrer" style={{ color: C.green }}>{t.preview.url}</a>
                <button style={{ ...BTN_S, marginLeft: 8, color: C.meta }} onClick={() => call('del', `/api/board/tickets/${t.id}/preview`)}>Stop</button>
              </div>
            )}
            {sections.length ? sections.map((s, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {s.title && <div style={SECTION_H}>{s.title}</div>}
                {s.blocks.map((b, j) => b.bullet
                  ? <div key={j} style={{ display: 'flex', gap: 9, font: `400 13.5px/1.55 ${PS}`, color: C.sec }}><span style={{ color: C.dim }}>—</span><span style={{ textWrap: 'pretty' }}>{b.text}</span></div>
                  : <p key={j} style={{ margin: 0, font: `400 13.5px/1.65 ${PS}`, color: C.sec, textWrap: 'pretty', maxWidth: '68ch', overflowWrap: 'anywhere' }}>{b.text}</p>)}
              </div>
            )) : <div style={EMPTY}>This ticket has no description.<br />Nothing was pasted, and nothing was fetched from JIRA.</div>}

            <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <details>
                <summary style={{ font: `400 11.5px ${PM}`, color: C.meta, cursor: 'pointer' }}>Timeline · admin</summary>
                {(t.history || []).map((h, i) => <div key={i} style={{ font: `400 11.5px ${PM}`, color: h.to.startsWith('blocked') ? C.red : C.sec, padding: '1px 0' }}>{fmtDate(h.at)} — {h.from || '·'} → {h.to}{h.note ? ' · ' + h.note : ''}</div>)}
                <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select value={t.stage} onChange={e => patch({ stage: e.target.value })} title="manual move" style={{ ...FIELD, fontFamily: PS, padding: '6px 10px' }}>{(t.stages || []).map(s => <option key={s} value={s}>{stageN(s)}</option>)}</select>
                  <select value={t.team || ''} onChange={e => patch({ team: e.target.value || null })} style={{ ...FIELD, fontFamily: PS, padding: '6px 10px' }}><option value="">no team</option>{teams.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                  <ModelInput value={t.model || ''} onChange={e => patch({ model: e.target.value || null })} style={{ ...FIELD, width: 140, padding: '6px 10px' }} title="escalate mid-flight — next run uses this model, state kept" />
                  <MetaM>{t.pipelineVersion}</MetaM>
                </div>
              </details>
            </div>
          </div>
        )}

        {tab === 'subs' && kids.map(k => {
          const meta = k.blocked ? `Blocked · ${k.blocked.by} · ${k.blocked.category}`
            : k.depBlocked?.length ? `Blocked · after ${k.depBlocked.length} dep(s) · ${k.base || k.basedOn || 'no base yet'}`
              : `${agentOf(k, board)}${k.branch ? ` · ${k.branch}` : ''}`
          return (
            <div key={k.id} onClick={() => onOpen(k.id)} style={{ ...CARD_BOX, padding: '12px 13px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', flex: '0 0 auto', background: stageC(k.stage) }} />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ font: `400 13.5px ${PS}`, color: C.text, letterSpacing: '-0.005em', textWrap: 'pretty' }}>{cardTitle(k)}</div>
                <div style={{ font: `400 11px ${PM}`, color: C.meta, overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta}</div>
              </div>
              <span style={{ ...chipStyle('dim'), color: stageC(k.stage), padding: '3px 7px' }}>{stageN(k.stage)}</span>
            </div>
          )
        })}

        {tab === 'findings' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ ...CARD_BOX, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 180 }}>
                  <div style={{ font: `500 13.5px ${PS}`, color: C.text }}>
                    {live.length ? `${live.filter(f => f.status === 'open').length} open · ${(t.findings || []).length} seen`
                      : rounds ? 'No open findings' : 'Not reviewed yet'}
                  </div>
                  <MetaM>{rounds
                    ? `${rounds} review round${rounds === 1 ? '' : 's'} · $${spend.toFixed(2)} on this ticket${t.reviewedSha ? ` · reviewed @ ${String(t.reviewedSha).slice(0, 7)}` : ''}`
                    : 'No review round has run on this branch'}</MetaM>
                  {t.verdict && <MetaM color={t.verdict.action === 'advance' ? C.green : t.verdict.action === 'fix' ? C.amber : C.red}>{t.verdict.action} — {t.verdict.reason}</MetaM>}
                  {hasDesign && <MetaM>{t.designQa?.pass ? `design QA passed · ${t.designQa.cases?.length || 0} checks` : 'not checked against the design yet'}</MetaM>}
                </div>
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                  {hasDesign && <button style={BTN} disabled={!!t.running} title="compares the running branch against the Figma frames and the agreed copy — failures come back as review findings, not bugs" onClick={() => act('designqa')}>Run design QA</button>}
                  <button style={BTN_P} disabled={!!t.running} onClick={() => act('qa', t.qa || { baseUrl: t.preview?.url || '', env: 'staging' })}>Run QA</button>
                </div>
              </div>
              <details>
                <summary style={{ font: `400 11.5px ${PM}`, color: C.meta, cursor: 'pointer' }}>QA inputs — base URL, environment, scope</summary>
                <QaForm t={t} onRun={q => act('qa', q)} />
              </details>
            </div>

            {!t.findings?.length && <div style={EMPTY}>No review round on this ticket yet.<br />Findings appear here once a review or design QA runs.</div>}
            <FindingCards t={t} onAct={call} onFix={() => act('fix')} />

            {lastQa && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={SECTION_H}>QA run {fmtDate(lastQa.at)}</div>
                <MetaM color={lastQa.pass ? C.green : C.red}>
                  {lastQa.pass ? `all ${lastQa.cases.length} passed` : `${lastQa.cases.filter(c => c.pass === false).length}/${lastQa.cases.length} failed → bugs auto-filed`}
                </MetaM>
                {lastQa.cases.map((c, i) => (
                  <div key={i} style={{ font: `400 11.5px ${PM}`, color: C.sec, padding: '2px 0' }}>
                    {c.pass === false ? '✗' : c.kind === 'manual' ? '◻' : '✓'} <span style={{ color: c.pass === false ? C.red : C.text }}>{c.name}</span> <span style={{ color: C.meta }}>({c.kind})</span>
                    {c.evidence ? <span style={{ color: C.meta }}> — {String(c.evidence).slice(0, 120)}</span> : ''}
                  </div>
                ))}
                <MetaM>saved as this ticket's regression pack — future QA runs on related tickets can reuse it</MetaM>
              </div>
            )}
          </div>
        )}

        {tab === 'agent' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {!t.runs?.length && !t.running && !t.worktree
              ? <div style={EMPTY}>No agent has picked this ticket up.<br />No branch or worktree exists yet.</div>
              : (<>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, font: `400 11px ${PM}`, color: C.meta, flexWrap: 'wrap' }}>
                  {sessionId ? <>Last session<span style={{ color: '#ccd1d7' }}>{sessionId}</span></> : 'No session id recorded yet'}
                  <span style={{ marginLeft: 'auto' }}>{t.runs?.length || 0} agent run{t.runs?.length === 1 ? '' : 's'} · ${spend.toFixed(2)} · every run audited with its context handoff</span>
                </div>
                {/* The transcript is tailable from the moment the agent starts, so the answer to
                    "what is it doing right now" belongs on the ticket doing it. */}
                <AgentLive ticketId={t.id} running={t.running} onStopped={onRefresh} />
                {(t.runs || []).slice().reverse().map((r, i) => (
                  <div key={i} style={{ ...CARD_BOX, padding: '11px 13px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, font: `400 10.5px ${PM}`, color: C.meta, flexWrap: 'wrap' }}>
                      <span style={{ color: '#9db4e8' }}>{r.kind} · {r.model}</span>
                      <span style={{ color: '#383d45' }}>·</span>{fmtDate(r.at)}
                      <span style={{ marginLeft: 'auto', color: r.status === 'ok' ? C.green : C.red }}>
                        {r.status} · ${(r.cost || 0).toFixed(3)} · {r.turns} turns · {Math.round((r.ms || 0) / 1000)}s
                      </span>
                    </div>
                    {r.handoff && <MetaM>passed: {r.handoff.passed.join(', ')} — excluded: {r.handoff.excluded.join(', ') || 'nothing'}</MetaM>}
                    <p style={{ margin: 0, font: `400 12px/1.65 ${PM}`, color: '#aeb4bb', whiteSpace: 'pre-wrap', textWrap: 'pretty', overflowWrap: 'anywhere' }}>{r.summary}</p>
                  </div>
                ))}
              </>)}
          </div>
        )}
      </div>
    </>
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
  const [compose, setCompose] = useState(false)
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

  const visible = board ? board.tickets.filter(t => !fAttention || attentionOf(t)) : []
  const attentionCount = board ? board.tickets.filter(t => attentionOf(t)).length : 0
  const running = board ? board.tickets.filter(t => t.running) : []
  const openT = board && open ? board.tickets.find(t => t.id === open) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontFamily: PS }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {}
        <div title={project || undefined} style={{ display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${C.line2}`, borderRadius: 7, padding: '6px 10px', font: `400 12px ${PM}`, color: '#c2c7cd', background: C.card, maxWidth: '46%' }}>
          <span style={{ color: C.faint }}>repo</span>
          {projects.error ? <span style={{ color: C.red }}>projects could not be loaded — {projects.error}</span>
            : !project ? <span style={{ color: C.amber }}>no project selected above</span>
              : (<>
                {project.split('/').pop()}
                <span style={{ color: C.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortPath(project)}</span>
                {!projects.some(p => p.id === project) && <span title="no Claude Code settings for this path — the board still works, nothing is scoped to it" style={{ color: C.amber }}>unscoped</span>}
              </>)}
        </div>

        <div style={{ display: 'flex', gap: 2, border: `1px solid ${C.line2}`, borderRadius: 7, padding: 2, background: C.card }}>
          {[['board', 'Board'], ['analytics', 'Analytics'], ['setup', 'Setup']].map(([x, label]) => (
            <button key={x} onClick={() => setTab(x)} style={{
              ...BTN, border: 'none', borderRadius: 5, padding: '5px 12px', fontSize: 12.5,
              ...(tab === x ? { background: '#1d2740', color: C.blueLt } : { background: 'transparent', color: C.muted }),
            }}>{label}</button>
          ))}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* Not in the mock, but nine agents burning tokens on a project you are walking away from
              is the one thing you need from this bar that cannot wait for a drawer. */}
          {tab === 'board' && running.length > 0 && (
            <button style={{ ...BTN, border: '1px solid #45292b', background: '#1e1213', color: C.red }}
              title="kills every running agent on this project — each keeps its session id and can be resumed"
              onClick={() => {
                if (!window.confirm(`Stop ${running.length} running agent${running.length === 1 ? '' : 's'} on this project?\n\n${running.map(t => `· ${cardTitle(t)} (${t.running.kind})`).join('\n')}\n\nEach keeps its session id and can be resumed.`)) return
                api.post('/api/board/stop-all', { project }).then(r => { toast(`stopped ${r.stopped} agent${r.stopped === 1 ? '' : 's'}`, 'success'); load() }).catch(e => toast(e.message, 'error'))
              }}>Stop {running.length} running</button>
          )}
          {tab === 'board' && board && (
            <button onClick={() => setFAttention(v => !v)} title="unread, blocked, or waiting on your decision"
              style={{ ...BTN, display: 'flex', alignItems: 'center', gap: 8, ...(fAttention ? { border: '1px solid #3b2d18', background: '#1e1710', color: C.amber } : { background: C.card, color: C.muted }) }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.amber }} />
              Attention only<span style={{ fontFamily: PM, opacity: 0.7 }}>{attentionCount}</span>
            </button>
          )}
          {tab === 'board' && board && <button style={{ ...BTN_P, display: 'flex', alignItems: 'center', gap: 7 }} onClick={() => setCompose(v => !v)}>
            <span style={{ fontFamily: PM }}>+</span>New ticket
          </button>}
        </div>
      </div>

      {!project ? <div style={{ ...PANEL, font: `400 12px ${MONO}`, color: 'var(--text-tertiary)' }}>open a project in Claude Code first — the board is scoped per project</div>
        : !board ? <Skeleton tiles={0} rows={6} />
        : tab === 'analytics' ? <Analytics project={project} />
        : tab === 'setup' ? <Setup project={project} board={board} onRefresh={load} />
        : (
        <>
          {compose && <Compose project={project} teams={board.teams} onDone={load} onClose={() => setCompose(false)} />}
          {openT && <Drawer onClose={() => setOpen(null)}>
            <Detail t={openT} board={board} onRefresh={load} onClose={() => setOpen(null)} onOpen={setOpen} />
          </Drawer>}
          {/* A fixed-height row, so the lanes scroll inside themselves and the compose strip can
              never push the board below the fold. */}
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', alignItems: 'stretch', height: 'calc(100vh - 250px)', minHeight: 420, paddingBottom: 6 }}>
            {stages.map(s => {
              const col = visible.filter(t => t.stage === s)
              const drop = dragOver === s
              // An empty lane is a 44px rail: it keeps its name and stays a drop target, but it
              // stops spending a card's width to say "nothing here". Nine full lanes is 2600px of
              // board, and on a fresh ticket eight of them are empty.
              return (
                <div key={s}
                  onDragOver={e => { e.preventDefault(); if (dragOver !== s) setDragOver(s) }}
                  onDragLeave={() => setDragOver(o => (o === s ? null : o))}
                  onDrop={e => { e.preventDefault(); setDragOver(null); const id = e.dataTransfer.getData('text/plain'); if (id) move(id, s) }}
                  style={col.length
                    ? { flex: '0 0 288px', width: 288, borderRadius: 10, background: C.panel, border: `1px solid ${drop ? C.blue : C.line}`, padding: '11px 8px 0', minHeight: 0, display: 'flex', flexDirection: 'column' }
                    : { flex: '0 0 44px', width: 44, borderRadius: 10, background: C.panel, border: `1px dashed ${drop ? C.blue : C.line}`, display: 'flex' }}>
                  {col.length === 0 ? (
                    <div title={`${stageN(s)} — 0`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '12px 0' }}>
                      <span style={{ font: `400 11px ${PM}`, color: '#3f454d' }}>0</span>
                      <div style={{ writingMode: 'vertical-rl', font: `400 11px ${PM}`, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.faint, whiteSpace: 'nowrap' }}>{stageN(s)}</div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px 10px' }}>
                        <span style={{ font: `400 11px ${PM}`, letterSpacing: '0.13em', textTransform: 'uppercase', color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stageN(s)}</span>
                        <span style={{ font: `400 11px ${PM}`, color: C.text, background: '#191c21', borderRadius: 4, padding: '1px 6px' }}>{col.length}</span>
                        <span style={{ marginLeft: 'auto', width: 6, height: 6, borderRadius: '50%', background: stageC(s), opacity: 0.85, flex: '0 0 auto' }} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, overflowY: 'auto', padding: '2px 2px 40px' }}>
                        {col.map(t => <Card key={t.id} t={t} board={board} onOpen={id => setOpen(id === open ? null : id)} selected={open === t.id} />)}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <p className="small">board lives in ~/.claude/taskboard.json (every write versioned) · dev agents run headless claude in isolated git worktrees under ~/.claude/board-worktrees · review, design QA &amp; QA are manual triggers unless <b>autopilot</b> is on for this project (setup tab) · release is always a human gate with a per-repo merge queue · blocked ≠ idle: blocked cards surface in Inbox as errors, idle-waiting as info</p>
        </>
      )}
    </div>
  )
}
