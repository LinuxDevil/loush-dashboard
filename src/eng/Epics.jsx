import React, { useState } from 'react'
import { HEAD, BODY, MONO, BB, GREEN, GOLD, RED, PURPLE, DIM, HI, Card, Empty, H1, DataTable, TicketLink, Kpi, miniBtn, inp, useCopy, fdate, fx } from './ui.jsx'

// §10 — the PM plans in epics and dates; the dashboard only knew tickets and months. One row per epic in
// flight, with a FORECAST from trailing-8-week velocity against the committed date, sorted by risk.
const RISK = { red: RED, amber: GOLD, green: GREEN, unknown: DIM }

export default function Epics({ snap, reload, onOpenTicket }) {
  const [copy, copied] = useCopy()
  const [edit, setEdit] = useState(null) // {key, date}
  const epics = snap.epics || []
  const save = () => {
    const { key, date } = edit
    fetch('/api/eng/epic-targets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, targetDate: date || null }) })
      .then(() => { setEdit(null); reload(true) })
  }
  const status = e => [`**${e.key} — ${e.summary}**`, '',
    `- ${e.done}/${e.total} tickets done (${fx(e.pctComplete, 0)}%), ${e.ptsRemaining} pts remaining`,
    `- ${e.daysInFlight != null ? `${e.daysInFlight} working days in flight` : 'not started'}${e.escapedBugs ? `, ${e.escapedBugs} escaped bug(s) so far` : ''}`,
    e.forecastDate ? `- Forecast: **${fdate(e.forecastDate)}** at the current velocity (${e.velocityPtsPerDay} pts/day)` : '- Forecast: no velocity signal yet',
    e.targetDate ? `- Target: ${fdate(e.targetDate)} — ${e.slipDays > 0 ? `**${fx(e.slipDays, 0)} working days late**` : `${fx(Math.abs(e.slipDays || 0), 0)} days of slack`}` : '- Target: not set',
    '', e.url || ''].join('\n')
  const red = epics.filter(e => e.risk === 'red').length

  return <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <H1 kicker="in flight · forecast vs committed date" title="Epic Rollup" right={<span style={{ font: `400 11px ${MONO}`, color: DIM }}>velocity: trailing 8 weeks</span>} />

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
      <Kpi label="Epics in flight" value={String(epics.length)} color={HI} sub="at least one ticket not done" />
      <Kpi label="Forecast late" value={String(red)} color={red ? RED : GREEN} sub="> 5 working days past target" />
      <Kpi label="Points remaining" value={String(epics.reduce((a, e) => a + e.ptsRemaining, 0))} color={BB} sub="across every epic in flight" />
      <Kpi label="Velocity" value={epics[0] ? `${epics[0].velocityPtsPerDay}` : '—'} color={PURPLE} sub="pts per working day, team-wide trailing 8wk" />
    </div>

    {!epics.length ? <Card><Empty text="No parent epics in flight. (Epics come from JIRA's parent field on each ticket.)" /></Card> :
      <DataTable title="Epics" meta="sorted by slip · click a row to open the epic" minWidth={1040} pageSize={10}
        rows={epics} getKey={e => e.key} raw={epics}
        columns={[
          { key: 'key', label: 'Epic', width: '1.9fr', sort: e => e.key, filter: e => e.key + ' ' + e.summary, render: e => <span style={{ display: 'flex', gap: 7, alignItems: 'baseline', minWidth: 0 }}>
            <TicketLink i={{ key: e.key, url: e.url }} style={{ font: `600 11px ${MONO}`, flexShrink: 0 }} />
            <span style={{ font: `400 12px ${BODY}`, color: '#c8bdb4', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.summary}</span></span> },
          { key: 'prog', label: 'Progress', width: '130px', sort: e => e.pctComplete, render: e => <span style={{ display: 'block' }}>
            <span style={{ display: 'block', height: 6, borderRadius: 4, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', width: `${e.pctComplete}%`, background: RISK[e.risk], borderRadius: 4 }} /></span>
            <span style={{ font: `500 9.5px ${MONO}`, color: DIM }}>{e.done}/{e.total} · {fx(e.pctComplete, 0)}%</span></span> },
          { key: 'pts', label: 'Pts left', width: '74px', align: 1, sort: e => e.ptsRemaining, render: e => <span style={{ font: `600 12px ${MONO}`, color: BB }}>{e.ptsRemaining}</span> },
          { key: 'days', label: 'In flight', width: '80px', align: 1, sort: e => e.daysInFlight ?? -1, render: e => <span style={{ font: `500 12px ${MONO}`, color: HI }}>{e.daysInFlight == null ? '—' : fx(e.daysInFlight, 0) + 'd'}</span> },
          { key: 'bugs', label: 'Escaped', width: '76px', align: 1, sort: e => e.escapedBugs, render: e => <span style={{ font: `600 12px ${MONO}`, color: e.escapedBugs ? RED : DIM }}>{e.escapedBugs || '—'}</span> },
          { key: 'fc', label: 'Forecast', width: '90px', align: 1, sort: e => e.forecastDate || '', render: e => <span style={{ font: `600 12px ${MONO}`, color: HI }}>{fdate(e.forecastDate)}</span> },
          { key: 'tgt', label: 'Target', width: '140px', align: 1, sort: e => e.targetDate || '', render: e => edit?.key === e.key
            ? <span style={{ display: 'flex', gap: 4 }} onClick={ev => ev.stopPropagation()}>
              <input type="date" value={edit.date} onChange={ev => setEdit({ key: e.key, date: ev.target.value })} style={{ ...inp, padding: '3px 6px', fontSize: 11, fontFamily: MONO }} />
              <button style={miniBtn} onClick={save}>✓</button></span>
            : <button style={{ ...miniBtn, borderStyle: e.targetManual ? 'solid' : 'dashed', color: e.targetDate ? '#d8cfc7' : DIM }} onClick={ev => { ev.stopPropagation(); setEdit({ key: e.key, date: (e.targetDate || '').slice(0, 10) }) }}>{e.targetDate ? fdate(e.targetDate) : 'set target'}</button> },
          { key: 'slip', label: 'Slip', width: '80px', align: 1, sort: e => e.slipDays ?? -99, render: e => <span style={{ font: `700 12px ${MONO}`, color: RISK[e.risk] }}>{e.slipDays == null ? '—' : `${e.slipDays > 0 ? '+' : ''}${fx(e.slipDays, 0)}d`}</span> },
          { key: 'act', label: '', width: '82px', align: 1, render: e => <button style={miniBtn} onClick={ev => { ev.stopPropagation(); copy(status(e), e.key) }}>{copied === e.key ? '✓' : 'Copy status'}</button> },
        ]} />}
    <div style={{ font: `400 10.5px ${MONO}`, color: DIM }}>Forecast = remaining points ÷ trailing-8-week velocity, in WORKING days. Slip is against the JIRA due date, or the target you set here (persisted to eng-epic-targets.json).</div>
  </section>
}
