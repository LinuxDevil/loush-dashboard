
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { ticketDetail, cfgFor, loadProjects, artifactsFor, reqHash, confluencePage, readArtifacts as readTicketArtifacts, writeArtifacts as writeTicketArtifacts } from './eng.mjs'
import { extractLinks, keyFromInput } from '../lib/links.mjs'
import { listLocalProjects } from '../lib/clone.mjs'
import { spawnAgent, runAgent } from '../lib/agent.mjs'
import { parseGraph, parseOps, validateGraph, mergeGraph, layout, applyOps, toMermaid } from '../lib/design-schema.mjs'
import { buildImportGraph, SOURCE_EXTS, IGNORE_DIRS } from './fe.mjs'
import { TICKET_DIR, ticketStateFile, ticketProjectDir, legacyTicketStateFile, workspaceId } from '../lib/paths.mjs'
import { parseTasks, validateTasks } from '../lib/decomposition.mjs'
import { git as gitSafe } from '../lib/git-safe.mjs'

const KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/
const DASH_PORT = Number(process.env.DASH_PORT) || 5178
const BOARD_FILE = path.join(os.homedir(), '.claude', 'taskboard.json')
function boardTicket(id) {
  if (!id) return null
  try { return (JSON.parse(fs.readFileSync(BOARD_FILE, 'utf8')).tickets || []).find(t => t.id === id) || null }
  catch { return null }
}

/**
 * Normalize whatever the user pasted into a JIRA key.
 * Accepts a bare key, lowercase, a browse URL, a Slack paste with punctuation, `ABC 1234`,
 * `ABC_1234`. Returns null rather than guessing — a wrong key is a wrong ticket.
 */
export function normalizeKey(input) {
  let s = String(input == null ? '' : input).trim()
  if (!s) return null
  const url = /\/browse\/([A-Za-z][A-Za-z0-9_]*-\d+)/.exec(s) || /[?&]selectedIssue=([A-Za-z][A-Za-z0-9_]*-\d+)/.exec(s)
  if (url) return url[1].toUpperCase()
  s = s.replace(/^[<([]+|[>)\],.;:]+$/g, '').trim()
  s = s.replace(/[\s_.]+/g, '-').replace(/-+/g, '-')
  const m = /^([A-Za-z][A-Za-z0-9_]*)-(\d+)$/.exec(s)
  if (!m) return null
  const key = `${m[1].toUpperCase()}-${m[2]}`
  return KEY_RE.test(key) ? key : null
}

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------
const EMPTY = key => ({ v: 1, key, rev: 0, cwd: null, doc: null, graph: null, chat: null, warnings: [], run: null, ticket: null, fetchedAt: null, files: null, filesAt: null })

function readState(project, key) {
  try { return { ...EMPTY(key), ...JSON.parse(fs.readFileSync(ticketStateFile(project, key), 'utf8')) } }
  catch { }
  try { return { ...EMPTY(key), ...JSON.parse(fs.readFileSync(legacyTicketStateFile(key), 'utf8')) } }
  catch { return EMPTY(key) }
}
function writeState(project, key, s) {
  const dir = ticketProjectDir(project)
  fs.mkdirSync(dir, { recursive: true })
  const target = ticketStateFile(project, key)
  const tmp = target + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify({ ...s, project }, null, 2))
  fs.renameSync(tmp, target)
  return { ...s, project }
}
function listKeys(project) {
  const dir = ticketProjectDir(project)
  let art = {}
  try { art = readTicketArtifacts() } catch {}
  try {
    return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
      const key = f.replace(/\.json$/, '')
      let at = 0, nodes = 0, summary = null, hasDoc = false, type = null, status = null, fetchedAt = null
      try {
        const st = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
        at = Math.max(Date.parse(st.fetchedAt || 0) || 0, Date.parse(st.doc?.genAt || 0) || 0)
        nodes = st.graph?.nodes?.length || 0
        summary = st.ticket?.summary || null
        type = st.ticket?.type || null
        status = st.ticket?.status || null
        fetchedAt = st.fetchedAt || null
        hasDoc = !!st.doc
      } catch {}
      const a = art[key] || {}
      return { key, at, nodes, summary, hasDoc, type, status, fetchedAt, hasAc: !!a.ac, hasTests: !!a.tests }
    }).sort((a, b) => b.at - a.at)
  } catch { return [] }
}

/** Just how many, for the workspace picker — listKeys() opens and parses every file to build cards. */
function countKeys(project) {
  try { return fs.readdirSync(ticketProjectDir(project)).filter(f => f.endsWith('.json')).length } catch { return 0 }
}

const sha = s => 'sha256:' + crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16)

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------
const CAP_TTL = 60_000
const capCache = new Map()

export function detectCapabilities(dir) {
  if (!dir) return { skills: [], commands: [] }
  const hit = capCache.get(dir)
  if (hit && Date.now() - hit.at < CAP_TTL) return hit.v
  const firstLine = p => {
    try {
      const m = /^description:\s*["']?(.+?)["']?\s*$/m.exec(fs.readFileSync(p, 'utf8').slice(0, 2000))
      return m ? m[1].slice(0, 140) : ''
    } catch { return '' }
  }
  const skills = [], commands = []
  const seen = new Set()
  const scanSkills = (root, scope) => {
    try {
      for (const e of fs.readdirSync(root, { withFileTypes: true })) {
        if (!e.isDirectory()) continue
        const p = path.join(root, e.name, 'SKILL.md')
        if (!fs.existsSync(p) || seen.has(e.name)) continue
        seen.add(e.name)
        skills.push({ name: e.name, scope, desc: firstLine(p) })
      }
    } catch {}
  }
  const scanCmds = (root, scope) => {
    try {
      for (const f of fs.readdirSync(root)) {
        if (!f.endsWith('.md')) continue
        const name = f.replace(/\.md$/, '')
        if (seen.has(name)) continue
        seen.add(name)
        commands.push({ name, scope, desc: firstLine(path.join(root, f)) })
      }
    } catch {}
  }
  scanSkills(path.join(dir, '.claude', 'skills'), 'project')
  scanCmds(path.join(dir, '.claude', 'commands'), 'project')
  scanSkills(path.join(os.homedir(), '.claude', 'skills'), 'user')
  scanCmds(path.join(os.homedir(), '.claude', 'commands'), 'user')
  const v = { skills, commands }
  capCache.set(dir, { at: Date.now(), v })
  return v
}

/**
 * The block of prompt text that tells an agent which of the project's own tools to prefer.
 * Empty when the project has none — an empty labelled section measurably degrades output, so it is
 * omitted rather than rendered blank.
 */
const CODE_WORD = /(^|[^a-z])(graph|graphify|codebase|code|repo|repository|source|symbol|call-?graph|dependency|dependencies|architecture|explore|comprehend|navigate|index(er)?|ast|lsp)([^a-z]|$)/i
const isCodeTool = x => CODE_WORD.test(` ${x.name} `) || CODE_WORD.test(` ${x.desc} `)

const COMPREHENSION = /ask (questions? )?about|question.{0,20}(codebase|repo|project)|understand(ing)?\s+(the\s+)?(code|codebase|repo|project|system)|(call|dependency|code|knowledge)[- ]graph|code(base)?[- ]index|map (the|your) (code|repo)|explore the (code|repo)/i
const isEntryPoint = x => CODE_WORD.test(` ${x.name} `) || COMPREHENSION.test(x.desc || '')

/**
 * The block of prompt text that tells an agent which of the project's own tools to prefer.
 * Empty when there is nothing relevant — an empty labelled section measurably degrades output.
 */
export function capabilityPrompt(dir) {
  const { skills, commands } = detectCapabilities(dir)
  const relevant = [...skills, ...commands].filter(x => x.scope === 'project' || isCodeTool(x))
  if (!relevant.length) return ''
  const qa = relevant.filter(isEntryPoint).sort((a, b) => (a.scope === 'project' ? -1 : 1) - (b.scope === 'project' ? -1 : 1))
  const line = x => `  - ${x.name}${x.desc ? ` — ${x.desc}` : ''}`
  const sk = relevant.filter(x => skills.includes(x)), cm = relevant.filter(x => commands.includes(x))
  return `
# Tools available in this project — PREFER THEM OVER GREPPING

These are installed in this repository or scoped to code work. They were written for this codebase
and know it better than a cold search does. Use them before falling back to manual exploration.
${sk.length ? `\nSkills:\n${sk.map(line).join('\n')}` : ''}
${cm.length ? `\nCommands:\n${cm.map(line).join('\n')}` : ''}
${qa.length ? `\n**Start with ${qa.slice(0, 3).map(x => `\`${x.name}\``).join(' or ')}** to understand the code before you answer. That is what it is for — do not re-derive by hand what it can tell you directly.` : ''}
`
}

const BINDINGS = () => path.join(TICKET_DIR, 'workspace-jira.json')
const readBindings = () => { try { return JSON.parse(fs.readFileSync(BINDINGS(), 'utf8')) } catch { return {} } }
function writeBinding(ws, jiraKey) {
  const b = readBindings()
  if (jiraKey) b[ws] = jiraKey; else delete b[ws]
  fs.mkdirSync(TICKET_DIR, { recursive: true })
  fs.writeFileSync(BINDINGS(), JSON.stringify(b, null, 2))
  return b
}

/**
 * The workspaces a user can select: every folder they have opened a session in, plus its JIRA board
 * if one can be determined. The FOLDER is the unit — it is what they pick, what agents run inside,
 * and what saved tickets hang off.
 */
function listWorkspaces() {
  const projects = loadProjects()
  const bindings = readBindings()
  return listLocalProjects().map(l => {
    const id = workspaceId(l.dir)
    const jiraKey = bindings[id] || projects.find(p => p.githubRepo && l.slug && p.githubRepo.toLowerCase() === l.slug.toLowerCase())?.key || null
    const cfg = jiraKey ? projects.find(p => p.key === jiraKey) : null
    const caps = detectCapabilities(l.dir)
    return {
      id, dir: l.dir, name: l.name, slug: l.slug, isGit: l.isGit, lastActive: l.lastActive,
      jira: cfg ? { key: cfg.key, host: cfg.jiraHost || null, projectKey: cfg.jiraProjectKey, writes: cfg.writes === true } : null,
      jiraBound: !!bindings[id],
      skills: caps.skills.map(s => s.name),
      saved: countKeys(id),
    }
  })
}
const workspaceById = id => listWorkspaces().find(w => w.id === id) || null

/**
 * Where a run for this workspace executes. There is nothing to infer any more: the user selected a
 * folder, so that folder IS the working directory. `resolveClone`'s git-remote matching was only
 * ever a way to guess this, and guessing failed silently on forks, monorepos and differently-named
 * remotes — which disabled design, files and grounded generation with no recourse on that screen.
 */
function repoFor(ws) {
  if (!ws?.dir) return { dir: null, how: null, repo: null, reason: 'no project selected' }
  if (!fs.existsSync(ws.dir)) return { dir: null, how: null, repo: ws.slug || null, reason: `${ws.dir} no longer exists on disk` }
  const caps = detectCapabilities(ws.dir)
  return {
    dir: ws.dir, how: 'selected', repo: ws.slug || null, reason: null,
    skills: caps.skills.map(s => s.name), commands: caps.commands.map(c => c.name),
  }
}

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------
/**
 * Frames Figma Capture has already pulled into this repo. The screenshot is what makes a design
 * check cheap — comparing against a PNG on disk costs nothing, where re-reading the frame out of
 * Figma costs a large fraction of a context window every single time.
 */
function capturesFor(repoDir) {
  const dir = path.join(repoDir, '.claude', 'figma-captures')
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).slice(0, 40)
      .map(e => path.join(dir, e.name))
  } catch { return [] }
}

/**
 * The copy deck, fetched — but only if the sheet is actually shared.
 *
 * Google answers a request for a private sheet with 200 and a sign-in PAGE, so the status code
 * proves nothing. What is written to the repo is checked to be a CSV first; a sign-in page saved as
 * `content.csv` would be worse than no file at all, because design QA would then check every string
 * against it and report a pass.
 */
async function saveSheetCsv(csvUrl, repoDir, key) {
  try {
    const r = await fetch(csvUrl, { redirect: 'follow' })
    if (!r.ok) return null
    const body = await r.text()
    const looksLikeHtml = /^\s*<(!doctype|html)/i.test(body)
    if (looksLikeHtml || !body.trim()) return null
    const dir = path.join(repoDir, 'docs', key)
    fs.mkdirSync(dir, { recursive: true })
    const out = path.join(dir, 'content.csv')
    fs.writeFileSync(out, body)
    return out
  } catch { return null }
}

/** The copy deck, by convention. Absent is normal — most tickets do not have one. */
function contentCsvFor(repoDir, key) {
  for (const rel of [`docs/${key}/content.csv`, `docs/${key}/content.tsv`]) {
    const p = path.join(repoDir, rel)
    if (fs.existsSync(p)) return p
  }
  return null
}

const runs = new Map()
const KEEP_FINISHED = 8
function pruneRuns() {
  const finished = [...runs.values()].filter(r => r.done).sort((a, b) => b.startedAt - a.startedAt)
  for (const r of finished.slice(KEEP_FINISHED)) runs.delete(r.id)
}
const MAX_EVENTS = 4000
const MAX_CONCURRENT = 2

/**
 * The runs actually still going, with dead ones reaped on the way past.
 *
 * A lock needs a way to be wrong. `!x.done` alone is a deadlock waiting to happen: a spawn that
 * errors without an exit event, a child killed out from under the server, a handler that throws
 * before its `finally` — any of those leaves an entry that is forever "in flight", and `pruneRuns`
 * never collects it because it only drops FINISHED runs. The repository would then be locked for
 * the life of the process, which is exactly the shape of a bug the user cannot work around.
 *
 * So liveness is checked against the child where there is one, and against the run's own timeout
 * otherwise (`runAgent` is buffered and hands back no handle).
 */
function inFlight() {
  const now = Date.now()
  for (const run of runs.values()) {
    if (run.done) continue
    const dead = run.child && run.child.alive === false
    const expired = run.expiresAt && now > run.expiresAt
    if (!dead && !expired) continue
    run.done = true
    run.error = run.error || (dead
      ? 'the agent exited without reporting a result'
      : `no result after ${Math.round((run.expiresAt - run.startedAt) / 60000)}m — treating the run as finished`)
  }
  return [...runs.values()].filter(r => !r.done)
}

/**
 * Does this run WRITE into the user's repository?
 *
 * Only a design run does: the agent writes a staging file under `docs/superpowers/specs/`. A
 * generation is read-only — `server/prompts/tests.md` says "do not emit a test file" — and its
 * output is stored in this app's own eng-artifacts.json. That distinction is the whole basis of the
 * per-repo lock, so it is stated once here rather than assumed at each call site.
 */
const writesRepo = run => run.kind === 'design'

const META_KIND = { ac: 'acceptance criteria', tests: 'test cases', decompose: 'a task decomposition', streams: 'a parallel work-stream analysis' }
// kind -> prompt file. Adding a kind is adding a row here plus the prompt.
const GEN_KINDS = { ac: 'ac.md', tests: 'tests.md', decompose: 'decompose.md', streams: 'streams.md' }

function emit(run, ev) {
  run.events.push(ev)
  if (run.events.length > MAX_EVENTS) run.events.splice(0, run.events.length - MAX_EVENTS)
  if (ev.type === 'assistant' && Array.isArray(ev.message?.content)) {
    for (const c of ev.message.content) {
      if (c.type !== 'tool_use') continue
      run.tools++
      const f = c.input?.file_path || c.input?.path
      if (f && !['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(c.name)) run.files.add(String(f))
    }
  }
  if (ev.type === 'result') { run.cost = ev.total_cost_usd ?? run.cost; run.ms = ev.duration_ms ?? run.ms; run.sessionId = ev.session_id || run.sessionId }
  if (ev.type === 'system' && ev.subtype === 'init' && ev.session_id) run.sessionId = ev.session_id
  for (const res of run.listeners) { try { res.write(`data: ${JSON.stringify(ev)}\n\n`) } catch {} }
}

const runView = run => run && ({
  key: run.key, kind: run.kind, startedAt: run.startedAt, done: run.done, error: run.error,
  cancelled: run.cancelled || false, tools: run.tools, filesRead: run.files.size,
  cost: run.cost ?? null, ms: run.ms ?? null, sessionId: run.sessionId || null,
  partial: run.partial || null, cwd: run.cwd || null,
  events: run.events.length,
})

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------
const PROMPT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'prompts')
function promptFile(n) {
  try { return fs.readFileSync(path.join(PROMPT_DIR, n), 'utf8') }
  catch (e) { console.error(`[ticket] cannot read prompt ${n} from ${PROMPT_DIR}: ${e.message}`); return null }
}

function designPrompt(d, repo, repoDir, docRel) {
  const preamble = promptFile('design-plan.md')
  if (!preamble) throw new Error('the design prompt (server/prompts/design-plan.md) could not be read — refusing to run a degraded design')
  return `${preamble}

# The ticket

${d.key} — ${d.summary}
Type: ${d.type} · Status: ${d.status}

## Description
${d.description || '(none)'}

## Comments
${d.comments.map(c => `- ${c.author}: ${c.body}`).join('\n') || '(none)'}

# Your task

You are in the repository \`${repo}\`, checked out at \`${repoDir}\` — READ IT. Investigate before you
write anything. Then write the design document to \`${docRel}\` using the Write tool.
${capabilityPrompt(repoDir)}

Finish your reply with the component graph in a single fenced \`\`\`yaml block, in exactly this shape:

nodes:
  - id: short-slug            # semantic, stable across regenerations. NEVER a number.
    label: Human Readable
    type: process             # process|service|store|decision|external|ui|queue
    note: one line of why
    files:
      - rel: path/from/repo/root.mjs
        change: modify        # modify | create
edges:
  - source: slug-a
    target: slug-b
    label: what moves between them
    kind: calls               # calls|reads|writes|publishes|depends|sync|renders
    evidence: why you believe this edge exists

Rules for the graph:
  * Do NOT emit x/y coordinates. Layout is computed, not authored.
  * Every edge needs a label. An unlabelled arrow says nothing.
  * Every file path must be repo-relative and must be one you actually verified, or marked create.
  * Prefer fewer, larger components. More than ~15 nodes is harder to read than a list.`
}

// ---------------------------------------------------------------------------------------------
export default function mountTicket(app) {
  const resolveWs = (req, res) => {
    const key = normalizeKey(req.params.key)
    if (!key) { res.status(400).json({ error: `"${req.params.key}" is not a JIRA key — expected something like ABC-1234` }); return null }
    const asked = req.query.workspace || req.body?.workspace || req.query.project || req.body?.project
    if (!asked) { res.status(400).json({ error: 'a project is required — select one before opening a ticket' }); return null }
    const id = String(Array.isArray(asked) ? asked[0] : asked)
    const ws = workspaceById(id)
    if (!ws) {
      res.status(404).json({
        error: `"${id}" is not one of your open projects`,
        detail: 'select a project you have opened a session in',
        available: false,
      })
      return null
    }
    return { key, ws }
  }

  const resolve = (req, res) => {
    const r = resolveWs(req, res); if (!r) return null
    if (!r.ws.jira) {
      res.status(400).json({
        error: `${r.ws.name} is not linked to a JIRA board yet`,
        detail: 'choose which board its tickets come from, next to the project name',
        available: false,
      })
      return null
    }
    const cfg = cfgFor(r.ws.jira.key)
    if (!cfg) { res.status(404).json({ error: `the board "${r.ws.jira.key}" linked to ${r.ws.name} is no longer configured`, available: false }); return null }
    const prefix = r.key.split('-')[0]
    const mismatch = prefix !== cfg.jiraProjectKey && prefix !== cfg.key ? prefix : null
    return { ...r, cfg, mismatch }
  }

  // ---- the tab's own index ----
  app.get('/api/ticket/index', (req, res) => {
    const workspaces = listWorkspaces()
    const asked = req.query.workspace || req.query.project
    const sel = asked ? workspaces.find(w => w.id === String(asked)) : null
    res.json({
      available: workspaces.length > 0,
      workspaces,
      boards: loadProjects().map(p => ({ key: p.key, name: p.name, jiraHost: p.jiraHost || null, jiraProjectKey: p.jiraProjectKey, githubRepo: p.githubRepo || null })),
      workspace: sel?.id || null,
      saved: sel ? listKeys(sel.id) : [],
      runs: inFlight().map(runView),
    })
  })

  app.post('/api/ticket/workspace/:id/jira', (req, res) => {
    const ws = workspaceById(req.params.id)
    if (!ws) return res.status(404).json({ error: 'not one of your open projects' })
    const key = req.body?.jiraKey ? String(req.body.jiraKey).toUpperCase() : null
    if (key && !cfgFor(key)) return res.status(400).json({ error: `no board called "${key}" is configured — add it in Setup` })
    writeBinding(ws.id, key)
    res.json({ ok: true, workspace: workspaceById(ws.id) })
  })

  app.delete('/api/ticket/:key/saved', (req, res) => {
    const r = resolveWs(req, res); if (!r) return
    try { fs.unlinkSync(ticketStateFile(r.ws.id, r.key)) } catch {}
    res.json({ ok: true })
  })

  // ---- key-first fetch. Never blocks on a snapshot, and never re-fetches what is already on disk. ----
  app.get('/api/ticket/:key', async (req, res) => {
    const r = resolve(req, res); if (!r) return
    const s = readState(r.ws.id, r.key)
    const repo = repoFor(r.ws)
    const envelope = (d, cached, fetchedAt) => ({
      available: true, ...d,
      artifacts: artifactsFor(d),
      project: { key: r.cfg.key, jiraHost: r.cfg.jiraHost, githubRepo: r.cfg.githubRepo, writes: r.cfg.writes === true },
      workspace: { id: r.ws.id, name: r.ws.name, dir: r.ws.dir },
      repo: { dir: repo.dir, how: repo.how, reason: repo.reason },
      url: r.cfg.jiraHost ? `https://${r.cfg.jiraHost}/browse/${r.key}` : null,
      cached, fetchedAt: fetchedAt || null,
      keyPrefixMismatch: r.mismatch,
      design: { hasDoc: !!s.doc, nodes: s.graph?.nodes?.length || 0, rev: s.rev || 0 },
    })

    if (s.ticket && req.query.fresh !== '1') return res.json(envelope(s.ticket, true, s.fetchedAt))

    try {
      const d = await ticketDetail(r.cfg, r.key)
      const fetchedAt = new Date().toISOString()
      writeState(r.ws.id, r.key, { ...s, ticket: d, fetchedAt })
      res.json(envelope(d, false, fetchedAt))
    } catch (e) {
      if (s.ticket) return res.json({ ...envelope(s.ticket, true, s.fetchedAt), refreshError: String(e.message || e) })
      const msg = String(e.message || e)
      if (/no-jira-creds/.test(msg)) return res.status(400).json({ available: false, reason: 'JIRA credentials are not configured — add an email and API token in Setup' })
      if (/jira 404/.test(msg)) return res.status(404).json({ available: false, reason: `${r.key} was not found on ${r.cfg.jiraHost || 'the configured JIRA host'}` })
      if (/jira 40[13]/.test(msg)) return res.status(403).json({ available: false, reason: `JIRA rejected the request — the token may be expired or lack access to ${r.cfg.key}` })
      res.status(500).json({ available: false, reason: msg })
    }
  })

  // ---- generate AC / test cases WITH THE REPOSITORY OPEN ----
  app.post('/api/ticket/:key/generate', async (req, res) => {
    const r = resolve(req, res); if (!r) return
    const kind = req.body?.kind
    if (!GEN_KINDS[kind]) return res.status(400).json({ error: `kind must be one of ${Object.keys(GEN_KINDS).join('|')}` })
    const repo = repoFor(r.ws)
    if (!repo.dir) return res.status(400).json({ error: repo.reason })

    const live = inFlight()
    const id = `${r.key}:${kind}`
    const dup = live.find(x => x.id === id)
    if (dup) {
      return res.status(409).json({
        error: `${META_KIND[kind]} are already being generated for ${r.key}`,
        detail: `started ${Math.round((Date.now() - dup.startedAt) / 1000)}s ago — wait for it to finish`,
      })
    }
    if (live.length >= MAX_CONCURRENT) {
      return res.status(429).json({
        error: `${live.length} agent runs are already in flight (${live.map(x => `${x.key} ${x.kind}`).join(', ')})`,
        detail: 'wait for one to finish, or cancel it',
      })
    }

    const s = readState(r.ws.id, r.key)
    let d
    try { d = s.ticket || await ticketDetail(r.cfg, r.key) }
    catch (e) { return res.status(502).json({ error: `could not read ${r.key} from JIRA: ${e.message}` }) }

    const preamble = promptFile(GEN_KINDS[kind])
    if (!preamble) return res.status(500).json({ error: `the ${kind} prompt could not be read — refusing to run a degraded generation` })

    const store = readTicketArtifacts()
    const ac = kind === 'tests' ? store[r.key]?.ac?.md : null
    const prompt = `${preamble}

# The repository

You are in \`${repo.repo}\`, checked out at \`${repo.dir}\`. READ IT before you write.
${capabilityPrompt(repo.dir)}

# ${r.key} — ${d.summary}
Type: ${d.type} · Status: ${d.status}

## Description
${d.description || '(none)'}

## Comments
${(d.comments || []).map(c => `- ${c.author}: ${c.body}`).join('\n') || '(none)'}
${ac ? `\n## Acceptance criteria already agreed for this ticket\n${ac}\n\nEvery row of your plan must cite which of these it covers.` : ''}`

    const GEN_TIMEOUT = 900_000
    const startedAt = Date.now()
    const run = { id, key: r.key, kind: `generate:${kind}`, startedAt, expiresAt: startedAt + GEN_TIMEOUT + 30_000, events: [], listeners: new Set(), done: false, error: null, tools: 0, files: new Set(), cost: null, ms: null, cwd: repo.dir, partial: null }
    runs.set(id, run)
    try {
      const out = await runAgent({ cwd: repo.dir, prompt, model: req.body?.model, timeoutMs: GEN_TIMEOUT })
      run.done = true
      if (out.error) { run.error = out.error; return res.status(502).json({ error: out.error }) }
      const md = (out.result || '').trim()
      if (!md) return res.status(502).json({ error: 'the model returned nothing' })
      // A decomposition is checked against the real checkout before it is stored. The failures
      // that matter here — a dependency on a task that is not in the list, a cycle, two
      // unordered tasks writing the same file — are all invisible to someone reading the
      // document, so the findings are attached to the artifact rather than left to be noticed.
      let validation = null
      if (kind === 'decompose') {
        let listed = null, truncated = false
        try { const l = repoFileList(repo.dir); listed = l.files; truncated = l.truncated } catch { listed = null }
        validation = validateTasks(parseTasks(md), listed)
        if (truncated) {
          validation.problems.unshift({
            severity: 'warn', kind: 'checkout-truncated',
            detail: `the file walk stopped at ${WALK_CAP} paths, so a "matches nothing in the checkout" finding below may be the cap rather than a bad path`,
          })
        }
      }
      const next = readTicketArtifacts()
      next[r.key] = {
        ...(next[r.key] || {}),
        [kind]: {
          md, at: new Date().toISOString(), model: req.body?.model || 'claude',
          reqHash: reqHash(d), prContextLoaded: d.prContext?.loaded ?? false, edited: false,
          groundedIn: repo.repo, cost: out.cost ?? null, turns: out.turns ?? null,
          validation,
        },
      }
      writeTicketArtifacts(next)
      res.json({ ...next[r.key][kind], stale: false })
    } finally { run.done = true; pruneRuns() }
  })

  // ---- design state ----
  app.get('/api/ticket/:key/design', (req, res) => {
    const r = resolveWs(req, res); if (!r) return
    const s = readState(r.ws.id, r.key)
    let doc = s.doc
    if (doc?.path) {
      try {
        const body = fs.readFileSync(doc.path, 'utf8')
        doc = { ...doc, exists: true, sha: sha(body), bytes: body.length }
      } catch { doc = { ...doc, exists: false } }
    }
    const diverged = !!(doc?.exists && s.graph && s.graph.derivedFromDocSha && s.graph.derivedFromDocSha !== doc.sha)
    const bt = boardTicket(s.board?.id)
    res.json({
      ...s, doc, diverged, run: runView(runs.get(r.key)), repo: repoFor(r.ws),
      board: s.board ? { ...s.board, stage: bt?.stage ?? null, gone: !bt, title: bt?.title ?? null } : null,
      canRetryExtract: !!s.rawText,
    })
  })

  app.get('/api/ticket/:key/design/doc', (req, res) => {
    const r = resolveWs(req, res); if (!r) return
    const p = readState(r.ws.id, r.key).doc?.path
    if (!p) return res.status(404).json({ error: 'no design document has been generated for this ticket' })
    try { res.json({ path: p, md: fs.readFileSync(p, 'utf8') }) }
    catch { res.status(404).json({ error: 'the design document is gone from disk', path: p }) }
  })

  // ---- run the design agent ----
  app.post('/api/ticket/:key/design/run', async (req, res) => {
    const r = resolve(req, res); if (!r) return
    const live = inFlight()
    if (live.some(x => x.id === r.key)) return res.status(409).json({ error: `a design is already in flight for ${r.key}` })
    if (live.length >= MAX_CONCURRENT) {
      return res.status(429).json({
        error: `${live.length} agent runs are already in flight (${live.map(x => `${x.key} ${x.kind}`).join(', ')})`,
        detail: 'wait for one to finish, or cancel it',
      })
    }

    const repo = repoFor(r.ws)
    if (!repo.dir) return res.status(400).json({ error: repo.reason })
    const sameRepo = live.filter(writesRepo).find(x => x.cwd === repo.dir)
    if (sameRepo) return res.status(409).json({ error: `${sameRepo.key} is already running a design in ${repo.repo} — one design agent per repository at a time` })

    let d
    try { d = await ticketDetail(r.cfg, r.key) }
    catch (e) { return res.status(502).json({ error: `could not read ${r.key} from JIRA: ${e.message}` }) }

    const ymd = new Date().toISOString().slice(0, 10)
    const docRel = `docs/superpowers/specs/${ymd}-${r.key.toLowerCase()}-design.md`
    const stageRel = `docs/superpowers/specs/.${r.key.toLowerCase()}-design.inprogress.md`
    if (inFlight().some(x => x.id === r.key)) return res.status(409).json({ error: `a design is already in flight for ${r.key}` })

    const DESIGN_TIMEOUT = 1_800_000
    const startedAt = Date.now()
    const run = { id: r.key, key: r.key, kind: 'design', startedAt, expiresAt: startedAt + DESIGN_TIMEOUT + 60_000, events: [], listeners: new Set(), done: false, error: null, tools: 0, files: new Set(), cost: null, ms: null, cwd: repo.dir, model: req.body?.model || null, partial: null }
    runs.set(r.key, run)

    let prompt
    try { prompt = designPrompt(d, repo.repo, repo.dir, stageRel) }
    catch (e) { runs.delete(r.key); return res.status(500).json({ error: e.message }) }
    run.stageRel = stageRel
    run.docRel = docRel

    run.child = spawnAgent({
      cwd: repo.dir,
      prompt,
      model: req.body?.model,
      onEvent: ev => emit(run, ev),
      onExit: ({ error }) => {
        run.done = true
        run.error = run.cancelled ? null : (error || null)
        try {
        const stageAbs = path.join(repo.dir, run.stageRel)
        const abs = path.join(repo.dir, run.docRel)
        const clean = !run.cancelled && !error
        let partial = null
        if (fs.existsSync(stageAbs)) {
          if (clean) { try { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.renameSync(stageAbs, abs) } catch (e) { run.error = `wrote ${run.stageRel} but could not move it into place: ${e.message}` } }
          else partial = { rel: run.stageRel, path: stageAbs, bytes: (() => { try { return fs.statSync(stageAbs).size } catch { return 0 } })() }
        }
        const s = readState(r.ws.id, r.key)
        let doc = s.doc
        if (fs.existsSync(abs) && clean) {
          const body = fs.readFileSync(abs, 'utf8')
          doc = { path: abs, rel: run.docRel, sha: sha(body), genAt: new Date(run.startedAt).toISOString(), model: run.model || 'claude', edited: false, gitignored: isIgnored(repo.dir, run.docRel) }
        }
        run.partial = partial
        const text = run.events.filter(e => e.type === 'assistant').flatMap(e => (e.message?.content || []).filter(c => c.type === 'text').map(c => c.text)).join('\n')
        const parsed = parseGraph(text)
        const rawText = text.slice(-40_000)

        const isFirst = !s.graph?.nodes?.length
        const next = { ...s, cwd: repo.dir, doc, warnings: parsed.warnings, rawText,
          chat: run.sessionId ? { sessionId: run.sessionId, cwd: repo.dir } : s.chat,
          rev: (s.rev || 0) + 1,
          lastRun: { at: new Date(run.startedAt).toISOString(), cost: run.cost ?? null, ms: run.ms ?? null, tools: run.tools, filesRead: run.files.size, parsedHow: parsed.how, parseError: parsed.error },
        }
        if (parsed.graph.nodes.length && isFirst) {
          next.graph = { ...layout(parsed.graph), derivedFromDocSha: doc?.sha || null, genAt: new Date().toISOString() }
          next.pending = null
        } else if (parsed.graph.nodes.length) {
          const merged = mergeGraph(s.graph, parsed.graph)
          next.pending = {
            graph: { ...layout(merged.graph), derivedFromDocSha: doc?.sha || null, genAt: new Date().toISOString() },
            report: merged.report,
            at: new Date().toISOString(),
          }
        }
        writeState(r.ws.id, r.key, next)
        } catch (e) {
          run.error = run.error || `the run finished but its result could not be saved: ${e.message}`
        } finally {
          for (const res2 of run.listeners) { try { res2.end() } catch {} }
          run.listeners.clear()
          pruneRuns()
        }
      },
    })
    res.json({ ok: true, run: runView(run), docRel })
  })

  // ---- SSE: replay then live, so a remount reattaches mid-run ----
  app.get('/api/ticket/:key/design/events', (req, res) => {
    const key = normalizeKey(req.params.key)
    const run = key && runs.get(key)
    if (!run) return res.status(404).json({ error: 'no run for this ticket' })
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
    res.write(': connected\n\n')
    for (const ev of run.events) res.write(`data: ${JSON.stringify(ev)}\n\n`)
    if (run.done) return res.end()
    run.listeners.add(res)
    req.on('close', () => run.listeners.delete(res))
  })

  app.post('/api/ticket/:key/design/cancel', (req, res) => {
    const key = normalizeKey(req.params.key)
    const run = key && runs.get(key)
    if (!run || run.done) return res.status(404).json({ error: 'no run in flight for this ticket' })
    run.cancelled = true
    run.child?.kill()
    res.json({ ok: true })
  })

  // ---- apply or discard a pending re-derive ----
  app.post('/api/ticket/:key/design/rederive', (req, res) => {
    const r = resolveWs(req, res); if (!r) return
    const s = readState(r.ws.id, r.key)
    if (!s.pending) return res.status(404).json({ error: 'nothing pending' })
    if (req.body?.action === 'discard') return res.json(writeState(r.ws.id, r.key, { ...s, pending: null, rev: s.rev + 1 }))

    const keep = new Set(Array.isArray(req.body?.keep) ? req.body.keep : [])
    const graph = { ...s.pending.graph, nodes: [...s.pending.graph.nodes] }
    const have = new Set(graph.nodes.map(n => n.id))
    for (const id of keep) {
      const old = (s.graph?.nodes || []).find(n => n.id === id)
      if (old && !have.has(id)) { graph.nodes.push({ ...old, data: { ...old.data, orphaned: true } }); have.add(id) }
    }
    for (const e of s.graph?.edges || []) {
      if (have.has(e.source) && have.has(e.target) && !graph.edges.some(x => x.id === e.id)) graph.edges.push(e)
    }
    res.json(writeState(r.ws.id, r.key, { ...s, graph: layout(graph), pending: null, rev: s.rev + 1 }))
  })

  // ---- hand the ticket to the Task Board pipeline ----
  /**
   * Paste a JIRA link, get a board ticket with everything the ticket points at already followed:
   * the tickets it references, the Confluence pages it cites, the copy deck pulled into the repo,
   * and the Figma frames recorded as design refs.
   *
   * Anything that could not be followed is reported rather than dropped — a Confluence page behind
   * a permission or a sheet that is not link-shared has to be visible as a gap, because the whole
   * point of the card is that an agent reading it is not missing half the requirement.
   */
  app.post('/api/ticket/intake', async (req, res) => {
    const dir = path.resolve(String(req.body?.project || ''))
    const key = keyFromInput(req.body?.input)
    if (!key) return res.status(400).json({ error: 'nothing in that looked like a JIRA ticket — paste a browse or board link, or just the key' })
    if (!fs.existsSync(dir)) return res.status(400).json({ error: `${dir} is not on disk` })
    const ws = workspaceById(workspaceId(dir))
    if (!ws?.jira) return res.status(400).json({ error: `${path.basename(dir)} is not linked to a JIRA board — link it in the Ticket section first` })
    const cfg = cfgFor(ws.jira.key)
    if (!cfg) return res.status(404).json({ error: `the board "${ws.jira.key}" is no longer configured` })

    let d
    try { d = await ticketDetail(cfg, key) }
    catch (e) { return res.status(502).json({ error: `could not read ${key} from JIRA: ${e.message}` }) }

    const knownPrefixes = loadProjects().map(p => p.jiraProjectKey || p.key).filter(Boolean)
    const links = extractLinks(d.description, key, knownPrefixes)
    const unresolved = []

    const linked = []
    for (const k of links.jira.slice(0, 5)) {
      try {
        const o = await ticketDetail(cfg, k)
        linked.push({ key: k, summary: o.summary, status: o.status, description: (o.description || '').slice(0, 1500) })
      } catch (e) { unresolved.push(`${k} — ${e.message}`) }
    }

    const pages = []
    for (const p of links.confluence.slice(0, 3)) {
      const page = await confluencePage(cfg, p.id)
      if (page) pages.push(page)
      else unresolved.push(`Confluence page ${p.id} — not readable with this token`)
    }

    let contentCsv = contentCsvFor(dir, key)
    let sheet = contentCsv ? 'in-repo' : 'none'
    if (!contentCsv && links.sheets[0]?.csv) {
      contentCsv = await saveSheetCsv(links.sheets[0].csv, dir, key)
      if (contentCsv) sheet = 'fetched'
      else { sheet = 'link-only'; unresolved.push('the content sheet is not link-shared — export it to docs/' + key + '/content.csv by hand') }
    }

    const parts = [
      `JIRA: ${cfg.jiraHost ? `https://${cfg.jiraHost}/browse/${key}` : key}`,
      '', d.description || '(no description)',
    ]
    if (links.figma.length) parts.push('', '## Figma', links.figma.join('\n'))
    if (contentCsv) parts.push('', '## Agreed copy', contentCsv)
    else if (links.sheets.length) parts.push('', '## Agreed copy', `${links.sheets[0].url}\n(not fetched — the sheet is not shared by link)`)
    for (const p of pages) parts.push('', `## Confluence: ${p.title}`, p.text + (p.truncated ? '\n(truncated)' : ''))
    for (const l of linked) parts.push('', `## Linked ticket ${l.key} — ${l.summary} (${l.status})`, l.description || '(no description)')
    if (unresolved.length) parts.push('', '## Referenced but not readable', unresolved.map(u => `- ${u}`).join('\n'))

    const sources = { jira: linked.map(l => l.key), confluence: pages.map(p => p.title), sheet, unresolved }
    const designRefs = { figma: links.figma, captures: capturesFor(dir), contentCsv }

    try {
      const r2 = await fetch(`http://127.0.0.1:${DASH_PORT}/api/board/tickets`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project: dir, title: `${key} — ${d.summary}`, desc: parts.join('\n'), jiraKey: key,
          designRefs, sources, type: 'feature', team: req.body?.team || null, model: req.body?.model || null,
        }),
      })
      if (!r2.ok) throw new Error(`board ${r2.status}: ${(await r2.text()).slice(0, 200)}`)
      const t = await r2.json()
      res.json({ ok: true, id: t.id, key, title: t.title, sources, designRefs, capped: t.capped || null })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  app.post('/api/ticket/:key/board', async (req, res) => {
    const r = resolve(req, res); if (!r) return
    const repo = repoFor(r.ws)
    if (!repo.dir) return res.status(400).json({ error: repo.reason })
    const s = readState(r.ws.id, r.key)
    let d
    try { d = await ticketDetail(r.cfg, r.key) }
    catch (e) { return res.status(502).json({ error: `could not read ${r.key} from JIRA: ${e.message}` }) }

    const art = readTicketArtifacts()[r.key] || {}

    // What the agents downstream need to check the work against the design rather than against
    // their own reading of the ticket. Everything here is a pointer, not a copy: the links are
    // the ticket's own, the captures are whatever Figma Capture has already pulled into the repo,
    // and the copy deck is a file the team drops in. Absent is a normal state — design QA simply
    // does not run, rather than running against nothing and reporting a pass.
    const designRefs = {
      figma: [...new Set((d.description || '').match(/https:\/\/www\.figma\.com\/[^\s)\]]+/g) || [])],
      captures: capturesFor(repo.dir),
      contentCsv: contentCsvFor(repo.dir, r.key),
    }

    // ORDER IS LOAD-BEARING. The board caps `desc` at DESC_CAP and the dev agent is prompted with
    // `desc` alone, so whatever sits at the end is what the agent never sees. The pointers are a
    // few hundred bytes and irreplaceable — losing the Figma link on a design ticket means the
    // agent implements from prose — while the generated criteria and tests run to thousands of
    // bytes and degrade gracefully when clipped. So pointers go first and the long artifacts last.
    // Observed on AIR-10733: AC + tests alone reached the cap and dropped the design link entirely.
    const parts = [
      `JIRA: ${r.cfg.jiraHost ? `https://${r.cfg.jiraHost}/browse/${r.key}` : r.key}`,
      '', d.description || '(no description)',
    ]
    if (s.doc?.rel) parts.push('', `## Design`, `See \`${s.doc.rel}\` in this repository.`)
    if (designRefs.figma.length) parts.push('', '## Figma', designRefs.figma.join('\n'))
    if (designRefs.contentCsv) parts.push('', '## Agreed copy', designRefs.contentCsv)
    if (art.ac?.md) parts.push('', '## Acceptance criteria', art.ac.md)
    if (art.tests?.md) parts.push('', '## Test cases', art.tests.md)

    try {
      const r2 = await fetch(`http://127.0.0.1:${DASH_PORT}/api/board/tickets`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project: repo.dir, title: `${r.key} — ${d.summary}`, desc: parts.join('\n'), jiraKey: r.key, designDoc: s.doc?.rel || null, designRefs, type: 'feature' }),
      })
      if (!r2.ok) throw new Error(`board ${r2.status}: ${(await r2.text()).slice(0, 200)}`)
      const t = await r2.json()
      writeState(r.ws.id, r.key, { ...s, board: { id: t.id, at: new Date().toISOString(), project: repo.dir } })
      // The board reports a capped desc and this endpoint used to drop that on the floor, so a
      // handoff that lost its tail looked identical to one that did not. The dev agent is prompted
      // with `desc` alone — a caller that cannot tell it was clipped cannot know what the agent is
      // missing, so the count of dropped characters is carried all the way out to the UI.
      res.json({ ok: true, id: t.id, stage: t.stage, capped: t.capped || null })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  // ---- discard the partial document a cancelled run left behind ----
  app.delete('/api/ticket/:key/design/partial', (req, res) => {
    const r = resolveWs(req, res); if (!r) return
    const run = runs.get(r.key)
    if (!run?.partial) return res.status(404).json({ error: 'no partial document for this ticket' })
    try { fs.unlinkSync(run.partial.path); run.partial = null; res.json({ ok: true }) }
    catch (e) { res.status(500).json({ error: e.message }) }
  })

  // ---- re-extract the graph from the document: the cheap retry ----
  app.post('/api/ticket/:key/design/extract', (req, res) => {
    const r = resolveWs(req, res); if (!r) return
    const s = readState(r.ws.id, r.key)
    const raw = typeof req.body?.raw === 'string' ? req.body.raw : s.rawText
    if (!raw) return res.status(400).json({ error: 'no stored model output to re-extract from — run a design first' })
    const parsed = parseGraph(raw)
    if (!parsed.graph.nodes.length) return res.status(422).json({ error: parsed.error || 'no graph could be extracted', warnings: parsed.warnings })
    const merged = s.graph ? mergeGraph(s.graph, parsed.graph) : { graph: parsed.graph, report: null }
    const out = writeState(r.ws.id, r.key, { ...s, graph: { ...layout(merged.graph), derivedFromDocSha: s.doc?.sha || null, genAt: new Date().toISOString() }, warnings: parsed.warnings, rev: (s.rev || 0) + 1, mergeReport: merged.report })
    res.json(out)
  })

  // ---- structural edit, guarded by rev ----
  app.put('/api/ticket/:key/design/graph', (req, res) => {
    const r = resolveWs(req, res); if (!r) return
    const s = readState(r.ws.id, r.key)
    const want = Number(req.get('if-match') ?? req.body?.rev)
    if (Number.isFinite(want) && want !== s.rev) return res.status(409).json({ error: 'this design changed elsewhere', rev: s.rev, yours: want, graph: s.graph })
    const { graph, warnings } = validateGraph(req.body?.graph || {}, { trustPositions: true })
    const sent = new Map((req.body?.graph?.nodes || []).map(n => [n.id, n]))
    const prevById = new Map((s.graph?.nodes || []).map(n => [n.id, n]))
    for (const n of graph.nodes) {
      n.position = n.position ?? prevById.get(n.id)?.position ?? null
      n.data.origin = sent.get(n.id)?.data?.origin || prevById.get(n.id)?.data?.origin || 'user'
    }
    res.json(writeState(r.ws.id, r.key, { ...s, graph: { ...layout(graph), derivedFromDocSha: s.graph?.derivedFromDocSha ?? null }, warnings, rev: s.rev + 1 }))
  })

  // ---- positions only. No precondition: last-write-wins is correct for coordinates. ----
  app.patch('/api/ticket/:key/design/layout', (req, res) => {
    const r = resolveWs(req, res); if (!r) return
    const s = readState(r.ws.id, r.key)
    if (!s.graph) return res.status(404).json({ error: 'no graph yet' })
    const pos = req.body?.positions || {}
    const nodes = s.graph.nodes.map(n => (pos[n.id] && Number.isFinite(pos[n.id].x) && Number.isFinite(pos[n.id].y) ? { ...n, position: { x: Math.round(pos[n.id].x), y: Math.round(pos[n.id].y) } } : n))
    writeState(r.ws.id, r.key, { ...s, graph: { ...s.graph, nodes } })
    res.json({ ok: true, rev: s.rev })
  })

  // ---- ops proposed by chat, applied by the user ----
  app.post('/api/ticket/:key/design/ops', (req, res) => {
    const r = resolveWs(req, res); if (!r) return
    const s = readState(r.ws.id, r.key)
    if (!s.graph) return res.status(404).json({ error: 'no graph yet' })
    const want = Number(req.get('if-match') ?? req.body?.rev)
    if (Number.isFinite(want) && want !== s.rev) return res.status(409).json({ error: 'this design changed elsewhere', rev: s.rev, yours: want })
    const { graph, results } = applyOps(s.graph, req.body?.ops)
    if (!results.some(x => x.ok)) return res.status(422).json({ error: 'no op could be applied', results })
    const out = writeState(r.ws.id, r.key, { ...s, graph: { ...layout(graph), derivedFromDocSha: s.graph.derivedFromDocSha ?? null }, rev: s.rev + 1 })
    res.json({ ...out, results })
  })

  // ---- design chat: the assistant PROPOSES ops, the user applies them ----
  app.post('/api/ticket/:key/design/chat', async (req, res) => {
    const r = resolveWs(req, res); if (!r) return
    const s = readState(r.ws.id, r.key)
    if (!s.graph) return res.status(404).json({ error: 'no design graph yet — run a design first' })
    const question = String(req.body?.text || '').trim()
    if (!question) return res.status(400).json({ error: 'text required' })
    const cwd = s.chat?.cwd || s.cwd || repoFor(r.ws).dir
    if (!cwd) return res.status(400).json({ error: repoFor(r.ws).reason })

    const focus = (req.body?.nodeIds || []).map(id => s.graph.nodes.find(n => n.id === id)).filter(Boolean)
    const shape = s.graph.nodes.map(n => `  - id: ${n.id}\n    label: ${n.data.label}\n    type: ${n.type}${n.data.files?.length ? `\n    files: ${n.data.files.map(f => f.rel).join(', ')}` : ''}`).join('\n')
    const edges = s.graph.edges.map(e => `  - ${e.source} -> ${e.target}: ${e.label || '(unlabelled)'}`).join('\n')

    const prompt = `You are helping refine a system-design diagram for ${r.key}. The current diagram is:

nodes:
${shape}
edges:
${edges}
${focus.length ? `\nThe user is asking about: ${focus.map(n => `"${n.data.label}" (${n.id})`).join(', ')}` : ''}

Their question: ${question}
${capabilityPrompt(cwd)}

Answer in at most a short paragraph. THEN, only if the answer implies concrete changes to the
diagram, append a single fenced \`\`\`yaml block with an op list:

ops:
  - op: add-node        # add-node | remove-node | rename-node | set-note | add-edge | remove-edge
    id: some-slug
    label: Human Readable
    type: process
  - op: add-edge
    source: some-slug
    target: other-slug
    label: what moves
    kind: calls

Rules: ids are the semantic slugs above, never numbers. Never emit coordinates. Propose the
smallest set of ops that answers the question — if none are needed, omit the block entirely and
say so. You are proposing; the user decides what to apply.`

    const out = await runAgent({ cwd, prompt, resume: s.chat?.sessionId, timeoutMs: 300_000 })
    if (out.error) return res.status(502).json({ error: out.error })
    const ops = parseOps(out.result)
    if (out.sessionId) writeState(r.ws.id, r.key, { ...readState(r.ws.id, r.key), chat: { sessionId: out.sessionId, cwd } })
    res.json({ text: out.result, ops, cost: out.cost ?? null, sessionId: out.sessionId || null })
  })

  app.get('/api/ticket/:key/design/mermaid', (req, res) => {
    const r = resolveWs(req, res); if (!r) return
    const s = readState(r.ws.id, r.key)
    if (!s.graph) return res.status(404).json({ error: 'no graph yet' })
    res.type('text/plain').send(toMermaid(s.graph))
  })

  app.delete('/api/ticket/:key/design', (req, res) => {
    const r = resolveWs(req, res); if (!r) return
    try { fs.unlinkSync(ticketStateFile(r.key)) } catch {}
    res.json({ ok: true })
  })

  // ---- files: verified / planned-edit / planned-new ----
  app.get('/api/ticket/:key/files', (req, res) => {
    const r = resolveWs(req, res); if (!r) return
    const s = readState(r.ws.id, r.key)
    const repo = repoFor(r.ws)
    if (!s.graph) return res.json({ available: false, reason: 'no design graph yet — run a design first' })
    if (!repo.dir) return res.json({ available: false, reason: repo.reason })

    const stamp = `${s.rev}:${repo.dir}`
    if (s.files && s.files.stamp === stamp && req.query.fresh !== '1') return res.json({ ...s.files.payload, cached: true, computedAt: s.filesAt })

    const planned = new Map()
    for (const n of s.graph.nodes) for (const f of n.data?.files || []) {
      const cur = planned.get(f.rel) || { rel: f.rel, change: f.change, nodes: [] }
      cur.nodes.push({ id: n.id, label: n.data.label })
      if (f.change === 'modify') cur.change = 'modify'
      planned.set(f.rel, cur)
    }

    let idx
    try { idx = indexRepo(repo.dir) } catch (e) { return res.json({ available: false, reason: `could not read ${repo.dir}: ${e.message}` }) }
    const importersOf = rel => [...(idx.importers.get(rel) || [])]

    const verified = [], plannedEdit = [], plannedNew = [], warnings = []
    for (const p of planned.values()) {
      const exists = idx.fileSet.has(p.rel)
      if (!exists) {
        if (p.change === 'modify') warnings.push({ code: 'missing-file', detail: `the design says it will modify ${p.rel}, which does not exist` })
        plannedNew.push({ ...p, exists: false, importers: null, importedBy: null })
        continue
      }
      if (p.change === 'create') warnings.push({ code: 'exists-already', detail: `the design says it will create ${p.rel}, which already exists — shown as an edit` })
      const imp = importersOf(p.rel)
      plannedEdit.push({ ...p, exists: true, change: 'modify', importers: imp.length, importedBy: imp.slice(0, 25) })
    }
    const named = new Set(planned.keys())
    for (const p of plannedEdit) for (const dep of idx.imports.get(p.rel) || []) {
      if (named.has(dep) || verified.some(v => v.rel === dep)) continue
      const imp = importersOf(dep)
      verified.push({ rel: dep, exists: true, importers: imp.length, importedBy: imp.slice(0, 25), viaNodes: p.nodes })
    }

    const payload = {
      available: true, repo: { dir: repo.dir, how: repo.how },
      verified: verified.slice(0, 80), verifiedTotal: verified.length,
      plannedEdit, plannedNew, warnings,
      stats: { walked: idx.fileSet.size, truncated: idx.truncated },
      note: 'no data-flow edges are drawn between planned-new files — there is no source to parse',
    }
    const computedAt = new Date().toISOString()
    writeState(r.ws.id, r.key, { ...readState(r.ws.id, r.key), files: { stamp, payload }, filesAt: computedAt })
    res.json({ ...payload, cached: false, computedAt })
  })
}

// ---------------------------------------------------------------------------------------------
const WALK_CAP = 5000
// Just the paths. indexRepo() also reads every file's contents to build the import graph, which
// is a lot of work when all that is wanted is "does this path exist". `truncated` travels with the
// result: against a truncated list, "matches nothing in the checkout" could be the cap talking
// rather than a bad path, and the caller has to be able to say so.
function repoFileList(root) {
  const files = []
  let truncated = false
  const walk = dir => {
    if (files.length >= WALK_CAP) { truncated = true; return }
    let ents = []
    try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (files.length >= WALK_CAP) { truncated = true; return }
      if (e.name.startsWith('.') || IGNORE_DIRS.has(e.name)) continue
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) walk(abs)
      else files.push(path.relative(root, abs).split(path.sep).join('/'))
    }
  }
  walk(root)
  return { files, truncated }
}

function indexRepo(root) {
  const files = []
  let truncated = false
  const walk = dir => {
    if (files.length >= WALK_CAP) { truncated = true; return }
    let ents = []
    try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (files.length >= WALK_CAP) { truncated = true; return }
      if (e.name.startsWith('.') || IGNORE_DIRS.has(e.name)) continue
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) walk(abs)
      else if (SOURCE_EXTS.has(path.extname(e.name))) files.push(path.relative(root, abs).split(path.sep).join('/'))
    }
  }
  walk(root)
  const fileSet = new Set(files)
  const sources = new Map()
  for (const rel of files) { try { sources.set(rel, fs.readFileSync(path.join(root, rel), 'utf8')) } catch {} }
  const { importers, imports, stats } = buildImportGraph(sources, fileSet)
  return { fileSet, importers, imports, stats, truncated }
}

function isIgnored(root, rel) {
  try { return gitSafe(root, ['check-ignore', '-q', rel], { timeout: 3000 }).ok }
  catch { return false }
}
