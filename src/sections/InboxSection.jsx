import React, { useEffect, useMemo, useState } from 'react'
import { api, fmtDate, toast } from '../lib/api.js'
import Skeleton from '../ui/Skeleton.jsx'
import { Tabs } from '../ui/tabs.jsx'
import { Stagger, CountUp } from '../ui/anim.jsx'

const MONO = "var(--mono)"
const HEAD = "var(--head)"
const PANEL = { background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 12, padding: '16px 18px' }
const SEV = { error: 'var(--red)', warning: 'var(--amber)', info: 'var(--text-secondary)' }
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

function Scheduler() {
  const [cfg, setCfg] = useState(null)
  useEffect(() => { api.get('/api/scheduler').then(setCfg).catch(() => {}) }, [])
  if (!cfg) return null
  const save = next => { setCfg(next); api.put('/api/scheduler', next).catch(e => alert(e.message)) }
  const addDispatch = () => save({ ...cfg, jobs: [...(cfg.jobs || []), { id: 'dispatch-' + Date.now().toString(36), kind: 'dispatch', label: 'Auto-dispatch backlog', cadenceMin: 60, enabled: false, maxDispatch: 1, dailyCeilingUSD: 10 }] })
  const addRemediate = () => save({ ...cfg, jobs: [...(cfg.jobs || []), { id: 'remediate-' + Date.now().toString(36), kind: 'remediate', label: 'Propose remediations', cadenceMin: 30, enabled: false }] })
  return (
    <div style={{ ...PANEL, maxWidth: 640, marginTop: 16 }}>
      <div style={{ font: `600 14px ${HEAD}`, marginBottom: 14 }}>Scheduler <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>(unattended cadence loop)</span></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <input type="checkbox" checked={cfg.enabled} onChange={e => save({ ...cfg, enabled: e.target.checked })} style={{ width: 14 }} />
        <div>
          <div style={{ font: "500 13px var(--body)", color: 'var(--text-primary)' }}>Run scheduled jobs</div>
          <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>runs jobs on their cadence and drops results into the Inbox (info-only, self-only) · never sends anything · uncheck = kill switch</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {(cfg.jobs || []).map((j, i) => (
          <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 10, font: `400 11px ${MONO}`, color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={j.enabled !== false} onChange={e => save({ ...cfg, jobs: cfg.jobs.map((x, k) => k === i ? { ...x, enabled: e.target.checked } : x) })} style={{ width: 13 }} />
            <span style={{ color: 'var(--text-primary)' }}>{j.label || j.id}</span>
            <span style={{ background: 'var(--blue-bg)', color: 'var(--blue)', borderRadius: 5, padding: '1px 6px' }}>{j.kind}</span>
            {j.kind === 'dispatch' && <span style={{ color: 'var(--text-tertiary)' }}>{j.triggerStage || 'backlog'} · max {j.maxDispatch || 1}{j.dailyCeilingUSD ? ` · ≤$${j.dailyCeilingUSD}/day` : ''}</span>}
            {j.kind === 'remediate' && <span style={{ color: 'var(--text-tertiary)' }}>eval-regression · red-main → propose-only</span>}
            <span style={{ marginLeft: 'auto' }}>every {j.cadenceMin >= 1440 ? (j.cadenceMin / 1440) + 'd' : j.cadenceMin + 'm'}{j.lastRun ? ' · last ' + fmtDate(j.lastRun) : ' · never run'}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="mini" onClick={addDispatch}>+ auto-dispatch backlog</button>
        <button className="mini" onClick={addRemediate}>+ propose remediations</button>
      </div>
      <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)', marginTop: 6 }}>dispatch auto-starts backlog tickets → same worktree + gated run as ▸Start. remediate maps eval-regression / red-main to the exact reversible command, dropped in the Inbox (propose-only — nothing auto-runs). Config in <code>~/.claude/dashboard-scheduler.json</code>.</div>
    </div>
  )
}

// ---------- 1: delivery risk in the inbox ----------
const PLANES = [
  ['work', 'Work', 'JIRA · GitHub · CI — artifacts the whole team can already open'],
  ['harness', 'Harness', "this machine's own Claude Code telemetry — self-only, always"],
]

function Chip({ on, color, onClick, title, children }) {
  return (
    <button onClick={onClick} title={title} style={{
      marginTop: 0, cursor: 'pointer', font: `600 11px ${MONO}`, padding: '5px 11px', borderRadius: 6,
      border: `1px solid ${on ? color + '77' : 'var(--bg-surface-active)'}`,
      background: on ? color + '1f' : 'transparent', color: on ? color : 'var(--text-tertiary)',
    }}>{children}</button>
  )
}

function Inbox({ onNav }) {
  const [items, setItems] = useState(null)
  const [showDone, setShowDone] = useState(false)
  const [planes, setPlanes] = useState({ work: true, harness: true })
  const [copied, setCopied] = useState(null)
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
        <div style={{ font: `600 14px ${HEAD}` }}>
          Everything that needs you{' '}
          <span style={{ font: `400 11px ${MONO}`, color: errs ? 'var(--red)' : 'var(--text-secondary)' }}><CountUp value={open.length} /> open{errs ? <> · <CountUp value={errs} /> error</> : ''}</span>
        </div>
        <span style={{ width: 1, height: 16, background: 'var(--bg-surface-active)' }} />
        {PLANES.map(([id, label, hint]) => (
          <Chip key={id} on={planes[id]} color={id === 'work' ? 'var(--blue)' : 'var(--accent)'} title={hint}
            onClick={() => setPlanes(p => ({ ...p, [id]: !p[id] }))}>
            {label} <span style={{ opacity: 0.7 }}>{counts[id]}</span>
          </Chip>
        ))}
        <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, font: `400 11px ${MONO}`, color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} style={{ width: 13 }} />show cleared / snoozed
        </label>
      </div>

      <Stagger step={16} max={320}>
      {shown.sort((a, b) => sevN[a.severity] - sevN[b.severity] || b.ts - a.ts).map(it => {
        const work = it.plane === 'work'
        return (
          <div key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 4px', borderBottom: '1px solid var(--border-subtle)', opacity: it.done ? 0.45 : 1 }}>
            <span style={{ width: 26, height: 26, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', font: `600 13px ${HEAD}`, color: SEV[it.severity], background: 'var(--bg-surface-hover)', flexShrink: 0 }}>{KIND_ICON[it.kind] || '•'}</span>
            <span style={{ font: `600 9px ${MONO}`, padding: '2px 6px', borderRadius: 4, color: SEV[it.severity], background: 'var(--bg-surface-hover)', flexShrink: 0 }}>{it.severity.toUpperCase()}</span>
            <span title={work ? 'plane: work artifacts' : 'plane: this machine’s harness'} style={{ font: `600 9px ${MONO}`, padding: '2px 6px', borderRadius: 4, flexShrink: 0, color: work ? 'var(--blue)' : 'var(--accent)', background: (work ? 'var(--blue)' : 'var(--accent)') + '1a' }}>{work ? 'WORK' : 'HARNESS'}</span>
            <span style={{ flex: 1, minWidth: 0, font: "400 13px var(--body)", color: 'var(--text-secondary)' }}>
              {it.text}
              {(it.owner || it.ageWorkDays != null) && (
                <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)', marginLeft: 8 }}>
                  {it.owner ? `· ${it.owner}` : ''}{it.ageWorkDays != null ? ` · ${d1(it.ageWorkDays)}d` : ''}{it.overBudgetBy != null ? ` (+${d1(it.overBudgetBy)}d over)` : ''}
                </span>
              )}
              {it.snoozedUntil && <span style={{ font: `400 10px ${MONO}`, color: 'var(--amber)', marginLeft: 8 }}>· snoozed until {new Date(it.snoozedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
            </span>
            <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-tertiary)', flexShrink: 0 }}>{fmtDate(it.ts)}</span>
            {it.nudge && <button className="mini" style={{ marginTop: 0, color: copied === it.key ? 'var(--green)' : undefined }} title="copies a ready-to-send line. Nothing is ever sent for you." onClick={() => nudge(it)}>{copied === it.key ? '✓ copied' : 'nudge'}</button>}
            {!it.done && <button className="mini" style={{ marginTop: 0 }} title="hide until tomorrow" onClick={() => snooze(it)}>snooze 24h</button>}
            <button className="mini" style={{ marginTop: 0 }} onClick={() => (it.link ? window.open(it.link, '_blank') : onNav?.(it.section, it.pane))}>open</button>
            <button className="mini" style={{ marginTop: 0 }} onClick={() => mark(it, !it.done)}>{it.done ? 'reopen' : 'clear'}</button>
          </div>
        )
      })}
      </Stagger>
      {shown.length === 0 && <div style={{ font: `400 12px ${MONO}`, color: 'var(--green)' }}>✓ inbox zero — nothing is waiting on you{(!planes.work || !planes.harness) && ' in the planes you have on'}</div>}
      <p className="small">
        <b style={{ color: 'var(--blue)' }}>work</b>: PRs with no review past the 24/48 working-hour SLA · tickets past their stage budget · QA cycles ≥ 3 · rework re-entry · a JIRA status stale against a merged PR · a red main branch.{' '}
        <b style={{ color: 'var(--accent)' }}>harness</b>: sessions waiting on you · pending approvals · budget alerts · failed evals · error-level recommendations.{' '}
        "nudge" copies a line — it never sends one. "snooze" defers for 24h; "clear" hides it permanently.
      </p>
    </div>
  )
}

function Digest({ onNav }) {
  const [days, setDays] = useState(1)
  const [d, setD] = useState(null)
  useEffect(() => { setD(null); api.get('/api/digest?days=' + days).then(setD).catch(() => {}) }, [days])
  if (!d) return <div style={{ font: `400 12px ${MONO}`, color: 'var(--text-tertiary)' }}>assembling digest…</div>
  const line = (label, value) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', font: `500 12px ${MONO}`, padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span><span style={{ color: 'var(--text-primary)' }}>{value}</span>
    </div>
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <select value={days} onChange={e => setDays(Number(e.target.value))}><option value={1}>last 24h</option><option value={7}>last 7d</option></select>
        <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>the state of every project without opening each one — generated live</span>
      </div>
      <div className="hx-2">
        <div style={{ ...PANEL }}>
          <div style={{ font: `600 14px ${HEAD}`, marginBottom: 10 }}>Shipped</div>
          {d.commits.map(c => (
            <div key={c.project} style={{ padding: '7px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <div style={{ font: `600 12px ${MONO}`, color: 'var(--text-primary)' }}>{c.project} <span style={{ color: 'var(--green)' }}>+{c.count} commit{c.count === 1 ? '' : 's'}</span></div>
              <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)', marginTop: 2 }}>{c.latest}</div>
            </div>
          ))}
          {d.commits.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>no commits in range</div>}
          {line('lines changed (edit tools)', `+${fmtTok(d.lines.add)} / −${fmtTok(d.lines.del)}`)}
        </div>
        <div style={{ ...PANEL }}>
          <div style={{ font: `600 14px ${HEAD}`, marginBottom: 10 }}>Spent</div>
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
          <div style={{ font: `600 14px ${HEAD}`, marginBottom: 10 }}>Drift detected</div>
          {d.drift.map(x => (
            <div key={x.project} style={{ display: 'flex', justifyContent: 'space-between', font: `500 12px ${MONO}`, padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--accent-light)' }}>{x.project}</span>
              <span style={{ color: 'var(--text-secondary)' }}>{x.fields} field{x.fields === 1 ? '' : 's'} off baseline <button className="mini" style={{ marginLeft: 8, marginTop: 0 }} onClick={() => onNav?.('harness')}>review</button></span>
            </div>
          ))}
          {d.drift.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: 'var(--green)' }}>✓ all baselined projects in sync</div>}
        </div>
        <div style={{ ...PANEL }}>
          <div style={{ font: `600 14px ${HEAD}`, marginBottom: 10 }}>Needs attention</div>
          {d.attention.map(i => (
            <div key={i.key} style={{ display: 'flex', gap: 9, alignItems: 'baseline', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ font: `600 9px ${MONO}`, color: SEV[i.severity] }}>{i.severity.toUpperCase()}</span>
              <span style={{ font: "400 12px var(--body)", color: 'var(--text-secondary)', flex: 1 }}>{i.text}</span>
            </div>
          ))}
          {d.attention.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: 'var(--green)' }}>✓ nothing open</div>}
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
      <div style={{ font: `600 14px ${HEAD}`, marginBottom: 14 }}>Notifications {saved && <span style={{ font: `400 11px ${MONO}`, color: 'var(--green)' }}>saved</span>}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="checkbox" checked={cfg.desktop} onChange={e => e.target.checked ? askDesktop() : save({ ...cfg, desktop: false })} style={{ width: 14 }} />
          <div>
            <div style={{ font: "500 13px var(--body)", color: 'var(--text-primary)' }}>Desktop notifications</div>
            <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>fires while the dashboard tab is open, for new error/warning inbox items (a red main, a PR nobody reviewed, an agent needing input)</div>
          </div>
        </div>
        <div>
          <div style={{ font: "500 13px var(--body)", color: 'var(--text-primary)', marginBottom: 6 }}>Slack webhook</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={cfg.slackWebhook || ''} onChange={e => setCfg({ ...cfg, slackWebhook: e.target.value })} onBlur={() => save(cfg)} placeholder="https://hooks.slack.com/services/…" />
            <button className="mini" style={{ marginTop: 0, flexShrink: 0 }} onClick={() => api.post('/api/notify/test').then(r => alert(r.ok ? 'sent ✓' : 'slack replied ' + r.status)).catch(e => alert(e.message))}>test</button>
          </div>
          <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)', marginTop: 6 }}>the server pushes new error/warning inbox items every minute while running · leave empty to disable. This posts to a CHANNEL — it never @-mentions a person on your behalf.</div>
        </div>
      </div>
    </div>
  )
}
