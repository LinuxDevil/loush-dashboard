import React, { useState } from 'react'
import { MONO, BODY, ACCENT, MUTE, INK, GREEN, RED, PURPLE, LINE, Badge, LoadingPanel } from './theme.jsx'
import { Card, Btn, Empty, Headline, Stacked } from './charts.jsx'
import { useApi, copy } from './data.jsx'

// item 6 — work-class effort mix, per team, per quarter. Engineer-days from JIRA (activeDays), NOT
// Claude-session buckets: a session is not a unit of work, and nobody has ever taken a headcount
// decision off "deep work %".
const CLS = [
  ['feature', GREEN, 'New feature'],
  ['bug', RED, 'Bug / escaped defect'],
  ['ktlo', '#e3b341', 'KTLO / ops'],
  ['debt', PURPLE, 'Tech debt'],
]
const QUARTERS_SHOWN = 8

export default function EffortMix() {
  const { data, loading, error } = useApi('/api/team/effort')
  const [sel, setSel] = useState(null)   // {team, quarter, cls}

  if (loading && !data) return <LoadingPanel label="Summing engineer-days by work class…" tiles={2} />
  if (error || data?.available === false) return <Card title="Effort mix"><Empty tone={RED}>Effort mix unavailable — {error || data?.error}</Empty></Card>

  const { teams = [], headlines = [], buckets } = data || {}
  const selTeam = sel && teams.find(t => t.team === sel.team)
  const selQ = selTeam && selTeam.quarters.find(q => q.quarter === sel.quarter)
  const selTickets = selQ ? (selQ.tickets?.[sel.cls] || []) : []

  const slide = (t) => {
    const qs = t.quarters.slice(-4)
    const md = [`# ${t.team} — where the quarter went`, '',
      ...headlines.filter(h => h.team === t.team).map(h => h.line), '',
      '| quarter | ' + CLS.map(c => c[0]).join(' | ') + ' | total days |',
      '|---|' + CLS.map(() => '---|').join(''),
      ...qs.map(q => `| ${q.quarter} | ${CLS.map(([k]) => `${Math.round((q.share[k] || 0) * 100)}%`).join(' | ')} | ${q.totalDays} |`),
      '', 'Engineer-days from the JIRA changelog (working-time model: 10:00–18:00 Sun–Thu, Asia/Riyadh).'].join('\n')
    copy(md, 'quarter slide copied as markdown')
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {teams.map(t => {
        const qs = t.quarters.slice(-QUARTERS_SHOWN)
        const h = headlines.find(x => x.team === t.team)
        return (
          <Card key={t.team} title={`Effort mix — ${t.team}`} sub={`engineer-days by work class · last ${qs.length} quarters`}
            json={t} right={<Btn onClick={() => slide(t)}>⧉ export quarter slide</Btn>}>
            {h && (
              <Headline tone={h.bugTaxPct >= 35 ? RED : INK} icon={h.bugTaxPct >= 35 ? '⚠' : null}>
                {h.line}{h.deltaPct != null && <span style={{ color: h.deltaPct > 0 ? RED : GREEN, font: `600 14px ${MONO}` }}> ({h.deltaPct > 0 ? '+' : ''}{h.deltaPct} pts vs prior quarter)</span>}
              </Headline>
            )}
            <div style={{ marginTop: 14 }}>
              {qs.map(q => (
                <div key={q.quarter} style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 9 }}>
                  <div style={{ width: 60, font: `500 11px ${MONO}`, color: q === qs[qs.length - 1] ? INK : MUTE }}>{q.quarter}</div>
                  <div style={{ flex: 1, display: 'flex', height: 14, borderRadius: 4, overflow: 'hidden', background: LINE }}>
                    {CLS.map(([k, color, label]) => (q.share[k] > 0) && (
                      <div key={k} title={`${label}: ${Math.round(q.share[k] * 100)}% · ${q.days[k]}d · click for the tickets`}
                        onClick={() => setSel({ team: t.team, quarter: q.quarter, cls: k })}
                        style={{ width: `${q.share[k] * 100}%`, background: color, cursor: 'pointer' }} />
                    ))}
                  </div>
                  <div style={{ width: 96, textAlign: 'right', font: `400 11px ${MONO}`, color: MUTE }}>{q.totalDays}d</div>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8, font: `400 11px ${MONO}`, color: MUTE }}>
                {CLS.map(([k, color, label]) => <span key={k}><span style={{ color }}>●</span> {label}</span>)}
                <span style={{ color: MUTE }}>· click a band for the tickets behind it</span>
              </div>
            </div>
          </Card>
        )
      })}

      {sel && (
        <Card title={`${sel.team} · ${sel.quarter} · ${CLS.find(c => c[0] === sel.cls)?.[2]}`}
          sub={`${selTickets.length} tickets, sorted by engineer-days — so you can see which one ate a sprint`}
          json={selTickets}
          right={<Btn tone={MUTE} onClick={() => setSel(null)}>✕ close</Btn>}>
          {!selTickets.length ? <Empty>No tickets in that class for that quarter.</Empty> : selTickets.map(t => (
            <div key={t.key} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '5px 0', borderTop: `1px solid ${LINE}` }}>
              <a href={t.url} target="_blank" rel="noreferrer" style={{ font: `600 11.5px ${MONO}`, color: ACCENT, textDecoration: 'none', width: 92 }}>{t.key}</a>
              <span style={{ flex: 1, font: `400 12px ${BODY}`, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.summary}</span>
              <span style={{ font: `500 11px ${MONO}`, color: (t.activeDays || 0) > 10 ? RED : MUTE }}>{t.activeDays}d</span>
            </div>
          ))}
        </Card>
      )}

      <div style={{ font: `400 10.5px ${BODY}`, color: MUTE }}>
        Classes come from JIRA issuetype + labels via the <code style={{ font: `400 10.5px ${MONO}` }}>effortBuckets</code> map in projects.json
        {buckets ? ` (bug: ${buckets.bug.types.join('/')} · ktlo: ${buckets.ktlo.labels.join('/')} · debt: ${buckets.debt.labels.join('/')})` : ''}.
        Anything unmatched is counted as feature — so "feature" is a ceiling, not a floor.
      </div>
    </div>
  )
}
