import { useEffect, useState } from 'react'
import { api } from '../api.js'

// One fetch of /api/game, shared by every dashboard that mounts a game component. The endpoint is
// TTL-cached server-side and four pages want it at once, so we memo the in-flight promise here too and
// broadcast the result — otherwise the Claude shell, Eng, Career and Cursor pages each fire their own.
let cached = null, inflight = null
const subs = new Set()
const emit = g => { cached = g; subs.forEach(f => f(g)) }

export function refreshGame() { cached = null; inflight = null; return load(true) }
function load(fresh) {
  if (!inflight) inflight = api.get('/api/game' + (fresh ? '?fresh=1' : '')).then(g => { emit(g); inflight = null; return g }).catch(e => { inflight = null; throw e })
  return inflight
}

// dashboard: 'claude' | 'eng' | 'career' | 'cursor' — only narrows `mine`; xp/level/streak are global,
// because they are one person's whole body of work, not a per-tab score.
export function useGame(dashboard) {
  const [game, setGame] = useState(cached)
  const [error, setError] = useState(null)
  useEffect(() => {
    subs.add(setGame)
    if (cached) setGame(cached); else load().catch(e => setError(e.message))
    return () => subs.delete(setGame)
  }, [])
  const mine = dashboard && game ? game.perDashboard?.[dashboard] : null
  return {
    game, error, loading: !game && !error, mine,
    // acknowledge unlock toasts — server-side, so the unlock fires exactly once ever, not once per tab.
    ack: async ids => {
      const list = ids || (game?.newlyUnlocked || []).map(a => a.id)
      if (!list.length) return
      await api.post('/api/game/seen', { ids: list }).catch(() => {})
      emit({ ...game, newlyUnlocked: (game.newlyUnlocked || []).filter(a => !list.includes(a.id)) })
    },
  }
}
