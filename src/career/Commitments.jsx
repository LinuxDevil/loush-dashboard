import React, { useState } from 'react'
import { MONO, BODY, ACCENT, MUTE, INK, GREEN, RED, PURPLE, LINE, Badge, MiniTable, LoadingPanel } from './theme.jsx'
import { Card, Btn, Empty, Headline } from './charts.jsx'
import { useApi, copy } from './data.jsx'

// item 7 — sprint predictability, epic forecast, scope ledger. All three come out of ONE changelog
// replay that server-eng.mjs already runs; nothing is recomputed here.
export default function Commitments() {
  const { data, loading, error } = useApi('/api/team/commitments')
  const [tab, setTab] = useState('all')

  if (loading && !data) return <LoadingPanel label="Replaying the sprint changelog…" tiles={3} />
  if (error || data?.available === false) return <Card title="Commitments"><Empty tone={RED}>Commitments unavailable — {error || data?.error}</Empty></Card>

  const { predictability = [], forecasts = [], ledger = [], ledgerPartial, source, note } = data || {}

  const vpSummary = () => copy([
    '# Delivery predictability', '',
    ...predictability.map(p => `- ${p.line}`), '',
    '## Epics at risk',
    ...forecasts.filter(f => f.slipDays > 0 || f.risk === 'red').slice(0, 5).map(f => `- ${f.stakeholderUpdate}`),
    '', `Source: ${source || 'sprint changelog'}.`,
  ].join('\n'), 'VP summary copied')

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* PREDICTABILITY */}
      <Card title="Sprint predictability — committed vs delivered"
        sub="say/do per sprint · unpredictable-but-average is still unpredictable"
        json={predictability} right={<Btn onClick={vpSummary}>⧉ copy VP summary</Btn>}>
        {!predictability.length ? <Empty>No sprint history in the snapshot.</Empty> : predictability.map(p => (
          <div key={p.team} style={{ borderTop: `1px solid ${LINE}`, padding: '10px 0' }}>
            <Headline tone={p.red ? RED : INK} icon={p.red ? '⚠' : null}>{p.line}</Headline>
            <div style={{ marginTop: 10 }}>
              {(p.sprints || []).map(s => {
                // the bar is a composition of the three things that actually happened to the sprint's
                // tickets, so the denominator is their sum — not "committed", which a scope-injected
                // sprint blows straight past (and which would silently clip the overflow off the bar).
                const denom = Math.max(1, (s.delivered || 0) + (s.carriedOver || 0) + (s.added || 0))
                return (
                  <div key={s.sprint} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 7, flexWrap: 'wrap' }}>
                    <div style={{ width: 110, font: `500 11px ${MONO}`, color: s.state === 'active' ? ACCENT : MUTE }}>{s.sprint}</div>
                    <div style={{ flex: 1, minWidth: 180, display: 'flex', height: 12, borderRadius: 4, overflow: 'hidden', background: LINE }}>
                      <div title={`delivered ${s.delivered}`} style={{ width: `${(s.delivered || 0) / denom * 100}%`, background: GREEN }} />
                      <div title={`carried over ${s.carriedOver}`} style={{ width: `${(s.carriedOver || 0) / denom * 100}%`, background: '#e3b341' }} />
                      <div title={`added mid-sprint ${s.added}`} style={{ width: `${(s.added || 0) / denom * 100}%`, background: PURPLE }} />
                    </div>
                    <span style={{ font: `400 11px ${MONO}`, color: MUTE, whiteSpace: 'nowrap' }}>
                      {s.committed} committed · <span style={{ color: GREEN }}>{s.delivered} done</span> · <span style={{ color: '#e3b341' }}>{s.carriedOver} carried</span> · <span style={{ color: PURPLE }}>+{s.added} injected</span>
                    </span>
                    <span style={{ width: 90, textAlign: 'right', font: `600 11px ${MONO}`, color: (s.sayDoPct ?? 0) < 60 ? RED : GREEN }}>{s.sayDoPct == null ? '—' : `${Math.round(s.sayDoPct)}% say/do`}</span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
        <div style={{ font: `400 10.5px ${BODY}`, color: MUTE, marginTop: 8 }}>
          <span style={{ color: GREEN }}>▬</span> delivered · <span style={{ color: '#e3b341' }}>▬</span> carried over · <span style={{ color: PURPLE }}>▬</span> added after the sprint started.
          A sprint whose say/do is over 100% took on work it never committed to.
        </div>
      </Card>

      {/* EPIC FORECAST */}
      <Card title="Epic forecast — committed date vs the arithmetic"
        sub={`${forecasts.length} epics in flight · forecast = remaining points ÷ trailing velocity`} json={forecasts}>
        <MiniTable
          columns={[
            { key: 'key', label: 'epic', render: f => <a href={f.url} target="_blank" rel="noreferrer" style={{ font: `600 11.5px ${MONO}`, color: ACCENT, textDecoration: 'none' }}>{f.key}</a> },
            { key: 'summary', label: 'summary', width: 240, render: f => <span style={{ color: INK }}>{f.summary}</span> },
            { key: 'team', label: 'team', render: f => <Badge>{f.team}</Badge> },
            { key: 'pctComplete', label: '% done', align: 'right', render: f => `${Math.round(f.pctComplete ?? 0)}%` },
            { key: 'forecastDate', label: 'forecast', align: 'right', render: f => f.forecastDate ? String(f.forecastDate).slice(0, 10) : <span style={{ color: RED }}>not moving</span> },
            { key: 'targetDate', label: 'committed', align: 'right', render: f => f.targetDate ? String(f.targetDate).slice(0, 10) : <span style={{ color: MUTE }} title="no duedate on the epic in JIRA">—</span> },
            { key: 'slipDays', label: 'slip', align: 'right', render: f => f.slipDays == null ? <span style={{ color: MUTE }}>—</span> : <span style={{ color: f.slipDays > 0 ? RED : GREEN }}>{f.slipDays > 0 ? '+' : ''}{f.slipDays}d</span> },
            { key: 'risk', label: 'risk', render: f => <Badge tone={f.risk === 'red' ? 'red' : f.risk === 'amber' ? 'purple' : f.risk === 'green' ? 'green' : 'mute'}>{f.risk || 'unknown'}</Badge> },
            { key: 'copy', label: '', render: f => <Btn onClick={() => copy(f.stakeholderUpdate, 'stakeholder update copied')}>⧉</Btn> },
          ]}
          rows={forecasts} empty="no epics with open children" maxHeight={460} />
        <div style={{ font: `400 10.5px ${BODY}`, color: MUTE, marginTop: 8 }}>
          "committed" is the epic's JIRA <code style={{ font: `400 10.5px ${MONO}` }}>duedate</code>. Where it is —, nobody ever wrote a date down; the forecast is then a fact without a promise to compare it to.
        </div>
      </Card>

      {/* SCOPE LEDGER */}
      <Card title="Scope ledger — every commitment-affecting event"
        sub={`${ledger.length} events · newest first`} json={ledger}>
        {ledgerPartial && note ? <div style={{ font: `400 11px ${BODY}`, color: PURPLE, marginBottom: 10 }}>⚠ partial: {note}</div> : null}
        {!ledger.length ? <Empty>Nothing moved in or out of a commitment in the window.</Empty> : (
          <MiniTable
            columns={[
              { key: 'at', label: 'when', render: l => <span style={{ font: `400 11px ${MONO}`, color: MUTE }}>{l.at ? String(l.at).slice(0, 10) : '—'}</span> },
              { key: 'key', label: 'ticket', render: l => l.url ? <a href={l.url} target="_blank" rel="noreferrer" style={{ font: `600 11.5px ${MONO}`, color: ACCENT, textDecoration: 'none' }}>{l.key}</a> : <span style={{ font: `600 11.5px ${MONO}`, color: INK }}>{l.key}</span> },
              { key: 'team', label: 'team', render: l => <Badge>{l.team}</Badge> },
              { key: 'event', label: 'event', width: 260, render: l => <span style={{ color: /reopen|rework|QA bounced/.test(l.event) ? RED : INK }}>{l.event}</span> },
              { key: 'delta', label: 'delta', render: l => <span style={{ font: `400 11px ${MONO}`, color: MUTE }}>{l.delta}</span> },
            ]}
            // a ticket can legitimately appear twice (added to one sprint, carried out of another),
            // so the row identity is the EVENT, not the ticket
            rows={ledger.map((l, i) => ({ ...l, id: `${l.key}§${l.event}§${l.at}§${i}` }))} maxHeight={420} />
        )}
      </Card>
    </div>
  )
}
