import React, { useState } from 'react'
import { api, toast } from '../api.js'
import { MONO, BODY, ACCENT, MUTE, INK, GREEN, RED, PURPLE, LINE, PANEL_BG, Badge, LoadingPanel } from './theme.jsx'
import { Card, Btn, Empty, Headline } from './charts.jsx'
import { useApi, copy } from './data.jsx'
import { Stagger } from '../game/index.js'

// item 12 — ownership / real bus factor. Area × engineer file-touches over the team's repos, 90d.
// Alphabetical, not ranked: this answers "what breaks if X leaves", never "who wrote the most code".
export default function OwnershipMap({ onAgenda }) {
  const { data, loading, error } = useApi('/api/team/ownership')
  const board = useApi('/api/team/board')

  if (loading && !data) return <LoadingPanel label="Bucketing PR file paths by area…" tiles={2} />
  if (error || data?.available === false) return <Card title="Ownership"><Empty tone={RED}>Ownership unavailable — {error || data?.error}</Empty></Card>

  const { rows = [], people = [], matrix = [], floor, risks = [] } = data || {}
  const maxCell = Math.max(1, ...matrix.flatMap(m => Object.values(m.cells)))

  const propose = async (r) => {
    // The action writes into a 1:1 agenda — a conversation, never a bot.
    const person = (board.data?.rows || []).find(x => x.name.toLowerCase().includes(String(r.owner).toLowerCase().split(/[-.]/)[0]))
    if (!person) return copy(r.proposal, 'no JIRA identity matched that GitHub login — proposal copied instead')
    try { await api.post('/api/career/packet/agenda', { person: person.id, item: { text: r.proposal } }); toast(`added to ${person.name}'s 1:1 agenda`, 'success') }
    catch (e) { toast(e.message, 'error') }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card title="Bus factor — what breaks if one person leaves"
        sub={`${rows.length} areas · a contributor counts as an owner above ${floor} file-touches in 90d`} json={data}>
        <Headline tone={risks.length ? RED : GREEN} icon={risks.length ? '⚠' : '✓'}>
          {risks.length
            ? `${risks.length} area${risks.length === 1 ? ' has' : 's have'} exactly one real owner.`
            : 'Every area has at least two real contributors.'}
        </Headline>
        <Stagger step={50}>{risks.map(r => (
          <div key={r.area} className="lift" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '7px 8px', margin: '0 -8px', borderTop: `1px solid ${LINE}`, marginTop: 8, borderRadius: 8 }}>
            <span style={{ font: `600 12px ${MONO}`, color: RED, width: 160 }}>{r.area}</span>
            <span style={{ font: `400 12px ${BODY}`, color: INK, flex: 1, minWidth: 240 }}>only <b>{r.owner}</b> · {r.touches} touches</span>
            <Btn onClick={() => propose(r)}>+ propose a second owner</Btn>
          </div>
        ))}</Stagger>
      </Card>

      <Card title="Area × engineer" sub="file-touches from merged PRs, 90 days · alphabetical, in both directions" json={matrix}>
        {!matrix.length ? <Empty>No PR file data in the window.</Empty> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', font: `400 11px ${MONO}` }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: 'left', minWidth: 150 }}>area</th>
                  {people.map(p => <th key={p} style={{ ...th, writingMode: 'vertical-rl', height: 90, whiteSpace: 'nowrap' }}>{p}</th>)}
                  <th style={{ ...th }}>bus</th>
                </tr>
              </thead>
              <Stagger tag="tbody" step={35} max={420}>
                {matrix.map(m => {
                  const row = rows.find(r => r.area === m.area)
                  return (
                    <tr key={m.area}>
                      <td style={{ ...td, color: row?.risk === 'single-owner' ? RED : INK, fontWeight: 500 }}>{m.area}</td>
                      {people.map(p => {
                        const v = m.cells[p] || 0
                        return <td key={p} title={`${p} · ${m.area} · ${v} touches`} style={{ ...td, textAlign: 'center', background: v ? `color-mix(in srgb, ${ACCENT} ${12 + Math.round((v / maxCell) * 70)}%, ${PANEL_BG})` : 'transparent', color: v ? INK : MUTE }}>{v || '·'}</td>
                      })}
                      <td style={{ ...td, textAlign: 'center' }}>
                        <Badge tone={row?.busFactor === 1 ? 'red' : row?.busFactor === 0 ? 'purple' : 'green'}>{row?.busFactor ?? 0}</Badge>
                      </td>
                    </tr>
                  )
                })}
              </Stagger>
            </table>
          </div>
        )}
        <div style={{ font: `400 10.5px ${BODY}`, color: MUTE, marginTop: 10 }}>
          "bus" = contributors above the {floor}-touch floor. A 0 means the area has recent churn but nobody with a real footprint in it — which is its own kind of risk.
        </div>
      </Card>
    </div>
  )
}
const th = { font: `500 10px ${MONO}`, color: MUTE, padding: '4px 6px', borderBottom: `1px solid ${LINE}`, textTransform: 'uppercase', letterSpacing: '0.5px' }
const td = { padding: '5px 7px', borderBottom: `1px solid ${LINE}`, whiteSpace: 'nowrap' }
