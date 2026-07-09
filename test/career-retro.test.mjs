import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ticketRetro } from '../career-retro.mjs'

const base = {
  ticket: { id: 'AIR-42', title: 'Ship X', estimateDays: 3,
    history: [
      { stage: 'in-progress', at: Date.parse('2026-07-01') },
      { stage: 'code-review', at: Date.parse('2026-07-03') },
      { stage: 'ready-for-qa', at: Date.parse('2026-07-04') },
    ] },
  prs: [{ number: 10, title: 'AIR-42 do X', mergedAt: '2026-07-04' }],
  bugs: [{ id: 'B1', ticket: 'AIR-42', escaped: true }, { id: 'B2', ticket: 'AIR-99', escaped: true }],
}

test('a ticket with a confident session link shows sessions', () => {
  const r = ticketRetro({ ...base,
    sessions: [{ id: 's1', branch: 'feature/AIR-42-x', first_prompt: 'work on AIR-42' }] })
  assert.equal(r.sessionsShown, true)
  assert.equal(r.sessions.length, 1)
})

test('a ticket with no reliable link renders with sessionsShown===false and omits session data', () => {
  const r = ticketRetro({ ...base,
    sessions: [{ id: 's2', branch: 'feature/other', first_prompt: 'unrelated task' }] })
  assert.equal(r.sessionsShown, false)
  assert.deepEqual(r.sessions, [])            // not fabricated
  // the rest of the retro still renders
  assert.equal(r.escapedBugs, 1)              // only AIR-42's escaped bug counts
  assert.ok(r.cycleByPhase['in-progress'] > 0)
})

test('a prompt-only mention is too weak to show sessions (avoid a guessed join)', () => {
  const r = ticketRetro({ ...base,
    sessions: [{ id: 's3', branch: 'feature/misc', first_prompt: 'maybe touch AIR-42 later' }] })
  assert.equal(r.sessionsShown, false)
})

test('estimateVsActual and reopened are computed from history', () => {
  const reopened = { ...base.ticket, history: [
    { stage: 'in-progress', at: Date.parse('2026-07-01') },
    { stage: 'ready-for-qa', at: Date.parse('2026-07-02') },
    { stage: 'fixing', at: Date.parse('2026-07-03') },       // sent back = reopened
    { stage: 'ready-for-qa', at: Date.parse('2026-07-04') },
  ] }
  const r = ticketRetro({ ticket: reopened, prs: [], bugs: [], sessions: [] })
  assert.equal(r.reopened, 1)
  assert.equal(r.estimateVsActual.estimateDays, 3)
})

test('never throws on empty/garbage input', () => {
  assert.doesNotThrow(() => ticketRetro({}))
  const r = ticketRetro({})
  assert.equal(r.sessionsShown, false)
})
