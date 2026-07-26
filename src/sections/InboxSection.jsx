import React, { useEffect, useMemo, useState } from 'react'
import { api, fmtDate, toast } from '../lib/api.js'
import Skeleton from '../ui/Skeleton.jsx'
import { Tabs } from '../ui/tabs.jsx'
import { Stagger, CountUp } from '../ui/anim.jsx'

const MONO = "'IBM Plex Mono', monospace"
const HEAD = "'Space Grotesk', sans-serif"
const PANEL = { background: 'rgba(28,24,21,0.55)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: '18px 20px', backdropFilter: 'blur(10px)' }
const SEV = { error: '#e5484d', warning: '#e5a03a', info: '#8a807a' }
const KIND_ICON = { approval: '☑', budget: '¤', eval: '𝜎', session: '⌨', recommendation: '❒', board: '▦', run: '⟳', action: '⚡', ticket: '◱', review: '⟨⟩', quality: '◈', ci: '⚙' }
const fmtTok = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n)))
const d1 = n => (Math.round(n * 10) / 10).toFixed(1)

export default function InboxSection({ onNav }) {
  const [tab, setTab] = useState('Inbox')
  return (
    <div className="hx" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Tabs tabs={['Inbox', 'Daily digest', 'Notifications']} tab={tab} setTab={setTab} />
      {tab === 'Inbox' && <Inbox onNav={onNav} />}
      {tab === 'Daily digest' && <Digest onNav={onNav} />}
      {tab === 'Notifications' && <><Notify /><Scheduler /></>}
    </div>
  )
}

// Gap B — cadence loop control. Opt-in (default off); results land in the Inbox as info items.
function Scheduler() {
  const [cfg, setCfg] = useState(null)
  useEffect(() => { api.get('/api/scheduler').then(setCfg).catch(() => {}) }, [])
  if (!cfg) return null
  const save = next => { setCfg(next); api.put('/api/scheduler', next).catch(e => alert(e.message)) }
  const addDispatch = () => save({ ...cfg, jobs: [...(cfg.jobs || []), { id: 'dispatch-' + Date.now().toString(36), kind: 'dispatch', label: 'Auto-dispatch backlog', cadenceMin: 60, enabled: false, maxDispatch: 1, dailyCeilingUSD: 10 }] })
  const addRemediate = () => save({ ...cfg, jobs: [...(cfg.jobs || []), { id: 'remediate-' + Date.now().toString(36), kind: 'remediate', label: 'Propose remediations', cadenceMin: 30, enabled: false }] })
  return (
    <div style={{ ...PANEL, maxWidth: 640, marginTop: 16 }}>
      <div style={{ font: `600 15px ${HEAD}`, marginBottom: 14 }}>Scheduler <span style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>(unattended cadence loop)</span></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <input type="checkbox" checked={cfg.enabled} onChange={e => save({ ...cfg, enabled: e.target.checked })} style={{ width: 14 }} />
        <div>
          <div style={{ font: "500 13px 'IBM Plex Sans'", color: '#e5dbd2' }}>Run scheduled jobs</div>
          <div style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>runs jobs on their cadence and drops results into the Inbox (info-only, self-only) · never sends anything · uncheck = kill switch</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {(cfg.jobs || []).map((j, i) => (
          <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 10, font: `400 11px ${MONO}`, color: '#b0a69e' }}>
            <input type="checkbox" checked={j.enabled !== false} onChange={e => save({ ...cfg, jobs: cfg.jobs.map((x, k) => k === i ? { ...x, enabled: e.target.checked } : x) })} style={{ width: 13 }} />
            <span style={{ color: '#e5dbd2' }}>{j.label || j.id}</span>
            <span style={{ background: 'rgba(124,196,247,0.08)', color: '#7cc4f7', borderRadius: 5, padding: '1px 6px' }}>{j.kind}</span>
            {j.kind === 'dispatch' && <span style={{ color: '#7a716a' }}>{j.triggerStage || 'backlog'} · max {j.maxDispatch || 1}{j.dailyCeilingUSD ? ` · ≤$${j.dailyCeilingUSD}/day` : ''}</span>}
            {j.kind === 'remediate' && <span style={{ color: '#7a716a' }}>eval-regression · red-main → propose-only</span>}
            <span style={{ marginLeft: 'auto' }}>every {j.cadenceMin >= 1440 ? (j.cadenceMin / 1440) + 'd' : j.cadenceMin + 'm'}{j.lastRun ? ' · last ' + fmtDate(j.lastRun) : ' · never run'}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="mini" onClick={addDispatch}>+ auto-dispatch backlog</button>
        <button className="mini" onClick={addRemediate}>+ propose remediations</button>
      </div>
      <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a', marginTop: 6 }}>dispatch auto-starts backlog tickets → same worktree + gated run as ▸Start. remediate maps eval-regression / red-main to the exact reversible command, dropped in the Inbox (propose-only — nothing auto-runs). Config in <code>~/.claude/dashboard-scheduler.json</code>.</div>
    </div>
  )
}

// ---------- 1: delivery risk in the inbox ----------
// Two data planes, two filter chips, BOTH ON by default. The planes are a server-side boundary
// (work = JIRA/GitHub/CI artifacts everyone can already see · harness = this machine's own ~/.claude),
// not a UI mode: there is no view/lens/role switcher here or anywhere else in this app.
//
// "Nudge" COPIES a line for a human to send. It never sends anything. That is deliberate and permanent:
// the instant the dashboard messages people on its own, it becomes the thing engineers route around.
const PLANES = [
  ['work', 'Work', 'JIRA · GitHub · CI — artifacts the whole team can already open'],
  ['harness', 'Harness', "this machine's own Claude Code telemetry — self-only, always"],
]

function Chip({ on, color, onClick, title, children }) {
  return (
    <button onClick={onClick} title={title} style={{
      marginTop: 0, cursor: 'pointer', font: `600 11px ${MONO}`, padding: '5px 11px', borderRadius: 9,
      border: `1px solid ${on ? color + '77' : 'rgba(255,255,255,0.08)'}`,
      background: on ? color + '1f' : 'transparent', color: on ? color : '#6a615a',
    }}>{children}</button>
  )
}

function Inbox({ onNav }) {
  const [items, setItems] = useState(null)
  const [showDone, setShowDone] = useState(false)
  const [planes, setPlanes] = useState({ work: true, harness: true })
  const [copied, setCopied] = useState(null)
  // Dedupe by key: /api/inbox keys its `recommendation` rows on the finding TEXT alone, so the same
  // finding raised against two projects arrives twice under one key. Dropping the dupe here is correct —
  // clearing one would clear "both" anyway, since the server stores done-state by that same key.
  const load = () => api.get('/api/inbox').then(list => {
    const seen = new Set()
    setItems(list.filter(i => !seen.has(i.key) && seen.add(i.key)))
  }).catch(() => {})
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t) }, [])

  const mark = async (it, done) => { await api.post('/api/inbox/done', { key: it.key, done }); load() }
  const snooze = async it => { await api.post('/api/inbox/done', { key: it.key, snoozeHours: 24 }); toast('snoozed for 24h — it comes back tomorrow', 'success'); load() }
  const nudge = async it => {
    const line = it.nudge || it.text
    try { await navigator.clipboard.writeText(line) } catch { }
    setCopied(it.key); setTimeout(() => setCopied(k => (k === it.key ? null : k)), 1800)
    toast('nudge copied — nothing was sent. Paste it where the human is.', 'success')
  }

  const counts = useMemo(() => {
    const open = (items || []).filter(i => !i.done)
    return { work: open.filter(i => i.plane === 'work').length, harness: open.filter(i => i.plane !== 'work').length }
  }, [items])

  if (!items) return <Skeleton tiles={0} rows={6} />
  const inPlane = i => planes[i.plane === 'work' ? 'work' : 'harness']
  const open = items.filter(i => !i.done && inPlane(i))
  const shown = (showDone ? items.filter(inPlane) : open)
  const sevN = { error: 0, warning: 1, info: 2 }
  const errs = open.filter(i => i.severity === 'error').length

  return (
    <div style={{ ...PANEL }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ font: `600 15px ${HEAD}` }}>
          Everything that needs you{' '}
          <span style={{ font: `400 11px ${MONO}`, color: errs ? '#e5484d' : '#8a807a' }}><CountUp value={open.length} /> open{errs ? <> · <CountUp value={errs} /> error</> : ''}</span>
        </div>
        <span style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)' }} />
        {PLANES.map(([id, label, hint]) => (
          <Chip key={id} on={planes[id]} color={id === 'work' ? '#5eb3f6' : '#d97757'} title={hint}
            onClick={() => setPlanes(p => ({ ...p, [id]: !p[id] }))}>
            {label} <span style={{ opacity: 0.7 }}>{counts[id]}</span>
          </Chip>
        ))}
        <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, font: `400 11px ${MONO}`, color: '#8a807a', cursor: 'pointer' }}>
          <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} style={{ width: 13 }} />show cleared / snoozed
        </label>
      </div>

      <Stagger step={16} max={320}>
      {shown.sort((a, b) => sevN[a.severity] - sevN[b.severity] || b.ts - a.ts).map(it => {
        const work = it.plane === 'work'
        return (
          <div key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 4px', borderBottom: '1px solid rgba(255,255,255,0.045)', opacity: it.done ? 0.45 : 1 }}>
            <span style={{ width: 26, height: 26, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', font: `600 13px ${HEAD}`, color: SEV[it.severity], background: 'rgba(255,255,255,0.04)', flexShrink: 0 }}>{KIND_ICON[it.kind] || '•'}</span>
            <span style={{ font: `600 9px ${MONO}`, padding: '2px 6px', borderRadius: 4, color: SEV[it.severity], background: 'rgba(255,255,255,0.04)', flexShrink: 0 }}>{it.severity.toUpperCase()}</span>
            <span title={work ? 'plane: work artifacts' : 'plane: this machine’s harness'} style={{ font: `600 9px ${MONO}`, padding: '2px 6px', borderRadius: 4, flexShrink: 0, color: work ? '#5eb3f6' : '#d97757', background: (work ? '#5eb3f6' : '#d97757') + '1a' }}>{work ? 'WORK' : 'HARNESS'}</span>
            <span style={{ flex: 1, minWidth: 0, font: "400 12.5px 'IBM Plex Sans'", color: '#c8bdb4' }}>
              {it.text}
              {(it.owner || it.ageWorkDays != null) && (
                <span style={{ font: `400 10.5px ${MONO}`, color: '#6a615a', marginLeft: 8 }}>
                  {it.owner ? `· ${it.owner}` : ''}{it.ageWorkDays != null ? ` · ${d1(it.ageWorkDays)}d` : ''}{it.overBudgetBy != null ? ` (+${d1(it.overBudgetBy)}d over)` : ''}
                </span>
              )}
              {it.snoozedUntil && <span style={{ font: `400 10px ${MONO}`, color: '#e5a03a', marginLeft: 8 }}>· snoozed until {new Date(it.snoozedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
            </span>
            <span style={{ font: `400 10px ${MONO}`, color: '#6a615a', flexShrink: 0 }}>{fmtDate(it.ts)}</span>
            {it.nudge && <button className="mini" style={{ marginTop: 0, color: copied === it.key ? '#3fb96a' : undefined }} title="copies a ready-to-send line. Nothing is ever sent for you." onClick={() => nudge(it)}>{copied === it.key ? '✓ copied' : 'nudge'}</button>}
            {!it.done && <button className="mini" style={{ marginTop: 0 }} title="hide until tomorrow" onClick={() => snooze(it)}>snooze 24h</button>}
            <button className="mini" style={{ marginTop: 0 }} onClick={() => (it.link ? window.open(it.link, '_blank') : onNav?.(it.section))}>open</button>
            <button className="mini" style={{ marginTop: 0 }} onClick={() => mark(it, !it.done)}>{it.done ? 'reopen' : 'clear'}</button>
          </div>
        )
      })}
      </Stagger>
      {shown.length === 0 && <div style={{ font: `400 12px ${MONO}`, color: '#3fb96a' }}>✓ inbox zero — nothing is waiting on you{(!planes.work || !planes.harness) && ' in the planes you have on'}</div>}
      <p className="small">
        <b style={{ color: '#5eb3f6' }}>work</b>: PRs with no review past the 24/48 working-hour SLA · tickets past their stage budget · QA cycles ≥ 3 · rework re-entry · a JIRA status stale against a merged PR · a red main branch.{' '}
        <b style={{ color: '#d97757' }}>harness</b>: sessions waiting on you · pending approvals · budget alerts · failed evals · error-level recommendations.{' '}
        "nudge" copies a line — it never sends one. "snooze" defers for 24h; "clear" hides it permanently.
      </p>
    </div>
  )
}

function Digest({ onNav }) {
  const [days, setDays] = useState(1)
  const [d, setD] = useState(null)
  useEffect(() => { setD(null); api.get('/api/digest?days=' + days).then(setD).catch(() => {}) }, [days])
  if (!d) return <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>assembling digest…</div>
  const line = (label, value) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', font: `500 12px ${MONO}`, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ color: '#8a807a' }}>{label}</span><span style={{ color: '#eee3da' }}>{value}</span>
    </div>
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <select value={days} onChange={e => setDays(Number(e.target.value))}><option value={1}>last 24h</option><option value={7}>last 7d</option></select>
        <span style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>the state of every project without opening each one — generated live</span>
      </div>
      <div className="hx-2">
        <div style={{ ...PANEL }}>
          <div style={{ font: `600 15px ${HEAD}`, marginBottom: 10 }}>Shipped</div>
          {d.commits.map(c => (
            <div key={c.project} style={{ padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <div style={{ font: `600 12px ${MONO}`, color: '#eee3da' }}>{c.project} <span style={{ color: '#3fb96a' }}>+{c.count} commit{c.count === 1 ? '' : 's'}</span></div>
              <div style={{ font: `400 11px ${MONO}`, color: '#7a716a', marginTop: 2 }}>{c.latest}</div>
            </div>
          ))}
          {d.commits.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: '#5a514a' }}>no commits in range</div>}
          {line('lines changed (edit tools)', `+${fmtTok(d.lines.add)} / −${fmtTok(d.lines.del)}`)}
        </div>
        <div style={{ ...PANEL }}>
          <div style={{ font: `600 15px ${HEAD}`, marginBottom: 10 }}>Spent</div>
          {line('cost', '$' + d.cost.toFixed(2))}
          {line('output tokens', fmtTok(d.tokens))}
          {line('assistant messages', fmtTok(d.msgs))}
          {line('eval runs', d.evals.runs + (d.evals.passRate != null ? ` · ${Math.round(d.evals.passRate * 100)}% pass` : ''))}
          <div style={{ font: `600 13px ${HEAD}`, margin: '14px 0 6px' }}>By project</div>
          {d.byProj.map(([p, v]) => line(p.split('-').slice(-2).join('-'), `$${v.cost.toFixed(2)} · ${fmtTok(v.out)} tok`))}
        </div>
      </div>
      <div className="hx-2">
        <div style={{ ...PANEL }}>
          <div style={{ font: `600 15px ${HEAD}`, marginBottom: 10 }}>Drift detected</div>
          {d.drift.map(x => (
            <div key={x.project} style={{ display: 'flex', justifyContent: 'space-between', font: `500 12px ${MONO}`, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ color: '#e8a06a' }}>{x.project}</span>
              <span style={{ color: '#c8bdb4' }}>{x.fields} field{x.fields === 1 ? '' : 's'} off baseline <button className="mini" style={{ marginLeft: 8, marginTop: 0 }} onClick={() => onNav?.('harness')}>review</button></span>
            </div>
          ))}
          {d.drift.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: '#3fb96a' }}>✓ all baselined projects in sync</div>}
        </div>
        <div style={{ ...PANEL }}>
          <div style={{ font: `600 15px ${HEAD}`, marginBottom: 10 }}>Needs attention</div>
          {d.attention.map(i => (
            <div key={i.key} style={{ display: 'flex', gap: 9, alignItems: 'baseline', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ font: `600 9px ${MONO}`, color: SEV[i.severity] }}>{i.severity.toUpperCase()}</span>
              <span style={{ font: "400 12px 'IBM Plex Sans'", color: '#c8bdb4', flex: 1 }}>{i.text}</span>
            </div>
          ))}
          {d.attention.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: '#3fb96a' }}>✓ nothing open</div>}
        </div>
      </div>
    </div>
  )
}

function Notify() {
  const [cfg, setCfg] = useState(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => { api.get('/api/notify').then(setCfg).catch(() => {}) }, [])
  if (!cfg) return null
  const save = async next => {
    setCfg(next)
    await api.put('/api/notify', next).catch(e => alert(e.message))
    setSaved(true); setTimeout(() => setSaved(false), 1500)
  }
  const askDesktop = async () => {
    const perm = await Notification.requestPermission()
    if (perm === 'granted') { new Notification('claude-dashboard', { body: 'Desktop notifications enabled' }); save({ ...cfg, desktop: true }) }
    else alert('browser permission denied — allow notifications for this site')
  }
  return (
    <div style={{ ...PANEL, maxWidth: 640 }}>
      <div style={{ font: `600 15px ${HEAD}`, marginBottom: 14 }}>Notifications {saved && <span style={{ font: `400 11px ${MONO}`, color: '#3fb96a' }}>saved</span>}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="checkbox" checked={cfg.desktop} onChange={e => e.target.checked ? askDesktop() : save({ ...cfg, desktop: false })} style={{ width: 14 }} />
          <div>
            <div style={{ font: "500 13px 'IBM Plex Sans'", color: '#e5dbd2' }}>Desktop notifications</div>
            <div style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>fires while the dashboard tab is open, for new error/warning inbox items (a red main, a PR nobody reviewed, an agent needing input)</div>
          </div>
        </div>
        <div>
          <div style={{ font: "500 13px 'IBM Plex Sans'", color: '#e5dbd2', marginBottom: 6 }}>Slack webhook</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={cfg.slackWebhook || ''} onChange={e => setCfg({ ...cfg, slackWebhook: e.target.value })} onBlur={() => save(cfg)} placeholder="https://hooks.slack.com/services/…" />
            <button className="mini" style={{ marginTop: 0, flexShrink: 0 }} onClick={() => api.post('/api/notify/test').then(r => alert(r.ok ? 'sent ✓' : 'slack replied ' + r.status)).catch(e => alert(e.message))}>test</button>
          </div>
          <div style={{ font: `400 11px ${MONO}`, color: '#7a716a', marginTop: 6 }}>the server pushes new error/warning inbox items every minute while running · leave empty to disable. This posts to a CHANNEL — it never @-mentions a person on your behalf.</div>
        </div>
      </div>
    </div>
  )
}
