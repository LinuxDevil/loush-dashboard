import React, { useMemo, useState } from 'react'
import { HEAD, BODY, MONO, BB, GREEN, GOLD, RED, PURPLE, DIM, HI, PANEL, Card, Empty, H1, miniBtn, primaryBtn, useCopy, first, fx } from './ui.jsx'
import { Stagger } from '../ui/anim.jsx'

const KIND = {
  'red-main':             { label: 'RED MAIN',        c: RED,    why: 'main is red — the whole team is blocked' },
  'over-budget':          { label: 'OVER BUDGET',     c: RED,    why: 'past its stage budget' },
  'stale-status':         { label: 'STALE STATUS',    c: GOLD,   why: 'JIRA disagrees with the merged PR' },
  'qa-blocked':           { label: 'QA BLOCKED',      c: RED,    why: 'QA cannot proceed' },
  'pr-no-review':         { label: 'NO REVIEW',       c: GOLD,   why: 'PR open with zero reviews' },
  'no-pr':                { label: 'NO PR',           c: BB,     why: 'active but nothing pushed' },
  'qa-loops':             { label: 'QA LOOPS',        c: GOLD,   why: 'bouncing through QA' },
  'pr-approved-unmerged': { label: 'UNMERGED',        c: PURPLE, why: 'approved and still sitting there' },
  'pr-rework':            { label: 'PR REWORK',       c: GOLD,   why: 'repeated changes requested' },
  'pr-red-checks':        { label: 'RED CHECKS',      c: RED,    why: 'CI failing on the PR' },
  'wip-overload':         { label: 'WIP OVERLOAD',    c: PURPLE, why: 'too many tickets in flight at once' },
}
const SEV = [RED, GOLD, PURPLE]
const isPr = r => /^pr-/.test(r.kind)

export function nudgeFor(r) {
  const who = r.waitingOn?.length ? r.waitingOn.map(w => '@' + w).join(' ') : (r.owner?.login ? '@' + r.owner.login : r.owner?.name || 'team')
  const age = r.ageWorkDays != null ? `${fx(r.ageWorkDays)} working day${r.ageWorkDays === 1 ? '' : 's'}` : ''
  const over = r.overBudgetBy != null ? ` — ${fx(r.overBudgetBy)}d over budget` : ''
  return `${who}: ${r.subject} — ${r.detail}${age ? ` (${age}${over})` : over}. ${r.deepLink || ''}`.trim()
}
const standup = rows => ['*Attention queue* — ' + new Date().toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }), '',
  ...rows.slice(0, 15).map(r => `• [${KIND[r.kind]?.label || r.kind}] ${r.subject}${r.owner ? ` — ${r.owner.name || r.owner.login}` : ''} — ${r.detail}${r.ageWorkDays != null ? ` (${fx(r.ageWorkDays)}d)` : ''}${r.deepLink ? `\n  ${r.deepLink}` : ''}`),
  '', `${rows.length} item${rows.length === 1 ? '' : 's'} in the queue.`].join('\n')

export default function AttentionQueue({ snap, me, mine, setMine, project, onOpenTicket, reload }) {
  const [copy, copied] = useCopy()
  const [busy, setBusy] = useState(null)
  const [gone, setGone] = useState({})
  const [err, setErr] = useState(null)
  const [kind, setKind] = useState('all')
  const [limit, setLimit] = useState(40)
  const [zomb, setZomb] = useState(false)
  const ZOMBIE = 60
  const all0 = (snap.triage || []).filter(r => !gone[r.id])
  const zombies = all0.filter(r => (r.ageWorkDays || 0) > ZOMBIE)
  const rows0 = zomb ? all0 : all0.filter(r => (r.ageWorkDays || 0) <= ZOMBIE)
  const isMine = r => {
    if (!me) return false
    const o = r.owner || {}
    return (me.accountId && o.id === me.accountId) || (me.gh && o.login && o.login.toLowerCase() === me.gh.toLowerCase()) ||
      (me.name && o.name && o.name.toLowerCase() === me.name.toLowerCase()) ||
      (me.gh && (r.waitingOn || []).some(w => w.toLowerCase() === me.gh.toLowerCase()))
  }
  const rows = useMemo(() => rows0.filter(r => (!mine || isMine(r)) && (kind === 'all' || r.kind === kind)), [rows0, mine, kind, me])
  const mineN = rows0.filter(isMine).length
  const kinds = useMemo(() => Object.entries(rows0.reduce((a, r) => ({ ...a, [r.kind]: (a[r.kind] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1]), [rows0])

  const dismiss = r => {
    setGone(g => ({ ...g, [r.id]: 1 }))
    fetch('/api/eng/triage/dismiss', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r.id }) })
      .catch(() => setGone(g => { const n = { ...g }; delete n[r.id]; return n }))
  }
  const write = (r, url, body) => {
    setBusy(r.id); setErr(null)
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(async x => { const d = await x.json(); if (!x.ok) throw new Error(d.error || 'failed'); reload() })
      .catch(e => setErr(`${r.id}: ${e.message}`)).finally(() => setBusy(null))
  }
  const issueOf = k => (snap.issues || []).find(i => i.key === k)
  const sev0 = rows.filter(r => r.severity === 0).length

  return <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <H1 kicker="what needs a human in the next twenty minutes" title="Attention Queue" right={<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <div style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 6, background: 'var(--bg-base)' }}>
        {[[false, `The queue · ${rows0.length}`], [true, `Mine · ${mineN}`]].map(([v, l]) => <button key={String(v)} onClick={() => setMine(v)}
          title={v && !me ? 'set your GitHub handle in the header to resolve "mine"' : undefined}
          style={{ padding: '6px 12px', border: 'none', borderRadius: 7, cursor: 'pointer', font: `600 12px ${BODY}`, background: mine === v ? 'var(--bg-surface-active)' : 'transparent', color: mine === v ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{l}</button>)}
      </div>
      <button style={miniBtn} onClick={() => copy(standup(rows), 'standup')}>{copied === 'standup' ? '✓ copied' : 'Copy standup list'}</button>
    </div>} />

    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <Chip on={kind === 'all'} onClick={() => setKind('all')} c={BB}>all · {rows0.length}</Chip>
      {kinds.map(([k, n]) => <Chip key={k} on={kind === k} onClick={() => setKind(kind === k ? 'all' : k)} c={KIND[k]?.c || DIM}>{KIND[k]?.label || k} · {n}</Chip>)}
      {zombies.length > 0 && <Chip on={zomb} onClick={() => setZomb(z => !z)} c={DIM}
        title={`${zombies.length} items older than ${ZOMBIE} working days — backlog hygiene, not an intervention`}>
        {zomb ? '✓ ' : '+ '}zombies &gt;{ZOMBIE}d · {zombies.length}</Chip>}
      {sev0 > 0 && <span style={{ marginLeft: 'auto', font: `600 11px ${MONO}`, color: RED }}>⚑ {sev0} blocking the whole team</span>}
    </div>
    {err && <div style={{ font: `400 12px ${BODY}`, color: RED }}>{err}</div>}

    <div style={{ ...PANEL, overflow: 'hidden' }}>
      {rows.length === 0 && <Empty text={mine ? 'Nothing is stuck on you. Go build something.' : 'Queue is empty — nothing is stuck. (If that looks wrong, check the provenance strip above.)'} />}
      <Stagger key={`${mine}-${kind}-${zomb}`} step={20} max={280}>
      {rows.slice(0, limit).map(r => {
        const k = KIND[r.kind] || { label: r.kind, c: DIM, why: '' }
        const iss = !isPr(r) && issueOf(r.subjectKey)
        const next = iss?.rec?.next
        return <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderBottom: '1px solid var(--border-subtle)', borderLeft: `3px solid ${SEV[r.severity] || DIM}` }}>
          <span style={{ flexShrink: 0, width: 104, font: `700 9px ${MONO}`, letterSpacing: '0.05em', color: k.c }}>{k.label}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              {r.deepLink
                ? <a href={r.deepLink} target="_blank" rel="noopener noreferrer" style={{ font: `600 13px ${BODY}`, color: HI, textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.subject}</a>
                : <span style={{ font: `600 13px ${BODY}`, color: HI, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.subject}</span>}
              {r.project && <span style={{ font: `600 8px ${MONO}`, padding: '1px 5px', borderRadius: 4, background: 'var(--blue-bg)', color: 'var(--text-secondary)', flexShrink: 0 }}>{r.project}</span>}
              {isMine(r) && <span style={{ font: `600 8px ${MONO}`, padding: '1px 5px', borderRadius: 4, background: 'var(--green-bg)', color: GREEN, flexShrink: 0 }}>MINE</span>}
            </div>
            <div style={{ font: `400 11px ${MONO}`, color: DIM, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {r.owner ? <b style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{r.owner.name || r.owner.login}</b> : <span style={{ color: GOLD }}>unowned</span>}
              {' · '}{r.detail}
              {r.waitingOn?.length ? ` · waiting on ${r.waitingOn.join(', ')}` : ''}
            </div>
          </div>
          <div style={{ flexShrink: 0, textAlign: 'right', width: 84 }}>
            <div style={{ font: `600 14px ${MONO}`, color: r.overBudgetBy != null ? RED : HI }}>{r.ageWorkDays != null ? fx(r.ageWorkDays) + 'd' : '—'}</div>
            <div style={{ font: `400 9px ${MONO}`, color: r.overBudgetBy != null ? RED : DIM }}>{r.overBudgetBy != null ? `+${fx(r.overBudgetBy)}d over` : 'in stage'}</div>
          </div>
          <div style={{ flexShrink: 0, display: 'flex', gap: 6 }}>
            <button className="press" style={miniBtn} onClick={() => copy(nudgeFor(r), r.id)}>{copied === r.id ? '✓ copied' : 'Copy nudge'}</button>
            {snap.writes && isPr(r) && <button className="press" style={primaryBtn} disabled={busy === r.id}
              onClick={() => write(r, `/api/eng/pr/${r.subjectKey.split('#')[1]}/comment?project=${r.project}`, { body: nudgeFor(r) })}>{busy === r.id ? '…' : 'Post nudge'}</button>}
            {snap.writes && next && <button className="press" style={primaryBtn} disabled={busy === r.id}
              onClick={() => write(r, `/api/eng/ticket/${r.subjectKey}/transition?project=${r.project}`, { to: next })}>{busy === r.id ? '…' : `→ ${next}`}</button>}
            {iss && <button className="press" style={miniBtn} onClick={() => onOpenTicket(iss.key)}>Open</button>}
            <button className="press" style={{ ...miniBtn, color: DIM }} title="dismiss for today" onClick={() => dismiss(r)}>✕</button>
          </div>
        </div>
      })}
      </Stagger>
      {rows.length > limit && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '12px 16px' }}>
        <span style={{ font: `400 11px ${MONO}`, color: DIM }}>showing the {limit} most severe of {rows.length}</span>
        <button style={miniBtn} onClick={() => setLimit(l => l + 40)}>Show 40 more</button>
      </div>}
    </div>
    <div style={{ font: `400 11px ${MONO}`, color: DIM }}>
      Sorted severity × age, server-side. Dismiss hides a row until tomorrow (persisted to eng-triage.json).
      {zombies.length > 0 && ` ${zombies.length} item(s) older than ${ZOMBIE} working days are ${zomb ? 'shown' : 'behind the zombies chip'} — they are backlog hygiene, not an intervention.`}
      {!snap.writes && ' Write actions are off — set "writes": true on the project in projects.json to post a nudge or transition a ticket with your own credentials.'}
    </div>

    {}
  </section>
}
const Chip = ({ on, onClick, c, children, title }) => <button onClick={onClick} title={title} style={{ padding: '4px 10px', borderRadius: 7, cursor: 'pointer', font: `600 10px ${MONO}`, letterSpacing: '0.03em', border: `1px solid ${on ? c : 'var(--bg-surface-active)'}`, background: on ? c + '22' : 'transparent', color: on ? c : 'var(--text-secondary)' }}>{children}</button>
