import React, { useEffect, useMemo, useState } from 'react'
import { api } from './api.js'
import Skeleton from './Skeleton.jsx'
import { CountUp, Draw } from './anim.jsx'

// A number that counts up on mount — but ONLY when it is a real number. This app renders honest nulls
// (a suppressed / not-configured / stale value is '—', never a fake 0), so anything non-numeric is passed
// straight through to its null state and never animated toward zero.
const Num = ({ value, ...rest }) =>
  typeof value === 'number' && Number.isFinite(value) ? <CountUp value={value} {...rest} /> : value

// Overview — the landing page answers ONE question: what needs a human today?
//
// DELETED (all four personas asked for this, independently):
//   · the gamification layer — Pilot Level, XP bar, 🔥 streak, the 10 achievement badges. XP was
//     literally all-time assistant MESSAGE COUNT: the fastest way to level up was a long, thrashing,
//     unproductive conversation. It rewarded exactly the behaviour the tool exists to reduce.
// DEMOTED (moved, not deleted):
//   · Setup-health ring / Level / Specificity / Quality distribution → Capabilities, as an authoring
//     aid. All three rendered the same static frontmatter heuristic: a linter cosplaying as a metric.
//     The metric that replaced it is fires × always-on cost (Capabilities → ROI ledger).
//   · "cache saved $" → Harness → Sessions. An estimate × an estimate against a counterfactual that
//     never happened, that only ever goes up. No decision hangs on it.
//   · Inventory table → Capabilities. Tool-usage bars / model bars / the 18-week output-token heatmap
//     → Harness → Usage (the heatmap is a green-squares clone measuring "was he typing").
// RERANKED: Top projects sorted by SESSIONS, not by output tokens (which rewarded whichever project
//   made Claude write the most text).
const A = '#d97757'
const PROJ_COLORS = ['#5eb3f6', '#3fb96a', '#8b7cf6', '#e8a06a', '#d97757', '#c98bf6']
const RED = '#e5484d', GOLD = '#e5a03a', GREEN = '#3fb96a'
const MONO = "'IBM Plex Mono', monospace"
const HEAD = "'Space Grotesk', sans-serif"
const fmtTok = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n)))
const fmtDur = ms => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m` : `${m}m` }
const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago' }
const d1 = n => (Math.round(n * 10) / 10).toFixed(1)
const pctl = (arr, q) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((s.length - 1) * q))] }

const sparkPts = (arr, h = 26) => {
  const mx = Math.max(...arr), mn = Math.min(...arr), rng = mx - mn || 1, n = arr.length
  return arr.map((v, i) => `${((i / (n - 1)) * 100).toFixed(1)},${((h - 2) - ((v - mn) / rng) * (h - 4)).toFixed(1)}`).join(' ')
}
const Spark = ({ data, color, h = 26, className = 'spark' }) => (
  <svg viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" className={className} style={{ height: h }}>
    <Draw><polyline points={sparkPts(data, h)} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" /></Draw>
  </svg>
)

function Kpi({ label, tag, value, sub, accent, data, delay, onClick, hint }) {
  return (
    <div className={`kpi${onClick ? ' press' : ''}`} style={{ animationDelay: delay, cursor: onClick ? 'pointer' : undefined }} onClick={onClick} title={hint}>
      <div className="kpi-label"><span>{label}</span>{tag && <span className="kpi-tag" style={tag.color ? { color: tag.color, background: tag.color + '22' } : tag.dim ? { color: '#8a807a', background: 'rgba(255,255,255,0.05)' } : null}>{tag.text}</span>}</div>
      <div className="kpi-value"><Num value={value} /></div>
      <div className="kpi-sub">{sub}</div>
      {data && data.length > 1 && <Spark data={data} color={accent} />}
    </div>
  )
}

// ---------- 2: the five delivery tiles (plane A — JIRA + GitHub, team-visible artifacts) ----------
const weekKey = t => { const d = new Date(t); const day = (d.getUTCDay() + 6) % 7; return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10) }

function DeliveryTiles({ snap, onNav }) {
  const t = useMemo(() => {
    if (!snap?.available) return null
    const issues = snap.issues || [], prs = snap.prs || []
    const now = Date.now(), D = n => now - n * 86400_000
    const active = issues.filter(i => i.active)
    const atRisk = active.filter(i => i.rec?.atRisk)
    const closedIn = (from, to) => issues.filter(i => i.live && i.closedAt && Date.parse(i.closedAt) >= from && Date.parse(i.closedAt) < to)
    const shipped30 = closedIn(D(30), now)
    // 12-week shipped sparkline
    const wks = {}
    for (let w = 11; w >= 0; w--) wks[weekKey(D(w * 7))] = 0
    for (const i of closedIn(D(84), now)) { const k = weekKey(Date.parse(i.closedAt)); if (k in wks) wks[k]++ }
    const cyc = list => list.map(i => i.delivery).filter(n => typeof n === 'number' && n >= 0)
    const cur = cyc(closedIn(D(30), now)), prev = cyc(closedIn(D(60), D(30)))
    const p50 = pctl(cur, 0.5), p90 = pctl(cur, 0.9), p50prev = pctl(prev, 0.5)
    const openPrs = prs.filter(p => p.state !== 'Merged' && p.state !== 'Closed')
    const noReview = openPrs.filter(p => !(p.reviewEvents || []).length)
    const oldestPr = openPrs.length ? Math.max(...openPrs.map(p => p.openDays || 0)) : 0
    const worstRisk = atRisk.length ? Math.max(...atRisk.map(i => -(i.rec?.remaining || 0))) : 0
    return {
      inFlight: active.length, atRisk: atRisk.length, worstRisk,
      shipped30: shipped30.length, spark: Object.values(wks),
      pts30: shipped30.reduce((s, i) => s + (i.pts || 0), 0),
      p50, p90, delta: p50 != null && p50prev != null ? p50 - p50prev : null, n: cur.length,
      openPrs: openPrs.length, noReview: noReview.length, oldestPr,
    }
  }, [snap])

  if (!snap) return <div className="kpi-grid">{[0, 1, 2, 3, 4].map(i => <div className="kpi" key={i}><div className="kpi-label"><span>delivery</span></div><div className="kpi-value" style={{ color: '#5a514a' }}>…</div><div className="kpi-sub">reading JIRA + GitHub…</div></div>)}</div>
  if (!snap.available) return (
    <div className="panel" style={{ borderColor: 'rgba(229,160,58,0.3)' }}>
      <h3>Delivery <span className="muted">not configured</span></h3>
      <p className="small" style={{ marginTop: 0 }}>The delivery tiles read <code>/api/eng/snapshot</code> — {snap.reason || snap.error || 'JIRA credentials / gh auth are not wired'}. Nothing is fabricated here: no snapshot, no numbers.</p>
    </div>
  )
  const go = () => onNav?.('delivery')
  return (
    <div className="kpi-grid">
      <Kpi label="in flight" delay=".02s" accent={A} onClick={go} hint="active tickets — JIRA, team-visible"
        value={t.inFlight} tag={t.atRisk ? { text: `${t.atRisk} at risk`, color: RED } : { text: 'on budget', color: GREEN }}
        sub={t.atRisk ? `worst is ${d1(t.worstRisk)}d past its stage budget` : 'nothing past its stage budget'} />
      <Kpi label="shipped · 30d" delay=".06s" accent={GREEN} onClick={go} data={t.spark} hint="tickets that reached Live/Closed · 12-week trend"
        value={t.shipped30} tag={{ text: `${t.pts30} pts`, dim: true }} sub="12-week trend" />
      <Kpi label="cycle time" delay=".1s" accent="#8b7cf6" onClick={go} hint="working days, first In Progress → live. p50/p90 over the last 30d vs the 30d before it."
        value={t.p50 == null ? '—' : `${d1(t.p50)}d`}
        tag={t.delta == null ? { text: 'n<1', dim: true } : { text: `${t.delta > 0 ? '+' : ''}${d1(t.delta)}d`, color: t.delta > 0 ? RED : GREEN }}
        sub={t.p50 == null ? 'nothing shipped in 30d' : `p90 ${d1(t.p90)}d · n=${t.n}`} />
      <Kpi label="at-risk commitments" delay=".14s" accent={GOLD} onClick={go} hint="tickets past the budget for the stage they are sitting in"
        value={t.atRisk} tag={{ text: `of ${t.inFlight}`, dim: true }}
        sub={t.atRisk ? 'each one has a nudge line in the Inbox' : '✓ nothing over budget'} />
      <Kpi label="review queue" delay=".18s" accent={t.noReview ? RED : GREEN} onClick={go} hint="open PRs · oldest wait in working days"
        value={t.openPrs} tag={t.noReview ? { text: `${t.noReview} unreviewed`, color: RED } : { text: 'all seen', color: GREEN }}
        sub={t.openPrs ? `oldest has waited ${d1(t.oldestPr)} working days` : 'no open PRs'} />
    </div>
  )
}

// ---------- 4: cross-repo CI strip — a red badge when main is red ----------
function CiStrip({ onNav }) {
  const [ci, setCi] = useState(null)
  useEffect(() => { api.get('/api/ci/health?days=14').then(setCi).catch(() => {}) }, [])
  if (!ci || !ci.repos?.length) return null
  const red = ci.repos.filter(r => r.mainRed)
  return (
    <div className="panel" style={{ animationDelay: '.22s', borderColor: red.length ? 'rgba(229,72,77,0.35)' : undefined, background: red.length ? 'linear-gradient(90deg, rgba(229,72,77,0.09), rgba(28,24,21,0.55))' : undefined }}>
      <div className="panel-head" style={{ marginBottom: 10 }}>
        <h3>CI health <span className="muted">default branch · {ci.days}d · {ci.repos.length} repo{ci.repos.length === 1 ? '' : 's'}</span></h3>
        {red.length > 0 && <span style={{ font: `700 10px ${MONO}`, letterSpacing: '0.08em', padding: '4px 9px', borderRadius: 6, color: '#fff', background: RED }}>MAIN IS RED</span>}
        <button className="mini" style={{ marginTop: 0 }} onClick={() => onNav?.('delivery')}>open CI</button>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {ci.repos.map(r => (
          <a key={r.repo} href={`https://github.com/${r.repo}/actions`} target="_blank" rel="noreferrer" className="lift"
            style={{ flex: '1 1 260px', minWidth: 0, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 13px', borderRadius: 12, border: `1px solid ${r.mainRed ? RED + '66' : 'rgba(255,255,255,0.06)'}`, background: 'rgba(255,255,255,0.02)' }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, flexShrink: 0, background: r.error ? '#6a615a' : r.mainRed ? RED : GREEN, boxShadow: `0 0 8px ${r.mainRed ? RED : GREEN}` }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: `500 12.5px ${MONO}`, color: '#eee3da', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.repo}</div>
              <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>
                {r.error ? r.error.slice(0, 40)
                  : r.failureRate == null ? `no completed runs on ${r.branch} in ${ci.days}d`
                    : <><CountUp value={Math.round(r.failureRate * 100)} />% fail · {r.flaky.length} flaky · {r.medianDurationMin ?? '—'}m median</>}
              </div>
            </div>
            {r.mainRed && <span style={{ font: `700 9px ${MONO}`, color: RED, flexShrink: 0 }}>RED</span>}
          </a>
        ))}
      </div>
      {!ci.ghAvailable && <p className="small">gh CLI is not authenticated — CI health is unavailable, not zero.</p>}
    </div>
  )
}

export default function Overview({ onNav }) {
  const [usage, setUsage] = useState(null)
  const [usageErr, setUsageErr] = useState(null)
  const [snap, setSnap] = useState(null)
  const [projects, setProjects] = useState([])
  const [pins, setPins] = useState([])
  const [memory, setMemory] = useState(null)
  const [openMem, setOpenMem] = useState(null)
  const [cap, setCap] = useState(null)
  const [pq, setPq] = useState(null)   // prompt-quality rating (from main); showAch went with the deleted achievement wall

  useEffect(() => {
    api.get('/api/usage').then(setUsage).catch(e => setUsageErr(e.message))
    api.get('/api/eng/snapshot?project=all').then(setSnap).catch(() => setSnap({ available: false, reason: 'the eng snapshot could not be read' }))
    api.get('/api/capabilities').then(setCap).catch(() => {})
    api.get('/api/promptcheck?source=claude').then(setPq).catch(() => {})
    api.get('/api/projects').then(ps => {
      setProjects(ps)
      const cur = ps.find(p => p.current)
      if (cur) api.get('/api/memory/recent?path=' + encodeURIComponent(cur.path)).then(setMemory).catch(() => {})
    }).catch(() => {})
    api.get('/api/pins').then(setPins).catch(() => {})
  }, [])

  const ab = usage?.activeBlock
  const d = usage?.daily || []
  const last10 = key => d.slice(-10).map(x => x[key])
  // RERANKED: sessions, not output tokens. Ranking by tokens rewarded whichever project made Claude type most.
  const top = useMemo(() => [...projects.filter(p => p.usage)].sort((a, b) => (b.sessions || 0) - (a.sessions || 0) || (b.commits || 0) - (a.commits || 0)).slice(0, 4), [projects])

  if (!usage && !usageErr && !snap) return <Skeleton tiles={5} rows={6} />

  return (
    <div className="overview">
      <DeliveryTiles snap={snap} onNav={onNav} />
      <CiStrip onNav={onNav} />

      {cap?.headline?.deadCount > 0 && (
        <div className="panel" style={{ animationDelay: '.24s', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', flexShrink: 0, background: 'rgba(229,160,58,0.14)', color: GOLD, font: `600 14px ${HEAD}` }}>✦</span>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ font: `600 13.5px ${HEAD}`, color: '#f2ebe4' }}>You pay <CountUp value={cap.headline.alwaysOnTokens} format={n => Math.round(n).toLocaleString()} /> tok every session for {cap.items.length} capabilities.</div>
            <div style={{ font: `400 11.5px ${MONO}`, color: '#8a807a', marginTop: 3 }}>
              <b style={{ color: RED }}><CountUp value={cap.headline.deadCount} /> have never fired</b> ({cap.headline.deadTokens.toLocaleString()} tok/session) · {cap.headline.coldCount} cold · {cap.headline.hotCount} hot
            </div>
          </div>
          <button className="mini" style={{ marginTop: 0 }} onClick={() => onNav?.('capabilities')}>open the ROI ledger →</button>
        </div>
      )}

      <div className="kpi-grid">
        <Kpi label="5h output" tag={ab ? { text: `${ab.msgs} msgs` } : { text: 'idle', dim: true }} accent={A} delay=".26s"
          value={ab ? fmtTok(ab.out) : '—'} sub={ab ? `resets ${fmtDur(ab.end - Date.now())}` : usageErr || 'no active block'} data={usage && last10('out')} />
        <Kpi label="lines · 7d" tag={{ text: `+${fmtTok(usage?.kpis.lines7d.add || 0)}` }} accent={GREEN} delay=".3s"
          value={usage ? fmtTok(usage.kpis.lines7d.add + usage.kpis.lines7d.del) : '…'}
          sub={usage ? `+${fmtTok(usage.kpis.lines7d.add)} · −${fmtTok(usage.kpis.lines7d.del)} (edits)` : ''} data={usage && last10('lines')} />
        <Kpi label="tool calls" tag={{ text: 'today' }} accent="#8b7cf6" delay=".34s"
          value={usage ? fmtTok(usage.kpis.toolCallsToday) : '…'} sub={usage ? `${fmtTok(usage.kpis.toolCallsTotal)} all-time` : ''} data={usage && last10('tools')} />
        <Kpi label="sessions" tag={{ text: '30d', dim: true }} accent="#e8a06a" delay=".38s" onClick={() => onNav?.('harness')}
          value={usage ? usage.kpis.sessions30 : '…'} sub={usage ? `${usage.activeDays} active days · open the ledger` : ''} data={usage && last10('msgs')} />
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: '1.2fr 1fr' }}>
        <div className="panel" style={{ animationDelay: '.42s' }}>
          <h3>Top projects <span className="muted">by sessions</span></h3>
          <div className="mini-list">
            {top.map((p, i) => (
              <div className="mini-row" key={p.path}>
                <span className="mini-sq" style={{ background: PROJ_COLORS[i % 6] }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mini-name">{p.name}</div>
                  <div className="mini-meta">{p.sessions} sessions{p.commits ? ` · ${p.commits} commits` : ''}</div>
                </div>
                <Spark data={p.usage.spark} color={PROJ_COLORS[i % 6]} h={24} className="" />
                <span className="mini-val">{p.sessions}</span>
              </div>
            ))}
            {top.length === 0 && <p className="small" style={{ marginTop: 0 }}>no project usage recorded yet</p>}
          </div>
        </div>
        <div className="panel" style={{ animationDelay: '.46s' }}>
          <div className="panel-head">
            <h3>Recent sessions {pins.length > 0 && <span className="muted">+ {pins.length} pinned</span>}</h3>
            <button className="mini" style={{ marginTop: 0 }} onClick={() => onNav?.('harness')}>full ledger →</button>
          </div>
          {pins.slice(0, 3).map(p => (
            <div className="sess-row" key={p.sessionId}>
              <span style={{ color: GOLD, flexShrink: 0 }}>★</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mini-name">{p.label || p.title || p.sessionId}</div>
                <div className="mini-meta">{(p.cwd || '').split('/').pop()} · resume from Chat{p.configVersion ? ` · cfg ${p.configVersion}` : ''}</div>
              </div>
            </div>
          ))}
          {(usage?.recentSessions || []).filter(s => !pins.some(p => p.sessionId === s.sessionId)).map((s, i) => (
            <div className="sess-row" key={s.sessionId || i}>
              <span className="sess-dot" style={{ background: PROJ_COLORS[i % 6] }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mini-name">{s.proj}</div>
                <div className="mini-meta">{fmtTok(s.out)} tok · {s.msgs} msgs · {s.toolCalls} tools</div>
              </div>
              <span className="mini-meta">{ago(s.mtime)}</span>
            </div>
          ))}
        </div>
      </div>

      {memory?.items?.length > 0 && (
        <div className="panel" style={{ animationDelay: '.5s' }}>
          <h3>◆ Memory <span className="muted">{memory.project} · {memory.items.length} recalled · your past self</span></h3>
          <div className="mini-list">
            {memory.items.map(m => {
              const c = { user: '#8a807a', feedback: '#e8a06a', project: '#5eb3f6', reference: GREEN, memory: '#c98bf6' }[m.type] || '#c98bf6'
              const open = openMem === m.path
              return (
                <div key={m.path} className="mini-row" style={{ alignItems: 'flex-start', cursor: 'pointer', flexWrap: 'wrap' }} onClick={() => setOpenMem(open ? null : m.path)}>
                  <span className="mini-sq" style={{ background: c, marginTop: 4 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mini-name">{m.name} <span className="chip" style={{ borderColor: c + '55', color: c }}>{m.type}</span></div>
                    <div className="mini-meta" style={{ whiteSpace: open ? 'pre-wrap' : 'nowrap', overflow: open ? 'visible' : 'hidden', textOverflow: 'ellipsis' }}>
                      {open ? (m.excerpt + (m.excerpt.length >= 600 ? '…' : '')) : (m.description || m.excerpt.slice(0, 90))}
                    </div>
                  </div>
                  <span className="mini-meta" style={{ flexShrink: 0 }}>{ago(m.mtime)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {pq?.dimensions?.length > 0 && (() => {
        const c = pq.avg >= 8 ? GREEN : pq.avg >= 6 ? GOLD : RED
        const weakest = [...pq.dimensions].sort((a, b) => a.score - b.score)[0]
        return (
          <div className="panel" style={{ animationDelay: '.52s' }}>
            <div className="panel-head">
              <h3>✍ Prompt quality <span className="muted">how you prompt Claude Code{pq.available ? '' : ' · baseline — refresh in Authoring'}</span></h3>
              <button className="mini" style={{ marginTop: 0 }} onClick={() => onNav?.('authoring')}>open →</button>
            </div>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ font: `700 30px ${MONO}`, color: c }}>{pq.avg}<span style={{ color: '#7a716a', fontWeight: 400, fontSize: 12 }}>/10</span></div>
              <div style={{ display: 'flex', gap: 5, flex: 1, minWidth: 200 }}>
                {pq.dimensions.map((dm, i) => (
                  <div key={i} title={`${dm.name}: ${dm.score}/10`} style={{ flex: 1, height: 28, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                    <div style={{ height: `${dm.score * 10}%`, borderRadius: 3, background: dm.score >= 8 ? GREEN : dm.score >= 6 ? GOLD : RED, opacity: 0.85 }} />
                  </div>
                ))}
              </div>
              <div style={{ font: `400 11px ${MONO}`, color: '#8a807a', minWidth: 180 }}>
                weakest: <span style={{ color: RED }}>{weakest.name}</span> ({weakest.score}/10)
              </div>
            </div>
          </div>
        )
      })()}

      {/* The reward, deliberately at the foot of the page — after the work that needs a human, not above it.
          Your own body of work over your own past: level, XP, streak, closest badge. Self-only, no leaderboard.
          The full wall lives one click away so it never competes with the delivery tiles for the fold. */}
    </div>
  )
}
