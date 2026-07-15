import React from 'react'
import { MONO, BODY, ACCENT, MUTE, INK, GREEN, RED, PURPLE, LINE, Badge, LoadingPanel } from './theme.jsx'
import { Card, Btn, Empty, Headline } from './charts.jsx'
import { useApi, copy } from './data.jsx'

// item 14 — CI health. A red main blocks every engineer on the team at once and was, until now, 100%
// invisible in this app. Flake = the same head SHA that went both red and green.
export default function CiHealth() {
  const { data, loading, error } = useApi('/api/team/ci?days=30')

  if (loading && !data) return <LoadingPanel label="Reading recent CI runs…" tiles={2} />
  if (error || data?.available === false) return <Card title="CI health"><Empty tone={RED}>CI unavailable — {error || data?.error}</Empty></Card>

  const { repos = [], anyRed } = data || {}

  return (
    <Card title="CI health — is main red right now?"
      sub="default branch · last 30 days" json={data}>
      <Headline tone={anyRed ? RED : GREEN} icon={anyRed ? '⛔' : '✓'}>
        {anyRed ? 'A default branch is RED right now — that blocks everyone, not one person.' : 'Every default branch is green.'}
      </Headline>
      <div style={{ marginTop: 14 }}>
        {!repos.length ? <Empty>No repos configured with a githubRepo in projects.json.</Empty> : repos.map(r => (
          <div key={r.repo} style={{ borderTop: `1px solid ${LINE}`, padding: '10px 0' }}>
            {r.available === false ? (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ font: `600 12px ${MONO}`, color: INK }}>{r.repo}</span>
                <Empty tone={PURPLE}>gh could not read runs: {r.error}</Empty>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: r.red ? RED : GREEN, boxShadow: `0 0 8px ${r.red ? RED : GREEN}` }} />
                  <span style={{ font: `600 12.5px ${MONO}`, color: INK }}>{r.repo}</span>
                  {r.project ? <Badge>{r.project}</Badge> : null}
                  <Badge tone="mute">{r.branch || 'main'}</Badge>
                  <span style={{ font: `400 11px ${MONO}`, color: MUTE }}>{r.runs} runs</span>
                  <span style={{ flex: 1 }} />
                  <Metric v={`${Math.round((r.failureRate ?? 0) * 100)}%`} l="failure rate" tone={r.failureRate > 0.2 ? RED : INK} />
                  <Metric v={`${Math.round((r.flakeRate ?? 0) * 100)}%`} l="flake rate" tone={r.flakeRate > 0.2 ? PURPLE : INK} />
                  <Metric v={r.medianHoursToGreen == null ? '—' : `${r.medianHoursToGreen}h`} l="median time to green" />
                  {r.latest?.url ? <Btn tone={MUTE} onClick={() => window.open(r.latest.url, '_blank')}>open latest run</Btn> : null}
                </div>
                {r.latest && (
                  <div style={{ font: `400 11px ${MONO}`, color: MUTE, marginTop: 5 }}>
                    latest: <b style={{ color: r.latest.conclusion === 'failure' ? RED : GREEN }}>{r.latest.conclusion || 'running'}</b> · {r.latest.name} · {String(r.latest.at || '').slice(0, 16).replace('T', ' ')}
                  </div>
                )}
                {r.flaky?.length ? (
                  <div style={{ marginTop: 7, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ font: `500 10.5px ${MONO}`, color: PURPLE, textTransform: 'uppercase', letterSpacing: '0.6px' }}>flaky</span>
                    {r.flaky.map(f => (
                      <span key={f.job} style={{ font: `400 11px ${MONO}`, color: INK, background: '#bc8cff1a', border: `1px solid #bc8cff33`, borderRadius: 999, padding: '2px 9px' }}>
                        {f.job} <span style={{ color: MUTE }}>· {f.fails}× red-then-green</span>
                      </span>
                    ))}
                    <Btn tone={MUTE} onClick={() => copy(`Flaky CI in ${r.repo}: ${r.flaky.map(f => `${f.job} (${f.fails}× red→green on the same SHA)`).join(', ')}. Flake rate ${Math.round((r.flakeRate || 0) * 100)}% over 30d — worth a hardening ticket.`, 'flake summary copied')}>⧉ copy flake summary</Btn>
                  </div>
                ) : null}
              </>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}
const Metric = ({ v, l, tone }) => (
  <span style={{ font: `400 11px ${MONO}`, color: MUTE, whiteSpace: 'nowrap' }}>
    <b style={{ font: `600 13px ${MONO}`, color: tone || INK }}>{v}</b> {l}
  </span>
)
