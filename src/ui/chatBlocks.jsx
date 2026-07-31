// Chat transcript rendering: stream events → blocks → DOM.
//
// Extracted from ChatSection.jsx so that message rendering has ONE owner. Three callers now share
// it: the chat section, QuickActions (one-shot `claude -p` runs), and Deep Research, which reuses
// the tool-call feed. Anything that changes how a turn LOOKS belongs here; anything about session
// lifecycle, launching, or transport stays in ChatSection.
//
// The message-rendering VOCABULARY here — a `View thinking process` disclosure, a per-message
// `who · time` header, an asymmetric user/assistant width, expandable tool results, a pending
// bar, a running session cost — is modelled on Odysseus (AGPL-3.0). It was written from Odysseus's
// bundled demo recording (`docs/chat.webm`, frames pulled with ffmpeg) and from the capability
// description in `docs/plan-odysseus-features.md`; no Odysseus source was read. Per the `NOTICE`
// file that means clause 1 does not attach to this file — the wording follows the precedent set in
// `lib/chat-protocol.mjs`. This file is AGPL-3.0 regardless, as the whole program is.
//
// Modified 2026-07-31: added thinking/redacted-thinking blocks, message headers, tool-result
// disclosures, the pending bar, and SessionCostPill.

import React, { useState } from 'react'
import Markdown from './Markdown.jsx'
import { extractTokenBudget, renderToolCall } from '../../lib/chat-render.mjs'
import { api, fmtDate } from '../lib/api.js'

const short = (v, n = 200) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > n ? s.slice(0, n) + '…' : s
}

export function buildBlocks(events) {
  const blocks = [], byToolId = {}
  const target = ev => (ev.parent_tool_use_id && byToolId[ev.parent_tool_use_id]?.children) || blocks
  for (const ev of events) {
    if (ev.type === 'user' && Array.isArray(ev.message?.content)) {
      for (const c of ev.message.content)
        if (c.type === 'tool_result' && byToolId[c.tool_use_id]) {
          const b = byToolId[c.tool_use_id]
          b.result = short(c.content, 400)
          b.isError = c.is_error === true || ev.toolUseResult?.status === 'error' || ev.toolUseResult?.interrupted === true
          if (ev.toolUseResult && typeof ev.toolUseResult === 'object') b.toolResult = ev.toolUseResult
        }
        else if (c.type === 'text') target(ev).push({ kind: 'user', text: c.text, ts: ev.timestamp || null })
        else if (c.type === 'image' && c.source?.data) target(ev).push({ kind: 'user-image', src: `data:${c.source.media_type};base64,${c.source.data}`, ts: ev.timestamp || null })
    } else if (ev.type === 'user') {
      target(ev).push({ kind: 'user', text: String(ev.message?.content ?? ''), ts: ev.timestamp || null })
    } else if (ev.type === 'assistant' && Array.isArray(ev.message?.content)) {
      let usageLeft = ev.message?.usage || null
      for (const c of ev.message.content) {
        if (c.type === 'text' && c.text.trim()) target(ev).push({ kind: 'text', text: c.text, ts: ev.timestamp || null, model: ev.message?.model || null })
        // Extended thinking. Both shapes used to fall through this loop and vanish, so a turn that
        // reasoned and then called one tool rendered as the tool call alone. `redacted_thinking`
        // carries no readable text — only an encrypted `data` blob — and is kept as an explicit
        // block so the transcript shows that thinking HAPPENED rather than showing nothing.
        else if (c.type === 'thinking' && String(c.thinking ?? '').trim()) target(ev).push({ kind: 'thinking', text: c.thinking, ts: ev.timestamp || null, model: ev.message?.model || null })
        else if (c.type === 'redacted_thinking') target(ev).push({ kind: 'thinking', text: '', redacted: true, ts: ev.timestamp || null, model: ev.message?.model || null })
        else if (c.type === 'tool_use') {
          const b = { kind: 'tool', id: c.id, name: c.name, input: c.input, ts: ev.timestamp || null, usage: usageLeft, children: c.name === 'Task' || c.name === 'Agent' ? [] : null }
          usageLeft = null
          byToolId[c.id] = b
          target(ev).push(b)
        }
      }
    } else if (ev.type === 'result') {
      blocks.push({ kind: 'turn-end', ms: ev.duration_ms, cost: ev.total_cost_usd })
    } else if (ev.type === 'stderr') {
      blocks.push({ kind: 'stderr', text: ev.text })
    } else if (ev.type === 'closed') {
      blocks.push({ kind: 'closed', code: ev.code, error: ev.error })
    }
  }
  return blocks
}

function ReviewButtons({ text, chatId, cwd }) {
  const [done, setDone] = useState(null)
  const record = verdict => { setDone(verdict); api.post('/api/chat-review', { chatId, cwd, verdict, text }).catch(() => setDone(null)) }
  if (done) return <div className="dim" style={{ font: "400 10px var(--mono)", padding: '1px 8px 4px' }}>{done === 'accept' ? '✓ accepted' : '✗ rejected'} · logged</div>
  return (
    <div style={{ display: 'flex', gap: 6, padding: '1px 8px 4px' }}>
      <button className="mini" style={{ marginTop: 0 }} title="record: reviewed & accepted" onClick={() => record('accept')}>✓ accept</button>
      <button className="mini" style={{ marginTop: 0 }} title="record: reviewed & rejected" onClick={() => record('reject')}>✗ reject</button>
    </div>
  )
}

/**
 * `You · 09:26 PM` / `<model> · 09:26 PM` above a message body.
 *
 * Returns null when the timestamp is missing or unparseable. An event with no `timestamp` is
 * normal — replayed frames and synthesised user turns have none — and a header reading
 * "You · Invalid Date" is worse than no header at all. The full date lives in the tooltip, so a
 * transcript spanning midnight is still readable without spending a line on the date.
 */
function MessageHead({ who, ts }) {
  const at = ts == null ? NaN : new Date(ts).getTime()
  if (!Number.isFinite(at)) return null
  const time = new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return <div className="chat-msghead" title={fmtDate(at)}>{who} · {time}</div>
}

export function Block({ b }) {
  if (b.kind === 'user') return <div className="chat-msg user"><MessageHead who="You" ts={b.ts} />{b.text}</div>
  if (b.kind === 'user-image') return <div className="chat-msg user" style={{ padding: 4 }}><img src={b.src} alt="attachment" style={{ maxWidth: 280, maxHeight: 220, borderRadius: 8, display: 'block' }} /></div>
  if (b.kind === 'text') return (
    <div className="chat-msg assistant">
      <MessageHead who={b.model || 'assistant'} ts={b.ts} />
      <Markdown source={b.text} />
    </div>
  )
  if (b.kind === 'thinking') return (
    <details className="chat-thinking">
      <summary>{b.redacted ? 'Thinking — redacted by the provider' : 'View thinking process'}</summary>
      <div className="chat-thinking-body">
        {b.redacted
          ? 'The model reasoned here, but the provider returned this block encrypted. There is no text to show — this is not an empty turn.'
          : b.text}
      </div>
    </details>
  )
  if (b.kind === 'stderr') return <div className="chat-line err">{b.text}</div>
  if (b.kind === 'closed') return <div className="chat-line err">session ended{b.error ? ` — ${b.error}` : b.code ? ` (exit ${b.code})` : ''}</div>
  if (b.kind === 'turn-end') return <div className="chat-line dim">◦ turn done {b.ms ? `· ${(b.ms / 1000).toFixed(1)}s` : ''} {b.cost ? `· $${b.cost.toFixed(3)}` : ''}</div>
  if (b.kind === 'tool' && b.children) {
    const agent = b.input?.subagent_type || 'agent'
    return (
      <details className="chat-agent">
        <summary>◆ {agent} — {b.input?.description || b.input?.prompt?.slice(0, 80) || 'subagent'} <span className="dim">({b.children.length} events)</span></summary>
        <div className="chat-agent-body">
          {b.children.map((c, i) => <Block key={i} b={c} />)}
          {b.result && <div className="chat-line dim">↳ {b.result}</div>}
        </div>
      </details>
    )
  }
  if (b.kind === 'tool') {
    // The shared summariser knows each tool's arguments — "Read src/App.jsx" instead of the
    // first key that happens to be present. It is also where the rule lives that tool input
    // VALUES are never echoed, since a Bash command can carry a token.
    const r = renderToolCall({ message: { content: [{ type: 'tool_use', name: b.name, input: b.input }] } })
    const headline = r?.summary && r.kind !== 'unknown'
      ? r.summary
      : short(b.input?.command || b.input?.file_path || b.input?.pattern || b.input?.prompt || b.input, 120)
    const cls = 'chat-line tool' + (b.isError ? ' err' : '')
    const label = <>▸ <b>{b.name}</b> <span className="dim">{short(headline, 160)}</span></>
    // With a result it becomes a disclosure. The old markup clipped the result to 80px of
    // overflow:hidden, which made everything past the first few lines unreachable — the one thing
    // you open a tool call to read.
    if (b.result == null) return <div className={cls} title={r?.title || b.name}>{label}</div>
    return (
      <details className={cls + ' chat-tool'} title={r?.title || b.name}>
        <summary>{label}</summary>
        <div className="chat-tool-result">{b.result}</div>
      </details>
    )
  }
  return null
}

/**
 * Live context occupancy for the running turn.
 *
 * Renders "— of ?" rather than a bar when the model's window is unknown: the token count is a
 * real measurement, but without a denominator a percentage would be invented. An over-100 reading
 * is shown as-is, because it means our window figure for that model is wrong.
 */
export function ContextPill({ events }) {
  let budget = null
  for (let i = events.length - 1; i >= 0; i--) {
    const b = extractTokenBudget(events[i])
    if (b.used != null) { budget = b; break }
  }
  if (!budget) return null
  const k = n => (n >= 1000 ? (n / 1000).toFixed(n >= 10_000 ? 0 : 1) + 'k' : String(n))
  if (!budget.known)
    return (
      <span className="pill dim" title={`context window for "${budget.model || 'this model'}" is not known to this dashboard (${budget.reason}) — the token count is real, the percentage would not be`}>
        ctx {k(budget.used)} / ?
      </span>
    )
  const pct = budget.percent
  const tone = pct >= 90 ? 'err' : pct >= 70 ? 'warn' : ''
  return (
    <span className={'pill ' + tone} title={`${budget.used.toLocaleString()} of ${budget.window.toLocaleString()} tokens on the last turn · ${budget.model}${budget.over ? ' · over the window we have recorded for this model' : ''}`}>
      ctx {k(budget.used)} / {k(budget.window)} · {pct.toFixed(pct < 10 ? 1 : 0)}%{budget.over ? ' ⚠' : ''}
    </span>
  )
}

/**
 * Cumulative cost of the session, summed from `turn-end` blocks.
 *
 * The per-turn figure is already on each `turn-end` line; what you actually want to know mid-session
 * is the total, and adding up a scrolled-away column of numbers is not something a reader should be
 * asked to do. Renders nothing until at least one turn has reported a cost, so a session on a plan
 * that reports no cost shows no misleading `$0.000`.
 */
export function SessionCostPill({ blocks }) {
  let total = 0, turns = 0
  for (const b of blocks || []) if (b.kind === 'turn-end' && typeof b.cost === 'number') { total += b.cost; turns++ }
  if (!turns) return null
  return <span className="pill" title={`cumulative cost of ${turns} turn${turns === 1 ? '' : 's'} in this session`}>${total.toFixed(3)}</span>
}

function capture(text) {
  const kind = prompt('Capture as: command / skill / prompt / note', 'command')
  if (!kind) return
  const done = p => p.then(r => alert('saved' + (r.path ? ' → ' + r.path : ''))).catch(e => alert(e.message))
  if (kind === 'command' || kind === 'skill') {
    const name = prompt(`${kind} name:`)
    if (!name) return
    const content = kind === 'command'
      ? `---\ndescription: captured from a chat session\n---\n\n${text}\n\n$ARGUMENTS\n`
      : `---\nname: ${name}\ndescription: captured from a chat session\n---\n\n${text}\n`
    done(api.post(`/api/res/${kind}s`, { scope: 'user', name, content }))
  } else if (kind === 'prompt') {
    done(api.post('/api/prompts', { title: text.slice(0, 60), tags: ['captured'], inputs: [{ type: 'text', value: text }] }))
  } else {
    done(api.post('/api/notes', { title: text.slice(0, 40), content: text }))
  }
}

const Cap = ({ text, children }) => (
  <div className="cap-wrap">
    {children}
    <button className="cap-btn" title="capture as command / skill / prompt / note" onClick={() => capture(text)}>⤴</button>
  </div>
)

/**
 * The transcript itself — the CONTENTS of `.chat-log`, not the wrapper. ChatSection owns the
 * wrapper because it switches between this, the plan graph, the context timeline and the activity
 * tree; this owns everything inside the chat view.
 *
 * `gap` is load-bearing: a client that reconnected past the retained buffer is told so inline,
 * because a silently truncated transcript reads as a complete one.
 */
export function MessageLog({ blocks, gap, busy, chatId, cwd }) {
  return (
    <>
      {gap && (
        <div className="chat-line err" title={`this client last saw seq ${gap.from}; the server's retained log now starts at seq ${gap.earliestSeq}`}>
          ⚠ reconnected past the retained history — {gap.earliestSeq - gap.from - 1} event(s) between seq {gap.from + 1} and {gap.earliestSeq - 1} are gone
          {gap.dropped ? ` (${gap.dropped} dropped on this run in total)` : ''}. What follows is not the whole session.
        </div>
      )}
      {blocks.map((b, i) => (b.kind === 'user' || b.kind === 'text')
        ? <Cap key={i} text={b.text}><Block b={b} />{b.kind === 'text' && <ReviewButtons text={b.text} chatId={chatId} cwd={cwd} />}</Cap>
        : <Block key={i} b={b} />)}
      {busy && (
        <div className="chat-pending" role="status" aria-live="polite">
          <span className="chat-pending-label">Working</span>
          <span className="chat-pending-bar" aria-hidden="true" />
        </div>
      )}
    </>
  )
}
