import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { convergenceVerdict } from '../../server/board.mjs'

// The stop condition used to be "three fix runs, then block", which gives the same answer for a
// loop that is closing in and one going round in circles. AIR-10733 was the second kind: findings
// 9 → 8 → 9, worst severity critical → high → high, $18.84 spent, and nothing in the system could
// say so. These cases pin the difference.

const f = (severity, over = {}) => ({ severity, class: 'code', status: 'open', summary: 's', seenCount: 1, ...over })
const round = (worst, open) => ({ worst, open })

test('no blocking findings advances, and says what was left behind', () => {
  const v = convergenceVerdict({ rounds: [round(3, 5)], blocking: [], openCode: [f('low'), f('low')], spend: 5, budget: 0 })
  assert.equal(v.action, 'advance')
  assert.match(v.reason, /2 minor/)
})

test('a blocking finding on the first round asks for a fix, not a stop', () => {
  const v = convergenceVerdict({ rounds: [], blocking: [f('critical')], openCode: [f('critical')], spend: 1, budget: 0 })
  assert.equal(v.action, 'fix')
})

test('improving severity keeps going even after several rounds', () => {
  // critical → high → medium: each round strictly better, so it must not be called stalled.
  const v = convergenceVerdict({
    rounds: [round(4, 9), round(3, 8), round(2, 6)],
    blocking: [f('medium')], openCode: [f('medium'), f('low')], spend: 10, budget: 0,
  })
  assert.equal(v.action, 'fix', 'severity falling every round is progress')
})

test('a falling count keeps going even when severity is stuck', () => {
  const v = convergenceVerdict({
    rounds: [round(3, 9), round(3, 7), round(3, 5)],
    blocking: [f('high')], openCode: [f('high'), f('low')], spend: 10, budget: 0,
  })
  assert.equal(v.action, 'fix', 'fewer findings at the same severity is still progress')
})

test('the real AIR-10733 trajectory is called stalled', () => {
  // 9 open / worst critical, then 8 / high, then 9 / high — neither measure improving. The open
  // list has to match what the rounds recorded, or the case is not the trajectory it claims to be.
  const blocking = [f('high', { seenCount: 3 }), f('high', { seenCount: 3 }), f('high', { seenCount: 2 })]
  const openCode = [...blocking, ...Array.from({ length: 6 }, () => f('low'))]
  assert.equal(openCode.length, 9, 'this case is only meaningful if it matches the recorded rounds')
  const v = convergenceVerdict({
    rounds: [round(4, 9), round(3, 8), round(3, 9)],
    blocking, openCode, spend: 18.84, budget: 0,
  })
  assert.equal(v.action, 'stalled')
  assert.match(v.reason, /raised 3\+ times/, 'the repeat count is the evidence a human is needed')
})

test('the cost cap stops the loop before the next run, not after', () => {
  const v = convergenceVerdict({ rounds: [round(4, 2)], blocking: [f('critical')], openCode: [f('critical')], spend: 25, budget: 20 })
  assert.equal(v.action, 'budget')
  assert.match(v.reason, /\$25\.00 .* \$20\.00/)
})

test('the cost cap outranks everything, including a clean review', () => {
  const v = convergenceVerdict({ rounds: [], blocking: [], openCode: [], spend: 30, budget: 20 })
  assert.equal(v.action, 'budget', 'spend is checked first so a runaway ticket cannot slip through on a clean round')
})

test('an absolute round ceiling still applies when each round looks like progress', () => {
  const v = convergenceVerdict({
    rounds: [round(4, 9), round(3, 8), round(2, 7), round(2, 6), round(2, 5)],
    blocking: [f('medium')], openCode: [f('medium')], spend: 10, budget: 0, maxRounds: 5,
  })
  assert.equal(v.action, 'stalled', 'slow progress forever is still a reason to hand over')
})

// ---- the regression that matters ---------------------------------------------------------------
//
// AIR-10733 was promoted to ready-for-qa by a review agent that never ran: `claude -p` hit an
// account session limit, EXITED 0, and printed the notice as its result. No findings could be
// extracted from it, no findings means nothing blocking, and nothing blocking is `advance`.
//
// This exercises the real route rather than the verdict function, because the verdict function was
// never wrong — it was asked a question about an agent that did not exist. It runs in a child
// process with its own HOME (the board file is `~/.claude/taskboard.json`, which is the USER'S real
// board) and a fake `claude` on PATH that reproduces the exact notice off disk.
const BOARD = fileURLToPath(new URL('../../server/board.mjs', import.meta.url))

const CHILD = `
import fs from 'node:fs'
import path from 'node:path'
import mountBoard from ${JSON.stringify(BOARD)}

const claude = path.join(process.env.HOME, '.claude')
const wt = path.join(process.env.HOME, 'wt')
fs.mkdirSync(claude, { recursive: true }); fs.mkdirSync(wt, { recursive: true })
fs.writeFileSync(path.join(claude, 'taskboard.json'), JSON.stringify({ teams: [], projects: {}, tickets: [{
  id: 'tk1', project: path.join(process.env.HOME, 'nope'), title: 'a ticket', desc: 'd', stage: 'code-review',
  branch: 'ticket/x', worktree: wt, findings: [], runs: [], reviewRounds: [], history: [],
}] }))

const routes = {}
mountBoard({ post: (p, h) => { routes[p] = h }, get: () => {}, patch: () => {}, delete: () => {} })
routes['/api/board/tickets/:id/review']({ params: { id: 'tk1' }, body: {} }, { status() { return this }, json() { return this } })

const read = () => JSON.parse(fs.readFileSync(path.join(claude, 'taskboard.json'), 'utf8')).tickets[0]
for (let i = 0; i < 300; i++) {
  await new Promise(r => setTimeout(r, 50))
  const t = read()
  if (t.runs.length) { console.log('RESULT' + JSON.stringify(t)); process.exit(0) }
}
process.exit(3)
`

test('a review that hit an account limit blocks the ticket instead of promoting it', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'board-limit-'))
  const bin = path.join(home, 'bin')
  fs.mkdirSync(bin, { recursive: true })
  // Prints exactly what the real CLI prints when the account is out of session: a normal JSON
  // envelope, a zero exit code, and the notice sitting where the review should be.
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\ncat <<'JSON'\n{"result":"You've hit your session limit · resets 4:20am (Asia/Amman)","total_cost_usd":0.02,"num_turns":1,"session_id":"s1","duration_ms":500}\nJSON\n`, { mode: 0o755 })
  fs.writeFileSync(path.join(home, 'run.mjs'), CHILD)

  const r = spawnSync(process.execPath, [path.join(home, 'run.mjs')], {
    encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` },
  })
  const line = (r.stdout || '').split('\n').find(l => l.startsWith('RESULT'))
  assert.ok(line, `the child never recorded a run: ${r.stdout}\n${r.stderr}`)
  const t = JSON.parse(line.slice('RESULT'.length))

  assert.notEqual(t.stage, 'ready-for-qa', 'a review that never ran cannot pass a ticket to QA')
  assert.equal(t.stage, 'code-review')
  assert.equal(t.blocked?.category, 'agent-unfinished')
  assert.match(t.blocked.reason, /4:20am/, 'the reset time is what tells a human when to re-run')
  assert.equal(t.runs.at(-1).status, 'unfinished', "recorded truthfully — 'ok' is what made this promotable")
  assert.ok(!t.verdict, 'a verdict computed from an agent that did not run is meaningless, so none is written')
  assert.equal((t.reviewRounds || []).length, 0, 'and it is not a round of the convergence history either')
  fs.rmSync(home, { recursive: true, force: true })
})

test('every verdict carries a reason a human can act on', () => {
  const cases = [
    { rounds: [], blocking: [], openCode: [], spend: 0, budget: 0 },
    { rounds: [], blocking: [f('high')], openCode: [f('high')], spend: 0, budget: 0 },
    { rounds: [round(3, 5), round(3, 5), round(3, 5)], blocking: [f('high')], openCode: [f('high')], spend: 0, budget: 0 },
    { rounds: [], blocking: [f('high')], openCode: [f('high')], spend: 99, budget: 1 },
  ]
  for (const c of cases) {
    const v = convergenceVerdict(c)
    assert.ok(v.reason && v.reason.length > 10, `${v.action} must explain itself`)
  }
})
