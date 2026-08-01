import React, { useState } from 'react'
import Markdown from '../ui/Markdown.jsx'

// Posts a fixed six-section progress comment to a JIRA ticket, idempotently.
//
// The dry run is the default and there is no way to post without seeing the plan first, because
// this writes to a ticket other people read. The plan says which of create / update / skip /
// refuse would happen, and the body is shown exactly as it would be posted.

const MONO = 'var(--mono)'
const SECTIONS = [
  ['status', 'Status', 'one line — on track, at risk, blocked'],
  ['done', 'Completed', 'one per line'],
  ['inProgress', 'In progress', 'one per line'],
  ['blocked', 'Blocked', 'one per line — leave empty to state that nothing is blocked'],
  ['next', 'Next', 'one per line'],
  ['evidence', 'Evidence', 'PR links, commit shas — one per line'],
]
const ACTION_TONE = { create: 'var(--green)', update: 'var(--blue)', skip: 'var(--text-secondary)', refuse: 'var(--red)' }
const ACTION_TEXT = {
  create: 'will post a new comment — none is there yet',
  update: 'will edit the existing progress comment in place',
  skip: 'nothing to do — the rendered body is identical to what is already posted',
  refuse: 'will not post',
}

export default function ProgressSync() {
  const [key, setKey] = useState('')
  const [vals, setVals] = useState({})
  const [plan, setPlan] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  // A field left untouched is sent as absent, which renders "not determined". A field the user
  // cleared to empty is sent as an empty list, which renders "none". They are different claims
  // and the API keeps them apart, so the UI has to as well.
  const sections = () => {
    const out = {}
    for (const [f] of SECTIONS) {
      const raw = vals[f]
      if (raw === undefined) continue
      out[f] = f === 'status' ? raw : raw.split('\n').map(s => s.trim()).filter(Boolean)
    }
    return out
  }

  const call = async dry => {
    if (!key.trim()) return setErr('a ticket key is required')
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/eng/ticket/${encodeURIComponent(key.trim())}/progress${dry ? '?dryRun=1' : ''}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sections: sections(), dryRun: dry }),
      })
      const j = await r.json()
      if (!r.ok && j.action !== 'refuse') throw new Error(j.error || `HTTP ${r.status}`)
      setPlan({ ...j, posted: !dry && j.ok })
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h3 style={{ marginBottom: 4 }}>Progress comment</h3>
        <p className="small" style={{ margin: 0 }}>
          Six fixed sections, posted once. Re-running edits the same comment rather than adding
          another — the comment carries a marker and a hash of its own body. An unchanged body is
          skipped outright so watchers are not notified for nothing.
        </p>
      </div>

      <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <span className="small" style={{ width: 90 }}>Ticket</span>
        <input value={key} onChange={e => { setKey(e.target.value); setPlan(null) }} placeholder="ABC-123"
          style={{ font: `500 13px ${MONO}`, flex: 1 }} />
      </label>

      {SECTIONS.map(([f, title, hint]) => (
        <label key={f} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="small"><b>{title}</b> <span className="muted">{hint}</span></span>
          {f === 'status'
            ? <input value={vals[f] ?? ''} onChange={e => { setVals(v => ({ ...v, [f]: e.target.value })); setPlan(null) }} />
            : <textarea rows={2} value={vals[f] ?? ''} onChange={e => { setVals(v => ({ ...v, [f]: e.target.value })); setPlan(null) }} />}
          {vals[f] === undefined && <span className="small muted">untouched — will render as “not determined”, which is not the same as “none”</span>}
        </label>
      ))}

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="mini" disabled={busy} onClick={() => call(true)}>{busy ? 'checking…' : 'preview & plan'}</button>
        <button className="mini" disabled={busy || !plan || plan.action === 'skip' || plan.action === 'refuse' || plan.posted}
          title={!plan ? 'preview first — this writes to a ticket other people read' : undefined}
          onClick={() => call(false)}>
          {plan?.action === 'update' ? 'update the comment' : 'post the comment'}
        </button>
      </div>

      {err && <div className="small" style={{ color: 'var(--red)' }}>{err}</div>}

      {plan && (
        <div style={{ border: `1px solid ${ACTION_TONE[plan.action] || 'var(--border-default)'}`, borderRadius: 10, padding: '10px 14px' }}>
          <div style={{ font: `600 12px ${MONO}`, color: ACTION_TONE[plan.action] }}>
            {plan.posted ? (plan.action === 'update' ? 'updated' : 'posted') : plan.action}
            {plan.duplicates?.length > 0 && <span style={{ color: 'var(--amber)' }}> · {plan.duplicates.length} older duplicate(s) left in place: {plan.duplicates.join(', ')}</span>}
          </div>
          <div className="small" style={{ marginTop: 2 }}>{plan.detail || ACTION_TEXT[plan.action] || plan.reason}</div>
          {plan.url && <div className="small" style={{ marginTop: 4 }}><a href={plan.url} target="_blank" rel="noreferrer">open the ticket</a></div>}
          {plan.body && (
            <details style={{ marginTop: 8 }}>
              <summary className="small">the exact body {plan.posted ? 'that was posted' : 'that would be posted'}</summary>
              <Markdown source={plan.body} />
            </details>
          )}
        </div>
      )}
    </div>
  )
}
