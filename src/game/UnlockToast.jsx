import React, { useEffect, useState } from 'react'
import { useGame } from './useGame.js'
import { Spark } from './anim.jsx'

// Fires ONCE per unlock, ever. `newlyUnlocked` comes from the server (game.json remembers what you've
// already seen), so reloading the page does not replay your badges at you, and four dashboards open at
// once do not each toast the same thing. We ack as soon as it is shown.
//
// Celebratory but brief: one card, 4.6s, a spark burst, gone. Mount it once, high in the tree.

const HOLD = 4600

export default function UnlockToast() {
  const { game, ack } = useGame()
  const [queue, setQueue] = useState([])
  const [cur, setCur] = useState(null)

  useEffect(() => {
    const fresh = game?.newlyUnlocked || []
    if (!fresh.length) return
    setQueue(q => [...q, ...fresh.filter(a => !q.some(x => x.id === a.id))])
    ack(fresh.map(a => a.id)) // ack on arrival — one unlock, one toast, forever
  }, [game?.newlyUnlocked])

  useEffect(() => {
    if (cur || !queue.length) return
    setCur(queue[0])
    setQueue(q => q.slice(1))
    const t = setTimeout(() => setCur(null), HOLD)
    return () => clearTimeout(t)
  }, [queue, cur])

  if (!cur) return null
  return (
    <div className="unlock-toast" role="status" onClick={() => setCur(null)}>
      <div className="ut-emoji">
        <Spark />
        <span>{cur.icon}</span>
      </div>
      <div className="ut-body">
        <div className="ut-kicker mono">achievement unlocked · {cur.tier}</div>
        <div className="ut-name">{cur.name}</div>
        <div className="ut-desc">{cur.desc}</div>
      </div>
    </div>
  )
}
