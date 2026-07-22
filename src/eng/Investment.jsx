import React, { useState } from 'react'
import { HEAD, BODY, MONO, BB, GREEN, GOLD, RED, PURPLE, STEEL, DIM, HI, Card, CardHead, Empty, H1, DataTable, TicketLink, Kpi, miniBtn, useCopy, fx } from './ui.jsx'
import { StackedCols } from './charts.jsx'

// §7 — where the engineering days actually went. This is where the demoted "Story points" KPI goes to
// live a useful life: with a denominator. Headline the VP reacts to: "Bug tax: 23% of delivered points
// this quarter (was 15%)". Bucket rules come from projects.json `effortBuckets` (server-side).
const LABEL = { feature: 'Feature', 'bug-escaped': 'Bug (escaped)', 'bug-qa': 'Bug (QA-caught)', toil: 'Tech-debt / toil', ai: 'AI experimentation' }
const COLOR = { feature: BB, 'bug-escaped': RED, 'bug-qa': GOLD, toil: STEEL, ai: PURPLE }

export default function Investment({ snap, issues, onOpenTicket }) {
  const [copy, copied] = useCopy()
  const [unit, setUnit] = useState('pts')   // points, or summed activeDays — both are in the payload
  const [pick, setPick] = useState(null)    // {month, bucket}
  const I = snap.investment || { months: [], buckets: [] }
  const months = I.months || []
  const keys = I.buckets || []
  const cur = months[months.length - 1]
  const tax = I.bugTaxPct, prev = I.bugTaxPrevPct
  const up = tax != null && prev != null && tax > prev
  const val = (m, k) => (unit === 'pts' ? m.buckets[k]?.pts : m.buckets[k]?.days) || 0
  const rows = pick ? issues.filter(i => i.live && i.liveAt && i.liveAt.slice(0, 7) === pick.month) : []
  const reworkShare = cur && cur[unit === 'pts' ? 'pts' : 'days'] ? +(cur[unit === 'pts' ? 'reworkPts' : 'reworkDays'] / cur[unit === 'pts' ? 'pts' : 'days'] * 100).toFixed(0) : null
  const md = () => ['## Investment mix', '', `| Month | ${keys.map(k => LABEL[k]).join(' | ')} | Total |`, `|---|${keys.map(() => '---:').join('|')}|---:|`,
    ...months.map(m => `| ${m.month} | ${keys.map(k => fx(val(m, k))).join(' | ')} | ${fx(unit === 'pts' ? m.pts : m.days)} |`),
    '', `Bug tax (bugs + toil as a share of delivered points): **${fx(tax, 0)}%** this month, ${fx(prev, 0)}% last.`,
    `Rework — work we paid for twice: ${cur ? fx(cur.reworkPts) : '—'} pts.`].join('\n')

  return <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <H1 kicker="where the engineering days actually went" title="Investment Mix" right={<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <div style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 9, background: 'rgba(13,11,10,0.6)' }}>
        {[['pts', 'Story points'], ['days', 'Active days']].map(([v, l]) => <button key={v} onClick={() => setUnit(v)} style={{ padding: '6px 12px', border: 'none', borderRadius: 7, cursor: 'pointer', font: `600 12px ${BODY}`, background: unit === v ? 'rgba(255,255,255,0.2)' : 'transparent', color: unit === v ? '#f0e7e0' : '#8a807a' }}>{l}</button>)}
      </div>
      <button style={miniBtn} onClick={() => copy(md(), 'md')}>{copied === 'md' ? '✓ copied' : 'Copy as markdown'}</button>
    </div>} />

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
      <Kpi label="Bug tax" value={tax == null ? '—' : fx(tax, 0) + '%'} color={tax == null ? DIM : tax > 30 ? RED : tax > 20 ? GOLD : GREEN}
        sub={`bugs + toil as a share of delivered points${prev != null ? ` · was ${fx(prev, 0)}%` : ''}`} delta={tax != null && prev != null ? { txt: `${up ? '+' : ''}${fx(tax - prev, 0)}pp`, good: !up } : null} />
      <Kpi label="Delivered" value={cur ? fx(unit === 'pts' ? cur.pts : cur.days, 0) : '—'} color={HI} sub={unit === 'pts' ? 'story points, latest month' : 'active working days, latest month'} />
      <Kpi label="Rework" value={cur ? fx(unit === 'pts' ? cur.reworkPts : cur.reworkDays, 0) : '—'} color={GOLD} sub={`work we paid for twice${reworkShare != null ? ` · ${reworkShare}% of the month` : ''}`} />
      <Kpi label="Capacity risk" value={tax != null && tax > 35 ? 'FLAG' : 'ok'} color={tax != null && tax > 35 ? RED : GREEN} sub="bugs + toil > 35% of delivery" />
    </div>

    <Card>
      <CardHead title="6-month mix" meta={`100% stacked · ${unit === 'pts' ? 'delivered story points' : 'summed active working days'} · click a band for the tickets`} />
      {!months.length ? <Empty text="Nothing delivered yet in the last 6 months." /> : <>
        <StackedCols rows={months} keys={keys} colors={keys.map(k => COLOR[k])} labels={months.map(m => m.month.slice(2))} valueOf={val} onPick={(m, k) => setPick({ month: m.month, bucket: k })} />
        <div style={{ display: 'flex', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
          {keys.map(k => <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, font: `400 11px ${BODY}`, color: '#a89f97' }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: COLOR[k] }} />{LABEL[k]}
            <b style={{ color: HI, fontWeight: 600 }}>{cur ? fx(val(cur, k), 0) : '—'}</b></span>)}
        </div>
      </>}
    </Card>

    {pick && <DataTable title={`${LABEL[pick.bucket]} · ${pick.month}`} meta="everything delivered that month — the ticket list behind the slice" minWidth={640} pageSize={8}
      rows={rows} getKey={r => r.key} onRowClick={r => onOpenTicket(r.key)} raw={rows}
      right={<button style={miniBtn} onClick={() => setPick(null)}>close</button>}
      columns={[
        { key: 'key', label: 'Ticket', width: '92px', sort: r => r.key, filter: r => r.key + ' ' + r.summary, render: r => <TicketLink i={r} style={{ font: `500 12px ${MONO}` }} /> },
        { key: 'type', label: 'Type', width: '92px', sort: r => r.type, render: r => <span style={{ font: `500 11px ${BODY}`, color: r.isBug ? RED : '#a89f97' }}>{r.type}</span> },
        { key: 'summary', label: 'Summary', width: '2fr', sort: r => r.summary, render: r => <span style={{ font: `400 12px ${BODY}`, color: '#c8bdb4', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{r.summary}</span> },
        { key: 'pts', label: 'Pts', width: '56px', align: 1, sort: r => r.pts, render: r => <span style={{ font: `600 12px ${MONO}`, color: BB }}>{r.pts}</span> },
        { key: 'days', label: 'Active', width: '68px', align: 1, sort: r => r.activeDays, render: r => <span style={{ font: `500 12px ${MONO}`, color: HI }}>{fx(r.activeDays)}d</span> },
      ]} />}

    <div style={{ font: `400 10.5px ${MONO}`, color: DIM }}>Bucket rules (projects.json → effortBuckets): {Object.entries(I.rules || {}).map(([b, r]) => `${b}: ${[...(r.types || []), ...(r.labels || [])].join('/')}`).join(' · ')}</div>
  </section>
}
