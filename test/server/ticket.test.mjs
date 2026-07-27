// Tests for server/ticket.mjs pure logic + the plane boundary.
//
// The key-normalization cases are the primary failure path for this feature: the KEY is the only
// input the user gives, so every form a human might paste has to land on the right ticket or be
// refused outright. Guessing is worse than refusing — it silently opens someone else's ticket.

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
  // A bare number is the important one: with several projects configured there is no honest way to
  // pick a prefix, and picking the first one is how you silently open the wrong ticket.
  for (const bad of ['', '   ', '1234', 'ABC', 'ABC-', '-1234', 'nonsense', 'ABC-12x', null, undefined, '1ABC-2'])
    assert.equal(normalizeKey(bad), null, JSON.stringify(bad))
})

test('key normalization is idempotent', () => {
  const once = normalizeKey('abc 1234')
  assert.equal(normalizeKey(once), once)
})

// ── the plane boundary, as a static assertion ────────────────────────────────────────────────────
// server/eng.mjs is PLANE A (work artifacts). server/ticket.mjs is PLANE B: it spawns agents and
// holds sessionIds and cost. The dependency must run one way only. The existing privacy test walks
// the RETURN VALUES of seven exported functions, so it would not notice a new import — this closes
// that gap at the source level, where it is actually checkable.
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

// A runtime test here would pass vacuously: loadProjects() reads projects.json, which is absent in
// CI, so Array.prototype.find never invokes the predicate and nothing can throw. The source
// assertion is the honest guard.
test('cfgFor coerces its argument — a repeated ?project= query must not crash the process', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/eng.mjs'), 'utf8')
  const line = src.split('\n').find(l => /^const cfgFor =/.test(l))
  assert.ok(line, 'cfgFor is defined')
  // Express turns ?project[]=x and ?project=a&project=b into an object/array, neither of which has
  // .toUpperCase. The route handlers resolve the project OUTSIDE their try block, so the TypeError
  // becomes an unhandled rejection and Node 22 exits — one malformed URL kills the dashboard.
  assert.ok(/String\(key \?\? ''\)/.test(line), 'cfgFor must String()-coerce before .toUpperCase()')
  assert.ok(!/\(key \|\| ''\)\.toUpperCase/.test(src), 'the uncoerced form must not reappear')
})

// ── the approval gate ────────────────────────────────────────────────────────────────────────────
// This is a control-flow property of a route that needs a live agent to exercise, so it is pinned
// at the source. The property matters: a regeneration reconciles against hand edits, and applying
// that silently is how someone's work disappears.
test('a regeneration over an existing graph writes `pending`, never `graph` directly', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/ticket.mjs'), 'utf8')
  assert.ok(/const isFirst = !s\.graph\?\.nodes\?\.length/.test(src), 'first-generation is distinguished from a regeneration')
  assert.ok(/next\.pending = \{/.test(src), 'a regeneration parks the merged graph in `pending`')
  assert.ok(/\/design\/rederive/.test(src), 'an explicit apply/discard route exists')
})

test('the board handoff carries a two-way link, not a one-way paste', () => {
  const ticket = fs.readFileSync(path.join(ROOT, 'server/ticket.mjs'), 'utf8')
  const index = fs.readFileSync(path.join(ROOT, 'server/index.mjs'), 'utf8')
  // Without jiraKey on the board ticket and boardTicketId on our side, the Ticket tab can never
  // show "this is now in code review" — which is the whole argument that it complements the board
  // rather than duplicating it.
  assert.ok(/jiraKey: r\.key/.test(ticket), 'the handoff sends jiraKey')
  assert.ok(/designDoc: s\.doc\?\.rel/.test(ticket), 'the handoff sends the design doc path')
  assert.ok(/jiraKey: typeof jiraKey === 'string'/.test(index), 'the board persists jiraKey')
  assert.ok(/board: \{ id: t\.id/.test(ticket), 'our state records the board ticket id')
})

test('the assistant proposes ops and never writes the graph itself', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/ticket.mjs'), 'utf8')
  const chat = src.slice(src.indexOf("app.post('/api/ticket/:key/design/chat'"), src.indexOf("app.get('/api/ticket/:key/design/mermaid'"))
  assert.ok(/parseOps\(out\.result\)/.test(chat), 'the chat route parses an op list out of the reply')
  // The only writeState in the chat route must be the session pointer — applying ops is a separate,
  // user-initiated call. An assistant with write access turns a hallucination into a silent edit.
  const writes = chat.match(/writeState\(/g) || []
  assert.equal(writes.length, 1, 'exactly one write, and it is the session pointer')
  assert.ok(/chat: \{ sessionId: out\.sessionId, cwd \}/.test(chat), 'that write stores only the pointer')
})

test('the chat persists a session pointer, not a transcript', () => {
  // Comments stripped: the prose in this file legitimately says "transcript" while explaining why
  // one is NOT stored, and an assertion that cannot tell code from commentary is worthless.
  const code = fs.readFileSync(path.join(ROOT, 'server/ticket.mjs'), 'utf8')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  for (const banned of [/transcript\s*[:=]/, /messages\s*:\s*\[/, /events\s*:\s*run\.events(?!\.length)/]) {
    assert.ok(!banned.test(code), `no transcript is persisted (${banned}) — the CLI already keeps one on disk`)
  }
  // …and what writeState actually receives is the pointer and nothing else.
  assert.ok(/chat: \{ sessionId: out\.sessionId, cwd \}/.test(code))
})

// ── cancel safety and the per-repo lock ──────────────────────────────────────────────────────────
test('the agent writes to a staging path, promoted only on a clean exit', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/ticket.mjs'), 'utf8')
  // child.kill() can land between two Write calls. If the agent wrote straight to the dated final
  // path, a cancelled run would leave a half-written spec in the user's git repo, indistinguishable
  // from a finished one.
  assert.ok(/const stageRel = /.test(src), 'a staging path is derived')
  assert.ok(/designPrompt\(d, repo\.repo, repo\.dir, stageRel\)/.test(src), 'the agent is told to write to the staging path, not the final one')
  assert.ok(/const clean = !run\.cancelled && !error/.test(src), 'promotion is conditional on a clean exit')
  const promote = src.split('\n').find(l => /renameSync\(stageAbs, abs\)/.test(l))
  assert.ok(promote, 'staging is renamed to the final path')
  assert.ok(/if \(clean\)/.test(promote), 'and that rename is guarded by the clean-exit check')
  assert.ok(/else partial =/.test(src), 'anything else is reported as partial')
  // and it is never removed on the user's behalf
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
  // The global cap alone let two tickets run agents in the SAME working tree, each reading a tree
  // the other might be mid-write in.
  assert.ok(/const sameRepo = live\.find\(x => x\.cwd === repo\.dir\)/.test(src), 'a per-cwd lock exists')
  assert.ok(/one agent per repository at a time/.test(src), 'and it says why')
})

test('"files read" counts reads, not writes', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/ticket.mjs'), 'utf8')
  // Counting Write/Edit targets would inflate the one number the user judges the run's
  // thoroughness by.
  assert.ok(/!\['Write', 'Edit', 'MultiEdit', 'NotebookEdit'\]\.includes\(c\.name\)/.test(src))
})

// ── saved tickets are partitioned by project ─────────────────────────────────────────────────────
test('two projects may hold the same ticket key without colliding', async () => {
  const { ticketStateFile, ticketProjectDir } = await import('../../lib/paths.mjs')
  // The project is the scope: it decides the JIRA host and the repository a design reads. A flat,
  // key-keyed file would serve one project's ticket under another's configuration.
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
  // The KEY is uppercased (JIRA keys are uppercase by convention, so `abc-1` and `ABC-1` are the
  // same ticket). The WORKSPACE segment keeps its case, because it carries a readable folder
  // basename and case-folding two sibling folders together would merge their saved tickets.
  assert.ok(/[/\\]etc[/\\]/.test(p) && /PASSWD\.json$/.test(p), p)
  for (const bad of [['', 'A-1'], ['ABC', ''], [null, 'A-1'], ['ABC', '///']])
    assert.throws(() => ticketStateFile(bad[0], bad[1]), /invalid/, JSON.stringify(bad))
})

// A workspace id must survive a rename of anything ELSE and must not collide across checkouts —
// it is the merge key for every saved ticket, so a collision serves one project's work under
// another's name and a churn orphans the lot.
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
  // The prefix is still compared, but only to warn: silently retargeting a pasted key would resolve
  // it against the wrong host and the wrong repository.
  assert.ok(/const mismatch = prefix !== cfg\.jiraProjectKey/.test(src), 'a mismatched prefix is detected')
  assert.ok(/keyPrefixMismatch: r\.mismatch/.test(src), 'and reported to the client')
})

test('pre-partition state is still readable, so nothing is orphaned', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/ticket.mjs'), 'utf8')
  assert.ok(/legacyTicketStateFile\(key\)/.test(src), 'readState falls back to the flat layout')
})

// ── the workspace, and the board it draws tickets from ──────────────────────────────────────────
// The FOLDER is the unit the user selects. It is what agents run inside and what saved tickets hang
// off. The JIRA key is a property of a board — keying on it meant renaming the board orphaned the
// binding, and two checkouts of one board could not be told apart.
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
  // Every cwd this feature can reach comes from here. It decides where an agent runs with
  // --dangerously-skip-permissions, so it must be a registry read and never a path from a request.
  assert.ok(/listLocalProjects\(\)/.test(fn), 'built from the registered project list')
  assert.ok(/workspaceId\(l\.dir\)/.test(fn), 'ids are derived from those paths')
  const link = src.slice(src.indexOf("app.post('/api/ticket/workspace/:id/jira'"), src.indexOf("app.delete('/api/ticket/:key/saved'"))
  assert.ok(/workspaceById\(req\.params\.id\)/.test(link), 'the id is resolved against that set')
  assert.ok(/not one of your open projects/.test(link), 'and the refusal says why')
  // The body carries a BOARD KEY, never a directory — so no request can name a new cwd.
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

// Found by running it: DELETE /saved went through the board-requiring resolver, so a folder whose
// board link was cleared (or whose board was removed from projects.json) held saved tickets that
// could never be deleted. Forgetting a cached file needs a folder, not a JIRA host.
test('local-only routes need a folder, not a board', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/ticket.mjs'), 'utf8')
  const body = src.slice(src.indexOf('export default function mountTicket'))
  // Only the four routes that actually talk to JIRA — the live fetch, generation, a design run and
  // the board handoff — may demand a linked board. Everything else is this machine's own state.
  const boardGated = (body.match(/const r = resolve\(req, res\)/g) || []).length
  assert.equal(boardGated, 4, `only JIRA-touching routes gate on a board, found ${boardGated}`)
  const route = body.slice(body.indexOf("app.delete('/api/ticket/:key/saved'"), body.indexOf("app.get('/api/ticket/:key',"))
  assert.ok(/resolveWs\(req, res\)/.test(route), 'forgetting a cached ticket is not board-gated')
  // resolveWs still refuses an unknown folder — it relaxes the board, never the cwd check.
  const fn = body.slice(body.indexOf('const resolveWs ='), body.indexOf('const resolve ='))
  assert.ok(/workspaceById\(id\)/.test(fn) && /is not one of your open projects/.test(fn))
  assert.ok(/Array\.isArray\(asked\)/.test(fn), 'a repeated/bracketed query param cannot throw here')
})

test('saved tickets are listed as cards carrying what was already paid for', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/ticket.mjs'), 'utf8')
  const fn = src.slice(src.indexOf('function listKeys(project)'), src.indexOf('/** Just how many'))
  // A bare key forces the user to open a ticket to find out which one it is — which is the JIRA
  // round trip the cache exists to avoid. Everything on the card is read from disk.
  for (const field of ['summary', 'type', 'status', 'hasDoc', 'hasAc', 'hasTests', 'nodes'])
    assert.ok(new RegExp(`\\b${field}\\b`).test(fn), `${field} is on a saved entry`)
  const ui = fs.readFileSync(path.join(ROOT, 'src/sections/TicketSection.jsx'), 'utf8')
  assert.ok(/function SavedCard\(/.test(ui), 'and rendered as a card')
  assert.ok(/gridTemplateColumns: 'repeat\(auto-fill/.test(ui), 'in a grid')
})

// ── the project's own skills ─────────────────────────────────────────────────────────────────────
// Every agent run uses the target repository as its cwd, so that project's skills are loaded — but
// the agent will not reach for them unless the prompt says they exist. These pin the two bugs found
// by actually running the detector, both of which would have sent a run to the wrong tool.
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
  // The obvious /graph|repo|arch/ substring regex matched "typoGRAPHy" and "REPOrtings", promoting
  // a brand-guidelines skill and a theming skill as codebase tools. A heuristic that recommends the
  // wrong tool is worse than no heuristic, because the agent will actually go and use it.
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
  // A session-hook installer says "set up a repository" — a true word match, and still not a
  // comprehension tool. Being listed is cheap; being named "start here" is a directive.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caps3-'))
  fs.mkdirSync(path.join(dir, '.claude/skills/session-start-hook'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.claude/skills/session-start-hook/SKILL.md'), '---\nname: session-start-hook\ndescription: Use when the user wants to set up a repository for Claude Code on the web\n---\n')
  assert.ok(!/Start with `session-start-hook`/.test(capabilityPrompt(dir)))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('the capability block is injected into every prompt that reads the repo', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/ticket.mjs'), 'utf8')
  // design run, AC/tests generation, and the design chat — all three run with the repo as cwd, so
  // all three should be told what the project provides.
  assert.equal((src.match(/capabilityPrompt\(/g) || []).length >= 4, true, 'used by design, generate and chat (plus its definition)')
})

test('the ticket state directory is gitignored — it holds per-ticket design state, not shipped config', () => {
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')
  assert.ok(/^\.ticket-state\/$/m.test(gi))
})
