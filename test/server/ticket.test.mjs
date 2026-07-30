
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { normalizeKey, detectCapabilities, capabilityPrompt } from '../../server/ticket.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

test('accepts the forms a human actually pastes', () => {
  for (const [input, want] of [
    ['ABC-1234', 'ABC-1234'],
    ['abc-1234', 'ABC-1234'],
    ['  ABC-1234  ', 'ABC-1234'],
    ['ABC 1234', 'ABC-1234'],
    ['ABC_1234', 'ABC-1234'],
    ['abc.1234', 'ABC-1234'],
    ['<ABC-1234>', 'ABC-1234'],
    ['(ABC-1234)', 'ABC-1234'],
    ['ABC-1234:', 'ABC-1234'],
    ['https://team.atlassian.net/browse/ABC-1234', 'ABC-1234'],
    ['https://team.atlassian.net/browse/ABC-1234?filter=10001', 'ABC-1234'],
    ['https://team.atlassian.net/jira/software/projects/ABC/boards/1?selectedIssue=ABC-77', 'ABC-77'],
    ['A1B2-9', 'A1B2-9'],
  ]) assert.equal(normalizeKey(input), want, `${input} -> ${want}`)
})

test('refuses rather than guesses', () => {
  for (const bad of ['', '   ', '1234', 'ABC', 'ABC-', '-1234', 'nonsense', 'ABC-12x', null, undefined, '1ABC-2'])
    assert.equal(normalizeKey(bad), null, JSON.stringify(bad))
})

test('key normalization is idempotent', () => {
  const once = normalizeKey('abc 1234')
  assert.equal(normalizeKey(once), once)
})

test('server/eng.mjs does not import the plane-B agent or clone modules', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/eng.mjs'), 'utf8')
  for (const banned of ['lib/agent.mjs', 'lib/clone.mjs', 'server/ticket.mjs', './ticket.mjs']) {
    assert.ok(!new RegExp(`^\\s*import[^\\n]*${banned.replace(/[./]/g, '\\$&')}`, 'm').test(src),
      `server/eng.mjs must not import ${banned} — that would put agent sessions and cost into plane A`)
  }
})

test('server/ticket.mjs never re-implements JIRA auth — it reuses the plane-A fetch path', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/ticket.mjs'), 'utf8')
  assert.ok(/from '\.\/eng\.mjs'/.test(src), 'ticket.mjs imports the shared ticket fetch from eng.mjs')
  assert.ok(!/Buffer\.from\([^)]*:\s*\$\{?token/.test(src), 'ticket.mjs must not build its own Basic auth header')
})

test('the design prompt demands cited findings — the property that separates a design from a guess', () => {
  const p = fs.readFileSync(path.join(ROOT, 'server/prompts/design-plan.md'), 'utf8')
  assert.ok(/file:line/.test(p), 'requires file:line citations')
  assert.ok(/at least one entry you could not verify/i.test(p), 'requires an unverified-risks entry')
  assert.ok(/Never invent a file path/i.test(p), 'forbids invented paths')
})

test('cfgFor coerces its argument — a repeated ?project= query must not crash the process', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/eng.mjs'), 'utf8')
  const line = src.split('\n').find(l => /^const cfgFor =/.test(l))
  assert.ok(line, 'cfgFor is defined')
  assert.ok(/String\(key \?\? ''\)/.test(line), 'cfgFor must String()-coerce before .toUpperCase()')
  assert.ok(!/\(key \|\| ''\)\.toUpperCase/.test(src), 'the uncoerced form must not reappear')
})

test('a regeneration over an existing graph writes `pending`, never `graph` directly', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/ticket.mjs'), 'utf8')
  assert.ok(/const isFirst = !s\.graph\?\.nodes\?\.length/.test(src), 'first-generation is distinguished from a regeneration')
  assert.ok(/next\.pending = \{/.test(src), 'a regeneration parks the merged graph in `pending`')
  assert.ok(/\/design\/rederive/.test(src), 'an explicit apply/discard route exists')
})

test('the board handoff carries a two-way link, not a one-way paste', () => {
  const ticket = fs.readFileSync(path.join(ROOT, 'server/ticket.mjs'), 'utf8')
  const board = fs.readFileSync(path.join(ROOT, 'server/board.mjs'), 'utf8')
  assert.ok(/jiraKey: r\.key/.test(ticket), 'the handoff sends jiraKey')
  assert.ok(/designDoc: s\.doc\?\.rel/.test(ticket), 'the handoff sends the design doc path')
  assert.ok(/jiraKey: typeof jiraKey === 'string'/.test(board), 'the board persists jiraKey')
  assert.ok(/board: \{ id: t\.id/.test(ticket), 'our state records the board ticket id')
})

test('the assistant proposes ops and never writes the graph itself', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/ticket.mjs'), 'utf8')
  const chat = src.slice(src.indexOf("app.post('/api/ticket/:key/design/chat'"), src.indexOf("app.get('/api/ticket/:key/design/mermaid'"))
  assert.ok(/parseOps\(out\.result\)/.test(chat), 'the chat route parses an op list out of the reply')
  const writes = chat.match(/writeState\(/g) || []
  assert.equal(writes.length, 1, 'exactly one write, and it is the session pointer')
  assert.ok(/chat: \{ sessionId: out\.sessionId, cwd \}/.test(chat), 'that write stores only the pointer')
})

test('the chat persists a session pointer, not a transcript', () => {
  const code = fs.readFileSync(path.join(ROOT, 'server/ticket.mjs'), 'utf8')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  for (const banned of [/transcript\s*[:=]/, /messages\s*:\s*\[/, /events\s*:\s*run\.events(?!\.length)/]) {
    assert.ok(!banned.test(code), `no transcript is persisted (${banned}) — the CLI already keeps one on disk`)
  }
  assert.ok(/chat: \{ sessionId: out\.sessionId, cwd \}/.test(code))
})

test('the agent writes to a staging path, promoted only on a clean exit', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/ticket.mjs'), 'utf8')
  assert.ok(/const stageRel = /.test(src), 'a staging path is derived')
  assert.ok(/designPrompt\(d, repo\.repo, repo\.dir, stageRel\)/.test(src), 'the agent is told to write to the staging path, not the final one')
  assert.ok(/const clean = !run\.cancelled && !error/.test(src), 'promotion is conditional on a clean exit')
  const promote = src.split('\n').find(l => /renameSync\(stageAbs, abs\)/.test(l))
  assert.ok(promote, 'staging is renamed to the final path')
  assert.ok(/if \(clean\)/.test(promote), 'and that rename is guarded by the clean-exit check')
  assert.ok(/else partial =/.test(src), 'anything else is reported as partial')
  assert.ok(!/unlinkSync\(stageAbs\)/.test(src), 'a partial document is never auto-deleted')
})

test('the partial-delete route derives its path and never accepts one', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/ticket.mjs'), 'utf8')
  const route = src.slice(src.indexOf("app.delete('/api/ticket/:key/design/partial'"), src.indexOf('// ---- re-extract'))
  assert.ok(/run\.partial\.path/.test(route), 'the path comes from server-held run state')
  assert.ok(!/req\.body|req\.query\.path/.test(route), 'no client-supplied path — this must not become an arbitrary-delete endpoint')
})

test('only one design agent may run in a given repository', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/ticket.mjs'), 'utf8')
  assert.ok(/const sameRepo = live\.filter\(writesRepo\)\.find\(x => x\.cwd === repo\.dir\)/.test(src), 'a per-cwd lock exists')
  assert.ok(/one design agent per repository at a time/.test(src), 'and it says why')
  assert.ok(/const writesRepo = run => run\.kind === 'design'/.test(src), 'and it applies to writers only')
})

test('"files read" counts reads, not writes', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/ticket.mjs'), 'utf8')
  assert.ok(/!\['Write', 'Edit', 'MultiEdit', 'NotebookEdit'\]\.includes\(c\.name\)/.test(src))
})

test('two projects may hold the same ticket key without colliding', async () => {
  const { ticketStateFile, ticketProjectDir } = await import('../../lib/paths.mjs')
  const a = ticketStateFile('ABC', 'PROJ-1')
  const b = ticketStateFile('DEF', 'PROJ-1')
  assert.notEqual(a, b, 'same key under two projects resolves to different files')
  assert.equal(path.dirname(a), ticketProjectDir('ABC'))
  assert.equal(path.basename(a), 'PROJ-1.json')
})

test('workspace and key segments are both hard-guarded against traversal', async () => {
  const { ticketStateFile } = await import('../../lib/paths.mjs')
  const p = ticketStateFile('../../etc', '../../../passwd')
  assert.ok(!p.includes('..'), p)
  assert.ok(/[/\\]etc[/\\]/.test(p) && /PASSWD\.json$/.test(p), p)
  for (const bad of [['', 'A-1'], ['ABC', ''], [null, 'A-1'], ['ABC', '///']])
    assert.throws(() => ticketStateFile(bad[0], bad[1]), /invalid/, JSON.stringify(bad))
})

test('a workspace id is derived from the path, and two checkouts of one repo differ', async () => {
  const { workspaceId } = await import('../../lib/paths.mjs')
  const a = workspaceId('/home/u/work/api'), b = workspaceId('/home/u/fork/api')
  assert.notEqual(a, b, 'same basename, different path -> different id')
  assert.equal(a, workspaceId('/home/u/work/api'), 'stable across calls')
  assert.ok(a.startsWith('api-'), `readable on disk: ${a}`)
  assert.ok(!/[^A-Za-z0-9_-]/.test(a), `path-safe: ${a}`)
  assert.throws(() => workspaceId(''), /invalid/)
})

test('a project must be selected — the key prefix is not used to guess one', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/ticket.mjs'), 'utf8')
  assert.ok(/a project is required — select one before opening a ticket/.test(src))
  assert.ok(/const mismatch = prefix !== cfg\.jiraProjectKey/.test(src), 'a mismatched prefix is detected')
  assert.ok(/keyPrefixMismatch: r\.mismatch/.test(src), 'and reported to the client')
})

test('pre-partition state is still readable, so nothing is orphaned', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/ticket.mjs'), 'utf8')
  assert.ok(/legacyTicketStateFile\(key\)/.test(src), 'readState falls back to the flat layout')
})

test('the selected folder IS the working directory — nothing is inferred', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/ticket.mjs'), 'utf8')
  const fn = src.slice(src.indexOf('function repoFor(ws)'), src.indexOf('// ------', src.indexOf('function repoFor(ws)')))
  assert.ok(fn.length > 0, 'repoFor takes the workspace')
  assert.ok(!/resolveClone\(/.test(fn), 'no git-remote guessing decides where an agent runs')
  assert.ok(/fs\.existsSync\(ws\.dir\)/.test(fn), 'a folder that has gone away is reported, not used')
})

test('the workspace set is exactly the folders you have opened a session in', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/ticket.mjs'), 'utf8')
  const fn = src.slice(src.indexOf('function listWorkspaces()'), src.indexOf('const workspaceById'))
  // --dangerously-skip-permissions, so it must be a registry read and never a path from a request.
  assert.ok(/listLocalProjects\(\)/.test(fn), 'built from the registered project list')
  assert.ok(/workspaceId\(l\.dir\)/.test(fn), 'ids are derived from those paths')
  const link = src.slice(src.indexOf("app.post('/api/ticket/workspace/:id/jira'"), src.indexOf("app.delete('/api/ticket/:key/saved'"))
  assert.ok(/workspaceById\(req\.params\.id\)/.test(link), 'the id is resolved against that set')
  assert.ok(/not one of your open projects/.test(link), 'and the refusal says why')
  assert.ok(!/req\.body\?\.dir|body\.dir/.test(link), 'the request body cannot name a folder')
  assert.ok(/cfgFor\(key\)/.test(link), 'and the board must already be configured')
})

test('a folder with no board is fixable on this screen, not a dead end', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/ticket.mjs'), 'utf8')
  assert.ok(/is not linked to a JIRA board yet/.test(src), 'the state is named')
  assert.ok(/choose which board its tickets come from/.test(src), 'and so is the action')
  const ui = fs.readFileSync(path.join(ROOT, 'src/sections/TicketSection.jsx'), 'utf8')
  assert.ok(/api\.post\(`\/api\/ticket\/workspace\/\$\{cur\.id\}\/jira`/.test(ui), 'and the UI offers it')
})

test('local-only routes need a folder, not a board', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/ticket.mjs'), 'utf8')
  const body = src.slice(src.indexOf('export default function mountTicket'))
  const boardGated = (body.match(/const r = resolve\(req, res\)/g) || []).length
  assert.equal(boardGated, 4, `only JIRA-touching routes gate on a board, found ${boardGated}`)
  const route = body.slice(body.indexOf("app.delete('/api/ticket/:key/saved'"), body.indexOf("app.get('/api/ticket/:key',"))
  assert.ok(/resolveWs\(req, res\)/.test(route), 'forgetting a cached ticket is not board-gated')
  const fn = body.slice(body.indexOf('const resolveWs ='), body.indexOf('const resolve ='))
  assert.ok(/workspaceById\(id\)/.test(fn) && /is not one of your open projects/.test(fn))
  assert.ok(/Array\.isArray\(asked\)/.test(fn), 'a repeated/bracketed query param cannot throw here')
})

test('saved tickets are listed as cards carrying what was already paid for', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/ticket.mjs'), 'utf8')
  const fn = src.slice(src.indexOf('function listKeys(project)'), src.indexOf('/** Just how many'))
  for (const field of ['summary', 'type', 'status', 'hasDoc', 'hasAc', 'hasTests', 'nodes'])
    assert.ok(new RegExp(`\\b${field}\\b`).test(fn), `${field} is on a saved entry`)
  const ui = fs.readFileSync(path.join(ROOT, 'src/sections/TicketSection.jsx'), 'utf8')
  assert.ok(/function SavedCard\(/.test(ui), 'and rendered as a card')
  assert.ok(/gridTemplateColumns: 'repeat\(auto-fill/.test(ui), 'in a grid')
})

test('a read-only generation is not blocked by the per-repo write lock', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/ticket.mjs'), 'utf8')
  const gen = src.slice(src.indexOf("app.post('/api/ticket/:key/generate'"), src.indexOf("app.get('/api/ticket/:key/design'"))
  assert.ok(!/x\.cwd === repo\.dir/.test(gen), 'generation takes no per-repo lock')
  assert.ok(/live\.find\(x => x\.id === id\)/.test(gen), 'but the same artifact twice is refused')
  assert.ok(/MAX_CONCURRENT/.test(gen), 'and the global agent cap still applies')
  const run = src.slice(src.indexOf("app.post('/api/ticket/:key/design/run'"), src.indexOf("app.get('/api/ticket/:key/design/events'"))
  assert.ok(/live\.filter\(writesRepo\)\.find\(x => x\.cwd === repo\.dir\)/.test(run), 'the design lock counts writers only')
})

test('pruning a finished generation cannot evict a live design run', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/ticket.mjs'), 'utf8')
  const fn = src.slice(src.indexOf('function pruneRuns()'), src.indexOf('const MAX_EVENTS'))
  assert.ok(/runs\.delete\(r\.id\)/.test(fn), 'pruning deletes by map id')
  assert.ok(!/runs\.delete\(r\.key\)/.test(fn), 'never by ticket key')
  for (const m of ['id: `${r.key}:${kind}`', 'id: r.key'])
    assert.ok(src.includes(m) || src.includes('runs.set(id, run)'), 'every run carries the id it is filed under')
})

test('a leaked run does not hold the lock forever', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/ticket.mjs'), 'utf8')
  const fn = src.slice(src.indexOf('function inFlight()'), src.indexOf('const writesRepo'))
  assert.ok(/run\.child && run\.child\.alive === false/.test(fn), 'a dead child ends the run')
  assert.ok(/now > run\.expiresAt/.test(fn), 'and so does passing its own timeout')
  assert.ok(/run\.error = run\.error \|\|/.test(fn), 'reaping says why, and never overwrites a real error')
  const sets = src.match(/const run = \{ id[^\n]*/g) || []
  assert.equal(sets.length, 2, 'two run registrations')
  for (const line of sets) assert.ok(/expiresAt:/.test(line), `expiry set: ${line.slice(0, 60)}`)
  assert.ok(!/\[\.\.\.runs\.values\(\)\]\.filter\(x => !x\.done\)/.test(src), 'no raw !done scans remain')
})

test('spawnAgent calls onExit exactly once', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/agent.mjs'), 'utf8')
  assert.ok(/if \(ended\) return; ended = true/.test(src), 'onExit is one-shot')
  assert.ok(!/onExit\?\.\(\{ code, error: null \}\)/.test(src), "the 'exit' handler goes through finish()")

  const { spawnAgent } = await import('../../lib/agent.mjs')
  const calls = []
  await new Promise(resolve => {
    spawnAgent({ cwd: ROOT, prompt: 'x', onEvent: () => {}, onExit: p => { calls.push(p); setTimeout(resolve, 120) } })
    setTimeout(resolve, 3000)
  })
  assert.equal(calls.length, 1, `onExit fired ${calls.length}x for a spawn of a missing binary`)
})

test('a project-scope skill is detected and named as the entry point', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caps-'))
  fs.mkdirSync(path.join(dir, '.claude/skills/graphify'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.claude/skills/graphify/SKILL.md'), '---\nname: graphify\ndescription: Ask questions about this codebase using a pre-built graph index\n---\n')
  const { skills } = detectCapabilities(dir)
  assert.ok(skills.some(s => s.name === 'graphify' && s.scope === 'project'))
  const p = capabilityPrompt(dir)
  assert.ok(/Start with `graphify`/.test(p), 'it is promoted as the place to start')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('word-boundary matching — "typography" must not make a branding skill a code tool', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caps2-'))
  const add = (name, desc) => {
    fs.mkdirSync(path.join(dir, '.claude/skills', name), { recursive: true })
    fs.writeFileSync(path.join(dir, '.claude/skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${desc}\n---\n`)
  }
  add('brand-guidelines', "Applies official brand colors and typography to any artifact")
  add('theme-factory', 'Toolkit for styling artifacts: slides, docs, reportings, landing pages')
  const p = capabilityPrompt(dir)
  assert.ok(!/Start with `brand-guidelines`/.test(p), 'typography is not a call graph')
  assert.ok(!/Start with `theme-factory`/.test(p), 'reportings is not a repository')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('a description that merely mentions a repository is listed but never promoted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caps3-'))
  fs.mkdirSync(path.join(dir, '.claude/skills/session-start-hook'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.claude/skills/session-start-hook/SKILL.md'), '---\nname: session-start-hook\ndescription: Use when the user wants to set up a repository for Claude Code on the web\n---\n')
  assert.ok(!/Start with `session-start-hook`/.test(capabilityPrompt(dir)))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('the capability block is injected into every prompt that reads the repo', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/ticket.mjs'), 'utf8')
  assert.equal((src.match(/capabilityPrompt\(/g) || []).length >= 4, true, 'used by design, generate and chat (plus its definition)')
})

test('the ticket state directory is gitignored — it holds per-ticket design state, not shipped config', () => {
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')
  assert.ok(/^\.ticket-state\/$/m.test(gi))
})
