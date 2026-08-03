// Stages 8-10 — the agent stages: `design-read`, `ac`, `tests`.
//
// Three of the four stages in the whole pipeline that spend tokens (spec §1). That is the reason for
// everything unusual in here:
//
//   * **Provenance is assembled before the run, not after it.** Two AC generators already wrote the
//     same slot on disk, one of them unable to read the repo, with nothing distinguishing them
//     (`TRN-310.ac` has no `groundedIn`, `TRN-310.tests` does). `groundedIn` + `handoff` is the field
//     that makes that impossible to repeat, so it is also filled in on a refusal — a stage that did
//     not run must still be able to say what it would have been given.
//   * **An ungrounded upstream is a wall, not a warning** (spec §2). Stale-but-grounded is the other
//     thing entirely: consumable, recorded in `consumedStale`, and carried on past. Conflating the two
//     makes the grounding rule unenforceable in one direction and unusable in the other.
//   * **Streamed `spawn`, run state server-side keyed by ticket.** `claudeMarkdown`
//     (`eng.mjs:1186`) uses blocking `spawnSync` and its own comment admits that is wrong: a 15-minute
//     child that cannot be watched or killed is a run that keeps spending after the caller gave up.
//   * **One run per stage. No second tool-less re-extraction pass.** `design.md` §4.2's two-run pattern
//     is explicitly not inherited (spec §0): these stages emit markdown with declared fields, and a
//     stage that wants JSON back from an agent is a design smell here.
//
// `design-read` exists as its own stage so that re-reading the design does not force regenerating AC —
// and because the `figma` stage is a pure fetcher by design, ALL interpretation of the design lives
// here.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { entry } from '../../lib/dossier.mjs'
import { STAGES as GRAPH, stale } from '../../lib/stage-graph.mjs'
import { spawnAgent } from '../../lib/agent.mjs'
import { capabilityPrompt } from '../ticket.mjs'

const AGENT_TIMEOUT = 900_000   // same budget as the existing generate path (`ticket.mjs:553`)

const PROMPT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'prompts')
const KEY = key => String(key || '').toUpperCase()
const docsDir = (repoDir, key) => path.join(repoDir, 'docs', KEY(key))

/** Repo-half artifacts are relative and cache-half ones absolute (spec §2), so the halves sort themselves. */
const repoHalf = e => (e?.artifacts || []).filter(p => !path.isAbsolute(p))
const readRel = (repoDir, rel) => { try { return fs.readFileSync(path.resolve(repoDir, rel), 'utf8') } catch { return null } }

function promptFile(name) {
  try { return fs.readFileSync(path.join(PROMPT_DIR, name), 'utf8') }
  catch (e) { console.error(`[stages/agents] cannot read prompt ${name} from ${PROMPT_DIR}: ${e.message}`); return null }
}

function writeDoc(repoDir, key, name, body) {
  fs.mkdirSync(docsDir(repoDir, key), { recursive: true })
  fs.writeFileSync(path.join(docsDir(repoDir, key), name), body)
  return `docs/${KEY(key)}/${name}`   // relative: the repo half travels with the clone
}

// ---------------------------------------------------------------------------------------------
// The upstream wall
// ---------------------------------------------------------------------------------------------

/**
 * Stages whose artifact a MODEL wrote. The grounding wall applies to these: a fetch stage names its
 * source by construction (`sourceUrl`, an HTTP status, a file key), but a generated document is worth
 * exactly what it was grounded in and nothing else — which is the distinction that was missing from
 * disk when two AC generators shared one slot.
 */
const GENERATED = new Set(GRAPH.filter(s => s.kind === 'agent').map(s => s.stage))
const declared = name => GRAPH.find(s => s.stage === name) || { hard: [], soft: [] }

/**
 * What consuming one upstream stage costs. Three outcomes, deliberately distinct:
 * `missing` (nothing to give), `ungrounded` (a wall), `stale` (a warning, and consumable).
 */
function inspect(manifest, dep) {
  const e = manifest?.stages?.[dep]
  if (!e || e.status !== 'ok') return { missing: `${dep} is ${e?.status || 'not run'}${e?.reason ? ` (${e.reason})` : ''}` }
  if (!e.provenance) return { ungrounded: `${dep} carries no provenance at all, so there is no way to tell what it was made from` }
  if (GENERATED.has(dep) && !e.provenance.groundedIn) return { ungrounded: `${dep} was written by a model and does not record what it was grounded in` }
  const s = stale(manifest, dep)
  return { got: e, ...(s.stale ? { stale: s.reason } : {}) }
}

/**
 * Every declared input of a stage, sorted into what the agent will be given and what it will not.
 * The graph is read from `lib/stage-graph.mjs` rather than restated — a stage that disagrees with the
 * graph about its own inputs is a stage whose `handoff` lies.
 */
function sources(manifest, name) {
  const { hard, soft } = declared(name)
  const out = { hard, passed: [], excluded: [], refused: [], consumedStale: [], got: {}, why: {} }
  for (const dep of [...hard, ...soft]) {
    const r = inspect(manifest, dep)
    // Ungrounded is a wall for a soft input too. Quietly excluding it and running anyway IS the
    // warning the spec refuses: the artifact exists, it is being ignored, and nobody is told why.
    if (r.ungrounded) { out.refused.push(r.ungrounded); out.excluded.push(dep); continue }
    if (r.missing) { out.excluded.push(dep); out.why[dep] = r.missing; continue }
    out.passed.push(dep)
    out.got[dep] = r.got
    if (r.stale) out.consumedStale.push({ stage: dep, reason: r.stale })
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------

/**
 * Runs in flight, keyed `<KEY>:<stage>` — server-side, because a `claude -p` child outlives the
 * request that started it and React remounts the section on every refresh (spec §5). Holds the kill
 * handle and the transcript path the live view tails.
 */
export const RUNS = new Map()

/** The `runId` a caller needs to find or stop a run without knowing this module's internals. */
export const runId = (key, stage) => `${KEY(key)}:${stage}`

/**
 * One streamed agent run. Resolves `{result, cost, turns, model}` or `{error}` — it never throws and
 * never rejects, because every failure mode here is an expected one that belongs in an entry.
 *
 * The stream is appended to a jsonl file as it arrives rather than buffered: the parent holds the only
 * copy otherwise, so a restart mid-run takes the whole output with it while the child carries on
 * spending (`lib/agent.mjs:62-66`). It doubles as the file the live route tails.
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
        // A killed child that had already flushed parseable output would otherwise read as a
        // COMPLETED run (`lib/agent.mjs:84-88`) — the exit is checked before the payload for that
        // reason, not for tidiness.
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

// ---------------------------------------------------------------------------------------------
// The shape all three share
// ---------------------------------------------------------------------------------------------

/**
 * `build(ctx, src)` returns `{prompt, cwd, groundedIn, notes}` — or `{error}` for a refusal it alone
 * can detect. Everything else (the wall, the run, the artifact, the entry) is identical across the
 * three stages and lives here, so a fourth agent stage is a `build` and not another copy of this.
 *
 * `ctx.run` / `ctx.model` are a TEST SEAM in the same place `jira.mjs` and `sheet.mjs` keep theirs —
 * an extra ctx property defaulting to the real thing, which the runner never passes. Stubbing the
 * run beats mocking `lib/agent.mjs`, and a test that reached the real `claude` would spend money.
 */
async function agentStage(name, artifactName, ctx, build) {
  const { repoDir, cacheDir, key, manifest, run = streamed, model = null } = ctx
  const tracked = manifest?.tracked !== false
  const src = sources(manifest, name)
  const ticketHash = manifest?.stages?.ticket?.provenance?.reqHash

  const prov = extra => ({
    groundedIn: null,
    handoff: { passed: src.passed, excluded: src.excluded },
    // Omitted rather than nulled when unknown: `stale()` reads a `reqHash` that is present but does
    // not match as "the ticket changed since it was generated", so a null here would badge the
    // artifact stale forever. Absent means "cannot tell", which is the honest answer (`eng.mjs:1179`).
    ...(ticketHash === undefined ? {} : { reqHash: ticketHash }),
    model: null, cost: null, turns: null,
    consumedStale: src.consumedStale,
    ...extra,
  })
  const mk = (status, reason, { provenance, ...rest } = {}) =>
    entry({ stage: name, status, reason, tracked, provenance: prov(provenance), ...rest })

  // The wall. Naming the stage to regenerate is the whole value of refusing here rather than warning:
  // `ac` is a HARD input to grilling, so this reason is what a human has to act on.
  if (src.refused.length) {
    return mk('failed', `refusing to generate ${name} from an ungrounded artifact — ${src.refused.join('; ')}. Re-run the named stage(s) so the artifact records what it was grounded in, then re-run ${name}`)
  }

  const blocking = src.hard.find(d => !src.got[d])
  if (blocking) return mk('skipped', `${src.why[blocking] || `${blocking} is not available`}, and ${name} cannot run without it`)

  const built = build(ctx, src)
  if (built.error) return mk('failed', built.error)

  if (RUNS.has(runId(key, name))) {
    return mk('failed', `a ${name} run for ${KEY(key)} is already in flight — refusing to start a second paid run for the same stage`)
  }

  const out = await run({
    cwd: built.cwd, prompt: built.prompt, model, key, stage: name,
    logFile: path.join(cacheDir, `${name}.stream.jsonl`),
  })
  if (out.error) return mk('failed', `the ${name} agent did not finish: ${out.error}`, { provenance: { model, transcript: out.transcript || null } })
  if (!out.result) return mk('failed', `the ${name} agent finished but returned no markdown`, { provenance: { model: out.model || null, cost: out.cost ?? null, turns: out.turns ?? null, transcript: out.transcript || null } })

  // Written verbatim. The manifest next to it is the provenance store, and a header restating it here
  // is a second copy free to drift from the first.
  const artifact = writeDoc(repoDir, key, artifactName, out.result.endsWith('\n') ? out.result : out.result + '\n')

  const notes = [
    ...(built.notes || []),
    src.excluded.length ? `generated without ${src.excluded.map(d => `${d} (${src.why[d] || 'refused'})`).join(', ')}` : null,
    src.consumedStale.length ? `consumed stale input: ${src.consumedStale.map(s => s.reason).join('; ')}` : null,
    tracked ? null : 'the workspace is not a git repo, so this artifact is written but not tracked',
  ].filter(Boolean)

  return mk('ok', notes.join(' · ') || null, {
    artifacts: [artifact],
    provenance: {
      groundedIn: built.groundedIn,
      model: out.model || null,
      cost: out.cost ?? null,
      turns: out.turns ?? null,
      sessionId: out.sessionId || null,
      transcript: out.transcript || null,
    },
  })
}

// ---------------------------------------------------------------------------------------------
// 8. design-read — the only place the design is interpreted
// ---------------------------------------------------------------------------------------------

const DESIGN_PROMPT = `You are a senior engineer reading a design so that nobody downstream has to open Figma.

The stage that fetched this design interpreted none of it — it pruned a 2.4M-char node tree to a
depth-2 outline, rendered a zoom ladder of screenshots and filtered the comment threads. Every
judgement about what the design SAYS is yours, and this document is the only place it gets made.

# Output

Markdown, no preamble, in this order:

1. \`## Screens\` — one bullet per screen: what it IS, named by what it does. Do not trust the layer
   name: in one real file 19 of ~24 screens were all named \`Desktop\`, so a document that repeats the
   names describes nothing. Cite the node id you are describing.
2. \`## What the design specifies\` — the states, transitions, empty/loading/error treatments,
   validation and interaction rules you can actually see. Each with the screen or node it comes from.
3. \`## Copy\` — the strings the design commits to, and whether the copy deck agrees with the mockups
   where both exist. A mismatch is a finding, not a detail to smooth over.
4. \`## Open questions from the design\` — mandatory and non-empty: what the design leaves undecided,
   and what the unresolved comment threads are still arguing about. This feeds a grilling session, so
   a question here is worth more than a guess above.
5. \`## Not in the design\` — what a reader must NOT assume was designed. A confident read of a partial
   design is the failure mode here.

Never describe a screen you did not look at, and never state a rule the design does not show. If the
screenshots are missing or unreadable, say so and mark what you inferred from the outline alone.`

export async function designRead(ctx) {
  return agentStage('design-read', 'design.md', ctx, ({ repoDir }, src) => {
    const fig = src.got['figma']
    const shots = (fig.provenance?.cache || []).filter(p => /\.png$/i.test(p))
    const deck = repoHalf(src.got['sheet'])[0] || null

    const files = [
      ...repoHalf(fig).map(p => `- \`${path.resolve(repoDir, p)}\` — ${p.includes('comments') ? 'the open comment threads' : 'the depth-2 node outline'}`),
      ...shots.map(p => `- \`${p}\` — a screenshot (PNG; use Read, it renders images)`),
      deck ? `- \`${path.resolve(repoDir, deck)}\` — the copy deck, as CSV` : null,
    ].filter(Boolean)

    return {
      cwd: repoDir,
      // The sources actually read, not the ones nominally available — the whole point of the field.
      groundedIn: ['figma-artifacts', shots.length ? `${shots.length} screenshots` : 'no screenshots', deck ? 'copy-deck' : null].filter(Boolean).join('+'),
      notes: shots.length ? [] : ['no screenshots were rendered, so the read is from the node outline and comments alone'],
      prompt: `${DESIGN_PROMPT}

# What you have

Read every one of these before you write. Absolute paths; the PNGs are in a machine-local cache.

${files.join('\n')}
${deck ? '' : '\nThere is no copy deck for this ticket, so no string can be checked against one — say so rather than implying the mockup text is confirmed.'}`,
    }
  })
}

// ---------------------------------------------------------------------------------------------
// 9. ac — `server/prompts/ac.md`, with the repository open
// ---------------------------------------------------------------------------------------------

export async function ac(ctx) {
  return agentStage('ac', 'ac.md', ctx, ({ repoDir, key }, src) => {
    const preamble = promptFile('ac.md')
    // Same refusal as `ticket.mjs:532`: a generation missing its prompt would produce something that
    // looks like AC and is not, which is worse than nothing.
    if (!preamble) return { error: 'the ac prompt (server/prompts/ac.md) could not be read — refusing to run a degraded generation' }

    const ticket = readRel(repoDir, repoHalf(src.got['ticket'])[0] || '')
    if (!ticket) return { error: `the \`ticket\` stage's artifact could not be read under ${repoDir}, so there is no requirement to write criteria against` }

    // Pointers, not contents, for the supporting sources: the agent is in the repo and can Read them,
    // and inlining three documents is how a prompt reaches a cap and silently drops the end of itself
    // (`ticket.mjs:862-867`).
    const also = ['design-read', 'sheet', 'confluence']
      .flatMap(dep => repoHalf(src.got[dep]).map(p => `- \`${p}\` — from the \`${dep}\` stage`))

    return {
      cwd: repoDir,
      // The repo it could actually read. This is the field that would have told the two colliding AC
      // generators apart — one of them could not read a repository at all.
      groundedIn: path.basename(repoDir),
      prompt: `${preamble}

# The repository

You are in \`${path.basename(repoDir)}\`, checked out at \`${repoDir}\`. READ IT before you write.
${capabilityPrompt(repoDir)}

# The ticket

${ticket}
${also.length ? `\n# Other sources gathered for ${KEY(key)}\n\nRepo-relative; read the ones that bear on this ticket.\n\n${also.join('\n')}` : ''}
${src.excluded.length ? `\n# Not available\n\n${src.excluded.map(d => `- ${d}: ${src.why[d] || 'not available'}`).join('\n')}\n\nDo not write criteria that assume these — that is what \`## Unspecified — needs an answer\` is for.` : ''}`,
    }
  })
}

// ---------------------------------------------------------------------------------------------
// 10. tests — fed the STORED ac.md, not the ticket
// ---------------------------------------------------------------------------------------------

export async function tests(ctx) {
  return agentStage('tests', 'tests.md', ctx, ({ repoDir }, src) => {
    const preamble = promptFile('tests.md')
    if (!preamble) return { error: 'the tests prompt (server/prompts/tests.md) could not be read — refusing to run a degraded generation' }

    // The real two-stage chain (`ticket.mjs:537,553`): the plan is written against the criteria that
    // were AGREED and stored, not against the ticket prose. Rows cite AC ids, and an id can only mean
    // something if the criteria it points at are the ones on disk.
    const rel = repoHalf(src.got['ac'])[0] || ''
    const criteria = readRel(repoDir, rel)
    if (!criteria) return { error: `the stored acceptance criteria (${rel || 'no path in the ac entry'}) could not be read under ${repoDir}, and a test plan written without them cites AC ids that mean nothing` }

    return {
      cwd: repoDir,
      groundedIn: path.basename(repoDir),
      prompt: `${preamble}

# The repository

You are in \`${path.basename(repoDir)}\`, checked out at \`${repoDir}\`. READ IT before you write.
${capabilityPrompt(repoDir)}

# Acceptance criteria already agreed for this ticket

Taken verbatim from \`${rel}\`. Every row of your plan must cite which of these it covers; the criteria
under \`## Acceptance criteria\` are numbered in the order they appear, so the first is AC-1.

${criteria}`,
    }
  })
}

/** Keyed by the stage name in spec §1's table, so the runner looks one up rather than importing three. */
export const STAGES = {
  'design-read': designRead,
  'ac': ac,
  'tests': tests,
}
