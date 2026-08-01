// ponytail: single-user local dashboard — spawnSync blocks the handler during the claude -p call,
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'

const HOME = os.homedir()
const CLAUDE = path.join(HOME, '.claude')
const STORE = path.join(process.cwd(), 'promptcheck.json')

const DIMENSIONS = [
  ['Collaborative planning', 9],
  ['Sharp corrections when I drift', 9],
  ['Behavioral specs over code specs', 8],
  ['"Plan first" mode', 9],
  ['Good use of follow-ups', 8],
  ['Format/output expectations up front', 5],
  ['Some prompts assume shared memory', 6],
  ['Implementation prompts can be thin', 6],
]

const seed = () => ({
  dimensions: DIMENSIONS.map(([name, score]) => ({
    name, score, complexity: 'moderate',
    example: { quote: '', where: 'baseline self-assessment — refresh to pull real examples' },
    optimize: 'Refresh to generate a data-grounded optimization from your recent prompts.',
  })),
  summary: 'Baseline self-scores. Refresh to analyze your recent prompts and ground each score in a real example.',
  avg: +(DIMENSIONS.reduce((s, [, n]) => s + n, 0) / DIMENSIONS.length).toFixed(1),
})

const readStore = () => { try { return JSON.parse(fs.readFileSync(STORE, 'utf8')) } catch { return {} } }
const writeStore = o => fs.writeFileSync(STORE, JSON.stringify(o, null, 2))

// ---- prompt sampling ----------------------------------------------------------------------------
const clean = t => typeof t === 'string' && t.length >= 8 && t.length <= 2000 && !t.startsWith('<') && !t.startsWith('/')

function claudePrompts(limit = 120) {
  const dir = path.join(CLAUDE, 'projects')
  let files = []
  try {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue
      const pd = path.join(dir, ent.name)
      for (const f of fs.readdirSync(pd)) if (f.endsWith('.jsonl')) {
        const p = path.join(pd, f)
        files.push({ p, m: fs.statSync(p).mtimeMs })
      }
    }
  } catch { return [] }
  files.sort((a, b) => b.m - a.m)
  const out = []
  for (const { p } of files.slice(0, 20)) {
    let lines
    try { lines = fs.readFileSync(p, 'utf8').split('\n') } catch { continue }
    for (const line of lines) {
      if (!line.includes('"type":"user"')) continue
      let j; try { j = JSON.parse(line) } catch { continue }
      if (j.type !== 'user' || !j.message) continue
      const c = j.message.content
      const t = typeof c === 'string' ? c : Array.isArray(c) ? c.find(x => x.type === 'text')?.text : ''
      if (clean(t)) out.push(t.trim())
      if (out.length >= limit) return out
    }
  }
  return out
}

function cursorPrompts(limit = 120) {
  const userDir = process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming'), 'Cursor', 'User')
    : process.platform === 'darwin'
      ? path.join(HOME, 'Library', 'Application Support', 'Cursor', 'User')
      : path.join(process.env.XDG_CONFIG_HOME || path.join(HOME, '.config'), 'Cursor', 'User')
  const db = path.join(userDir, 'globalStorage', 'state.vscdb')
  if (!fs.existsSync(db)) return []
  const sql = `SELECT trim(json_extract(value,'$.text')) t FROM cursorDiskKV WHERE key LIKE 'bubbleId:%' AND json_extract(value,'$.type')=1 AND length(json_extract(value,'$.text')) BETWEEN 8 AND 2000 LIMIT ${limit * 3}`
  const r = spawnSync('sqlite3', ['-json', `file:${db}?mode=ro`, sql], { timeout: 120_000, maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) return []
  let rows; try { rows = JSON.parse(r.stdout.toString().trim() || '[]') } catch { return [] }
  return rows.map(x => x.t).filter(clean).slice(0, limit)
}

const gather = source => (source === 'cursor' ? cursorPrompts() : claudePrompts())

// ---- the claude -p analysis ---------------------------------------------------------------------
function analyze(source, prompts) {
  const tool = source === 'cursor' ? 'Cursor' : 'Claude Code'
  const rubric = `You are a senior prompt-engineering coach. Below are ${prompts.length} real prompts a developer wrote to ${tool}, newest first. Rate HOW THEY PROMPT across these 8 fixed dimensions (their baseline self-scores in parens — adjust up or down from the actual prompts):

${DIMENSIONS.map(([n, s], i) => `${i + 1}. ${n} (self: ${s}/10)`).join('\n')}

Return ONLY a JSON object, no prose, no markdown fences, shaped exactly:
{"summary": "2-3 sentence overall read", "dimensions": [{"name": "<exact dimension name>", "score": <1-10 int>, "complexity": "low|moderate|high", "example": {"quote": "<a real <=140 char excerpt from their prompts, verbatim>", "where": "<one short line: why this excerpt shows the dimension>"}, "optimize": "<one concrete, specific rewrite/technique to improve this dimension>"}]}
Include all 8 dimensions in the given order. "complexity" = how cognitively demanding their asks in that dimension are. Quotes MUST be copied from the prompts below.

PROMPTS:
${prompts.map((p, i) => `[${i + 1}] ${p.replace(/\s+/g, ' ').slice(0, 400)}`).join('\n')}`

  const r = spawnSync('claude', ['-p', rubric, '--output-format', 'json'], { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 })
  if (r.status !== 0) throw new Error((r.stderr || 'claude failed').toString().slice(0, 200))
  const raw = JSON.parse(r.stdout.toString()).result || ''
  const jsonText = (raw.match(/\{[\s\S]*\}/) || [null])[0]
  if (!jsonText) throw new Error('no JSON in model output')
  const parsed = JSON.parse(jsonText)
  if (!Array.isArray(parsed.dimensions) || !parsed.dimensions.length) throw new Error('no dimensions')
  const avg = +(parsed.dimensions.reduce((s, d) => s + (Number(d.score) || 0), 0) / parsed.dimensions.length).toFixed(1)
  return { ...parsed, avg }
}

export default function mountPromptCheck(app) {
  app.get('/api/promptcheck', (req, res) => {
    const source = req.query.source === 'cursor' ? 'cursor' : 'claude'
    const hit = readStore()[source]
    if (hit) return res.json({ source, available: true, ...hit })
    res.json({ source, available: false, ...seed() })
  })

  app.post('/api/promptcheck/refresh', (req, res) => {
    const source = (req.body?.source || req.query.source) === 'cursor' ? 'cursor' : 'claude'
    try {
      const prompts = gather(source)
      if (prompts.length < 5) return res.status(400).json({ error: `only ${prompts.length} ${source} prompts found — not enough to analyze` })
      const result = { ...analyze(source, prompts), generatedAt: Date.now(), sampled: prompts.length }
      writeStore({ ...readStore(), [source]: result })
      res.json({ source, available: true, ...result })
    } catch (e) {
      res.status(500).json({ error: e.message, ...seed() })
    }
  })
}
