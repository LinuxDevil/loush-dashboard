import React, { useState } from 'react'
import { api, toast } from '../api.js'
import { MONO, BODY, HEAD, ACCENT, MUTE, INK, GREEN, RED, PURPLE, LINE, Badge, Tile, LoadingPanel } from './theme.jsx'
import { Card, Btn, Empty } from './charts.jsx'
import { useApi, copy } from './data.jsx'

// item 11 — the 1:1 packet. THE SYMMETRY RULE IS THE FEATURE: every field here is a Plane-A work
// artifact the subject can already open about themselves. There is no token, cost, hours, session or
// transcript field on it — server-team.mjs physically cannot emit one.
//
// Default subject is YOU. The person picker is a subject selector for a packet, not a scope/lens switch:
// the same packet renders identically no matter who is looking at it.
export default function PersonPacket({ personId, onPerson }) {
  const board = useApi('/api/team/board')
  const cfg = useApi('/api/career/config')
  const meId = cfg.data?.identity?.jiraAccountId || ''
  const pid = personId || meId
  const { data: p, loading, error } = useApi(pid ? `/api/career/packet?person=${encodeURIComponent(pid)}` : null)
  const [agreed, setAgreed] = useState('')

  const rows = board.data?.rows || []

  const closeOneOnOne = async () => {
    if (!agreed.trim()) return toast('write down what you agreed first', 'error')
    await api.post('/api/career/one-on-one', { person: pid, agreedActions: agreed.split('\n').map(s => s.trim()).filter(Boolean) })
    setAgreed(''); toast('1:1 recorded — next period checks it against the data, not against memory', 'success')
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card title="1:1 packet" sub="work artifacts only — the identical packet the subject renders about themselves"
        json={p}
        right={
          <select value={pid} onChange={e => onPerson?.(e.target.value)}
            style={{ font: `400 12px ${MONO}`, color: INK, background: '#0d1117', border: `1px solid ${LINE}`, borderRadius: 6, padding: '5px 8px', maxWidth: 220 }}>
            {meId && !rows.some(r => r.id === meId) ? <option value={meId}>me</option> : null}
            {rows.map(r => <option key={r.id} value={r.id}>{r.name}{r.id === meId ? ' (me)' : ''}</option>)}
          </select>
        }>
        <div style={{ font: `400 11px ${BODY}`, color: MUTE, lineHeight: 1.5 }}>
          Built from JIRA tickets, PRs, reviews and escaped bugs. No score. No ranking. No token, cost, hours or
          transcript field — the endpoint that builds this cannot read them.
        </div>
      </Card>

      {cfg.loading && !pid ? <LoadingPanel label="Resolving your JIRA identity…" tiles={3} />
        : !pid ? <Card><Empty>No JIRA identity resolved yet — open any JIRA-backed panel once so the app can match your account, or pick a person above.</Empty></Card>
        : loading && !p ? <LoadingPanel label="Assembling the packet…" tiles={3} />
        : error ? <Card><Empty tone={RED}>{error} — a person with no open work in the snapshot has no packet.</Empty></Card>
        : !p ? null : (
        <>
          <Card title={p.person.name} sub={p.lastOneOnOneAt ? `since your last 1:1 on ${new Date(p.lastOneOnOneAt).toLocaleDateString()}` : 'no 1:1 on record — this window is the last 30 days'}
            right={<Btn onClick={() => copy(p.markdown, 'agenda copied as markdown')}>⧉ copy agenda</Btn>} json={p}>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <Tile label="open" value={p.open} />
              <Tile label="wip" value={p.wip} tone={p.wip > 4 ? RED : INK} />
              <Tile label="at risk" value={p.atRisk} tone={p.atRisk ? RED : GREEN} />
              <Tile label="shipped since last 1:1" value={p.shipped.length} tone={GREEN} />
              <Tile label="escaped bugs" value={p.bugs.length} tone={p.bugs.length ? RED : GREEN} />
              <Tile label="reviews (30d)" value={p.reviewLoad?.reviews ?? '—'} sub={p.reviewLoad ? `p90 first review ${p.reviewLoad.p90FirstReview ?? '—'}d` : 'no GitHub login matched'} />
            </div>
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${LINE}` }}>
              <div style={{ font: `500 10.5px ${MONO}`, color: MUTE, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 6 }}>talking points</div>
              {p.talkingPoints.map((t, i) => <div key={i} style={{ font: `400 12.5px ${BODY}`, color: INK, padding: '3px 0' }}>• {t}</div>)}
            </div>
          </Card>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Card title="Wins" sub={`${p.shipped.length} tickets closed`} json={p.shipped}>
              {!p.shipped.length ? <Empty>Nothing closed in the window. That is a question, not an accusation.</Empty>
                : p.shipped.slice(0, 12).map(s => (
                  <div key={s.key} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0' }}>
                    <a href={s.url} target="_blank" rel="noreferrer" style={{ font: `600 11.5px ${MONO}`, color: ACCENT, textDecoration: 'none', width: 92 }}>{s.key}</a>
                    <span style={{ flex: 1, font: `400 12px ${BODY}`, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.summary}</span>
                    <span style={{ font: `400 11px ${MONO}`, color: MUTE }}>{s.activeDays}d</span>
                  </div>
                ))}
            </Card>
            <Card title="Stuck" sub={`${p.stuck.length} at-risk or parked`} json={p.stuck}>
              {!p.stuck.length ? <Empty tone={GREEN}>Nothing parked or at risk.</Empty>
                : p.stuck.slice(0, 12).map(t => (
                  <div key={t.key} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0' }}>
                    <a href={t.url} target="_blank" rel="noreferrer" style={{ font: `600 11.5px ${MONO}`, color: ACCENT, textDecoration: 'none', width: 92 }}>{t.key}</a>
                    <Badge tone="purple">{t.status}</Badge>
                    <span style={{ font: `500 11px ${MONO}`, color: RED }}>{Math.round(t.inCurrent)}d</span>
                    <span style={{ flex: 1, font: `400 12px ${BODY}`, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.summary}</span>
                  </div>
                ))}
            </Card>
          </div>

          {p.agendaItems?.length ? (
            <Card title="Pushed onto this agenda" sub="items you sent here from the team board / review flow" json={p.agendaItems}>
              {p.agendaItems.map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', font: `400 12px ${BODY}`, color: INK }}>
                  <span style={{ font: `400 11px ${MONO}`, color: MUTE }}>{new Date(a.at).toLocaleDateString()}</span>
                  {a.url ? <a href={a.url} target="_blank" rel="noreferrer" style={{ color: ACCENT, textDecoration: 'none', font: `600 11.5px ${MONO}` }}>{a.key}</a> : null}
                  <span>{a.text}</span>
                </div>
              ))}
            </Card>
          ) : null}

          {p.lastAgreed?.length ? (
            <Card title="What we agreed last time" sub="checked against the data, not against memory" json={p.lastAgreed}>
              {p.lastAgreed.map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', font: `400 12px ${BODY}`, color: INK }}>
                  <span style={{ color: a.doneNow ? GREEN : MUTE }}>{a.doneNow ? '✓' : '○'}</span>{a.action}
                </div>
              ))}
            </Card>
          ) : null}

          <Card title="Close the 1:1" sub="what you agreed becomes next period's did-it-happen check">
            <textarea value={agreed} onChange={e => setAgreed(e.target.value)} rows={3}
              placeholder={'one agreed action per line\ne.g. "unblock AIR-10456 with a second reviewer by Thursday"'}
              style={{ width: '100%', font: `400 12px ${MONO}`, color: INK, background: '#0d1117', border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px', resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <Btn onClick={closeOneOnOne} tone={GREEN}>save agreed actions</Btn>
              <Btn tone={MUTE} onClick={async () => { const r = await api.post('/api/career/packet/export', { person: pid }); toast('packet exported to ' + r.path, 'success') }}>export my packet</Btn>
            </div>
            <div style={{ font: `400 10.5px ${BODY}`, color: MUTE, marginTop: 8 }}>
              Consent model: a manager only ever reads packets that were <b>exported</b> into the drop directory. Nothing scrapes anyone's laptop.
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
