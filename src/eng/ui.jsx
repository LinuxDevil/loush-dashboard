import React, { useEffect, useMemo, useState } from 'react'
import { CountUp, Stagger } from '../ui/anim.jsx'

// Design tokens + primitives lifted out of EngDashboard.jsx unchanged, so every src/eng/ panel is
// pixel-identical to the shell that hosts it. Nothing here is new styling — it is the existing system.
export const HEAD = "var(--head)"
export const BODY = "var(--body)"
export const MONO = "var(--mono)"
export const BB = 'var(--blue)', GREEN = 'var(--green)', GOLD = 'var(--amber)', RED = 'var(--red)', PURPLE = 'var(--violet)', PINK = 'var(--pink)', STEEL = 'var(--text-secondary)'
export const DIM = 'var(--text-tertiary)', TXT = 'var(--text-secondary)', HI = 'var(--text-primary)'
export const PANEL = { background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 8 }
export const AVATARS = [BB, PURPLE, GREEN, GOLD, PINK, STEEL]
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export const fx = (n, d = 1) => (n == null || Number.isNaN(n) ? '—' : Number(n).toFixed(d))
export const lc = s => (s || '').toLowerCase()
export const fdate = s => (s ? new Date(s).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '—')
export const fdt = s => (s ? new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—')
export const initials = n => (n || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
export const first = n => (n ? String(n).split(' ')[0] : '—')
export const colorFor = name => ({ 'in progress': BB, 'in code review': PURPLE, 'design qa': PINK, 'ready for qa': GOLD, 'in qa (dev)': GREEN, 'in qa': GREEN, 'qa blocked': RED, 'ready for release': STEEL, live: GREEN }[lc(name)] || 'var(--text-secondary)')

export const sel = { padding: '6px 11px', borderRadius: 8, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', font: `500 12px ${BODY}`, outline: 'none', cursor: 'pointer' }
export const miniBtn = { padding: '4px 10px', borderRadius: 7, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', cursor: 'pointer', font: `500 11px ${BODY}`, whiteSpace: 'nowrap' }
export const primaryBtn = { ...miniBtn, border: 'none', background: 'linear-gradient(135deg,var(--accent-light),var(--accent-dark))', color: 'var(--bg-surface-active)', fontWeight: 600 }
export const inp = { width: '100%', padding: '9px 11px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-base)', color: 'var(--text-primary)', font: `400 13px ${BODY}`, outline: 'none', boxSizing: 'border-box' }

export const Card = ({ children, style }) => <div style={{ ...PANEL, padding: '16px 18px', ...style }}>{children}</div>
export const CardHead = ({ title, meta, right }) => <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
  <div style={{ font: `600 14px ${HEAD}`, color: HI }}>{title}</div>
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ font: `400 11px ${MONO}`, color: DIM }}>{meta}</span>{right}</div>
</div>
export const H1 = ({ kicker, title, right }) => <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
  <div><div style={{ font: `600 11px ${MONO}`, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>{kicker}</div>
    <h1 style={{ margin: '4px 0 0', font: `700 18px ${HEAD}`, letterSpacing: '-0.01em', color: 'var(--text-primary)' }}>{title}</h1></div>
  {right}</div>
export const Empty = ({ text }) => <div style={{ padding: 18, textAlign: 'center', font: `400 12px ${BODY}`, color: DIM }}>{text}</div>
export const ProjTag = ({ k }) => (k ? <span style={{ font: `600 8px ${MONO}`, letterSpacing: '0.04em', padding: '1px 5px', borderRadius: 4, background: 'var(--blue-bg)', color: 'var(--text-secondary)' }}>{k}</span> : null)
export const Legend = ({ c, label, v }) => <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
  <span style={{ width: 9, height: 9, borderRadius: 3, background: c, flexShrink: 0 }} />
  <span style={{ font: `400 12px ${BODY}`, color: 'var(--text-secondary)' }}>{label}{v != null && <b style={{ color: HI, fontWeight: 600 }}> {v}</b>}</span></div>
export const Spinner = ({ size = 14 }) => <span style={{ display: 'inline-block', width: size, height: size, border: '2px solid var(--border-default)', borderTopColor: BB, borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />

// AnimatedValue — the ONE null-vs-zero guard for every stat in the dashboard. It takes the ALREADY
// FORMATTED string a tile would have rendered ("3.2d", "85%", "1,204", "—", "FLAG", "green") and only
// counts up the leading number, preserving prefix + suffix. Anything with NO number in it — the em-dash
// null, "FLAG", "ok", "RED" — is returned verbatim and NEVER animated. This is deliberate: because the
// suppressed / never-started / no-data states are all rendered as '—' upstream, routing them all through
// here means a null can never count up to 0 anywhere a KPI is shown (§ hard constraint).
const NUM_RE = /^([^\d-]*)(-?[\d,]+(?:\.\d+)?)(.*)$/
export function AnimatedValue({ value, duration }) {
  if (value == null) return '—'
  const s = String(value)
  const m = s.match(NUM_RE)
  if (!m) return s // '—', 'FLAG', 'ok', 'RED', 'green' — no digits, render as-is, no count
  const [, prefix, numStr, suffix] = m
  const decimals = numStr.includes('.') ? numStr.split('.')[1].length : 0
  const grouped = numStr.includes(',')
  const target = parseFloat(numStr.replace(/,/g, ''))
  if (Number.isNaN(target)) return s
  return <CountUp value={target} duration={duration} prefix={prefix} suffix={suffix} decimals={decimals}
    format={grouped ? n => n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : undefined} />
}

// KPI tile with percentiles instead of a mean. n is always shown; n<5 goes grey (§2 hard rule).
export function Kpi({ label, value, color = HI, sub, n, thin, delta, onCopy }) {
  const c = thin ? 'var(--text-secondary)' : color
  return <div title={thin ? `n=${n} — below the n≥5 floor, treat as anecdote` : undefined}
    style={{ background: 'linear-gradient(150deg,var(--bg-surface),var(--bg-base))', border: '1px solid var(--border-default)', borderRadius: 6, padding: '13px 14px', display: 'flex', flexDirection: 'column', gap: 5, position: 'relative' }}>
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, font: `600 10px ${MONO}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
      {label}{n != null && <span style={{ color: thin ? GOLD : 'var(--text-tertiary)', letterSpacing: 0 }}>n={n}</span>}
      {onCopy && <button onClick={onCopy} title="copy the underlying array as JSON" style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: 'var(--text-tertiary)', cursor: 'pointer', font: `600 10px ${MONO}`, padding: 0 }}>{'{ }'}</button>}
    </span>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
      <span style={{ font: `700 18px ${HEAD}`, color: c, letterSpacing: '-0.01em' }}><AnimatedValue value={value} /></span>
      {delta && <span style={{ font: `600 11px ${MONO}`, color: delta.good ? GREEN : RED }}>{delta.txt}</span>}
    </div>
    <span style={{ font: `400 10px ${BODY}`, color: DIM }}>{sub}</span>
  </div>
}
export const MiniStat = ({ label, v, c = HI, sub }) => <div style={{ flex: 1, minWidth: 0, padding: '8px 10px', borderRadius: 6, background: 'var(--bg-base)', border: '1px solid var(--border-default)' }}>
  <div style={{ font: `700 16px ${HEAD}`, color: c }}>{v}</div>
  <div style={{ font: `400 9px ${MONO}`, color: DIM, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
  {sub && <div style={{ font: `400 8px ${MONO}`, color: 'var(--text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}</div>

// ---------- deep links ----------
const linkStyle = c => ({ color: c, textDecoration: 'none', borderBottom: `1px dotted ${c}66`, cursor: 'pointer' })
export function TicketLink({ i, color = BB, children, style }) {
  // No hardcoded fallback host. This used to default to one specific company's Atlassian site, so a
  // ticket that arrived without a host silently linked every user to a JIRA they cannot open.
  // Render plain text instead of a link we know is wrong — same rule as PRLink below.
  const url = i.url || (i.host ? `https://${i.host}/browse/${i.key}` : null)
  if (!url) return <span style={style} title="no JIRA host configured for this project — see projects.json">{children || i.key}</span>
  return <a href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ ...linkStyle(color), ...style }}>{children || i.key}</a>
}
export function PRLink({ pr, color = PURPLE, children, style }) {
  const url = pr.url || (pr.repo ? `https://github.com/${pr.repo}/pull/${pr.num}` : '#')
  return <a href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ ...linkStyle(color), ...style }}>{children || `PR #${pr.num}`}</a>
}
export function PrBadge({ state }) {
  const c = state === 'Merged' || state === 'Approved' ? GREEN : state === 'Closed' ? RED : GOLD
  const bg = state === 'Merged' || state === 'Approved' ? 'var(--green-bg)' : state === 'Closed' ? 'var(--red-bg)' : 'var(--amber-bg)'
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, font: `600 10px ${MONO}`, padding: '2px 8px', borderRadius: 5, background: bg, color: c }}>{state}</span>
}
// §11 — a red PR must be visibly red, on every PR row in the app
export function Checks({ state }) {
  if (!state) return <span style={{ font: `500 11px ${MONO}`, color: 'var(--bg-surface-active)' }}>—</span>
  const m = { SUCCESS: ['✓', GREEN], FAILURE: ['✕', RED], ERROR: ['✕', RED], PENDING: ['◔', GOLD], EXPECTED: ['◔', GOLD] }[state] || ['?', DIM]
  return <span title={`checks: ${state}`} style={{ font: `700 11px ${MONO}`, color: m[1] }}>{m[0]}</span>
}

// ---------- clipboard: every "nudge" in this app copies a line for a human to send. No auto-ping, ever. ----------
export function useCopy() {
  const [copied, setCopied] = useState(null)
  const copy = (text, id = 'x') => {
    const done = () => { setCopied(id); setTimeout(() => setCopied(c => (c === id ? null : c)), 1400) }
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, done)
    else { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy') } catch {} t.remove(); done() }
  }
  return [copy, copied]
}
export const CopyBtn = ({ text, label = 'Copy', copy, copied, id, style }) => <button onClick={e => { e.stopPropagation(); copy(typeof text === 'function' ? text() : text, id) }} style={{ ...miniBtn, ...style }}>{copied === id ? '✓ copied' : label}</button>

// ---------- pagination ----------
export const pagerBtn = dis => ({ width: 26, height: 24, borderRadius: 7, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: dis ? 'var(--bg-surface-active)' : 'var(--text-primary)', cursor: dis ? 'default' : 'pointer', font: `600 13px ${BODY}` })
export function Pager({ page, pages, setPage }) {
  if (pages <= 1) return null
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '10px 18px' }}>
    <span style={{ font: `400 11px ${MONO}`, color: DIM }}>page {page + 1} / {pages}</span>
    <button disabled={page === 0} onClick={() => setPage(page - 1)} style={pagerBtn(page === 0)}>‹</button>
    <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)} style={pagerBtn(page >= pages - 1)}>›</button>
  </div>
}
export function usePaged(list, size) {
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(list.length / size))
  useEffect(() => { if (page > pages - 1) setPage(0) }, [list.length, pages, page])
  const p = Math.min(page, pages - 1)
  return { slice: list.slice(p * size, p * size + size), page: p, pages, setPage }
}

// ---------- filterable + sortable table (unchanged behaviour; + a "{ }" raw-data escape hatch, §13) ----------
export function DataTable({ title, meta, right, columns, rows, getKey, initialSort, pageSize = 10, onRowClick, activeKey, minWidth = 560, filterPlaceholder = 'filter…', raw }) {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState(initialSort || null)
  const [page, setPage] = useState(0)
  const [copy, copied] = useCopy()
  const cols = columns.map(c => c.width || '1fr').join(' ')
  const filtered = useMemo(() => {
    let r = rows
    const s = q.trim().toLowerCase()
    if (s) r = r.filter(row => columns.some(c => { const v = c.filter ? c.filter(row) : c.sort ? c.sort(row) : ''; return String(v ?? '').toLowerCase().includes(s) }))
    if (sort) { const c = columns.find(x => x.key === sort.key); if (c?.sort) r = [...r].sort((a, b) => { let av = c.sort(a), bv = c.sort(b); av = av == null ? '' : av; bv = bv == null ? '' : bv; return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir }) }
    return r
  }, [rows, q, sort, columns])
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  useEffect(() => { if (page > pages - 1) setPage(0) }, [filtered.length, pages, page])
  const p = Math.min(page, pages - 1)
  const slice = filtered.slice(p * pageSize, p * pageSize + pageSize)
  const toggle = c => c.sort && setSort(s => (s?.key === c.key ? { key: c.key, dir: -s.dir } : { key: c.key, dir: 1 }))
  return <div style={{ ...PANEL, overflow: 'hidden' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '13px 16px 11px', flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
        {title && <div style={{ font: `600 14px ${HEAD}`, color: HI }}>{title}</div>}
        <div style={{ font: `400 11px ${MONO}`, color: DIM }}>{filtered.length}{filtered.length !== rows.length ? `/${rows.length}` : ''}{meta ? ' · ' + meta : ''}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {right}
        {raw !== false && <CopyBtn copy={copy} copied={copied} id="raw" label="{ }" style={{ padding: '5px 8px', font: `600 11px ${MONO}` }} text={() => JSON.stringify(raw || filtered, null, 2)} />}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={filterPlaceholder} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border-default)', background: 'var(--bg-base)', color: 'var(--text-primary)', font: `400 12px ${BODY}`, outline: 'none', width: 148 }} />
      </div>
    </div>
    <div style={{ overflowX: 'auto' }}><div style={{ minWidth }}>
      <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, padding: '0 16px 9px', borderBottom: '1px solid var(--border-default)' }}>
        {columns.map(c => <span key={c.key} onClick={() => toggle(c)} style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: c.align ? 'flex-end' : 'flex-start', font: `600 9px ${MONO}`, letterSpacing: '0.05em', textTransform: 'uppercase', color: sort?.key === c.key ? 'var(--text-primary)' : DIM, cursor: c.sort ? 'pointer' : 'default', userSelect: 'none' }}>
          {c.label}{c.sort && <span style={{ fontSize: 8, opacity: sort?.key === c.key ? 1 : 0.35 }}>{sort?.key === c.key ? (sort.dir > 0 ? '▲' : '▼') : '↕'}</span>}</span>)}
      </div>
      {slice.length === 0 && <Empty text="Nothing matches." />}
      <Stagger key={`${p}-${sort?.key}-${sort?.dir}`} step={22} max={260}>
        {slice.map(row => <div key={getKey(row)} className={onRowClick ? 'lift' : undefined} onClick={onRowClick ? () => onRowClick(row) : undefined} style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, padding: '12px 16px', alignItems: 'center', cursor: onRowClick ? 'pointer' : 'default', background: activeKey != null && getKey(row) === activeKey ? 'var(--bg-surface-active)' : 'transparent', borderBottom: '1px solid var(--border-subtle)' }}>
          {columns.map(c => <span key={c.key} style={{ textAlign: c.align ? 'right' : 'left', minWidth: 0 }}>{c.render(row)}</span>)}
        </div>)}
      </Stagger>
    </div></div>
    {pages > 1 && <Pager page={p} pages={pages} setPage={setPage} />}
  </div>
}
