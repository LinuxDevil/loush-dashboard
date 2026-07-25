// Presentational animation primitives — CountUp, Stagger, Draw, Spark, Shimmer.
//
// These used to live in src/game/ alongside the XP bar, streak flame and achievement wall. When the
// gamification layer was deleted, these came with it by accident: they are plain React with no game
// state, used by ten surviving panels. Motion is not a metric — only the scoring was the problem.
import React, { useEffect, useRef, useState } from 'react'

// Micro-animation primitives, shared by all four dashboards. CSS-first: every one of these is a thin
// React shim over a class in styles.css. No animation library, no new dependency.
//
// REDUCED MOTION IS NOT OPTIONAL. Everything below snaps to its final state when the user has asked
// for less motion — CountUp lands on the number instantly, Stagger renders with no delay, Draw shows
// the whole path. The CSS half is handled by the one @media (prefers-reduced-motion: reduce) block in
// styles.css; the JS half (anything driven by requestAnimationFrame) has to check the query itself,
// which is what useReducedMotion is for.

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

// <CountUp value={1234} /> — animates a number up to its value. Drop it into any stat tile in the app.
// Re-animates from the PREVIOUS value when the value changes, so a poll that moves 40 → 45 counts 40→45,
// not 0→45. decimals/prefix/suffix/format cover every tile shape we have (%, $, tokens, 1dp).
const easeOut = t => 1 - Math.pow(1 - t, 3)
export function CountUp({ value = 0, duration = 700, decimals = 0, prefix = '', suffix = '', format, className, style }) {
  const reduced = useReducedMotion()
  const [n, setN] = useState(0) // first mount rises 0 → value; later changes rise from the previous value
  const from = useRef(0)
  const raf = useRef(0)
  useEffect(() => {
    const target = Number(value) || 0
    if (reduced || from.current === target) { from.current = target; setN(target); return }
    const start = performance.now(), a = from.current
    const tick = now => {
      const t = Math.min(1, (now - start) / duration)
      setN(a + (target - a) * easeOut(t))
      if (t < 1) raf.current = requestAnimationFrame(tick)
      else from.current = target
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [value, duration, reduced])
  const shown = format ? format(n) : n.toFixed(decimals)
  return <span className={className} style={style}>{prefix}{shown}{suffix}</span>
}

// <Stagger> wraps a list so its children fade+rise in sequence on mount. Cap the delay so a 300-row
// table doesn't take 30 seconds to finish arriving.
export function Stagger({ children, step = 40, max = 400, className = '', tag: Tag = 'div', ...rest }) {
  return (
    <Tag className={className} {...rest}>
      {React.Children.map(children, (c, i) =>
        React.isValidElement(c) ? React.cloneElement(c, { style: { ...(c.props.style || {}), '--enter-delay': `${Math.min(i * step, max)}ms` }, className: `${c.props.className || ''} enter`.trim() }) : c)}
    </Tag>
  )
}

// <Draw> — chart draw-in for any SVG stroke (line, spark, ring). Sets the dash-offset from the real
// measured path length, then lets CSS run it to zero. Under reduced motion it just shows the path.
export function Draw({ children, duration = 600, delay = 0 }) {
  const ref = useRef(null)
  const reduced = useReducedMotion()
  useEffect(() => {
    if (!ref.current) return
    for (const p of ref.current.querySelectorAll('path, polyline, line, circle')) {
      const len = typeof p.getTotalLength === 'function' ? p.getTotalLength() : 0
      if (!len) continue
      if (reduced) { p.style.strokeDasharray = ''; p.style.strokeDashoffset = ''; continue }
      p.style.strokeDasharray = String(len)
      p.style.strokeDashoffset = String(len)
      p.style.animation = `draw ${duration}ms cubic-bezier(0.22,1,0.36,1) ${delay}ms forwards`
    }
  })
  return <g ref={ref}>{children}</g>
}

// <Spark> — a subtle burst of sparks. Used on an achievement unlock. Not confetti: no library, no
// canvas, no cartoon. 14 clay-coloured shards on a CSS transform, gone in 900ms.
export function Spark({ n = 14 }) {
  const reduced = useReducedMotion()
  if (reduced) return null
  return (
    <span className="spark-burst" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => {
        const a = (i / n) * 2 * Math.PI + (i % 3)
        const d = 26 + (i % 4) * 9
        return <i key={i} style={{ '--dx': `${Math.cos(a) * d}px`, '--dy': `${Math.sin(a) * d}px`, '--sd': `${i * 18}ms` }} />
      })}
    </span>
  )
}

// <Shimmer> — the loading skeleton for a game block, matching src/Skeleton.jsx's look.
export const Shimmer = ({ w = '100%', h = 14, r = 8, style }) => <span className="skel" style={{ display: 'block', width: w, height: h, borderRadius: r, ...style }} />
