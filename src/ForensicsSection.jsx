import React, { useEffect, useMemo, useState } from 'react'
import { api, toast } from './api.js'
import Skeleton from './Skeleton.jsx'

// ---------- 9: session forensics — failure signatures · context pressure · hook blast radius ----------
// Three panels off the ONE extra parse that already lives in the failStats()/scanTranscripts() walkers.
// Plane B: this machine's own transcripts, self-only. No user/machine parameter exists.
const MONO = "'IBM Plex Mono', monospace"
const HEAD = "'Space Grotesk', sans-serif"
const RED = '#e5484d', GOLD = '#e5a03a', GREEN = '#3fb96a', BLUE = '#5eb3f6', DIM = '#8a807a'
const fmtChars = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? Math.round(n / 1000) + 'k' : String(n))
const ago = t => { if (!t) return '—'; const d = Math.round((Date.now() - t) / 86400_000); return d < 1 ? 'today' : d + 'd ago' }
const TREND = { up: ['▲', RED], down: ['▼', GREEN], flat: ['–', DIM] }

// "Cap this tool": a PostToolUse hook that truncates that tool's result. Written straight through the
// existing GET/PUT /api/hooks path (the hook LIBRARY has no truncation pattern — see README).
const capHook = tool => ({
  matcher: tool,
  hooks: [{
    type: 'command', timeout: 10,
    command: `node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const r=JSON.stringify(j.tool_response??'');if(r.length>20000)console.log(JSON.stringify({hookSpecificOutput:{hookEventName:'PostToolUse',additionalContext:'[dashboard] ${tool} result was '+r.length+' chars — truncated to 20k to protect the context window'}}))})"`,
  }],
})

export default function ForensicsSection() {
  const [days, setDays] = useState(30)
  const [d, setD] = useState(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(null)
  const load = () => api.get('/api/forensics?days=' + days).then(setD).catch(() => {})
  useEffect(() => { setD(null); load() }, [days])

  const capTool = async name => {
    if (!confirm(`Install a PostToolUse hook that flags ${name} results over 20k chars?\n\nWritten to ~/.claude/settings.json (backed up first).`)) return
    setBusy(true)
    try {
      const all = await api.get('/api/hooks')
      const hooks = { ...(all.user?.settings?.hooks || {}) }
      hooks.PostToolUse = [...(hooks.PostToolUse || []), capHook(name)]
      await api.put('/api/hooks', { scope: 'user', hooks })
      toast(`capped ${name} · the old settings.json is backed up`, 'success')
      load()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  const disableHook = async h => {
    if (!confirm(`Remove the ${h.event || 'PostToolUse'} hook "${h.hook}" from ~/.claude/settings.json?\n\nBacked up first, restorable from Governance → Versions.`)) return
    setBusy(true)
    try {
      const all = await api.get('/api/hooks')
      const hooks = { ...(all.user?.settings?.hooks || {}) }
      for (const ev of Object.keys(hooks))
        hooks[ev] = (hooks[ev] || []).map(g => ({ ...g, hooks: (g.hooks || []).filter(x => !String(x.command || '').includes(h.hook)) })).filter(g => g.hooks.length)
      await api.put('/api/hooks', { scope: 'user', hooks })
      toast('hook removed · backed up', 'success')
      load()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  const fileBug = async f => {
    setBusy(true)
    try {
      const b = await api.post('/api/bugs', { title: `[${f.tool}] ${f.sig}`.slice(0, 120), severity: f.count >= 10 ? 'high' : 'medium', intake: `Bitten ${f.count}× across ${f.sessions} session(s) since ${new Date(f.first).toLocaleDateString()}.\n\nVerbatim (most recent):\n${f.example}` })
      toast(`filed as bug ${b.id || ''} — open Workflows → Bugs`, 'success')
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }

  const biting = useMemo(() => (d?.failures || []).filter(f => f.biting), [d])
  if (!d) return <Skeleton tiles={3} rows={10} />
  const ctx = d.context
  const worstTool = ctx.tools[0]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <select value={days} onChange={e => setDays(Number(e.target.value))}>
          <option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option>
        </select>
        <span style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>{d.sessions} sessions parsed · plane: this machine only, always</span>
      </div>

      {/* (a) failure signatures */}
      <div className="panel" style={{ marginBottom: 0 }}>
        <div className="panel-head">
          <h3>Failure signatures <span className="muted">{d.failures.length} distinct · {biting.length} have bitten you ≥ 3 times</span></h3>
        </div>
        {d.failures.length === 0 && <p className="small" style={{ marginTop: 0 }}>✓ no tool errors in this window</p>}
        {d.failures.slice(0, 25).map(f => {
          const [tri, tc] = TREND[f.trend]
          const isOpen = open === f.sig
          return (
            <div key={f.sig} style={{ padding: '10px 4px', borderBottom: '1px solid rgba(255,255,255,0.045)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ font: `700 12px ${HEAD}`, minWidth: 34, textAlign: 'right', color: f.biting ? RED : DIM }}>{f.count}×</span>
                <span style={{ font: `600 9.5px ${MONO}`, padding: '2px 7px', borderRadius: 5, color: BLUE, background: BLUE + '1a', flexShrink: 0 }}>{f.tool}</span>
                <span style={{ flex: 1, minWidth: 0, font: "400 12.5px 'IBM Plex Sans'", color: '#c8bdb4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.sig}</span>
                <span title={`${f.recent} recently vs ${f.prior} before`} style={{ font: `600 11px ${MONO}`, color: tc, flexShrink: 0 }}>{tri}</span>
                <span style={{ font: `400 10px ${MONO}`, color: '#6a615a', flexShrink: 0 }}>{f.sessions} sess · last {ago(f.last)}</span>
                <button className="mini" style={{ marginTop: 0 }} onClick={() => setOpen(isOpen ? null : f.sig)}>{isOpen ? 'hide' : 'trace'}</button>
                <button className="mini" style={{ marginTop: 0 }} disabled={busy} onClick={() => fileBug(f)}>file as bug</button>
              </div>
              {isOpen && (
                <pre style={{ margin: '8px 0 0 44px', padding: '10px 12px', borderRadius: 10, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)', font: `400 11px ${MONO}`, color: '#b0a69e', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 180, overflowY: 'auto' }}>
                  {f.example}
                  {'\n\n'}first seen {new Date(f.first).toLocaleString()} · projects: {f.projects.join(', ')}
                </pre>
              )}
            </div>
          )
        })}
        {biting.length > 0 && <p className="small">Anything at 3+ is not bad luck, it is a bug in your setup. The top signature has bitten you <b style={{ color: RED }}>{d.failures[0].count} times</b>.</p>}
      </div>

      {/* (b) context pressure */}
      <div className="grid-2" style={{ marginBottom: 0 }}>
        <div className="panel">
          <div className="panel-head">
            <h3>Context pressure <span className="muted">{fmtChars(ctx.totalChars)} chars pulled in · {ctx.compactions} compactions ({ctx.compactionsPerSession}/session)</span></h3>
          </div>
          {worstTool && (
            <div style={{ font: "400 12.5px 'IBM Plex Sans'", color: '#c8bdb4', marginBottom: 12 }}>
              <b style={{ color: '#f2ebe4' }}>{worstTool.name}</b> is <b style={{ color: worstTool.share > 0.4 ? RED : GOLD }}>{Math.round(worstTool.share * 100)}%</b> of every byte ever pulled into your context.
            </div>
          )}
          <table className="data inv">
            <thead><tr><th>Tool</th><th className="num">Share</th><th className="num">Median</th><th className="num">p90</th><th className="num">Results</th><th /></tr></thead>
            <tbody>
              {ctx.tools.slice(0, 10).map(t => (
                <tr key={t.name}>
                  <td className="mono" style={{ color: t.hog ? GOLD : '#eee3da' }}>{t.name}{t.hog && <span title="median result over 20k chars — this tool is eating your context window" style={{ marginLeft: 6, font: `700 8.5px ${MONO}`, color: GOLD }}>HOG</span>}</td>
                  <td className="num">{Math.round(t.share * 100)}%</td>
                  <td className="num">{fmtChars(t.medianChars)}</td>
                  <td className="num" style={{ color: t.p90Chars > 50000 ? RED : undefined }}>{fmtChars(t.p90Chars)}</td>
                  <td className="num">{t.results}</td>
                  <td><button className="mini" style={{ marginTop: 0 }} disabled={busy} title={`install a PostToolUse hook that flags ${t.name} results over 20k chars`} onClick={() => capTool(t.name)}>cap</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small">"cap" installs a PostToolUse hook in <code>~/.claude/settings.json</code> (backed up) that flags oversized results from that tool.</p>
        </div>

        <div className="panel">
          <h3>Biggest single results <span className="muted">10 worst</span></h3>
          <div className="mini-list">
            {ctx.biggest.map((b, i) => (
              <div className="mini-row" key={i}>
                <span className="mini-sq" style={{ background: b.chars > 100000 ? RED : GOLD }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mini-name">{b.tool}</div>
                  <div className="mini-meta" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.proj?.split('-').slice(-2).join('-')}{b.detail ? ' · ' + b.detail : ''}</div>
                </div>
                <span className="mini-val" style={{ color: b.chars > 100000 ? RED : undefined }}>{fmtChars(b.chars)}</span>
              </div>
            ))}
            {ctx.biggest.length === 0 && <p className="small" style={{ marginTop: 0 }}>nothing recorded</p>}
          </div>
          <h3 style={{ marginTop: 16 }}>Worst sessions <span className="muted">by compaction</span></h3>
          <div className="mini-list">
            {ctx.worstSessions.slice(0, 5).map(s => (
              <div className="mini-row" key={s.sessionId}>
                <span className="mini-sq" style={{ background: s.compactions > 2 ? RED : DIM }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mini-name">{s.proj?.split('-').slice(-2).join('-')}</div>
                  <div className="mini-meta">{s.turns} turns · {s.errors} errors</div>
                </div>
                <span className="mini-val">{s.compactions} ⤵</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* (c) hook blast radius */}
      <div className="panel" style={{ marginBottom: 0 }}>
        <div className="panel-head"><h3>Hook blast radius <span className="muted">{d.hooks.length} hook{d.hooks.length === 1 ? '' : 's'} fired in {days}d</span></h3></div>
        {d.hooks.length === 0 ? <p className="small" style={{ marginTop: 0 }}>no hook activity recorded in this window</p> : (
          <table className="data inv">
            <thead><tr><th>Hook</th><th>Event</th><th className="num">Fired</th><th className="num">Blocks</th><th className="num">Block rate</th><th className="num">p50</th><th className="num">p90</th><th>What it blocked</th><th /></tr></thead>
            <tbody>
              {d.hooks.map(h => (
                <tr key={h.hook + h.event}>
                  <td className="mono" style={{ color: '#eee3da', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.hook}</td>
                  <td>{h.event || '—'}</td>
                  <td className="num">{h.fired}</td>
                  <td className="num" style={{ color: h.blocks ? RED : DIM }}>{h.blocks || '—'}</td>
                  <td className="num" style={{ color: h.blockRate > 0.2 ? RED : DIM }}>{Math.round(h.blockRate * 100)}%</td>
                  <td className="num">{h.p50Ms == null ? '—' : h.p50Ms + 'ms'}</td>
                  <td className="num" style={{ color: h.p90Ms > 2000 ? GOLD : undefined }}>{h.p90Ms == null ? '—' : h.p90Ms + 'ms'}</td>
                  <td style={{ font: `400 10.5px ${MONO}`, color: '#7a716a', maxWidth: 260 }}>
                    {h.examples.length ? h.examples.slice(0, 2).map((e, i) => <div key={i} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.tool}: {e.reason || 'blocked'}</div>) : <span style={{ color: DIM }}>—</span>}
                  </td>
                  <td><button className="mini" style={{ marginTop: 0 }} disabled={busy} onClick={() => disableHook(h)}>disable</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="small">A hook with a high block rate and a high p90 is costing you more than it protects. "disable" removes it from <code>~/.claude/settings.json</code> — backed up, restorable from Governance → Versions.</p>
      </div>
    </div>
  )
}
