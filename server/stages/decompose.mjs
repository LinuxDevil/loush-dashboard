// Stages 12-14 — the end of the pipeline: `decompose`, `blast-radius`, `subtickets`.
//
// This is where the dossier becomes work. Three things in here are load-bearing rather than tidy:
//
//   * **Validation findings do NOT fail `decompose`.** `parseTasks`/`validateTasks`
//     (`lib/decomposition.mjs`) compute the parallel-safety invariant that loush's parallel-worktree
//     build depends on — and nothing else in the repo enforces it — but the pipeline has no
//     auto-loop (spec §7). A failing check surfaces to a human who is already in a grilling session,
//     so the entry is `ok` and every problem rides along in the artifact and the entry.
//   * **A file with no node in the graph is a reported GAP, not an empty blast radius.** graphify's
//     node ids are symbol-based; `graphify affected "lib/paths.mjs"` answers "No unique node match".
//     Printing "0 importers" for a file the graph never indexed reads as "safe to touch" when the
//     truth is "unknown" — the empty-canvas lie in a new costume.
//   * **`subtickets` writes nothing without an explicit accepted task list.** G2 is a separate call
//     (spec §3). The runner calls every stage as `fn(ctx, {})` and `ctx` carries no `accepted`, so
//     the poller structurally cannot write `docs/<KEY>/N.md`; only the accept route can.

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { entry } from '../../lib/dossier.mjs'
import { STAGES as GRAPH, stale } from '../../lib/stage-graph.mjs'
import { parseTasks, validateTasks, matchGlob, MAX_TASKS } from '../../lib/decomposition.mjs'
import { spawnAgent } from '../../lib/agent.mjs'
import { RUNS, runId } from './agents.mjs'
import { capabilityPrompt } from '../ticket.mjs'

const AGENT_TIMEOUT = 900_000
const PROMPT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'prompts')

const KEY = key => String(key || '').toUpperCase()
const docsDir = (repoDir, key) => path.join(repoDir, 'docs', KEY(key))
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
const readRel = (repoDir, rel) => { try { return fs.readFileSync(path.resolve(repoDir, rel), 'utf8') } catch { return null } }

/** Repo-half artifacts are relative and cache-half ones absolute (spec §2), so the halves sort themselves. */
const repoHalf = e => (e?.artifacts || []).filter(p => !path.isAbsolute(p))
/** Locate one of a stage's artifacts through the MANIFEST, never by rebuilding the path. */
const artifactEnding = (manifest, stage, suffix) =>
  (manifest?.stages?.[stage]?.artifacts || []).find(p => p.endsWith(suffix)) || null

function writeDoc(repoDir, key, name, body) {
  fs.mkdirSync(docsDir(repoDir, key), { recursive: true })
  fs.writeFileSync(path.join(docsDir(repoDir, key), name), body)
  return `docs/${KEY(key)}/${name}`   // relative: the repo half travels with the clone
}

/** The checkout as the `repo` stage saw it — the list `validateTasks` checks file scopes against. */
function checkout(ctx) {
  const e = ctx.manifest?.stages?.repo
  const listed = (e?.artifacts || []).find(p => p.endsWith('files.json')) || path.join(ctx.cacheDir, 'files.json')
  const j = readJson(path.isAbsolute(listed) ? listed : path.resolve(ctx.repoDir, listed))
  return {
    files: Array.isArray(j?.files) ? j.files : null,
    // Carried, not merely noted: against a truncated list "matches nothing in the checkout" may be
    // the cap rather than a bad path, and reporting it as definite would be a lie (spec §4).
    warnings: e?.provenance?.warnings || (j?.truncated ? [{ severity: 'warn', kind: 'checkout-truncated', detail: 'the file walk was truncated, so a "matches nothing in the checkout" finding may be the cap rather than a bad path' }] : []),
  }
}

// ---------------------------------------------------------------------------------------------
// The upstream wall — same three outcomes as `stages/agents.mjs`
// ---------------------------------------------------------------------------------------------

const GENERATED = new Set(GRAPH.filter(s => s.kind === 'agent').map(s => s.stage))
const declared = name => GRAPH.find(s => s.stage === name) || { hard: [], soft: [] }

function inspect(manifest, dep) {
  const e = manifest?.stages?.[dep]
  if (!e || e.status !== 'ok') return { missing: `${dep} is ${e?.status || 'not run'}${e?.reason ? ` (${e.reason})` : ''}` }
  if (!e.provenance) return { ungrounded: `${dep} carries no provenance at all, so there is no way to tell what it was made from` }
  if (GENERATED.has(dep) && !e.provenance.groundedIn) return { ungrounded: `${dep} was written by a model and does not record what it was grounded in` }
  const s = stale(manifest, dep)
  return { got: e, ...(s.stale ? { stale: s.reason } : {}) }
}

/**
 * Every declared input, sorted into what the agent is given and what it is not. Ungrounded is a
 * wall for a soft input too: quietly excluding it and running anyway IS the warning spec §2 refuses.
 */
function sources(manifest, name) {
  const { hard, soft } = declared(name)
  const out = { hard, passed: [], excluded: [], refused: [], consumedStale: [], got: {}, why: {} }
  for (const dep of [...hard, ...soft]) {
    const r = inspect(manifest, dep)
    if (r.ungrounded) { out.refused.push(r.ungrounded); out.excluded.push(dep); continue }
    if (r.missing) { out.excluded.push(dep); out.why[dep] = r.missing; continue }
    out.passed.push(dep)
    out.got[dep] = r.got
    if (r.stale) out.consumedStale.push({ stage: dep, reason: r.stale })
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// 12. decompose
// ---------------------------------------------------------------------------------------------

/**
 * One streamed agent run, registered in `stages/agents.mjs`'s `RUNS` so the existing stop route
 * (`ticket-pipeline.mjs:410`) can kill a decompose run without knowing this module exists.
 */
function streamed({ cwd, prompt, model, key, stage, logFile, timeoutMs = AGENT_TIMEOUT }) {
  return new Promise(resolve => {
    const id = runId(key, stage)
    let sink = null
    try {
      fs.mkdirSync(path.dirname(logFile), { recursive: true })
      sink = fs.createWriteStream(logFile, { flags: 'a' })
      sink.on('error', () => { sink = null })
    } catch { sink = null }

    let final = null
    const handle = spawnAgent({
      cwd, prompt, model, timeoutMs,
      onEvent(e) {
        try { sink?.write(JSON.stringify(e) + '\n') } catch {}
        if (e?.type === 'result') final = e
      },
      onExit(x) {
        try { sink?.end() } catch {}
        RUNS.delete(id)
        if (x?.error) return resolve({ error: x.error, transcript: logFile })
        // The exit is checked before the payload: a killed child that had already flushed parseable
        // output would otherwise read as a COMPLETED run (`lib/agent.mjs:84-88`).
        if (!final) return resolve({ error: `the agent exited (code ${x?.code ?? 'null'}) without emitting a result — nothing was generated`, transcript: logFile })
        if (final.is_error) return resolve({ error: `the agent ended in error (${final.subtype || 'unknown'})`, transcript: logFile })
        resolve({
          result: String(final.result || '').trim(),
          cost: final.total_cost_usd || 0,
          turns: final.num_turns || 0,
          sessionId: final.session_id || null,
          model: Object.keys(final.modelUsage || {})[0] || model || 'claude',
          transcript: logFile,
        })
      },
    })
    RUNS.set(id, { id, key: KEY(key), stage, startedAt: Date.now(), cwd, transcript: logFile, kill: sig => handle.kill(sig), get alive() { return handle.alive } })
  })
}

export async function decompose(ctx, deps = {}) {
  const { repoDir, cacheDir, key, manifest } = ctx
  const tracked = manifest?.tracked !== false
  const src = sources(manifest, 'decompose')
  const ticketHash = manifest?.stages?.ticket?.provenance?.reqHash

  const prov = extra => ({
    groundedIn: null,
    handoff: { passed: src.passed, excluded: src.excluded },
    ...(ticketHash === undefined ? {} : { reqHash: ticketHash }),
    model: null, cost: null, turns: null,
    consumedStale: src.consumedStale,
    ...extra,
  })
  const mk = (status, reason, { provenance, ...rest } = {}) =>
    entry({ stage: 'decompose', status, reason, tracked, provenance: prov(provenance), ...rest })

  if (src.refused.length) {
    return mk('failed', `refusing to decompose from an ungrounded artifact — ${src.refused.join('; ')}. Re-run the named stage(s) so the artifact records what it was grounded in, then re-run decompose`)
  }
  const blocking = src.hard.find(d => !src.got[d])
  if (blocking) return mk('skipped', `${src.why[blocking] || `${blocking} is not available`}, and decompose cannot run without it`)

  let preamble
  try { preamble = fs.readFileSync(path.join(PROMPT_DIR, 'decompose.md'), 'utf8') }
  catch (e) { return mk('failed', `the decompose prompt (server/prompts/decompose.md) could not be read (${e.message}) — refusing to run a degraded generation`) }

  const ticketMd = readRel(repoDir, repoHalf(src.got['ticket'])[0] || '')
  if (!ticketMd) return mk('failed', `the \`ticket\` stage's artifact could not be read under ${repoDir}, so there is nothing to split`)

  // Pointers, not contents, for the supporting documents: the agent is in the repo and can Read
  // them, and inlining three documents is how a prompt reaches a cap and silently drops the end of
  // itself (`ticket.mjs:862-867`).
  const also = ['ac', 'tests', 'grilling']
    .flatMap(dep => repoHalf(src.got[dep]).map(p => `- \`${p}\` — from the \`${dep}\` stage`))

  if (RUNS.has(runId(key, 'decompose'))) {
    return mk('failed', `a decompose run for ${KEY(key)} is already in flight — refusing to start a second paid run for the same stage`)
  }

  const run = deps.run || streamed
  const out = await run({
    cwd: repoDir, prompt: `${preamble}

# The repository

You are in \`${path.basename(repoDir)}\`, checked out at \`${repoDir}\`. READ IT before you write.
${capabilityPrompt(repoDir)}

# The ticket

${ticketMd}
${also.length ? `\n# Other sources gathered for ${KEY(key)}\n\nRepo-relative; read the ones that bear on this split.\n\n${also.join('\n')}` : ''}
${src.excluded.length ? `\n# Not available\n\n${src.excluded.map(d => `- ${d}: ${src.why[d] || 'not available'}`).join('\n')}` : ''}`,
    model: deps.model, key, stage: 'decompose', logFile: path.join(cacheDir, 'decompose.stream.jsonl'),
  })

  if (out.error) return mk('failed', `the decompose agent did not finish: ${out.error}`, { provenance: { model: deps.model || null, transcript: out.transcript || null } })
  if (!out.result) return mk('failed', 'the decompose agent finished but returned no markdown', { provenance: { model: out.model || null, cost: out.cost ?? null, turns: out.turns ?? null, transcript: out.transcript || null } })

  const md = out.result.endsWith('\n') ? out.result : out.result + '\n'
  const doc = writeDoc(repoDir, key, 'decompose.md', md)

  // The check the whole pipeline exists to make. Used exactly as-is: it never throws, it reports
  // per task, and a bad heading costs that task rather than the document.
  const { files, warnings } = checkout(ctx)
  const parsed = parseTasks(md)
  const validation = validateTasks(parsed, files)
  // Prepended, not appended: whether the checkout list was complete changes how every
  // `path-not-in-repo` finding below it should be read.
  validation.problems = [...warnings, ...validation.problems]

  // Stage-to-stage data travels as an ARTIFACT FILE, never as a field on the entry (spec §2) — the
  // manifest is an index that points at artifacts, not a store for them.
  const tasksJson = writeDoc(repoDir, key, 'decompose.tasks.json', JSON.stringify({
    tasks: validation.tasks, malformed: parsed.malformed, problems: validation.problems,
    counts: validation.counts, filesChecked: validation.filesChecked, note: validation.note,
  }, null, 2))

  const { errors, warnings: warns } = validation.counts
  return mk('ok', [
    // `ok` WITH findings is the point: they surface to the human at G2, who is already in a
    // grilling session. There is no auto-loop and no retry governor (spec §7).
    errors || warns ? `${errors} error(s) and ${warns} warning(s) against this split — read them at gate G2 before accepting` : null,
    parsed.malformed.length ? `${parsed.malformed.length} heading(s) could not be parsed as a task and were dropped from the list` : null,
    validation.filesChecked ? null : validation.note,
    src.excluded.length ? `generated without ${src.excluded.map(d => `${d} (${src.why[d] || 'refused'})`).join(', ')}` : null,
    src.consumedStale.length ? `consumed stale input: ${src.consumedStale.map(s => s.reason).join('; ')}` : null,
    tracked ? null : 'the workspace is not a git repo, so this artifact is written but not tracked',
  ].filter(Boolean).join(' · ') || null, {
    artifacts: [doc, tasksJson],
    provenance: {
      groundedIn: path.basename(repoDir),
      model: out.model || null, cost: out.cost ?? null, turns: out.turns ?? null,
      sessionId: out.sessionId || null, transcript: out.transcript || null,
      counts: validation.counts, maxTasks: MAX_TASKS, validationOk: validation.ok,
    },
  })
}

// ---------------------------------------------------------------------------------------------
// 13. blast-radius
// ---------------------------------------------------------------------------------------------

/**
 * How many files one blast-radius run will ask the graph about. A decomposition is capped at 10
 * tasks but nothing caps its file lists, and each question is a separate process — so the cap is
 * here rather than in the loop, and whatever it drops is named in the artifact.
 */
const FILE_CAP = 40

/** The accepted-or-proposed task list, located through the manifest. */
const readTasks = ({ repoDir, manifest }) => {
  const rel = artifactEnding(manifest, 'decompose', '.tasks.json')
  return rel ? readJson(path.resolve(repoDir, rel)) : null
}

/**
 * One `graphify affected` question.
 *
 * The CLI prints `warning: skill dir exists but SKILL.md is missing` to stderr on EVERY call and
 * exits 0 for a node it cannot find, so neither stderr nor the exit code says anything about the
 * answer — only stdout does.
 */
const graphify = (args, cwd) => {
  const r = spawnSync('graphify', args, { cwd, encoding: 'utf8', timeout: 60_000 })
  return { ok: !r.error, stdout: r.stdout || '', error: r.error ? String(r.error.message || r.error) : null }
}

/**
 * `graphify affected "<name>"`'s output.
 *
 * `node: false` is the distinction the whole stage turns on: "the graph has no node for this" is
 * NOT "nothing imports this". Only a matched node can honestly report zero importers.
 */
export function parseAffected(stdout) {
  const text = String(stdout || '')
  if (/No unique node match/i.test(text)) return { node: false, importers: [] }
  const importers = text.split('\n').filter(l => l.startsWith('- ')).map(l => {
    const m = /^- (.+?) \[(.+?)\] (.+)$/.exec(l.trim())
    return m ? { label: m[1], relation: m[2], at: m[3] } : { label: l.slice(2).trim(), relation: null, at: null }
  })
  if (!importers.length && !/Affected nodes for/i.test(text)) return { node: false, importers: [] }
  return { node: true, importers }
}

export async function blastRadius(ctx, deps = {}) {
  const { repoDir, key, manifest } = ctx
  const tracked = manifest?.tracked !== false
  const mk = (status, reason, rest = {}) => entry({ stage: 'blast-radius', status, reason, tracked, ...rest })

  const tasks = readTasks(ctx)?.tasks
  if (!Array.isArray(tasks)) return mk('skipped', 'the `decompose` stage has no readable task list in the manifest — there are no files to ask the graph about')

  // Refuse rather than build (spec §1): the tab never spends a graph build's time or tokens, and a
  // graph it built itself would be a graph nobody asked for.
  const graphFile = path.join(repoDir, 'graphify-out', 'graph.json')
  if (!fs.existsSync(graphFile)) {
    return mk('unavailable', `no graphify graph exists for ${path.basename(repoDir)} (expected graphify-out/graph.json) — blast radius is refused rather than built here, so run \`graphify extract .\` in the repo if you want it`)
  }
  // graphify's OWN manifest — file → {mtime, ast_hash, semantic_hash}. `graph.json` itself is
  // 1.4MB and is never read by this stage; only its existence is checked above.
  const indexed = readJson(path.join(repoDir, 'graphify-out', 'manifest.json')) || {}
  const indexedNames = Object.keys(indexed)
  if (!indexedNames.length) {
    return mk('unavailable', 'graphify-out/manifest.json lists no indexed files, so nothing can be mapped from a file to a graph node — the graph cannot answer for this checkout')
  }

  const repoFiles = checkout(ctx).files
  // Every file the split proposes, expanded once. A glob is resolved against the checkout because
  // the graph is indexed by real files, not by patterns.
  const wanted = new Map()   // file (or unresolved pattern) → task ids
  for (const t of tasks) {
    for (const pattern of t.files || []) {
      const hits = repoFiles ? matchGlob(pattern, repoFiles) : []
      for (const f of (hits.length ? hits : [pattern])) {
        if (!wanted.has(f)) wanted.set(f, [])
        if (!wanted.get(f).includes(t.id)) wanted.get(f).push(t.id)
      }
    }
  }

  const all = [...wanted.keys()]
  const asked = all.slice(0, FILE_CAP)
  const run = deps.graphify || graphify
  const results = [], gaps = [], staleFiles = []
  let cliError = null

  for (const file of asked) {
    const tasksFor = wanted.get(file)
    const record = indexed[file]
    if (!record) {
      // NOT "0 importers". A file the graph never indexed has an UNKNOWN blast radius, and
      // reporting zero would read as "safe to touch".
      gaps.push({ file, tasks: tasksFor, kind: 'not-indexed', detail: `${file} is not in graphify-out/manifest.json, so the graph was never built over it — its blast radius is unknown, not zero` })
      continue
    }
    // Staleness is per file, intersected with the files under test (spec §1). `ast_hash` is
    // graphify's own hash of the extracted AST and is not a content hash we can recompute here, so
    // the comparison that CAN be made honestly is the recorded mtime against the file on disk.
    try {
      const now = fs.statSync(path.join(repoDir, file)).mtimeMs / 1000
      if (Number.isFinite(record.mtime) && now > record.mtime + 1) {
        staleFiles.push({ file, detail: `${file} has changed since the graph indexed it, so its importers below may be out of date` })
      }
    } catch { /* the file is proposed but not on disk yet — a create, already reported by validateTasks */ }

    // Node ids are symbol-based, so a FILE is asked for by its basename: `affected "lib/paths.mjs"`
    // answers "No unique node match", `affected "paths.mjs"` finds the file node.
    const out = run(['affected', path.basename(file), '--graph', graphFile], repoDir)
    if (!out.ok) { cliError = out.error; break }
    const { node, importers } = parseAffected(out.stdout)
    if (!node) {
      gaps.push({ file, tasks: tasksFor, kind: 'no-node', detail: `the graph has no unique node for "${path.basename(file)}" (it is indexed, but the name is ambiguous or carries no symbol node) — its blast radius is unknown, not zero` })
      continue
    }
    results.push({ file, tasks: tasksFor, importers: importers.length, sample: importers.slice(0, 10) })
  }

  if (cliError) {
    return mk('unavailable', `the graphify CLI could not be run (${cliError}) — blast radius is unknown for this split rather than empty`)
  }

  const dropped = all.slice(FILE_CAP)
  const artifact = writeDoc(repoDir, key, 'blast-radius.json', JSON.stringify({
    files: results, gaps, stale: staleFiles,
    notAsked: dropped.map(f => ({ file: f, why: `over the per-run cap of ${FILE_CAP} files` })),
  }, null, 2))

  const heavy = results.filter(r => r.importers >= 20)
  return mk('ok', [
    // The check on the split this stage exists to be: "task 3 touches a file with 40 importers — is
    // that one task?" belongs beside `validateTasks` at G2.
    heavy.length ? `${heavy.length} file(s) have 20+ importers: ${heavy.slice(0, 3).map(r => `${r.file} (${r.importers})`).join(', ')}` : null,
    gaps.length ? `${gaps.length} file(s) have no node in the graph — their blast radius is UNKNOWN, not zero` : null,
    staleFiles.length ? `${staleFiles.length} file(s) changed since the graph was built, so their importers may be out of date` : null,
    dropped.length ? `${dropped.length} file(s) over the ${FILE_CAP}-file cap were not asked about` : null,
  ].filter(Boolean).join(' · ') || null, {
    artifacts: [artifact],
    provenance: {
      groundedIn: 'graphify-cli',
      handoff: { passed: ['decompose'], excluded: [] },
      asked: asked.length, indexedFiles: indexedNames.length, gaps: gaps.length, stale: staleFiles.length,
    },
  })
}

// ---------------------------------------------------------------------------------------------
// 14. subtickets — the sink. G2 gates it.
// ---------------------------------------------------------------------------------------------

/**
 * The handoff budget (`board.mjs:553`, spec §2). The dev agent is prompted with the sub-ticket body
 * alone, so whatever sits past this cap is what it never reads.
 */
export const DESC_CAP = 20_000

const NOT_ACCEPTED = 'the split has not been accepted at gate G2 — nothing is written to docs/<KEY>/N.md until a human accepts the task list, so this stage has nothing to do'

/** A `## Heading` section, or null when there is nothing to say — an empty heading says nothing. */
const section = (title, lines) => (lines.filter(Boolean).length ? `## ${title}\n\n${lines.filter(Boolean).join('\n')}` : null)

/**
 * One sub-ticket body, in loush format, under the budget.
 *
 * ORDER IS LOAD-BEARING and was learned from a real failure: AC + tests alone reached the cap and
 * dropped the Figma link entirely, so the dev agent implemented from prose. Pointers are a few
 * hundred bytes and irreplaceable; the generated artifacts run to thousands and degrade gracefully
 * when clipped. So head sections are always written and the long tail is appended only while it
 * fits — and what did not fit is RETURNED, so the caller can tell.
 */
export function renderSubticket({ key, task, head, tail, cap = DESC_CAP }) {
  const parts = [`# ${KEY(key)} — ${task.id}. ${task.title}`, ...head.filter(Boolean)]
  let body = parts.join('\n\n')
  const dropped = []
  for (const t of tail) {
    if (!t.body) continue
    const next = `${body}\n\n## ${t.title}\n\n${t.body.trim()}`
    if (next.length > cap) { dropped.push(t.title); continue }
    body = next
  }
  return { body: body.endsWith('\n') ? body : body + '\n', dropped }
}

/**
 * @param {object} ctx  the ordinary stage context, PLUS `accepted: {tasks: [...]}` — the task list a
 *                      human accepted at G2, which only the accept route passes. Its absence is why
 *                      the poller cannot write sub-tickets.
 */
export async function subtickets(ctx, deps = {}) {
  const { repoDir, key, manifest, accepted } = ctx
  const tracked = manifest?.tracked !== false
  const mk = (status, reason, rest = {}) => entry({ stage: 'subtickets', status, reason, tracked, ...rest })

  const tasks = Array.isArray(accepted?.tasks) ? accepted.tasks : null
  if (!tasks) return mk('skipped', NOT_ACCEPTED)
  if (!tasks.length) return mk('skipped', 'the accepted task list is empty, so there is no sub-ticket to write')

  const repoFiles = checkout(ctx).files
  // Re-checked against the checkout at write time, not trusted from the proposal: the human edits
  // the split inline at G2, so the list being written is not the list that was validated.
  const validation = validateTasks({ tasks, malformed: [] }, repoFiles)

  // ---- pointers. Small, irreplaceable, and therefore first ----
  const links = (() => {
    const rel = artifactEnding(manifest, 'links', 'links.json')
    return (rel && readJson(path.resolve(repoDir, rel))) || {}
  })()
  const docFor = stage => repoHalf(manifest?.stages?.[stage]).find(p => p.endsWith('.md')) || null
  const jiraUrl = manifest?.stages?.ticket?.sourceUrl
  const design = docFor('design-read'), acDoc = docFor('ac'), testDoc = docFor('tests'), grilling = docFor('grilling')
  const deck = (links.sheets || []).map(s => s.url)
  const figma = (links.figma || []).map(f => (typeof f === 'string' ? f : f.url || f.id)).filter(Boolean)

  const pointers = [
    jiraUrl ? `- JIRA: ${jiraUrl}` : null,
    ...figma.map(u => `- Figma: ${u}`),
    ...deck.map(u => `- Copy deck: ${u}`),
    design ? `- Design read: \`${design}\`` : null,
    grilling ? `- Decisions from the grilling: \`${grilling}\`` : null,
    acDoc ? `- Acceptance criteria (full): \`${acDoc}\`` : null,
    testDoc ? `- Test plan (full): \`${testDoc}\`` : null,
  ].filter(Boolean)

  const blast = (() => {
    const rel = artifactEnding(manifest, 'blast-radius', 'blast-radius.json')
    return (rel && readJson(path.resolve(repoDir, rel))) || null
  })()
  const acFull = acDoc ? readRel(repoDir, acDoc) : null
  const testFull = testDoc ? readRel(repoDir, testDoc) : null

  // A pattern that matches the checkout expands to what it matches; one that matches nothing is
  // kept verbatim, because that is a file the task is going to CREATE.
  const expand = pattern => {
    const hits = repoFiles ? matchGlob(pattern, repoFiles) : []
    return hits.length ? hits : [pattern]
  }
  const owned = new Map(tasks.map(t => [t.id, new Set((t.files || []).flatMap(expand))]))

  const written = [], capped = []
  for (const t of tasks) {
    const mine = owned.get(t.id) || new Set()
    const existing = [...mine].filter(f => !repoFiles || repoFiles.includes(f))
    const creating = [...mine].filter(f => repoFiles && !repoFiles.includes(f))
    const others = [...new Set(tasks.filter(o => o.id !== t.id).flatMap(o => [...(owned.get(o.id) || [])]))].filter(f => !mine.has(f))

    const deps2 = (t.dependsOn || []).map(d => {
      const dep = tasks.find(x => x.id === d)
      return `- ${d}${dep ? ` — ${dep.title}` : ' — not in the accepted list'}`
    })
    const radius = blast ? [
      ...(blast.files || []).filter(r => mine.has(r.file)).map(r => `- \`${r.file}\` — ${r.importers} importer(s)${r.importers >= 20 ? ' — heavily depended on; change it narrowly' : ''}`),
      // The gap, said in words. "0 importers" for an unindexed file would read as "safe to touch".
      ...(blast.gaps || []).filter(g => mine.has(g.file)).map(g => `- \`${g.file}\` — blast radius UNKNOWN: ${g.detail}`),
      ...(blast.stale || []).filter(s => mine.has(s.file)).map(s => `- \`${s.file}\` — ${s.detail}`),
    ] : []

    const conflicts = validation.problems.filter(p => (p.tasks || []).includes(t.id) || p.task === t.id)

    const head = [
      `Size: ${t.size || 'not given'} · Depends on: ${(t.dependsOn || []).join(', ') || 'nothing'}`,
      section('Depends on', deps2.length ? deps2 : ['- Nothing. This task can start immediately.']),
      section('Task description', [String(t.body || '').trim() || '(the accepted task carried no description)']),
      section('Context and pointers', pointers.length ? pointers : ['- No sources were gathered for this ticket — implement from the description above and say so in the done note.']),
      section('Files to modify', existing.map(f => `- ${f}`)),
      section('Files to create', creating.map(f => `- ${f}`)),
      // The parallel-safety invariant, made operational for the agent that reads this file: every
      // path another accepted task owns. loush runs these in parallel worktrees.
      section('Must NOT touch', others.length ? [...others.slice(0, 30).map(f => `- ${f}`), others.length > 30 ? `- (+${others.length - 30} more files owned by other sub-tickets)` : null] : ['- Nothing else is claimed by another sub-ticket.']),
      section('Blast radius', radius),
      section('Findings against this task', conflicts.map(p => `- ${p.severity}: ${p.detail}`)),
    ]

    const { body, dropped } = renderSubticket({
      key, task: t, head,
      tail: [{ title: 'Acceptance criteria', body: acFull }, { title: 'Test cases', body: testFull }],
    })
    written.push(writeDoc(repoDir, key, `${t.id}.md`, body))
    if (dropped.length) capped.push({ file: `${t.id}.md`, dropped })
  }

  // A leftover `4.md` from an earlier, larger accept would be handed to `/loush-feature` as a
  // sub-ticket nobody accepted. Removed, and named in the reason rather than removed quietly.
  const keep = new Set(written.map(p => path.basename(p)))
  const removed = []
  try {
    for (const f of fs.readdirSync(docsDir(repoDir, key))) {
      if (/^\d+\.md$/.test(f) && !keep.has(f)) { fs.rmSync(path.join(docsDir(repoDir, key), f)); removed.push(f) }
    }
  } catch { /* the dir is what we just wrote into; a read failure leaves the extra files in place */ }

  const errs = validation.problems.filter(p => p.severity === 'error')
  return mk('ok', [
    // Surfaced as a persistent panel by the caller, never a toast (spec §2): it changes what the
    // dev agent read.
    capped.length ? `clipped at ${DESC_CAP} chars: ${capped.map(c => `${c.file} dropped ${c.dropped.join(' and ')}`).join('; ')} — the pointers, files and blast radius were kept` : null,
    errs.length ? `${errs.length} error-level finding(s) stand against the accepted split: ${errs.slice(0, 2).map(p => p.detail).join('; ')}` : null,
    removed.length ? `removed ${removed.join(', ')} from an earlier, larger accept` : null,
    tracked ? null : 'the workspace is not a git repo, so these sub-tickets are written but not tracked',
  ].filter(Boolean).join(' · ') || null, {
    artifacts: written,
    provenance: {
      groundedIn: path.basename(repoDir),
      handoff: { passed: ['decompose', ...(blast ? ['blast-radius'] : [])], excluded: blast ? [] : ['blast-radius'] },
      accepted: tasks.length, capped, descCap: DESC_CAP, problems: validation.problems,
    },
  })
}

/** Keyed by the stage name in spec §1's table, so the runner looks one up rather than importing three. */
export const STAGES = {
  'decompose': decompose,
  'blast-radius': blastRadius,
  'subtickets': subtickets,
}
