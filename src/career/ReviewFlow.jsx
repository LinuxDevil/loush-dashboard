import React, { useState } from 'react'
import { api, toast } from '../api.js'
import { MONO, BODY, ACCENT, MUTE, INK, GREEN, RED, PURPLE, LINE, Badge, MiniTable, LoadingPanel } from './theme.jsx'
import { Card, Btn, Nudge, Empty, Headline } from './charts.jsx'
import { useApi, copy } from './data.jsx'
import { Stagger } from '../game/index.js'

// item 3 — review flow: my rot board (MINE) + the team queue + reviewer LOAD.
// The write path is deliberately weak: /api/team/pr/:num/* answers {ok:false, copy:"<line>"} unless the
// project opts into writes. There is no auto-ping — the action is a line you send yourself.
export default function ReviewFlow() {
  const cfg = useApi('/api/career/config')
  const me = cfg.data?.identity?.githubHandle || ''
  const { data, loading, error } = useApi('/api/team/review-flow' + (me ? `?me=${encodeURIComponent(me)}` : ''))
  const [handle, setHandle] = useState('')

  if (loading && !data) return <LoadingPanel label="Loading the review queue from GitHub…" tiles={3} />
  if (error || data?.available === false) return <Card title="Review flow"><Empty tone={RED}>Review flow unavailable — {error || data?.error}</Empty></Card>

  const { mine = [], queue = [], load = [], concentration = {}, neverReviewed = [], slaDays, stuckDays } = data || {}

  // The only write actions in the app. Both degrade to the clipboard by design.
  const act = async (pr, kind) => {
    const path = kind === 'nudge' ? `/api/team/pr/${pr.num}/comment` : `/api/team/pr/${pr.num}/request-review`
    const body = kind === 'nudge' ? { repo: pr.repo, body: pr.nudge } : { repo: pr.repo, reviewer: leastLoaded(load) }
    try {
      const r = await api.post(path, body)
      if (r.sent) return toast('sent via gh', 'success')
      await copy(r.copy, 'writes are off for this repo — the line is on your clipboard')
    } catch (e) { toast(e.message, 'error') }
  }

  const saveHandle = async () => {
    if (!handle.trim()) return
    await api.post('/api/career/config', { identity: { ...(cfg.data?.identity || {}), githubHandle: handle.trim() } })
    cfg.reload(); toast('GitHub handle saved', 'success')
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* MINE — my PRs rotting with nobody on them */}
      <Card title="Mine — my open PRs" sub={me ? `author: ${me} · red past ${slaDays} working days with zero reviews` : null} json={mine}>
        {!me ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Empty>Your GitHub handle is not set, so this lane cannot be resolved. It is not zero — it is unknown.</Empty>
            <input value={handle} onChange={e => setHandle(e.target.value)} placeholder="github login"
              style={{ font: `400 12px ${MONO}`, background: '#0d1117', color: INK, border: `1px solid ${LINE}`, borderRadius: 6, padding: '5px 8px' }} />
            <Btn onClick={saveHandle}>save</Btn>
          </div>
        ) : !mine.length ? <Empty>Nothing of yours is open right now.</Empty> : <Stagger>{mine.map(p => (
          <PrRow key={p.num} p={p} red={p.red} onNudge={() => act(p, 'nudge')} />
        ))}</Stagger>}
      </Card>

      {/* QUEUE — the team's rot: open past SLA with no review, or stuck in changes-requested */}
      <Card title="Queue — PRs the team is sitting on"
        sub={`open > ${slaDays}d with zero reviews, or "Changes requested" > ${stuckDays}d · sorted by age (a queue is not a person)`}
        json={queue}>
        {!queue.length ? <Empty>No PR is past the review SLA. This is the good case.</Empty> : <Stagger>{queue.map(p => (
          <PrRow key={p.num} p={p} red={p.firstReviewDays == null} showAuthor
            onNudge={() => act(p, 'nudge')} onAssign={load.length ? () => act(p, 'assign') : null} />
        ))}</Stagger>}
      </Card>

      {/* LOAD — concentration is the signal, not the person. Alphabetical. */}
      <Card title="Reviewer load — concentration, not a scoreboard"
        sub={`${concentration.totalReviews || 0} reviews in the last 30 days · alphabetical`}
        json={{ load, concentration, neverReviewed }}>
        <Headline tone={concentration.flagged ? RED : GREEN} icon={concentration.flagged ? '⚠' : '✓'}>
          Top reviewer does {pctOf(concentration.top1Share)} of all reviews; the top two do {pctOf(concentration.top2Share)}.
          {concentration.flagged
            ? ' The two people reviewing everything are the two people who will quit. Spread it.'
            : ' Healthy spread.'}
        </Headline>
        <div style={{ marginTop: 12 }}>
          <MiniTable
            columns={[
              { key: 'login', label: 'reviewer', render: r => <span style={{ font: `500 12px ${MONO}`, color: INK }}>{r.login}</span> },
              { key: 'reviews', label: 'reviews 30d', align: 'right' },
              { key: 'prs', label: 'distinct PRs', align: 'right' },
              { key: 'openNow', label: 'open on them now', align: 'right', render: r => <span style={{ color: r.openNow > 3 ? RED : INK }}>{r.openNow}</span> },
              { key: 'p50FirstReview', label: 'p50 first review', align: 'right', render: r => r.p50FirstReview == null ? <span style={{ color: MUTE }}>—</span> : `${r.p50FirstReview}d` },
              { key: 'p90FirstReview', label: 'p90', align: 'right', render: r => r.p90FirstReview == null ? <span style={{ color: MUTE }}>—</span> : `${r.p90FirstReview}d` },
            ]}
            rows={load} empty="no reviews recorded in the window" />
        </div>
        {neverReviewed.length ? (
          <div style={{ font: `400 11.5px ${BODY}`, color: MUTE, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${LINE}` }}>
            <b style={{ color: PURPLE }}>Never reviewed in 30d:</b> {neverReviewed.join(', ')} — review load that is not shared is review load that will not be there when it is needed.
          </div>
        ) : null}
      </Card>
    </div>
  )
}

const pctOf = v => `${Math.round((v || 0) * 100)}%`
const leastLoaded = (load) => [...load].sort((a, b) => (a.openNow || 0) - (b.openNow || 0))[0]?.login || ''

function PrRow({ p, red, showAuthor, onNudge, onAssign }) {
  return (
    <div className="lift" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '7px 8px', margin: '0 -8px', borderTop: `1px solid ${LINE}`, borderRadius: 8 }}>
      <a href={p.url} target="_blank" rel="noreferrer" style={{ font: `600 11.5px ${MONO}`, color: ACCENT, textDecoration: 'none' }}>#{p.num}</a>
      <Badge tone={p.state === 'Changes requested' ? 'red' : p.state === 'Approved' ? 'green' : 'mute'}>{p.state}</Badge>
      <span style={{ font: `500 11px ${MONO}`, color: red ? RED : MUTE }}>{Math.round(p.openDays)}d open</span>
      <span style={{ font: `400 11px ${MONO}`, color: p.firstReviewDays == null ? RED : MUTE }}>
        {p.firstReviewDays == null ? 'no review yet' : `first review ${p.firstReviewDays}d`}
      </span>
      {showAuthor && <span style={{ font: `400 11px ${MONO}`, color: MUTE }}>@{p.author}</span>}
      <span style={{ flex: 1, minWidth: 180, font: `400 12px ${BODY}`, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
      {p.reviewers?.length ? <span style={{ font: `400 10.5px ${MONO}`, color: MUTE }}>→ {p.reviewers.join(', ')}</span> : <Badge tone="purple">no reviewer</Badge>}
      {onAssign && <Btn tone={MUTE} onClick={onAssign}>assign least-loaded</Btn>}
      <Nudge text={p.nudge} />
    </div>
  )
}
