import React from 'react'
import { CountUp } from './anim.jsx'

// The three primitives. Deliberately dumb: they take numbers, not the game object, so a dashboard can
// render an XP bar or a level badge next to any local stat without going through /api/game.

// <XpBar value={1067} max={1300} /> — the fill transition is CSS (width), so reduced-motion kills it.
export function XpBar({ value = 0, max = 1, label, sub, height = 8, showNums = true }) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100))
  return (
    <div className="xp-block">
      {(label || showNums) && (
        <div className="xp-head">
          <span>{label}</span>
          {showNums && <span className="mono xp-nums"><CountUp value={value} format={n => Math.round(n).toLocaleString()} /> <i>/ {Math.round(max).toLocaleString()} XP</i></span>}
        </div>
      )}
      <div className="xp-bar" style={{ height }} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className="xp-fill" style={{ width: pct + '%' }} />
      </div>
      {sub && <div className="xp-sub mono">{sub}</div>}
    </div>
  )
}

// <StreakFlame days={3} /> — the flame only burns when the streak is alive. A dead streak is a grey
// ember, not a flame: it must not look like an achievement.
export function StreakFlame({ days = 0, best, size = 'md' }) {
  const alive = days > 0
  return (
    <div className={`streak ${size} ${alive ? 'alive' : 'cold'}`} title={best ? `best: ${best} days` : undefined}>
      <span className="streak-flame" aria-hidden="true">{alive ? '🔥' : '·'}</span>
      <span className="streak-n"><CountUp value={days} /></span>
      <span className="streak-unit">day{days === 1 ? '' : 's'}</span>
      {best > days && <span className="streak-best mono">best {best}</span>}
    </div>
  )
}

// <LevelBadge level={8} name="Steward" /> — the hexish clay chip. Size 'sm' fits a topbar.
export function LevelBadge({ level = 1, name, size = 'md' }) {
  return (
    <div className={`lvl-badge ${size}`}>
      <div className="lvl-ring"><span className="lvl-n">{level}</span></div>
      {name && <div className="lvl-name">{name}</div>}
    </div>
  )
}

// Progress ring for a locked achievement — how close you are, drawn on the badge itself.
export function ProgressRing({ have = 0, need = 1, size = 40, stroke = 3 }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(1, have / (need || 1)))
  return (
    <svg className="ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--accent)" strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - pct)} transform={`rotate(-90 ${size / 2} ${size / 2})`} className="ring-fill" />
    </svg>
  )
}
