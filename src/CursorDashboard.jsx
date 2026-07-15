import React, { useEffect, useMemo, useState } from 'react'
import { api, toast, tildify, fmtDate } from './api.js'
import { RunWindow } from './QuickActions.jsx'
import { DataTable, Facts, StackedBar, Bars } from './charts.jsx'
import { Columns } from './cursor/charts.jsx'
import { GameStats, useGame, CountUp, Stagger } from './game/index.js'

const MONO = "'IBM Plex Mono', monospace"
const HEAD = "'Space Grotesk', sans-serif"
const PANEL = { background: 'rgba(28,24,21,0.55)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: '18px 20px', backdropFilter: 'blur(10px)' }
const ACCENT = '#7cc4f7' // cursor mode is blue so you always know which dashboard you're in
const WARN = '#e5a03a'
const BAD = '#e5484d'
const OK = '#3fb96a'
const fmtNum = n => n == null ? '—' : n >= 1000 ? (n / 1000).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(n)
const money = c => c == null ? null : '$' + (c / 100).toFixed(2)
// CountUp formatter — only ever reached with a real, non-null cents value (the Stat `num` branch guards
// null before the number ever animates), so it never needs to invent a $0.00 for missing data.
const dollars = c => '$' + (c / 100).toFixed(2)
const pctS = f => f == null ? '—' : (f * 100).toFixed(1) + '%'
const SCOPE = { always: ['#7cc4f7', 'always loaded'], glob: [WARN, 'on glob match'], 'agent-requested': ['#7a716a', 'agent-requested'] }
const short = f => f ? tildify(f).split('/').pop() : '—'
// two repos can share a basename (a clone of the same repo in another dir) and Bars keys by label,
// so bar labels carry the parent dir and are made unique before they are handed over.
const uniqLabels = rows => {
  const seen = {}
  return rows.map(r => {
    const base = r.folder ? tildify(r.folder).split('/').slice(-2).join('/') : (r.workspaceId || 'unknown')
    seen[base] = (seen[base] || 0) + 1
    return seen[base] > 1 ? `${base} (${seen[base]})` : base
  })
}

const Chip = ({ text, color = '#7a716a' }) => <span style={{ font: `500 10px ${MONO}`, color, border: `1px solid ${color}55`, borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap' }}>{text}</span>
const Muted = ({ children }) => <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>{children}</div>
const H = ({ children, right }) => (
  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
    <div style={{ font: `600 13px ${HEAD}`, color: '#e5dbd2' }}>{children}</div>
    <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'baseline' }}>{right}</div>
  </div>
)
// item 11: the escape hatch, on every panel — the exact backing rows for what you are looking at.
const Raw = ({ href }) => <a href={href} target="_blank" rel="noreferrer" title="the exact rows behind this panel" style={{ font: `500 10px ${MONO}`, color: '#5c554f', textDecoration: 'none', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, padding: '2px 6px' }}>{'[{ }]'}</a>

// A tile that REFUSES to print a zero it does not have. The number animates in ONLY when it is a real
// number: pass `num` (raw value) + `fmt` and it CountUps; pass a pre-formatted `val` for non-numeric
// text. When BOTH are null the tile renders `missing`, never a $0.00 that a CountUp raced up to from 0.
// This is the founding principle wired into the primitive: a null cannot be animated into a zero here,
// because the num branch is never entered when num == null.
const Stat = ({ label, val, num, fmt, sub, color, missing }) => (
  <div className="lift" style={{ ...PANEL, padding: '14px 18px', flex: 1, minWidth: 150 }}>
    {num != null
      ? <div style={{ font: `700 24px ${HEAD}`, color: color || '#e5dbd2' }}><CountUp value={num} format={fmt || (n => String(Math.round(n)))} /></div>
      : val != null
        ? <div style={{ font: `700 24px ${HEAD}`, color: color || '#e5dbd2' }}>{val}</div>
        : <div style={{ font: `600 12.5px ${MONO}`, color: WARN, padding: '5px 0 3px' }}>{missing || 'no data'}</div>}
    <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>{label}</div>
    {sub && <div style={{ font: `400 10px ${MONO}`, color: '#5c554f', marginTop: 3 }}>{sub}</div>}
  </div>
)
const Note = ({ children, color = WARN }) => (
  <div style={{ border: `1px solid ${color}55`, background: `${color}12`, borderRadius: 10, padding: '10px 12px', font: `400 11.5px ${MONO}`, color: '#d8cfc7', lineHeight: 1.5 }}>
    <span style={{ color, fontWeight: 700 }}>⚠ </span>{children}
  </div>
)

// one fetch hook — every panel takes the same window, so every panel re-fetches when it changes
function useApi(path, deps = []) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    let live = true
    setData(null); setErr(null)
    if (!path) return
    api.get(path).then(d => live && setData(d)).catch(e => live && setErr(e.message))
    return () => { live = false }
  }, deps.length ? deps : [path])
  return [data, err]
}
const Loading = ({ what }) => <Muted>{what}</Muted>
// A shimmer skeleton (the `.skel` class carries the shimmer; reduced-motion freezes it to a static
// block). Used in place of a bare text spinner on the endpoints that are painfully slow cold —
// /outcomes (10–68s), /project (~27s), the first /search (~30s FTS build), and the 2 GB truth read.
const Skel = ({ h = 34, w = '100%', r = 10, style }) => <div className="skel" style={{ height: h, width: w, borderRadius: r, ...style }} />
const ColdLoading = ({ what, rows = 4, tiles = 3 }) => (
  <div style={{ display: 'grid', gap: 12 }}>
    {tiles > 0 && <div style={{ display: 'flex', gap: 12 }}>{Array.from({ length: tiles }, (_, i) => <Skel key={i} h={62} r={14} style={{ flex: 1 }} />)}</div>}
    {Array.from({ length: rows }, (_, i) => <Skel key={i} h={32} style={{ opacity: 1 - i * 0.12 }} />)}
    <Muted>{what}</Muted>
  </div>
)
const ChartSkel = ({ what }) => (
  <div style={{ display: 'grid', gap: 10 }}>
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 96 }}>
      {Array.from({ length: 28 }, (_, i) => <Skel key={i} h={20 + ((i * 37) % 70)} r={3} style={{ flex: 1 }} />)}
    </div>
    <Muted>{what}</Muted>
  </div>
)

// ---------------------------------------------------------------------------
// The game block on the Cursor main page. It holds the same line the whole dashboard holds: it tells
// the truth about a plane with no recent data instead of dressing it up.
//
// The level, XP and streak are GLOBAL and real — one person's whole body of work across every plane —
// so GameStats renders them earned. But the Cursor plane itself reports 0 XP from 0 recent events, and
// that is not a broken counter: XP is minted from PRICED outcomes, and this machine's local usageData
// stops on 2026-01-25, so there is nothing recent to score. The two Cursor badges ARE real — they fired
// off Cursor's own accept-rate counters before the data went stale — so we show them, unlocked. No fake
// 0 XP with a shiny bar; the honest empty is the point.
const CURSOR_STALE_DATE = '2026-01-25'
function CursorGame() {
  const { game } = useGame('cursor')
  const badges = (game?.achievements || []).filter(a => a.dash === 'cursor')
  const TIERS = { bronze: '#c98b5e', silver: '#b9c2cc', gold: '#e5a03a' }
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* Frame FIRST, so the "Recently earned" list GameStats shows below reads as your global body of
          work across every plane — not as recent Cursor activity, of which there is none. */}
      <Note>
        Your level, XP and streak below are <b>global and earned</b> — your whole body of work across every plane.
        The <b>Cursor plane itself scored 0 XP from 0 recent events</b>, and that is the honest reading, not a broken tile:
        XP is minted from priced outcomes, and this machine's local <span style={{ color: '#e5dbd2' }}>usageData ends {CURSOR_STALE_DATE}</span>,
        so there is no recent Cursor activity to score. The two Cursor badges are real — they fired off Cursor's own accept-rate counters before the data went stale.
      </Note>
      <GameStats dashboard="cursor" />
      <div style={PANEL}>
        <H right={<Chip text="self-only · no leaderboard" color="#7a716a" />}>Cursor badges — 2 of 2 earned</H>
        {badges.length === 0
          ? <Muted>loading badges…</Muted>
          : <Stagger tag="div" step={60} style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {badges.map(b => (
                <div key={b.id} className="lift" style={{
                  display: 'flex', gap: 12, alignItems: 'center', flex: '1 1 240px', minWidth: 220,
                  padding: '12px 14px', borderRadius: 12,
                  border: `1px solid ${(TIERS[b.tier] || ACCENT)}55`,
                  background: `linear-gradient(150deg, ${(TIERS[b.tier] || ACCENT)}18, rgba(255,255,255,0.015))`,
                }}>
                  <span style={{ fontSize: 26, filter: `drop-shadow(0 0 9px ${(TIERS[b.tier] || ACCENT)}88)` }}>{b.icon}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ font: `600 13.5px ${HEAD}`, color: '#e5dbd2' }}>{b.name} <span style={{ font: `600 9.5px ${MONO}`, letterSpacing: '0.1em', textTransform: 'uppercase', color: TIERS[b.tier] || ACCENT }}>{b.tier}</span></div>
                    <div style={{ font: `400 11px ${MONO}`, color: '#8a807a' }}>{b.desc}</div>
                    <div style={{ font: `600 10.5px ${MONO}`, color: OK, marginTop: 3 }}>✓ unlocked{b.unlockedAt ? ' · ' + new Date(b.unlockedAt).toISOString().slice(0, 10) : ''}</div>
                  </div>
                </div>
              ))}
            </Stagger>}
        <div style={{ font: `400 10px ${MONO}`, color: '#5c554f', marginTop: 10, lineHeight: 1.5 }}>
          Both are already earned, so there is no "closest badge" left on the Cursor plane to chase — and no XP to be minted here until Cursor starts writing priced usageData again.
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// item 1 — the truth pass. Five tiles deleted (see `dead[]` below, straight from the server, each
// with the evidence that killed it) and the 30/90-day trend the old client computed and threw away.
// ---------------------------------------------------------------------------
function Home({ q, days }) {
  const [t] = useApi(`/api/cursor/truth?${q}`, [q])
  const [o] = useApi('/api/cursor/overview')
  const [sp] = useApi(`/api/cursor/spend?${q}`, [q])
  const [ac] = useApi(`/api/cursor/accept?${q}`, [q])
  const [tl] = useApi(`/api/cursor/tools?${q}`, [q])
  const [cx] = useApi(`/api/cursor/context?${q}`, [q])
  if (o && !o.available) return <Muted>Cursor is not installed on this machine (no state.vscdb found).</Muted>
  const d = t?.trend?.deltaPct
  const half = Math.floor((t?.trend?.days.length || 0) / 2)
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <CursorGame />

      {/* headline tiles: spend, accept rate, wasted turns, always-context tax. Not lines typed.
          Each CountUp is fed a raw `num` that is null exactly when the datum is missing, so the stale
          spend tile renders "stale — see Spend", never a $0.00 racing up from zero. */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Stat label={`spend · last ${days}d`} num={sp?.totals.cents} fmt={c => '$' + (c / 100).toFixed(2)} color={ACCENT}
          missing={sp?.coverage.stale ? 'stale — see Spend' : 'no data'}
          sub={sp?.coverage.stale ? `local usageData stops ${new Date(sp.coverage.lastPricedAt).toISOString().slice(0, 10)}` : sp ? `${sp.pricedSessions} priced sessions` : ''} />
        <Stat label="accept rate (Cursor's own counters)" num={ac ? ac.totals.acceptRate * 100 : null} fmt={v => v.toFixed(1) + '%'} color={OK}
          sub={ac ? `${fmtNum(ac.totals.accepted)} of ${fmtNum(ac.totals.suggested)} suggested lines` : ''} />
        <Stat label="wasted turns (tool errors)" num={tl?.totals.errors} fmt={fmtNum} color={BAD}
          sub={tl ? `of ${fmtNum(tl.totals.calls)} tool calls · all-history` : ''} />
        <Stat label="always-context tax" num={cx?.totals.always} fmt={v => fmtNum(v) + ' tok'} color={WARN}
          sub="paid on every single chat" />
      </div>

      <div style={PANEL}>
        <H right={<>
          {d != null && <Chip text={`${d > 0 ? '▲' : d < 0 ? '▼' : ''} ${d > 0 ? '+' : ''}${d}% vs prior ${half}d`} color={d > 0 ? OK : d < 0 ? WARN : '#7a716a'} />}
          <Raw href={`/api/cursor/truth?${q}`} />
        </>}>Sessions per day — last {days} days</H>
        {!t ? <ChartSkel what="parsing Cursor's database… (first load reads a 2 GB sqlite file)" /> : (
          <>
            <Columns items={t.trend.days.map(x => ({ label: x.day.slice(5), value: x.sessions, hint: `${x.day}: ${x.sessions} sessions` }))} color={ACCENT} />
            <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a', marginTop: 8 }}>
              <CountUp value={t.trend.current} /> sessions in the recent half · <CountUp value={t.trend.previous} /> in the one before it
            </div>
          </>
        )}
      </div>

      {/* demoted, per the truth pass: vanity counters that only ever go up */}
      {o && (
        <div style={{ font: `400 10.5px ${MONO}`, color: '#5c554f' }}>
          {fmtNum(o.messages)} messages · {o.workspaces} workspaces · {o.activeDays} active days · first {isFinite(o.first) ? fmtDate(o.first) : '—'} · last {isFinite(o.last) ? fmtDate(o.last) : '—'}
        </div>
      )}

      {t?.dead?.length > 0 && (
        <details style={{ ...PANEL }}>
          <summary style={{ font: `600 12px ${HEAD}`, color: '#9a8f86', cursor: 'pointer' }}>
            {t.dead.length} tiles deleted in the truth pass — the evidence
          </summary>
          <Stagger tag="div" step={40} style={{ display: 'grid', gap: 8, marginTop: 10 }}>
            {t.dead.map(x => (
              <div key={x.tile} style={{ borderLeft: `2px solid ${BAD}`, paddingLeft: 10 }}>
                <div style={{ font: `600 11.5px ${MONO}`, color: '#e5dbd2' }}>{x.tile} <Chip text={x.verdict.split(' ')[0]} color={BAD} /></div>
                <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a', lineHeight: 1.5 }}>{x.where} — {x.why}</div>
              </div>
            ))}
          </Stagger>
        </details>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// item 2 + item 12 — spend, waste, and the model mix BY COST.
// THE RULE: usageData stopped being written on 2026-01-25. A window after that is NOT $0 spent,
// it is no data. Every window-scoped money figure here falls back to the PRICED ERA and says so.
// ---------------------------------------------------------------------------
function Spend({ q, days }) {
  const [sp] = useApi(`/api/cursor/spend?${q}`, [q])
  // the priced era — the only window in which any money figure on this machine is true
  const eq = sp?.coverage.firstPricedAt ? `from=${sp.coverage.firstPricedAt}&to=${sp.coverage.lastPricedAt}` : null
  const [era] = useApi(sp?.coverage.stale && eq ? `/api/cursor/spend?${eq}` : null, [eq, sp?.coverage.stale])
  const [md] = useApi(sp ? `/api/cursor/models?${sp.coverage.stale && eq ? eq : q}` : null, [q, eq, sp?.coverage.stale])
  if (!sp) return <Loading what="reading local usageData…" />
  const stale = sp.coverage.stale
  const s = stale ? era : sp             // the payload whose money is real
  const label = stale ? `priced era ${new Date(sp.coverage.firstPricedAt).toISOString().slice(0, 10)} → ${new Date(sp.coverage.lastPricedAt).toISOString().slice(0, 10)}` : `last ${days}d`
  const dupes = sp.waste.dupes || []
  const saveCmd = d => {
    const name = prompt('Save this repeated prompt as a /command. Name:')
    if (!name) return
    api.post('/api/cursor/res/commands', { name }).then(r => api.put('/api/cursor/res-item', { path: r.path, content: d.text }))
      .then(() => toast(`saved /${name}`, 'success')).catch(e => toast(e.message, 'error'))
  }
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {stale && <Note>{sp.coverage.note}</Note>}

      {/* Every money figure here is `num` = raw cents, which is null in a window with no priced data.
          A null never enters the CountUp branch, so these render "no data" — the whole point of the
          stale-usageData thesis. A $0.00 counting up from zero would be strictly worse than the static
          lie this dashboard already deleted. */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Stat label={`spend · last ${days}d`} num={sp.totals.cents} fmt={dollars} missing="no data — usageData stale" color={ACCENT} />
        <Stat label="spend · 30d" num={sp.totals.cents30d} fmt={dollars} missing="no data" />
        <Stat label="spend · 90d" num={sp.totals.cents90d} fmt={dollars} missing="no data" />
        <Stat label="spend · month to date" num={sp.totals.centsMTD} fmt={dollars} missing="no data" />
        <Stat label={`spend · ${stale ? 'all-time (priced era)' : 'per 1k AI lines'}`}
          num={stale ? s?.totals.cents : sp.totals.centsPerKAiLine} fmt={dollars}
          color={OK}
          sub={stale && s ? `${sp.coverage.pricedSessionsAllTime} of ${sp.coverage.totalSessionsAllTime} sessions ever carried a price` : ''} />
      </div>

      <div style={PANEL}>
        <H right={<><Chip text={label} color={stale ? WARN : '#7a716a'} /><Raw href={`/api/cursor/spend?${stale ? eq : q}`} /></>}>Spend per day</H>
        {!s ? <Loading what="…" /> : <Columns items={s.perDay.map(x => ({ label: x.day.slice(5), value: x.cents, hint: `${x.day}: ${money(x.cents)}` }))} color={OK} valueLabel={money} />}
        {stale && <div style={{ font: `400 10px ${MONO}`, color: '#5c554f', marginTop: 6 }}>
          plotted over the priced era, not your selected window — there is nothing to plot after {new Date(sp.coverage.lastPricedAt).toISOString().slice(0, 10)}, and a flat row of zeros would be a lie.
        </div>}
      </div>

      {s && (
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
          <div style={PANEL}>
            <H right={<Chip text={label} />}>Spend by project</H>
            {s.byProject.length ? <Bars color={ACCENT} valueLabel={money}
              items={(rows => uniqLabels(rows).map((label, i) => ({ label, value: rows[i].cents, hint: `${tildify(rows[i].folder || '')} — ${money(rows[i].cents)} over ${rows[i].sessions} sessions` })))(s.byProject.slice(0, 12))} /> : <Muted>no priced sessions</Muted>}
          </div>
          <div style={PANEL}>
            <H right={<Chip text={label} />}>Spend by model — share of the bill, not share of the sessions</H>
            <DataTable maxHeight="30vh"
              columns={[
                { key: 'model', label: 'model' },
                { key: 'calls', label: 'calls', align: 'right' },
                { key: 'cents', label: '$', align: 'right', render: r => <b style={{ color: OK }}>{money(r.cents)}</b> },
                { key: 'sharePct', label: '% of bill', align: 'right', render: r => r.sharePct + '%' },
              ]}
              sort={{ key: 'cents', dir: -1 }} rows={s.byModel.map(m => ({ ...m, __key: m.model }))} />
          </div>
        </div>
      )}

      {/* WASTE — the headline of item 2 */}
      {s && (
        <div style={PANEL}>
          <H right={<Chip text={label} />}>Waste — money that produced no code</H>
          <div style={{ font: `700 17px ${HEAD}`, color: BAD, marginBottom: 4 }}>
            You spent {money(s.waste.abandoned.cents)} on {s.waste.abandoned.sessions} sessions that produced no code at all.
          </div>
          <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a', marginBottom: 10 }}>abandoned = cost &gt; 0 with linesAdded + linesRemoved == 0</div>
          {s.waste.abandoned.byProject.length > 0 && <Bars color={BAD} valueLabel={money}
            items={(rows => uniqLabels(rows).map((label, i) => ({ label, value: rows[i].cents, hint: `${rows[i].sessions} abandoned sessions` })))(s.waste.abandoned.byProject.slice(0, 8))} />}
        </div>
      )}

      <div style={PANEL}>
        <H right={<Raw href="/api/cursor/insights" />}>Repeated prompts — costed, and one click from becoming a /command</H>
        {dupes.length === 0 ? <Muted>no repeated prompts found</Muted> : <Stagger tag="div" step={35}>{dupes.slice(0, 15).map((d, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '7px 4px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <span style={{ font: `700 12px ${MONO}`, color: ACCENT, width: 34 }}>{d.count}×</span>
            <span style={{ font: `400 11.5px ${MONO}`, color: '#d8cfc7', flex: 1, overflowWrap: 'anywhere', maxHeight: 34, overflow: 'hidden' }}>{d.text}</span>
            <span style={{ font: `600 11px ${MONO}`, color: d.cents ? OK : '#5c554f', width: 64, textAlign: 'right' }}>{d.cents ? money(d.cents) : 'unpriced'}</span>
            <span style={{ font: `400 10.5px ${MONO}`, color: '#7a716a', width: 72, textAlign: 'right' }}>{d.sessions} sess</span>
            <button className="press" onClick={() => saveCmd(d)}>Save as /command</button>
          </div>
        ))}</Stagger>}
      </div>

      {/* item 12 — model mix by cost + the wall-clock wait. Latency is local plane only. */}
      {md && (
        <div style={PANEL}>
          <H right={<><Chip text={stale ? label : `last ${days}d`} color={stale ? WARN : '#7a716a'} /><Raw href={`/api/cursor/models?${stale && eq ? eq : q}`} /></>}>
            Model mix by cost, and what you spent waiting
          </H>
          <Facts items={[
            { label: 'hours waiting on turns', value: md.wait.totalHours || '—', color: WARN },
            { label: 'hours of model thinking', value: md.wait.thinkHours || '—' },
            { label: 'models used', value: md.byModel.length },
          ]} />
          <div style={{ height: 12 }} />
          <DataTable maxHeight="34vh"
            columns={[
              { key: 'model', label: 'model' },
              { key: 'cents', label: '$', align: 'right', render: r => r.cents ? money(r.cents) : <span style={{ color: '#5c554f' }}>unpriced</span> },
              { key: 'sharePct', label: '% of bill', align: 'right', render: r => r.cents ? r.sharePct + '%' : '—' },
              { key: 'turns', label: 'turns', align: 'right' },
              { key: 'p50LatencyMs', label: 'p50 wait', align: 'right', render: r => r.p50LatencyMs != null ? (r.p50LatencyMs / 1000).toFixed(0) + 's' : <span style={{ color: '#5c554f' }}>not timed</span> },
              { key: 'p90LatencyMs', label: 'p90 wait', align: 'right', render: r => r.p90LatencyMs != null ? (r.p90LatencyMs / 1000).toFixed(0) + 's' : '—' },
              { key: 'thinkHours', label: 'think hrs', align: 'right', render: r => r.thinkHours || '—' },
            ]}
            sort={{ key: 'cents', dir: -1 }} rows={md.byModel.map(m => ({ ...m, __key: m.model }))} />
          <div style={{ font: `400 10px ${MONO}`, color: '#5c554f', marginTop: 6 }}>{md.plane}</div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// items 4, 5, 6 — accept & ship rate, the join spine's ship log, and the outcomes rollups.
// ---------------------------------------------------------------------------
function Outcomes({ q, days }) {
  const [ac] = useApi(`/api/cursor/accept?${q}`, [q])
  const [sh] = useApi(`/api/cursor/ship?${q}`, [q])
  const [jo] = useApi(`/api/cursor/join?${q}`, [q])
  const [oc, ocErr] = useApi(`/api/cursor/outcomes?${q}`, [q])
  const stale = oc?.pm.tickets.every(t => !t.cents)
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* item 4 — accept rate replaces the lines-typed vanity stat */}
      <div style={PANEL}>
        <H right={<Raw href={`/api/cursor/accept?${q}`} />}>Accept rate — what survived, not what was typed</H>
        {!ac ? <ColdLoading what="reading aiCodeTracking.dailyStats…" tiles={4} rows={3} /> : (
          <>
            <Facts items={[
              { label: 'accept rate', value: pctS(ac.totals.acceptRate), color: OK },
              { label: 'lines suggested', value: fmtNum(ac.totals.suggested) },
              { label: 'lines accepted', value: fmtNum(ac.totals.accepted) },
              { label: 'days on disk', value: ac.days.length },
            ]} />
            <div style={{ height: 12 }} />
            <Columns color={OK} items={ac.weeks.map(w => ({ label: w.week.slice(5), value: w.suggested ? Math.round((w.accepted / w.suggested) * 100) : 0, hint: `${w.week}: ${w.accepted}/${w.suggested} lines accepted` }))} valueLabel={v => v + '%'} />
            <div style={{ font: `400 10px ${MONO}`, color: '#5c554f', marginTop: 8, lineHeight: 1.5 }}>
              {ac.note}. A week can exceed 100%: these are Cursor's raw counters, and a composer edit can land accepted lines it never counted as "suggested" — not smoothed, not clipped.
            </div>
          </>
        )}
      </div>

      {/* item 4 (denominator) — ship rate, keyed (repo, week). Never (person, week). */}
      <div style={PANEL}>
        <H right={<><Chip text="repo + week only — never per person" color={ACCENT} /><Raw href={`/api/cursor/ship?${q}`} /></>}>Ship rate — accepted AI lines over merged-PR additions</H>
        {!sh ? <ColdLoading what="joining cursorBlame to merged PRs…" tiles={0} rows={5} /> : !sh.engAvailable ? <Note>{sh.note || sh.error}</Note> : (
          <>
            <DataTable maxHeight="40vh"
              columns={[
                { key: 'repo', label: 'repo', render: r => r.repo.split('/').pop() },
                { key: 'week', label: 'week' },
                { key: 'shipRate', label: 'ship rate', align: 'right', render: r => r.shipRate == null
                  ? <span title={r.coverage} style={{ color: WARN }}>NO DATA</span>
                  : <b style={{ color: r.shipRate > 0.6 ? WARN : r.shipRate < 0.15 ? '#7a716a' : OK }}>{pctS(r.shipRate)}</b> },
                { key: 'mergedAdditions', label: 'merged +lines', align: 'right', render: r => fmtNum(r.mergedAdditions) },
                { key: 'scoredCommits', label: 'scored commits', align: 'right' },
                { key: 'medianReviewCycles', label: 'median review cycles', align: 'right', render: r => r.medianReviewCycles ?? '—' },
                { key: 'flag', label: 'read it beside review depth', render: r => r.flag ? <Chip text={r.flag} color={WARN} /> : '' },
              ]}
              rows={sh.cells.map(c => ({ ...c, __key: c.repo + c.week }))} />
            <div style={{ font: `400 10px ${MONO}`, color: '#5c554f', marginTop: 8, lineHeight: 1.5 }}>{sh.caveat}</div>
          </>
        )}
      </div>

      {/* item 6 — PM altitude + lead altitude, both GROUP BYs over the one join */}
      {ocErr && <Note color={BAD}>outcomes failed: {ocErr}</Note>}
      {!oc && !ocErr && <div style={PANEL}><ColdLoading what="building the join: sessions → git → branch → ticket → PR. Cold, this takes up to a minute (the eng snapshot behind it shells out to gh)…" tiles={3} rows={6} /></div>}
      {oc && (
        <>
          {oc.sources.eng?.prsUnavailable && <Note color={BAD}>{oc.sources.eng.note}</Note>}
          {oc.sources.eng?.available === false && <Note>{oc.sources.eng.note}</Note>}
          <div style={PANEL}>
            <H right={<Raw href={`/api/cursor/outcomes?${q}`} />}>Shipped tickets — what the money bought</H>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              <Stat label="cost per shipped ticket" num={stale ? null : oc.pm.costPerShippedTicket} fmt={dollars} missing="unpriced — usageData is stale" color={ACCENT} />
              <Stat label="tickets shipped in window" num={oc.pm.shippedTickets} />
              <Stat label="tickets touched by a session" num={oc.pm.tickets.length} />
            </div>
            <DataTable maxHeight="45vh"
              columns={[
                { key: 'key', label: 'ticket', render: r => <b style={{ color: ACCENT }}>{r.key}</b> },
                { key: 'type', label: 'type', render: r => r.type || '—' },
                { key: 'pts', label: 'SP', align: 'right', render: r => r.pts ?? '—' },
                { key: 'status', label: 'status', render: r => <Chip text={r.status || '—'} color={r.live ? OK : '#7a716a'} /> },
                { key: 'sessions', label: 'sessions', align: 'right' },
                { key: 'cents', label: '$', align: 'right', render: r => r.cents ? money(r.cents) : <span style={{ color: '#5c554f' }}>unpriced</span> },
                { key: 'aiLines', label: 'AI lines', align: 'right', render: r => r.aiLines || '—' },
                { key: 'commits', label: 'commits', align: 'right' },
                { key: 'devDays', label: 'dev days', align: 'right', render: r => r.devDays ?? '—' },
                { key: 'cycleDays', label: 'cycle days', align: 'right', render: r => r.cycleDays ?? '—' },
                { key: 'qaCycles', label: 'QA cycles', align: 'right', render: r => r.qaCycles ?? '—' },
                { key: 'flags', label: 'flags', render: r => r.flags.map(f => <Chip key={f} text={f} color={WARN} />) },
              ]}
              sort={{ key: 'cents', dir: -1 }} rows={oc.pm.tickets.map(t => ({ ...t, __key: t.key }))} />
          </div>

          <div style={PANEL}>
            <H right={<Chip text={oc.pm.effortMix.some(m => m.centsAvailable) ? 'dollars' : 'commits — dollars unavailable in this window'} color={WARN} />}>Effort mix by week — product / bug / toil / experimentation</H>
            <div style={{ display: 'grid', gap: 6 }}>
              {oc.pm.effortMix.map(m => {
                const src = m.centsAvailable ? m.cents : m.commits
                const total = Object.values(src).reduce((a, b) => a + b, 0)
                return (
                  <div key={m.week} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 60px', gap: 10, alignItems: 'center' }}>
                    <span style={{ font: `400 10px ${MONO}`, color: '#7a716a' }}>{m.week}</span>
                    <StackedBar legend={false} height={12} segments={[
                      { label: 'product', value: src.product, color: ACCENT },
                      { label: 'bug', value: src.bug, color: BAD },
                      { label: 'toil', value: src.toil, color: WARN },
                      { label: 'experimentation', value: src.experimentation, color: '#7a716a' },
                    ]} />
                    <span style={{ font: `400 10px ${MONO}`, color: '#5c554f', textAlign: 'right' }}>{m.centsAvailable ? money(total) : total + ' cm'}</span>
                  </div>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              {[['product', ACCENT], ['bug', BAD], ['toil (commits, no ticket)', WARN], ['experimentation (cost, zero commits)', '#7a716a']].map(([l, c]) => (
                <span key={l} style={{ font: `400 9.5px ${MONO}`, color: '#9a8f86' }}><span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 2, background: c, marginRight: 4 }} />{l}</span>
              ))}
            </div>
            <div style={{ font: `400 10px ${MONO}`, color: '#5c554f', marginTop: 8, lineHeight: 1.5 }}>
              plotted in commits, not dollars, because local usageData stopped in January — a dollars-only mix would render four flat zeros and read as "no work happened".
            </div>
          </div>

          <div style={PANEL}>
            <H right={<Chip text={`n=${oc.lead.comparison.aiHeavy.n} AI-heavy vs n=${oc.lead.comparison.rest.n}`} color={oc.lead.comparison.underpowered ? WARN : OK} />}>
              Merged PRs — do AI-heavy PRs cost extra review cycles?
            </H>
            {/* THE FEATURE IS THE REFUSAL: below the n=20 floor we print the caveat, not an empty chart. */}
            {oc.lead.comparison.underpowered
              ? <Note>{oc.lead.comparison.caveat}</Note>
              : <Facts items={[
                { label: 'AI-heavy median cycles', value: oc.lead.comparison.aiHeavy.medianReviewCycles ?? '—', color: WARN },
                { label: 'rest median cycles', value: oc.lead.comparison.rest.medianReviewCycles ?? '—' },
                { label: 'delta', value: oc.lead.comparison.delta?.reviewCycles ?? '—' },
                { label: 'AI-heavy comments/100 LOC', value: oc.lead.comparison.aiHeavy.commentsPer100Loc ?? '—' },
                { label: 'rest comments/100 LOC', value: oc.lead.comparison.rest.commentsPer100Loc ?? '—' },
              ]} />}
            <div style={{ height: 12 }} />
            <DataTable maxHeight="40vh"
              columns={[
                { key: 'pr', label: 'PR', render: r => <a href={`https://github.com/${r.pr.replace('#', '/pull/')}`} target="_blank" rel="noreferrer" style={{ color: ACCENT, textDecoration: 'none' }}>{r.pr}</a> },
                { key: 'ticketKey', label: 'ticket', render: r => r.ticketKey || '—' },
                { key: 'additions', label: '+lines', align: 'right' },
                { key: 'aiSharePct', label: 'AI share', align: 'right', render: r => r.aiSharePct != null ? r.aiSharePct + '%' : '—' },
                { key: 'cycles', label: 'review cycles', align: 'right', render: r => r.cycles ?? '—' },
                { key: 'comments', label: 'comments', align: 'right' },
                { key: 'mergeDays', label: 'merge days', align: 'right', render: r => r.mergeDays?.toFixed?.(1) ?? '—' },
              ]}
              sort={{ key: 'cycles', dir: -1 }} rows={oc.lead.prs.map(p => ({ ...p, __key: p.pr }))} />
            <div style={{ font: `400 10px ${MONO}`, color: '#5c554f', marginTop: 8 }}>
              <button onClick={() => { navigator.clipboard.writeText(oc.lead.comparison.caveat + '\n\n' + oc.lead.prs.map(p => `${p.pr} ticket=${p.ticketKey} +${p.additions} aiShare=${p.aiSharePct}% cycles=${p.cycles}`).join('\n')); toast('copied with its caveat and n\'s intact', 'success') }}>Copy to review doc</button>
            </div>
          </div>
        </>
      )}

      {/* item 5 — the spine itself, rendered raw for the IC */}
      <div style={PANEL}>
        <H right={<>
          <a href={`/api/cursor/export?kind=join&${q}`} style={{ font: `500 10px ${MONO}`, color: ACCENT, textDecoration: 'none' }}>export NDJSON</a>
          <Raw href={`/api/cursor/join?${q}`} />
        </>}>Ship log — session → commit → branch → ticket → PR</H>
        {!jo ? <ColdLoading what="running git log across every known workspace…" tiles={0} rows={6} /> : (
          <>
            <div style={{ font: `400 10px ${MONO}`, color: '#5c554f', marginBottom: 8 }}>
              {jo.sources.sessions} sessions · {jo.sources.cursorBlame.commits} commits scored by cursorBlame · {jo.rows.length} rows · {jo.plane}
            </div>
            <DataTable maxHeight="50vh"
              columns={[
                { key: 'name', label: 'session', render: r => <span title={r.sessionId} style={{ color: '#e5dbd2' }}>{(r.name || '(unnamed)').slice(0, 40)}</span> },
                { key: 'folder', label: 'repo', render: r => short(r.folder) },
                { key: 'commitSha', label: 'commit', render: r => r.commitSha ? <code style={{ color: ACCENT }}>{r.commitSha.slice(0, 7)}</code> : '—' },
                { key: 'branch', label: 'branch', render: r => (r.branch || '—').slice(0, 28) },
                { key: 'ticketKey', label: 'ticket', render: r => r.ticketKey || '—' },
                { key: 'pr', label: 'PR', render: r => r.pr ? `#${r.pr.num}` : '—' },
                { key: 'aiLines', label: 'AI lines', align: 'right', render: r => r.attribution === 'cursorBlame' ? <b style={{ color: OK }}>{r.aiLines}</b> : <span title="window-inferred — estimated from the composer's own counters, not cursorBlame">{r.aiLines || '—'}</span> },
                { key: 'humanLines', label: 'human lines', align: 'right', render: r => r.humanLines ?? '—' },
                { key: 'attribution', label: 'attribution', render: r => <Chip text={r.attribution} color={r.attribution === 'cursorBlame' ? OK : '#7a716a'} /> },
                { key: 'bucket', label: 'bucket', render: r => <Chip text={r.bucket} color={r.bucket === 'product' ? ACCENT : r.bucket === 'bug' ? BAD : WARN} /> },
              ]}
              rows={jo.rows.slice(0, 300).map((r, i) => ({ ...r, __key: r.sessionId + (r.commitSha || i) }))} />
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// item 3 + 9 + 7 — the harness itself: governance across every repo, the always-context tax,
// context pressure, and the tool failures that waste your turns.
// ---------------------------------------------------------------------------
function Governance() {
  const [ref, setRef] = useState('')
  const [g] = useApi('/api/cursor/governance' + (ref ? '?reference=' + encodeURIComponent(ref) : ''), [ref])
  const [rules] = useApi('/api/cursor/res/rules')
  const [push, setPush] = useState(null) // {kind, sourcePath, targets:Set, plan}
  const rows = g?.rows || []
  const artifacts = useMemo(() => [
    ...rows.filter(r => r.agents).map(r => ({ kind: 'agents', sourcePath: r.folder + '/AGENTS.md', label: `AGENTS.md — ${r.name}` })),
    ...(rules || []).filter(r => r.path).map(r => ({ kind: 'rule', sourcePath: r.path, label: `rule: ${r.name}${r.folder ? ' — ' + short(r.folder) : ''}` })),
  ], [rows, rules])
  const run = dryRun => {
    const body = { kind: push.kind, sourcePath: push.sourcePath, targets: [...push.targets], dryRun }
    api.post('/api/cursor/governance/push', body)
      .then(r => { setPush(p => ({ ...p, plan: r.plan, applied: r.applied })); if (!dryRun) toast(`pushed to ${r.plan.length} repos (backups taken)`, 'success') })
      .catch(e => toast(e.message, 'error'))
  }
  if (!g) return <Loading what="reading .cursor/ in every known workspace…" />
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={PANEL}>
        <H right={<>
          <select value={ref} onChange={e => setRef(e.target.value)} style={{ font: `400 11px ${MONO}`, maxWidth: 220 }}>
            <option value="">compare to… (no reference)</option>
            {rows.map(r => <option key={r.folder} value={r.folder}>{r.name}</option>)}
          </select>
          <Raw href="/api/cursor/governance" />
        </>}>Harness governance — every repo, one table</H>
        <DataTable maxHeight="55vh"
          columns={[
            { key: 'name', label: 'repo', render: r => <span title={tildify(r.folder)} style={{ color: '#e5dbd2', fontWeight: 600 }}>{r.name}</span> },
            { key: 'flags', label: 'flags', sortValue: r => r.flags.join(), render: r => r.flags.map(f => <Chip key={f} text={f} color={f === 'UNGOVERNED' ? BAD : WARN} />) },
            { key: 'alwaysTokens', label: 'always-on context', align: 'right', render: r => <b style={{ color: r.alwaysTokens > 4000 ? WARN : '#d8cfc7' }}>{fmtNum(r.alwaysTokens)} tok</b> },
            { key: 'agents', label: 'AGENTS.md', render: r => r.agents ? `yes · ${fmtNum(r.agentsTokens)}` : <span style={{ color: '#5c554f' }}>no</span> },
            { key: 'alwaysRules', label: 'always rules', align: 'right' },
            { key: 'globRules', label: 'glob rules', align: 'right' },
            { key: 'commands', label: 'cmds', align: 'right' },
            { key: 'skills', label: 'skills', align: 'right' },
            { key: 'hooks', label: 'hooks', sortValue: r => r.hooks.length, render: r => r.hooks.length || '—' },
            { key: 'mcp', label: 'MCP (project)', sortValue: r => r.mcp.length, render: r => r.mcp.length ? r.mcp.join(', ') : '—' },
            { key: 'cursorLastChanged', label: '.cursor/ last change', align: 'right', render: r => r.cursorLastChanged ? new Date(r.cursorLastChanged).toISOString().slice(0, 10) : '—' },
            ...(ref ? [{ key: 'diffs', label: 'differs from ref', sortValue: r => (r.diffs || []).length, render: r => (r.diffs || []).map(d => <Chip key={d} text={d} color={WARN} />) }] : []),
          ]}
          sort={{ key: 'alwaysTokens', dir: -1 }} rows={rows.map(r => ({ ...r, __key: r.folder }))} />
        <div style={{ font: `400 10px ${MONO}`, color: '#5c554f', marginTop: 8 }}>
          OBESE CONTEXT = more than 4k tokens loaded on every single request in that repo, forever. UNGOVERNED = no rules and no AGENTS.md.
        </div>
      </div>

      <div style={PANEL}>
        <H>Push to N repos — dry run first, backup, reversible</H>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          <select value={push?.sourcePath || ''} style={{ font: `400 11px ${MONO}`, maxWidth: 380 }}
            onChange={e => { const a = artifacts.find(x => x.sourcePath === e.target.value); setPush(a ? { ...a, targets: new Set(), plan: null } : null) }}>
            <option value="">pick a rule or AGENTS.md to copy…</option>
            {artifacts.map(a => <option key={a.sourcePath} value={a.sourcePath}>{a.label}</option>)}
          </select>
          {push && <>
            <button onClick={() => run(true)} disabled={!push.targets.size}>Dry run</button>
            <button className="primary" disabled={!push.plan} onClick={() => run(false)}>Apply to {push.targets.size} repos</button>
          </>}
        </div>
        {push && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {rows.filter(r => r.folder !== push.sourcePath.replace(/\/(AGENTS\.md|\.cursor\/.*)$/, '')).map(r => {
              const on = push.targets.has(r.folder)
              return <button key={r.folder} className={on ? 'active' : ''}
                onClick={() => setPush(p => { const t = new Set(p.targets); on ? t.delete(r.folder) : t.add(r.folder); return { ...p, targets: t, plan: null } })}>
                {on ? '✓ ' : ''}{r.name}</button>
            })}
          </div>
        )}
        {push?.plan && (
          <div style={{ marginTop: 10 }}>
            <DataTable maxHeight="24vh"
              columns={[
                { key: 'target', label: 'repo', render: r => short(r.target) },
                { key: 'action', label: 'action', render: r => <Chip text={r.action} color={r.action === 'overwrite' ? WARN : r.action === 'identical' ? '#7a716a' : OK} /> },
                { key: 'file', label: 'file', render: r => tildify(r.file) },
              ]} rows={push.plan.map(p => ({ ...p, __key: p.file }))} />
            <div style={{ font: `400 10px ${MONO}`, color: '#5c554f', marginTop: 6 }}>{push.applied ? 'applied — every overwritten file was backed up first' : 'dry run — nothing has been written yet'}</div>
          </div>
        )}
      </div>
    </div>
  )
}

function ContextPanel({ q }) {
  const [ws, setWs] = useState('')
  const [folders] = useApi('/api/cursor/projects')
  const path = `/api/cursor/context?${q}${ws ? '&workspace=' + encodeURIComponent(ws) : ''}`
  const [ctx] = useApi(path, [path])
  const fl = useMemo(() => [...new Set((folders || []).map(p => p.folder).filter(Boolean))], [folders])
  const demote = r => api.get('/api/cursor/res-item?path=' + encodeURIComponent(r.path))
    .then(x => api.put('/api/cursor/res-item', { path: r.path, content: x.content.replace(/^(alwaysApply:\s*)true/m, '$1false') }))
    .then(() => { toast('demoted to glob — backup taken', 'success'); setWs(w => w) }).catch(e => toast(e.message, 'error'))
  if (!ctx) return <Loading what="computing context cost…" />
  const p = ctx.pressure
  const hi = p.errorRate.high, lo = p.errorRate.low
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={PANEL}>
        <H right={<Raw href={path} />}>Context pressure — how full the window gets, and whether it hurts</H>
        <Columns color={ACCENT} height={110}
          items={p.buckets.map(b => ({ label: b.from + '%', value: b.sessions, hint: `${b.from}–${b.to}% context used: ${b.sessions} sessions` }))} />
        <div style={{ height: 14 }} />
        <Facts items={[
          { label: 'sessions with a reading', value: p.sessions },
          { label: 'over 80% context', value: p.over80.length, color: p.over80.length ? WARN : '#e5dbd2' },
          { label: 'tool error rate ABOVE 80%', value: hi != null ? pctS(hi) : '—', color: WARN },
          { label: 'tool error rate BELOW 80%', value: lo != null ? pctS(lo) : '—' },
        ]} />
        {/* The roadmap asserted the failure rate "triples above 80% context". Measured on this DB it does
            not — it is flat. The histogram ships; the claim does not. */}
        <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a', marginTop: 10, lineHeight: 1.6 }}>
          Measured, not assumed: {hi != null ? pctS(hi) : '—'} of {fmtNum(p.errorRate.highCalls)} tool calls fail above 80% context vs {lo != null ? pctS(lo) : '—'} of {fmtNum(p.errorRate.lowCalls)} below it.
          That is flat. On this machine, high context does not measurably break your tools — so no "your failures triple" headline is rendered here.
        </div>
        {p.over80.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <DataTable maxHeight="24vh"
              columns={[
                { key: 'name', label: 'session over 80% context', render: r => r.name || '(unnamed)' },
                { key: 'folder', label: 'repo', render: r => short(r.folder) },
                { key: 'ctxPct', label: 'context used', align: 'right', render: r => <b style={{ color: WARN }}>{r.ctxPct}%</b> },
                { key: 'toolErrors', label: 'tool errors', align: 'right' },
                { key: 'lastUpdatedAt', label: 'last active', align: 'right', render: r => new Date(r.lastUpdatedAt).toISOString().slice(0, 10) },
              ]} sort={{ key: 'ctxPct', dir: -1 }} rows={p.over80.map(s => ({ ...s, __key: s.id }))} />
          </div>
        )}
      </div>

      <div style={PANEL}>
        <H right={<>
          <select value={ws} onChange={e => setWs(e.target.value)} style={{ font: `400 11px ${MONO}`, maxWidth: 280 }}>
            <option value="">all projects</option>
            {fl.map(f => <option key={f} value={f}>{short(f)}</option>)}
          </select>
        </>}>The always-context tax — {fmtNum(ctx.totals.always)} tokens on every chat</H>
        <DataTable maxHeight="34vh"
          columns={[
            { key: 'name', label: 'rule / skill' },
            { key: 'kind', label: 'kind', render: r => <Chip text={r.kind} /> },
            { key: 'folder', label: 'repo', render: r => r.folder ? short(r.folder) : <Chip text="global" color={WARN} /> },
            { key: 'why', label: 'why it is always loaded' },
            { key: 'tokens', label: 'tokens · every chat', align: 'right', render: r => <b style={{ color: WARN }}>{fmtNum(r.tokens)}</b> },
            { key: 'act', label: '', render: r => r.path && r.why === 'alwaysApply rule' ? <button onClick={() => demote(r)}>Demote to glob</button> : null },
          ]}
          sort={{ key: 'tokens', dir: -1 }} rows={ctx.always.map((r, i) => ({ ...r, __key: r.path || r.name + i }))} />
        <div style={{ font: `400 10px ${MONO}`, color: '#5c554f', marginTop: 8 }}>
          {ctx.activationsNote} · on-invoke total ≈{fmtNum(ctx.totals.onInvoke)} tok across {ctx.onInvoke.length} artifacts (paid only when triggered)
        </div>
      </div>
    </div>
  )
}

// item 7 — wasted turns
function Wasted({ q, onOpenSession }) {
  const [t] = useApi(`/api/cursor/tools?${q}`, [q])
  const [open, setOpen] = useState(null)
  if (!t) return <Loading what="scanning tool calls…" />
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={PANEL}>
        <H right={<Raw href={`/api/cursor/tools?${q}`} />}>Wasted turns — tool failures, by the actual error string</H>
        <Facts items={[
          { label: 'tool calls', value: fmtNum(t.totals.calls) },
          { label: 'errors', value: fmtNum(t.totals.errors), color: BAD },
          { label: 'overall error rate', value: pctS(t.totals.errors / t.totals.calls) },
        ]} />
        <div style={{ height: 12 }} />
        <DataTable maxHeight="28vh"
          columns={[
            { key: 'tool', label: 'tool' },
            { key: 'calls', label: 'calls', align: 'right', render: r => fmtNum(r.calls) },
            { key: 'errors', label: 'errors', align: 'right', render: r => <b style={{ color: r.errors ? BAD : '#5c554f' }}>{r.errors}</b> },
            { key: 'errorRate', label: 'error rate', align: 'right', render: r => <span style={{ color: r.hot ? BAD : '#d8cfc7' }}>{pctS(r.errorRate)}{r.hot ? ' ●' : ''}</span> },
          ]}
          sort={{ key: 'errors', dir: -1 }} rows={t.byTool.map(x => ({ ...x, __key: x.tool }))} />
        <div style={{ font: `400 10px ${MONO}`, color: '#5c554f', marginTop: 8 }}>● = over a 10% error rate on 20+ calls. {t.note}</div>
      </div>

      <div style={PANEL}>
        <H>The exact failures — {t.wasted.length} distinct error strings</H>
        <Stagger tag="div" step={30}>{t.wasted.slice(0, 25).map((w, i) => (
          <div key={i} style={{ padding: '7px 4px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
              <span style={{ font: `700 12px ${MONO}`, color: BAD, width: 40 }}>{w.count}×</span>
              <Chip text={w.tool} color={ACCENT} />
              <span style={{ font: `400 11.5px ${MONO}`, color: '#d8cfc7', flex: 1, overflowWrap: 'anywhere' }}>{w.message}</span>
              <span style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>{w.sessions} sessions · {w.pctOfToolCalls ?? '—'}% of {w.tool} calls</span>
              {/globalIgnore|blocked/i.test(w.message) && <button className="press" onClick={() => { navigator.clipboard.writeText(w.message); toast('copied — add an ignore-file rule in Tooling → Capabilities', 'info') }}>Copy</button>}
            </div>
          </div>
        ))}</Stagger>
      </div>

      <div style={PANEL}>
        <H>Worst sessions in this window — ranked by wasted turns, never by lines</H>
        <DataTable maxHeight="30vh" onRowClick={r => onOpenSession(r.id)}
          columns={[
            { key: 'id', label: 'session', render: r => <code style={{ color: ACCENT }}>{r.id.slice(0, 8)}</code> },
            { key: 'toolErrors', label: 'tool errors', align: 'right', render: r => <b style={{ color: BAD }}>{r.toolErrors}</b> },
            { key: 'toolCalls', label: 'tool calls', align: 'right' },
            { key: 'rate', label: 'error rate', align: 'right', sortValue: r => r.toolErrors / r.toolCalls, render: r => pctS(r.toolErrors / r.toolCalls) },
          ]}
          sort={{ key: 'toolErrors', dir: -1 }} rows={t.worstSessions.map(s => ({ ...s, __key: s.id }))} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// item 8 — the team plane. Admin API only. Three administrative facts per email; everything
// behavioral is k>=5 aggregate, enforced in the server. No leaderboard exists to render.
// ---------------------------------------------------------------------------
function Team() {
  const [t] = useApi('/api/cursor/team')
  if (!t) return <Loading what="calling the Cursor Admin API…" />
  if (!t.available) return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Note>{t.detail || t.reason}{t.errors ? ' — ' + t.errors.join('; ') : ''}</Note>
      <Muted>This page shows nothing rather than showing zeros. It is the only module allowed to serve multi-person data, and it reads exactly one source: the Cursor Admin API (org billing data the admin already sees). It is never joined to your local telemetry.</Muted>
    </div>
  )
  const b = t.behavioral
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={PANEL}>
        <H right={<Raw href="/api/cursor/team" />}>Team — seats, adoption, spend</H>
        {b.suppressed ? <Note>{b.note}</Note> : (
          <Facts items={[
            { label: 'seats', value: b.members },
            { label: 'adoption (30d)', value: b.adoptionPct + '%', color: OK },
            { label: 'active members', value: b.activeMembers },
            { label: 'team spend', value: money(b.totalSpendCents) },
            { label: 'median spend', value: money(b.medianSpendCents) },
          ]} />
        )}
        <div style={{ height: 12 }} />
        <DataTable maxHeight="40vh"
          columns={[
            { key: 'email', label: 'email' },
            { key: 'name', label: 'name', render: r => r.name || '—' },
            { key: 'seatAssignedAt', label: 'seat since', render: r => r.seatAssignedAt ? new Date(r.seatAssignedAt).toISOString().slice(0, 10) : '—' },
            { key: 'clientVersion', label: 'client version', render: r => r.clientVersion || '—' },
            { key: 'spendCents', label: 'spend', align: 'right', render: r => money(r.spendCents) ?? '—' },
          ]}
          rows={t.members.map(m => ({ ...m, __key: m.email }))} />
        <div style={{ font: `400 10px ${MONO}`, color: '#5c554f', marginTop: 8, lineHeight: 1.6 }}>
          Per-email fields the server will emit, and no others: {t.contract.perEmailFields.join(', ')}. Physically absent from this route: {t.contract.forbidden.join(', ')}. Rows are alphabetical — never ranked.
        </div>
      </div>
      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(320px,1fr))' }}>
        <div style={PANEL}>
          <H>Dead seats — zero active days in 30d</H>
          {t.outliers.deadSeat.length === 0 ? <Muted>none</Muted> : t.outliers.deadSeat.map(r => (
            <div key={r.email} style={{ display: 'flex', gap: 8, padding: '5px 2px', font: `400 11px ${MONO}`, color: '#d8cfc7' }}>
              <span style={{ flex: 1 }}>{r.email}</span><span style={{ color: '#7a716a' }}>{money(r.spendCents) ?? '—'}</span>
            </div>
          ))}
        </div>
        <div style={PANEL}>
          <H>Roster reconciliation</H>
          <Muted>seat but on no team: {t.roster.seatButNoTeam.join(', ') || 'none'}</Muted>
          <Muted>on a team but no seat: {t.roster.teamButNoSeat.join(', ') || 'none'}</Muted>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// item 10 — search everything I've ever asked. Local plane, self-only.
// ---------------------------------------------------------------------------
function Search({ onOpenSession }) {
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  const [role, setRole] = useState('')
  const [hasError, setHasError] = useState(false)
  const path = term.length >= 2 ? `/api/cursor/search?q=${encodeURIComponent(term)}${role ? '&role=' + role : ''}${hasError ? '&hasError=1' : ''}` : null
  const [r] = useApi(path, [path])
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 250); return () => clearTimeout(t) }, [q])
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="search every message you have ever sent or received…"
          style={{ font: `400 13px ${MONO}`, flex: 1, minWidth: 260 }} />
        <select value={role} onChange={e => setRole(e.target.value)} style={{ font: `400 11px ${MONO}` }}>
          <option value="">anyone</option><option value="1">me</option><option value="2">assistant</option>
        </select>
        <button className={hasError ? 'active' : ''} onClick={() => setHasError(x => !x)}>has tool error</button>
      </div>
      {!term ? <Muted>type at least 2 characters — FTS5 over every bubble on this machine, never transmitted</Muted>
        : !r ? <ColdLoading what="searching… the first query builds the FTS index over every bubble on this machine (~30s cold, instant after)" tiles={0} rows={7} />
          : (
            <div style={PANEL}>
              <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a', marginBottom: 8 }}>{r.total} hits</div>
              <Stagger tag="div" step={30}>{r.results.map(x => (
                <div key={x.bubbleId} className="press" onClick={() => onOpenSession(x.sessionId)}
                  style={{ padding: '8px 4px', borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <Chip text={x.role === 1 ? 'me' : 'assistant'} color={x.role === 1 ? ACCENT : '#7a716a'} />
                    <span style={{ font: `500 11.5px "IBM Plex Sans", sans-serif`, color: '#e5dbd2' }}>{x.name || '(unnamed)'}</span>
                    <span style={{ font: `400 10px ${MONO}`, color: '#7a716a' }}>{short(x.folder)}</span>
                    {x.model && <Chip text={x.model} />}
                    {x.hasError && <Chip text="tool error" color={BAD} />}
                    <span style={{ font: `400 10px ${MONO}`, color: '#5c554f', marginLeft: 'auto' }}>{new Date(x.lastUpdatedAt).toISOString().slice(0, 10)}</span>
                  </div>
                  <div style={{ font: `400 11.5px ${MONO}`, color: '#d8cfc7', marginTop: 4, overflowWrap: 'anywhere' }}
                    dangerouslySetInnerHTML={{ __html: (x.snippet || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])).replace(/&lt;&lt;/g, `<mark style="background:${ACCENT}33;color:#fff">`).replace(/&gt;&gt;/g, '</mark>') }} />
                </div>
              ))}</Stagger>
              {r.results.length === 0 && <Muted>no hits</Muted>}
            </div>
          )}
    </div>
  )
}

// ---- sessions (IC local plane: the transcript reader lives here and nowhere else) ----
function ChatAnalysis({ a, createdAt }) {
  const ctxPct = a.contextLimit ? Math.round(100 * a.contextTokens / a.contextLimit) : 0
  const cells = [
    ['model', a.model || '—'], ['user msgs', a.userMsgs], ['assistant msgs', a.asstMsgs],
    ['tool calls', `${a.toolCalls}${a.distinctTools ? ` · ${a.distinctTools} kinds` : ''}`],
    ['duration', a.durationMs ? Math.round(a.durationMs / 6e4) + 'm' : '—'], ['files touched', a.files.length],
    ['context', a.contextTokens ? `${fmtNum(a.contextTokens)} tok${ctxPct ? ` (${ctxPct}%)` : ''}` : '—'],
  ]
  return (
    <div style={{ ...PANEL, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <div style={{ font: `600 13px ${HEAD}`, color: '#e5dbd2' }}>Chat analysis</div>
        {a.agentic && <Chip text="agent" color={ACCENT} />}
        <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a', marginLeft: 'auto' }}>{createdAt ? fmtDate(createdAt) : ''}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px,1fr))', gap: 8 }}>
        {cells.map(([l, v]) => (
          <div key={l}><div style={{ font: `600 14px ${HEAD}`, color: '#e5dbd2', overflowWrap: 'anywhere' }}>{v}</div><div style={{ font: `400 9.5px ${MONO}`, color: '#7a716a' }}>{l}</div></div>
        ))}
      </div>
      {a.files.length > 0 && (
        <details>
          <summary style={{ font: `400 10.5px ${MONO}`, color: '#7a716a', cursor: 'pointer' }}>{a.files.length} files touched</summary>
          <div style={{ marginTop: 6, display: 'grid', gap: 2 }}>
            {a.files.slice(0, 40).map(f => <div key={f} style={{ font: `400 10.5px ${MONO}`, color: '#d8cfc7', overflowWrap: 'anywhere' }}>{tildify(f)}</div>)}
          </div>
        </details>
      )}
    </div>
  )
}

function SessionDetail({ id, onBack }) {
  const [s] = useApi(`/api/cursor/session/${id}`, [id])
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div><button onClick={onBack}>← back</button></div>
      {s?.analysis && <ChatAnalysis a={s.analysis} createdAt={s.createdAt} />}
      {!s ? <ColdLoading what="loading conversation…" tiles={0} rows={6} /> : (
        <div style={{ ...PANEL, maxHeight: '70vh', overflowY: 'auto' }}>
          <div style={{ font: `600 15px ${HEAD}`, color: '#e5dbd2', marginBottom: 12 }}>{s.name || '(unnamed session)'}</div>
          {s.messages.map((m, i) => (
            <div key={i} style={{
              margin: '8px 0', padding: '8px 12px', borderRadius: 10, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
              font: `400 12.5px ${m.type === 1 ? MONO : "'IBM Plex Sans', sans-serif"}`,
              background: m.type === 1 ? 'rgba(124,196,247,0.08)' : 'rgba(255,255,255,0.03)',
              borderLeft: `2px solid ${m.type === 1 ? ACCENT : 'rgba(255,255,255,0.1)'}`, color: '#d8cfc7',
            }}>{m.text}</div>
          ))}
          {s.messages.length === 0 && <Muted>no text messages in this session</Muted>}
        </div>
      )}
    </div>
  )
}

function Sessions({ workspace, open, setOpen }) {
  const [list] = useApi('/api/cursor/sessions' + (workspace ? `?workspace=${encodeURIComponent(workspace)}` : ''), [workspace])
  const [tab, setTab] = useState('search')
  if (open) return <SessionDetail id={open} onBack={() => setOpen(null)} />
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className={tab === 'search' ? 'active' : ''} onClick={() => setTab('search')}>Search everything</button>
        <button className={tab === 'list' ? 'active' : ''} onClick={() => setTab('list')}>Browse sessions</button>
      </div>
      {tab === 'search' ? <Search onOpenSession={setOpen} /> : !list ? <ColdLoading what="loading sessions…" tiles={0} rows={8} /> : (
        <div style={PANEL}>
          <Stagger tag="div" step={22} max={520}>{list.slice(0, 200).map(s => (
            <div key={s.id} className="press" onClick={() => setOpen(s.id)} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '7px 4px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ font: `500 12.5px "IBM Plex Sans", sans-serif`, color: '#e5dbd2', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name || '(unnamed)'}</span>
              <span style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>{short(s.folder)}</span>
              <span style={{ font: `400 10.5px ${MONO}`, color: ACCENT }}>{s.messages} msgs</span>
              <span style={{ font: `400 10.5px ${MONO}`, color: '#7a716a', width: 130, textAlign: 'right' }}>{s.lastUpdatedAt ? fmtDate(s.lastUpdatedAt) : ''}</span>
            </div>
          ))}</Stagger>
        </div>
      )}
    </div>
  )
}

// ---- projects (heatmap, biggest-sessions and model count chips deleted by the truth pass) ----
function Projects({ onOpen }) {
  const [ps] = useApi('/api/cursor/projects')
  if (!ps) return <ColdLoading what="loading workspaces…" tiles={3} rows={2} />
  return (
    <Stagger className="" tag="div" step={30} style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
      {ps.map(p => (
        <div key={p.workspaceId || p.folder} className="lift press" style={{ ...PANEL, cursor: 'pointer' }} onClick={() => onOpen(p)}>
          <div style={{ font: `600 13.5px ${HEAD}`, color: '#e5dbd2', marginBottom: 4 }}>{short(p.folder) || '(unknown workspace)'}</div>
          <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a', marginBottom: 8, overflowWrap: 'anywhere' }}>{p.folder ? tildify(p.folder) : p.workspaceId}</div>
          <div style={{ font: `400 11px ${MONO}`, color: ACCENT }}>{p.sessions} sessions · {p.messages} msgs</div>
          <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>last active {p.last ? fmtDate(p.last) : '—'}</div>
        </div>
      ))}
    </Stagger>
  )
}

function Harness({ folder }) {
  const [h] = useApi(folder && folder.startsWith('/') ? '/api/cursor/harness?workspace=' + encodeURIComponent(folder) : null, [folder])
  if (!folder?.startsWith('/')) return <div style={{ ...PANEL, font: `400 11.5px ${MONO}`, color: '#7a716a' }}>No local folder for this workspace — harness files aren't reachable.</div>
  if (!h) return <Loading what="reading .cursor/ …" />
  // the route answers {available:false} for a folder that is gone from disk — say so, do not crash
  if (!h.available) return <div style={{ ...PANEL, font: `400 11.5px ${MONO}`, color: '#7a716a' }}>This workspace folder is not on disk any more — harness files aren't reachable.</div>
  const Group = ({ title, children, empty }) => (
    <div><div style={{ font: `600 11px ${MONO}`, color: '#9a8f86', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</div>{children || <div style={{ font: `400 11px ${MONO}`, color: '#5c554f' }}>{empty}</div>}</div>
  )
  return (
    <div style={{ ...PANEL, display: 'grid', gap: 16 }}>
      <div style={{ font: `600 14px ${HEAD}`, color: '#e5dbd2' }}>Harness — what's configured for this project</div>
      <div style={{ border: `1px solid ${ACCENT}44`, borderRadius: 10, padding: '12px 14px', background: `${ACCENT}0d` }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div style={{ font: `600 12px ${HEAD}`, color: ACCENT }}>Always-loaded context</div>
          <div style={{ font: `700 12px ${MONO}`, color: '#e5dbd2', marginLeft: 'auto' }}>≈{fmtNum(h.context.tokens)} tok</div>
        </div>
        <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a', marginTop: 4 }}>
          {[...h.context.alwaysRules, h.context.agents && 'AGENTS.md', h.context.legacy && '.cursorrules'].filter(Boolean).join(' · ') || 'nothing always-on — rules load only on glob match'}
        </div>
      </div>
      <Group title={`Rules (${h.rules.length})`} empty="no .cursor/rules/*.mdc">
        {h.rules.length > 0 && <div style={{ display: 'grid', gap: 6 }}>{h.rules.map(r => (
          <div key={r.name} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <Chip text={SCOPE[r.scope][1]} color={SCOPE[r.scope][0]} />
            <span style={{ font: `500 12px ${MONO}`, color: '#e5dbd2' }}>{r.name}</span>
            {r.globs && <span style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>{r.globs}</span>}
            <span style={{ font: `400 10px ${MONO}`, color: '#5c554f', marginLeft: 'auto' }}>≈{fmtNum(r.tokens)} tok</span>
          </div>
        ))}</div>}
      </Group>
      <Group title={`MCP servers (${h.mcp.project.length} project · ${h.mcp.global.length} global)`} empty="none">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {h.mcp.project.map(s => <Chip key={'p' + s.name} text={s.name} color={ACCENT} />)}
          {h.mcp.global.map(s => <Chip key={'g' + s.name} text={s.name + ' (global)'} />)}
        </div>
      </Group>
      {h.commands.length > 0 && <Group title={`Commands (${h.commands.length})`}>
        <div style={{ display: 'grid', gap: 3 }}>{h.commands.map(c => <div key={c.name} style={{ font: `400 11px ${MONO}`, color: '#d8cfc7' }}><span style={{ color: ACCENT }}>/{c.name}</span> {c.description && <span style={{ color: '#7a716a' }}>— {c.description}</span>}</div>)}</div>
      </Group>}
      {h.skills.length > 0 && <Group title={`Skills (${h.skills.length})`}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{h.skills.map(s => <Chip key={s} text={s} />)}</div>
      </Group>}
      {h.hooks.length > 0 && <Group title="Hooks"><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{h.hooks.map(x => <Chip key={x} text={x} />)}</div></Group>}
    </div>
  )
}

function ProjectDetail({ project, onBack, onOpenSessions }) {
  const ws = project.folder || project.workspaceId
  const [a] = useApi('/api/cursor/project?workspace=' + encodeURIComponent(ws), [ws])
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button onClick={onBack}>← projects</button>
        <button onClick={() => onOpenSessions(project)}>view all sessions →</button>
      </div>
      <div>
        <div style={{ font: `700 18px ${HEAD}`, color: '#e5dbd2' }}>{short(project.folder) || '(unknown workspace)'}</div>
        <div style={{ font: `400 11px ${MONO}`, color: '#7a716a', overflowWrap: 'anywhere' }}>{project.folder ? tildify(project.folder) : project.workspaceId}</div>
      </div>
      {!a ? <ColdLoading what="analyzing this workspace… (~27s cold)" tiles={4} rows={2} /> : a.sessions === 0 ? <Muted>no sessions</Muted> : (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Stat label="sessions" num={a.sessions} />
            <Stat label="messages" num={a.messages} fmt={fmtNum} />
            <Stat label="avg msgs/session" num={a.avgMessages} />
            <Stat label="active days" num={a.activeDays} />
          </div>
          <div style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>{isFinite(a.first) && <>first {fmtDate(a.first)} · last {fmtDate(a.last)}</>}</div>
          <Harness folder={project.folder} />
        </>
      )}
    </div>
  )
}

// ---- tooling: capabilities CRUD + MCP editor + headless runs + the raw-export hatch, one page ----
const KIND_TABS = ['skills', 'rules', 'commands', 'agents']
function Capabilities() {
  const [kind, setKind] = useState('skills')
  const [items, setItems] = useState(null)
  const [open, setOpen] = useState(null)
  const [content, setContent] = useState('')
  const [folders, setFolders] = useState([])
  const load = k => api.get('/api/cursor/res/' + k).then(setItems).catch(() => setItems([]))
  useEffect(() => { setItems(null); setOpen(null); load(kind) }, [kind])
  useEffect(() => { api.get('/api/cursor/projects').then(ps => setFolders([...new Set(ps.map(p => p.folder).filter(Boolean))])).catch(() => {}) }, [])
  const openItem = it => api.get('/api/cursor/res-item?path=' + encodeURIComponent(it.path)).then(r => { setOpen(it); setContent(r.content) }).catch(e => toast(e.message, 'error'))
  const save = () => api.put('/api/cursor/res-item', { path: open.path, content }).then(() => { toast('saved (backup taken)', 'success'); load(kind) }).catch(e => toast(e.message, 'error'))
  const del = () => confirm(`Delete ${open.name}? A backup is kept.`) && api.del('/api/cursor/res-item?path=' + encodeURIComponent(open.path)).then(() => { setOpen(null); load(kind); toast('deleted', 'success') }).catch(e => toast(e.message, 'error'))
  const create = () => {
    const name = prompt(`New ${kind.slice(0, -1)} name:`); if (!name) return
    const needsFolder = kind === 'rules' || kind === 'commands'
    const folder = needsFolder ? prompt('Project folder:\n' + folders.map((f, i) => `${i}: ${tildify(f)}`).join('\n') + '\n\nEnter a number (empty = global commands):') : null
    const body = { name, folder: folder !== null && folder !== '' ? folders[Number(folder)] : undefined }
    api.post('/api/cursor/res/' + kind, body).then(r => { load(kind); openItem({ path: r.path, name }) }).catch(e => toast(e.message, 'error'))
  }
  if (open) return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={() => setOpen(null)}>← {kind}</button>
        <span style={{ font: `600 13px ${HEAD}`, color: '#e5dbd2' }}>{open.name}</span>
        <span style={{ font: `400 10px ${MONO}`, color: '#7a716a', overflowWrap: 'anywhere' }}>{tildify(open.path)}</span>
        <button className="primary" style={{ marginLeft: 'auto' }} onClick={save}>Save</button>
        <button className="danger" onClick={del}>Delete</button>
      </div>
      <textarea value={content} onChange={e => setContent(e.target.value)} spellCheck={false}
        style={{ ...PANEL, width: '100%', minHeight: '62vh', font: `400 12.5px ${MONO}`, color: '#e5dbd2', resize: 'vertical' }} />
    </div>
  )
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {KIND_TABS.map(k => <button key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>{k}</button>)}
        <button className="primary" style={{ marginLeft: 'auto' }} onClick={create}>+ New</button>
      </div>
      {!items ? <Loading what="loading…" /> : (
        <div style={PANEL}>
          {items.map(it => (
            <div key={it.path} onClick={() => openItem(it)} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '7px 4px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ font: `500 12.5px ${MONO}`, color: '#e5dbd2' }}>{it.name}</span>
              <Chip text={it.scope} color={it.scope === 'project' ? ACCENT : undefined} />
              {it.alwaysApply && <Chip text="always" color={WARN} />}
              <span style={{ font: `400 11px "IBM Plex Sans", sans-serif`, color: '#7a716a', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.description}</span>
              {it.folder && <span style={{ font: `400 10px ${MONO}`, color: '#5c554f' }}>{short(it.folder)}</span>}
              <span style={{ font: `400 10px ${MONO}`, color: '#5c554f', width: 110, textAlign: 'right' }}>{it.tokensAlways ? `≈${fmtNum(it.tokensAlways)} always` : `≈${fmtNum(it.tokensOnInvoke)} on use`}</span>
            </div>
          ))}
          {items.length === 0 && <Muted>none found</Muted>}
        </div>
      )}
    </div>
  )
}

function Mcp() {
  const [servers, setServers] = useState(null)
  const [drafts, setDrafts] = useState({})
  const [tests, setTests] = useState({})
  const load = () => api.get('/api/cursor/mcp').then(setServers).catch(() => setServers([]))
  useEffect(() => { load() }, [])
  const key = s => s.scope + ':' + s.name
  const save = s => {
    let config; try { config = JSON.parse(drafts[key(s)] ?? JSON.stringify(s.config)) } catch { return toast('invalid JSON', 'error') }
    api.put('/api/cursor/mcp/' + encodeURIComponent(s.name), { scope: s.scope, config }).then(() => { toast('saved (backup taken)', 'success'); load() }).catch(e => toast(e.message, 'error'))
  }
  const test = s => {
    let config; try { config = JSON.parse(drafts[key(s)] ?? JSON.stringify(s.config)) } catch { return toast('invalid JSON', 'error') }
    setTests(t => ({ ...t, [key(s)]: { running: true } }))
    api.post('/api/cursor/mcp/' + encodeURIComponent(s.name) + '/test', { config }).then(r => setTests(t => ({ ...t, [key(s)]: r }))).catch(e => setTests(t => ({ ...t, [key(s)]: { ok: false, error: e.message } })))
  }
  const testAll = () => servers.forEach(test)
  const del = s => confirm(`Remove MCP server "${s.name}" from ${s.scope === 'user' ? 'global config' : tildify(s.scope)}?`) &&
    api.del(`/api/cursor/mcp/${encodeURIComponent(s.name)}?scope=${encodeURIComponent(s.scope)}`).then(load).catch(e => toast(e.message, 'error'))
  const add = () => {
    const name = prompt('Server name:'); if (!name) return
    api.post('/api/cursor/mcp', { name, scope: 'user', config: { command: 'npx', args: [] } }).then(load).catch(e => toast(e.message, 'error'))
  }
  if (!servers) return <Loading what="loading…" />
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="primary" onClick={add}>+ Add server (global)</button>
        <button onClick={testAll}>Retest all</button>
      </div>
      {servers.map(s => {
        const t = tests[key(s)]
        return (
          <div key={key(s)} style={{ ...PANEL, display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span style={{ font: `600 13px ${HEAD}`, color: '#e5dbd2' }}>{s.name}</span>
              <Chip text={s.scope === 'user' ? 'global' : short(s.scope)} color={s.scope === 'user' ? undefined : ACCENT} />
              {t && <span style={{ font: `400 11px ${MONO}`, color: t.running ? ACCENT : t.ok ? OK : BAD }}>
                {t.running ? 'testing…' : t.ok ? `✓ live · ${t.ms}ms${t.serverInfo?.name ? ` · ${t.serverInfo.name}` : ''}` : `✗ ${t.error || 'status ' + t.status}`}</span>}
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button onClick={() => test(s)}>Test</button>
                <button onClick={() => save(s)}>Save</button>
                <button className="danger" onClick={() => del(s)}>✕</button>
              </span>
            </div>
            <textarea value={drafts[key(s)] ?? JSON.stringify(s.config, null, 2)} onChange={e => setDrafts(d => ({ ...d, [key(s)]: e.target.value }))} spellCheck={false}
              style={{ width: '100%', minHeight: 90, font: `400 11.5px ${MONO}`, color: '#d8cfc7', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: 10, resize: 'vertical' }} />
          </div>
        )
      })}
    </div>
  )
}

const CURSOR_ACTIONS = [
  { label: 'Review changes', prompt: 'Review my uncommitted git changes for correctness bugs. Do not edit any files — report findings with file:line references.' },
  { label: 'Explain repo', prompt: 'Give a concise architectural overview of this repository: entry points, main modules, and how they connect.' },
  { label: 'Find dead code', prompt: 'Find likely-dead or unused code in this repository. Do not edit anything — list candidates with evidence.' },
]
function CursorRuns() {
  const [folders, setFolders] = useState([])
  const [cwd, setCwd] = useState('')
  const [custom, setCustom] = useState('')
  const [runs, setRuns] = useState([])
  const [open, setOpen] = useState(null)
  useEffect(() => { api.get('/api/cursor/projects').then(ps => { const fs = [...new Set(ps.map(p => p.folder).filter(Boolean))]; setFolders(fs); setCwd(c => c || fs[0] || '') }).catch(() => {}) }, [])
  useEffect(() => {
    const load = () => api.get('/api/actions').then(rs => setRuns(rs.filter(r => r.runner === 'cursor'))).catch(() => {})
    load(); const t = setInterval(load, 5000); return () => clearInterval(t)
  }, [])
  const launch = async promptText => {
    if (!cwd) return toast('pick a project first', 'error')
    try {
      const { id } = await api.post('/api/actions/run', { runner: 'cursor', cmd: promptText, cwd })
      const run = { id, cmd: promptText, cwd, alive: true, startedAt: Date.now() }
      setRuns(rs => [run, ...rs]); setOpen(run)
    } catch (e) { toast(e.message, 'error') }
  }
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ ...PANEL, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>run `cursor-agent -p` headless in</span>
        <select value={cwd} onChange={e => setCwd(e.target.value)} style={{ font: `400 12px ${MONO}`, maxWidth: 340 }}>
          {folders.map(f => <option key={f} value={f}>{tildify(f)}</option>)}
        </select>
        {CURSOR_ACTIONS.map(a => <button key={a.label} title={a.prompt} onClick={() => launch(a.prompt)}>{a.label}</button>)}
        <input value={custom} onChange={e => setCustom(e.target.value)} placeholder="any prompt…"
          onKeyDown={e => { if (e.key === 'Enter' && custom.trim()) { launch(custom.trim()); setCustom('') } }}
          style={{ font: `400 12px ${MONO}`, minWidth: 180, flex: 1 }} />
      </div>
      {open && <RunWindow run={open} onClose={() => setOpen(null)} />}
      <div style={PANEL}>
        <H>Runs</H>
        {runs.length === 0 && <Muted>no cursor-agent runs yet</Muted>}
        <Stagger tag="div" step={30}>{runs.map(r => (
          <div key={r.id} className="press" onClick={() => setOpen(r)} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '6px 4px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <span style={{ font: `400 11px ${MONO}`, color: r.alive ? ACCENT : r.exitCode === 0 ? OK : BAD }}>{r.alive ? '●' : r.exitCode === 0 ? '✓' : '✗'}</span>
            <span style={{ font: `400 12px "IBM Plex Sans", sans-serif`, color: '#e5dbd2', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.cmd}</span>
            <span style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>{short(r.cwd)}</span>
          </div>
        ))}</Stagger>
      </div>
    </div>
  )
}

// item 11 — the pressure valve. Every panel's backing rows, as NDJSON, in 30 seconds.
const EXPORT_KINDS = ['sessions', 'bubbles', 'blame', 'tools', 'spend', 'accept', 'join']
function Tooling({ q }) {
  const [tab, setTab] = useState('capabilities')
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        {['capabilities', 'mcp', 'runs', 'export'].map(t => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}
      </div>
      {tab === 'capabilities' && <Capabilities />}
      {tab === 'mcp' && <Mcp />}
      {tab === 'runs' && <CursorRuns />}
      {tab === 'export' && (
        <div style={PANEL}>
          <H>Raw data escape hatch — NDJSON, local plane only</H>
          <Muted>Disagree with an aggregation on any panel? Go around it. The team plane (Admin API) is deliberately NOT exportable per-email.</Muted>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            {EXPORT_KINDS.map(k => (
              <a key={k} href={`/api/cursor/export?kind=${k}&${q}`} download
                style={{ font: `500 11.5px ${MONO}`, color: ACCENT, textDecoration: 'none', border: `1px solid ${ACCENT}44`, borderRadius: 8, padding: '6px 12px' }}>{k}.ndjson</a>
            ))}
          </div>
          <div style={{ font: `400 10.5px ${MONO}`, color: '#5c554f', marginTop: 12 }}>
            curl -s "http://localhost:5178/api/cursor/export?kind=join&{q}" | jq .
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
const SECTIONS = [
  { id: 'home', label: 'Home', icon: '◧', title: 'Is the money and context going in coming back out as merged code?' },
  { id: 'spend', label: 'Spend', icon: '$', title: 'Spend, waste, and the model mix by cost' },
  { id: 'outcomes', label: 'Outcomes', icon: '⇥', title: 'Accept rate, ship rate, and what the sessions shipped' },
  { id: 'harness', label: 'Harness', icon: '⚙', title: 'Governance across every repo, and the context you pay for' },
  { id: 'wasted', label: 'Wasted turns', icon: '⚠', title: 'Tool failures — the turns you paid for and threw away' },
  { id: 'sessions', label: 'Sessions', icon: '⌨', title: 'Search everything you have ever asked' },
  { id: 'projects', label: 'Projects', icon: '⊞', title: 'Workspaces' },
  { id: 'team', label: 'Team', icon: '⧉', title: 'Seats, adoption and spend — Admin API only' },
  { id: 'tooling', label: 'Tooling', icon: '✎', title: 'Capabilities, MCP servers, headless runs, raw export' },
]
const PERIODS = [[30, '30d'], [90, '90d'], [180, '6mo'], [365, '1y']]

export default function CursorDashboard({ onSwitch }) {
  const [section, setSection] = useState('home')
  const [days, setDays] = useState(90)
  const [workspace, setWorkspace] = useState(null)
  const [project, setProject] = useState(null)
  const [openSession, setOpenSession] = useState(null)
  const q = `days=${days}` // item 1's period selector — it re-scopes every panel below
  const cur = SECTIONS.find(s => s.id === section)
  const go = (id, fn) => { setSection(id); fn?.() }
  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand"><div className="brand-mark" style={{ background: ACCENT, color: '#0d0b0a' }}>▮</div><div className="brand-name">Cursor</div></div>
        {SECTIONS.map(s => (
          <button key={s.id} className={section === s.id ? 'active' : ''}
            onClick={() => { setSection(s.id); setProject(null); setOpenSession(null); if (s.id !== 'sessions') setWorkspace(null) }}>
            <span className="nav-icon">{s.icon}</span> {s.label}
          </button>
        ))}
        <div style={{ marginTop: 'auto', padding: 12 }}>
          <button onClick={onSwitch} style={{ width: '100%' }} title="switch to the Claude Code dashboard">⇄ Claude dashboard</button>
        </div>
      </nav>
      <main className="content">
        <header className="topbar">
          <div>
            <div className="kicker" style={{ color: ACCENT }}>Cursor</div>
            <h1>{cur.title}</h1>
          </div>
          <div className="topbar-right">
            <div style={{ display: 'flex', gap: 4 }}>
              {PERIODS.map(([d, l]) => (
                <button key={d} className={days === d ? 'active' : ''} onClick={() => setDays(d)} style={{ font: `500 11px ${MONO}` }}>{l}</button>
              ))}
            </div>
            <button className="top-chip" onClick={onSwitch} style={{ cursor: 'pointer' }}>⇄ Claude</button>
            <div className="avatar" style={{ background: ACCENT, color: '#0d0b0a' }}>Cu</div>
          </div>
        </header>
        {section === 'home' && <Home q={q} days={days} />}
        {section === 'spend' && <Spend q={q} days={days} />}
        {section === 'outcomes' && <Outcomes q={q} days={days} />}
        {section === 'harness' && (
          <div style={{ display: 'grid', gap: 20 }}>
            <Governance />
            <ContextPanel q={q} />
          </div>
        )}
        {section === 'wasted' && <Wasted q={q} onOpenSession={id => go('sessions', () => setOpenSession(id))} />}
        {section === 'sessions' && <Sessions workspace={workspace} open={openSession} setOpen={setOpenSession} />}
        {section === 'projects' && (project
          ? <ProjectDetail project={project} onBack={() => setProject(null)}
              onOpenSessions={p => { setWorkspace(p.workspaceId || p.folder); setProject(null); setSection('sessions') }} />
          : <Projects onOpen={setProject} />)}
        {section === 'team' && <Team />}
        {section === 'tooling' && <Tooling q={q} />}
      </main>
    </div>
  )
}
