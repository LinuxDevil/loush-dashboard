import { CLAUDE, HOME, WIN, mangle, readJson, readVersions, tokens } from './dashboard-core.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const failCache = new Map()

function failStats() {
  const base = path.join(CLAUDE, 'projects')
  const files = []
  const walkF = d => { try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walkF(p); else if (e.name.endsWith('.jsonl')) files.push(p) } } catch {} }
  walkF(base)
  const out = []
  for (const f of files) {
    const st = fs.statSync(f)
    let rec = failCache.get(f)
    if (!rec || rec.v !== 3 || rec.mtime !== st.mtimeMs || rec.size !== st.size) {
      rec = {
        v: 3, mtime: st.mtimeMs, size: st.size, proj: path.relative(base, f).split(path.sep)[0],
        sessionId: path.basename(f, '.jsonl'), file: f,
        toolErrs: {}, toolUses: {}, byHour: {}, turns: 0, compactions: 0, compactBoundaries: 0, compactSummaries: 0, retries: 0, last: 0,
        errs: [], bytes: {}, sizes: {}, big: [],
      }
      const idName = {}
      let lastErrTool = null
      const RESULT_TEXT = c => (typeof c.content === 'string' ? c.content : Array.isArray(c.content) ? c.content.map(x => x?.text || (typeof x === 'string' ? x : '')).join('\n') : c.content ? JSON.stringify(c.content) : '')
      try {
        for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
          if (!line) continue
          const isErr = line.includes('"is_error":true')
          if (!isErr && !line.includes('"tool_use"') && !line.includes('tool_result') && !line.includes('isCompactSummary') && !line.includes('compact_boundary')) continue
          try {
            const j = JSON.parse(line)
            const t = Date.parse(j.timestamp) || 0
            rec.last = Math.max(rec.last, t)
            // ONE compaction emits TWO records: a `subtype:"compact_boundary"` marker and a
            // separate message carrying `isCompactSummary`. Counting either-or double-counts —
            // measured here, 2 records for 1 real compaction. The boundary is the canonical
            // event, so it is counted and the summary is only a fallback for older transcripts
            // that predate the boundary marker (resolved per file, below).
            //
            // The previous condition (`isCompactSummary || type === 'summary'`) had the same
            // double-count plus a second error: `type:"summary"` is a session-TITLE record, not a
            // compaction at all.
            if (j.subtype === 'compact_boundary') { rec.compactBoundaries++; continue }
            if (j.isCompactSummary) { rec.compactSummaries++; continue }
            if (j.type === 'assistant' && Array.isArray(j.message?.content)) {
              rec.turns++
              let first = true
              for (const c of j.message.content) if (c.type === 'tool_use') {
                const fp = c.input && typeof c.input === 'object' ? c.input.file_path || c.input.notebook_path || null : null
                idName[c.id] = { name: c.name, path: typeof fp === 'string' ? fp : null }
                rec.toolUses[c.name] = (rec.toolUses[c.name] || 0) + 1
                if (first && lastErrTool === c.name) rec.retries++
                if (first) { lastErrTool = null; first = false }
              }
            }
            if (j.type === 'user' && Array.isArray(j.message?.content))
              for (const c of j.message.content) {
                if (c.type !== 'tool_result') continue
                const call = idName[c.tool_use_id] || null
                const name = call?.name || '?'
                const chars = RESULT_TEXT(c).length
                rec.bytes[name] = (rec.bytes[name] || 0) + chars
                const s = (rec.sizes[name] ||= [])
                if (s.length < 300) s.push(chars)
                if (chars >= 20000) {
                  rec.big.push({ tool: name, chars, t })
                  if (rec.big.length > 40) { rec.big.sort((a, b) => b.chars - a.chars); rec.big.length = 20 }
                }
                if (!c.is_error) continue
                rec.toolErrs[name] = (rec.toolErrs[name] || 0) + 1
                lastErrTool = name
                if (t) { const d = new Date(t); const k = d.getDay() + ':' + d.getHours(); rec.byHour[k] = (rec.byHour[k] || 0) + 1 }
                if (rec.errs.length < 400) rec.errs.push({ t, tool: name, file: call?.path || null, text: RESULT_TEXT(c).replace(/\s+/g, ' ').trim().slice(0, 240), chars })
              }
          } catch {}
        }
      } catch {}
      rec.big.sort((a, b) => b.chars - a.chars); rec.big.length = Math.min(rec.big.length, 20)
      // Resolved per file: prefer the boundary marker, and fall back to the summary only when a
      // transcript has no boundaries at all (an older format). Summing both would report two
      // compactions for one.
      rec.compactions = rec.compactBoundaries || rec.compactSummaries
      failCache.set(f, rec)
    }
    out.push(rec)
  }
  return out
}

const errSig = (tool, text) => tool + ': ' + text
  .replace(/\/[\w./~-]+/g, '<path>').replace(/\b[0-9a-f]{8,}\b/gi, '<id>').replace(/\b\d+\b/g, '<n>')
  .replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '<str>').replace(/\s+/g, ' ').trim().slice(0, 120)

const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }

const EVALS_FILE = path.join(CLAUDE, 'harness-evals.json')

const EVAL_RUNS = path.join(CLAUDE, 'harness-eval-runs.jsonl')

const DEFAULT_EVALS = [
  { name: 'sanity: instruction following', prompt: 'Reply with exactly the word: HARNESS_OK', expect: 'HARNESS_OK' },
  { name: 'reasoning: arithmetic', prompt: 'What is 17*23? Reply with just the number.', expect: '391' },
  { name: 'tool use: filesystem', prompt: 'List the files in the current directory, then reply with the word FS_DONE at the end.', expect: 'FS_DONE' },
]

const evalRuns = () => { try { return fs.readFileSync(EVAL_RUNS, 'utf8').split('\n').filter(Boolean).map(JSON.parse) } catch { return [] } }

const activeEvals = new Map()

export default function mountDiagnostics(app) {
app.get('/api/gov/failures', (req, res) => {
  const days = Number(req.query.days) || 30
  const proj = req.query.project ? mangle(req.query.project) : null
  const cutoff = Date.now() - days * 86400_000
  const recs = failStats().filter(r => r.last >= cutoff && (!proj || r.proj === proj))
  const toolErrs = {}, toolUses = {}, byHour = {}
  let compactions = 0, retries = 0
  const turnsDist = []
  for (const r of recs) {
    for (const [k, v] of Object.entries(r.toolErrs)) toolErrs[k] = (toolErrs[k] || 0) + v
    for (const [k, v] of Object.entries(r.toolUses)) toolUses[k] = (toolUses[k] || 0) + v
    for (const [k, v] of Object.entries(r.byHour)) byHour[k] = (byHour[k] || 0) + v
    compactions += r.compactions; retries += r.retries
    if (r.turns > 0) turnsDist.push(r.turns)
  }
  const MIN_USES = 3, TOP_N = 12
  const allTools = Object.keys(toolUses).map(name => ({ name, uses: toolUses[name], errors: toolErrs[name] || 0, rate: toolUses[name] ? (toolErrs[name] || 0) / toolUses[name] : 0 }))
  const eligible = allTools.filter(t => t.uses >= MIN_USES).sort((a, b) => b.errors - a.errors)
  const tools = eligible.slice(0, TOP_N)
  // Both bounds used to be invisible. A tool list showing 12 rows reads as "these are the tools",
  // and a low-n tool dropped for being noisy reads as a tool with no errors.
  res.json({
    tools, byHour, compactions, retries, turnsDist, sessions: recs.length,
    bounds: {
      minUses: MIN_USES, topN: TOP_N,
      toolsTotal: allTools.length,
      belowMinUses: allTools.length - eligible.length,
      hiddenByTopN: Math.max(0, eligible.length - tools.length),
      note: allTools.length > tools.length
        ? `showing ${tools.length} of ${allTools.length} tools — ${allTools.length - eligible.length} had fewer than ${MIN_USES} uses (too few to rate) and ${Math.max(0, eligible.length - tools.length)} more were cut by the top-${TOP_N} limit`
        : null,
    },
  })
})

// ---------- trace viewer ----------

app.get('/api/gov/trace', (req, res) => {
  const { project, id } = req.query
  const f = path.join(CLAUDE, 'projects', mangle(String(project || '')), String(id || '') + '.jsonl')
  if (!/^[\w-]+$/.test(String(id || '')) || !fs.existsSync(f)) return res.status(404).json({ error: 'no such session' })
  const steps = []
  let firstTs = null
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line) continue
    try {
      const j = JSON.parse(line)
      const ts = Date.parse(j.timestamp) || null
      firstTs ??= ts
      if (j.type === 'user' && typeof j.message?.content === 'string' && !j.message.content.startsWith('<'))
        steps.push({ kind: 'prompt', ts, text: j.message.content.slice(0, 300) })
      else if (j.type === 'user' && Array.isArray(j.message?.content))
        for (const c of j.message.content) if (c.type === 'tool_result') steps.push({ kind: 'observe', ts, err: !!c.is_error, text: (typeof c.content === 'string' ? c.content : JSON.stringify(c.content)).slice(0, 200) })
      else if (j.type === 'assistant' && Array.isArray(j.message?.content)) {
        const outTok = j.message.usage?.output_tokens || 0
        for (const c of j.message.content) {
          if (c.type === 'text' && c.text.trim()) steps.push({ kind: 'reason', ts, tokens: outTok, text: c.text.slice(0, 300) })
          else if (c.type === 'tool_use') steps.push({ kind: 'act', ts, tokens: outTok, name: c.name, text: JSON.stringify(c.input).slice(0, 200) })
        }
      } else if (j.isCompactSummary || j.subtype === 'compact_boundary') steps.push({ kind: 'checkpoint', ts, text: 'context compacted' })
    } catch {}
  }
  for (let i = 0; i < steps.length; i++) steps[i].latency = steps[i + 1]?.ts && steps[i].ts ? steps[i + 1].ts - steps[i].ts : null
  const ver = readVersions().filter(v => v.ts <= (firstTs || 0)).pop() || null
  res.json({ steps: steps.slice(0, 400), total: steps.length, startedAt: firstTs, configVersion: ver ? { id: ver.id, summary: ver.summary, file: ver.file, ts: ver.ts } : null })
})

// ---------- eval / regression suite ----------

app.get('/api/gov/evals', (req, res) => res.json({ tasks: readJson(EVALS_FILE, DEFAULT_EVALS), runs: evalRuns().slice(-40).reverse(), active: [...activeEvals.entries()].map(([id, s]) => ({ id, ...s })) }))

app.put('/api/gov/evals', (req, res) => { fs.writeFileSync(EVALS_FILE, JSON.stringify(req.body.tasks, null, 2)); res.json({ ok: true }) })

app.post('/api/gov/evals/run', (req, res) => {
  const scope = req.body.scope || 'global'
  const cwd = scope === 'global' ? HOME : scope
  const tasks = readJson(EVALS_FILE, DEFAULT_EVALS)
  const runId = 'run' + Date.now().toString(36)
  activeEvals.set(runId, { status: 'running', done: 0, total: tasks.length })
  res.json({ ok: true, runId })
  ;(async () => {
    const results = []
    for (const t of tasks) {
      const r = await new Promise(resolve => {
        const child = spawn('claude', ['-p', t.prompt, '--output-format', 'json', '--dangerously-skip-permissions'], { cwd, env: process.env, shell: WIN })
        let out = ''
        const timer = setTimeout(() => { try { child.kill() } catch {}; resolve({ pass: false, error: 'timeout' }) }, 180000)
        child.stdout.on('data', d => out += d)
        child.on('exit', () => {
          clearTimeout(timer)
          try {
            const j = JSON.parse(out)
            resolve({ pass: new RegExp(t.expect).test(j.result || ''), tokens: (j.usage?.input_tokens || 0) + (j.usage?.output_tokens || 0), turns: j.num_turns, cost: j.total_cost_usd, ms: j.duration_ms })
          } catch { resolve({ pass: false, error: 'no result' }) }
        })
      })
      results.push({ name: t.name, ...r })
      activeEvals.get(runId).done++
    }
    const passRate = results.filter(r => r.pass).length / (results.length || 1)
    fs.appendFileSync(EVAL_RUNS, JSON.stringify({ id: runId, ts: Date.now(), scope, passRate, tokens: results.reduce((s, r) => s + (r.tokens || 0), 0), cost: results.reduce((s, r) => s + (r.cost || 0), 0), turns: results.reduce((s, r) => s + (r.turns || 0), 0), results }) + '\n')
    activeEvals.delete(runId)
  })().catch(() => activeEvals.delete(runId))
})

// ---------- costs, budgets, alerts ----------
}

export { DEFAULT_EVALS, EVALS_FILE, errSig, evalRuns, failStats, median }
