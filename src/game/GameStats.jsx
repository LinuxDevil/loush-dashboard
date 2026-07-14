import React from 'react'
import { useGame } from './useGame.js'
import { XpBar, StreakFlame, LevelBadge, ProgressRing } from './primitives.jsx'
import { CountUp, Stagger, Shimmer } from './anim.jsx'

// <GameStats dashboard="eng" /> — the block that sits on the MAIN PAGE of each dashboard.
//
// What it shows and why: your level and how far into it you are (the one number that says "this is a
// body of work"), the streak (consecutive days you produced a real OUTCOME — not days you had a session),
// what you most recently earned, and the single achievement you are closest to. That last one is the
// point of the whole block: it is the only part that tells you what to do next.
//
// Every number here is your own, measured against your own past. There is nobody else on this screen.

const ago = t => {
  const m = Math.round((Date.now() - t) / 60000)
  return m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago'
}

export default function GameStats({ dashboard = 'claude', compact = false }) {
  const { game, mine, loading } = useGame(dashboard)

  if (loading) return (
    <div className="panel game-stats">
      <div className="gs-grid"><Shimmer w="120px" h={54} /><Shimmer h={54} /><Shimmer w="140px" h={54} /></div>
    </div>
  )
  if (!game) return null

  // Recent is scoped to the dashboard you're standing on — on the Eng page you want your ships and
  // reviews, not your cache-read wins. Falls back to everything if this dashboard has no outcomes yet.
  const next = game.nextUp?.find(a => a.dash === dashboard) || game.nextUp?.[0]
  const scoped = (game.recent || []).filter(e => e.dash === dashboard)
  const recent = (scoped.length ? scoped : game.recent || []).slice(0, compact ? 3 : 5)

  return (
    <div className="panel game-stats">
      <div className="gs-grid">
        <div className="gs-level">
          <LevelBadge level={game.level} name={game.levelName} />
        </div>

        <div className="gs-xp">
          <XpBar
            value={game.intoLevel} max={game.intoLevel + game.toNext}
            label={<span>Level {game.level} → {game.level + 1}</span>}
            sub={<>
              <CountUp value={game.xp} format={n => Math.round(n).toLocaleString()} /> XP lifetime
              {mine && <> · <b>{mine.xp.toLocaleString()}</b> from {dashboard === 'claude' ? 'the harness' : dashboard} · {mine.unlocked}/{mine.total} badges here</>}
            </>}
          />
        </div>

        <div className="gs-streak">
          <StreakFlame days={game.streak?.current || 0} best={game.streak?.best} />
          <div className="gs-streak-cap mono">days with a real outcome</div>
        </div>
      </div>

      <div className="gs-split">
        <div className="gs-recent">
          <div className="gs-cap">Recently earned</div>
          {recent.length ? (
            <Stagger className="gs-list" step={50}>
              {recent.map((e, i) => (
                <div className="gs-ev" key={e.event + e.at + i}>
                  <span className="gs-ev-icon">{e.icon}</span>
                  <span className="gs-ev-body">
                    <b>{e.label}</b>
                    <i className="mono">{e.subject}</i>
                  </span>
                  <span className="gs-ev-xp mono">+{e.xp}</span>
                  <span className="gs-ev-at mono">{ago(e.at)}</span>
                </div>
              ))}
            </Stagger>
          ) : <div className="small">No outcomes yet on this dashboard. Ship something.</div>}
        </div>

        {next && (
          <div className="gs-next">
            <div className="gs-cap">Closest badge</div>
            <div className="gs-next-card">
              <div className="gs-next-ring">
                <ProgressRing have={next.progress.have} need={next.progress.need} size={54} stroke={4} />
                <span className="gs-next-emoji locked">{next.icon}</span>
              </div>
              <div className="gs-next-body">
                <b>{next.name}</b>
                <span className="small">{next.desc}</span>
                <span className="mono gs-next-prog">
                  <CountUp value={next.progress.have} /> / {next.progress.need}
                  <i> · {next.progress.need - next.progress.have} to go</i>
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
