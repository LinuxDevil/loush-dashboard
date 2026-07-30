import { useEffect, useRef, useState } from 'react'

export function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}

export function useVisiblePoll(fn, ms, deps = []) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    let timer = null
    const tick = () => { if (!document.hidden) ref.current() }
    const start = () => { tick(); timer = setInterval(tick, ms) }
    const stop = () => { if (timer) { clearInterval(timer); timer = null } }
    start()
    const onVis = () => { if (document.hidden) stop(); else if (!timer) start() }
    document.addEventListener('visibilitychange', onVis)
    return () => { stop(); document.removeEventListener('visibilitychange', onVis) }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
}
