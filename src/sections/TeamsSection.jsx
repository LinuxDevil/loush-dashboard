import React, { useEffect, useState } from 'react'
import { api, fmtDate } from '../lib/api.js'

const MONO = 'var(--mono)'
const HEAD = 'var(--head)'
const PANEL = { background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 12, padding: '16px 18px' }
const POLL_MS = 5000

const STATUS = {
  working: { color: 'var(--green)', gloss: 'transcript changed recently, or holds an in-progress task' },
  planning: { color: 'var(--accent-light)', gloss: 'plan mode required and a plan message was seen' },
  idle: { color: 'var(--text-tertiary)', gloss: 'no recent transcript activity and no claimed task' },
  failed: { color: 'var(--red)', gloss: 'last transcript entry was an error and nothing has happened since' },
  shutdown: { color: 'var(--text-tertiary)', gloss: 'quiet for over 30 minutes with no task' },
}
const TASK_COLOR = { in_progress: 'var(--green)', completed: 'var(--text-tertiary)', pending: 'var(--accent-light)', blocked: 'var(--red)' }
const kTok = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n || 0)))

export default function TeamsSection() {
  const [d, setD] = useState(null)
  const [team, setTeam] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => {
    let alive = true
    const tick = () => api.get('/api/team' + (team ? '?team=' + encodeURIComponent(team) : ''))
      .then(r => { if (alive) { setD(r); setErr('') } }).catch(e => alive && setErr(e.message))
    tick()
    const h = setInterval(tick, POLL_MS)
    return () => { alive = false; clearInterval(h) }
  }, [team])

  if (err && !d) return <div style={{ ...PANEL, color: 'var(--red)', font: `400 12px ${MONO}` }}>{err}</div>
  if (!d) return <div style={{ ...PANEL, font: `400 12px ${MONO}`, color: 'var(--text-tertiary)' }}>loading…</div>
  if (!d.team) {
    return (
      <div style={{ ...PANEL, font: `400 12px ${MONO}`, color: 'var(--text-tertiary)' }}>
        No agent teams found. A team is a directory under <code>~/.claude/teams/&lt;name&gt;/</code> with a
        <code> config.json</code>; this screen reads them, it does not create them.
      </div>
    )
  }

  const members = d.members || []
  const tasks = d.tasks || []
  const byId = Object.fromEntries(tasks.map(t => [String(t.id), t]))

  return (
    <div className="hx" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ ...PANEL }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', marginBottom: 10, flexWrap: 'wrap' }}>
          <div style={{ font: `600 14px ${HEAD}` }}>{d.team.name}</div>
          {(d.teams || []).length > 1 && (
            <select value={team || d.team.name} onChange={e => setTeam(e.target.value)}>
              {d.teams.map(t => <option key={t}>{t}</option>)}
            </select>
          )}
          <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>
            {members.length} member{members.length === 1 ? '' : 's'} · created {d.team.createdAt ? fmtDate(d.team.createdAt) : 'unknown'} · refreshes every {POLL_MS / 1000}s
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {members.map(m => {
            const st = STATUS[m.status] || STATUS.idle
            return (
              <div key={m.agentId || m.name} style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', font: `400 11px ${MONO}` }}>
                <span title={st.gloss} style={{ color: st.color, width: 74 }}>● {m.status}</span>
                <span style={{ font: `600 12px ${HEAD}`, color: 'var(--text-primary)' }}>{m.name}</span>
                {m.isLead && <span className="chip" title="team lead">lead</span>}
                <span style={{ color: 'var(--text-tertiary)' }}>{m.model || 'model unknown'}</span>
                {}
                {m.permissionMode && m.permissionMode !== 'default' && <span className="chip">{m.permissionMode}</span>}
                {m.currentTask && <span style={{ color: 'var(--text-secondary)' }}>▸ {m.currentTask}</span>}
                {m.error && <span style={{ color: 'var(--red)' }} title={m.error}>error: {String(m.error).slice(0, 60)}</span>}
                <span style={{ marginLeft: 'auto', color: 'var(--text-tertiary)' }}>
                  {m.tokens ? kTok(m.tokens) + ' tok' : '—'} · {m.lastActivity ? fmtDate(m.lastActivity) : 'never seen'}
                </span>
              </div>
            )
          })}
        </div>
        <div style={{ marginTop: 10, font: `400 10px ${MONO}`, color: 'var(--text-tertiary)' }}>
          Status is inferred from transcript freshness, task claims and idle messages — there is no
          status file to read, so treat it as a strong hint rather than a fact.
        </div>
      </div>

      <div style={{ ...PANEL }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', marginBottom: 10 }}>
          <div style={{ font: `600 14px ${HEAD}` }}>Tasks</div>
          <span style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>{tasks.length} total</span>
        </div>
        {tasks.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)' }}>no tasks recorded for this team</div>}
        {tasks.map(t => {
          const unmet = (t.blockedBy || []).filter(id => byId[String(id)] && byId[String(id)].status !== 'completed')
          return (
            <div key={t.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', font: `400 11px ${MONO}`, flexWrap: 'wrap' }}>
              <span style={{ color: TASK_COLOR[t.status] || 'var(--text-tertiary)', width: 88 }}>{t.status}</span>
              <span style={{ color: 'var(--text-tertiary)', width: 30 }}>#{t.id}</span>
              <span style={{ color: 'var(--text-secondary)', flex: 1, minWidth: 200 }}>{t.subject}</span>
              {t.owner && <span className="chip">{t.owner}</span>}
              {unmet.length > 0 && (
                <span style={{ color: 'var(--amber, #d79921)' }} title={unmet.map(id => `#${id} ${byId[String(id)]?.subject || ''}`).join('\n')}>
                  blocked by {unmet.map(id => '#' + id).join(', ')}
                </span>
              )}
              {(t.blocks || []).length > 0 && <span style={{ color: 'var(--text-tertiary)' }}>blocks {t.blocks.map(id => '#' + id).join(', ')}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
