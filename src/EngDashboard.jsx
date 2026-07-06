import React, { useEffect, useMemo, useState } from 'react'

// Engineering Metrics — self-contained shell. Multi-project (project dropdown + "All projects"),
// dev-team-only members (dropdown), sprint task board, paginated tables, and a per-ticket hover
// recommendation ("move to next step by DATE to keep a good score"). All rollups come from the
// server; this file filters (project/month/member/quarter/page) and draws.
const HEAD = "'Space Grotesk', sans-serif"
const BODY = "'IBM Plex Sans', sans-serif"
const MONO = "'IBM Plex Mono', monospace"
const BB = '#8ec8ff', GREEN = '#5fd39a', GOLD = '#f5c451', RED = '#f2777a', PURPLE = '#a894f0'
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const PANEL = { background: 'linear-gradient(160deg,rgba(19,27,38,0.92),rgba(11,16,23,0.72))', border: '1px solid rgba(142,200,255,0.09)', borderRadius: 14 }
const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
const fx = (n, d = 1) => Number(n || 0).toFixed(d)
const lc = s => (s || '').toLowerCase()
const fdate = s => s ? new Date(s).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '—'
const accColor = a => (a >= 85 ? GREEN : a >= 75 ? GOLD : RED)
const initials = n => (n || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
const AVATARS = [BB, PURPLE, GREEN, GOLD, '#f2a2c4', '#7c9bd6']
const BOARD_ORDER = ['PM Backlog', 'In Progress', 'In Code Review', 'Ready for QA', 'Design QA', 'In QA (Dev)', 'In QA', 'Ready for Release', 'Reopen', 'Re Open', 'Reopened', 'Live', 'QA Blocked', 'Closed', 'To Do', 'Backlog']

function smoothPath(pts) {
  if (!pts.length) return ''
  let d = `M ${pts[0][0]} ${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2
    d += ` C ${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)}, ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)}, ${p2[0]} ${p2[1]}`
  }
  return d
}

// ---------- pagination ----------
function usePaged(list, size) {
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(list.length / size))
  useEffect(() => { if (page > pages - 1) setPage(0) }, [list.length, pages, page])
  const p = Math.min(page, pages - 1)
  return { slice: list.slice(p * size, p * size + size), page: p, pages, setPage }
}
const pagerBtn = dis => ({ width: 26, height: 24, borderRadius: 7, border: '1px solid rgba(142,200,255,0.16)', background: 'rgba(18,27,39,0.9)', color: dis ? '#3d4757' : '#cfe0f2', cursor: dis ? 'default' : 'pointer', font: `600 13px ${BODY}` })
function Pager({ page, pages, setPage }) {
  if (pages <= 1) return null
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '10px 18px' }}>
    <span style={{ font: `400 10.5px ${MONO}`, color: '#647285' }}>page {page + 1} / {pages}</span>
    <button disabled={page === 0} onClick={() => setPage(page - 1)} style={pagerBtn(page === 0)}>‹</button>
    <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)} style={pagerBtn(page >= pages - 1)}>›</button>
  </div>
}

// a ticket belongs to the configured team if a rostered dev worked it or it's assigned to any team role now
const onTeam = i => !!(i.assigneeTeam || i.devAssignee)

// ---------- reusable filterable + sortable table ----------
// columns: [{ key, label, width, align(0|1), render(row), sort(row)?, filter(row)? }]
function DataTable({ title, meta, right, columns, rows, getKey, initialSort, pageSize = 10, onRowClick, activeKey, minWidth = 560, filterPlaceholder = 'filter…' }) {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState(initialSort || null) // {key, dir:1|-1}
  const [page, setPage] = useState(0)
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
        {title && <div style={{ font: `600 14px ${HEAD}`, color: '#eaf1f9' }}>{title}</div>}
        <div style={{ font: `400 10.5px ${MONO}`, color: '#647285' }}>{filtered.length}{filtered.length !== rows.length ? `/${rows.length}` : ''}{meta ? ' · ' + meta : ''}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {right}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={filterPlaceholder} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(142,200,255,0.16)', background: 'rgba(10,15,22,0.7)', color: '#e7eef6', font: `400 12px ${BODY}`, outline: 'none', width: 148 }} />
      </div>
    </div>
    <div style={{ overflowX: 'auto' }}><div style={{ minWidth }}>
      <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, padding: '0 16px 9px', borderBottom: '1px solid rgba(142,200,255,0.07)' }}>
        {columns.map((c, i) => <span key={c.key} onClick={() => toggle(c)} style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: c.align ? 'flex-end' : 'flex-start', font: `600 9px ${MONO}`, letterSpacing: '0.05em', textTransform: 'uppercase', color: sort?.key === c.key ? '#a9c7ea' : '#647285', cursor: c.sort ? 'pointer' : 'default', userSelect: 'none' }}>
          {c.label}{c.sort && <span style={{ fontSize: 8, opacity: sort?.key === c.key ? 1 : 0.35 }}>{sort?.key === c.key ? (sort.dir > 0 ? '▲' : '▼') : '↕'}</span>}</span>)}
      </div>
      {slice.length === 0 && <Empty text="Nothing matches." />}
      {slice.map(row => <div key={getKey(row)} onClick={onRowClick ? () => onRowClick(row) : undefined} style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, padding: '12px 16px', alignItems: 'center', cursor: onRowClick ? 'pointer' : 'default', background: activeKey != null && getKey(row) === activeKey ? 'rgba(142,200,255,0.08)' : 'transparent', borderBottom: '1px solid rgba(142,200,255,0.045)' }}>
        {columns.map((c, i) => <span key={c.key} style={{ textAlign: c.align ? 'right' : 'left', minWidth: 0 }}>{c.render(row)}</span>)}
      </div>)}
    </div></div>
    {pages > 1 && <Pager page={p} pages={pages} setPage={setPage} />}
  </div>
}

// ---------- JIRA / GitHub deep links (new tab) ----------
const jiraUrl = i => `https://${i.host || 'data4altayyargroup.atlassian.net'}/browse/${i.key}`
const linkStyle = c => ({ color: c, textDecoration: 'none', borderBottom: `1px dotted ${c}66`, cursor: 'pointer' })
function TicketLink({ i, color = BB, children, style }) {
  return <a href={jiraUrl(i)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ ...linkStyle(color), ...style }}>{children || i.key}</a>
}
function PRLink({ pr, color = PURPLE, children, style }) {
  const url = pr.repo ? `https://github.com/${pr.repo}/pull/${pr.num}` : '#'
  return <a href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ ...linkStyle(color), ...style }}>{children || `PR #${pr.num}`}</a>
}

// ---------- story points ↔ estimate (client mirror of the org table) ----------
const SP_DAYS = [[1, 0.4], [2, 0.8], [3, 1.5], [5, 3], [8, 6], [13, 10], [21, 22]]
const estDaysOf = p => (SP_DAYS.find(x => x[0] === p) || [0, 0])[1]
const accOf = (est, actual) => (!(est > 0) || !(actual > 0)) ? null : (actual <= est ? (actual / est) * 50 + 50 : (est / actual) * 100)
function bestSP(actual) { if (!(actual > 0)) return null; let sp = SP_DAYS[0][0], acc = -1; for (const [p, d] of SP_DAYS) { const a = accOf(d, actual); if (a > acc) { acc = a; sp = p } } return { sp, acc } }

// ---------- per-ticket hover: days-in-column · SP-for-90% · when to move ----------
// Uses fixed positioning (measured on hover) so the tooltip escapes table/board overflow clipping
// and sits above everything at the top z-index.
function IssueTip({ i, children }) {
  const [pos, setPos] = useState(null)
  const enter = e => { const r = e.currentTarget.getBoundingClientRect(); setPos({ left: r.left, top: r.top, bottom: r.bottom }) }
  const leave = () => setPos(null)
  const rec = i.rec
  const actual = i.dev || i.delivery
  const b = bestSP(actual)
  const curAcc = accOf(estDaysOf(i.pts), actual)
  const c = rec?.atRisk ? RED : rec && rec.remaining < 0.5 ? GOLD : GREEN
  const when = rec ? new Date(rec.moveBy).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
  const below = pos && pos.top < 190 // flip below the trigger when near the top of the viewport
  const box = pos ? { position: 'fixed', left: Math.min(pos.left, (typeof window !== 'undefined' ? window.innerWidth : 1400) - 274), [below ? 'top' : 'bottom']: below ? pos.bottom + 8 : `calc(100vh - ${pos.top - 8}px)`, zIndex: 2147483647, width: 258, padding: '10px 12px', borderRadius: 9, background: 'rgba(20,28,40,0.99)', border: `1px solid ${(rec ? c : '#8ec8ff')}66`, boxShadow: '0 12px 30px -8px rgba(0,0,0,0.7)', pointerEvents: 'none' } : null
  return <span onMouseEnter={enter} onMouseLeave={leave} style={{ position: 'relative', cursor: 'help' }}>
    {children}
    {pos && <span style={box}>
      <div style={{ font: `600 9.5px ${MONO}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#8ea1b8', marginBottom: 6 }}>{i.key} · in {i.status}</div>
      <TipRow label="In this column" value={`${fx(i.inCurrent)}d`} />
      {b && <TipRow label={curAcc >= 90 ? 'Estimate' : 'For ≥90% est'} value={curAcc >= 90 ? `on target · ${i.pts}pt` : `set to ${b.sp}pt (${Math.round(b.acc)}%)`} c={curAcc >= 90 ? GREEN : GOLD} />}
      {rec ? <TipRow label="Move next" value={rec.atRisk ? `→ ${rec.next} · overdue` : `→ ${rec.next} by ${when}`} c={c} /> : <TipRow label="Status" value="done — no action" />}
      {rec && <div style={{ font: `400 9.5px ${MONO}`, color: '#647285', marginTop: 5 }}>{rec.atRisk ? `${fx(Math.abs(rec.remaining))}d over budget` : `${fx(rec.remaining)}d of ${fx(rec.budget)}d budget left`}</div>}
    </span>}
  </span>
}
const TipRow = ({ label, value, c = '#dbe4ef' }) => <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '2px 0' }}>
  <span style={{ font: `400 11px ${BODY}`, color: '#8b98a9' }}>{label}</span>
  <span style={{ font: `600 11px ${MONO}`, color: c, textAlign: 'right' }}>{value}</span></div>

export default function EngDashboard({ onExit }) {
  const [projects, setProjects] = useState([])
  const [project, setProject] = useState(null)   // selected project key, or 'all'
  const [snap, setSnap] = useState(null)
  const [err, setErr] = useState(null)
  const [route, setRoute] = useState('overview')
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth())
  const [year, setYear] = useState(now.getFullYear())
  const [member, setMember] = useState(null)
  const [deepNum, setDeepNum] = useState(null)
  const [quarter, setQuarter] = useState('Q3')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState(false) // brief loader on client-side query changes
  const [config, setConfig] = useState(null) // null | { mode:'new' } | { mode:'edit', key }

  const load = (refresh, proj) => {
    const key = proj !== undefined ? proj : project
    setBusy(true)
    const qs = key ? `?project=${key}` : ''
    fetch(refresh ? `/api/eng/refresh${qs}` : `/api/eng/snapshot${qs}`, refresh ? { method: 'POST' } : undefined)
      .then(r => r.json()).then(d => {
        setSnap(d)
        if (d.projects) setProjects(d.projects)
        if (!key && d.team?.key) setProject(d.team.key)
        setErr(d.available ? null : (d.reason || d.error || 'unavailable'))
      })
      .catch(e => setErr(String(e))).finally(() => setBusy(false))
  }
  useEffect(() => { load(false) }, [])
  useEffect(() => { if (snap?.members?.length && !member) setMember(snap.members[0].id) }, [snap])
  // show a brief loader whenever the query changes (project/month/year/member/route/quarter)
  useEffect(() => { setPending(true); const t = setTimeout(() => setPending(false), 300); return () => clearTimeout(t) }, [project, month, year, member, route, quarter])

  const selectProject = key => { setProject(key); setMember(null); load(false, key) } // keep last data during reload — no header/body flash
  const onSaved = list => { setProjects(list); setConfig(null) }

  const S = snap
  const shell = (children) => (
    <div style={{ minHeight: '100vh', color: '#e7eef6', fontFamily: BODY, background: 'radial-gradient(950px 440px at 18% -10%,rgba(142,200,255,0.13),transparent 60%),radial-gradient(760px 400px at 104% -4%,rgba(91,159,230,0.08),transparent 55%),#080b11' }}>
      <TopBar team={S?.team} projects={projects} project={project} onProject={selectProject} onAdd={() => setConfig({ mode: 'new' })} onEdit={() => project && project !== 'all' && setConfig({ mode: 'edit', key: project })}
        route={route} setRoute={setRoute} month={month} setMonth={setMonth} year={year} setYear={setYear} onExit={onExit} onRefresh={() => load(true)} busy={busy} />
      <div style={{ position: 'relative', maxWidth: 1320, margin: '0 auto', padding: '20px 22px 64px' }}>
        {children}
        {(busy || pending) && <LoadingOverlay />}
      </div>
      {config && <ProjectConfig mode={config.mode} project={config.mode === 'edit' ? projects.find(p => p.key === config.key) : null} onClose={() => setConfig(null)} onSaved={onSaved} onSelect={selectProject} />}
      <style>{`@keyframes pulse{0%,100%{opacity:.35}50%{opacity:.6}} @keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  if (!S) return shell(<Loading />)
  if (!S.available) return shell(<NotWired reason={err} team={S.team} onSaved={() => load(false)} onAddProject={() => setConfig({ mode: 'new' })} />)

  const issues = S.issues || [], prs = S.prs || [], members = S.members || []
  const inPeriod = i => i.month === month && i.year === year
  const shipped = issues.filter(i => i.live && inPeriod(i) && onTeam(i)) // configured team only
  const active = issues.filter(i => i.active && onTeam(i))
  const prByNum = Object.fromEntries(prs.map(p => [p.num, p]))
  const prsFor = i => (i.prNums || []).map(n => prByNum[n]).filter(Boolean)

  return shell(
    route === 'overview' ? <Overview {...{ S, issues, shipped, active, members, prsFor, month, year }} />
    : route === 'members' ? <Members {...{ S, issues, prs, members, member, setMember, prsFor }} />
    : route === 'board' ? <Board {...{ issues, members }} />
    : route === 'workload' ? <Workload {...{ issues, members, reload: () => load(false) }} />
    : route === 'review' ? <Review {...{ prs, deepNum, setDeepNum }} />
    : <Okrs {...{ S, issues, shipped, prs, quarter, setQuarter }} />
  )
}

// ---------------- chrome ----------------
function TopBar({ team, projects, project, onProject, onAdd, onEdit, route, setRoute, month, setMonth, year, setYear, onExit, onRefresh, busy }) {
  const nav = [['overview', 'Overview', '▦'], ['members', 'Members', '◍'], ['board', 'Board', '▤'], ['workload', 'Workload', '⚖'], ['review', 'Review', '⟨⟩'], ['okrs', 'OKRs', '◎']]
  const years = [year, 2026, 2025].filter((v, i, a) => a.indexOf(v) === i)
  const repoShort = r => (r || '').split('/')[1] || r
  const activeName = project === 'all' ? 'All projects' : (projects.find(p => p.key === project)?.name || team?.name || '')
  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 20, background: 'linear-gradient(180deg,rgba(17,26,38,0.96),rgba(10,15,22,0.9))', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(142,200,255,0.1)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '11px 22px', maxWidth: 1320, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: 'linear-gradient(135deg,#a7d5ff,#5b9fe6)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 18px -3px rgba(142,200,255,0.75)' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M4 20V11M10 20V4M16 20v-6M22 20V8" stroke="#0a1420" strokeWidth="2.6" strokeLinecap="round" /></svg>
          </div>
          <div>
            <div style={{ font: `700 15px ${HEAD}`, letterSpacing: '-0.01em', color: '#eef4fb', lineHeight: 1 }}>Engineering Metrics</div>
            <div style={{ font: `500 9.5px ${MONO}`, letterSpacing: '0.08em', color: '#6f8199', marginTop: 3, textTransform: 'uppercase', height: 11 }}>{activeName}</div>
          </div>
        </div>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 3, flex: 1 }}>
          {nav.map(([id, label, icon]) => {
            const a = route === id
            return <button key={id} onClick={() => setRoute(id)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 12px', border: 'none', borderRadius: 9, cursor: 'pointer', font: `500 13px ${BODY}`, background: a ? 'rgba(142,200,255,0.14)' : 'transparent', color: a ? '#dbeafc' : '#93a2b4' }}>
              <span style={{ fontSize: 12, opacity: 0.9 }}>{icon}</span>{label}</button>
          })}
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {/* project selector — replaces the old back-to-Claude pill */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 2px 2px 4px', borderRadius: 9, background: 'rgba(142,200,255,0.07)', border: '1px solid rgba(142,200,255,0.16)' }}>
            <span style={{ font: `500 9px ${MONO}`, letterSpacing: '0.06em', color: '#6f8199', textTransform: 'uppercase', paddingLeft: 4 }}>project</span>
            <select value={project || ''} onChange={e => onProject(e.target.value)} style={{ ...sel, border: 'none', background: 'transparent', paddingRight: 6 }}>
              <option value="all">All projects</option>
              {projects.map(p => <option key={p.key} value={p.key}>{p.jiraProjectKey} ↔ {repoShort(p.githubRepo)}</option>)}
            </select>
            {project && project !== 'all' && <button onClick={onEdit} title="Configure this project (team, repo, board)" style={{ width: 24, height: 24, borderRadius: 7, border: '1px solid rgba(142,200,255,0.2)', background: 'rgba(18,27,39,0.9)', color: '#cfe0f2', cursor: 'pointer', fontSize: 12, padding: 0 }}>⚙</button>}
            <button onClick={onAdd} title="Add a project (repo + JIRA board)" style={{ width: 24, height: 24, borderRadius: 7, border: '1px solid rgba(142,200,255,0.2)', background: 'rgba(18,27,39,0.9)', color: '#cfe0f2', cursor: 'pointer', font: `600 14px ${BODY}`, padding: 0 }}>+</button>
          </div>
          <button onClick={onRefresh} title="recompute from JIRA + GitHub" style={{ cursor: 'pointer', width: 32, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#cfe0f2', borderRadius: 8, border: '1px solid rgba(142,200,255,0.16)', background: 'rgba(18,27,39,0.9)' }}>
            <span style={{ display: 'inline-block', fontSize: 14, lineHeight: 1, animation: busy ? 'spin 0.8s linear infinite' : 'none' }}>↻</span></button>
          <select value={month} onChange={e => setMonth(+e.target.value)} style={sel}>{MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}</select>
          <select value={year} onChange={e => setYear(+e.target.value)} style={sel}>{years.map(y => <option key={y} value={y}>{y}</option>)}</select>
          <span style={{ width: 1, height: 22, background: 'rgba(142,200,255,0.12)', margin: '0 2px' }} />
          <button onClick={onExit} title="back to Claude Code dashboard" style={{ cursor: 'pointer', font: `500 11.5px ${BODY}`, color: '#93a2b4', padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(142,200,255,0.12)', background: 'transparent' }}>← Claude</button>
        </div>
      </div>
    </div>
  )
}
const sel = { padding: '6px 11px', borderRadius: 8, border: '1px solid rgba(142,200,255,0.16)', background: 'rgba(18,27,39,0.9)', color: '#cfe0f2', font: `500 12px ${BODY}`, outline: 'none', cursor: 'pointer' }

const cfgInp = { width: '100%', padding: '9px 11px', borderRadius: 9, border: '1px solid rgba(142,200,255,0.16)', background: 'rgba(10,15,22,0.7)', color: '#e7eef6', font: `400 13px ${BODY}`, outline: 'none', boxSizing: 'border-box' }
const ROLES = ['dev', 'qa', 'product']
function ProjectConfig({ mode, project, onClose, onSaved, onSelect }) {
  const isEdit = mode === 'edit'
  const [f, setF] = useState({ name: project?.name || '', jiraProjectKey: project?.jiraProjectKey || '', githubRepo: project?.githubRepo || '', jiraHost: project?.jiraHost || '' })
  const [members, setMembers] = useState(() => {
    const out = []
    for (const [role, arr] of [['dev', project?.dev], ['qa', project?.qa], ['product', project?.product]]) for (const email of arr || []) out.push({ email, role })
    return out.length ? out : [{ email: '', role: 'dev' }]
  })
  const [err, setErr] = useState(null), [busy, setBusy] = useState(false)
  const set = k => e => setF({ ...f, [k]: e.target.value })
  const setM = (i, k, v) => setMembers(members.map((m, j) => j === i ? { ...m, [k]: v } : m))
  const submit = () => {
    setBusy(true); setErr(null)
    const url = isEdit ? `/api/eng/projects/${project.key}` : '/api/eng/projects'
    const body = { name: f.name, githubRepo: f.githubRepo, jiraHost: f.jiraHost || undefined, members: members.filter(m => m.email.trim()), ...(isEdit ? {} : { jiraProjectKey: f.jiraProjectKey }) }
    fetch(url, { method: isEdit ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'failed'); onSaved(d.projects); onSelect((isEdit ? project.jiraProjectKey : f.jiraProjectKey).toUpperCase()) })
      .catch(e => setErr(String(e.message || e))).finally(() => setBusy(false))
  }
  const field = (label, key, ph, dis) => <label style={{ display: 'block' }}>
    <div style={{ font: `600 9.5px ${MONO}`, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#7f8ea1', marginBottom: 5 }}>{label}</div>
    <input value={f[key]} onChange={set(key)} placeholder={ph} disabled={dis} style={{ ...cfgInp, opacity: dis ? 0.5 : 1 }} /></label>
  return <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(4,7,11,0.72)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
    <div onClick={e => e.stopPropagation()} style={{ ...PANEL, width: 500, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto', padding: 22 }}>
      <div style={{ font: `700 17px ${HEAD}`, color: '#f0f5fb', marginBottom: 4 }}>{isEdit ? `Configure ${project.jiraProjectKey}` : 'Add a project'}</div>
      <div style={{ font: `400 12px ${BODY}`, color: '#8b98a9', marginBottom: 16 }}>Ties a GitHub repo to a JIRA board and defines the team by role. Persisted server-side.</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {field('Name', 'name', 'e.g. Transport Web')}
          {field('JIRA project key', 'jiraProjectKey', 'e.g. TRN', isEdit)}
        </div>
        {field('GitHub repo (owner/name)', 'githubRepo', 'e.g. tajawal/ct-web-transport')}
        {field('JIRA host', 'jiraHost', 'data4altayyargroup.atlassian.net')}
      </div>
      <div style={{ font: `600 9.5px ${MONO}`, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#7f8ea1', margin: '18px 0 8px' }}>Team members & roles</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {members.map((m, i) => <div key={i} style={{ display: 'flex', gap: 7 }}>
          <input value={m.email} onChange={e => setM(i, 'email', e.target.value)} placeholder="name@almosafer.com" style={{ ...cfgInp, flex: 1 }} />
          <select value={m.role} onChange={e => setM(i, 'role', e.target.value)} style={{ ...cfgInp, width: 108, flex: 'none', cursor: 'pointer' }}>{ROLES.map(r => <option key={r} value={r}>{r}</option>)}</select>
          <button onClick={() => setMembers(members.filter((_, j) => j !== i))} style={{ width: 34, flexShrink: 0, borderRadius: 9, border: '1px solid rgba(142,200,255,0.14)', background: 'transparent', color: '#93a2b4', cursor: 'pointer' }}>✕</button>
        </div>)}
      </div>
      <button onClick={() => setMembers([...members, { email: '', role: 'dev' }])} style={{ marginTop: 8, padding: '6px 12px', borderRadius: 8, border: '1px dashed rgba(142,200,255,0.24)', background: 'transparent', color: '#93a2b4', cursor: 'pointer', font: `500 12px ${BODY}` }}>+ Add member</button>
      {err && <div style={{ marginTop: 12, font: `400 12px ${BODY}`, color: RED }}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9, marginTop: 18 }}>
        <button onClick={onClose} style={{ padding: '8px 15px', borderRadius: 9, border: '1px solid rgba(142,200,255,0.14)', background: 'transparent', color: '#93a2b4', cursor: 'pointer', font: `500 12.5px ${BODY}` }}>Cancel</button>
        <button onClick={submit} disabled={busy || (!isEdit && (!f.jiraProjectKey || !f.githubRepo))} style={{ padding: '8px 15px', borderRadius: 9, border: 'none', background: busy ? '#33506e' : 'linear-gradient(135deg,#a7d5ff,#5b9fe6)', color: '#0a1420', cursor: busy ? 'default' : 'pointer', font: `600 12.5px ${BODY}` }}>{busy ? 'Saving…' : isEdit ? 'Save changes' : 'Add project'}</button>
      </div>
    </div>
  </div>
}
function CredsForm({ onSaved }) {
  const [f, setF] = useState({ email: '', token: '' }), [err, setErr] = useState(null), [busy, setBusy] = useState(false)
  const submit = () => {
    setBusy(true); setErr(null)
    fetch('/api/eng/creds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) })
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'failed'); onSaved() })
      .catch(e => setErr(String(e.message || e))).finally(() => setBusy(false))
  }
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 4 }}>
    <input value={f.email} onChange={e => setF({ ...f, email: e.target.value })} placeholder="atlassian email" style={cfgInp} />
    <input value={f.token} onChange={e => setF({ ...f, token: e.target.value })} placeholder="API token" type="password" style={cfgInp} />
    {err && <div style={{ font: `400 12px ${BODY}`, color: RED }}>{err}</div>}
    <button onClick={submit} disabled={busy || !f.email || !f.token} style={{ alignSelf: 'flex-start', padding: '8px 16px', borderRadius: 9, border: 'none', background: busy ? '#33506e' : 'linear-gradient(135deg,#a7d5ff,#5b9fe6)', color: '#0a1420', cursor: busy ? 'default' : 'pointer', font: `600 12.5px ${BODY}` }}>{busy ? 'Saving…' : 'Save & connect'}</button>
  </div>
}

function Loading() {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    {[0, 1, 2].map(i => <div key={i} style={{ ...PANEL, height: i === 0 ? 90 : 160, animation: 'pulse 1.4s ease-in-out infinite', opacity: 0.5 }} />)}
  </div>
}
const Spinner = ({ size = 14 }) => <span style={{ display: 'inline-block', width: size, height: size, border: '2px solid rgba(142,200,255,0.25)', borderTopColor: BB, borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
function LoadingOverlay() {
  return <div style={{ position: 'absolute', inset: 0, zIndex: 40, background: 'rgba(8,11,17,0.5)', backdropFilter: 'blur(1.5px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 130 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderRadius: 10, background: 'rgba(20,28,40,0.96)', border: '1px solid rgba(142,200,255,0.16)', boxShadow: '0 10px 26px -8px rgba(0,0,0,0.6)' }}>
      <Spinner /><span style={{ font: `500 12px ${BODY}`, color: '#cfe0f2' }}>Updating…</span>
    </div>
  </div>
}
function NotWired({ reason, team, onSaved, onAddProject }) {
  return <div style={{ ...PANEL, padding: 28, maxWidth: 560, margin: '40px auto', textAlign: 'left' }}>
    <div style={{ font: `700 18px ${HEAD}`, color: '#f0f5fb', marginBottom: 8 }}>Connect JIRA to go live</div>
    <div style={{ font: `400 13px ${BODY}`, color: '#9fb0c2', lineHeight: 1.6, marginBottom: 16 }}>
      GitHub is already live via the <code style={{ color: BB }}>gh</code> CLI. Paste an Atlassian email + API token below and it's saved server-side (gitignored) — no file editing.
      {reason && reason !== 'no-jira-token' ? <div style={{ color: RED, marginTop: 6 }}>Error: {reason}</div> : null}
    </div>
    <div style={{ font: `600 9.5px ${MONO}`, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#7f8ea1', marginBottom: 8 }}>API credentials</div>
    <CredsForm onSaved={onSaved} />
    <div style={{ font: `400 11.5px ${BODY}`, color: '#647285', margin: '10px 0 18px' }}>Create a token at <span style={{ color: BB }}>id.atlassian.com/manage-profile/security/api-tokens</span>.</div>
    <div style={{ borderTop: '1px solid rgba(142,200,255,0.08)', paddingTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <div style={{ font: `400 12px ${BODY}`, color: '#8b98a9' }}>No project yet, or need a different board?</div>
      <button onClick={onAddProject} style={{ padding: '8px 14px', borderRadius: 9, border: '1px solid rgba(142,200,255,0.2)', background: 'rgba(18,27,39,0.9)', color: '#cfe0f2', cursor: 'pointer', font: `600 12px ${BODY}` }}>+ Add project</button>
    </div>
  </div>
}

// ---------------- shared bits ----------------
const Card = ({ children, style }) => <div style={{ ...PANEL, padding: '16px 18px', ...style }}>{children}</div>
const CardHead = ({ title, meta }) => <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
  <div style={{ font: `600 14px ${HEAD}`, color: '#eaf1f9' }}>{title}</div>
  <div style={{ font: `400 10.5px ${MONO}`, color: '#647285' }}>{meta}</div></div>
const H1 = ({ kicker, title, right }) => <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
  <div><div style={{ font: `600 10.5px ${MONO}`, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#6f8199' }}>{kicker}</div>
    <h1 style={{ margin: '4px 0 0', font: `700 22px ${HEAD}`, letterSpacing: '-0.01em', color: '#f0f5fb' }}>{title}</h1></div>
  {right}</div>
const ProjTag = ({ k }) => k ? <span style={{ font: `600 8px ${MONO}`, letterSpacing: '0.04em', padding: '1px 5px', borderRadius: 4, background: 'rgba(124,155,214,0.14)', color: '#9db6dc' }}>{k}</span> : null

// ---------------- OVERVIEW ----------------
function Overview({ S, issues, shipped, active, members, prsFor, month, year }) {
  const prevM = month === 0 ? 11 : month - 1, prevY = month === 0 ? year - 1 : year
  const shippedPrev = issues.filter(i => i.live && i.month === prevM && i.year === prevY)
  const kpiVal = (set, f) => avg(set.map(f))
  const delta = (cur, prev, unit = '', inv = false) => {
    if (!prev) return { txt: '', color: '#647285' }
    const d = cur - prev, good = inv ? d < 0 : d > 0
    return { txt: `${d >= 0 ? '+' : ''}${fx(d, unit === '%' ? 0 : 1)}${unit}`, color: good ? GREEN : RED }
  }
  const avgCycle = kpiVal(shipped, i => i.delivery)
  const accSet = shipped.filter(i => i.estAcc != null)
  const avgAcc = avg(accSet.map(i => i.estAcc))
  const avgQa = kpiVal(shipped, i => i.qaCycles)
  const totSP = shipped.reduce((a, i) => a + i.pts, 0)
  const staleN = issues.filter(i => i.stale).length
  const featCount = shipped.filter(i => /feature|story/i.test(i.type)).length
  const dCycle = delta(avgCycle, kpiVal(shippedPrev, i => i.delivery), 'd', true)
  const dAcc = delta(avgAcc, avg(shippedPrev.filter(i => i.estAcc != null).map(i => i.estAcc)), '%')
  const dQa = delta(avgQa, kpiVal(shippedPrev, i => i.qaCycles), '', true)
  const kpis = [
    ['Avg cycle time', shipped.length ? fx(avgCycle) + 'd' : '—', dCycle, BB, 'In Progress → Live · work-time'],
    ['Est. accuracy', accSet.length ? fx(avgAcc, 0) + '%' : '—', dAcc, GREEN, 'story-point est vs actual'],
    ['Features shipped', String(featCount), { txt: '', color: '#647285' }, '#e7eef6', 'this month'],
    ['Story points', String(totSP), { txt: '', color: '#647285' }, '#e7eef6', 'delivered'],
    ['Avg QA cycles', shipped.length ? fx(avgQa) : '—', dQa, GOLD, 're-test loops'],
    ['Stale statuses', String(staleN), { txt: '', color: '#647285' }, staleN ? RED : GREEN, 'ticket vs PR'],
  ]
  const headChips = [
    { v: String(members.length), l: 'engineers', c: BB },
    { v: String(active.length), l: 'in progress', c: PURPLE },
    { v: String(S.prs.filter(p => p.state !== 'Merged' && p.state !== 'Closed').length), l: 'open PRs', c: GOLD },
  ]

  const statusDays = {}
  let activeSum = 0, waitSum = 0
  for (const i of issues) { activeSum += i.activeDays; waitSum += i.waitDays; for (const [k, v] of Object.entries(i.daysIn || {})) statusDays[k] = (statusDays[k] || 0) + v }
  const barKeys = ['In Progress', 'In Code Review', 'Ready for QA', 'In QA (Dev)', 'QA Blocked']
  const bars = barKeys.map(k => ({ name: k, val: statusDays[k] || 0 }))
  const stMax = Math.max(1, ...bars.map(b => b.val))
  const tot = activeSum + waitSum || 1

  const trend = []
  for (let k = 5; k >= 0; k--) {
    let m = month - k, y = year; while (m < 0) { m += 12; y-- }
    const set = issues.filter(i => i.live && i.month === m && i.year === y)
    trend.push({ label: MONTHS[m].slice(0, 3), v: set.length ? avg(set.map(i => i.delivery)) : null })
  }
  const tv = trend.map(t => t.v).filter(v => v != null)
  const cmax = Math.max(1, ...tv) * 1.1, cw = 320, ch = 130, cpad = 8
  const cx = i => cpad + (i / 5) * (cw - cpad * 2)
  const cy = v => ch - cpad - ((v || 0) / cmax) * (ch - cpad * 2)
  const pts = trend.map((t, i) => [cx(i), cy(t.v ?? 0)])
  const line = smoothPath(pts)
  const cycleNow = tv.length ? fx(tv[tv.length - 1]) + 'd' : '—'
  const first = tv[0], last = tv[tv.length - 1]
  const cycleTrend = first && last ? `${last <= first ? '↓' : '↑'} ${Math.abs(Math.round((1 - last / first) * 100))}% vs ${trend[0].label}` : ''

  const activePage = usePaged(active, 18)

  return <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <H1 kicker={`${MONTHS[month]} ${year}`} title="Team Overview" right={<div style={{ display: 'flex', gap: 8 }}>
      {headChips.map((c, i) => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 12px', borderRadius: 9, background: 'rgba(19,27,38,0.7)', border: '1px solid rgba(142,200,255,0.1)' }}>
        <span style={{ font: `700 15px ${HEAD}`, color: c.c }}>{c.v}</span><span style={{ font: `400 11px ${BODY}`, color: '#7f8ea1' }}>{c.l}</span></div>)}
    </div>} />

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 10 }}>
      {kpis.map((k, i) => <div key={i} style={{ background: 'linear-gradient(150deg,rgba(19,27,38,0.85),rgba(11,16,23,0.6))', border: '1px solid rgba(142,200,255,0.1)', borderRadius: 13, padding: '13px 14px', display: 'flex', flexDirection: 'column', gap: 5 }}>
        <span style={{ font: `600 9.5px ${MONO}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#7f8ea1' }}>{k[0]}</span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}><span style={{ font: `700 22px ${HEAD}`, color: k[3], letterSpacing: '-0.01em' }}>{k[1]}</span><span style={{ font: `600 10.5px ${MONO}`, color: k[2].color }}>{k[2].txt}</span></div>
        <span style={{ font: `400 10px ${BODY}`, color: '#647285' }}>{k[4]}</span></div>)}
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 12 }}>
      <Card>
        <CardHead title="Where time goes" meta="working time · from JIRA changelog" />
        <div style={{ display: 'flex', height: 11, borderRadius: 6, overflow: 'hidden', marginBottom: 9 }}>
          <div style={{ width: `${activeSum / tot * 100}%`, background: 'linear-gradient(90deg,#5fd39a,#48c48a)' }} />
          <div style={{ width: `${waitSum / tot * 100}%`, background: 'linear-gradient(90deg,#f5c451,#eab13a)' }} />
        </div>
        <div style={{ display: 'flex', gap: 18, marginBottom: 16 }}>
          <Legend c={GREEN} label="Active effort" v={fx(activeSum) + 'd'} />
          <Legend c={GOLD} label="Waiting" v={fx(waitSum) + 'd'} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {bars.map(b => <div key={b.name} style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <span style={{ width: 118, flexShrink: 0, font: `500 11.5px ${BODY}`, color: '#b3c1d1' }}>{b.name}</span>
            <div style={{ flex: 1, height: 8, borderRadius: 5, background: 'rgba(142,200,255,0.06)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${b.val / stMax * 100}%`, borderRadius: 5, background: colorFor(b.name) }} /></div>
            <span style={{ width: 44, textAlign: 'right', font: `600 11.5px ${MONO}`, color: '#e0e8f2' }}>{fx(b.val)}d</span></div>)}
        </div>
      </Card>
      <Card style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ font: `600 14px ${HEAD}`, color: '#eaf1f9' }}>Cycle time trend</div>
          <div style={{ font: `400 10.5px ${MONO}`, color: '#647285' }}>6 mo · In Progress → Live</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginBottom: 10 }}>
          <span style={{ font: `700 30px ${HEAD}`, color: BB, letterSpacing: '-0.01em' }}>{cycleNow}</span>
          <span style={{ font: `600 12px ${MONO}`, color: GREEN }}>{cycleTrend}</span>
        </div>
        <svg viewBox="0 0 320 130" preserveAspectRatio="none" style={{ width: '100%', height: 130, flex: 1 }}>
          <defs><linearGradient id="cyc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={BB} stopOpacity="0.35" /><stop offset="1" stopColor={BB} stopOpacity="0" /></linearGradient></defs>
          <path d={`${line} L ${cx(5)} ${ch} L ${cx(0)} ${ch} Z`} fill="url(#cyc)" />
          <path d={line} fill="none" stroke={BB} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          {pts.map((p, i) => trend[i].v != null && <circle key={i} cx={p[0]} cy={p[1]} r="3" fill="#0b1017" stroke={BB} strokeWidth="2" />)}
        </svg>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>{trend.map((t, i) => <span key={i} style={{ font: `500 9.5px ${MONO}`, color: '#5c6a7d' }}>{t.label}</span>)}</div>
      </Card>
    </div>

    <div style={{ ...PANEL, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ font: `600 14px ${HEAD}`, color: '#eaf1f9' }}>Active work · in progress now</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ font: `400 10.5px ${MONO}`, color: '#647285' }}>{active.length} active · hover a card for next-step & story-point guidance</span>
          {activePage.pages > 1 && <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ font: `400 10.5px ${MONO}`, color: '#647285' }}>{activePage.page + 1}/{activePage.pages}</span>
            <button disabled={activePage.page === 0} onClick={() => activePage.setPage(activePage.page - 1)} style={pagerBtn(activePage.page === 0)}>‹</button>
            <button disabled={activePage.page >= activePage.pages - 1} onClick={() => activePage.setPage(activePage.page + 1)} style={pagerBtn(activePage.page >= activePage.pages - 1)}>›</button>
          </span>}
        </div>
      </div>
      {active.length === 0 ? <Empty text="Nothing in an active status right now." /> : <ColumnsBoard items={activePage.slice} />}
    </div>

    <DataTable title="Recently shipped" meta="team · this window" minWidth={820} pageSize={8}
      rows={shipped} getKey={r => r.key} initialSort={{ key: 'cycle', dir: -1 }}
      columns={[
        { key: 'issue', label: 'Issue', width: '92px', sort: r => r.key, filter: r => r.key + ' ' + r.summary, render: r => <TicketLink i={r} style={{ font: `500 12px ${MONO}` }} /> },
        { key: 'summary', label: 'Summary', width: '2.2fr', sort: r => r.summary, render: r => <span style={{ font: `400 12px ${BODY}`, color: '#c3cfdc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{r.summary}</span> },
        { key: 'pts', label: 'Pts', width: '68px', align: 1, sort: r => r.pts, render: r => <span style={{ font: `600 12px ${MONO}`, color: BB }}>{r.pts}</span> },
        { key: 'cycle', label: 'Cycle', width: '74px', align: 1, sort: r => r.delivery, render: r => <span style={{ font: `600 12px ${MONO}`, color: '#e0e8f2' }}>{fx(r.delivery)}d</span> },
        { key: 'review', label: 'Review', width: '74px', align: 1, sort: r => r.cr, render: r => <span style={{ font: `500 12px ${MONO}`, color: PURPLE }}>{fx(r.cr)}d</span> },
        { key: 'acc', label: 'Est acc', width: '84px', align: 1, sort: r => r.estAcc ?? -1, render: r => <span style={{ font: `600 12px ${MONO}`, color: r.estAcc == null ? '#647285' : accColor(r.estAcc) }}>{r.estAcc == null ? '—' : fx(r.estAcc, 0) + '%'}</span> },
        { key: 'qa', label: 'QA cyc', width: '76px', align: 1, sort: r => r.qaCycles, render: r => <span style={{ font: `500 12px ${MONO}`, color: GOLD }}>{r.qaCycles}</span> },
        { key: 'files', label: 'Files', width: '54px', align: 1, sort: r => prsFor(r).reduce((a, p) => a + (p.changedFiles || 0), 0), render: r => { const f = prsFor(r).reduce((a, p) => a + (p.changedFiles || 0), 0); return <span style={{ font: `500 12px ${MONO}`, color: '#7f8ea1' }}>{f || '—'}</span> } },
      ]} />
  </section>
}
const Legend = ({ c, label, v }) => <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: c }} /><span style={{ font: `400 11.5px ${BODY}`, color: '#9fb0c2' }}>{label} <b style={{ color: '#eaf1f9', fontWeight: 600 }}>{v}</b></span></div>
const Empty = ({ text }) => <div style={{ padding: '18px', textAlign: 'center', font: `400 12px ${BODY}`, color: '#647285' }}>{text}</div>
function colorFor(name) { const m = { 'in progress': BB, 'in code review': PURPLE, 'design qa': '#f2a2c4', 'ready for qa': GOLD, 'in qa (dev)': GREEN, 'qa blocked': RED, 'ready for release': '#7c9bd6', live: GREEN }; return m[lc(name)] || '#7f8ea1' }
function PrBadge({ state }) {
  const c = state === 'Merged' || state === 'Approved' ? GREEN : state === 'Closed' ? RED : GOLD
  const bg = state === 'Merged' || state === 'Approved' ? 'rgba(95,211,154,0.14)' : state === 'Closed' ? 'rgba(242,119,122,0.14)' : 'rgba(245,196,81,0.14)'
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, font: `600 9.5px ${MONO}`, padding: '2px 8px', borderRadius: 5, background: bg, color: c }}>{state}</span>
}
// ---------------- MEMBERS ----------------
function Members({ S, issues, prs, members, member, setMember, prsFor }) {
  const mine = issues.filter(i => i.assignee?.id === member)
  const doneFeat = mine.filter(i => i.live && /feature|story/i.test(i.type))
  const base = doneFeat.length ? doneFeat : mine.filter(i => i.live)
  const mv = f => avg(base.map(f))
  const tiles = [
    ['Features', String(base.filter(i => /feature|story/i.test(i.type)).length), BB],
    ['Story points', String(base.reduce((a, i) => a + i.pts, 0)), '#e7eef6'],
    ['Avg story pts', fx(mv(i => i.pts)), '#e7eef6'],
    ['Est dev days', fx(mv(i => i.est)), GREEN],
    ['Delivery time', fx(mv(i => i.delivery || i.dev)) + 'd', BB],
    ['Dev time', fx(mv(i => i.dev)) + 'd', '#e7eef6'],
    ['Code review', fx(mv(i => i.cr)) + 'd', PURPLE],
    ['QA cycles', fx(mv(i => i.qaCycles)), GOLD],
    ['Est accuracy', base.filter(i => i.estAcc != null).length ? fx(avg(base.filter(i => i.estAcc != null).map(i => i.estAcc)), 0) + '%' : '—', GREEN],
    ['Rework', String(base.reduce((a, i) => a + i.rework, 0)), RED],
  ]
  const radar = memberRadar(mine, prsFor)
  const myPrs = useMemo(() => {
    const seen = new Set(), out = []
    for (const i of mine) for (const p of prsFor(i)) if (!seen.has(p.num)) { seen.add(p.num); out.push(p) }
    return out.sort((a, b) => (b.mergedAt || b.closedAt || b.createdAt).localeCompare(a.mergedAt || a.closedAt || a.createdAt))
  }, [member, issues.length])
  const curName = members.find(m => m.id === member)?.name

  return <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <H1 kicker="Per member" title="Member Metrics" right={
      <select value={member || ''} onChange={e => setMember(e.target.value)} style={{ ...sel, padding: '9px 14px', font: `600 13px ${BODY}`, minWidth: 200 }}>
        {members.length === 0 && <option value="">No dev-team members</option>}
        {members.map(m => <option key={m.id} value={m.id}>{m.name} · {m.count} issues</option>)}
      </select>} />

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10 }}>
      {tiles.map((t, i) => <div key={i} style={{ background: 'linear-gradient(150deg,rgba(19,27,38,0.85),rgba(11,16,23,0.6))', border: '1px solid rgba(142,200,255,0.09)', borderRadius: 12, padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ font: `600 9px ${MONO}`, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#7f8ea1' }}>{t[0]}</span>
        <span style={{ font: `700 20px ${HEAD}`, color: t[2], letterSpacing: '-0.01em' }}>{t[1]}</span></div>)}
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12, alignItems: 'start' }}>
      <DataTable title="Work items" meta="hover for next-step deadline" minWidth={560} pageSize={8}
        rows={mine} getKey={r => r.key} initialSort={{ key: 'status', dir: 1 }}
        columns={[
          { key: 'issue', label: 'Issue', width: '88px', sort: r => r.key, filter: r => r.key + ' ' + r.summary, render: r => <IssueTip i={r}><TicketLink i={r} style={{ font: `500 12px ${MONO}` }} /></IssueTip> },
          { key: 'summary', label: 'Summary', width: '1.7fr', sort: r => r.summary, render: r => <span style={{ font: `400 12px ${BODY}`, color: '#c3cfdc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{r.summary}</span> },
          { key: 'status', label: 'Status', width: '96px', align: 1, sort: r => r.status, filter: r => r.status, render: r => <span style={{ font: `600 9px ${MONO}`, padding: '2px 7px', borderRadius: 5, whiteSpace: 'nowrap', background: r.statusColor + '26', color: r.statusColor }}>{r.status}</span> },
          { key: 'cycle', label: 'Cycle', width: '66px', align: 1, sort: r => r.delivery, render: r => <span style={{ font: `600 12px ${MONO}`, color: '#e0e8f2' }}>{r.delivery ? fx(r.delivery) + 'd' : '—'}</span> },
          { key: 'acc', label: 'Est acc', width: '80px', align: 1, sort: r => r.estAcc ?? -1, render: r => <span style={{ font: `600 12px ${MONO}`, color: r.estAcc == null ? '#647285' : accColor(r.estAcc) }}>{r.estAcc == null ? '—' : fx(r.estAcc, 0) + '%'}</span> },
          { key: 'prs', label: 'PRs', width: '54px', align: 1, sort: r => (r.prNums || []).length, render: r => <span style={{ font: `500 12px ${MONO}`, color: PURPLE }}>{(r.prNums || []).length}</span> },
        ]} />

      <Card>
        <div style={{ font: `600 14px ${HEAD}`, color: '#eaf1f9', marginBottom: 2 }}>Delivery skills</div>
        <div style={{ font: `400 10.5px ${MONO}`, color: '#647285', marginBottom: 10 }}>composite · real changelog + PR signals</div>
        <Radar cur={radar.cur} prev={radar.prev} axes={['Grooming', 'Planning', 'Estimation', 'Dev Quality', 'Release']} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8 }}>
          {['Grooming Effectiveness', 'Planning Efficiency', 'Estimation Accuracy', 'Development Quality', 'Release Quality'].map((label, i) => {
            const d = Math.round(radar.cur[i] - radar.prev[i])
            return <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid rgba(142,200,255,0.04)' }}>
              <span style={{ flex: 1, font: `500 11.5px ${BODY}`, color: '#b3c1d1' }}>{label}</span>
              <span style={{ font: `600 12.5px ${HEAD}`, color: '#eaf1f9' }}>{Math.round(radar.cur[i])}</span>
              <span style={{ width: 34, textAlign: 'right', font: `500 10px ${MONO}`, color: d >= 0 ? GREEN : RED }}>{(d >= 0 ? '+' : '') + d}</span></div>
          })}
        </div>
      </Card>
    </div>

    <DataTable title="Pull requests" meta={`${curName ? curName.split(' ')[0] + ' · ' : ''}linked to their tickets`} minWidth={660} pageSize={8}
      rows={myPrs} getKey={p => p.num} initialSort={{ key: 'merge', dir: -1 }}
      columns={[
        { key: 'ticket', label: 'Ticket', width: '86px', sort: p => p.ticket, filter: p => p.ticket + ' ' + p.title, render: p => <TicketLink i={{ key: p.ticket }} style={{ font: `500 12px ${MONO}` }} /> },
        { key: 'state', label: 'State', width: '96px', sort: p => p.state, render: p => <PrBadge state={p.state} /> },
        { key: 'title', label: 'Title', width: '1.9fr', sort: p => p.title, render: p => <span style={{ font: `400 12px ${BODY}`, color: '#c3cfdc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}><PRLink pr={p}>#{p.num}</PRLink> {p.title}</span> },
        { key: 'comments', label: 'Comments', width: '100px', align: 1, sort: p => p.comments, render: p => <span style={{ font: `500 12px ${MONO}`, color: '#c3cfdc' }}>{p.comments}</span> },
        { key: 'cycles', label: 'Cycles', width: '72px', align: 1, sort: p => p.cycles, render: p => <span style={{ font: `600 12px ${MONO}`, color: p.cycles > 1 ? GOLD : '#c3cfdc' }}>{p.cycles}</span> },
        { key: 'merge', label: 'Merge', width: '76px', align: 1, sort: p => p.mergeDays ?? 1e9, render: p => <span style={{ font: `500 12px ${MONO}`, color: p.mergeDays == null ? '#647285' : '#e0e8f2' }}>{p.mergeDays == null ? '—' : fx(p.mergeDays) + 'd'}</span> },
      ]} />
  </section>
}

function memberRadar(mine, prsFor) {
  const half = Math.ceil(mine.length / 2)
  const calc = set => {
    if (!set.length) return [50, 50, 50, 50, 50]
    const withEst = set.filter(i => i.pts > 0).length / set.length
    const accSet = set.filter(i => i.estAcc != null)
    const acc = accSet.length ? avg(accSet.map(i => i.estAcc)) : 60
    const reworkRate = avg(set.map(i => Math.min(1, i.rework / 3)))
    const prs = set.flatMap(prsFor)
    const crRate = prs.length ? prs.filter(p => p.state === 'Changes requested' || p.cycles > 1).length / prs.length : 0.2
    const qa = avg(set.map(i => i.qaCycles))
    const clamp = v => Math.max(5, Math.min(100, v))
    return [clamp(withEst * 100), clamp(acc), clamp(acc), clamp(100 - (crRate * 50 + reworkRate * 50)), clamp(100 - qa * 25)]
  }
  return { cur: calc(mine), prev: calc(mine.slice(half)) }
}

function Radar({ cur, prev, axes }) {
  const rcx = 110, rcy = 95, rr = 66
  const ang = i => (-90 + i * 72) * Math.PI / 180
  const pt = (i, v) => [rcx + Math.cos(ang(i)) * rr * v / 100, rcy + Math.sin(ang(i)) * rr * v / 100]
  const poly = arr => axes.map((_, i) => pt(i, arr[i]).map(n => n.toFixed(1)).join(',')).join(' ')
  return <svg viewBox="0 0 220 190" style={{ width: '100%', height: 'auto', display: 'block' }}>
    {[33, 66, 100].map((p, k) => <polygon key={k} points={axes.map((_, i) => pt(i, p).map(n => n.toFixed(1)).join(',')).join(' ')} fill="none" stroke="rgba(142,200,255,0.08)" strokeWidth="1" />)}
    {axes.map((_, i) => { const p = pt(i, 100); return <line key={i} x1="110" y1="95" x2={p[0].toFixed(1)} y2={p[1].toFixed(1)} stroke="rgba(142,200,255,0.08)" /> })}
    <polygon points={poly(prev)} fill="rgba(120,140,170,0.12)" stroke="#5c6a7d" strokeWidth="1.4" />
    <polygon points={poly(cur)} fill="rgba(142,200,255,0.16)" stroke={BB} strokeWidth="2" />
    {axes.map((label, i) => { const p = pt(i, 122), c = Math.cos(ang(i)); return <text key={i} x={p[0].toFixed(1)} y={(p[1] + 3).toFixed(1)} textAnchor={Math.abs(c) < 0.3 ? 'middle' : c > 0 ? 'start' : 'end'} style={{ font: `600 8.5px ${BODY}`, fill: '#8896a8' }}>{label}</text> })}
  </svg>
}

// ---------------- BOARD (sprint task board) ----------------
function colsFor(items) {
  const present = [...new Set(items.map(i => i.status).filter(Boolean))]
  const plc = new Set(present.map(lc))
  const ordered = BOARD_ORDER.filter(s => plc.has(lc(s)))
  const oset = new Set(ordered.map(lc))
  return [...ordered, ...present.filter(s => !oset.has(lc(s)))]
}
function Board({ issues, members }) {
  const [who, setWho] = useState('all')
  const memberIds = new Set(members.map(m => m.id))
  // only tickets a dev on the list is/was responsible for
  const devScoped = issues.filter(i => (i.devAssignee && memberIds.has(i.devAssignee.id)) || memberIds.has(i.assignee?.id))
  const scoped = who === 'all' ? devScoped : devScoped.filter(i => i.devAssignee?.id === who || i.assignee?.id === who)
  const groups = {}
  for (const i of scoped) { const k = i.sprint?.name || '__none__'; (groups[k] ||= { name: i.sprint?.name || null, state: i.sprint?.state || '', id: i.sprint?.id || 0, items: [] }).items.push(i) }
  const order = Object.values(groups).sort((a, b) => {
    const aA = /active/i.test(a.state) ? 1 : 0, bA = /active/i.test(b.state) ? 1 : 0
    if (aA !== bA) return bA - aA                    // active sprint first
    const an = a.name ? 1 : 0, bn = b.name ? 1 : 0
    if (an !== bn) return bn - an                    // real sprints before "no sprint"
    return (b.id || 0) - (a.id || 0) || (b.name || '').localeCompare(a.name || '') // latest sprint next
  })
  const sprintPage = usePaged(order, 1)  // one sprint per page — defaults to page 0 = latest/active
  const grp = sprintPage.slice[0]
  const stats = grp ? sprintStats(grp.items) : []

  return <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <H1 kicker="Task board · dev team · by sprint" title="Work Board" right={
      <select value={who} onChange={e => setWho(e.target.value)} style={{ ...sel, padding: '9px 14px', font: `600 13px ${BODY}` }}>
        <option value="all">All dev team</option>
        {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>} />
    {!grp && <Card><Empty text="No dev-team tickets to board." /></Card>}
    {grp && <div style={{ ...PANEL, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ font: `700 15px ${HEAD}`, color: '#eaf1f9' }}>{grp.name || 'No sprint'}</span>
          {grp.name && grp.state && <span style={{ font: `600 8.5px ${MONO}`, letterSpacing: '0.05em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 5, background: /active/i.test(grp.state) ? 'rgba(95,211,154,0.16)' : 'rgba(142,200,255,0.1)', color: /active/i.test(grp.state) ? GREEN : '#93a6bb' }}>{/active/i.test(grp.state) ? 'active' : grp.state}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ font: `400 10.5px ${MONO}`, color: '#647285' }}>sprint {sprintPage.page + 1} / {sprintPage.pages}</span>
          <button disabled={sprintPage.page === 0} onClick={() => sprintPage.setPage(sprintPage.page - 1)} style={pagerBtn(sprintPage.page === 0)}>‹</button>
          <button disabled={sprintPage.page >= sprintPage.pages - 1} onClick={() => sprintPage.setPage(sprintPage.page + 1)} style={pagerBtn(sprintPage.page >= sprintPage.pages - 1)}>›</button>
        </div>
      </div>
      {/* per-sprint analysis */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${stats.length},1fr)`, gap: 8, marginBottom: 14 }}>
        {stats.map((s, i) => <div key={i} style={{ padding: '9px 11px', borderRadius: 10, background: 'rgba(10,15,22,0.5)', border: '1px solid rgba(142,200,255,0.06)' }}>
          <div style={{ font: `700 17px ${HEAD}`, color: s[2] }}>{s[1]}</div>
          <div style={{ font: `400 8.5px ${MONO}`, color: '#647285', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{s[0]}</div></div>)}
      </div>
      <ColumnsBoard items={grp.items} />
    </div>}
  </section>
}
function BoardCard({ i }) {
  const c = i.rec?.atRisk ? RED : i.rec && i.rec.remaining < 0.5 ? GOLD : 'rgba(142,200,255,0.09)'
  const first = n => (n ? n.split(' ')[0] : '—')
  return <IssueTip i={i}>
    <div style={{ padding: '9px 10px', borderRadius: 9, background: 'rgba(19,27,38,0.85)', border: `1px solid ${c}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <TicketLink i={i} style={{ font: `600 10.5px ${MONO}` }} />
        <ProjTag k={i.project} />
        <span style={{ marginLeft: 'auto', font: `500 9px ${MONO}`, color: '#647285' }}>{fx(i.inCurrent)}d</span>
        {i.rec?.atRisk && <span style={{ font: `600 9px ${MONO}`, color: RED }}>⚠</span>}
      </div>
      <div style={{ font: `500 11.5px ${BODY}`, color: '#dbe4ef', lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{i.summary}</div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <RoleChip label="Dev" name={first(i.devAssignee?.name)} c={BB} />
        <RoleChip label="QA" name={first(i.qaAssignee?.name)} c={GOLD} />
        <RoleChip label="Now" name={first(i.assignee?.name)} c={GREEN} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ font: `400 9.5px ${MONO}`, color: '#7f8ea1' }}>{i.sprint?.name || 'no sprint'}</span>
        <span style={{ font: `600 9px ${MONO}`, color: '#93a6bb', padding: '1px 6px', borderRadius: 4, background: 'rgba(142,200,255,0.08)' }}>{i.pts || 0} pt</span>
      </div>
    </div>
  </IssueTip>
}
const RoleChip = ({ label, name, c }) => <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, font: `500 9px ${MONO}`, padding: '1px 6px', borderRadius: 5, background: 'rgba(10,15,22,0.6)', border: '1px solid rgba(142,200,255,0.07)' }}>
  <span style={{ color: c, fontWeight: 700 }}>{label}</span><span style={{ color: name === '—' ? '#4c5768' : '#b3c1d1' }}>{name}</span></span>

// reusable status-column board for a set of issues (paginated by the caller)
function ColumnsBoard({ items, minCol = 232 }) {
  const cols = colsFor(items)
  if (!items.length) return <Empty text="Nothing here." />
  return <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 6 }}>
    {cols.map(col => {
      const its = items.filter(i => lc(i.status) === lc(col))
      return <div key={col} style={{ flex: `0 0 ${minCol}px`, width: minCol, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '0 4px' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: colorFor(col) }} />
          <span style={{ font: `600 11px ${BODY}`, color: '#c3cfdc' }}>{col}</span>
          <span style={{ font: `500 10px ${MONO}`, color: '#647285' }}>{its.length}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 40, padding: 6, borderRadius: 10, background: 'rgba(10,15,22,0.4)', border: '1px solid rgba(142,200,255,0.05)' }}>
          {its.map(i => <BoardCard key={i.key} i={i} />)}
          {its.length === 0 && <div style={{ padding: '10px 6px', font: `400 10.5px ${MONO}`, color: '#3d4757', textAlign: 'center' }}>—</div>}
        </div>
      </div>
    })}
  </div>
}
function sprintStats(items) {
  const done = items.filter(i => i.live)
  const bugs = items.filter(i => i.isBug)
  const cyc = done.map(i => i.delivery).filter(Boolean)
  return [
    ['Tickets', String(items.length), '#e7eef6'],
    ['Story pts', String(items.reduce((a, i) => a + (i.pts || 0), 0)), BB],
    ['Done', `${done.length}/${items.length}`, GREEN],
    ['Bugs', String(bugs.length), bugs.length ? RED : '#7f8ea1'],
    ['Avg cycle', cyc.length ? fx(avg(cyc)) + 'd' : '—', PURPLE],
    ['At risk', String(items.filter(i => i.rec?.atRisk).length), items.some(i => i.rec?.atRisk) ? GOLD : '#7f8ea1'],
  ]
}

// ---------------- WORKLOAD (per-dev load, areas, bug ownership) ----------------
function Workload({ issues, members, reload }) {
  const [saving, setSaving] = useState(null)
  const devIds = new Set(members.map(m => m.id))
  const setOwn = (key, field, value) => {
    setSaving(key + field)
    fetch('/api/eng/bug-ownership', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, [field]: value || null }) })
      .then(() => reload()).finally(() => setSaving(null))
  }
  // team bug = reported by our QA AND currently assigned to someone on the team
  const teamBug = i => i.isBug && i.qaReported && i.assigneeTeam
  const load = members.map(m => {
    const assigned = issues.filter(i => i.assignee?.id === m.id)
    const open = assigned.filter(i => !i.live)
    const active = assigned.filter(i => i.active)
    const done = assigned.filter(i => i.live)
    const finished = done.map(i => i.delivery).filter(v => v > 0)
    const owned = issues.filter(i => teamBug(i) && i.ownerId === m.id)   // bugs he caused
    const fixed = issues.filter(i => teamBug(i) && i.fixerId === m.id)   // bugs he resolved
    const notOwnedFixed = fixed.filter(i => i.ownerId !== m.id).length   // fixed someone else's bug
    return {
      m, ticketsN: assigned.length, openN: open.length, activeN: active.length, doneN: done.length,
      sp: active.reduce((a, i) => a + i.pts, 0), avgFinish: finished.length ? avg(finished) : null,
      bugsOwned: owned.length, bugsFixed: fixed.length, notOwnedFixed,
      bugRatio: assigned.length ? Math.round(owned.length / assigned.length * 100) : 0,
      notOwnedRatio: fixed.length ? Math.round(notOwnedFixed / fixed.length * 100) : null,
      atRisk: open.filter(i => i.rec?.atRisk).length,
    }
  }).sort((a, b) => b.openN - a.openN)
  const maxOpen = Math.max(1, ...load.map(l => l.openN))

  const bugs = issues.filter(teamBug)
  const pairs = {}
  for (const b of bugs) if (b.owner && b.fixer && b.ownerId !== b.fixerId) { const k = b.ownerId + '|' + b.fixerId; (pairs[k] ||= { owner: b.owner.name, fixer: b.fixer.name, n: 0 }).n++ }
  const topPairs = Object.values(pairs).sort((a, b) => b.n - a.n).slice(0, 8)

  const opt = (id) => <>
    <option value="">— auto —</option>
    {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
    {id && !devIds.has(id) && <option value={id}>{'(non-dev — keep)'}</option>}
  </>
  const ownSel = (b, field) => {
    const id = field === 'ownerId' ? b.ownerId : b.fixerId
    const manual = field === 'ownerId' ? b.ownerManual : b.fixerManual
    return <select value={devIds.has(id) ? id : ''} disabled={saving === b.key + field} onChange={e => setOwn(b.key, field, e.target.value)}
      style={{ ...sel, padding: '4px 7px', font: `500 11px ${BODY}`, maxWidth: 132, border: `1px solid ${manual ? 'rgba(95,211,154,0.4)' : 'rgba(142,200,255,0.14)'}` }}>{opt(id)}</select>
  }

  return <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <H1 kicker="Team capacity · by developer" title="Workload & Bug Ownership" right={
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 12px', borderRadius: 9, background: 'rgba(19,27,38,0.7)', border: '1px solid rgba(142,200,255,0.1)' }}>
          <span style={{ font: `700 15px ${HEAD}`, color: BB }}>{load.reduce((a, l) => a + l.openN, 0)}</span><span style={{ font: `400 11px ${BODY}`, color: '#7f8ea1' }}>open items</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 12px', borderRadius: 9, background: 'rgba(19,27,38,0.7)', border: '1px solid rgba(142,200,255,0.1)' }}>
          <span style={{ font: `700 15px ${HEAD}`, color: RED }}>{bugs.length}</span><span style={{ font: `400 11px ${BODY}`, color: '#7f8ea1' }}>bugs</span></div>
      </div>} />

    {/* per-dev load */}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(340px,1fr))', gap: 12 }}>
      {load.length === 0 && <Card><Empty text="No dev-team members in scope." /></Card>}
      {load.map(({ m, ticketsN, openN, activeN, doneN, sp, avgFinish, bugsOwned, bugsFixed, notOwnedFixed, bugRatio, notOwnedRatio, atRisk }, idx) => <Card key={m.id}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{ width: 30, height: 30, borderRadius: 8, background: AVATARS[idx % AVATARS.length], display: 'flex', alignItems: 'center', justifyContent: 'center', font: `600 12px ${HEAD}`, color: '#0b1420' }}>{initials(m.name)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: `600 13.5px ${BODY}`, color: '#eaf1f9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</div>
            <div style={{ font: `400 10px ${MONO}`, color: '#647285' }}>{activeN} active · {sp}pt in flight{atRisk ? ` · ${atRisk} at risk` : ''}</div>
          </div>
          <div style={{ textAlign: 'right' }}><div style={{ font: `700 20px ${HEAD}`, color: openN >= maxOpen * 0.8 ? GOLD : BB }}>{openN}</div><div style={{ font: `400 8.5px ${MONO}`, color: '#647285', textTransform: 'uppercase' }}>open</div></div>
        </div>
        <div style={{ height: 6, borderRadius: 4, background: 'rgba(142,200,255,0.06)', overflow: 'hidden', marginBottom: 12 }}><div style={{ height: '100%', width: `${openN / maxOpen * 100}%`, borderRadius: 4, background: openN >= maxOpen * 0.8 ? 'linear-gradient(90deg,#f5c451,#eab13a)' : 'linear-gradient(90deg,#8ec8ff,#5b9fe6)' }} /></div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <MiniStat label="Tickets" v={ticketsN} sub={`${doneN} done`} c="#e7eef6" />
          <MiniStat label="Avg finish" v={avgFinish == null ? '—' : fx(avgFinish) + 'd'} sub="per ticket" c={BB} />
          <MiniStat label="Bug ratio" v={bugRatio + '%'} sub="caused / tickets" c={bugRatio >= 25 ? RED : PURPLE} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <MiniStat label="Bugs owned" v={bugsOwned} sub="he caused" c={bugsOwned ? RED : '#7f8ea1'} />
          <MiniStat label="Bugs fixed" v={bugsFixed} sub="he resolved" c={bugsFixed ? GREEN : '#7f8ea1'} />
          <MiniStat label="Fixed for others" v={notOwnedRatio == null ? '—' : notOwnedRatio + '%'} sub={`${notOwnedFixed} not owned`} c={GOLD} />
        </div>
      </Card>)}
    </div>

    {/* who fixes whose bugs */}
    {topPairs.length > 0 && <Card>
      <CardHead title="Who fixes whose bugs" meta="owner → fixer · cross-developer" />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {topPairs.map((p, i) => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 12px', borderRadius: 10, background: 'rgba(10,15,22,0.5)', border: '1px solid rgba(142,200,255,0.07)' }}>
          <span style={{ font: `500 12px ${BODY}`, color: '#c3cfdc' }}>{p.owner.split(' ')[0]}</span>
          <span style={{ font: `600 12px ${MONO}`, color: '#647285' }}>→</span>
          <span style={{ font: `500 12px ${BODY}`, color: GREEN }}>{p.fixer.split(' ')[0]}</span>
          <span style={{ font: `700 12px ${HEAD}`, color: '#eaf1f9', marginLeft: 2 }}>{p.n}</span>
        </div>)}
      </div>
    </Card>}

    {/* bug register — editable owner / fixer */}
    <DataTable title="Bug register" meta="QA-reported · assigned to team · owner=has it · fixer=resolves it" minWidth={1120} pageSize={12}
      rows={bugs} getKey={b => b.key} initialSort={{ key: 'reported', dir: -1 }}
      columns={[
        { key: 'bug', label: 'Bug', width: '82px', sort: b => b.key, filter: b => b.key + ' ' + b.summary, render: b => <IssueTip i={b}><TicketLink i={b} color={b.live ? '#7f8ea1' : RED} style={{ font: `500 12px ${MONO}` }} /></IssueTip> },
        { key: 'summary', label: 'Summary', width: '1.6fr', sort: b => b.summary, render: b => <span style={{ font: `400 12px ${BODY}`, color: '#c3cfdc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{b.linkedKey && <TicketLink i={{ key: b.linkedKey, host: b.host }} color="#647285" style={{ fontSize: 10 }}>↳{b.linkedKey}</TicketLink>} {b.summary}</span> },
        { key: 'area', label: 'Area', width: '100px', sort: b => b.area || '', render: b => <span style={{ font: `400 11px ${BODY}`, color: b.area ? '#9db6dc' : '#647285' }}>{b.area || '—'}</span> },
        { key: 'status', label: 'Status', width: '90px', sort: b => b.status, filter: b => b.status, render: b => <span style={{ font: `600 9px ${MONO}`, padding: '2px 7px', borderRadius: 5, whiteSpace: 'nowrap', background: b.statusColor + '26', color: b.statusColor }}>{b.status}</span> },
        { key: 'reported', label: 'Reported', width: '78px', sort: b => b.created || '', render: b => <span style={{ font: `500 11px ${MONO}`, color: '#b3c1d1' }}>{fdate(b.created)}</span> },
        { key: 'closed', label: 'Closed', width: '78px', sort: b => b.closedAt || '', render: b => <span style={{ font: `500 11px ${MONO}`, color: b.closedAt ? GREEN : '#647285' }}>{fdate(b.closedAt)}</span> },
        { key: 'assignee', label: 'Assigned now', width: '112px', sort: b => b.assignee?.name || '', filter: b => b.assignee?.name || '', render: b => <span style={{ font: `400 11px ${BODY}`, color: b.assignee ? '#c3cfdc' : '#647285', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{b.assignee?.name || '—'}</span> },
        { key: 'owner', label: 'Owner (has)', width: '136px', sort: b => b.owner?.name || '', render: b => ownSel(b, 'ownerId') },
        { key: 'fixer', label: 'Fixer (resolves)', width: '136px', sort: b => b.fixer?.name || '', render: b => ownSel(b, 'fixerId') },
      ]} />
  </section>
}
const MiniStat = ({ label, v, c, sub }) => <div style={{ flex: 1, minWidth: 0, padding: '8px 10px', borderRadius: 9, background: 'rgba(10,15,22,0.5)', border: '1px solid rgba(142,200,255,0.06)' }}>
  <div style={{ font: `700 16px ${HEAD}`, color: c }}>{v}</div>
  <div style={{ font: `400 8.5px ${MONO}`, color: '#647285', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
  {sub && <div style={{ font: `400 8px ${MONO}`, color: '#4c5768', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}</div>

// ---------------- REVIEW (table + detail drawer) ----------------
const prCol = {
  ticket: { key: 'ticket', label: 'Ticket', width: '84px', sort: p => p.ticket, filter: p => p.ticket + ' ' + p.title + ' ' + p.author, render: p => <TicketLink i={{ key: p.ticket }} style={{ font: `500 12px ${MONO}` }} /> },
  proj: { key: 'proj', label: 'Proj', width: '52px', sort: p => p.project, render: p => <ProjTag k={p.project} /> },
  title: { key: 'title', label: 'Title', width: '2fr', sort: p => p.title, render: p => <span style={{ font: `400 12px ${BODY}`, color: '#c3cfdc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}><PRLink pr={p}>#{p.num}</PRLink> {p.title}</span> },
  state: { key: 'state', label: 'State', width: '118px', sort: p => p.state, render: p => <PrBadge state={p.state} /> },
  comments: { key: 'comments', label: 'Comments', width: '82px', align: 1, sort: p => p.comments, render: p => <span style={{ font: `500 12px ${MONO}`, color: '#c3cfdc' }}>{p.comments}</span> },
  cycles: { key: 'cycles', label: 'Cycles', width: '66px', align: 1, sort: p => p.cycles, render: p => <span style={{ font: `600 12px ${MONO}`, color: p.cycles > 1 ? GOLD : '#c3cfdc' }}>{p.cycles}</span> },
  first: { key: 'first', label: '1st review', width: '84px', align: 1, sort: p => p.firstReviewDays ?? 1e9, render: p => <span style={{ font: `500 12px ${MONO}`, color: PURPLE }}>{p.firstReviewDays == null ? '—' : fx(p.firstReviewDays) + 'd'}</span> },
  open: { key: 'open', label: 'Open', width: '68px', align: 1, sort: p => p.openDays ?? 0, render: p => <span style={{ font: `500 12px ${MONO}`, color: '#e0e8f2' }}>{fx(p.openDays, 0)}d</span> },
  merge: { key: 'merge', label: 'Merge', width: '72px', align: 1, sort: p => p.mergeDays ?? 1e9, render: p => <span style={{ font: `500 12px ${MONO}`, color: p.mergeDays == null ? '#647285' : '#e0e8f2' }}>{p.mergeDays == null ? '—' : fx(p.mergeDays) + 'd'}</span> },
}
function Review({ prs, deepNum, setDeepNum }) {
  const cur = prs.find(p => p.num === deepNum)
  const stageRank = p => (p.state === 'Approved' ? 2 : p.state === 'Changes requested' ? 1 : 0) // await review → changes → approved
  const open = prs.filter(p => p.state !== 'Merged' && p.state !== 'Closed')
    .sort((a, b) => stageRank(a) - stageRank(b) || (b.createdAt || '').localeCompare(a.createdAt || ''))
  const done = prs.filter(p => p.state === 'Merged' || p.state === 'Closed')
  return <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <H1 kicker="Code review · GitHub" title="PR Review Timelines" right={<span style={{ font: `400 11px ${MONO}`, color: '#647285' }}>click a row for details</span>} />
    <DataTable title="Awaiting review" meta="await review → changes requested → approved" minWidth={900} pageSize={10}
      rows={open} getKey={p => p.num} onRowClick={p => setDeepNum(p.num)} activeKey={deepNum}
      columns={[prCol.ticket, prCol.proj, prCol.title, prCol.state, prCol.comments, prCol.cycles, prCol.first, prCol.open]} />
    <DataTable title="Merged & closed" minWidth={900} pageSize={10} initialSort={{ key: 'merge', dir: -1 }}
      rows={done} getKey={p => p.num} onRowClick={p => setDeepNum(p.num)} activeKey={deepNum}
      columns={[prCol.ticket, prCol.proj, prCol.title, prCol.state, prCol.comments, prCol.cycles, prCol.first, prCol.merge]} />
    {cur && <PrDrawer pr={cur} onClose={() => setDeepNum(null)} />}
  </section>
}
function PrDrawer({ pr, onClose }) {
  const timeline = prTimeline(pr)
  const rvColors = {}; pr.reviewers.forEach((r, i) => rvColors[r] = AVATARS[i % AVATARS.length])
  return <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(4,7,11,0.6)', display: 'flex', justifyContent: 'flex-end' }}>
    <div onClick={e => e.stopPropagation()} style={{ width: 520, maxWidth: '94vw', height: '100%', overflowY: 'auto', background: 'linear-gradient(160deg,#111a26,#0b1017)', borderLeft: '1px solid rgba(142,200,255,0.12)', padding: '20px 22px', boxShadow: '-16px 0 40px -12px rgba(0,0,0,0.6)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}><TicketLink i={{ key: pr.ticket }} style={{ font: `600 13px ${MONO}` }} /><ProjTag k={pr.project} /><PrBadge state={pr.state} /></div>
          <div style={{ font: `600 15px ${HEAD}`, color: '#eaf1f9', lineHeight: 1.35 }}>{pr.title}</div>
          <PRLink pr={pr} style={{ font: `400 11px ${MONO}`, marginTop: 4, display: 'inline-block' }}>open PR #{pr.num} on GitHub ↗</PRLink>
        </div>
        <button onClick={onClose} style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 8, border: '1px solid rgba(142,200,255,0.14)', background: 'transparent', color: '#93a2b4', cursor: 'pointer', font: '15px sans-serif' }}>✕</button>
      </div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
        {[['Days open', fx(pr.openDays, 0), '#e7eef6'], ['1st review', pr.firstReviewDays == null ? '—' : fx(pr.firstReviewDays) + 'd', PURPLE], ['Comments', String(pr.comments), BB], ['Cycles', String(pr.cycles), GOLD], ['Files', String(pr.changedFiles), '#7c9bd6']].map((s, i) =>
          <div key={i}><div style={{ font: `700 18px ${HEAD}`, color: s[2] }}>{s[1]}</div><div style={{ font: `400 8.5px ${MONO}`, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#647285' }}>{s[0]}</div></div>)}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 16, flexWrap: 'wrap' }}>
        <span style={{ font: `600 10px ${MONO}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#7f8ea1' }}>Reviewers</span>
        {pr.reviewers.length === 0 && <span style={{ font: `400 11px ${MONO}`, color: '#647285' }}>none yet</span>}
        {pr.reviewers.map(r => <span key={r} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: `500 11.5px ${BODY}`, color: '#c3cfdc', background: 'rgba(142,200,255,0.06)', padding: '3px 9px', borderRadius: 7 }}>
          <span style={{ width: 15, height: 15, borderRadius: '50%', background: rvColors[r], display: 'inline-flex', alignItems: 'center', justifyContent: 'center', font: `600 8px ${HEAD}`, color: '#0b1420' }}>{r[0].toUpperCase()}</span>{r}</span>)}
      </div>
      <div style={{ font: `600 10px ${MONO}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#7f8ea1', marginBottom: 11 }}>Review timeline</div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {timeline.map((t, i) => <div key={i} style={{ display: 'flex', gap: 13 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
            <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'rgba(11,16,23,0.9)', border: `2px solid ${t.color}`, color: t.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>{t.icon}</span>
            <span style={{ width: 2, flex: 1, background: i === timeline.length - 1 ? 'transparent' : 'rgba(142,200,255,0.12)', minHeight: i === timeline.length - 1 ? 0 : 20 }} />
          </div>
          <div style={{ paddingBottom: 16 }}>
            <div style={{ font: `600 12.5px ${BODY}`, color: '#eaf1f9' }}>{t.title}</div>
            <div style={{ marginTop: 2, font: `400 11px ${MONO}`, color: '#7f8ea1' }}>{t.meta}</div>
          </div></div>)}
      </div>
      <div style={{ marginTop: 4, paddingTop: 14, borderTop: '1px solid rgba(142,200,255,0.07)' }}>
        <div style={{ font: `600 10px ${MONO}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#7f8ea1', marginBottom: 9 }}>Files touched <span style={{ color: '#647285' }}>({pr.changedFiles})</span></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {pr.files.map((f, i) => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, font: `400 11.5px ${MONO}` }}>
            <span style={{ flex: 1, minWidth: 0, color: '#b3c1d1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.path}</span>
            <span style={{ color: GREEN }}>+{f.add}</span><span style={{ color: RED }}>−{f.del}</span></div>)}
          {pr.changedFiles > pr.files.length && <div style={{ font: `400 10.5px ${MONO}`, color: '#647285' }}>+{pr.changedFiles - pr.files.length} more files</div>}
        </div>
      </div>
    </div>
  </div>
}
function prTimeline(p) {
  const fx1 = n => Number(n).toFixed(1)
  const tl = [{ icon: '○', color: BB, title: 'PR opened', meta: `#${p.num} · ${p.author} · +${p.additions} −${p.deletions}` }]
  const evs = [...(p.reviewEvents || [])].sort((a, b) => a.at.localeCompare(b.at))
  let firstDone = false
  for (const e of evs) {
    if (e.state === 'CHANGES_REQUESTED') tl.push({ icon: '↻', color: GOLD, title: 'Changes requested', meta: `${e.login} · ${new Date(e.at).toLocaleDateString()}` })
    else if (e.state === 'APPROVED') tl.push({ icon: '✓', color: GREEN, title: 'Approved', meta: `${e.login} · ${new Date(e.at).toLocaleDateString()}` })
    else if (!firstDone) { tl.push({ icon: '◔', color: PURPLE, title: 'First review', meta: `${p.firstReviewDays != null ? fx1(p.firstReviewDays) + 'd after open · ' : ''}${e.login}` }); firstDone = true }
  }
  if (p.mergedAt) tl.push({ icon: '⬢', color: '#7c9bd6', title: 'Merged', meta: `${p.mergeDays != null ? fx1(p.mergeDays) + 'd total open' : ''}` })
  else if (p.state === 'Closed') tl.push({ icon: '×', color: RED, title: 'Closed without merge', meta: '' })
  return tl
}

// ---------------- OKRS ----------------
function Okrs({ S, issues, shipped, prs, quarter, setQuarter }) {
  const merged = prs.filter(p => p.mergedAt)
  const live = issues.filter(i => i.live)
  const baselineDev = (() => {
    if (!live.length) return avg(shipped.map(i => i.dev)) || 1
    const key = i => i.year * 12 + i.month
    const minK = Math.min(...live.map(key))
    const cohort = live.filter(i => key(i) === minK)
    return avg(cohort.map(i => i.dev)) || avg(live.map(i => i.dev)) || 1
  })()
  const auto = {
    devTime: avg(shipped.map(i => i.dev)),
    crTime: avg(shipped.map(i => i.cr)),
    estAcc: (() => { const s = shipped.filter(i => i.estAcc != null); return s.length ? avg(s.map(i => i.estAcc)) : null })(),
    qaCycles: avg(shipped.map(i => i.qaCycles)),
    stale: issues.filter(i => i.stale).length,
    cycle: avg(shipped.map(i => i.delivery)),
    firstReview: avg(prs.filter(p => p.firstReviewDays != null).map(p => p.firstReviewDays)),
    mergeTime: avg(merged.filter(p => p.mergeDays != null).map(p => p.mergeDays)),
    reworkRate: issues.length ? issues.filter(i => i.rework > 0).length / issues.length * 100 : 0,
  }
  const baseline = { devTime: baselineDev }
  const objs = (S.okrs?.[quarter] || []).map(o => {
    const measures = o.measures.map(m => {
      const raw = auto[m.auto]
      const noData = raw == null
      const v = noData ? 0 : raw
      const unit = m.unit || ''
      const target = m.reducePct != null ? +((baseline[m.baselineOf] || 0) * (1 - m.reducePct / 100)).toFixed(2) : m.target
      const dec = unit === '%' ? 0 : m.auto === 'stale' ? 0 : 1
      const suffix = unit === '%' ? '%' : unit === 'd' ? 'd' : ''
      const curTxt = noData ? '—' : fx(v, dec) + suffix
      const tgtTxt = fx(target, dec) + suffix
      let pct
      if (noData) pct = 0
      else if (m.dir === 'up') pct = target ? Math.min(100, v / target * 100) : 0
      else if (target === 0) pct = v <= 0 ? 100 : Math.max(0, 100 - v * 33)
      else pct = v <= target ? 100 : Math.max(0, Math.min(100, target / v * 100))
      const color = noData ? '#647285' : pct >= 90 ? GREEN : pct >= 60 ? BB : pct >= 40 ? GOLD : RED
      const note = (m.reducePct != null ? `${m.note} (${fx(baseline[m.baselineOf], 1)}d)` : m.note) + (noData ? ' · no data yet' : '')
      return { ...m, src: 'AUTO', note, curTxt, tgtTxt, pct: Math.round(pct), color }
    })
    const pct = Math.round(avg(measures.map(m => m.pct)))
    return { ...o, measures, pct }
  })
  return <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <H1 kicker={`${S.team.name} · Web Engineering`} title="Objectives & Key Results" right={
      <div style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 9, background: 'rgba(10,15,22,0.6)' }}>
        {['Q3', 'Q4'].map(q => <button key={q} onClick={() => setQuarter(q)} style={{ padding: '6px 14px', border: 'none', borderRadius: 7, cursor: 'pointer', font: `600 12px ${BODY}`, background: quarter === q ? 'rgba(142,200,255,0.2)' : 'transparent', color: quarter === q ? '#dbeafc' : '#7f8ea1' }}>{q} 2026</button>)}
      </div>} />
    {objs.map((o, oi) => <div key={oi} style={{ ...PANEL, padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ maxWidth: 600 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 5 }}><span style={{ width: 26, height: 26, borderRadius: 8, background: o.color + '26', color: o.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>◎</span><span style={{ font: `700 16px ${HEAD}`, color: '#eaf1f9' }}>{o.title}</span></div>
          <div style={{ font: `400 12px ${BODY}`, color: '#8b98a9', lineHeight: 1.5 }}>{o.def}</div>
          <div style={{ marginTop: 8, display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            <span style={{ font: `600 9px ${MONO}`, letterSpacing: '0.04em', padding: '3px 8px', borderRadius: 5, background: 'rgba(142,200,255,0.07)', color: '#93a6bb' }}>{o.owner}</span>
            {o.carried && <span style={{ font: `600 9px ${MONO}`, letterSpacing: '0.04em', padding: '3px 8px', borderRadius: 5, background: 'rgba(245,196,81,0.13)', color: GOLD }}>↻ carried from {o.carried}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <div style={{ textAlign: 'right' }}><div style={{ font: `700 26px ${HEAD}`, color: o.color }}>{o.pct}%</div><div style={{ font: `400 9.5px ${MONO}`, color: '#647285' }}>objective</div></div>
          <svg width="60" height="60" viewBox="0 0 60 60"><circle cx="30" cy="30" r="24" fill="none" stroke="rgba(142,200,255,0.1)" strokeWidth="6" /><circle cx="30" cy="30" r="24" fill="none" stroke={o.color} strokeWidth="6" strokeLinecap="round" strokeDasharray="150.8" strokeDashoffset={(150.8 * (1 - o.pct / 100)).toFixed(1)} transform="rotate(-90 30 30)" /></svg>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {o.measures.map((m, mi) => <div key={mi} style={{ padding: '12px 14px', borderRadius: 11, background: 'rgba(10,15,22,0.5)', border: '1px solid rgba(142,200,255,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 9 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}><span style={{ font: `500 12.5px ${BODY}`, color: '#dbe4ef' }}>{m.t}</span><span style={{ font: `600 8px ${MONO}`, letterSpacing: '0.04em', padding: '1px 6px', borderRadius: 4, background: m.src === 'AUTO' ? 'rgba(95,211,154,0.14)' : 'rgba(245,196,81,0.14)', color: m.src === 'AUTO' ? GREEN : GOLD }}>{m.src}</span></div>
              <div style={{ font: `400 10.5px ${MONO}`, color: '#647285' }}>{m.note}</div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}><span style={{ font: `700 14px ${HEAD}`, color: '#eaf1f9' }}>{m.curTxt}</span><span style={{ font: `400 10.5px ${MONO}`, color: '#647285' }}> / {m.tgtTxt}</span></div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <div style={{ flex: 1, height: 6, borderRadius: 4, background: 'rgba(142,200,255,0.06)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${m.pct}%`, borderRadius: 4, background: m.color }} /></div>
            <span style={{ width: 38, textAlign: 'right', font: `600 11px ${MONO}`, color: m.color }}>{m.pct}%</span>
          </div>
        </div>)}
      </div>
    </div>)}
    {objs.length === 0 && <Card><Empty text="No objectives defined for this quarter." /></Card>}
  </section>
}
