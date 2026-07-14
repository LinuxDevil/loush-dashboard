import React, { useEffect, useState } from 'react'
import { api, toast } from '../api.js'
import { PANEL, HEAD, MONO, BODY, ACCENT, MUTE, INK, GREEN, PURPLE, RED, Badge, SectionTitle } from './theme.jsx'
import { useEngSelf } from './data.jsx'

const jiraUrl = i => i.host ? `https://${i.host}/browse/${i.key}` : null

export default function TicketRetroPanel() {
  const [tickets, setTickets] = useState(null)
  const [retro, setRetro] = useState(null)
  const { data: eng } = useEngSelf()
  useEffect(() => { api.get('/api/career/retro-tickets').then(r => setTickets(r.tickets || [])).catch(e => toast(e.message, 'error')) }, [])

  // JIRA closed tickets (client-composed retro from issue fields — no server round-trip)
  const jiraClosed = eng?.accountId ? eng.issues.filter(i => i.live).sort((a, b) => Date.parse(b.closedAt || 0) - Date.parse(a.closedAt || 0)).slice(0, 40) : []
  const openJira = (i) => setRetro({ jira: true, i })
  const openBoard = async (id) => { setRetro('loading'); try { setRetro(await api.get('/api/career/retro/' + id)) } catch (e) { toast(e.message, 'error'); setRetro(null) } }

  if (!tickets) return <div style={{ ...PANEL, color: MUTE }}>Loading…</div>

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16 }}>
      <div style={PANEL}>
        <SectionTitle>Delivered tickets</SectionTitle>
        {jiraClosed.map(i => (
          <button key={i.key} onClick={() => openJira(i)} style={{ display: 'block', width: '100%', textAlign: 'left', font: `400 11px ${MONO}`, color: INK, background: 'none', border: `1px solid ${MUTE}33`, borderRadius: 6, padding: '6px 8px', marginBottom: 4, cursor: 'pointer' }}>
            <b style={{ color: ACCENT }}>{i.key}</b> <span style={{ color: MUTE }}>{i.delivery}d</span><br /><span style={{ color: MUTE }}>{i.summary?.slice(0, 48)}</span>
          </button>
        ))}
        {tickets.map(t => (
          <button key={t.id} onClick={() => openBoard(t.id)} style={{ display: 'block', width: '100%', textAlign: 'left', font: `400 11px ${MONO}`, color: INK, background: 'none', border: `1px solid ${MUTE}33`, borderRadius: 6, padding: '6px 8px', marginBottom: 4, cursor: 'pointer' }}>
            <b>{t.id}</b> <span style={{ color: MUTE }}>{t.stage}</span><br /><span style={{ color: MUTE }}>{t.title}</span>
          </button>
        ))}
        {!jiraClosed.length && !tickets.length && <div style={{ font: `400 12px ${MONO}`, color: MUTE }}>No closed tickets.</div>}
      </div>

      <div style={PANEL}>
        {!retro ? <div style={{ font: `400 12px ${MONO}`, color: MUTE }}>Pick a ticket to compose its retro.</div>
          : retro === 'loading' ? <div style={{ color: MUTE }}>Composing…</div>
          : retro.jira ? <JiraRetro i={retro.i} />
          : <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ font: `600 14px ${HEAD}`, color: ACCENT }}>{retro.ticketId}</div>
              <div style={{ font: `400 12px ${MONO}`, color: MUTE }}>{retro.estimateVsActual ? `estimate ${retro.estimateVsActual.estimateDays}d vs actual ${retro.estimateVsActual.actualDays?.toFixed?.(1) ?? '—'}d` : 'no estimate on file'}</div>
              <div style={{ font: `400 12px ${MONO}`, color: MUTE }}>reopened: {retro.reopened} · escaped bugs: {retro.escapedBugs}</div>
              <div style={{ font: `400 11px ${MONO}`, color: MUTE }}>cycle by phase: {Object.entries(retro.cycleByPhase || {}).map(([k, v]) => `${k} ${v.toFixed(1)}d`).join(' · ') || '—'}</div>
              {/* item 13: the "no sessions" stub is DELETED. The join is real now — from the branch/commit
                  strings the agent typed — so a retro either has sessions with a real cost, or it says
                  honestly that THIS ticket is outside the joined sample and prints the coverage. */}
              <SessionCost r={retro} />
            </div>}
      </div>
    </div>
  )
}

// What this ticket actually cost to build — from the persisted session↔ticket join (self-plane).
function SessionCost({ r }) {
  const cov = r.joinCoverage == null ? null : Math.round(r.joinCoverage * 100)
  return (
    <div style={{ marginTop: 6, paddingTop: 10, borderTop: '1px solid #21262d' }}>
      {r.sessionsShown ? (
        <>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 6 }}>
            <Metric label="sessions" v={r.cost?.sessions ?? r.sessions.length} />
            <Metric label="tokens" v={(r.cost?.tokens || 0).toLocaleString()} />
            <Metric label="cost" v={r.cost?.usd == null ? '—' : `$${r.cost.usd.toFixed(2)}`} tone={PURPLE} />
            <Metric label="link confidence" v={r.linkConfidence} tone={r.linkConfidence === 'high' ? GREEN : MUTE} />
          </div>
          {r.sessions.map(s => (
            <div key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'center', font: `400 11px ${MONO}`, color: MUTE, padding: '2px 0' }}>
              <span style={{ color: INK }}>{s.id.slice(0, 8)}</span>
              <span>via {s.via}</span>
              <button onClick={() => navigator.clipboard.writeText(`claude --resume ${s.id}`).then(() => toast('resume command copied', 'success'))}
                style={{ font: `600 10.5px ${MONO}`, color: GREEN, background: 'transparent', border: `1px solid ${GREEN}55`, borderRadius: 5, padding: '1px 6px', cursor: 'pointer' }}>⧉ resume</button>
            </div>
          ))}
        </>
      ) : (
        <div style={{ font: `400 11.5px ${BODY}`, color: MUTE, lineHeight: 1.5 }}>
          No session on this laptop carries this ticket's key in a branch or commit — so its build cost is <b style={{ color: INK }}>unknown</b>, not zero.
        </div>
      )}
      {cov != null && (
        <div style={{ font: `400 10.5px ${BODY}`, color: cov < 20 ? PURPLE : MUTE, marginTop: 6 }}>
          Join coverage: {cov}% of this laptop's sessions carry a ticket key. Read every cost above against that.
        </div>
      )}
    </div>
  )
}

export function JiraRetro({ i }) {
  const estActual = i.estAcc
  const phases = Object.entries(i.daysIn || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <a href={jiraUrl(i)} target="_blank" rel="noreferrer" style={{ font: `600 15px ${HEAD}`, color: ACCENT, textDecoration: 'none' }}>{i.key}</a>
        <Badge tone="green">{i.status}</Badge>
        <span style={{ font: `400 12px ${BODY}`, color: INK }}>{i.summary}</span>
      </div>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <Metric label="cycle time" v={`${i.delivery}d`} />
        <Metric label="in dev" v={`${i.dev}d`} />
        <Metric label="in review" v={`${i.cr}d`} />
        <Metric label="est accuracy" v={estActual == null ? '—' : `${estActual}%`} tone={estActual != null && estActual < 60 ? RED : GREEN} />
        <Metric label="QA cycles" v={i.qaCycles} tone={i.qaCycles > 1 ? PURPLE : INK} />
        <Metric label="rework/reopen" v={i.rework} tone={i.rework > 0 ? RED : GREEN} />
        <Metric label="PRs" v={(i.prNums || []).length} />
      </div>
      <div style={{ font: `400 11px ${MONO}`, color: MUTE }}>time by phase: {phases.map(([k, v]) => `${k} ${v}d`).join(' · ') || '—'}</div>
      {i.stale && <div style={{ font: `400 11px ${MONO}`, color: PURPLE }}>⚠ {i.staleNote}</div>}
      <div style={{ font: `400 12px ${BODY}`, color: MUTE, marginTop: 4 }}>
        {i.rework > 0 ? `Reopened/reworked ${i.rework}× — worth a note on what changed mid-flight. ` : 'Clean single-pass delivery. '}
        {estActual != null && estActual < 60 ? 'Estimate was off — recalibrate sizing for this ticket type.' : ''}
      </div>
    </div>
  )
}
const Metric = ({ label, v, tone }) => (
  <div><div style={{ font: `600 18px ${MONO}`, color: tone || INK }}>{v}</div><div style={{ font: `400 10.5px ${BODY}`, color: MUTE }}>{label}</div></div>
)
