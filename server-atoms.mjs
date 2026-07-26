// Ask-the-project atoms API — feature catalog, grounded search, and attestation triage
// over a repo's .wakeel/constitution atom files. Shared by the Claude and Cursor shells.
// Index is in-memory per repo, rebuilt when the constitution folder's mtime changes.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildIndex, newestMtime, constDir } from './atoms/ingest.mjs'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const REVIEWED_PATH = path.join(DIR, 'atoms', 'reviewed.json') // { [repo]: { [atomId]: { at } } }
const WIN = process.platform === 'win32'

const readReviewed = () => { try { return JSON.parse(fs.readFileSync(REVIEWED_PATH, 'utf8')) } catch { return {} } }

const SYSTEM_PROMPT = `You answer questions about a codebase using ONLY the provided atoms (verified claims with code citations).
Rules:
- Answer only using the provided atoms. Do not use outside knowledge about frameworks, libraries, or general practices.
- Every sentence in your answer must reference at least one atom id in the form [atom-id].
- If the atoms don't cover the question, say exactly that — do not speculate or fill gaps.
- Quote the citation (path:lineRange) when it strengthens the answer.
- Be concise.`

// grounded LLM call: API key if present, else the local claude CLI (same pattern as server.mjs)
function askLLM(question, atoms) {
  const prompt = `Atoms:\n${JSON.stringify(atoms, null, 1)}\n\nQuestion: ${question}`
  const key = process.env.ANTHROPIC_API_KEY
  if (key)
    return fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5', max_tokens: 2048, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: prompt }] }),
    }).then(async r => {
      const data = await r.json()
      if (!r.ok) throw new Error(data.error?.message || 'API error')
      return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n')
    })
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', prompt, '--append-system-prompt', SYSTEM_PROMPT, '--output-format', 'json', '--dangerously-skip-permissions'],
      { cwd: os.homedir(), env: process.env, shell: WIN })
    let out = '', errOut = ''
    child.stdout.on('data', d => out += d)
    child.stderr.on('data', d => errOut += d)
    child.on('error', reject)
    child.on('close', code => {
      if (code !== 0) return reject(new Error(errOut.trim() || `claude exited ${code}`))
      try { resolve(JSON.parse(out).result || '') } catch { resolve(out.trim()) }
    })
  })
}

const memo = new Map() // repo -> index
export default function mountAtoms(app) {
  const resolveRepo = req => {
    const repo = path.resolve(String(req.query.repo || req.body?.repo || ''))
    if (!fs.existsSync(constDir(repo))) throw Object.assign(new Error('no .wakeel/constitution under ' + repo), { status: 404 })
    return repo
  }

  app.get('/api/atoms/index', (req, res) => {
    try {
      const repo = resolveRepo(req)
      const hit = memo.get(repo)
      const stale = !hit || req.query.fresh === '1' || newestMtime(constDir(repo)) > hit.sourceMtime
      const idx = stale ? buildIndex(repo) : hit
      if (stale) memo.set(repo, idx)
      res.json(idx)
    } catch (e) { res.status(e.status || 500).json({ error: e.message }) }
  })

  app.get('/api/atoms/reviewed', (req, res) => {
    try { res.json(readReviewed()[resolveRepo(req)] || {}) }
    catch (e) { res.status(e.status || 500).json({ error: e.message }) }
  })

  app.post('/api/atoms/reviewed', (req, res) => {
    try {
      const repo = resolveRepo(req)
      const { atomId, reviewed } = req.body || {}
      if (!atomId) return res.status(400).json({ error: 'atomId required' })
      const all = readReviewed()
      all[repo] = all[repo] || {}
      if (reviewed) all[repo][atomId] = { at: new Date().toISOString() }
      else delete all[repo][atomId]
      fs.writeFileSync(REVIEWED_PATH, JSON.stringify(all, null, 2))
      res.json(all[repo])
    } catch (e) { res.status(e.status || 500).json({ error: e.message }) }
  })

  app.post('/api/atoms/explain', async (req, res) => {
    const { question, atoms } = req.body || {}
    if (!question || !Array.isArray(atoms) || atoms.length === 0)
      return res.status(400).json({ error: 'question and non-empty atoms[] required — grounding is mandatory' })
    try { res.json({ answer: await askLLM(question, atoms) }) }
    catch (e) { res.status(502).json({ error: e.message }) }
  })
}
