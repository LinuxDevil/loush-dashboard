import React, { useState } from 'react'
import { HEAD, BODY, MONO, BB, GREEN, GOLD, RED, PURPLE, DIM, HI, PANEL, Card, CardHead, Empty, H1, DataTable, PRLink, PrBadge, Checks, Kpi, miniBtn, primaryBtn, useCopy, fx } from './ui.jsx'
import { MIN_N } from './stats.js'

// §4 — the review board is keyed on PERSON, not on PR. Deliberately NOT a slowest-reviewer leaderboard:
// the unit of accountability is the team's review SLA. The two currently-invisible killers get their own
// tables — requested-and-never-answered, and no reviewer requested at all.
const cell = (v, n, u = 'd') => <span style={{ font: `600 12px ${MONO}`, color: v == null ? '#3d4757' : n < MIN_N ? '#7f8ea1' : HI }}>{v == null ? '—' : fx(v) + u}</span>

export default function ReviewFlow({ snap, project }) {
  const [copy, copied] = useCopy()
  const [busy, setBusy] = useState(null)
  const R = snap.review || { reviewers: [], concentration: {}, noReviewerRequested: [], unanswered: [] }
  const conc = R.concentration || {}
  const openPrs = (snap.prs || []).filter(p => p.state !== 'Merged' && p.state !== 'Closed')
  const nudge = p => `@${(p.waitingOn || []).join(' @') || p.author}: PR #${p.num} "${p.title}" has been open ${fx(p.openDays)} working days${p.waitingOn?.length ? ' waiting on your review' : ' with no reviewer requested'}. ${p.url}`
  const req = (p, login) => {
    setBusy(p.num)
    fetch(`/api/eng/pr/${p.num}/request-review?project=${p.project || project}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login }) })
      .then(r => r.json()).finally(() => setBusy(null))
  }
  // least-loaded eligible reviewer — the default suggestion, never an auto-assign
  const lightest = R.reviewers.filter(r => r.given90 > 0).sort((a, b) => a.awaiting - b.awaiting)[0]

  return <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <H1 kicker="by reviewer · not by PR" title="Review Flow" right={<span style={{ font: `400 11px ${MONO}`, color: DIM }}>rolling 30d / 90d · server window</span>} />

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
      <Kpi label="Request → 1st review" value={R.firstReview?.p50 == null ? '—' : fx(R.firstReview.p50) + 'd'} color={BB}
        sub={`p90 ${fx(R.firstReview?.p90)}d — the honest clock: starts when a reviewer was ASKED`} n={openPrs.length + (snap.prs?.length || 0) - openPrs.length} />
      <Kpi label="PR merge time" value={R.mergeTime?.p50 == null ? '—' : fx(R.mergeTime.p50) + 'd'} color={PURPLE} sub={`p90 ${fx(R.mergeTime?.p90)}d`} n={(snap.prs || []).filter(p => p.mergeDays != null).length} />
      <Kpi label="Awaiting review now" value={String(R.unanswered?.length || 0)} color={(R.unanswered?.length || 0) ? GOLD : GREEN} sub="requested, nobody has answered" />
      <Kpi label="No reviewer asked" value={String(R.noReviewerRequested?.length || 0)} color={(R.noReviewerRequested?.length || 0) ? RED : GREEN} sub="open PRs nobody was asked to look at" />
    </div>

    {conc.top2Share != null && <Card style={{ borderColor: conc.flagged ? 'rgba(242,119,122,0.35)' : undefined }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <span style={{ font: `700 20px ${HEAD}`, color: conc.flagged ? RED : GREEN }}>{fx(conc.top2Share, 0)}%</span>
        <span style={{ font: `500 13px ${BODY}`, color: TXTC }}>of all reviews in 90d were done by 2 of {conc.reviewerCount} reviewers{conc.flagged ? ' — the two people reviewing everything are the two people who will quit.' : '. Load is spread.'}</span>
        <span style={{ marginLeft: 'auto', font: `400 10.5px ${MONO}`, color: DIM }}>top-1 {fx(conc.top1Share, 0)}% · {conc.total90} reviews</span>
      </div>
    </Card>}

    <DataTable title="Reviewers" meta="operational facts, not a ranking · n<5 greyed" minWidth={860} pageSize={10}
      rows={R.reviewers} getKey={r => r.login} initialSort={{ key: 'awaiting', dir: -1 }} raw={R.reviewers}
      columns={[
        { key: 'login', label: 'Reviewer', width: '1.4fr', sort: r => r.login, filter: r => r.login, render: r => <span style={{ font: `600 12px ${BODY}`, color: HI }}>{r.login}</span> },
        { key: 'awaiting', label: 'Awaiting them', width: '110px', align: 1, sort: r => r.awaiting, render: r => <span style={{ font: `700 13px ${MONO}`, color: r.awaiting > 3 ? RED : r.awaiting ? GOLD : DIM }}>{r.awaiting}</span> },
        { key: 'oldest', label: 'Oldest wait', width: '96px', align: 1, sort: r => r.oldestWaitDays ?? -1, render: r => <span style={{ font: `600 12px ${MONO}`, color: (r.oldestWaitDays || 0) > 2 ? RED : HI }}>{r.oldestWaitDays == null ? '—' : fx(r.oldestWaitDays) + 'd'}</span> },
        { key: 'p50', label: 'p50 30d', width: '82px', align: 1, sort: r => r.p50_30 ?? 1e9, render: r => cell(r.p50_30, r.n30) },
        { key: 'p90', label: 'p90 30d', width: '82px', align: 1, sort: r => r.p90_30 ?? 1e9, render: r => cell(r.p90_30, r.n30) },
        { key: 'p90_90', label: 'p90 90d', width: '82px', align: 1, sort: r => r.p90_90 ?? 1e9, render: r => cell(r.p90_90, r.n90) },
        { key: 'given', label: 'Given 30/90', width: '96px', align: 1, sort: r => r.given90, render: r => <span style={{ font: `500 12px ${MONO}`, color: GREEN }}>{r.given30}/{r.given90}</span> },
        { key: 'recv', label: 'Received 30/90', width: '112px', align: 1, sort: r => r.received90, render: r => <span style={{ font: `500 12px ${MONO}`, color: PURPLE }}>{r.received30}/{r.received90}</span> },
      ]} />

    <DataTable title="Requested — and never answered" meta="the set nobody can see today" minWidth={760} pageSize={8}
      rows={R.unanswered || []} getKey={p => p.repo + p.num} initialSort={{ key: 'open', dir: -1 }} raw={R.unanswered}
      columns={[
        { key: 'pr', label: 'PR', width: '78px', sort: p => p.num, filter: p => p.num + ' ' + p.title, render: p => <PRLink pr={p}>#{p.num}</PRLink> },
        { key: 'title', label: 'Title', width: '2fr', sort: p => p.title, render: p => <span style={{ font: `400 12px ${BODY}`, color: '#c3cfdc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{p.title}</span> },
        { key: 'author', label: 'Author', width: '110px', sort: p => p.author, render: p => <span style={{ font: `500 11.5px ${BODY}`, color: '#93a6bb' }}>{p.author}</span> },
        { key: 'wait', label: 'Waiting on', width: '150px', sort: p => (p.waitingOn || []).join(','), render: p => <span style={{ font: `600 11px ${MONO}`, color: GOLD }}>{(p.waitingOn || []).join(', ')}</span> },
        { key: 'open', label: 'Open', width: '70px', align: 1, sort: p => p.openDays, render: p => <span style={{ font: `700 12px ${MONO}`, color: p.openDays > 2 ? RED : HI }}>{fx(p.openDays, 0)}d</span> },
        { key: 'act', label: '', width: '104px', align: 1, render: p => <button style={miniBtn} onClick={e => { e.stopPropagation(); copy(nudge(p), 'u' + p.num) }}>{copied === 'u' + p.num ? '✓' : 'Copy nudge'}</button> },
      ]} />

    <DataTable title="No reviewer requested at all" meta={lightest ? `least-loaded reviewer right now: ${lightest.login}` : ''} minWidth={760} pageSize={8}
      rows={R.noReviewerRequested || []} getKey={p => p.repo + p.num} initialSort={{ key: 'open', dir: -1 }} raw={R.noReviewerRequested}
      columns={[
        { key: 'pr', label: 'PR', width: '78px', sort: p => p.num, filter: p => p.num + ' ' + p.title, render: p => <PRLink pr={p}>#{p.num}</PRLink> },
        { key: 'title', label: 'Title', width: '2fr', sort: p => p.title, render: p => <span style={{ font: `400 12px ${BODY}`, color: '#c3cfdc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{p.title}</span> },
        { key: 'author', label: 'Author', width: '110px', sort: p => p.author, render: p => <span style={{ font: `500 11.5px ${BODY}`, color: '#93a6bb' }}>{p.author}</span> },
        { key: 'open', label: 'Open', width: '70px', align: 1, sort: p => p.openDays, render: p => <span style={{ font: `700 12px ${MONO}`, color: p.openDays > 2 ? RED : HI }}>{fx(p.openDays, 0)}d</span> },
        { key: 'act', label: '', width: '190px', align: 1, render: p => <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button style={miniBtn} onClick={e => { e.stopPropagation(); copy(nudge(p), 'n' + p.num) }}>{copied === 'n' + p.num ? '✓' : 'Copy nudge'}</button>
          {snap.writes && lightest && <button style={primaryBtn} disabled={busy === p.num} onClick={e => { e.stopPropagation(); req(p, lightest.login) }}>{busy === p.num ? '…' : `Ask ${lightest.login}`}</button>}
        </span> },
      ]} />

    <DataTable title="Open PRs" meta="every row carries its CI checks (§11)" minWidth={860} pageSize={10}
      rows={openPrs} getKey={p => p.repo + p.num} initialSort={{ key: 'open', dir: -1 }} raw={openPrs}
      columns={[
        { key: 'pr', label: 'PR', width: '76px', sort: p => p.num, filter: p => p.num + ' ' + p.title + ' ' + p.author + ' ' + p.ticket, render: p => <PRLink pr={p}>#{p.num}</PRLink> },
        { key: 'ticket', label: 'Ticket', width: '84px', sort: p => p.ticket, render: p => <span style={{ font: `500 11px ${MONO}`, color: BB }}>{p.ticket}</span> },
        { key: 'title', label: 'Title', width: '2fr', sort: p => p.title, render: p => <span style={{ font: `400 12px ${BODY}`, color: '#c3cfdc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{p.title}</span> },
        { key: 'state', label: 'State', width: '118px', sort: p => p.state, render: p => <PrBadge state={p.state} /> },
        { key: 'checks', label: 'Checks', width: '62px', align: 1, sort: p => p.checks || '', render: p => <Checks state={p.checks} /> },
        { key: 'rev', label: 'Reviewers', width: '130px', sort: p => (p.reviewers || []).join(), render: p => <span style={{ font: `500 11px ${MONO}`, color: (p.reviewers || []).length ? GREEN : (p.requestedReviewers || []).length ? GOLD : RED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{(p.reviewers || []).join(', ') || (p.requestedReviewers || []).join(', ') || 'nobody'}</span> },
        { key: 'open', label: 'Open', width: '68px', align: 1, sort: p => p.openDays, render: p => <span style={{ font: `600 12px ${MONO}`, color: p.openDays > 2 ? GOLD : HI }}>{fx(p.openDays, 0)}d</span> },
      ]} />
  </section>
}
const TXTC = '#c3cfdc'
