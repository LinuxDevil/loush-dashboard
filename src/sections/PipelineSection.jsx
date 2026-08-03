import React, { useEffect, useRef, useState } from 'react'
import { api, toast } from '../lib/api.js'
import { Card, CardHead, Empty, Spinner, DIM, HI, GREEN, GOLD, RED, STEEL, BB, MONO, BODY, inp, miniBtn, primaryBtn, sel } from '../eng/ui.jsx'
import AgentLive from '../ui/AgentLive.jsx'
import { ValidationPanel } from './TicketSection.jsx'

/**
 * The ticket pipeline, as ONE VERTICAL FLOW.
 *
 * Not panes. Panes were termini — four screens that each ended somewhere, which is the reason this
 * pipeline exists at all. A stage here is a row in a list that goes somewhere.
 *
 * Two things on this page are honesty rules rather than decoration:
 *   - every non-`ok` status shows its REASON in words, next to the badge. A bare "failed" or a
 *     collapsed empty row reads as "there was nothing to do", which is the empty-canvas failure
 *     rendered in pixels;
 *   - `tracked: false` is on the row, never swallowed. It is the only thing separating deliberate
 *     degradation from an artifact that reads as durable and is not.
 *
 * Temporary: this is the surface the runner is driven from while the real Ticket tab absorbs it.
 */

const BADGE = { ok: GREEN, failed: RED, unavailable: GOLD, skipped: STEEL }
const KIND = { route: 'route', agent: 'agent · paid', human: 'human gate' }

const Badge = ({ text, color }) => (
  <span style={{ font: `600 10px ${MONO}`, textTransform: 'uppercase', letterSpacing: '0.06em', color, border: `1px solid ${color}55`, borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap' }}>{text}</span>
)

function StageRow({ row, ws, tkt, onRun, live, onLive, onGrill, blockedOnHuman }) {
  const e = row.entry
  // A human gate with no entry is not "not run" — the runner is reporting `blocked-on-human` and
  // waiting, which is a different thing to say and the only honest one while it is true.
  const waiting = row.kind === 'human' && !e && blockedOnHuman
  const status = row.running ? 'running' : waiting ? 'waiting on you' : e?.status || 'not run'
  const color = row.running ? BB : waiting ? GOLD : BADGE[e?.status] || DIM
  const showLive = live === row.stage

  return (
    <div style={{ borderTop: '1px solid var(--border-default)', padding: '10px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {row.running && <Spinner size={11} />}
        <span style={{ font: `600 13px ${MONO}`, color: HI, minWidth: 118 }}>{row.stage}</span>
        <span style={{ font: `400 10px ${MONO}`, color: DIM }}>{KIND[row.kind]}</span>
        <Badge text={status} color={color} />
        {e && e.tracked === false && (
          <Badge text="not tracked" color={GOLD} />
        )}
        {row.stale && <Badge text="stale" color={GOLD} />}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {row.kind === 'agent' && (
            <button style={miniBtn} onClick={() => onLive(showLive ? null : row.stage)}>{showLive ? 'hide transcript' : 'transcript'}</button>
          )}
          {row.kind === 'human' && (
            <button style={{ ...miniBtn, borderColor: GOLD, color: GOLD }} onClick={onGrill}>{e ? 'reopen grilling' : 'grill →'}</button>
          )}
          {/* Unconditional, on every row: a re-run is always an explicit human action, and the
              poller never takes one. A human gate is exempt — it is ended by a person, not run. */}
          {row.kind !== 'human' && <button style={miniBtn} onClick={() => onRun(row.stage)}>re-run</button>}
        </span>
      </div>

      {/* The reason, in words. A status with no reason on screen is the thing this page exists to
          prevent — an artifact nobody can tell apart from a good one. */}
      {e?.reason && <div style={{ font: `400 12px ${BODY}`, color: e.status === 'ok' ? DIM : color }}>{e.reason}</div>}
      {row.stale?.reason && <div style={{ font: `400 12px ${BODY}`, color: GOLD }}>{row.stale.reason}</div>}
      {!e && !row.running && (
        <div style={{ font: `400 12px ${BODY}`, color: waiting ? GOLD : DIM }}>
          {waiting
            ? 'the run is paused here and will stay paused: this gate ends when you end it, never when the agent decides it is satisfied'
            : `has not run yet${row.hard.length ? ` — waits on ${row.hard.join(', ')}` : ''}`}
        </div>
      )}
      {/* A stage that finished and produced nothing says so, rather than collapsing to a blank row. */}
      {e && e.status === 'ok' && !e.artifacts?.length && (
        <div style={{ font: `400 12px ${BODY}`, color: GOLD }}>ran and wrote no artifact — there was nothing to write, not nothing to do</div>
      )}
      {!!e?.artifacts?.length && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {e.artifacts.map(p => <span key={p} style={{ font: `400 11px ${MONO}`, color: DIM, background: 'var(--bg-inset)', borderRadius: 4, padding: '1px 6px' }}>{p}</span>)}
        </div>
      )}
      {showLive && (
        <div style={{ marginTop: 4 }}>
          <AgentLive
            running={row.running ? { kind: row.stage, startedAt: row.running.startedAt } : null}
            source={{
              live: `/api/ticket/${tkt}/stages/${row.stage}/live?workspace=${encodeURIComponent(ws)}`,
              stop: `/api/ticket/${tkt}/stages/${row.stage}/stop?workspace=${encodeURIComponent(ws)}`,
            }}
          />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// G1 — the grilling
// ---------------------------------------------------------------------------------------------

/**
 * The grilling session, in the app's existing `.drawer-overlay`/`.drawer` chrome — no new component
 * and no new chat engine, because the resumable-conversation machinery already exists server-side.
 *
 * Two things on this panel are the feature rather than decoration:
 *
 *   - *Generate sub-tickets* is live from the first render, including before a single question has
 *     been asked. The human ends the grilling, always; there is no completeness check anywhere for
 *     it to wait on and the agent is never asked whether it is satisfied.
 *   - **The two tiers of "come back tomorrow" are shown separately and always.** The decisions are
 *     in the repo and safe; the conversation is in a session store that can expire. Conflating them
 *     on screen is how a person loses a day's context and believes they lost the decisions too — or,
 *     far worse, restarts a fresh conversation believing it remembers.
 */
function GrillingDrawer({ ws, tkt, onClose, onEnded }) {
  const [s, setS] = useState(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const tail = useRef(null)

  const q = `?workspace=${encodeURIComponent(ws)}`
  const load = () => api.get(`/api/ticket/${encodeURIComponent(tkt)}/grilling${q}`).then(setS).catch(e => setErr(e.message))
  useEffect(() => { load() }, [tkt, ws])
  useEffect(() => { tail.current?.scrollTo(0, tail.current.scrollHeight) }, [s?.turns?.length])

  const send = async answer => {
    setBusy(answer ? 'answering' : 'asking')
    setErr(null)
    try {
      const out = await api.post(`/api/ticket/${encodeURIComponent(tkt)}/grilling/turn`, { workspace: ws, text: answer })
      if (out.error && !out.question) setErr(out.error)
      setText('')
      await load()
    } catch (e) { setErr(e.message) } finally { setBusy(null) }
  }

  const end = async () => {
    setBusy('ending')
    try {
      await api.post(`/api/ticket/${encodeURIComponent(tkt)}/grilling/end`, { workspace: ws })
      toast('grilling ended — decompose can run', 'success')
      onEnded()
      onClose()
    } catch (e) { setErr(e.message); setBusy(null) }
  }

  const turns = s?.turns || []

  return (
    <div className="drawer-overlay" onClick={onClose} style={{ zIndex: 90 }}>
      <div className="drawer" onClick={e => e.stopPropagation()}
        style={{ zIndex: 91, width: 680, maxWidth: '96vw', overflowY: 'auto', background: 'var(--bg-elevated)', padding: '18px 20px 30px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ font: `700 15px ${MONO}`, color: HI }}>grilling · {tkt}</span>
          <Badge text="human gate" color={GOLD} />
          <button onClick={onClose} style={{ ...miniBtn, marginLeft: 'auto', width: 30, height: 28, padding: 0 }}>✕</button>
        </div>

        {s?.blocked && <div style={{ font: `400 12px ${BODY}`, color: RED }}>{s.blocked}</div>}

        {/* Tier 1. Persistent, and first: these files are in the repo and survive everything below. */}
        <div style={{ border: `1px solid ${s?.decisions?.length ? GREEN : GOLD}55`, borderRadius: 8, padding: '8px 11px' }}>
          <div style={{ font: `600 11px ${MONO}`, color: s?.decisions?.length ? GREEN : GOLD }}>
            decisions — safe: written to the repo as they were made, and reviewable in the pull request
          </div>
          {s?.decisions?.length
            ? s.decisions.map(p => <div key={p} style={{ font: `400 11px ${MONO}`, color: DIM, marginTop: 3 }}>{p}</div>)
            : <div style={{ font: `400 11px ${BODY}`, color: GOLD, marginTop: 3 }}>nothing has been decided yet — the first answer is what writes the first ADR</div>}
        </div>

        {/* Tier 2. Said out loud, because a fresh conversation that looks resumed is the failure. */}
        {s?.contextLost && (
          <div style={{ border: `1px solid ${GOLD}`, borderRadius: 8, padding: '8px 11px', font: `400 12px ${BODY}`, color: GOLD }}>
            {s.contextLost}
          </div>
        )}

        {!!s?.gaps?.length && (
          <div style={{ font: `400 11px ${BODY}`, color: DIM }}>
            grilling without: {s.gaps.map(g => `${g.stage} (${g.reason})`).join(' · ')} — a gap you may want to fix before you grill, or may not. Nothing here decides that for you.
          </div>
        )}

        <div ref={tail} style={{ flex: 1, minHeight: 200, maxHeight: '46vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {!turns.length && <Empty text="no questions asked yet" />}
          {turns.map((t, i) => (
            <div key={i} style={{
              alignSelf: t.role === 'human' ? 'flex-end' : 'flex-start', maxWidth: '88%',
              background: t.role === 'human' ? 'var(--bg-inset)' : 'transparent',
              border: `1px solid ${t.role === 'human' ? 'var(--border-default)' : `${BB}55`}`,
              borderRadius: 8, padding: '7px 10px',
            }}>
              <div style={{ font: `600 10px ${MONO}`, color: t.role === 'human' ? DIM : BB, textTransform: 'uppercase' }}>{t.role}</div>
              <div style={{ font: `400 13px/1.55 ${BODY}`, color: HI, whiteSpace: 'pre-wrap' }}>{t.text}</div>
              {!!t.wrote?.length && <div style={{ font: `400 10px ${MONO}`, color: GREEN, marginTop: 4 }}>wrote {t.wrote.join(', ')}</div>}
            </div>
          ))}
        </div>
        <div style={{ font: `400 10px ${BODY}`, color: DIM }}>
          this transcript is best-effort — it lives in the disposable cache, not the repo. The ADRs above are the record.
        </div>

        {err && <div style={{ font: `400 12px ${BODY}`, color: RED }}>{err}</div>}

        <textarea style={{ ...inp, minHeight: 74, resize: 'vertical', font: `400 13px ${BODY}` }}
          placeholder={turns.length ? 'answer the question' : 'the agent asks first — press "ask the first question"'}
          value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) send(text) }} />

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {busy && <Spinner size={12} />}
          <button style={primaryBtn} disabled={!!busy || !!s?.blocked || (!!turns.length && !text.trim())}
            onClick={() => send(turns.length ? text : '')}>
            {turns.length ? 'answer →' : 'ask the first question'}
          </button>
          {/* Live throughout — before the first question, and after every one of them. */}
          <button style={{ ...miniBtn, marginLeft: 'auto', borderColor: GOLD, color: GOLD }} disabled={!!busy || !!s?.blocked} onClick={end}>
            ✓ generate sub-tickets — end the grilling
          </button>
        </div>
        <div style={{ font: `400 11px ${BODY}`, color: DIM }}>
          you end this session, not the agent. It will keep asking for as long as you keep answering.
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// G2 — propose, edit inline, accept
// ---------------------------------------------------------------------------------------------

/**
 * The board's only working HITL review, in this pipeline's shape: propose → the human edits inline →
 * a SEPARATE explicit accept call. Nothing writes `docs/<KEY>/N.md` until that button.
 *
 * `ValidationPanel` and the blast radius sit ABOVE the document, reusing the panel unchanged and for
 * its stated reason: a decomposition always reads as coherent. A dependency on a task that is not in
 * the list, or two unordered tasks writing the same file, look like ordinary prose.
 */
function AcceptPanel({ ws, tkt, onAccepted }) {
  const [p, setP] = useState(null)
  const [md, setMd] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    api.get(`/api/ticket/${encodeURIComponent(tkt)}/decomposition?workspace=${encodeURIComponent(ws)}`)
      .then(d => { setP(d); setMd(d.md ?? null) })
      .catch(e => setErr(e.message))
  }, [tkt, ws])

  if (err) return <Card><div style={{ font: `400 12px ${BODY}`, color: RED }}>{err}</div></Card>
  if (!p) return null
  if (!p.available) return <Card><CardHead title="Accept the split" meta="gate G2" /><Empty text={p.reason} /></Card>

  const blast = p.blastRadius
  const accept = async () => {
    setBusy(true)
    try {
      const out = await api.post(`/api/ticket/${encodeURIComponent(tkt)}/decomposition/accept`, { workspace: ws, md })
      // A `subtickets` stage that is not on this server comes back as an explained entry, not an
      // error — so it is reported in the same words the stage row will show.
      toast(out.entry?.status && out.entry.status !== 'ok' ? out.entry.reason : `accepted — ${out.tasks} task(s) handed to subtickets`, out.entry?.status && out.entry.status !== 'ok' ? 'error' : 'success')
      onAccepted()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <Card>
      <CardHead title="Accept the split" meta={`gate G2 · ${p.path}`}
        right={<Badge text={p.accepted ? 'accepted' : 'proposed — nothing written yet'} color={p.accepted ? GREEN : GOLD} />} />

      <ValidationPanel v={p.validation} />

      {blast && (
        <div style={{ border: `1px solid ${blast.status === 'ok' ? 'var(--border-default)' : GOLD}55`, borderRadius: 10, padding: '9px 13px', marginBottom: 10 }}>
          <div style={{ font: `600 11px ${MONO}`, color: blast.status === 'ok' ? DIM : GOLD }}>blast radius — {blast.status}</div>
          {blast.reason && <div style={{ font: `400 11px ${BODY}`, color: GOLD, marginTop: 4 }}>{blast.reason}</div>}
          {Object.entries(blast.provenance?.counts || {}).map(([f, n]) => (
            <div key={f} style={{ font: `400 11px ${MONO}`, color: n >= 20 ? GOLD : DIM, marginTop: 3 }}>{f} — {n} importer(s)</div>
          ))}
        </div>
      )}

      <textarea style={{ ...inp, minHeight: 320, resize: 'vertical', font: `400 12px/1.6 ${MONO}` }}
        value={md ?? ''} onChange={e => setMd(e.target.value)} />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
        {busy && <Spinner size={12} />}
        <button style={primaryBtn} disabled={busy || !md?.trim()} onClick={accept}>✓ accept — write the sub-tickets</button>
        <button style={miniBtn} onClick={() => setMd(p.md)}>revert my edits</button>
        <span style={{ font: `400 11px ${BODY}`, color: DIM, marginLeft: 'auto' }}>
          your edits are what gets accepted — nothing is written to docs/{tkt}/N.md until you press accept
        </span>
      </div>
    </Card>
  )
}

export default function PipelineSection() {
  const [idx, setIdx] = useState(null)
  const [ws, setWs] = useState('')
  const [input, setInput] = useState('')
  const [tkt, setTkt] = useState('')
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [live, setLive] = useState(null)
  const [grilling, setGrilling] = useState(false)

  useEffect(() => { api.get('/api/ticket/index').then(setIdx).catch(() => setIdx({ workspaces: [] })) }, [])
  useEffect(() => { if (!ws && idx?.workspaces?.length) setWs(idx.workspaces[0].id) }, [idx])

  const load = () => {
    if (!tkt || !ws) return
    api.get(`/api/ticket/${encodeURIComponent(tkt)}/pipeline?workspace=${encodeURIComponent(ws)}`)
      .then(d => { setData(d); setErr(null) })
      .catch(e => { setErr(e.message); setData(null) })
  }

  // The page rebuilds itself from the manifest — nothing about the run lives in browser state, so a
  // reload and a remount are the same thing (spec §3, resumption).
  useEffect(() => {
    if (!tkt || !ws) return
    load()
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  }, [tkt, ws])

  const post = (url, body, label) => api.post(url, { workspace: ws, ...body })
    .then(() => { toast(label, 'success'); load() })
    .catch(e => toast(e.message, 'error'))

  const runStage = stage => post(`/api/ticket/${encodeURIComponent(tkt)}/stages/${stage}/run`, {}, `${stage} started`)
  const autoRun = on => post(`/api/ticket/${encodeURIComponent(tkt)}/pipeline/auto`, { on }, on ? 'auto-advance on' : 'auto-advance paused')

  const stales = data?.staleStages || []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card>
        <CardHead title="Pipeline" meta="one key in, a dossier and sub-tickets out" />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select style={sel} value={ws} onChange={e => setWs(e.target.value)}>
            {(idx?.workspaces || []).map(w => <option key={w.id} value={w.id}>{w.name}{w.jira ? '' : ' (no board)'}</option>)}
          </select>
          <input style={{ ...inp, width: 220 }} placeholder="ABC-1234 or a browse URL" value={input}
            onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && setTkt(input.trim())} />
          <button style={primaryBtn} onClick={() => setTkt(input.trim())}>open</button>
          {data?.available && <button style={miniBtn} onClick={() => autoRun(true)}>▶ auto-advance</button>}
          {data?.auto?.on && <button style={miniBtn} onClick={() => autoRun(false)}>■ pause</button>}
          {!!stales.length && <button style={miniBtn} title={`re-runs only the badged stages: ${stales.join(', ')}`}
            onClick={() => stales.forEach(runStage)}>⟳ re-run stale ({stales.length})</button>}
        </div>
        {err && <div style={{ marginTop: 10, font: `400 12px ${BODY}`, color: RED }}>{err}</div>}
      </Card>

      {!tkt && <Card><Empty text="open a ticket key to see its pipeline" /></Card>}

      {data && !data.available && <Card><Empty text={data.reason} /></Card>}

      {data?.available && (
        <Card>
          <CardHead
            title={data.key}
            meta={data.dir}
            right={<Badge text={data.next?.reason || data.next?.do || '—'} color={data.next?.reason === 'all-done' ? GREEN : data.next?.reason === 'blocked-on-human' ? GOLD : BB} />}
          />
          {/* Both of these change what a reader may believe about every artifact below, so they are
              persistent panels rather than toasts. */}
          {data.tracked === false && (
            <div style={{ font: `400 12px ${BODY}`, color: GOLD, marginBottom: 8 }}>
              this workspace is not a git repo — the dossier is written but not tracked: not reviewable in a pull request, does not survive a machine wipe, does not travel with a clone
            </div>
          )}
          {data.refusesRun && (
            <div style={{ font: `400 12px ${BODY}`, color: RED, marginBottom: 8 }}>
              the run is halted by `{data.refusesRun.stage}` ({data.refusesRun.signal}): {data.refusesRun.reason}
            </div>
          )}
          {data.auto?.stopped && (
            <div style={{ font: `400 12px ${BODY}`, color: DIM, marginBottom: 8 }}>
              auto-advance stopped: {data.auto.stopped.reason}{data.auto.stopped.stage ? ` at \`${data.auto.stopped.stage}\`` : ''}{data.auto.stopped.detail ? ` — ${data.auto.stopped.detail}` : ''}
            </div>
          )}
          {data.stages.map(row => (
            <StageRow key={row.stage} row={row} ws={ws} tkt={data.key} onRun={runStage} live={live} onLive={setLive}
              onGrill={() => setGrilling(true)} blockedOnHuman={data.next?.reason === 'blocked-on-human'} />
          ))}
        </Card>
      )}

      {/* G2 appears as soon as there is a split to look at, and says so when there is not. */}
      {data?.available && data.stages.some(r => r.stage === 'decompose' && r.entry?.status === 'ok') && (
        <AcceptPanel ws={ws} tkt={data.key} onAccepted={load} />
      )}

      {grilling && data?.available && (
        <GrillingDrawer ws={ws} tkt={data.key} onClose={() => setGrilling(false)} onEnded={load} />
      )}
    </div>
  )
}
