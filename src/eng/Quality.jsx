import React, { useState } from 'react'
import { HEAD, BODY, MONO, BB, GREEN, GOLD, RED, PURPLE, DIM, HI, PANEL, Card, CardHead, Empty, H1, DataTable, TicketLink, Kpi, sel, miniBtn, useCopy, fdate, fx } from './ui.jsx'
import { Lines } from './charts.jsx'

// §5 — Quality REPLACES the per-person blame surface. What was here before: "Bug ratio — caused/tickets",
// "Bugs owned — he caused", and an owner→fixer gossip board, all built on guessed attribution (fixer =
// whoever happened to drag the card to QA-ready, which is routinely QA). All four personas cut them.
// Bug LOAD by area is a capacity and hardening argument. Bug ratio by person teaches people to stop
// linking bugs to their parent story, which destroys the very data the panel is built on.
// The bug register survives — it is how you route a fix — relabelled, with every ratio removed.
export default function Quality({ snap, issues, members, patch, reload }) {
  const [copy, copied] = useCopy()
  const [saving, setSaving] = useState(null)
  const [pinned, setPinned] = useState(null)
  const Q = snap.quality || { escapeRate: [], hotspots: [], ownership: [], totals: {} }
  const T = Q.totals || {}
  const er = Q.escapeRate.slice(-8)
  const devIds = new Set(members.map(m => m.id))
  const teamBug = i => i.isBug && i.qaReported && i.assigneeTeam
  const bugs0 = issues.filter(teamBug)
  const bugs = pinned ? bugs0.filter(b => (Q.hotspots.find(h => h.area === pinned)?.keys || []).includes(b.key)) : bugs0
  const setOwn = (key, field, value) => {
    const b = issues.find(i => i.key === key)
    const person = value ? { id: value, name: members.find(m => m.id === value)?.name || 'Assigned' } : null
    const fields = field === 'ownerId'
      ? (value ? { owner: person, ownerId: value, ownerManual: true } : (() => { const auto = (b.linkedKey && issues.find(x => x.key === b.linkedKey)?.assignee) || b.assignee || null; return { owner: auto, ownerId: auto?.id || null, ownerManual: false } })())
      : (value ? { fixer: person, fixerId: value, fixerManual: true } : { fixer: null, fixerId: null, fixerManual: false })
    patch(key, fields)
    setSaving(key + field)
    fetch('/api/eng/bug-ownership', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, [field]: value || null }) })
      .catch(() => reload()).finally(() => setSaving(null))
  }
  const ownSel = (b, field) => {
    const id = field === 'ownerId' ? b.ownerId : b.fixerId
    const manual = field === 'ownerId' ? b.ownerManual : b.fixerManual
    return <select value={devIds.has(id) ? id : ''} disabled={saving === b.key + field} onChange={e => { e.stopPropagation(); setOwn(b.key, field, e.target.value) }} onClick={e => e.stopPropagation()}
      style={{ ...sel, padding: '4px 7px', font: `500 11px ${BODY}`, maxWidth: 132, border: `1px solid ${manual ? 'var(--green-bg)' : 'var(--bg-surface-active)'}` }}>
      <option value="">— unset —</option>
      {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
      {id && !devIds.has(id) && <option value={id}>(non-dev — keep)</option>}
    </select>
  }
  const hardening = h => `## Hardening: ${h.area}\n\n${h.bugs} bug${h.bugs === 1 ? '' : 's'} (${h.escaped} escaped to production) against ${h.shipped} shipped tickets touching this area — ${h.bugsPerShipped ?? '—'} bugs per shipped ticket.\n\nBugs:\n${(h.keys || []).map(k => `- ${k}`).join('\n')}\n\nProposed: harden \`${h.area}\` — add regression coverage and review the top failure paths before the next feature lands here.`
  const curRate = er.length ? er[er.length - 1].rate : null

  return <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <H1 kicker="escape rate · hotspots · ownership" title="Quality" right={<span style={{ font: `400 11px ${MONO}`, color: DIM }}>rolling 12 months · server window</span>} />

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
      <Kpi label="Escape rate" value={curRate == null ? '—' : fx(curRate, 0) + '%'} color={curRate == null ? DIM : curRate > 20 ? RED : curRate > 10 ? GOLD : GREEN}
        sub="bugs filed AFTER their parent went live ÷ tickets shipped that month" n={er.length ? er[er.length - 1].shipped : 0} />
      <Kpi label="Escaped bugs" value={String(T.escaped ?? 0)} color={RED} sub="reached production" />
      <Kpi label="Caught in flight" value={String(T.qaCaught ?? 0)} color={GREEN} sub="QA found it before release" />
      <Kpi label="Reworked tickets" value={String(T.reopens ?? 0)} color={GOLD} sub="re-entered In Progress / Reopen" />
    </div>

    <Card>
      <CardHead title="Escape rate by month" meta="the guardrail on every “ship faster” conversation" />
      <Lines labels={er.map(r => r.month.slice(2))} yFmt={v => v + '%'} threshold={{ at: 10, label: '10% line', color: GOLD }}
        series={[
          { label: 'escaped (%)', color: RED, values: er.map(r => ({ y: r.rate, note: `${r.escaped} escaped / ${r.shipped} shipped` })) },
          { label: 'QA-caught (count)', color: GREEN, values: er.map(r => ({ y: r.qaCaught })) },
        ]} />
      <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
        <span style={{ font: `400 11px ${BODY}`, color: RED }}>● escaped, % of that month's shipped</span>
        <span style={{ font: `400 11px ${BODY}`, color: GREEN }}>● bugs QA caught in flight (count)</span>
      </div>
    </Card>

    <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: 12, alignItems: 'start' }}>
      <DataTable title="Hotspots" meta="bugs per shipped ticket touching that path · 10 worst" minWidth={480} pageSize={10}
        rows={Q.hotspots} getKey={h => h.area} initialSort={{ key: 'ratio', dir: -1 }} raw={Q.hotspots}
        onRowClick={h => setPinned(p => (p === h.area ? null : h.area))} activeKey={pinned}
        columns={[
          { key: 'area', label: 'Area (path)', width: '1.7fr', sort: h => h.area, filter: h => h.area, render: h => <span style={{ font: `500 12px ${MONO}`, color: HI, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{h.area}</span> },
          { key: 'bugs', label: 'Bugs', width: '62px', align: 1, sort: h => h.bugs, render: h => <span style={{ font: `700 12px ${MONO}`, color: RED }}>{h.bugs}</span> },
          { key: 'esc', label: 'Escaped', width: '72px', align: 1, sort: h => h.escaped, render: h => <span style={{ font: `600 12px ${MONO}`, color: h.escaped ? RED : DIM }}>{h.escaped}</span> },
          { key: 'ship', label: 'Shipped', width: '72px', align: 1, sort: h => h.shipped, render: h => <span style={{ font: `500 12px ${MONO}`, color: DIM }}>{h.shipped}</span> },
          { key: 'ratio', label: 'Bugs/ship', width: '82px', align: 1, sort: h => h.bugsPerShipped ?? -1, render: h => <span style={{ font: `700 12px ${MONO}`, color: (h.bugsPerShipped || 0) > 0.5 ? RED : GOLD }}>{h.bugsPerShipped ?? '—'}</span> },
          { key: 'act', label: '', width: '92px', align: 1, render: h => <button style={miniBtn} onClick={e => { e.stopPropagation(); copy(hardening(h), h.area) }}>{copied === h.area ? '✓' : 'Harden'}</button> },
        ]} />

      <Card>
        <CardHead title="Ownership concentration" meta="bus factor · ≥70% from one person is flagged" />
        {!Q.ownership.length && <Empty text="No delivered work with a component set." />}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 420, overflow: 'auto' }}>
          {Q.ownership.map(o => <div key={o.area} style={{ padding: '9px 11px', borderRadius: 6, background: 'var(--bg-base)', border: `1px solid ${o.busFactor ? 'var(--red-bg)' : 'var(--bg-surface-hover)'}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ font: `600 12px ${BODY}`, color: HI, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.area}</span>
              {/* tri-state: true = risk, false = measured and fine, null = too few tickets to judge */}
              {o.busFactor === true && <span style={{ font: `700 8px ${MONO}`, letterSpacing: '0.05em', padding: '2px 6px', borderRadius: 4, background: 'var(--red-bg)', color: RED }}>BUS FACTOR 1</span>}
              {o.busFactor === null && <span title={`only ${o.total} ticket(s) — below the n≥${o.busFactorMinN} floor, so ownership concentration is not judged`} style={{ font: `700 8px ${MONO}`, letterSpacing: '0.05em', padding: '2px 6px', borderRadius: 4, color: 'var(--text-tertiary)', border: '1px solid var(--border-default)' }}>LOW n</span>}
              <span style={{ font: `500 10px ${MONO}`, color: DIM }}>{o.total} tickets · {o.contributors} people</span>
            </div>
            <div style={{ display: 'flex', height: 7, borderRadius: 4, overflow: 'hidden', background: 'var(--bg-surface-hover)' }}>
              {o.rows.map((r, i) => <div key={r.who} title={`${r.who} — ${r.n} (${r.share}%)`} style={{ width: `${r.share}%`, background: [RED, GOLD, BB, GREEN, PURPLE][i % 5], opacity: i === 0 ? 1 : 0.65 }} />)}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
              <span style={{ font: `500 10px ${MONO}`, color: o.busFactor ? RED : 'var(--text-secondary)' }}>{o.top?.who} {o.top?.share}%</span>
              {o.busFactor && <button style={{ ...miniBtn, padding: '2px 8px', fontSize: 10 }} onClick={() => copy(`Pairing plan — ${o.area}\n\n${o.top?.who} has delivered ${o.top?.share}% of ${o.total} tickets in ${o.area}. Propose a second owner: pair on the next 2 tickets in this area, then hand over the third.`, 'p' + o.area)}>{copied === 'p' + o.area ? '✓ copied' : 'Draft pairing plan'}</button>}
            </div>
          </div>)}
        </div>
      </Card>
    </div>

    <DataTable title="Bug register" meta={pinned ? `pinned to ${pinned} — click the hotspot again to clear` : 'QA-reported · assigned to the team'} minWidth={980} pageSize={12}
      rows={bugs} getKey={b => b.key} initialSort={{ key: 'reported', dir: -1 }} raw={bugs}
      columns={[
        { key: 'bug', label: 'Bug', width: '84px', sort: b => b.key, filter: b => b.key + ' ' + b.summary, render: b => <TicketLink i={b} color={b.live ? 'var(--text-secondary)' : RED} style={{ font: `500 12px ${MONO}` }} /> },
        { key: 'summary', label: 'Summary', width: '1.9fr', sort: b => b.summary, render: b => <span style={{ font: `400 12px ${BODY}`, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{b.linkedKey && <TicketLink i={{ key: b.linkedKey, host: b.host }} color="var(--text-tertiary)" style={{ fontSize: 10 }}>↳{b.linkedKey}</TicketLink>} {b.summary}</span> },
        { key: 'esc', label: 'Escaped', width: '76px', align: 1, sort: b => (b.escaped ? 1 : 0), render: b => <span style={{ font: `600 9px ${MONO}`, padding: '2px 6px', borderRadius: 4, background: b.escaped ? 'var(--red-bg)' : 'var(--green-bg)', color: b.escaped ? RED : GREEN }}>{b.escaped ? 'prod' : 'in QA'}</span> },
        { key: 'area', label: 'Component', width: '106px', sort: b => b.area || '', render: b => <span style={{ font: `400 11px ${BODY}`, color: b.area ? 'var(--text-secondary)' : DIM }}>{b.area || '—'}</span> },
        { key: 'status', label: 'Status', width: '92px', align: 1, sort: b => b.status, filter: b => b.status, render: b => <span style={{ font: `600 9px ${MONO}`, padding: '2px 7px', borderRadius: 5, whiteSpace: 'nowrap', background: b.statusColor + '26', color: b.statusColor }}>{b.status}</span> },
        { key: 'reported', label: 'Reported', width: '80px', align: 1, sort: b => b.created || '', render: b => <span style={{ font: `500 11px ${MONO}`, color: 'var(--text-secondary)' }}>{fdate(b.created)}</span> },
        { key: 'owner', label: 'Assigned to', width: '140px', sort: b => b.owner?.name || '', render: b => ownSel(b, 'ownerId') },
        { key: 'fixer', label: 'Resolved by', width: '140px', sort: b => b.fixer?.name || '', render: b => ownSel(b, 'fixerId') },
      ]} />
    <div style={{ font: `400 11px ${MONO}`, color: DIM }}>
      No ratio, no counter, no owner→fixer board. Those were built on who happened to drag a card, and all four personas cut them. These two selects exist to ROUTE a fix, nothing else.
    </div>
  </section>
}
