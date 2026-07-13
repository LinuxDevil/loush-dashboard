import React, { useEffect, useMemo, useState } from 'react'

// Fun layer bolted onto the real metrics — personal dashboard, so scores are cosmetic,
// not comp-review material. Everything here is derived from issues/prs already loaded
// by EngDashboard; only a handful of small values (bests, last level, mute, theme) persist
// to localStorage so streaks/records survive a refresh.
const HEAD = "'Space Grotesk', sans-serif"
const BODY = "'IBM Plex Sans', sans-serif"
const MONO = "'IBM Plex Mono', monospace"
const BB = '#8ec8ff', GREEN = '#5fd39a', GOLD = '#f5c451', RED = '#f2777a', PURPLE = '#a894f0'
const PANEL = { background: 'linear-gradient(160deg,rgba(19,27,38,0.92),rgba(11,16,23,0.72))', border: '1px solid rgba(142,200,255,0.09)', borderRadius: 14 }
const fx = (n, d = 1) => Number(n || 0).toFixed(d)
const Card = ({ children, style }) => <div style={{ ...PANEL, padding: '16px 18px', ...style }}>{children}</div>
const CardHead = ({ title, meta }) => <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
  <div style={{ font: `600 14px ${HEAD}`, color: '#eaf1f9' }}>{title}</div>
  <div style={{ font: `400 10.5px ${MONO}`, color: '#647285' }}>{meta}</div></div>

const THEMES = [ // loot unlocks — cosmetic accent only, gated by level
  { at: 1, id: 'sky', label: 'Sky', color: BB },
  { at: 3, id: 'sunset', label: 'Sunset', color: '#f2a2c4' },
  { at: 5, id: 'mint', label: 'Mint', color: GREEN },
  { at: 8, id: 'royal', label: 'Royal', color: PURPLE },
]
const store = { // tiny localStorage wrapper, all keys namespaced per project
  get(k, fallback) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? fallback : v } catch { return fallback } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} },
}
const dayKey = d => new Date(d).toDateString()
const isWeekend = d => { const w = d.getDay(); return w === 0 || w === 6 }

function activityDates(prs) {
  const set = new Set()
  for (const p of prs) {
    if (p.mergedAt) set.add(dayKey(p.mergedAt))
    for (const e of p.reviewEvents || []) if (e.state === 'APPROVED' && e.at) set.add(dayKey(e.at))
  }
  return set
}
function streaks(dateSet) {
  const days = [...dateSet].map(s => new Date(s)).sort((a, b) => a - b)
  if (!days.length) return { current: 0, longest: 0 }
  let longest = 1, run = 1
  for (let i = 1; i < days.length; i++) {
    const gapDays = Math.round((days[i] - days[i - 1]) / 86400000)
    const onlyWeekendGap = gapDays <= 3 && [1, 2, 3].slice(0, gapDays).every((_, k) => isWeekend(new Date(days[i - 1].getTime() + (k + 1) * 86400000)))
    if (gapDays === 1 || onlyWeekendGap) run++; else run = 1
    longest = Math.max(longest, run)
  }
  // current: walk back from today, allow weekend gaps without activity
  let current = 0, cursor = new Date()
  while (true) {
    const key = dayKey(cursor)
    if (dateSet.has(key)) { current++; cursor = new Date(cursor.getTime() - 86400000) }
    else if (isWeekend(cursor)) { cursor = new Date(cursor.getTime() - 86400000) }
    else break
  }
  return { current, longest }
}
function heatmapDays(dateSet, weeks = 14) {
  const out = []
  const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - weeks * 7)
  for (let i = 0; i < weeks * 7; i++) { const d = new Date(start.getTime() + i * 86400000); out.push({ d, key: dayKey(d), n: dateSet.has(dayKey(d)) ? 1 : 0 }) }
  return out
}

const BADGE_DEFS = [
  { id: 'clean', icon: '🧹', label: 'Clean Merge', hint: 'a PR merged first-pass, no review rounds', test: ({ prs }) => prs.some(p => p.state === 'Merged' && p.cycles <= 1) },
  { id: 'speed', icon: '⚡', label: 'Speed Demon', hint: 'a ticket shipped in under a day', test: ({ shipped }) => shipped.some(i => i.delivery <= 1) },
  { id: 'sharp', icon: '🎯', label: 'Sharpshooter', hint: 'an estimate landed ≥95% accurate', test: ({ shipped }) => shipped.some(i => (i.estAcc ?? 0) >= 95) },
  { id: 'owl', icon: '🌙', label: 'Night Owl', hint: 'merged something after 9pm', test: ({ prs }) => prs.some(p => p.mergedAt && new Date(p.mergedAt).getHours() >= 21) },
  { id: 'lark', icon: '🌅', label: 'Early Bird', hint: 'merged something before 7am', test: ({ prs }) => prs.some(p => p.mergedAt && new Date(p.mergedAt).getHours() < 7) },
  { id: 'oneshot', icon: '✅', label: 'One-Shot QA', hint: 'a ticket cleared QA with 0 re-test loops', test: ({ shipped }) => shipped.some(i => i.qaCycles === 0) },
  { id: 'marathon', icon: '🏔', label: 'Marathoner', hint: 'shipped something that took 14+ days', test: ({ shipped }) => shipped.some(i => i.delivery >= 14) },
  { id: 'century', icon: '💯', label: 'Century', hint: '100+ XP earned', test: ({ xp }) => xp >= 100 },
  { id: 'prolific', icon: '🚀', label: 'Prolific', hint: '25+ PRs merged lifetime', test: ({ prs }) => prs.filter(p => p.state === 'Merged').length >= 25 },
  { id: 'onfire', icon: '🔥', label: 'On Fire', hint: '5+ day activity streak', test: ({ streak }) => streak.current >= 5 },
]

function xpLevel(xp) {
  const level = Math.floor(Math.sqrt(xp / 40)) + 1
  const xpFor = l => Math.round(40 * (l - 1) ** 2)
  return { level, floor: xpFor(level), ceil: xpFor(level + 1) }
}
const PET_STAGES = [[1, '🥚', 'Egg'], [3, '🐣', 'Hatchling'], [6, '🐥', 'Fledgling'], [10, '🦉', 'Owl'], [15, '🐉', 'Dragon']]
const petFor = level => [...PET_STAGES].reverse().find(([at]) => level >= at) || PET_STAGES[0]

function Confetti({ onDone }) {
  const bits = useMemo(() => Array.from({ length: 36 }, (_, i) => ({
    left: Math.random() * 100, delay: Math.random() * 0.4, dur: 1.6 + Math.random() * 0.8,
    rot: Math.random() * 360, emoji: ['🎉', '✨', '🎊', '⭐'][i % 4],
  })), [])
  useEffect(() => { const t = setTimeout(onDone, 2400); return () => clearTimeout(t) }, [onDone])
  return <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999, overflow: 'hidden' }}>
    {bits.map((b, i) => <span key={i} style={{ position: 'absolute', left: `${b.left}%`, top: -30, fontSize: 20, animation: `confetti-fall ${b.dur}s ease-in ${b.delay}s forwards`, transform: `rotate(${b.rot}deg)` }}>{b.emoji}</span>)}
    <style>{`@keyframes confetti-fall{to{transform:translateY(110vh) rotate(340deg);opacity:0.2}}`}</style>
  </div>
}
function ding() { // best-effort two-note chime, ignored if audio is blocked
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    ;[523, 784].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain()
      o.frequency.value = f; o.type = 'sine'; o.connect(g); g.connect(ctx.destination)
      const t0 = ctx.currentTime + i * 0.12
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.15, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35)
      o.start(t0); o.stop(t0 + 0.4)
    })
  } catch {}
}

// Compact single-row hero for the Overview main screen. Same XP/streak/badge maths as the full
// Arcade tab, condensed. Click to jump to the Arcade (onOpen), if wired.
export function GameStrip({ issues = [], prs = [], project, onOpen }) {
  const shipped = issues.filter(i => i.live)
  const merged = prs.filter(p => p.state === 'Merged')
  const cleanPRs = merged.filter(p => p.cycles <= 1)
  const xp = shipped.length * 20 + merged.length * 10 + cleanPRs.length * 5
  const { level, floor, ceil } = xpLevel(xp)
  const progress = Math.min(1, Math.max(0, (xp - floor) / (ceil - floor)))
  const dates = activityDates(prs)
  const streak = streaks(dates)
  const earned = BADGE_DEFS.filter(b => b.test({ prs, shipped, xp, streak }))
  const [stage, stageLabel] = petFor(level)
  return (
    <div onClick={onOpen} title={onOpen ? 'Open the Arcade' : undefined}
      style={{ ...PANEL, padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', cursor: onOpen ? 'pointer' : 'default' }}>
      <div style={{ fontSize: 30, lineHeight: 1 }}>{stage}</div>
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ font: `700 16px ${HEAD}`, color: '#f0f5fb' }}>Level {level}</span>
          <span style={{ font: `500 11px ${BODY}`, color: '#8b98a9' }}>{stageLabel} · {xp} XP</span>
        </div>
        <div style={{ height: 6, borderRadius: 4, background: 'rgba(142,200,255,0.08)', overflow: 'hidden', marginTop: 6 }}>
          <div style={{ height: '100%', width: `${progress * 100}%`, background: BB, borderRadius: 4 }} />
        </div>
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ font: `700 15px ${HEAD}`, color: streak.current ? GOLD : '#647285' }}>🔥 {streak.current}d</div>
        <div style={{ font: `400 9px ${MONO}`, color: '#647285' }}>streak · best {streak.longest}</div>
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ font: `700 15px ${HEAD}`, color: earned.length ? GREEN : '#647285' }}>🏅 {earned.length}/{BADGE_DEFS.length}</div>
        <div style={{ font: `400 9px ${MONO}`, color: '#647285' }}>badges</div>
      </div>
      {earned.length ? <div style={{ display: 'flex', gap: 4 }}>{earned.slice(0, 5).map(b => <span key={b.id} title={b.label} style={{ fontSize: 17 }}>{b.icon}</span>)}</div> : null}
      {onOpen ? <span style={{ font: `600 11px ${MONO}`, color: BB }}>🎮 Arcade →</span> : null}
    </div>
  )
}

export default function GameTab({ issues, prs, project }) {
  const ns = k => `eng-game:${project || 'all'}:${k}`
  const [muted, setMuted] = useState(() => store.get(ns('muted'), false))
  const [theme, setTheme] = useState(() => store.get(ns('theme'), 'sky'))
  const [celebrate, setCelebrate] = useState(false)

  const shipped = useMemo(() => issues.filter(i => i.live), [issues])
  const active = useMemo(() => issues.filter(i => i.active), [issues])
  const merged = useMemo(() => prs.filter(p => p.state === 'Merged'), [prs])
  const cleanPRs = useMemo(() => merged.filter(p => p.cycles <= 1), [merged])
  const xp = shipped.length * 20 + merged.length * 10 + cleanPRs.length * 5
  const { level, floor, ceil } = xpLevel(xp)
  const progress = Math.min(1, Math.max(0, (xp - floor) / (ceil - floor)))

  const dates = useMemo(() => activityDates(prs), [prs])
  const streak = useMemo(() => streaks(dates), [dates])
  const days = useMemo(() => heatmapDays(dates), [dates])
  const today = dayKey(new Date())
  const comboToday = prs.filter(p => p.mergedAt && dayKey(p.mergedAt) === today).length

  const badges = BADGE_DEFS.map(b => ({ ...b, earned: b.test({ prs, shipped, xp, streak }) }))
  const earnedCount = badges.filter(b => b.earned).length

  // personal bests — compare freshly computed mins against whatever's stored, persist if beaten
  const bestsNow = {
    cycle: shipped.length ? Math.min(...shipped.map(i => i.delivery)) : null,
    merge: merged.length ? Math.min(...merged.map(p => p.mergeDays ?? Infinity).filter(Number.isFinite)) : null,
    review: merged.length ? Math.min(...merged.map(p => p.firstReviewDays ?? Infinity).filter(Number.isFinite)) : null,
  }
  const [bests, setBests] = useState(() => store.get(ns('bests'), {}))
  const [justBeat, setJustBeat] = useState({})
  useEffect(() => {
    const next = { ...bests }, beat = {}
    for (const k of ['cycle', 'merge', 'review']) {
      const v = bestsNow[k]
      if (v != null && (next[k] == null || v < next[k])) { next[k] = v; beat[k] = true }
    }
    if (Object.keys(beat).length) { setBests(next); store.set(ns('bests'), next); setJustBeat(beat); const t = setTimeout(() => setJustBeat({}), 4000); return () => clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bestsNow.cycle, bestsNow.merge, bestsNow.review])

  // level-up celebration, once per level, remembered across sessions
  useEffect(() => {
    const last = store.get(ns('last-level'), 1)
    if (level > last) { store.set(ns('last-level'), level); setCelebrate(true); if (!muted) ding() }
  }, [level]) // eslint-disable-line react-hooks/exhaustive-deps

  // weekly recap — day-precision data only exists on PRs (issues only carry month/year)
  const now = Date.now(), d7 = 7 * 86400000
  const thisWeek = merged.filter(p => p.mergedAt && now - new Date(p.mergedAt).getTime() < d7)
  const lastWeek = merged.filter(p => p.mergedAt && now - new Date(p.mergedAt).getTime() >= d7 && now - new Date(p.mergedAt).getTime() < 2 * d7)
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null
  const wk = { count: thisWeek.length, prevCount: lastWeek.length, review: avg(thisWeek.map(p => p.firstReviewDays).filter(v => v != null)), merge: avg(thisWeek.map(p => p.mergeDays).filter(v => v != null)) }

  // boss battle — the active ticket furthest over its recommended budget
  const boss = [...active].filter(i => i.rec).sort((a, b) => (a.rec.remaining ?? 0) - (b.rec.remaining ?? 0))[0]
  const bossPct = boss ? Math.max(0, Math.min(100, (boss.rec.remaining / boss.rec.budget) * 100)) : null

  const [stage, stageLabel] = petFor(level)
  const petMood = wk.merge != null && lastWeek.length ? (avg(lastWeek.map(p => p.mergeDays).filter(v => v != null)) > wk.merge ? '😻' : '😿') : '😐'

  const flavor = () => {
    if (boss && boss.rec.atRisk) return `👹 "${boss.key}" is winning the boss fight — ${fx(Math.abs(boss.rec.remaining))}d over budget.`
    if (streak.current >= 7) return `🔥 ${streak.current}-day streak. Don't be the one who breaks it.`
    if (comboToday >= 3) return `⚡ ${comboToday} merges today — someone's in the zone.`
    if (wk.review != null && wk.review > 2) return `😴 Reviewers are asleep — ${fx(wk.review)}d avg wait this week.`
    if (earnedCount === 0) return `🌱 No badges yet — ship something to get the streak going.`
    return `✨ Steady as she goes.`
  }

  const accent = THEMES.find(t => t.id === theme)?.color || BB
  const unlocked = THEMES.filter(t => level >= t.at)

  return <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    {celebrate && <Confetti onDone={() => setCelebrate(false)} />}

    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 40, lineHeight: 1 }}>{stage}</div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ font: `700 20px ${HEAD}`, color: '#f0f5fb' }}>Level {level}</span>
            <span style={{ font: `500 12px ${BODY}`, color: '#8b98a9' }}>{stageLabel} · {xp} XP</span>
          </div>
          <div style={{ height: 8, borderRadius: 5, background: 'rgba(142,200,255,0.08)', overflow: 'hidden', marginTop: 7 }}>
            <div style={{ height: '100%', width: `${progress * 100}%`, background: accent, borderRadius: 5, transition: 'width .3s' }} />
          </div>
          <div style={{ font: `400 10px ${MONO}`, color: '#647285', marginTop: 4 }}>{xp - floor} / {ceil - floor} to level {level + 1}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22 }}>🔥</div>
            <div style={{ font: `700 15px ${HEAD}`, color: streak.current ? GOLD : '#647285' }}>{streak.current}d</div>
            <div style={{ font: `400 9px ${MONO}`, color: '#647285' }}>streak · best {streak.longest}</div>
          </div>
          {comboToday >= 2 && <div style={{ textAlign: 'center' }}><div style={{ fontSize: 22 }}>💥</div><div style={{ font: `700 15px ${HEAD}`, color: RED }}>x{comboToday}</div><div style={{ font: `400 9px ${MONO}`, color: '#647285' }}>combo today</div></div>}
          <div style={{ textAlign: 'center' }}><div style={{ fontSize: 22 }}>{petMood}</div><div style={{ font: `400 9px ${MONO}`, color: '#647285' }}>mood</div></div>
        </div>
        <button onClick={() => { const m = !muted; setMuted(m); store.set(ns('muted'), m) }} title="mute level-up chime"
          style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid rgba(142,200,255,0.16)', background: 'rgba(18,27,39,0.9)', color: '#cfe0f2', cursor: 'pointer' }}>{muted ? '🔇' : '🔊'}</button>
      </div>
      <div style={{ marginTop: 12, padding: '9px 12px', borderRadius: 9, background: 'rgba(142,200,255,0.06)', font: `500 12.5px ${BODY}`, color: '#c3cfdc' }}>{flavor()}</div>
      {unlocked.length > 1 && <div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center' }}>
        <span style={{ font: `400 9.5px ${MONO}`, color: '#647285', marginRight: 4 }}>theme</span>
        {unlocked.map(t => <button key={t.id} onClick={() => { setTheme(t.id); store.set(ns('theme'), t.id) }} title={t.label}
          style={{ width: 20, height: 20, borderRadius: '50%', background: t.color, border: theme === t.id ? '2px solid #fff' : '2px solid transparent', cursor: 'pointer', padding: 0 }} />)}
      </div>}
    </Card>

    <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 12 }}>
      <Card>
        <CardHead title="Badges" meta={`${earnedCount}/${badges.length} earned`} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10 }}>
          {badges.map(b => <div key={b.id} title={b.hint} style={{ textAlign: 'center', padding: '10px 6px', borderRadius: 10, background: b.earned ? 'rgba(142,200,255,0.08)' : 'rgba(255,255,255,0.02)', opacity: b.earned ? 1 : 0.35 }}>
            <div style={{ fontSize: 22, filter: b.earned ? 'none' : 'grayscale(1)' }}>{b.icon}</div>
            <div style={{ font: `600 9px ${MONO}`, color: b.earned ? '#dbe4ef' : '#4a5567', marginTop: 4 }}>{b.label}</div>
          </div>)}
        </div>
      </Card>
      <Card>
        <CardHead title="Personal bests" meta="lifetime · this project" />
        {[['cycle', 'Fastest cycle', bests.cycle], ['merge', 'Fastest merge', bests.merge], ['review', 'Fastest first review', bests.review]].map(([k, label, v]) =>
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(142,200,255,0.05)' }}>
            <span style={{ font: `400 12px ${BODY}`, color: '#8b98a9' }}>{label}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {justBeat[k] && <span style={{ font: `700 9px ${MONO}`, color: GOLD }}>NEW!</span>}
              <span style={{ font: `600 13px ${MONO}`, color: v == null ? '#647285' : GREEN }}>{v == null ? '—' : fx(v) + 'd'}</span>
            </span>
          </div>)}
      </Card>
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <Card>
        <CardHead title="Boss battle" meta={boss ? boss.key : 'none active'} />
        {!boss ? <div style={{ font: `400 12.5px ${BODY}`, color: '#647285' }}>No active ticket over budget — nothing to fight.</div> : <>
          <div style={{ font: `500 13px ${BODY}`, color: '#c3cfdc', marginBottom: 8 }}>{boss.summary}</div>
          <div style={{ height: 14, borderRadius: 7, background: 'rgba(242,119,122,0.12)', overflow: 'hidden', marginBottom: 6 }}>
            <div style={{ height: '100%', width: `${Math.max(4, bossPct)}%`, background: boss.rec.atRisk ? RED : GOLD, borderRadius: 7, transition: 'width .3s' }} />
          </div>
          <div style={{ font: `400 11px ${MONO}`, color: '#647285' }}>{boss.rec.atRisk ? `${fx(Math.abs(boss.rec.remaining))}d over budget` : `${fx(boss.rec.remaining)}d of ${fx(boss.rec.budget)}d left`}</div>
        </>}
      </Card>
      <Card>
        <CardHead title="This week" meta="vs last week · PRs merged" />
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ font: `700 26px ${HEAD}`, color: accent }}>{wk.count}</span>
          <span style={{ font: `600 12px ${MONO}`, color: wk.count >= wk.prevCount ? GREEN : RED }}>{wk.count >= wk.prevCount ? '↑' : '↓'} vs {wk.prevCount}</span>
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
          <div><div style={{ font: `400 10px ${MONO}`, color: '#647285' }}>avg review</div><div style={{ font: `600 13px ${MONO}`, color: PURPLE }}>{wk.review == null ? '—' : fx(wk.review) + 'd'}</div></div>
          <div><div style={{ font: `400 10px ${MONO}`, color: '#647285' }}>avg merge</div><div style={{ font: `600 13px ${MONO}`, color: '#e0e8f2' }}>{wk.merge == null ? '—' : fx(wk.merge) + 'd'}</div></div>
        </div>
      </Card>
    </div>

    <Card>
      <CardHead title="Activity" meta="14 weeks · PR merges & approvals" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(14,1fr)', gridAutoFlow: 'column', gridTemplateRows: 'repeat(7,1fr)', gap: 3, width: 'fit-content' }}>
        {days.map(day => <div key={day.key} title={`${day.d.toLocaleDateString()} · ${day.n ? 'active' : 'quiet'}`}
          style={{ width: 13, height: 13, borderRadius: 3, background: day.n ? accent : 'rgba(142,200,255,0.07)' }} />)}
      </div>
    </Card>
  </section>
}
