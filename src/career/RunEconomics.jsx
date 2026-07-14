import React from 'react'
import { MONO, BODY, ACCENT, MUTE, INK, GREEN, RED, PURPLE, LINE, PANEL_BG, Badge, Tile, MiniTable, LoadingPanel } from './theme.jsx'
import { Card, Btn, Empty, Headline, HBars } from './charts.jsx'
import { useApi, useUsage, copy } from './data.jsx'

// item 9 — run economics + failure forensics. REPLACES the "cost saved (cache)" tile, which was an
// estimate multiplied by an estimate, measured against a counterfactual that never happened, and which
// only ever went up. This is real USD and a real error RATE. Self-only: it is this laptop's spend.
const usd = n => n == null ? '—' : n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(2)}`
// transcript project keys are the cwd with every separator flattened to "-":
// "-Users-ali-mohammad-learnspace-loushai-dashboard". The home prefix is 4 segments (leading empty,
// "Users", and a username whose dot also became a dash), so drop them and re-slash the rest.
const shortProj = p => { const s = String(p).split('-').slice(4); return s.length ? s.join('/') : String(p) }
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function RunEconomics() {
  const { data, loading, error } = useApi('/api/career/run-economics?days=30')
  const { data: usage } = useUsage()

  if (loading && !data) return <LoadingPanel label="Pricing 30 days of transcripts…" tiles={4} />
  if (error) return <Card title="Run economics"><Empty tone={RED}>Run economics unavailable — {error}</Empty></Card>

  const { spend = {}, block, breakage = [], compactions = 0, retries = 0, byHour = {}, worst, days } = data || {}
  const live = block || usage?.activeBlock || null
  const byDay = Object.entries(spend.byDay || {}).sort((a, b) => a[0] < b[0] ? -1 : 1)
  const maxDay = Math.max(1, ...byDay.map(([, v]) => v.usd || 0))
  const projects = Object.entries(spend.byProject || {}).sort((a, b) => (b[1].usd || 0) - (a[1].usd || 0)).slice(0, 8)
  const models = Object.entries(spend.byModel || {}).sort((a, b) => (b[1].usd || 0) - (a[1].usd || 0))
  const maxHour = Math.max(1, ...Object.values(byHour))
  const blockPct = live && live.end > live.start ? Math.min(1, (Date.now() - live.start) / (live.end - live.start)) : null

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* SPEND */}
      <Card title={`Run economics — real USD, last ${days} days`} sub="self-only · this is what this laptop actually spent" json={data}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <Tile label={`spend (${days}d)`} value={usd(spend.total)} sub={`${byDay.length} active days`} tone={PURPLE} />
          <Tile label="worst day" value={usd(Math.max(0, ...byDay.map(([, v]) => v.usd || 0)))} sub={byDay.length ? byDay.reduce((a, b) => (b[1].usd || 0) > (a[1].usd || 0) ? b : a)[0] : '—'} />
          <Tile label="compactions" value={compactions} sub="context ran out mid-run" tone={compactions ? RED : GREEN} />
          <Tile label="retries" value={retries} sub="requests that had to be re-sent" tone={retries > 100 ? RED : INK} />
          {live
            ? <Tile label="live 5h block" value={`${Math.round((blockPct || 0) * 100)}% elapsed`}
                sub={`${(live.msgs || 0).toLocaleString()} msgs · ends ${new Date(live.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`} tone={blockPct > 0.8 ? RED : ACCENT} />
            : <Tile label="live 5h block" value="—" sub="no active block reported" tone={MUTE} />}
        </div>
        {(spend.alerts || []).length ? (
          <div style={{ font: `500 12px ${BODY}`, color: RED, marginTop: 12 }}>⚠ {(spend.alerts || []).map(a => a.message || a).join(' · ')}</div>
        ) : null}
        <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 90, marginTop: 16 }}>
          {byDay.map(([d, v]) => (
            <div key={d} title={`${d}: ${usd(v.usd)} · ${(v.tok || 0).toLocaleString()} tok`}
              style={{ flex: 1, height: `${Math.max(2, (v.usd / maxDay) * 100)}%`, background: v.usd > maxDay * 0.6 ? RED : ACCENT, borderRadius: '3px 3px 0 0', minWidth: 4 }} />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', font: `400 10px ${MONO}`, color: MUTE, marginTop: 4 }}>
          <span>{byDay[0]?.[0]}</span><span>daily spend</span><span>{byDay[byDay.length - 1]?.[0]}</span>
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Card title="Spend by project" json={spend.byProject}>
          <HBars labelWidth={190} rows={projects.map(([p, v]) => ({ label: shortProj(p), value: v.usd || 0, sub: usd(v.usd), color: ACCENT }))} />
        </Card>
        <Card title="Spend by model" json={spend.byModel}>
          <HBars labelWidth={190} rows={models.map(([m, v]) => ({ label: m, value: v.usd || 0, sub: usd(v.usd), color: PURPLE }))} />
        </Card>
      </div>

      {/* BREAKAGE — the rate, not the count. A 100% failure rate on a tool is a lying CLAUDE.md. */}
      <Card title="Breakage — tool error RATE" sub="rate, not count: 11 failures out of 11 uses is a broken setup, not bad luck" json={breakage}>
        {worst ? <Headline tone={RED} icon="⚠">{worst}</Headline> : <Empty>No tool errors recorded in the window.</Empty>}
        <div style={{ marginTop: 14 }}>
          <MiniTable
            columns={[
              { key: 'tool', label: 'tool', width: 300, render: t => <span style={{ font: `500 12px ${MONO}`, color: INK }}>{t.tool}</span> },
              { key: 'uses', label: 'uses', align: 'right' },
              { key: 'errors', label: 'errors', align: 'right', render: t => <span style={{ color: t.errors ? RED : MUTE }}>{t.errors}</span> },
              { key: 'rate', label: 'failure rate', align: 'right', render: t => (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 60, height: 6, background: LINE, borderRadius: 999, overflow: 'hidden', display: 'inline-block' }}>
                    <span style={{ display: 'block', width: `${t.rate * 100}%`, height: '100%', background: t.rate > 0.3 ? RED : t.rate > 0.1 ? '#e3b341' : GREEN }} />
                  </span>
                  <b style={{ font: `600 12px ${MONO}`, color: t.rate > 0.3 ? RED : INK }}>{Math.round(t.rate * 100)}%</b>
                </span>
              ) },
            ]}
            rows={breakage} maxHeight={360} empty="no tool errors" />
        </div>
      </Card>

      {/* WHEN RUNS DIE */}
      <Card title="When runs die" sub="tool errors by day-of-week × hour (local)" json={byHour}>
        {!Object.keys(byHour).length ? <Empty>No failures to place in time.</Empty> : (
          <div style={{ overflowX: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: `40px repeat(24, 1fr)`, gap: 2, minWidth: 620 }}>
              <span />
              {Array.from({ length: 24 }, (_, h) => <span key={h} style={{ font: `400 8.5px ${MONO}`, color: MUTE, textAlign: 'center' }}>{h % 3 === 0 ? h : ''}</span>)}
              {DOW.map((d, di) => (
                <React.Fragment key={d}>
                  <span style={{ font: `400 10px ${MONO}`, color: MUTE, lineHeight: '16px' }}>{d}</span>
                  {Array.from({ length: 24 }, (_, h) => {
                    const v = byHour[`${di}:${h}`] || 0
                    return <div key={h} title={`${d} ${h}:00 — ${v} errors`} style={{ height: 16, borderRadius: 2, background: v ? `color-mix(in srgb, ${RED} ${20 + Math.round((v / maxHour) * 80)}%, ${PANEL_BG})` : LINE }} />
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
