// On-demand `✨ Analyze` — spawns `claude -p` and returns markdown. Results are cached by input hash
// (spec §2,§3): NEVER called on snapshot build. Degrades to a heuristic note on any failure (§6).
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

// Canonical stringify with sorted keys so the hash is stable regardless of property order.
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']'
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}'
  return JSON.stringify(v)
}

export function analysisKey(panelKey, payload) {
  return crypto.createHash('sha256').update(canon({ panelKey, payload })).digest('hex')
}

const PROMPTS = {
  focus: 'You are a staff-engineer career coach. Given this focus item from a growth dashboard, give 3–5 concrete next actions in terse markdown. No preamble.',
  workflow: 'You are a Claude-Code power-user coach. Given these workflow metrics, name the single highest-leverage change and why, in terse markdown.',
}

export function runAnalyze({ panelKey, payload, spawn = spawnSync }) {
  const instruction = PROMPTS[panelKey] || 'Analyze this career-dashboard data and give concrete, terse markdown advice.'
  const prompt = `${instruction}\n\nDATA:\n${JSON.stringify(payload, null, 2)}`
  try {
    const r = spawn('claude', ['-p', prompt, '--output-format', 'json'], { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 })
    if (r.status !== 0) throw new Error((r.stderr || 'claude failed').toString().slice(0, 200))
    const out = JSON.parse(r.stdout.toString())
    const markdown = out.result || out.text || ''
    if (!markdown) throw new Error('empty result')
    return { markdown }
  } catch (e) {
    return { markdown: `_Analysis unavailable (${e.message}). Using the panel's built-in heuristic guidance instead._` }
  }
}
