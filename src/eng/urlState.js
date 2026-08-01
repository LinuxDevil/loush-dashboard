import { useCallback, useEffect, useState } from 'react'

export function useUrlState(defaults) {
  const read = () => {
    const q = new URLSearchParams(window.location.search)
    const out = { ...defaults }
    for (const k of Object.keys(defaults)) { const v = q.get(k); if (v != null && v !== '') out[k] = v }
    return out
  }
  const [state, setState] = useState(read)
  useEffect(() => {
    const onPop = () => setState(read())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const patch = useCallback(next => {
    setState(prev => {
      const s = { ...prev, ...next }
      const q = new URLSearchParams(window.location.search)
      for (const [k, v] of Object.entries(s)) {
        if (v == null || v === '' || v === defaults[k]) q.delete(k)
        else q.set(k, String(v))
      }
      q.set('dash', 'eng')
      window.history.replaceState(null, '', `${window.location.pathname}?${q}`)
      return s
    })
  }, [])
  return [state, patch]
}
