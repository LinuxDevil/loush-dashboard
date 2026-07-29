import React, { useEffect, useMemo, useState } from 'react'
import { api, toast } from '../lib/api.js'
import Skeleton from '../ui/Skeleton.jsx'
import { usePager } from '../ui/Pager.jsx'
import { Stagger, CountUp } from '../ui/anim.jsx'

// ---------- 5: capability ROI ledger — fires × always-on cost ----------
// This REPLACES Overview's Inventory static-score columns. A "perfect" 92-scored skill that has never
// fired is worthless; a scruffy 41-scored skill invoked ten times a day is the most valuable file on
// disk. So the metric is fires × cost, not frontmatter completeness.
// Plane B (this machine's own transcripts), self-only by construction.
const MONO = "var(--mono)"
const HEAD = "var(--head)"
const RED = 'var(--red)', GOLD = 'var(--amber)', GREEN = 'var(--green)', BLUE = 'var(--blue)', DIM = 'var(--text-secondary)'
// NEW exists so a capability installed this morning is not labelled DEAD alongside one abandoned a
// year ago — it has not had a chance to fire yet, which is not the same as never firing.
const VERDICT = {
  DEAD: { c: RED, hint: 'never fired, and old enough that it has had the chance — in your context every session, for nothing' },
  COLD: { c: GOLD, hint: 'fired at some point, but not in the last 30 days' },
  NEW: { c: BLUE, hint: 'installed too recently to judge — it has not had a fair chance to fire yet' },
  HOT: { c: GREEN, hint: 'fired in the last 30 days' },
}
const fmtTok = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n)))
const ago = t => { if (!t) return 'never'; const d = Math.round((Date.now() - t) / 86400_000); return d < 1 ? 'today' : d + 'd ago' }

const COLS = [
  ['name', 'Name'], ['kind', 'Kind'], ['scope', 'Scope'], ['alwaysOnTokens', 'Ctx: always'],
  ['fullTokens', 'On invoke'], ['fires30', 'Fires 30d'], ['fires90', 'Fires 90d'], ['last', 'Last fired'],
  ['tokPerFire', 'Tok / fire'], ['verdict', 'Verdict'],
]
const ARCHIVABLE = new Set(['skills', 'commands', 'agents'])

export default function CapabilityLedger() {
  const [d, setD] = useState(null)
  const [sel, setSel] = useState({})       // "kind:name:scope" -> item
  const [verdicts, setVerdicts] = useState({ DEAD: true, COLD: true, NEW: true, HOT: true })
  const [q, setQ] = useState('')
  const [sort, setSort] = useState({ col: 'alwaysOnTokens', dir: -1 })
  const [plan, setPlan] = useState(null)   // dry-run result awaiting confirmation
  const [busy, setBusy] = useState(false)

  const load = () => api.get('/api/capabilities').then(setD).catch(() => {})
  useEffect(() => { load() }, [])

  const rows = useMemo(() => {
    if (!d) return []
    const r = d.items.filter(i => verdicts[i.verdict] && (!q || (i.name + ' ' + i.group).toLowerCase().includes(q.toLowerCase())))
    return r.sort((a, b) => {
      const x = a[sort.col], y = b[sort.col]
      if (x == null) return 1
      if (y == null) return -1
      return sort.dir * (typeof x === 'number' ? x - y : String(x).localeCompare(String(y)))
    })
  }, [d, verdicts, q, sort])
  const pg = usePager(rows, 20)

  if (!d) return <Skeleton tiles={3} rows={10} />
  const h = d.headline
  const idOf = i => `${i.kind}:${i.name}:${i.scope}`
  const chosen = Object.values(sel)
  const reclaim = chosen.reduce((s, i) => s + i.alwaysOnTokens, 0)

  const selectAllDead = () => {
    const next = {}
    for (const i of d.items) if (i.verdict === 'DEAD' && ARCHIVABLE.has(i.kind)) next[idOf(i)] = i
    setSel(next)
  }
  const dryRun = async () => {
    setBusy(true)
    try {
      const r = await api.post('/api/capabilities/archive', { items: chosen.map(i => ({ kind: i.kind, name: i.name, scope: i.scope })), dryRun: true })
      setPlan(r)
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  const apply = async () => {
    setBusy(true)
    try {
      const r = await api.post('/api/capabilities/archive', { items: chosen.map(i => ({ kind: i.kind, name: i.name, scope: i.scope })), dryRun: false })
      toast(`archived ${r.results.filter(x => x.applied).length} · reclaimed ${fmtTok(r.reclaimTokens)} tok/session · backed up and reversible from Harness → Governance → Versions`, 'success')
      setPlan(null); setSel({}); load()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="panel callout danger" style={{ marginBottom: 0 }}>
        <div style={{ font: `600 16px ${HEAD}`, color: 'var(--text-primary)', lineHeight: 1.5 }}>
          You pay <b style={{ color: 'var(--accent)' }}><CountUp value={h.alwaysOnTokens} format={n => Math.round(n).toLocaleString()} /> tok</b> on every session for <b>{d.items.length}</b> capabilities —{' '}
          <b style={{ color: RED }}><CountUp value={h.deadCount} /> of them ({h.deadTokens.toLocaleString()} tok/session) have never fired.</b>
          {h.newCount > 0 && <span style={{ color: BLUE }}> {h.newCount} more {h.newCount === 1 ? 'is' : 'are'} too new to judge — installed less than {h.newAfterDays}d ago.</span>}
        </div>
        <div style={{ display: 'flex', gap: 22, marginTop: 12, flexWrap: 'wrap' }}>
          {[['DEAD', h.deadCount, h.deadTokens], ['COLD', h.coldCount, h.coldTokens], ['NEW', h.newCount || 0, h.newTokens || 0], ['HOT', h.hotCount, h.alwaysOnTokens - h.deadTokens - h.coldTokens - (h.newTokens || 0)]].map(([v, n, tok]) => (
            <div key={v} title={VERDICT[v].hint}>
              <div style={{ font: `600 26px ${MONO}`, lineHeight: 1, color: VERDICT[v].c }}><CountUp value={n} /></div>
              <div style={{ font: `400 10.5px ${MONO}`, letterSpacing: '0.08em', color: DIM, marginTop: 6 }}>{v} · {fmtTok(tok)} tok/session</div>
            </div>
          ))}
          <div style={{ marginLeft: 'auto', font: `400 11px ${MONO}`, color: DIM, maxWidth: 340, lineHeight: 1.6 }}>
            fires counted from your own transcripts over {d.sessions90} sessions in 90d ({d.sessions30} in 30d).
            "tok / fire" = the always-on tax you actually paid per invocation.
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 0 }}>
        <div className="panel-head">
          <h3>The ledger <span className="muted">{rows.length} of {d.items.length}</span></h3>
          {Object.keys(VERDICT).map(v => (
            <button key={v} onClick={() => setVerdicts(s => ({ ...s, [v]: !s[v] }))} title={VERDICT[v].hint}
              style={{ marginTop: 0, cursor: 'pointer', font: `600 11px ${MONO}`, padding: '5px 10px', borderRadius: 6, border: `1px solid ${verdicts[v] ? VERDICT[v].c + '77' : 'var(--bg-surface-active)'}`, background: verdicts[v] ? VERDICT[v].c + '1f' : 'transparent', color: verdicts[v] ? VERDICT[v].c : 'var(--text-tertiary)' }}>
              {v}
            </button>
          ))}
          <input placeholder="search name, group…" value={q} onChange={e => setQ(e.target.value)} style={{ width: 190 }} />
          <button className="mini" style={{ marginTop: 0 }} onClick={selectAllDead}>select all DEAD</button>
        </div>

        {chosen.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 13px', marginBottom: 12, borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--accent-bg)', flexWrap: 'wrap' }}>
            <span style={{ font: `600 13px ${HEAD}`, color: 'var(--text-primary)' }}>{chosen.length} selected</span>
            <span style={{ font: `400 12px ${MONO}`, color: GREEN }}>reclaims {fmtTok(reclaim)} tok / session</span>
            {chosen.some(i => !ARCHIVABLE.has(i.kind)) && <span style={{ font: `400 11px ${MONO}`, color: GOLD }}>· MCP servers are not archivable here — remove them in Harness → MCP</span>}
            <button className="mini" style={{ marginTop: 0, marginLeft: 'auto' }} onClick={() => setSel({})}>clear</button>
            <button className="mini" style={{ marginTop: 0, borderColor: 'var(--accent)', color: 'var(--accent)' }} disabled={busy} onClick={dryRun}>⏏ archive {chosen.length} — dry run first</button>
          </div>
        )}

        {plan && (
          <div style={{ padding: '12px 14px', marginBottom: 12, borderRadius: 6, border: '1px solid var(--amber)', background: 'var(--amber-bg)' }}>
            <div style={{ font: `600 13px ${HEAD}`, color: 'var(--text-primary)', marginBottom: 8 }}>Dry run — nothing has been touched yet</div>
            <div style={{ maxHeight: 200, overflowY: 'auto', font: `400 11px ${MONO}`, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              {plan.results.map((r, i) => (
                <div key={i} style={{ color: r.error ? RED : r.changed ? 'var(--text-primary)' : DIM }}>
                  {r.error ? `✗ ${r.name}: ${r.error}` : r.changed ? `→ remove ${r.kind}/${r.name} (${r.scope}) · ${fmtTok(r.reclaimTokens || 0)} tok · ${r.path || r.target}` : `· ${r.name}: already gone`}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
              <span style={{ font: `400 11px ${MONO}`, color: GREEN }}>reclaims {fmtTok(plan.reclaimTokens)} tok/session · every file is backed up and restorable from Harness → Governance → Versions</span>
              <button className="mini" style={{ marginTop: 0, marginLeft: 'auto' }} onClick={() => setPlan(null)}>cancel</button>
              <button className="mini" style={{ marginTop: 0, borderColor: RED, color: RED }} disabled={busy} onClick={apply}>archive for real</button>
            </div>
          </div>
        )}

        <table className="data inv">
          <thead><tr>
            <th style={{ width: 26 }} />
            {COLS.map(([c, label]) => (
              <th key={c} onClick={() => setSort(s => ({ col: c, dir: s.col === c ? -s.dir : -1 }))}>
                {label}{sort.col === c ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}
              </th>))}
          </tr></thead>
          <Stagger tag="tbody" step={16} max={300}>
            {pg.slice.map(it => {
              const id = idOf(it)
              const v = VERDICT[it.verdict]
              return (
                <tr key={id} style={{ opacity: it.verdict === 'DEAD' ? 1 : 0.86 }}>
                  <td><input type="checkbox" checked={!!sel[id]} disabled={!ARCHIVABLE.has(it.kind)}
                    title={ARCHIVABLE.has(it.kind) ? 'select to archive' : 'MCP servers are managed in Harness → MCP'}
                    onChange={e => setSel(s => { const n = { ...s }; e.target.checked ? (n[id] = it) : delete n[id]; return n })} style={{ width: 13 }} /></td>
                  <td className="mono" style={{ color: 'var(--text-primary)' }}>{it.name}</td>
                  <td>{it.kind}</td>
                  <td><span className="chip">{it.scope}</span></td>
                  <td className="num" style={{ color: it.alwaysOnTokens > 100 ? 'var(--accent-light)' : undefined }}>{it.alwaysOnTokens ? fmtTok(it.alwaysOnTokens) : '—'}</td>
                  <td className="num">{it.fullTokens ? fmtTok(it.fullTokens) : '—'}</td>
                  <td className="num" style={{ color: it.fires30 ? GREEN : DIM }}>{it.fires30 || '—'}</td>
                  <td className="num" style={{ color: it.fires90 ? GREEN : DIM }}>{it.fires90 || '—'}</td>
                  <td className="mono" style={{ color: it.last ? 'var(--text-secondary)' : RED }}>{ago(it.last)}</td>
                  <td className="num" title="always-on tokens × sessions ÷ fires, over 90d">{it.tokPerFire == null ? '—' : fmtTok(it.tokPerFire)}</td>
                  <td><span style={{ font: `700 10px ${MONO}`, letterSpacing: '0.06em', padding: '2px 7px', borderRadius: 5, color: v.c, background: v.c + '1c' }} title={v.hint}>{it.verdict}</span></td>
                </tr>
              )
            })}
          </Stagger>
        </table>
        {pg.pager}
        <p className="small">
          DEAD = never fired, and installed long enough ago to have had the chance. NEW = installed &lt; {d.headline.newAfterDays || 14}d ago,
          so "never fired" would not be a fair verdict yet. COLD = fired, but not in 30d. HOT = fired in 30d.
          "Tok / fire" charges only the sessions that ran AFTER the file existed — it used to bill a day-old skill for 90 days of sessions.
          Archiving moves the file out (backed up, versioned, reversible) — it does not delete your work.
        </p>
      </div>
    </div>
  )
}

// ---------- the static frontmatter linter, DEMOTED out of Overview and reframed ----------
// It used to be "Setup health: 68/100" on the landing page — three panels rendering one static heuristic,
// a linter cosplaying as a metric. It is a perfectly good AUTHORING AID. It is not a measure of value.
// That is now the ledger above.
const LEVEL_COLOR = { poor: RED, good: GOLD, excellent: GREEN, perfect: 'var(--violet)' }
const INV_COLS = [['name', 'Name'], ['kind', 'Kind'], ['origin', 'From'], ['group', 'Group'], ['tags', 'Tags'], ['descTokens', 'Ctx: always'], ['fullTokens', 'On invoke'], ['score', 'Lint'], ['specificity', 'Spec.'], ['health', 'Health']]

// A capability whose frontmatter does not parse still runs — it is just invisible to the
// selector, so its description never reaches the model. That is a quiet failure worth a column.
// A declared MCP server that is not installed is the same class of problem.
function HealthCell({ it }) {
  const bad = (it.fm && it.fm.ok === false) ? it.fm.findings || [] : []
  const missing = it.deps?.missing || []
  if (!bad.length && !missing.length) return <span className="muted">—</span>
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {bad.map(f => (
        <span key={f.code} className="chip" title={`${f.message}${f.fix ? ' — ' + f.fix : ''}`} style={{ color: 'var(--red)', borderColor: 'var(--red)' }}>
          frontmatter
        </span>
      ))}
      {missing.length > 0 && (
        <span className="chip" title={`declares MCP server(s) not installed: ${missing.join(', ')}`} style={{ color: 'var(--amber, #d79921)', borderColor: 'var(--amber, #d79921)' }}>
          missing mcp
        </span>
      )}
    </span>
  )
}

// null origin means we could not attribute the file, which is NOT the same as "the user wrote
// it" — so it renders blank rather than claiming authorship in either direction.
function OriginCell({ origin }) {
  if (!origin?.framework) return <span className="muted">—</span>
  return (
    <span className="chip" title={`${origin.confidence} confidence · ${(origin.basis || []).map(b => b.code).join(', ')}`}>
      {origin.framework}{origin.confidence === 'low' ? '?' : ''}
    </span>
  )
}

export function Inventory() {
  const [data, setData] = useState(null)
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('')
  const [sort, setSort] = useState({ col: 'score', dir: 1 })
  useEffect(() => { api.get('/api/overview').then(setData).catch(() => {}) }, [])
  const items = data?.items || []
  const kinds = useMemo(() => [...new Set(items.map(i => i.kind))], [items])
  const filtered = useMemo(() => {
    const r = items.filter(i => (!kind || i.kind === kind) && (!q || (i.name + ' ' + i.group + ' ' + i.tags.join(' ')).toLowerCase().includes(q.toLowerCase())))
    return r.sort((a, b) => {
      const x = a[sort.col], y = b[sort.col]
      if (x === null) return 1
      if (y === null) return -1
      return sort.dir * (typeof x === 'number' ? x - y : String(x).localeCompare(String(y)))
    })
  }, [items, q, kind, sort])
  const pg = usePager(filtered, 20)
  const editTags = it => {
    const t = prompt(`Tags for ${it.name} (comma-separated):`, it.tags.join(', '))
    if (t === null) return
    api.put('/api/tags', { key: `${it.kind}:${it.name}`, tags: t.split(',').map(s => s.trim()).filter(Boolean) })
      .then(() => api.get('/api/overview').then(setData))
  }
  if (!data) return <Skeleton tiles={0} rows={10} />
  return (
    <div className="panel" style={{ marginBottom: 0 }}>
      <div className="panel-head">
        <h3>Inventory <span className="muted">{items.length} items · authoring aid</span></h3>
        <input placeholder="search name, group, tag…" value={q} onChange={e => setQ(e.target.value)} style={{ width: 220 }} />
        <select value={kind} onChange={e => setKind(e.target.value)}><option value="">all kinds</option>{kinds.map(k => <option key={k}>{k}</option>)}</select>
      </div>
      <table className="data inv">
        <thead><tr>{INV_COLS.map(([c, label]) => (
          <th key={c} onClick={() => setSort(s => ({ col: c, dir: s.col === c ? -s.dir : -1 }))}>
            {label}{sort.col === c ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}
          </th>))}</tr></thead>
        <tbody>
          {pg.slice.map(it => (
            <tr key={it.kind + ':' + it.name + ':' + it.scope}>
              <td className="mono" style={{ color: 'var(--text-primary)' }}>{it.name}</td>
              <td>{it.kind}</td>
              <td><OriginCell origin={it.origin} /></td>
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
              <td><HealthCell it={it} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {pg.pager}
      <p className="small">
        <b>This is a linter, not a metric.</b> "Lint" is a static heuristic over frontmatter completeness, trigger
        clarity, structure and size (poor &lt;45 · good 45–69 · excellent 70–89 · perfect ≥90). A perfect-scoring skill
        that never fires is worthless; a scruffy one invoked daily is your most valuable file. Use it to tidy an item you
        are already writing — use the <b>ROI ledger</b> to decide whether it should exist at all.
      </p>
    </div>
  )
}
