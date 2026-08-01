import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

export function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}

/**
 * Wrap a setState so that only the NEWEST request it is given can land.
 *
 * THE FAILURE THIS PREVENTS, observed rather than imagined: the runs list issued an unfiltered
 * fetch and then a scoped one, the unfiltered response arrived second, and the pane rendered every
 * project's runs underneath a filter pill that still read "proj: loushai". Nothing errored, nothing
 * looked broken, and the rows were simply from somewhere else — which is the worst failure a
 * dashboard has, because the reader has no way to tell.
 *
 * This matters more now that one selector retargets four panes at once: a single dropdown change
 * puts four requests in flight against four still-rendered predecessors.
 *
 * Aborting would be tighter, but `api.get` takes no options and treats any second argument as "this
 * is a mutation" (skipping the fresh=1 injection and swallowing the error event). Ignoring the
 * answer is a smaller change than re-cutting the request wrapper, and it fixes the same failure.
 *
 *   const fresh = useFreshest(setData)
 *   const load = () => fresh(api.get(url)).catch(() => {})
 */
export function freshest() {
  let gen = 0
  return (promise, apply) => {
    const mine = ++gen
    return promise.then(v => { if (mine === gen) apply(v); return v })
  }
}

export function useFreshest(setter) {
  const ref = useRef(null)
  if (!ref.current) ref.current = freshest()
  return useCallback(promise => ref.current(promise, setter), [setter])
}

/**
 * True when the pane this component sits in is the one on screen. A Hub keeps every pane you have
 * visited MOUNTED so it holds its state, which means a poller inside a hidden pane keeps polling
 * forever — visit eight panes and you leave eight timers running against the server for the rest of
 * the session. Defaults to true so a component outside any Hub behaves exactly as before.
 */
export const PaneVisible = createContext(true)

export function useVisiblePoll(fn, ms, deps = []) {
  const ref = useRef(fn)
  ref.current = fn
  const paneVisible = useContext(PaneVisible)
  const paneRef = useRef(paneVisible)
  paneRef.current = paneVisible
  useEffect(() => {
    let timer = null
    const tick = () => { if (!document.hidden && paneRef.current) ref.current() }
    // The FIRST load is unconditional; only the repeating poll waits for visibility. Gating both
    // meant a section mounted in a background tab sat on its skeletons until you focused the tab —
    // and a headless or hidden window never loaded it at all.
    const start = () => { ref.current(); timer = setInterval(tick, ms) }
    const stop = () => { if (timer) { clearInterval(timer); timer = null } }
    start()
    const onVis = () => { if (document.hidden) stop(); else if (!timer) start() }
    document.addEventListener('visibilitychange', onVis)
    return () => { stop(); document.removeEventListener('visibilitychange', onVis) }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
}
