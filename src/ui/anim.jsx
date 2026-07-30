import React, { useEffect, useRef, useState } from 'react'


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

const easeOut = t => 1 - Math.pow(1 - t, 3)
export function CountUp({ value = 0, duration = 700, decimals = 0, prefix = '', suffix = '', format, className, style }) {
  const reduced = useReducedMotion()
  const [n, setN] = useState(0)
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

export function Stagger({ children, step = 40, max = 400, className = '', tag: Tag = 'div', ...rest }) {
  return (
    <Tag className={className} {...rest}>
      {React.Children.map(children, (c, i) =>
        React.isValidElement(c) ? React.cloneElement(c, { style: { ...(c.props.style || {}), '--enter-delay': `${Math.min(i * step, max)}ms` }, className: `${c.props.className || ''} enter`.trim() }) : c)}
    </Tag>
  )
}

export function Draw({ children, duration = 600, delay = 0 }) {
  const ref = useRef(null)
  const reduced = useReducedMotion()
  useEffect(() => {
    if (!ref.current) return
    for (const p of ref.current.querySelectorAll('path, polyline, line, circle')) {
      let len = 0
      try { if (typeof p.getTotalLength === 'function') len = p.getTotalLength() } catch { continue }
      if (!len) continue
      if (reduced) { p.style.strokeDasharray = ''; p.style.strokeDashoffset = ''; continue }
      p.style.strokeDasharray = String(len)
      p.style.strokeDashoffset = String(len)
      p.style.animation = `draw ${duration}ms cubic-bezier(0.22,1,0.36,1) ${delay}ms forwards`
    }
  })
  return <g ref={ref}>{children}</g>
}

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

export const Shimmer = ({ w = '100%', h = 14, r = 8, style }) => <span className="skel" style={{ display: 'block', width: w, height: h, borderRadius: r, ...style }} />
