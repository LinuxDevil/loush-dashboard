import React, { useState } from 'react'
import { api, toast } from '../api.js'
import { MONO, BODY, ACCENT, MUTE, INK, GREEN, RED, PURPLE, LINE, Badge, LoadingPanel } from './theme.jsx'
import { Card, Btn, Nudge, Empty, HBars } from './charts.jsx'
import { useApi, copy } from './data.jsx'

// item 2 — team board: blocked & at-risk, grouped by person.
//
// ROWS ARE ALPHABETICAL. That is the symmetry rule, not an oversight: the moment this list is sorted
// by "most stuck" it becomes a ranking of people, and every number on the page starts getting gamed.
// Tickets *inside* a row are sorted by stuckness — a ticket is not a person.
export default function TeamBoard({ onPacket }) {
  const { data, loading, error } = useApi('/api/team/board')
  const [open, setOpen] = useState(null)

  if (loading && !data) return <LoadingPanel label="Loading the team board from JIRA…" tiles={3} />
  if (error || data?.available === false) return <Card title="Team board"><Empty tone={RED}>Team board unavailable — {error || data?.error}</Empty></Card>
  const rows = data?.rows || []

  const agenda = async (personId, item) => {
    try { await api.post('/api/career/packet/agenda', { person: personId, item }); toast('added to their 1:1 packet', 'success') }
    catch (e) { toast(e.message, 'error') }
  }

  return (
    <Card
      title="Team board — who is blocked, who is at risk"
      sub={`${rows.length} engineers · alphabetical · parked > ${data.parkedDays}d · WIP cap ${data.wipMax} · ${data.unassigned} unassigned tickets`}
      json={data}
      right={<span style={{ font: `400 10.5px ${BODY}`, color: MUTE, maxWidth: 340, textAlign: 'right' }}>
        Rows are alphabetical and carry no score — every fact here is one the person can already open in JIRA about themselves.
      </span>}>
      {!rows.length ? <Empty>No open tickets assigned to anyone in the snapshot.</Empty> : rows.map(r => {
        const red = r.flags.length > 0
        const isOpen = open === r.id
        return (
          <div key={r.id} style={{ borderTop: `1px solid ${LINE}`, padding: '9px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button onClick={() => setOpen(isOpen ? null : r.id)} style={{ font: `${red ? 600 : 500} 12.5px ${BODY}`, color: red ? RED : INK, background: 'none', border: 'none', padding: 0, cursor: 'pointer', minWidth: 190, textAlign: 'left' }}>
                {isOpen ? '▾' : '▸'} {r.name}
              </button>
              <Stat v={r.open} l="open" />
              <Stat v={r.wip} l="wip" tone={r.wip > data.wipMax ? RED : INK} />
              <Stat v={r.atRisk} l="at risk" tone={r.atRisk ? RED : MUTE} />
              <Stat v={r.blocked} l="blocked" tone={r.blocked ? PURPLE : MUTE} />
              <Stat v={`${Math.round(r.oldestInCurrent)}d`} l="oldest in status" tone={MUTE} />
              <span style={{ flex: 1 }} />
              {r.flags.map(f => <Badge key={f} tone="red">{f}</Badge>)}
              {onPacket && <Btn onClick={() => onPacket(r.id)} tone={MUTE}>1:1 packet</Btn>}
            </div>
            {isOpen && (
              <div style={{ marginTop: 8, paddingLeft: 14 }}>
                {r.tickets.map(t => (
                  <div key={t.key} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0', flexWrap: 'wrap' }}>
                    <a href={t.url} target="_blank" rel="noreferrer" style={{ font: `600 11.5px ${MONO}`, color: ACCENT, textDecoration: 'none', width: 92 }}>{t.key}</a>
                    <Badge tone={t.statusKind === 'active' ? 'green' : t.parked ? 'purple' : 'mute'}>{t.status}</Badge>
                    <span style={{ font: `500 11px ${MONO}`, color: t.atRisk ? RED : MUTE }}>{Math.round(t.inCurrent)}d{t.atRisk ? ' ⚠' : ''}</span>
                    <span style={{ flex: 1, minWidth: 200, font: `400 12px ${BODY}`, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.summary}</span>
                    {t.prNums?.length ? <span style={{ font: `400 10.5px ${MONO}`, color: MUTE }}>PR #{t.prNums.join(' #')}</span> : null}
                    {t.stale && <Badge tone="purple">stale</Badge>}
                    <Nudge text={t.nudge} />
                    {onPacket && <Btn tone={MUTE} onClick={() => agenda(r.id, { key: t.key, text: `${t.key} — "${t.status}" ${Math.round(t.inCurrent)}d`, url: t.url })}>+ 1:1</Btn>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </Card>
  )
}

const Stat = ({ v, l, tone }) => (
  <span style={{ font: `400 11px ${MONO}`, color: MUTE, whiteSpace: 'nowrap' }}>
    <b style={{ font: `600 13px ${MONO}`, color: tone || INK }}>{v}</b> {l}
  </span>
)
