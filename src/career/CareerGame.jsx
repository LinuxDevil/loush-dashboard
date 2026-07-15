import React from 'react'
import { HEAD, BODY, MONO, INK, MUTE, LINE, PANEL_BG, ACCENT, GREEN, RED } from './theme.jsx'
import { GameStats, ProgressRing, CountUp } from '../game/index.js'
import { useGame } from '../game/useGame.js'

// The Career game layer. Two honest halves:
//
//   1. <GameStats dashboard="career"/> — the SHARED block (clay skin). It surfaces the real, global body
//      of work (level, lifetime XP, live streak) AND, scoped to this plane, the honest "0 from career ·
//      0/3 badges here". That number is not hidden and not flattered.
//
//   2. <PathOutOfZero/> — career-SPECIFIC, because the shared block can only show a generic progress ring.
//      This plane is 0 because career badges are earned by beating your OWN past, and one number is going
//      the wrong way. We render the exact number, the exact target, and how far it has to move. No
//      participation trophy: if the number regressed, we say so, in red.
//
// Nothing here attaches XP/level/badges to another human — this is self-only, same contract as everywhere.

const TIER_HEX = { bronze: '#c98b5e', silver: '#b9c2cc', gold: '#e5a03a' }

// A colored gap gauge for the bug-tax badge: current marker vs the target line you have to get under.
function TaxGauge({ pct, prevPct }) {
  const scale = Math.max(pct, prevPct) * 1.35 || 1
  const targetX = (prevPct / scale) * 100
  const curX = (pct / scale) * 100
  const over = pct > prevPct
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ position: 'relative', height: 8, background: LINE, borderRadius: 999 }}>
        {/* filled to current */}
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.min(100, curX)}%`, background: over ? RED : GREEN, borderRadius: 999, opacity: 0.55 }} />
        {/* target line you must get under */}
        <div title={`target ≤ ${prevPct}% (your prior period)`} style={{ position: 'absolute', left: `${Math.min(100, targetX)}%`, top: -3, bottom: -3, width: 2, background: INK, borderRadius: 2 }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, font: `400 10px ${MONO}`, color: MUTE }}>
        <span><span style={{ color: over ? RED : GREEN }}>●</span> now <b style={{ color: over ? RED : GREEN }}><CountUp value={pct} decimals={1} suffix="%" /></b></span>
        <span><span style={{ color: INK }}>▏</span> target ≤ <b style={{ color: INK }}>{prevPct}%</b> <i style={{ fontStyle: 'normal' }}>(your prior period)</i></span>
      </div>
    </div>
  )
}

// One badge row: ring + emoji + the honest "what has to move".
function BadgeRow({ ach, extra }) {
  const { progress: p, unlocked } = ach
  const toGo = Math.max(0, p.need - p.have)
  return (
    <div className="lift" style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: '13px 14px', background: PANEL_BG, border: `1px solid ${LINE}`, borderRadius: 12 }}>
      <div style={{ position: 'relative', width: 46, height: 46, flexShrink: 0, display: 'grid', placeItems: 'center' }}>
        {!unlocked && <ProgressRing have={p.have} need={p.need} size={46} stroke={3} />}
        <span style={{ position: 'absolute', fontSize: 19, filter: unlocked ? 'none' : 'grayscale(1)', opacity: unlocked ? 1 : 0.65 }}>{ach.icon}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ font: `600 13.5px ${HEAD}`, color: INK }}>{ach.name}</span>
          <span style={{ font: `500 9.5px ${MONO}`, color: TIER_HEX[ach.tier], textTransform: 'uppercase', letterSpacing: '0.06em' }}>{ach.tier}</span>
          <span style={{ flex: 1 }} />
          {unlocked
            ? <span style={{ font: `600 11px ${MONO}`, color: GREEN }}>✓ earned</span>
            : <span style={{ font: `600 11px ${MONO}`, color: ACCENT }}><CountUp value={p.have} /> / {p.need}{toGo ? <i style={{ fontStyle: 'normal', color: MUTE }}> · {toGo} to go</i> : null}</span>}
        </div>
        <div style={{ font: `400 11.5px ${BODY}`, color: MUTE, marginTop: 3, lineHeight: 1.45 }}>{ach.desc}.{extra ? ' ' : ''}{extra}</div>
      </div>
    </div>
  )
}

export default function CareerGame({ bugTax }) {
  const { game, mine, loading } = useGame('career')

  // The three career badges, in a fixed order (bug tax first — it is the plane's whole story).
  const career = (game?.achievements || []).filter(a => a.dash === 'career')
  const byId = Object.fromEntries(career.map(a => [a.id, a]))
  const order = ['better-than-before', 'brag-keeper', 'reflective']
  const badges = order.map(id => byId[id]).filter(Boolean)
  const earned = mine ? mine.unlocked : 0
  const total = mine ? mine.total : (badges.length || 3)

  // bugTax is null until eng loads, or if the snapshot never computed a comparison. Never render null as 0%.
  const bt = bugTax // { pct, prevPct } | null | undefined
  const btUp = bt && bt.pct > bt.prevPct

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* the shared block: global level / lifetime XP / live streak, plus the honest per-plane 0 */}
      <GameStats dashboard="career" />

      {/* the career-specific path out of the zero the block above just showed */}
      <div style={{ background: PANEL_BG, border: `1px solid ${LINE}`, borderRadius: 12, padding: '16px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
          <span style={{ font: `600 13px ${HEAD}`, color: INK }}>Your career badges</span>
          <span style={{ font: `500 11px ${MONO}`, color: MUTE }}>
            {loading ? <span className="skel" style={{ display: 'inline-block', width: 34, height: 12, borderRadius: 4, verticalAlign: 'middle' }} /> : <><CountUp value={earned} /> of {total} earned</>}
          </span>
        </div>
        <div style={{ font: `400 12px ${BODY}`, color: MUTE, lineHeight: 1.55, marginBottom: 14, maxWidth: 640 }}>
          This plane sits at <b style={{ color: INK }}>0&nbsp;XP</b>, and that is the honest reading — not an empty
          state to dress up. Career badges are earned only by beating <b style={{ color: INK }}>your own past</b>,
          never a colleague. Right now one number is moving the wrong way, so the engine has correctly awarded
          nothing. Here is exactly what has to move.
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          {loading && !badges.length
            ? [0, 1, 2].map(i => <div key={i} className="skel" style={{ height: 74, borderRadius: 12 }} />)
            : badges.map(a => (
              <BadgeRow
                key={a.id}
                ach={a}
                extra={a.id === 'better-than-before'
                  ? (bt
                    ? <span style={{ color: btUp ? RED : GREEN }}>
                        Bug tax is <b><CountUp value={bt.pct} decimals={1} suffix="%" /></b>{btUp ? ' — up from ' : ' — down from '}
                        <b>{bt.prevPct}%</b> last period, so it stays locked. It unlocks the moment bug tax falls
                        <b> below {bt.prevPct}%</b>, your own prior mark.
                      </span>
                    : <span style={{ color: MUTE }}>Bug-tax comparison not computed yet for this snapshot.</span>)
                  : null}
              />
            ))}
        </div>

        {/* the gap gauge only when we have a real comparison — never a null animated to zero */}
        {bt && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${LINE}` }}>
            <div style={{ font: `500 10.5px ${MONO}`, color: MUTE, textTransform: 'uppercase', letterSpacing: '0.06em' }}>The number that has to move</div>
            <TaxGauge pct={bt.pct} prevPct={bt.prevPct} />
          </div>
        )}

        <div style={{ font: `400 10.5px ${BODY}`, color: MUTE, marginTop: 14, lineHeight: 1.5 }}>
          Self-only. Every badge here is measured against your own history — there is no leaderboard and no
          other person's number in this view.
        </div>
      </div>
    </div>
  )
}
