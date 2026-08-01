import React from 'react'
import { HEAD, BODY, MONO, BB, GREEN, GOLD, RED, PURPLE, DIM, HI, Card, CardHead, Empty, H1, DataTable, Kpi, miniBtn, useCopy, fdate, fx } from './ui.jsx'
import { Lines } from './charts.jsx'
import { pctl } from './stats.js'

const light = v => (v == null ? DIM : v >= 85 ? GREEN : v >= 70 ? GOLD : RED)

export default function Predictability({ snap, onOpenTicket }) {
  const [copy, copied] = useCopy()
  const sprints = [...(snap.sprints || [])].reverse()
  const cur = sprints[sprints.length - 1]
  const sayDo = sprints.map(s => s.sayDoPct).filter(v => v != null)
  const avg6 = sayDo.length ? Math.round(pctl(sayDo, 0.5)) : null
  const cap = v => (v == null ? null : Math.min(v, 200))
  const inj = sprints.map(s => s.injectionPct).filter(v => v != null)
  const injMed = pctl(inj, 0.5)
  const summary = s => [`## ${s.name}`, '',
    `- Committed: ${s.committed} tickets / ${s.committedPts} pts`,
    `- Added mid-sprint: ${s.added} / ${s.addedPts} pts (${fx(s.injectionPct, 0)}% injection)`,
    `- Delivered: ${s.delivered} / ${s.deliveredPts} pts`,
    `- Carried over: ${s.carriedOver} / ${s.carriedOverPts} pts`,
    `- Say/do: **${fx(s.sayDoPct, 0)}%** (delivered ÷ committed points)`, '',
    s.keys?.carriedOver?.length ? `Carried over: ${s.keys.carriedOver.join(', ')}` : ''].join('\n')

  return <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <H1 kicker="committed vs delivered · last 6 sprints" title="Sprint Predictability" right={cur && <button style={miniBtn} onClick={() => copy(summary(cur), 'sum')}>{copied === 'sum' ? '✓ copied' : 'Copy sprint summary'}</button>} />

    {!sprints.length ? <Card><Empty text="No sprints with a start date in the changelog." /></Card> : <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
        <Kpi label="Predictability" value={cur?.sayDoPct == null ? '—' : fx(cur.sayDoPct, 0) + '%'} color={light(cur?.sayDoPct)} sub={`delivered ÷ committed points · ${cur?.name || ''}`} n={cur?.committed} />
        <Kpi label="6-sprint say/do" value={avg6 == null ? '—' : avg6 + '%'} color={light(avg6)} sub="MEDIAN of the last 6 — the number the EM is accountable for upward" n={sayDo.length} />
        <Kpi label="Injection" value={cur?.injectionPct == null ? '—' : fx(cur.injectionPct, 0) + '%'} color={(cur?.injectionPct || 0) > 25 ? RED : (cur?.injectionPct || 0) > 15 ? GOLD : GREEN}
          sub={`points added AFTER sprint start · median ${fx(injMed, 0)}%`} />
        <Kpi label="Carried over" value={cur ? `${cur.carriedOver}` : '—'} color={cur?.carriedOver ? GOLD : GREEN} sub={`${fx(cur?.carriedOverPts, 0)} pts rolled into the next sprint`} />
      </div>

      <Card>
        <CardHead title="Say/do & injection trend" meta="did engineering miss, or did we keep adding scope? · clamped at 200%" />
        <Lines labels={sprints.map(s => (s.name || '').replace(/^.*?(W?\d+Y?\d*)$/, '$1') || '?')} yFmt={v => v + '%'} threshold={{ at: 85, label: '85% target', color: GREEN }}
          series={[
            { label: 'say/do', color: BB, values: sprints.map(s => ({ y: cap(s.sayDoPct), note: `${s.deliveredPts}/${s.committedPts} pts${s.sayDoPct > 200 ? ` (${fx(s.sayDoPct, 0)}% — clamped)` : ''}` })) },
            { label: 'injection', color: RED, values: sprints.map(s => ({ y: cap(s.injectionPct), note: `${s.addedPts} pts added` })) },
          ]} />
        <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
          <span style={{ font: `400 11px ${BODY}`, color: BB }}>● say/do — delivered ÷ committed at start</span>
          <span style={{ font: `400 11px ${BODY}`, color: RED }}>● injection — points added after start ÷ committed</span>
        </div>
      </Card>

      <DataTable title="Sprints" meta="committed at start · added after start · delivered before end · carried over" minWidth={900} pageSize={6}
        rows={[...sprints].reverse()} getKey={s => s.name} raw={snap.sprints}
        columns={[
          { key: 'name', label: 'Sprint', width: '1.6fr', sort: s => s.startDate || '', filter: s => s.name, render: s => <span style={{ minWidth: 0 }}>
            <span style={{ font: `600 12px ${BODY}`, color: HI, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{s.name}</span>
            <span style={{ font: `400 10px ${MONO}`, color: DIM }}>{fdate(s.startDate)} → {fdate(s.completeDate || s.endDate)}{/active/i.test(s.state || '') ? ' · active' : ''}</span></span> },
          { key: 'com', label: 'Committed', width: '92px', align: 1, sort: s => s.committedPts, render: s => <span style={{ font: `600 12px ${MONO}`, color: HI }}>{s.committedPts}<span style={{ color: DIM, fontSize: 10 }}>/{s.committed}</span></span> },
          { key: 'add', label: 'Added', width: '86px', align: 1, sort: s => s.addedPts, render: s => <span style={{ font: `600 12px ${MONO}`, color: s.addedPts ? RED : DIM }}>{s.addedPts ? '+' + s.addedPts : '—'}</span> },
          { key: 'del', label: 'Delivered', width: '92px', align: 1, sort: s => s.deliveredPts, render: s => <span style={{ font: `600 12px ${MONO}`, color: GREEN }}>{s.deliveredPts}<span style={{ color: DIM, fontSize: 10 }}>/{s.delivered}</span></span> },
          { key: 'car', label: 'Carried', width: '84px', align: 1, sort: s => s.carriedOverPts, render: s => <span style={{ font: `600 12px ${MONO}`, color: s.carriedOverPts ? GOLD : DIM }}>{s.carriedOverPts || '—'}</span> },
          { key: 'inj', label: 'Injection', width: '84px', align: 1, sort: s => s.injectionPct ?? -1, render: s => <span style={{ font: `600 12px ${MONO}`, color: (s.injectionPct || 0) > 25 ? RED : HI }}>{fx(s.injectionPct, 0)}%</span> },
          { key: 'sd', label: 'Say/do', width: '96px', align: 1, sort: s => s.sayDoPct ?? -1, render: s => <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: light(s.sayDoPct) }} />
            <span style={{ font: `700 12px ${MONO}`, color: light(s.sayDoPct) }}>{fx(s.sayDoPct, 0)}%</span></span> },
          { key: 'act', label: '', width: '78px', align: 1, render: s => <button style={miniBtn} onClick={e => { e.stopPropagation(); copy(summary(s), s.name) }}>{copied === s.name ? '✓' : 'Copy'}</button> },
        ]} />
    </>}
  </section>
}
