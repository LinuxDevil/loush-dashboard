import React, { useEffect, useMemo, useState } from 'react'
import { api } from './api.js'
import Skeleton from './Skeleton.jsx'
import { usePager } from './Pager.jsx'

const A = '#d97757'
const LEVEL_COLOR = { poor: '#e5484d', good: '#e5a03a', excellent: '#3fb96a', perfect: '#8b7cf6' }
const LEVELS = ['poor', 'good', 'excellent', 'perfect']
const PROJ_COLORS = ['#5eb3f6', '#3fb96a', '#8b7cf6', '#e8a06a', '#d97757', '#c98bf6']
const fmtTok = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n)))
const fmtDur = ms => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m` : `${m}m` }
const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago' }
const xpLevel = msgs => Math.floor(Math.sqrt(msgs / 50))
const xpNext = lvl => (lvl + 1) ** 2 * 50

const sparkPts = (arr, h = 26) => {
  const mx = Math.max(...arr), mn = Math.min(...arr), rng = mx - mn || 1, n = arr.length
  return arr.map((v, i) => `${((i / (n - 1)) * 100).toFixed(1)},${((h - 2) - ((v - mn) / rng) * (h - 4)).toFixed(1)}`).join(' ')
}
const Spark = ({ data, color, h = 26, className = 'spark' }) => (
  <svg viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" className={className} style={{ height: h }}>
    <polyline points={sparkPts(data, h)} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
  </svg>
)

function HealthRing({ score }) {
  const R = 30, C = 2 * Math.PI * R
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" role="img" aria-label={`setup health ${score}/100`}>
      <defs><linearGradient id="ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#e8a06a" /><stop offset="1" stopColor="#d97757" /></linearGradient></defs>
      <circle cx="36" cy="36" r={R} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="7" />
      <circle cx="36" cy="36" r={R} fill="none" stroke="url(#ring)" strokeWidth="7" strokeLinecap="round"
        strokeDasharray={`${(score / 100) * C} ${C}`} transform="rotate(-90 36 36)" style={{ filter: 'drop-shadow(0 0 6px rgba(217,119,87,0.5))' }} />
      <text x="36" y="34" textAnchor="middle" style={{ font: "600 20px 'Space Grotesk'", fill: '#f6efe9' }}>{score}</text>
      <text x="36" y="48" textAnchor="middle" style={{ font: "500 9px 'IBM Plex Mono'", fill: '#8a807a' }}>/100</text>
    </svg>
  )
}

function Kpi({ label, tag, value, sub, accent, data, delay }) {
  return (
    <div className="kpi" style={{ animationDelay: delay }}>
      <div className="kpi-label"><span>{label}</span>{tag && <span className="kpi-tag" style={tag.dim ? { color: '#8a807a', background: 'rgba(255,255,255,0.05)' } : null}>{tag.text}</span>}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-sub">{sub}</div>
      {data && <Spark data={data} color={accent} />}
    </div>
  )
}

function Bars({ data, unit }) {
  const max = Math.max(...data.map(d => d.value), 1)
  return (
    <div className="bars">
      {data.map(d => (
        <div className="bar-row" key={d.label} title={`${d.label}: ${fmtTok(d.value)} ${unit}`}>
          <div className="bar-label">{d.label}</div>
          <div className="bar-track"><div className="bar-fill" style={{ width: (d.value / max) * 100 + '%', background: `linear-gradient(90deg, ${d.color || A}, ${d.color || A}cc)`, boxShadow: d.glow ? `0 0 10px ${d.color}55` : 'none' }} /></div>
          <div className="bar-value">{fmtTok(d.value)}</div>
        </div>
      ))}
    </div>
  )
}

function Heatmap({ daily }) {
  const max = Math.max(...daily.map(d => d.out), 1)
  return (
    <div className="heat-grid">
      {daily.map(d => {
        const v = d.out / max
        const bg = d.out === 0 ? 'rgba(255,255,255,0.05)' : `rgba(217,119,87,${(0.3 + Math.min(1, Math.pow(v, 0.5)) * 0.6).toFixed(2)})`
        return <div key={d.date} className="heat-cell" title={`${d.date}: ${fmtTok(d.out)} out tok · ${d.msgs} msgs`}
          style={{ background: bg, boxShadow: v > 0.4 ? '0 0 6px rgba(217,119,87,0.4)' : 'none' }} />
      })}
    </div>
  )
}

function Achievements({ items, usage, hookCount }) {
  const scored = items.filter(i => i.score !== null)
  const tagged = items.filter(i => i.tags.length).length
  const defs = [
    ['S', 'Skill Collector', '25+ skills installed', items.filter(i => i.kind === 'skills').length >= 25],
    ['P', 'Prompt Smith', '5+ commands w/ arg hints', items.filter(i => i.kind === 'commands' && i.specificity >= 40).length >= 5],
    ['A', 'Agent Army', '20+ subagents defined', items.filter(i => i.kind === 'agents').length >= 20],
    ['H', 'Hook Master', '5+ hooks wired up', hookCount >= 5],
    ['★', 'Perfectionist', 'any item scores ≥ 90', scored.some(i => i.score >= 90)],
    ['W', 'No Dead Weight', 'zero poor-level items', scored.length > 0 && !scored.some(i => i.level === 'poor')],
    ['C', 'Curator', '10+ items tagged', tagged >= 10],
    ['R', 'On A Roll', '7-day usage streak', (usage?.streak || 0) >= 7],
    ['V', 'Veteran', '100+ active days', (usage?.activeDays || 0) >= 100],
    ['F', 'Context Saver', 'always-loaded < 8k tok', items.reduce((s, i) => s + i.descTokens, 0) < 8000],
  ]
  const unlocked = defs.filter(d => d[3]).length
  return (
    <div className="panel" style={{ animationDelay: '.4s' }}>
      <h3>Achievements <span className="muted">{unlocked} / {defs.length} unlocked</span></h3>
      <div className="badges">
        {defs.map(([glyph, name, desc, done]) => (
          <div key={name} className={'badge-card' + (done ? ' unlocked' : '')}>
            <div className="badge-top">
              <div className="badge-glyph">{glyph}</div>
              <span className="badge-tag">{done ? 'UNLOCKED' : 'LOCKED'}</span>
            </div>
            <div className="badge-name">{name}</div>
            <div className="badge-desc">{desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

const COLS = [['name', 'Name'], ['kind', 'Kind'], ['group', 'Group'], ['tags', 'Tags'], ['descTokens', 'Ctx: always'], ['fullTokens', 'On invoke'], ['score', 'Level'], ['specificity', 'Spec.']]

export default function Overview() {
  const [data, setData] = useState(null)
  const [usage, setUsage] = useState(null)
  const [usageErr, setUsageErr] = useState(null)
  const [projects, setProjects] = useState([])
  const [hookCount, setHookCount] = useState(0)
  const [pins, setPins] = useState([])
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('')
  const [sort, setSort] = useState({ col: 'score', dir: -1 })

  useEffect(() => {
    api.get('/api/overview').then(setData)
    api.get('/api/usage').then(setUsage).catch(e => setUsageErr(e.message))
    api.get('/api/projects').then(setProjects).catch(() => {})
    api.get('/api/pins').then(setPins).catch(() => {})
    api.get('/api/hooks').then(d => {
      let n = 0
      for (const s of Object.values(d)) for (const groups of Object.values(s.settings?.hooks || {})) for (const g of groups) n += (g.hooks || []).length
      setHookCount(n)
    }).catch(() => {})
  }, [])

  const items = data?.items || []
  const kinds = useMemo(() => [...new Set(items.map(i => i.kind))], [items])
  const filtered = useMemo(() => {
    let r = items.filter(i => (!kind || i.kind === kind) && (!q || (i.name + ' ' + i.group + ' ' + i.tags.join(' ')).toLowerCase().includes(q.toLowerCase())))
    r.sort((a, b) => {
      const x = a[sort.col], y = b[sort.col]
      if (x === null) return 1
      if (y === null) return -1
      return sort.dir * (typeof x === 'number' ? x - y : String(x).localeCompare(String(y)))
    })
    return r
  }, [items, q, kind, sort])

  const editTags = it => {
    const t = prompt(`Tags for ${it.name} (comma-separated):`, it.tags.join(', '))
    if (t === null) return
    api.put('/api/tags', { key: `${it.kind}:${it.name}`, tags: t.split(',').map(s => s.trim()).filter(Boolean) })
      .then(() => api.get('/api/overview').then(setData))
  }

  const scored = items.filter(i => i.score !== null)
  const health = scored.length ? Math.round(scored.reduce((s, i) => s + i.score, 0) / scored.length) : 0
  const alwaysTok = items.reduce((s, i) => s + i.descTokens, 0)
  const hog = items.length ? [...items].sort((a, b) => b.fullTokens - a.fullTokens)[0] : null
  const ab = usage?.activeBlock
  const lvl = usage ? xpLevel(usage.totalMsgs) : 0
  const xpPct = usage ? Math.round(((usage.totalMsgs - lvl ** 2 * 50) / (xpNext(lvl) - lvl ** 2 * 50)) * 100) : 0
  const d = usage?.daily || []
  const last10 = key => d.slice(-10).map(x => x[key])
  const models = usage ? Object.entries(usage.perModel).map(([m, v]) => ({ label: m.replace(/^claude-/, ''), value: v.msgs, color: '#8b7cf6' })).sort((a, b) => b.value - a.value).slice(0, 5) : []
  const levelDist = LEVELS.map(l => ({ label: l, value: scored.filter(i => i.level === l).length, color: LEVEL_COLOR[l], glow: true }))
  const top = projects.filter(p => p.usage).slice(0, 4)
  const inv = usePager(filtered, 15)

  if (!data) return <Skeleton tiles={4} rows={8} />

  return (
    <div className="overview">
      <div className="kpi-grid">
        <div className="kpi ring">
          <HealthRing score={health} />
          <div>
            <div className="kpi-label">Setup health</div>
            <div className="kpi-sub" style={{ marginTop: 6, lineHeight: 1.5 }}>
              {scored.length} scored items<br />
              {levelDist[2].value} excellent · {levelDist[3].value} perfect
            </div>
          </div>
        </div>
        <Kpi label="5h output" tag={ab ? { text: `${ab.msgs} msgs` } : { text: 'idle', dim: true }} accent={A} delay=".05s"
          value={ab ? fmtTok(ab.out) : '—'} sub={ab ? `resets ${fmtDur(ab.end - Date.now())}` : usageErr || 'no active block'} data={usage && last10('out')} />
        <Kpi label="lines · 7d" tag={{ text: `+${fmtTok(usage?.kpis.lines7d.add || 0)}` }} accent="#3fb96a" delay=".1s"
          value={usage ? fmtTok(usage.kpis.lines7d.add + usage.kpis.lines7d.del) : '…'}
          sub={usage ? `+${fmtTok(usage.kpis.lines7d.add)} · −${fmtTok(usage.kpis.lines7d.del)} (edits)` : ''} data={usage && last10('lines')} />
        <Kpi label="tool calls" tag={{ text: 'today' }} accent="#8b7cf6" delay=".15s"
          value={usage ? fmtTok(usage.kpis.toolCallsToday) : '…'} sub={usage ? `${fmtTok(usage.kpis.toolCallsTotal)} all-time` : ''} data={usage && last10('tools')} />
        <Kpi label="sessions" tag={{ text: '30d', dim: true }} accent="#e8a06a" delay=".2s"
          value={usage ? usage.kpis.sessions30 : '…'} sub={usage ? `${usage.activeDays} active days` : ''} data={usage && last10('msgs')} />
        <Kpi label="cache saved" tag={{ text: 'est', dim: true }} accent="#3fb96a" delay=".25s"
          value={usage ? '$' + fmtTok(usage.kpis.costSaved) : '…'}
          sub={usage ? `${fmtTok(usage.kpis.cacheReadTok)} cached tok vs uncached` : ''} data={usage && last10('out')} />
      </div>

      <div className="gami-strip">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="gami-lv">{lvl}</div>
          <div>
            <div className="gami-title">Pilot Level {lvl}</div>
            <div className="gami-meta">{usage ? fmtTok(usage.totalMsgs) : '…'} messages all-time</div>
          </div>
        </div>
        <div className="gami-bar-wrap">
          <div className="gami-bar-labels"><span>{xpPct}% to Lv {lvl + 1}</span><span>{usage?.activeDays || 0} active days</span></div>
          <div className="xp-track"><div className="xp-fill" style={{ width: xpPct + '%' }} /></div>
        </div>
        <div className="gami-streak">
          <span className="flame">🔥</span>
          <div><b>{usage ? usage.streak : '…'} day{usage?.streak === 1 ? '' : 's'}</b><span>streak</span></div>
        </div>
      </div>

      <div className="grid-wide">
        <div className="panel" style={{ animationDelay: '.2s', marginBottom: 0 }}>
          <div className="panel-head">
            <h3>Activity <span className="muted">output tokens · 18 wks</span></h3>
            <div className="heat-legend">less<i style={{ background: 'rgba(255,255,255,0.06)' }} /><i style={{ background: 'rgba(217,119,87,0.35)' }} /><i style={{ background: 'rgba(217,119,87,0.6)' }} /><i style={{ background: 'rgba(217,119,87,0.9)' }} />more</div>
          </div>
          {usage ? <Heatmap daily={usage.daily} /> : <p className="muted">{usageErr || 'parsing transcripts…'}</p>}
        </div>
        <div className="panel" style={{ animationDelay: '.25s', marginBottom: 0 }}>
          <h3>Tool usage <span className="muted">all time</span></h3>
          {usage ? <Bars unit="calls" data={usage.tools.map((t, i) => ({ label: t.name.replace(/^mcp__.*__/, 'mcp:'), value: t.count, color: [A, '#e8a06a', '#8b7cf6', '#5eb3f6', '#3fb96a', '#f0b455', '#c98bf6'][i] }))} /> : <p className="muted">…</p>}
        </div>
      </div>

      <div className="grid-2">
        <div className="panel" style={{ animationDelay: '.3s' }}>
          <h3>Most used models <span className="muted">all time</span></h3>
          {usage ? <Bars data={models} unit="msgs" /> : <p className="muted">…</p>}
        </div>
        <div className="panel" style={{ animationDelay: '.35s' }}>
          <h3>Quality distribution <span className="muted">{scored.length} items</span></h3>
          <Bars data={levelDist} unit="items" />
          <p className="small">context: {fmtTok(alwaysTok)} tok always-loaded · biggest on-invoke: {hog ? `${hog.name} (${fmtTok(hog.fullTokens)})` : '—'}</p>
        </div>
      </div>

      <Achievements items={items} usage={usage} hookCount={hookCount} />

      <div className="grid-2" style={{ gridTemplateColumns: '1.2fr 1fr' }}>
        <div className="panel" style={{ animationDelay: '.45s' }}>
          <h3>Top projects</h3>
          <div className="mini-list">
            {top.map((p, i) => (
              <div className="mini-row" key={p.path}>
                <span className="mini-sq" style={{ background: PROJ_COLORS[i % 6] }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mini-name">{p.name}</div>
                  <div className="mini-meta">{p.sessions} sessions{p.commits ? ` · ${p.commits} commits` : ''}</div>
                </div>
                <Spark data={p.usage.spark} color={PROJ_COLORS[i % 6]} h={24} className="" />
                <span className="mini-val">{fmtTok(p.usage.out)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="panel" style={{ animationDelay: '.5s' }}>
          <h3>Recent sessions {pins.length > 0 && <span className="muted">+ {pins.length} pinned</span>}</h3>
          {pins.slice(0, 3).map(p => (
            <div className="sess-row" key={p.sessionId}>
              <span style={{ color: '#e5a03a', flexShrink: 0 }}>★</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mini-name">{p.label || p.title || p.sessionId}</div>
                <div className="mini-meta">{(p.cwd || '').split('/').pop()} · resume from Chat{p.configVersion ? ` · cfg ${p.configVersion}` : ''}</div>
              </div>
            </div>
          ))}
          {usage?.recentSessions.map((s, i) => (
            <div className="sess-row" key={i}>
              <span className="sess-dot" style={{ background: PROJ_COLORS[i % 6] }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mini-name">{s.proj}</div>
                <div className="mini-meta">{fmtTok(s.out)} tok · {s.msgs} msgs · {s.toolCalls} tools</div>
              </div>
              <span className="mini-meta">{ago(s.mtime)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel" style={{ animationDelay: '.55s' }}>
        <div className="panel-head">
          <h3>Inventory <span className="muted">{items.length} items</span></h3>
          <input placeholder="search name, group, tag…" value={q} onChange={e => setQ(e.target.value)} style={{ width: 230 }} />
          <select value={kind} onChange={e => setKind(e.target.value)}><option value="">all kinds</option>{kinds.map(k => <option key={k}>{k}</option>)}</select>
        </div>
        <table className="data inv">
          <thead><tr>{COLS.map(([c, label]) => (
            <th key={c} onClick={() => setSort(s => ({ col: c, dir: s.col === c ? -s.dir : -1 }))}>
              {label}{sort.col === c ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}
            </th>))}</tr></thead>
          <tbody>
            {inv.slice.map(it => (
              <tr key={it.kind + ':' + it.name + ':' + it.scope}>
                <td className="mono" style={{ color: '#eee3da' }}>{it.name}</td>
                <td>{it.kind}</td>
                <td><span className="chip">{it.group}</span></td>
                <td className="tags-cell" onClick={() => editTags(it)} title="click to edit tags">
                  {it.tags.length ? it.tags.map(t => <span className="chip tag" key={t}>{t}</span>) : <span className="muted">+ tag</span>}
                </td>
                <td className="num">{it.descTokens ? fmtTok(it.descTokens) : '—'}</td>
                <td className="num">{it.fullTokens ? fmtTok(it.fullTokens) : '—'}</td>
                <td>{it.score === null ? <span className="muted">—</span> : (
                  <span className="score-cell">
                    <span className="score-track"><span className="score-fill" style={{ width: it.score + '%', background: LEVEL_COLOR[it.level] }} /></span>
                    {it.level} · {it.score}%
                  </span>)}</td>
                <td className="num">{it.specificity === null ? '—' : it.specificity + '%'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {inv.pager}
        <p className="small">levels: static heuristic (frontmatter completeness, trigger clarity, structure, size) — poor &lt;45 · good 45–69 · excellent 70–89 · perfect ≥90. ctx:always = paid every session · on-invoke = full file when triggered (~4 chars/tok)</p>
      </div>
    </div>
  )
}
