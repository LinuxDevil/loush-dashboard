import React, { useState } from 'react'
import { api, toast } from '../api.js'
import { MONO, BODY, ACCENT, MUTE, INK, GREEN, RED, PURPLE, LINE, Badge, MiniTable, Tile, LoadingPanel } from './theme.jsx'
import { Card, Btn, Empty, Headline } from './charts.jsx'
import { useApi, copy } from './data.jsx'

// item 8 — what fires, what is dead weight. SELF-ONLY BY CONSTRUCTION: this page reads one machine's
// ~/.claude and structurally cannot be rolled up to a manager. It is the visible proof of the privacy
// contract — and the one panel that changes what you do tomorrow morning.
const TONE = { DEAD: 'red', COLD: 'mute', WARM: 'accent', HOT: 'green', GHOST: 'purple' }
const FILTERS = ['ALL', 'DEAD', 'COLD', 'WARM', 'HOT']

export default function HarnessROI() {
  const { data, loading, error } = useApi('/api/career/harness-roi')
  const [f, setF] = useState('DEAD')

  if (loading && !data) return <LoadingPanel label="Joining the harness inventory against the transcripts…" tiles={3} />
  if (error) return <Card title="Harness ROI"><Empty tone={RED}>Harness ROI unavailable — {error}</Empty></Card>

  const { rows = [], ghosts = [], dead = 0, alwaysOnTax = 0, headline, rmList } = data || {}
  const shown = f === 'ALL' ? rows : rows.filter(r => r.verdict === f)
  const hot = rows.filter(r => r.verdict === 'HOT').length

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card title="Harness ROI — fires × always-on cost"
        sub="self-only · this page reads this laptop's ~/.claude and cannot be aggregated across people"
        json={data}
        right={rmList ? <Btn tone={RED} onClick={() => copy(rmList, `rm list for ${dead} dead capabilities copied — you run it, not a robot`)}>⧉ copy rm list</Btn> : null}>
        <Headline tone={dead ? RED : GREEN} icon={dead ? '⚠' : '✓'}>{headline}</Headline>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 14 }}>
          <Tile label="always-on tax" value={`${alwaysOnTax.toLocaleString()} tok`} sub="paid on every single prompt, for nothing" tone={RED} />
          <Tile label="dead" value={dead} sub="defined, never fired" tone={RED} />
          <Tile label="hot" value={hot} sub="top-10 by fires" tone={GREEN} />
          <Tile label="ghosts" value={ghosts.length} sub="fired but not defined in scope" tone={PURPLE} />
        </div>
      </Card>

      <Card title="Inventory" sub={`${shown.length} of ${rows.length} capabilities`} json={shown}
        right={
          <div style={{ display: 'flex', gap: 4 }}>
            {FILTERS.map(x => (
              <button key={x} onClick={() => setF(x)} style={{
                font: `${f === x ? 600 : 400} 11px ${MONO}`, color: f === x ? INK : MUTE,
                background: f === x ? '#1f6feb1a' : 'transparent', border: `1px solid ${f === x ? '#1f6feb44' : LINE}`,
                borderRadius: 6, padding: '3px 8px', cursor: 'pointer',
              }}>{x}{x === 'DEAD' && dead ? ` ${dead}` : ''}</button>
            ))}
          </div>
        }>
        <MiniTable
          columns={[
            { key: 'name', label: 'name', width: 220, render: r => <span style={{ font: `500 12px ${MONO}`, color: INK }}>{r.name}</span> },
            { key: 'kind', label: 'kind', render: r => <Badge>{r.kind}</Badge> },
            { key: 'scope', label: 'scope', render: r => <span style={{ font: `400 11px ${MONO}`, color: MUTE }}>{r.scope}</span> },
            { key: 'alwaysOnTokens', label: 'always-on tok', align: 'right', render: r => <span style={{ color: r.alwaysOnTokens > 200 ? RED : INK }}>{r.alwaysOnTokens}</span> },
            { key: 'onInvokeTokens', label: 'on-invoke tok', align: 'right' },
            { key: 'fires', label: 'fires', align: 'right', render: r => <span style={{ color: r.fires ? GREEN : RED }}>{r.fires}</span> },
            { key: 'lastFired', label: 'last fired', align: 'right', render: r => r.lastFired ? <span style={{ font: `400 11px ${MONO}`, color: MUTE }}>{String(r.lastFired).slice(0, 10)}</span> : <span style={{ color: MUTE }}>never</span> },
            { key: 'tokensPerFire', label: 'tok / fire', align: 'right', render: r => r.tokensPerFire == null ? <span style={{ color: MUTE }}>—</span> : r.tokensPerFire },
            { key: 'verdict', label: 'verdict', render: r => <Badge tone={TONE[r.verdict]}>{r.verdict}</Badge> },
            { key: 'rm', label: '', render: r => r.rm ? <Btn tone={MUTE} onClick={() => copy(r.rm, 'rm command copied')}>⧉ rm</Btn> : null },
          ]}
          rows={shown} maxHeight={520} empty={`nothing in the ${f} bucket`} />
      </Card>

      {ghosts.length ? (
        <Card title="Ghosts — invoked, but not defined in any scope I can see" sub="a capability that fires from somewhere the inventory does not know about" json={ghosts}>
          <MiniTable
            columns={[
              { key: 'name', label: 'name', render: g => <span style={{ font: `500 12px ${MONO}`, color: INK }}>{g.name}</span> },
              { key: 'kind', label: 'kind', render: g => <Badge>{g.kind}</Badge> },
              { key: 'fires', label: 'fires', align: 'right' },
            ]}
            rows={ghosts} maxHeight={260} />
        </Card>
      ) : null}
    </div>
  )
}
