import React from 'react'
import { MONO, BODY, ACCENT, MUTE, INK, GREEN, RED, PURPLE, LINE, Tile, MiniTable, LoadingPanel } from './theme.jsx'
import { Card, Btn, Empty, Headline } from './charts.jsx'
import { useApi, copy } from './data.jsx'

// item 13 — cost per ticket, from the real session↔ticket join (branch/commit strings the agent typed).
// SELF-ONLY: these sessions are this laptop's. The join coverage is printed on the payload and is
// printed here too — a 1.6% sample is a real number about a small slice, not a number about the team.
export default function TicketEconomics() {
  const { data, loading, error } = useApi('/api/career/ticket-economics')

  if (loading && !data) return <LoadingPanel label="Joining sessions to tickets…" tiles={3} />
  if (error) return <Card title="Ticket economics"><Empty tone={RED}>Ticket economics unavailable — {error}</Empty></Card>

  const { rows = [], coverage, linkedSessions, totalSessions, totals = {}, caveat } = data || {}
  const cov = Math.round((coverage || 0) * 100)

  return (
    <Card title="What it cost to ship — per ticket"
      sub="self-only · joined from the branch and commit strings the agent actually typed"
      json={data}>
      {!rows.length ? (
        <Empty>
          No session carries a ticket key yet. The join reads <code style={{ font: `400 11px ${MONO}` }}>git checkout -b</code> / <code style={{ font: `400 11px ${MONO}` }}>git commit -m</code> strings
          out of the transcripts — it will populate as soon as sessions run on ticket-named branches. This is an empty join, not a zero cost.
        </Empty>
      ) : (
        <>
          <Headline tone={cov < 20 ? PURPLE : INK} icon={cov < 20 ? '⚠' : null}>{caveat}</Headline>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '14px 0' }}>
            <Tile label="tickets joined" value={rows.length} sub={`${linkedSessions} of ${totalSessions} sessions`} />
            <Tile label="$ / ticket" value={totals.usdPerTicket == null ? '—' : `$${totals.usdPerTicket}`} sub="over the joined sample only" tone={PURPLE} />
            <Tile label="total (joined)" value={`$${totals.usd}`} sub="never a per-engineer AI score" />
            <Tile label="join coverage" value={`${cov}%`} sub="of this laptop's sessions" tone={cov < 20 ? RED : GREEN} />
          </div>
          <MiniTable
            columns={[
              { key: 'ticket', label: 'ticket', render: r => <span style={{ font: `600 12px ${MONO}`, color: ACCENT }}>{r.ticket}</span> },
              { key: 'sessions', label: 'sessions', align: 'right' },
              { key: 'tokens', label: 'tokens', align: 'right', render: r => (r.tokens || 0).toLocaleString() },
              { key: 'usd', label: 'usd', align: 'right', render: r => <b style={{ color: r.usd > 100 ? RED : INK }}>${r.usd.toFixed(2)}</b> },
              { key: 'prs', label: 'prs', align: 'right', render: r => (r.prs || []).length || <span style={{ color: MUTE }}>—</span> },
              { key: 'firstAt', label: 'first session', align: 'right', render: r => <span style={{ font: `400 11px ${MONO}`, color: MUTE }}>{r.firstAt ? String(r.firstAt).slice(0, 10) : '—'}</span> },
              { key: 'resume', label: '', render: r => r.resume ? <Btn tone={GREEN} onClick={() => copy(r.resume, 'resume command copied')}>⧉ resume</Btn> : null },
            ]}
            rows={rows} maxHeight={420} />
          <div style={{ font: `400 10.5px ${BODY}`, color: MUTE, marginTop: 10 }}>
            Correlational and small-n by construction. It is a $/ticket for <b>this</b> sample of <b>your</b> sessions — it is not, and cannot become, a per-engineer AI productivity score.
          </div>
        </>
      )}
    </Card>
  )
}
