import React, { useEffect, useState } from 'react'
import { HEAD, BODY, MONO, BB, GREEN, GOLD, RED, DIM, HI, Card, CardHead, Empty, H1, Kpi } from './ui.jsx'

// "What can I start right now" over the dependency links already recorded in JIRA.
//
// The three-way split is the point. Ready and blocked are the obvious buckets; UNKNOWN is the one
// that has to exist, because a JQL query scopes to one project and window, so a blocker can simply
// not be in the fetched set. Folding those into "ready" would put someone on genuinely blocked
// work — so they get their own column, and the reason is on the row.

const Row = ({ e, onOpenTicket, children }) => (
  <div style={{ padding: '9px 0', borderBottom: '1px solid var(--border-subtle)' }}>
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
      <a href={e.url || undefined} target="_blank" rel="noreferrer"
        onClick={ev => { if (onOpenTicket) { ev.preventDefault(); onOpenTicket(e.key) } }}
        style={{ font: `600 12px ${MONO}`, color: BB, textDecoration: 'none', flexShrink: 0 }}>{e.key}</a>
      <span style={{ font: `400 12px ${BODY}`, color: HI, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.summary || '—'}</span>
      <span style={{ marginLeft: 'auto', font: `400 10px ${MONO}`, color: DIM, flexShrink: 0 }}>{e.assignee?.name || 'unassigned'}</span>
    </div>
    {children}
  </div>
)

export default function ReadyBlocked({ project, onOpenTicket }) {
  const [q, setQ] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    setQ(null); setErr(null)
    fetch('/api/eng/queue' + (project ? `?project=${encodeURIComponent(project)}` : ''))
      .then(r => r.json())
      .then(d => (d.error ? setErr(d.error) : setQ(d)))
      .catch(e => setErr(String(e)))
  }, [project])

  if (err) return <Card><Empty text={`Could not compute the queue: ${err}`} /></Card>
  if (!q) return <Card><Empty text="Reading dependency links from the current snapshot…" /></Card>

  const c = q.counts
  const noDeps = c.open > 0 && c.withDependencies === 0

  return <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <H1 kicker="derived from JIRA issue links · no extra fetch" title="Ready / Blocked"
      right={<span style={{ font: `400 11px ${MONO}`, color: q.stale ? GOLD : DIM }}>{q.stale ? 'snapshot is stale — a blocker may already be closed' : 'from the current snapshot'}</span>} />

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
      <Kpi label="Ready to start" value={c.ready} color={GREEN} sub="every dependency is done" n={c.open} />
      <Kpi label="Blocked" value={c.blocked} color={GOLD} sub="waiting on a named open issue" n={c.open} />
      <Kpi label="Readiness unknown" value={c.unknown} color={c.unknown ? RED : DIM} sub="depends on an issue outside this query" n={c.open} />
      <Kpi label="Dependency cycles" value={q.cycles.length} color={q.cycles.length ? RED : DIM} sub="these never unblock on their own" />
    </div>

    {q.note && (
      <div style={{ padding: '10px 14px', border: `1px solid ${GOLD}`, borderRadius: 10, font: `400 12px ${BODY}`, color: HI }}>
        {q.note}
      </div>
    )}

    {noDeps && (
      <div style={{ padding: '10px 14px', border: '1px solid var(--border-default)', borderRadius: 10, font: `400 12px ${BODY}`, color: DIM }}>
        None of the {c.open} open issues has a blocking link, so everything reads as ready. That is what
        JIRA says, not a judgement about the work — if dependencies are tracked somewhere other than
        issue links, this view cannot see them.
      </div>
    )}

    {q.cycles.length > 0 && (
      <Card style={{ borderColor: RED }}>
        <CardHead title="Dependency cycles" meta="each of these is deadlocked until somebody removes a link" />
        {q.cycles.map((c2, i) => (
          <div key={i} style={{ font: `500 12px ${MONO}`, color: HI, padding: '6px 0' }}>{c2.join(' → ')}</div>
        ))}
      </Card>
    )}

    {q.impact.length > 0 && (
      <Card>
        <CardHead title="Finishing these frees the most work" meta="counts only issues whose LAST remaining blocker is this one — clearing one of three blockers frees nothing" />
        {q.impact.slice(0, 8).map(i => (
          <div key={i.key} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '5px 0' }}>
            <span style={{ font: `600 12px ${MONO}`, color: BB }}>{i.key}</span>
            <span style={{ font: `400 12px ${BODY}`, color: HI }}>unblocks {i.count}</span>
            <span style={{ font: `400 11px ${MONO}`, color: DIM }}>{i.unblocks.join(', ')}</span>
          </div>
        ))}
        {q.impact.length > 8 && <div style={{ font: `400 10px ${MONO}`, color: DIM, paddingTop: 6 }}>{q.impact.length - 8} more not shown</div>}
      </Card>
    )}

    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
      <Card style={{ borderColor: c.ready ? GREEN : undefined }}>
        <CardHead title={`Ready (${c.ready})`} meta="nothing open is in the way" />
        {!q.ready.length ? <Empty text="Nothing is startable — every open issue is waiting on something." /> :
          q.ready.map(e => (
            <Row key={e.key} e={e} onOpenTicket={onOpenTicket}>
              {e.unclassifiedLinks?.length > 0 && (
                <div style={{ font: `400 10px ${MONO}`, color: GOLD, paddingTop: 3 }}>
                  has {e.unclassifiedLinks.length} link(s) of a type this build does not classify
                  ({e.unclassifiedLinks.map(u => `${u.rel} ${u.key}`).join(', ')}) — check these are not dependencies
                </div>
              )}
            </Row>
          ))}
      </Card>

      <Card>
        <CardHead title={`Blocked (${c.blocked})`} meta="most-blocked first" />
        {!q.blocked.length ? <Empty text="Nothing is blocked by an open issue." /> :
          q.blocked.map(e => (
            <Row key={e.key} e={e} onOpenTicket={onOpenTicket}>
              <div style={{ font: `400 11px ${MONO}`, color: DIM, paddingTop: 3 }}>
                waits on {e.unmet.map(u => (
                  <span key={u.key} style={{ color: GOLD }}>{u.key} <span style={{ color: DIM }}>({u.status})</span>{' '}</span>
                ))}
              </div>
              {e.cycle && <div style={{ font: `500 10px ${MONO}`, color: RED, paddingTop: 2 }}>in a cycle: {e.cycle.join(' → ')}</div>}
              {e.unresolved?.length > 0 && <div style={{ font: `400 10px ${MONO}`, color: RED, paddingTop: 2 }}>also depends on {e.unresolved.join(', ')}, outside this query</div>}
            </Row>
          ))}
      </Card>
    </div>

    {q.unknown.length > 0 && (
      <Card style={{ borderColor: RED }}>
        <CardHead title={`Readiness unknown (${c.unknown})`}
          meta="depends on issues this query did not fetch — deliberately not counted as ready" />
        {q.unknown.map(e => (
          <Row key={e.key} e={e} onOpenTicket={onOpenTicket}>
            <div style={{ font: `400 11px ${MONO}`, color: RED, paddingTop: 3 }}>
              depends on {e.unresolved.join(', ')} — not in this project's JQL, so their status is unread
            </div>
          </Row>
        ))}
      </Card>
    )}

    <div style={{ font: `400 10px ${MONO}`, color: DIM }}>
      source: {q.source} · computed {q.generatedAt ? new Date(q.generatedAt).toLocaleString() : 'unknown'}
    </div>
  </section>
}
