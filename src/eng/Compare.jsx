import React, { useMemo } from 'react'
import { HEAD, BODY, MONO, BB, GREEN, GOLD, RED, PURPLE, DIM, HI, Card, Empty, H1, DataTable, miniBtn, useCopy, fx } from './ui.jsx'
import { Spark } from './charts.jsx'
import { of, pos, MIN_N } from './stats.js'
import { shippedIn, prevWindow } from './TimeLens.jsx'

// §9 — when project = "all", render a ROW PER PROJECT instead of one merged blob. The EM manages 3-4 teams
// and today physically cannot answer "which team needs me this Monday" without opening the dashboard four
// times and diffing screenshots by eye. snapshotAll() keeps the boundaries now (byProject); we just draw them.
const worst = (rows, f, inv = true) => {
  const vals = rows.map(f).filter(v => v != null)
  if (!vals.length) return null
  return inv ? Math.max(...vals) : Math.min(...vals)
}
export default function Compare({ snap, win, onProject }) {
  const [copy, copied] = useCopy()
  const prev = prevWindow(win)
  const rows = useMemo(() => (snap.byProject || []).map(p => {
    const shipped = p.issues.filter(i => shippedIn(win, i))
    const shippedPrev = p.issues.filter(i => shippedIn(prev, i))
    const cyc = of(shipped, i => pos(i.delivery))
    const cycPrev = of(shippedPrev, i => pos(i.delivery))
    const bugs = p.issues.filter(i => i.isBug && !i.live)
    const escaped = p.issues.filter(i => i.isBug && i.escaped && shippedIn(win, i)).length
    const rev = of(p.prs.filter(x => x.firstReviewFromRequestDays != null), x => x.firstReviewFromRequestDays)
    const atRisk = (snap.triage || []).filter(t => t.project === p.key).length
    // 6-month cycle-time p50 sparkline
    const spark = []
    for (let k = 5; k >= 0; k--) {
      const d = new Date(); d.setMonth(d.getMonth() - k)
      const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const set = p.issues.filter(i => i.live && i.liveAt && i.liveAt.slice(0, 7) === m)
      spark.push(set.length ? of(set, i => pos(i.delivery)).p50 : null)
    }
    return {
      key: p.key, name: p.name, cyc, cycPrev, spark, atRisk, escaped,
      throughput: shipped.length, wip: p.issues.filter(i => i.active).length, bugs: bugs.length,
      revP90: rev.p90, revN: rev.n,
      escapeRate: shipped.length ? +(escaped / shipped.length * 100).toFixed(1) : null,
      delta: cyc.p50 != null && cycPrev.p50 != null ? +(cyc.p50 - cycPrev.p50).toFixed(1) : null,
    }
  }), [snap, win])
  const wCyc = worst(rows, r => r.cyc.p90), wRev = worst(rows, r => r.revP90), wRisk = worst(rows, r => r.atRisk), wEsc = worst(rows, r => r.escapeRate)
  const tint = (v, w) => (v != null && w != null && v === w && rows.length > 1 ? { background: 'rgba(242,119,122,0.10)', borderRadius: 5, padding: '2px 5px' } : {})
  const md = () => ['## Project comparison — ' + win.label, '', '| Project | Cycle p50 | Cycle p90 | Shipped | WIP | Open bugs | Escape % | Review p90 | At risk |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...rows.map(r => `| ${r.name} | ${fx(r.cyc.p50)}d | ${fx(r.cyc.p90)}d | ${r.throughput} | ${r.wip} | ${r.bugs} | ${fx(r.escapeRate, 0)}% | ${fx(r.revP90)}d | ${r.atRisk} |`)].join('\n')

  if ((snap.byProject || []).length < 2) return <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <H1 kicker="row per project" title="Project Comparison" />
    <Card><Empty text="Only one project is configured. Add a second project (or pick “All projects”) and this table compares them side by side." /></Card>
  </section>

  return <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <H1 kicker={`row per project · ${win.label}`} title="Project Comparison" right={<button style={miniBtn} onClick={() => copy(md(), 'md')}>{copied === 'md' ? '✓ copied' : 'Copy as markdown'}</button>} />
    <DataTable title="Which team needs me this Monday" meta="worst cell in each column tinted · click a row to drill in" minWidth={1020} pageSize={10}
      rows={rows} getKey={r => r.key} onRowClick={r => onProject(r.key)} initialSort={{ key: 'risk', dir: -1 }} raw={rows}
      columns={[
        { key: 'name', label: 'Project', width: '1.5fr', sort: r => r.name, filter: r => r.name + r.key, render: r => <span>
          <span style={{ font: `600 12.5px ${BODY}`, color: HI }}>{r.name}</span> <span style={{ font: `500 9px ${MONO}`, color: DIM }}>{r.key}</span></span> },
        { key: 'p50', label: 'Cycle p50', width: '92px', align: 1, sort: r => r.cyc.p50 ?? 1e9, render: r => <span style={{ font: `600 12px ${MONO}`, color: r.cyc.n < MIN_N ? '#8a807a' : HI }}>{fx(r.cyc.p50)}d</span> },
        { key: 'p90', label: 'Cycle p90', width: '92px', align: 1, sort: r => r.cyc.p90 ?? 1e9, render: r => <span style={{ font: `700 12px ${MONO}`, color: r.cyc.n < MIN_N ? '#8a807a' : RED, ...tint(r.cyc.p90, wCyc) }}>{fx(r.cyc.p90)}d</span> },
        { key: 'trend', label: '6mo', width: '76px', align: 1, render: r => <span style={{ display: 'inline-block' }}><Spark values={r.spark} color={BB} /></span> },
        { key: 'thru', label: 'Shipped', width: '78px', align: 1, sort: r => r.throughput, render: r => <span style={{ font: `600 12px ${MONO}`, color: HI }}>{r.throughput}<span style={{ font: `500 9px ${MONO}`, color: r.delta == null ? DIM : r.delta <= 0 ? GREEN : RED }}>{r.delta == null ? '' : ` ${r.delta > 0 ? '+' : ''}${r.delta}d`}</span></span> },
        { key: 'wip', label: 'WIP', width: '58px', align: 1, sort: r => r.wip, render: r => <span style={{ font: `600 12px ${MONO}`, color: BB }}>{r.wip}</span> },
        { key: 'bugs', label: 'Open bugs', width: '86px', align: 1, sort: r => r.bugs, render: r => <span style={{ font: `600 12px ${MONO}`, color: r.bugs ? GOLD : DIM }}>{r.bugs}</span> },
        { key: 'esc', label: 'Escape %', width: '86px', align: 1, sort: r => r.escapeRate ?? -1, render: r => <span style={{ font: `600 12px ${MONO}`, color: RED, ...tint(r.escapeRate, wEsc) }}>{fx(r.escapeRate, 0)}%</span> },
        { key: 'rev', label: 'Review p90', width: '96px', align: 1, sort: r => r.revP90 ?? 1e9, render: r => <span style={{ font: `600 12px ${MONO}`, color: r.revN < MIN_N ? '#8a807a' : PURPLE, ...tint(r.revP90, wRev) }}>{fx(r.revP90)}d</span> },
        { key: 'risk', label: 'At risk', width: '76px', align: 1, sort: r => r.atRisk, render: r => <span style={{ font: `700 13px ${MONO}`, color: r.atRisk ? RED : GREEN, ...tint(r.atRisk, wRisk) }}>{r.atRisk}</span> },
      ]} />
    <div style={{ font: `400 10.5px ${MONO}`, color: DIM }}>Cycle = first In Progress → Live, working days. "At risk" = triage records for that project. n&lt;5 greyed — a p90 over four tickets is an anecdote.</div>
  </section>
}
