import React, { useState } from 'react'
import { useGame } from './useGame.js'
import { ProgressRing } from './primitives.jsx'
import { Stagger, Shimmer } from './anim.jsx'

// The full wall. Locked badges are not hidden and not greyed into uselessness — they carry a progress
// ring and a "N to go", because a locked achievement whose distance you can't see is just decoration.
// Filter defaults to the dashboard you're on; "All" shows every badge across all four.

const TIERS = { bronze: '#c98b5e', silver: '#b9c2cc', gold: '#e5a03a' }
const DASH = { claude: 'Harness', eng: 'Delivery', career: 'Career', cursor: 'Cursor' }
const fmtDate = t => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

export default function AchievementGrid({ dashboard }) {
  const { game, loading } = useGame(dashboard)
  const [filter, setFilter] = useState(dashboard || 'all')

  if (loading) return <div className="ach-grid">{Array.from({ length: 8 }, (_, i) => <Shimmer key={i} h={104} r={14} />)}</div>
  if (!game) return null

  const all = game.achievements || []
  const list = filter === 'all' ? all : all.filter(a => a.dash === filter)
  const shown = [...list].sort((a, b) =>
    (b.unlocked ? 1 : 0) - (a.unlocked ? 1 : 0) ||
    (b.unlocked ? b.unlockedAt - a.unlockedAt : b.progress.have / b.progress.need - a.progress.have / a.progress.need))
  const got = list.filter(a => a.unlocked).length

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Achievements <span className="muted mono">{got}/{list.length}</span></h3>
        <div className="ach-filters">
          {['all', 'eng', 'claude', 'career', 'cursor'].map(f => (
            <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>{f === 'all' ? 'All' : DASH[f]}</button>
          ))}
        </div>
      </div>

      <Stagger className="ach-grid" step={26} max={520}>
        {shown.map(a => (
          <div key={a.id} className={`ach ${a.unlocked ? 'got' : 'locked'}`} style={{ '--tier': TIERS[a.tier] }} title={a.unlocked ? `Unlocked ${fmtDate(a.unlockedAt)}` : `${a.progress.have} / ${a.progress.need}`}>
            <div className="ach-top">
              <div className="ach-emoji-wrap">
                {!a.unlocked && <ProgressRing have={a.progress.have} need={a.progress.need} size={46} stroke={3} />}
                <span className="ach-emoji">{a.icon}</span>
              </div>
              <span className="ach-tier mono">{a.tier}</span>
            </div>
            <div className="ach-name">{a.name}</div>
            <div className="ach-desc">{a.desc}</div>
            <div className="ach-foot mono">
              {a.unlocked
                ? <span className="ach-when">✓ {fmtDate(a.unlockedAt)}</span>
                : <span className="ach-prog">{a.progress.have} / {a.progress.need}<i> · {a.progress.need - a.progress.have} to go</i></span>}
            </div>
          </div>
        ))}
      </Stagger>
      <div className="small">Self-only. These are your own outcomes measured against your own past — there is no leaderboard and no other person's data in this view.</div>
    </div>
  )
}
