import { AUTHOR, CLAUDE, readJson } from './dashboard-core.mjs'
import { exec } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

let chats, usageCache

const PROMPTS_DIR = path.join(CLAUDE, 'prompts-library')

const ASSETS_DIR = path.join(PROMPTS_DIR, 'assets')

const PLAN_FIRST = {
  implementation: '## Plan first\nBefore editing, outline your approach and the exact files you will touch, then pause for my confirmation. If two approaches are viable, give the tradeoffs and let me pick.',
  bugfix: '## Plan first\nReproduce and state the root cause before changing code. Outline the fix and the files it touches, then pause for my confirmation.',
  research: '## Scope first\nRestate the question in your own words and list what you will check, then proceed.',
  review: '## Scope first\nList what you will evaluate (correctness, security, performance, style) before diving in.',
}

const OUTPUT_EXPECT = {
  implementation: '## Output expectations\n- State what changed and why in ≤5 lines, then the files touched.\n- Call out anything deliberately skipped and when to revisit it.',
  bugfix: '## Output expectations\n- One line: the root cause. Then the fix, and how you verified it (the failing case now passing).',
  research: '## Output expectations\n- Answer first in 2-3 sentences, then the evidence with source links.\n- Flag uncertainty and what you could not verify.',
  review: '## Output expectations\n- Lead with the verdict, then findings by severity (blocker / nit), each with file:line and a concrete suggestion.',
}

const AC_DEFAULT = {
  implementation: ['- The described behaviour is observable end to end (state the exact user-visible outcome)', '- No regressions in existing behaviour', '- Edge and error states are handled, not just the happy path'],
  bugfix: ['- The reported failing case now passes', '- The root cause is fixed, not just the symptom', '- No regression in adjacent behaviour'],
  research: ['- The question is answered directly, with evidence', '- Trade-offs and unknowns are stated, not hidden', '- Sources are cited and checkable'],
  review: ['- Every finding names a concrete location and a fix', '- Severity is assigned honestly', '- Nothing critical is left unmentioned'],
}

const PLACEHOLDER_GOAL = '(describe the goal)'

function assemblePrompt(p) {
  const inputs = p.inputs || []
  const texts = inputs.filter(i => i.type === 'text').map(i => i.value)
  const urls = inputs.filter(i => i.type === 'url')
  const files = inputs.filter(i => i.type === 'file')
  const images = inputs.filter(i => i.type === 'image')
  const artifacts = inputs.filter(i => i.type === 'artifact')
  const tone = { direct: 'Be direct and concise.', thorough: 'Be thorough — explain reasoning and edge cases.', cautious: 'Proceed carefully; confirm before destructive steps.' }[p.tone] || ''
  const tpl = p.template || 'implementation'
  const H = { implementation: 'Implement the following', bugfix: 'Fix the following bug', research: 'Research the following question', review: 'Review the following' }[tpl] || 'Task'
  const lines = [`# ${p.title || H}`, '', `## Goal`, texts[0] || PLACEHOLDER_GOAL, '']
  if (texts.length > 1) lines.push('## Context', ...texts.slice(1), '')
  if (files.length || artifacts.length) {
    lines.push('## Relevant files & artifacts')
    for (const f of files) lines.push(`- \`${f.value}\``)
    for (const a of artifacts) lines.push(`- ${a.meta?.kind || 'artifact'}: \`${a.value}\``)
    lines.push('')
  }
  if (urls.length || images.length) {
    lines.push('## Attached references')
    for (const u of urls) lines.push(`- [${u.meta?.title || u.value}](${u.value})${u.meta?.description ? ' — ' + u.meta.description : ''}`)
    for (const im of images) lines.push(`- screenshot: ${im.meta?.name || im.value} (attached)`)
    lines.push('')
  }
  lines.push(PLAN_FIRST[tpl] || PLAN_FIRST.implementation, '')
  lines.push(OUTPUT_EXPECT[tpl] || OUTPUT_EXPECT.implementation, '')
  lines.push('## Constraints', `${tone || 'Follow the project rules (CLAUDE.md).'} Reference files by concrete path, not by memory of earlier chats.`, '')
  lines.push('## Acceptance criteria', ...(p.acceptance ? p.acceptance.split('\n').filter(Boolean).map(l => l.startsWith('-') ? l : '- ' + l) : (AC_DEFAULT[tpl] || AC_DEFAULT.implementation)))
  return lines.join('\n')
}

function scorePrompt(p, output) {
  const tpl = p.template || 'implementation'
  const texts = (p.inputs || []).filter(i => i.type === 'text').map(i => i.value)
  const goalReal = !!texts[0] && texts[0].trim().length >= 12 && texts[0].trim() !== PLACEHOLDER_GOAL
  const anchors = (p.inputs || []).some(i => ['file', 'artifact', 'url', 'image'].includes(i.type))
  const context = texts.length > 1
  const customAC = !!(p.acceptance && p.acceptance.trim())
  const b = [
    ['Clear goal', goalReal ? 3 : 0, 3],
    ['Plan-first / scope-first', output.includes('## Plan first') || output.includes('## Scope first') ? 1.5 : 0, 1.5],
    ['Output expectations up front', output.includes('## Output expectations') ? 1.5 : 0, 1.5],
    ['Behavioural acceptance criteria', output.includes('## Acceptance criteria') ? 1.5 : 0, 1.5],
    ['Constraints stated', output.includes('## Constraints') ? 1.5 : 0, 1.5],
    ['Context provided', context ? 0.4 : 0, 0.4],
    ['Concrete file/URL anchors', anchors ? 0.4 : 0, 0.4],
    ['Own acceptance criteria', customAC ? 0.2 : 0, 0.2],
  ]
  const raw = b.reduce((s, x) => s + x[1], 0)
  const score = Math.min(10, +raw.toFixed(1))
  const gaps = b.filter(x => x[1] === 0).map(x => x[0])
  return { score, breakdown: b.map(([label, got, max]) => ({ label, got, max })), gaps, needsGoal: !goalReal }
}

const promptFile = id => path.join(PROMPTS_DIR, id + '.json')

export default function mountPromptLibrary(app, deps) {
  ({ chats, usageCache } = deps)

app.get('/api/prompts', (req, res) => {
  const out = []
  try {
    for (const f of fs.readdirSync(PROMPTS_DIR).filter(f => f.endsWith('.json'))) {
      const p = readJson(path.join(PROMPTS_DIR, f), null)
      if (p) out.push({ id: p.id, title: p.title, tags: p.tags || [], project: p.project || null, updatedAt: p.updatedAt, versions: (p.versions || []).length, inputs: (p.inputs || []).length })
    }
  } catch {}
  const q = String(req.query.q || '').toLowerCase()
  res.json(out.filter(p => !q || (p.title + (p.tags || []).join(' ')).toLowerCase().includes(q)).sort((a, b) => b.updatedAt - a.updatedAt))
})

app.get('/api/prompts/:id', (req, res) => {
  const p = readJson(promptFile(req.params.id.replace(/[^\w-]/g, '')), null)
  p ? res.json(p) : res.status(404).json({ error: 'not found' })
})

app.post('/api/prompts', (req, res) => {
  fs.mkdirSync(PROMPTS_DIR, { recursive: true })
  const b = req.body
  const id = b.id || 'pr' + Date.now().toString(36)
  const existing = readJson(promptFile(id), null)
  const output = assemblePrompt(b)
  const quality = scorePrompt(b, output)
  const versions = existing?.versions || []
  if (existing?.output && existing.output !== output) versions.push({ ts: existing.updatedAt, output: existing.output, tone: existing.tone, template: existing.template })
  const doc = { id, title: b.title || 'untitled prompt', tags: b.tags || [], project: b.project || null, inputs: b.inputs || [], template: b.template || 'implementation', tone: b.tone || 'direct', acceptance: b.acceptance || '', output, quality, versions: versions.slice(-20), updatedAt: Date.now(), author: AUTHOR }
  fs.writeFileSync(promptFile(id), JSON.stringify(doc, null, 2))
  res.json(doc)
})

app.delete('/api/prompts/:id', (req, res) => {
  try { fs.rmSync(promptFile(req.params.id.replace(/[^\w-]/g, ''))) } catch {}
  res.json({ ok: true })
})

app.post('/api/prompts/url-meta', async (req, res) => {
  try {
    const r = await fetch(req.body.url, { signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'claude-dashboard' } })
    const html = (await r.text()).slice(0, 60000)
    const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]?.trim() || req.body.url
    const description = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i) || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i) || [])[1] || ''
    res.json({ title: title.slice(0, 120), description: description.slice(0, 200), status: r.status })
  } catch (e) { res.json({ title: req.body.url, description: '', error: e.message }) }
})

app.post('/api/prompts/asset', (req, res) => {
  const { name, dataUrl } = req.body
  const m = /^data:(image\/\w+);base64,(.+)$/.exec(dataUrl || '')
  if (!m) return res.status(400).json({ error: 'expected image data URL' })
  fs.mkdirSync(ASSETS_DIR, { recursive: true })
  const file = path.join(ASSETS_DIR, Date.now().toString(36) + '-' + String(name || 'img').replace(/[^\w.-]/g, '_'))
  fs.writeFileSync(file, Buffer.from(m[2], 'base64'))
  res.json({ ok: true, path: file })
})

// ================= flow graph, chat insights, inbox, palette, scaffold, batch, pins, bundles =================

// ---------- transcript prompt/invocation scan (per-file mtime cache, like usageCache) ----------
}
