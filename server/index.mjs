import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn, exec, execFile, spawnSync } from 'node:child_process'
import { toggleOffFile } from '../lib/customize-toggle.mjs'
import mountEng from './eng.mjs'
import mountTicket from './ticket.mjs'
import mountMemory, { retrieveContext } from './memory.mjs'
import mountFe from './fe.mjs'
import mountSetup from './setup.mjs'
import mountTodos from './todos.mjs'
import mountConstitution from './constitution.mjs'
import mountAtoms from './atoms.mjs'
import mountFigmaCapture from './figma-capture.mjs'
import mountPageCapture from './page-capture.mjs'
import mountAccess from './access.mjs'
import { mountHooksReceiver, publishInstance, unpublishInstance } from './hooks-receiver.mjs'
import { securityMiddleware, bindHost, isExposedBind } from './security.mjs'
import { installNetworkGuard } from '../lib/network-guard.mjs'
import { detectTestCommand } from '../lib/testdetect.mjs'
import { classifyError } from '../lib/error-taxonomy.mjs'
import { classifyConversation, tierDistribution } from '../lib/complexity.mjs'
import { createTailer } from '../lib/transcript-tail.mjs'
import { detectFramework, lintFrontmatter, declaredDependencies, checkDependencies } from '../lib/capability-provenance.mjs'
import { auditRepo } from '../lib/freeze-audit.mjs'
import { buildMap } from '../lib/design-map.mjs'
import { listWorktrees, attributeSession } from '../lib/worktree.mjs'
import { parseResultsJson, applyFilters, hardExclusionRules } from '../lib/security-findings.mjs'
import { groupEvents } from '../lib/event-grouping.mjs'
import { deriveLessons, SIGNALS } from '../lib/lessons.mjs'
import { deriveStatus, contextPressure as liveContextPressure, permissionBadge, collapseIdle } from '../lib/session-status.mjs'
import mountPromptCheck from './promptcheck.mjs'
import { loadEngConfig as loadEngCfg, toolFlagAllows } from '../lib/eng-config.mjs'
import { PROJECTS_FILE, SECRETS_FILE } from '../lib/paths.mjs'
import { capabilityVerdict, tokPerFire, sessionsSince, contextPressure, NEW_CAPABILITY_DAYS } from '../lib/harness-metrics.mjs'
import { startScheduler, schedulerInbox, readSchedulerConfig, writeSchedulerConfig } from '../lib/scheduler.mjs'
import { verdictFrom } from '../lib/run-verdict.mjs'
import { computeUsageHealth, computeRegression } from '../lib/harness-health.mjs'
import { localCloneOf } from '../lib/clone.mjs'
import { runAgent } from '../lib/agent.mjs'
import { buildDailyCacheMap, rollingCacheEfficiency, cacheWasteCost, buildDailyUsage, detectDailyAnomalies, projectMonthEnd } from '../lib/harness-usage-trends.mjs'
import { PRICE_PER_M, isPriced, entryCost, entryCacheRates, splitCacheWrite, dedupeTurns } from '../lib/pricing.mjs'
import mountPricing from './pricing-store.mjs'
import { foldNameLine, sessionName, nameSource } from '../lib/session-name.mjs'
import mountSessionForensics from './session-forensics.mjs'
import mountNativeHooks from './native-hooks.mjs'
import mountBugTriage from './bug-triage.mjs'
import mountPromptLibrary from './prompt-library.mjs'
import mountInsights from './insights.mjs'
import mountLoushRuns, { projectDirs, scanRuns } from './loush-runs.mjs'
import mountBoard, { boardRuns, projCfg, readBoard, tkt, writeBoard } from './board.mjs'
import mountDrift, { designDrift, reviewData } from './drift.mjs'
import mountAgentTeams from './agent-teams.mjs'
import mountInventory, { KINDS, OFF, SETTINGS_FILES, itemFile, itemRoot, listItemNames, scopeDir } from './inventory.mjs'
import {
  HOME, CLAUDE, CLAUDE_JSON, PROJECT, WIN, BACKUPS, PORT,
  safe, backup, parseFM, readClaudeJson,
  META_FILE, readMeta, writeMeta, tokens, mangle, readJson,
  VERSIONS_FILE, APPROVALS_FILE, AUTHOR, appendVersion, track, readVersions,
  readApprovals, writeApprovals, propose,
} from './dashboard-core.mjs'

// ============================ TWO DATA PLANES — READ THIS BEFORE ADDING AN ENDPOINT ============================
// =============================================================================================================


const app = express()
app.use(...securityMiddleware())
app.use(express.json({ limit: '10mb' }))
if (process.env.DASH_NETWORK_GUARD) {
  const mode = process.env.DASH_NETWORK_GUARD === 'block' ? 'block' : 'report'
  installNetworkGuard({ mode, onViolation: v => console.warn(`[network-guard] ${mode}: ${v.host}:${v.port}`) })
  console.log(`[claude-dashboard] outbound network guard: ${mode}`)
}
mountEng(app)
mountTicket(app)
mountMemory(app)
mountAccess(app, { track: (...a) => track(...a) })
const hooksReceiver = mountHooksReceiver(app)
mountFe(app, { scanTranscripts: (...a) => scanTranscripts(...a), failStats: (...a) => failStats(...a), backup: (...a) => backup(...a) })
mountSetup(app, { readMeta: (...a) => readMeta(...a), writeMeta: m => fs.writeFileSync(META_FILE, JSON.stringify(m, null, 2)) })
mountTodos(app, {
  scanTranscripts: (...a) => scanTranscripts(...a),
  failStats: (...a) => failStats(...a),
  track: (...a) => track(...a),
  backup: (...a) => backup(...a),
})

// ---------- org-specific tool bundle: Company tools ----------
function companyToolsEnabled() {
  const readLocal = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return {} } }
  try {
    const cfg = loadEngCfg(PROJECTS_FILE)
    const email = process.env.JIRA_EMAIL || readLocal(SECRETS_FILE).jiraEmail || null
    return toolFlagAllows(cfg.companyTools, email)
  } catch (e) {
    console.error('[claude-dashboard] could not evaluate companyTools flag — leaving it OFF:', e.message)
    return false
  }
}
function engineeringEnabled() {
  const readLocal = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return {} } }
  try {
    const cfg = loadEngCfg(PROJECTS_FILE)
    const email = process.env.JIRA_EMAIL || readLocal(SECRETS_FILE).jiraEmail || null
    return toolFlagAllows(cfg.engineering, email)
  } catch (e) {
    console.error('[claude-dashboard] could not evaluate Engineering flag — leaving it OFF:', e.message)
    return false
  }
}
const ENGINEERING = engineeringEnabled()
if (ENGINEERING) console.log('[claude-dashboard] Engineering metrics enabled (projects.json -> Engineering)')

const COMPANY_TOOLS = companyToolsEnabled()
if (COMPANY_TOOLS) {
  mountConstitution(app)
  mountAtoms(app)
  mountFigmaCapture(app)
  mountPageCapture(app)
  console.log('[claude-dashboard] Company tools enabled (projects.json -> Company_Tools)')
}
app.get('/api/features', (req, res) => res.json({ companyTools: COMPANY_TOOLS, engineering: ENGINEERING }))

mountPromptCheck(app)

// ---------- response cache for heavy aggregate GETs ----------
const HEAVY_TTL = {
  '/api/overview': 300_000, '/api/usage': 120_000, '/api/projects': 300_000, '/api/harness': 60_000,
  '/api/chatstats': 600_000, '/api/dupes': 600_000, '/api/flow': 600_000, '/api/search': 600_000,
  '/api/hub': 300_000, '/api/reviews': 600_000, '/api/hooks/health': 600_000, '/api/gov/failures': 600_000,
  '/api/gov/costs': 120_000, '/api/digest': 300_000, '/api/board/analytics': 120_000,
  '/api/inbox': 60_000, '/api/capabilities': 300_000, '/api/forensics': 600_000, '/api/sessions': 120_000,
  '/api/roi': 600_000, '/api/ci/health': 600_000, '/api/gov/team': 300_000,
}
const respCache = new Map()
app.use((req, res, next) => {
  if (req.method !== 'GET') { respCache.clear(); return next() }
  const ttl = HEAVY_TTL[req.path]
  if (!ttl) return next()
  const key = req.originalUrl.replace(/[?&]fresh=1/, '')
  const hit = respCache.get(key)
  if (hit && req.query.fresh !== '1' && Date.now() - hit.at < ttl) { res.set('x-cached-at', String(hit.at)); return res.json(hit.body) }
  const orig = res.json.bind(res)
  res.json = body => { if (res.statusCode === 200) respCache.set(key, { at: Date.now(), body }); res.set('x-cached-at', String(Date.now())); return orig(body) }
  next()
})

mountInventory(app)

// ---------- overview: context cost, quality score, specificity, groups/tags ----------
mountPricing(app, { readMeta, writeMeta, onChange: () => usageCache.clear() })

function scoreItem(fm, body, kind) {
  // ponytail: static-analysis heuristic, not an LLM judge — upgrade to an eval harness if scores need to be trusted
  let s = 0
  const d = String(fm.description || '')
  if (d) s += 15
  if (d.length >= 60) s += 10
  if (d.length >= 150) s += 5
  if (/use (this |it )?when|trigger|whenever|use for/i.test(d)) s += 10
  if (fm['argument-hint']) s += 8
  if (fm['allowed-tools'] || fm.tools) s += 8
  if (fm.name || kind === 'commands' || kind === 'templates') s += 4
  const words = body.trim().split(/\s+/).length
  if (words >= 50) s += 10
  if (words >= 200) s += 5
  if (/^#{1,3} /m.test(body)) s += 10
  if (/```/.test(body) || /^\s*[-*] /m.test(body)) s += 10
  if (kind === 'commands' && /\$ARGUMENTS/.test(body)) s += 5
  if (words > 4000) s -= 10
  return Math.max(0, Math.min(100, s))
}
const levelOf = s => (s >= 90 ? 'perfect' : s >= 70 ? 'excellent' : s >= 45 ? 'good' : 'poor')
function specificityOf(fm, kind) {
  const d = String(fm.description || '')
  let s = Math.min(30, d.length / 10)
  if (/use (this |it )?when|trigger|whenever|use for|use whenever/i.test(d)) s += 20
  if (/"[^"]+"|'[^']+'|`[^`]+`/.test(d)) s += 15
  if (/e\.g\.|example|such as/i.test(d)) s += 10
  if (fm['argument-hint']) s += 15
  if (/do not|don't|never|only|instead of/i.test(d)) s += 10
  return Math.round(Math.min(100, s))
}
function groupOf(name, kind) {
  const prefix = name.split(/[-_]/)[0].toLowerCase()
  return ['gsd', 'loush', 'ticket', 'figma', 'notion', 'ctx'].includes(prefix) ? prefix : kind
}

function overviewItems() {
  const meta = readMeta()
  const items = []
  let installedMcp = [], userSettings = null
  try { installedMcp = Object.keys(readClaudeJson().mcpServers || {}) } catch {}
  try { userSettings = JSON.parse(fs.readFileSync(SETTINGS_FILES.user, 'utf8')) } catch {}
  const push = (kind, name, extra) => items.push({ kind, name, tags: meta.tags?.[`${kind}:${name}`] || [], ...extra })
  for (const kind of ['skills', 'commands', 'agents']) {
    for (const { scope, dir } of KINDS[kind].dirs()) {
      for (const name of listItemNames(kind, dir)) {
        const file = itemFile(kind, dir, name)
        if (!fs.existsSync(file)) continue
        const content = fs.readFileSync(file, 'utf8')
        const { fm, body } = parseFM(content)
        const score = scoreItem(fm, body, kind)
        let mtime = null
        try { mtime = fs.statSync(file).mtimeMs } catch {}
        const origin = detectFramework(file, fm, content, { kind, settings: userSettings })
        const lint = lintFrontmatter(content, { file, kind })
        const deps = declaredDependencies(fm)
        const depCheck = deps.declared ? checkDependencies(deps, { mcpServers: installedMcp }) : null
        push(kind, name, {
          scope, group: groupOf(name, kind), mtime,
          descTokens: tokens(String(fm.description || '')),
          fullTokens: tokens(content),
          score, level: levelOf(score), specificity: specificityOf(fm, kind),
          origin: origin ? { framework: origin.framework, confidence: origin.confidence, basis: origin.basis } : null,
          fm: { ok: lint.ok, findings: lint.findings },
          deps: deps.declared ? { mcpServers: deps.mcpServers, agents: deps.agents, missing: depCheck?.missing?.mcpServers ?? null } : null,
        })
      }
    }
  }
  const tplDir = path.join(CLAUDE, 'templates')
  if (fs.existsSync(tplDir))
    for (const f of fs.readdirSync(tplDir).filter(f => !f.startsWith('.') && fs.statSync(path.join(tplDir, f)).isFile())) {
      const content = fs.readFileSync(path.join(tplDir, f), 'utf8')
      const { fm, body } = parseFM(content)
      const score = scoreItem(fm, body, 'templates')
      push('templates', f, { scope: 'user', group: 'templates', descTokens: 0, fullTokens: tokens(content), score, level: levelOf(score), specificity: specificityOf(fm, 'templates') })
    }
  try {
    const cj = readClaudeJson()
    for (const [name, config] of Object.entries(cj.mcpServers || {}))
      push('mcp', name, { scope: 'user', group: 'mcp', descTokens: 0, fullTokens: tokens(JSON.stringify(config)), score: null, level: null, specificity: null })
  } catch {}
  try {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILES.user, 'utf8'))
    for (const [name, on] of Object.entries(settings.enabledPlugins || {}))
      if (on) push('plugins', name.split('@')[0], { scope: 'user', group: 'plugins', descTokens: 0, fullTokens: 0, score: null, level: null, specificity: null })
  } catch {}
  return items
}
app.get('/api/overview', (req, res) => res.json({ items: overviewItems() }))

app.put('/api/tags', (req, res) => {
  const { key, tags: t } = req.body
  const meta = readMeta()
  meta.tags = meta.tags || {}
  if (t?.length) meta.tags[key] = t
  else delete meta.tags[key]
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2))
  res.json({ ok: true })
})

// ---------- usage: parsed from session transcripts (per-file mtime cache) ----------
const usageCache = new Map()
function collectUsage() {
  const base = path.join(CLAUDE, 'projects')
  const files = []
  const walkJ = d => { try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walkJ(p); else if (e.name.endsWith('.jsonl')) files.push(p) } } catch {} }
  walkJ(base)
  const all = { entries: [], lineEvents: [], toolTotals: {}, files: [] }
  for (const f of files) {
    const st = fs.statSync(f)
    const proj = path.relative(base, f).split(path.sep)[0]
    let rec = usageCache.get(f)
    if (!rec || rec.v !== 5 || rec.mtime !== st.mtimeMs || rec.size !== st.size) {
      rec = { v: 5, mtime: st.mtimeMs, size: st.size, entries: [], lines: [], tools: {}, out: 0, msgs: 0, toolCalls: 0, in: 0, cc: 0, cr: 0, cost: 0, first: 0, last: 0, cwd: '', branches: {}, name: null, nameSource: null }
      try {
        const nameAcc = {}
        const records = []
        for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
          if (line.includes('"usage"')) {
            try {
              const j = JSON.parse(line)
              const u = j.message?.usage, model = j.message?.model
              if (!u || !model || model === '<synthetic>' || !j.timestamp) continue
              let tc = 0
              const tools = {}
              if (Array.isArray(j.message.content))
                for (const c of j.message.content) if (c.type === 'tool_use') { tc++; tools[c.name] = (tools[c.name] || 0) + 1 }
              const t = Date.parse(j.timestamp)
              const { cc5, cc1h } = splitCacheWrite(u.cache_creation_input_tokens, u.cache_creation?.ephemeral_5m_input_tokens, u.cache_creation?.ephemeral_1h_input_tokens)
              const e = { t, model, proj, in: u.input_tokens || 0, out: u.output_tokens || 0, cc: u.cache_creation_input_tokens || 0, cc5, cc1h, cr: u.cache_read_input_tokens || 0, tc }
              records.push({ id: j.message?.id, e, tools, cwd: j.cwd || '', br: j.gitBranch || '' })
            } catch {}
          } else if (line.includes('"structuredPatch"')) {
            try {
              const j = JSON.parse(line)
              const sp = j.toolUseResult?.structuredPatch
              if (!Array.isArray(sp) || !j.timestamp) continue
              let add = 0, del = 0
              for (const h of sp) for (const l of h.lines || []) { if (l[0] === '+') add++; else if (l[0] === '-') del++ }
              if (add + del) rec.lines.push({ t: Date.parse(j.timestamp), proj, add, del })
            } catch {}
          }
          if (line.includes('"customTitle"') || line.includes('"aiTitle"')) {
            try { foldNameLine(nameAcc, JSON.parse(line)) } catch {}
          } else if (!nameAcc.prompt && line.includes('"type":"user"')) {
            try { foldNameLine(nameAcc, JSON.parse(line)) } catch {}
          }
        }
        rec.name = sessionName(nameAcc)
        rec.nameSource = nameSource(nameAcc)
        for (const { e, tools, cwd, br } of dedupeTurns(records)) {
          rec.entries.push(e)
          rec.out += e.out; rec.in += e.in; rec.cc += e.cc; rec.cr += e.cr; rec.msgs++; rec.toolCalls += e.tc
          rec.cost += entryCost(e)
          rec.first ||= e.t; rec.last = Math.max(rec.last, e.t)
          for (const [name, n] of Object.entries(tools)) rec.tools[name] = (rec.tools[name] || 0) + n
          if (cwd) rec.cwd = cwd
          const b = (rec.branches[br] ||= { cost: 0, out: 0, msgs: 0, first: 0, last: 0, cwd })
          b.cost += entryCost(e); b.out += e.out; b.msgs++; b.first ||= e.t; b.last = Math.max(b.last, e.t)
        }
      } catch {}
      usageCache.set(f, rec)
    }
    all.entries.push(...rec.entries)
    all.lineEvents.push(...rec.lines)
    for (const [k, v] of Object.entries(rec.tools)) all.toolTotals[k] = (all.toolTotals[k] || 0) + v
    all.files.push({
      path: f, proj, isAgent: f.includes('subagents'), mtime: st.mtimeMs, out: rec.out, msgs: rec.msgs, toolCalls: rec.toolCalls,
      in: rec.in, cc: rec.cc, cr: rec.cr, cost: rec.cost, subagentCost: 0, first: rec.first, last: rec.last, cwd: rec.cwd, branches: rec.branches,
      entries: rec.entries, name: rec.name, nameSource: rec.nameSource,
    })
  }
  all.unattributedAgentCost = rollUpSubagents(all.files)
  all.entries.sort((a, b) => a.t - b.t)
  return all
}
const parentSessionPath = p => {
  const parts = p.split(path.sep)
  const i = parts.lastIndexOf('subagents')
  return i < 1 ? null : [...parts.slice(0, i - 1), parts[i - 1] + '.jsonl'].join(path.sep)
}
function rollUpSubagents(files) {
  const byPath = new Map(files.map(f => [f.path, f]))
  let unattributed = 0
  for (const f of [...files].filter(f => f.isAgent).sort((a, b) => b.path.length - a.path.length)) {
    const parent = byPath.get(parentSessionPath(f.path))
    if (!parent) { unattributed += f.cost; continue }
    parent.subagentCost += f.cost
    parent.cost += f.cost
    parent.in += f.in; parent.out += f.out; parent.cc += f.cc; parent.cr += f.cr
  }
  return unattributed
}
const HOUR = 3600_000, BLOCK = 5 * HOUR
app.get('/api/usage', (req, res) => {
  const { entries, lineEvents, toolTotals, files, unattributedAgentCost } = collectUsage()
  const perModel = {}
  for (const e of entries) {
    const m = (perModel[e.model] ||= { msgs: 0, out: 0, in: 0, cache: 0 })
    m.msgs++; m.out += e.out; m.in += e.in; m.cache += e.cc + e.cr
  }
  let blockStart = null, active = null
  for (const e of entries) {
    if (blockStart === null || e.t >= blockStart + BLOCK) blockStart = Math.floor(e.t / HOUR) * HOUR
  }
  if (blockStart !== null && Date.now() < blockStart + BLOCK) {
    const blockEntries = entries.filter(e => e.t >= blockStart)
    const byModel = {}
    for (const e of blockEntries) {
      const m = (byModel[e.model] ||= { msgs: 0, out: 0, in: 0, cache: 0 })
      m.msgs++; m.out += e.out; m.in += e.in; m.cache += e.cc + e.cr
    }
    active = { start: blockStart, end: blockStart + BLOCK, byModel, msgs: blockEntries.length, out: blockEntries.reduce((s, e) => s + e.out, 0), in: blockEntries.reduce((s, e) => s + e.in + e.cc, 0) }
  }
  const dayOf = t => new Date(t).toISOString().slice(0, 10)
  const daily = {}
  for (const e of entries) { const d = (daily[dayOf(e.t)] ||= { out: 0, msgs: 0, tools: 0, lines: 0 }); d.out += e.out; d.msgs++; d.tools += e.tc }
  for (const l of lineEvents) { const d = daily[dayOf(l.t)]; if (d) d.lines += l.add + l.del }
  const days = Object.keys(daily).sort()
  const series = []
  for (let i = 125; i >= 0; i--) {
    const d = dayOf(Date.now() - i * 24 * HOUR)
    series.push({ date: d, ...(daily[d] || { out: 0, msgs: 0, tools: 0, lines: 0 }) })
  }
  let streak = 0
  for (let i = 0; ; i++) {
    const d = dayOf(Date.now() - i * 24 * HOUR)
    if (daily[d]) streak++
    else if (i === 0) continue
    else break
  }
  const now = Date.now(), d7 = now - 7 * 24 * HOUR, d30 = now - 30 * 24 * HOUR
  const todayKey = dayOf(now)
  let lines7Add = 0, lines7Del = 0
  for (const l of lineEvents) if (l.t >= d7) { lines7Add += l.add; lines7Del += l.del }
  const costSaved = entries.reduce((s, e) => s + (e.cr / 1e6) * (PRICE_PER_M(e.model, e.t) || 0) * 0.9, 0)
  const unpricedModels = [...new Set(entries.filter(e => !isPriced(e.model)).map(e => e.model))]
  const sessions30 = files.filter(f => !f.isAgent && f.mtime >= d30).length
  const projNames = {}
  try { for (const d of Object.keys(readClaudeJson().projects || {})) projNames[d.replace(/[\\/:._]/g, '-')] = path.basename(d) } catch {}
  const recentSessions = files.filter(f => !f.isAgent && f.msgs > 0).sort((a, b) => b.mtime - a.mtime).slice(0, 6)
    .map(f => ({ sessionId: path.basename(f.path, '.jsonl'), proj: projNames[f.proj] || f.proj.split('-').pop(), mtime: f.mtime, out: f.out, msgs: f.msgs, toolCalls: f.toolCalls }))
  const tools = Object.entries(toolTotals).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([name, count]) => ({ name, count }))
  const hiddenPerTurn = HARNESS_DEFAULTS.context.alwaysLoadedBudget.systemPrompt + HARNESS_DEFAULTS.context.alwaysLoadedBudget.toolDefs
  const { map: cacheMap, sortedDates: cacheDates } = buildDailyCacheMap(entries)
  const rollingEff = rollingCacheEfficiency(cacheMap, cacheDates)
  const waste = cacheWasteCost(entries, entryCacheRates, rollingEff.bestEffPct / 100)
  const { map: usageMap, sortedDates: usageDates } = buildDailyUsage(entries, entryCost)
  const anomalies = detectDailyAnomalies(usageMap, usageDates)
  const dailyCostMap = {}; for (const d of usageDates) dailyCostMap[d] = usageMap[d].cost
  const budget = Number(req.query.budget) || null
  const projection = projectMonthEnd(dailyCostMap, dayOf(now), budget)
  res.json({
    perModel, activeBlock: active, totalMsgs: entries.length, since: entries[0]?.t || null,
    daily: series, streak, activeDays: days.length, tools, recentSessions, unpricedModels,
    unattributedAgentCost,
    health: computeUsageHealth(entries, entryCost, hiddenPerTurn, now),
    regression: computeRegression(entries, now),
    cacheTtl: { ...rollingEff, ...waste },
    anomalies: anomalies.slice(0, 20),
    costProjection: projection,
    kpis: {
      lines7d: { add: lines7Add, del: lines7Del },
      toolCallsToday: daily[todayKey]?.tools || 0, toolCallsTotal: entries.reduce((s, e) => s + e.tc, 0),
      sessions30, costSaved: Math.round(costSaved * 100) / 100, cacheReadTok: entries.reduce((s, e) => s + e.cr, 0),
    },
  })
})

const analysisTailer = createTailer({ maxCachedFiles: 256 })
function transcriptsSince(since) {
  const base = path.join(CLAUDE, 'projects')
  const files = []
  const walk = d => { try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.jsonl') && fs.statSync(p).mtimeMs >= since) files.push(p) } } catch {} }
  walk(base)
  return { base, files }
}
async function parsedRecords(file) {
  const r = await analysisTailer.read(file)
  return r.ok ? { records: r.records, malformed: r.malformed?.length || 0, cached: r.cached } : { records: [], malformed: 0, cached: false, error: r.error }
}

mountInsights(app, { collectUsage: (...a) => collectUsage(...a), parsedRecords: (...a) => parsedRecords(...a), transcriptsSince: (...a) => transcriptsSince(...a) })

const LIVE_TAIL_BYTES = 64 * 1024
function lastSignals(file, size) {
  const out = { lastEventType: null, lastContentTypes: null, permissionMode: null, lastTurn: null, stopReason: null }
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const start = Math.max(0, size - LIVE_TAIL_BYTES)
    const buf = Buffer.alloc(Math.min(size, LIVE_TAIL_BYTES))
    fs.readSync(fd, buf, 0, buf.length, start)
    const lines = buf.toString('utf8').split('\n')
    if (start > 0) lines.shift()
    for (let i = lines.length - 1; i >= 0; i--) {
      const raw = lines[i].trim()
      if (!raw) continue
      let j
      try { j = JSON.parse(raw) } catch { continue }
      out.lastEventType ??= j.type || null
      out.permissionMode ??= j.permissionMode || null
      out.stopReason ??= j.stopReason || null
      if (out.lastContentTypes == null && Array.isArray(j.message?.content))
        out.lastContentTypes = j.message.content.map(b => b?.type).filter(Boolean)
      const u = j.message?.usage
      if (!out.lastTurn && u && j.message?.model && j.message.model !== '<synthetic>')
        out.lastTurn = { model: j.message.model, in: u.input_tokens || 0, cc: u.cache_creation_input_tokens || 0, cr: u.cache_read_input_tokens || 0 }
      if (out.lastEventType && out.lastContentTypes && out.lastTurn) break
    }
  } catch { }
  finally { if (fd !== undefined) try { fs.closeSync(fd) } catch {} }
  return out
}

app.get('/api/live', (req, res) => {
  const now = Date.now()
  const { files } = collectUsage()
  const projNames = {}
  try { for (const d of Object.keys(readClaudeJson().projects || {})) projNames[d.replace(/[\\/:._]/g, '-')] = path.basename(d) } catch {}
  let hookSessions = new Map()
  try {
    const hv = hooksReceiver.getLiveState?.()
    for (const h of hv?.sessions || []) if (h.sessionIdKnown !== false && h.sessionId) hookSessions.set(h.sessionId, h)
  } catch { }

  const sessions = files.filter(f => !f.isAgent && f.msgs > 0).map(f => {
    let size = 0
    try { size = fs.statSync(f.path).size } catch {}
    const sig = lastSignals(f.path, size)
    const label = projNames[f.proj] || f.proj.split('-').pop()
    const sessionId = path.basename(f.path, '.jsonl')
    const hook = hookSessions.get(sessionId) || null
    const hookIsFresher = hook && Number(hook.lastSeen) > f.mtime
    const session = { sessionId, label, cwd: f.cwd, lastEventAt: hookIsFresher ? Number(hook.lastSeen) : f.mtime, ...sig }
    return {
      ...session,
      status: deriveStatus(session, now),
      live: hookIsFresher
        ? { status: hook.status, since: hook.statusSince, tool: hook.currentTool?.name || null, toolInputKeys: hook.currentTool?.inputKeys || null, agents: hook.agents?.length || 0 }
        : null,
      context: liveContextPressure(session),
      permission: permissionBadge(session),
      msgs: f.msgs, toolCalls: f.toolCalls, cost: f.cost,
    }
  })
  sessions.sort((a, b) => b.lastEventAt - a.lastEventAt)
  const collapsed = collapseIdle(sessions.map(s => ({ ...s, status: s.status.status })), now)
  const keep = new Set(collapsed.sessions.map(s => s.sessionId))
  res.json({
    now,
    sessions: sessions.filter(s => keep.has(s.sessionId)),
    hidden: collapsed.dropped,
    hiddenReasons: collapsed.reasons,
    hookReceiver: (() => { try { return (hooksReceiver.getLiveState?.()?.sessions?.length || 0) > 0 } catch { return false } })(),
  })
})

// ---------- projects ----------
const ACTIVE_MS = 5 * 60_000
const gitCache = new Map()
const LANG_EXT = { ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', py: 'Python', go: 'Go', rs: 'Rust', rb: 'Ruby', java: 'Java', kt: 'Kotlin', swift: 'Swift', css: 'CSS', scss: 'CSS', vue: 'Vue', php: 'PHP', dart: 'Dart', md: 'Markdown', sh: 'Shell' }
function repoInfo(dir) {
  const c = gitCache.get(dir)
  if (c && Date.now() - c.t < 10 * 60_000) return c
  let commits = null
  try { commits = parseInt(spawnSync('git', ['-C', dir, 'rev-list', '--count', 'HEAD'], { timeout: 3000 }).stdout.toString().trim()) || null } catch {}
  const counts = {}
  const walk2 = (d, depth) => {
    if (depth > 2) return
    try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name.startsWith('.') || e.name === 'node_modules') continue; if (e.isDirectory()) walk2(path.join(d, e.name), depth + 1); else { const l = LANG_EXT[path.extname(e.name).slice(1)]; if (l) counts[l] = (counts[l] || 0) + 1 } } } catch {}
  }
  walk2(dir, 0)
  const langs = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n]) => n)
  const info = { t: Date.now(), commits, langs }
  gitCache.set(dir, info)
  return info
}
app.get('/api/projects', (req, res) => {
  const cj = readClaudeJson()
  const { entries, lineEvents } = collectUsage()
  const byProj = {}
  const day = 24 * 3600_000, d14 = Date.now() - 14 * day
  for (const e of entries) {
    const p = (byProj[e.proj] ||= { out: 0, in: 0, cache: 0, msgs: 0, last: 0, models: {}, spark: new Array(14).fill(0), add: 0, del: 0 })
    p.out += e.out; p.in += e.in; p.cache += e.cc + e.cr; p.msgs++; p.last = Math.max(p.last, e.t)
    p.models[e.model] = (p.models[e.model] || 0) + 1
    if (e.t >= d14) p.spark[Math.min(13, Math.floor((e.t - d14) / day))] += e.out
  }
  for (const l of lineEvents) { const p = byProj[l.proj]; if (p) { p.add += l.add; p.del += l.del } }
  const now = Date.now(), base = path.join(CLAUDE, 'projects')
  const mangle = dir => dir.replace(/[\\/:._]/g, '-')
  const listDir = (p, nested) => { try { return fs.readdirSync(p, { withFileTypes: true }).filter(e => (nested ? e.isDirectory() : e.name.endsWith('.md'))).map(e => (nested ? e.name : e.name.replace(/\.md$/, ''))) } catch { return [] } }
  const out = []
  for (const dir of Object.keys(cj.projects || {})) {
    const tdir = path.join(base, mangle(dir))
    let sessions = 0, running = 0, runningAgents = 0
    const walkT = d => { try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walkT(p); else if (e.name.endsWith('.jsonl')) { const st = fs.statSync(p); if (d.includes('subagents')) { if (now - st.mtimeMs < ACTIVE_MS) runningAgents++ } else { sessions++; if (now - st.mtimeMs < ACTIVE_MS) running++ } } } } catch {} }
    walkT(tdir)
    let mcp = Object.keys(cj.projects[dir]?.mcpServers || {})
    try { mcp = [...new Set([...mcp, ...Object.keys(JSON.parse(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8')).mcpServers || {})])] } catch {}
    let progress = null
    try {
      const rm = fs.readFileSync(path.join(dir, '.planning', 'ROADMAP.md'), 'utf8')
      const done = (rm.match(/^\s*- \[x\]/gim) || []).length, open = (rm.match(/^\s*- \[ \]/gm) || []).length
      if (done + open) progress = { done, total: done + open }
    } catch {}
    const u = byProj[mangle(dir)]
    const exists = fs.existsSync(dir)
    const info = exists ? repoInfo(dir) : { commits: null, langs: [] }
    out.push({
      path: dir, name: path.basename(dir), exists, current: dir === PROJECT,
      sessions, running, runningAgents, progress, mcp,
      test: exists ? (() => { try { return detectTestCommand(dir) } catch { return null } })() : null,
      commits: info.commits, langs: info.langs,
      skills: listDir(path.join(dir, '.claude', 'skills'), true),
      commands: listDir(path.join(dir, '.claude', 'commands'), false),
      agents: listDir(path.join(dir, '.claude', 'agents'), false),
      usage: u ? { out: u.out, in: u.in, cache: u.cache, msgs: u.msgs, last: u.last, spark: u.spark, linesAdd: u.add, linesDel: u.del, topModel: Object.entries(u.models).sort((a, b) => b[1] - a[1])[0]?.[0] || null } : null,
    })
  }
  out.sort((a, b) => (b.current - a.current) || (b.usage?.last || 0) - (a.usage?.last || 0))
  res.json(out)
})

// ---------- chat: live claude sessions ----------
// ponytail: sessions live in server memory — a dashboard restart orphans the view, but the
const chats = new Map()
const PLAN_SCHEMA_RULE = `When asked to create an execution plan, you MUST output a JSON array inside a \`\`\`json code block — not a markdown list. Every element uses exactly this schema:
{"step_id": 1, "description": "short action", "dependencies": [], "expected_skill": [], "active_rules": [], "mcp_server": null, "tool_to_call": "Edit", "expected_params": {"name": "value or 'TBD based on step N'"}}
dependencies is an array of step_ids that must finish first. Use null/[] where a field does not apply. This rule applies only when an execution plan is requested; answer normally otherwise.`
function chatBroadcast(chat, ev) {
  chat.events.push(ev)
  const line = `data: ${JSON.stringify(ev)}\n\n`
  for (const l of chat.listeners) l.write(line)
}
const readTranscript = (file, parentId) => {
  const out = []
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      try {
        const j = JSON.parse(line)
        if ((j.type !== 'user' && j.type !== 'assistant') || j.isMeta || !j.message) continue
        if (typeof j.message.content === 'string' && j.message.content.startsWith('<')) continue
        out.push({ type: j.type, message: j.message, parent_tool_use_id: parentId || j.parent_tool_use_id || null, toolUseResult: j.toolUseResult, timestamp: j.timestamp })
      } catch {}
    }
  } catch {}
  return out
}
function historyEvents(cwd, sessionId) {
  const dir = path.join(CLAUDE, 'projects', mangle(cwd))
  const main = readTranscript(path.join(dir, sessionId + '.jsonl')).slice(-200)
  const taskIds = new Set()
  for (const e of main) if (e.type === 'assistant' && Array.isArray(e.message?.content))
    for (const c of e.message.content) if (c.type === 'tool_use' && (c.name === 'Task' || c.name === 'Agent')) taskIds.add(c.id)
  try {
    const subDir = path.join(dir, sessionId, 'subagents')
    for (const meta of fs.readdirSync(subDir).filter(f => f.endsWith('.meta.json'))) {
      let link; try { link = JSON.parse(fs.readFileSync(path.join(subDir, meta), 'utf8')) } catch { continue }
      if (!taskIds.has(link.toolUseId)) continue
      main.push(...readTranscript(path.join(subDir, meta.replace('.meta.json', '.jsonl')), link.toolUseId))
    }
  } catch {}
  return main
}
app.post('/api/chat', (req, res) => {
  const { cwd, resume, model } = req.body
  if (!cwd || !fs.existsSync(cwd)) return res.status(400).json({ error: 'cwd does not exist' })
  if (resume) {
    const existing = [...chats.entries()].find(([, c]) => c.alive && c.cwd === cwd && c.resume === resume)
    if (existing) return res.json({ id: existing[0] })
  }
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions', '--append-system-prompt', PLAN_SCHEMA_RULE]
  if (resume) args.push('--resume', resume)
  if (model) args.push('--model', model)
  const child = spawn('claude', args, { cwd, env: process.env, shell: WIN })
  const id = Math.random().toString(36).slice(2, 10)
  const chat = { child, cwd, resume: resume || null, model: model || null, sessionId: resume || null, alive: true, events: resume ? historyEvents(cwd, resume) : [], listeners: new Set() }
  chats.set(id, chat)
  let buf = ''
  child.stdout.on('data', d => {
    buf += d
    const lines = buf.split('\n')
    buf = lines.pop()
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const ev = JSON.parse(line)
        if (ev.type === 'system' && ev.subtype === 'init') chat.sessionId = ev.session_id
        chatBroadcast(chat, ev)
      } catch {}
    }
  })
  child.stderr.on('data', d => chatBroadcast(chat, { type: 'stderr', text: String(d).slice(0, 2000) }))
  child.on('error', e => { chat.alive = false; chatBroadcast(chat, { type: 'closed', error: e.message }) })
  child.on('exit', code => { chat.alive = false; chatBroadcast(chat, { type: 'closed', code }) })
  res.json({ id })
})
app.get('/api/chat', (req, res) =>
  res.json([...chats.entries()].map(([id, c]) => ({ id, cwd: c.cwd, sessionId: c.sessionId, model: c.model, alive: c.alive, events: c.events.length }))))
app.get('/api/chat/:id/events', (req, res) => {
  const chat = chats.get(req.params.id)
  if (!chat) return res.status(404).json({ error: 'no such chat' })
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
  res.write(': connected\n\n')
  for (const ev of chat.events) res.write(`data: ${JSON.stringify(ev)}\n\n`)
  chat.listeners.add(res)
  req.on('close', () => chat.listeners.delete(res))
})
app.post('/api/chat/:id/message', (req, res) => {
  const chat = chats.get(req.params.id)
  if (!chat) return res.status(404).json({ error: 'no such chat' })
  if (!chat.alive) return res.status(410).json({ error: 'session ended' })
  const content = (req.body.images || []).slice(0, 20).map(i => ({ type: 'image', source: { type: 'base64', media_type: i.media_type, data: i.data } }))
  content.push({ type: 'text', text: req.body.text })
  chatBroadcast(chat, { type: 'user', message: { role: 'user', content } })
  let modelContent = content
  try {
    const hits = req.body.text ? retrieveContext(req.body.text, mangle(chat.cwd)) : []
    if (hits.length) {
      const block = '[grounded context from your curated memory — cite as [memory:<name>] when you use a fact, and say if none apply]\n'
        + hits.map(h => `- ${h.name}: ${h.excerpt}`).join('\n')
      modelContent = [{ type: 'text', text: block }, ...content]
    }
  } catch {}
  chat.child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: modelContent } }) + '\n')
  res.json({ ok: true })
})
app.get('/api/chat/complete', (req, res) => {
  const cwd = req.query.cwd && fs.existsSync(req.query.cwd) ? req.query.cwd : HOME
  const q = String(req.query.q || '').toLowerCase()
  if (req.query.kind === 'files') {
    const qRaw = String(req.query.q || '')
    const r = spawnSync('git', ['-C', cwd, 'ls-files', '-co', '--exclude-standard'], { timeout: 5000, maxBuffer: 16 * 1024 * 1024 })
    if (r.status === 0 && r.stdout.toString().trim()) {
      const files = r.stdout.toString().split('\n').filter(Boolean)
      const dirs = new Set()
      for (const f of files) { let d = path.dirname(f); while (d && d !== '.' && d !== '/') { dirs.add(d + '/'); d = path.dirname(d) } }
      const match = [...dirs, ...files].filter(f => f.toLowerCase().includes(q))
      match.sort((a, b) => (b.endsWith('/') - a.endsWith('/')) || a.localeCompare(b))
      return res.json(match.slice(0, 25).map(f => ({ name: f })))
    }
    const slash = qRaw.lastIndexOf('/')
    const dirPart = slash >= 0 ? qRaw.slice(0, slash + 1) : ''
    const namePart = qRaw.slice(slash + 1).toLowerCase()
    let out = []
    try {
      out = fs.readdirSync(path.join(cwd, dirPart), { withFileTypes: true })
        .filter(d => d.name !== 'node_modules' && d.name !== '.git' && d.name.toLowerCase().includes(namePart))
        .map(d => ({ name: dirPart + d.name + (d.isDirectory() ? '/' : '') }))
    } catch {}
    out.sort((a, b) => (b.name.endsWith('/') - a.name.endsWith('/')) || a.name.localeCompare(b.name))
    return res.json(out.slice(0, 25))
  }
  const out = []
  const desc = p => { try { return (/^description:\s*["']?(.+?)["']?\s*$/m.exec(fs.readFileSync(p, 'utf8').slice(0, 2000)) || [])[1] || '' } catch { return '' } }
  const scanCmds = (dir, scope) => { try { for (const f of fs.readdirSync(dir)) if (f.endsWith('.md')) out.push({ name: f.replace(/\.md$/, ''), scope, desc: desc(path.join(dir, f)) }) } catch {} }
  const scanSkills = (dir, scope) => { try { for (const d of fs.readdirSync(dir)) { const p = path.join(dir, d, 'SKILL.md'); if (fs.existsSync(p)) out.push({ name: d, scope: scope + ' skill', desc: desc(p) }) } } catch {} }
  scanCmds(path.join(CLAUDE, 'commands'), 'user'); scanCmds(path.join(cwd, '.claude', 'commands'), 'project')
  scanSkills(path.join(CLAUDE, 'skills'), 'user'); scanSkills(path.join(cwd, '.claude', 'skills'), 'project')
  res.json(out.filter(c => c.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 25))
})
app.post('/api/chat/upload', express.raw({ type: '*/*', limit: '300mb' }), (req, res) => {
  const name = path.basename(String(req.query.name || 'file')).replace(/[^\w.-]/g, '_')
  if (!req.body?.length) return res.status(400).json({ error: 'empty upload' })
  const dir = path.join(CLAUDE, 'chat-uploads')
  fs.mkdirSync(dir, { recursive: true })
  const p = path.join(dir, Date.now().toString(36) + '-' + name)
  fs.writeFileSync(p, req.body)
  res.json({ path: p })
})
app.delete('/api/chat/:id', (req, res) => {
  const chat = chats.get(req.params.id)
  if (chat) { try { chat.child.kill() } catch {}; chats.delete(req.params.id) }
  res.json({ ok: true })
})

// ---------- quick actions: one-shot `claude -p "/cmd"` runs against a chosen project ----------
function analyzeRun(events) {
  const a = { tools: {}, files: new Set(), skills: new Set(), mcp: new Set(), agents: new Set(), cost: null, durationMs: null, turns: null, tokens: null }
  for (const ev of events) {
    if (ev.type === 'result') { a.cost = ev.total_cost_usd ?? a.cost; a.durationMs = ev.duration_ms ?? a.durationMs; a.turns = ev.num_turns ?? a.turns; a.tokens = ev.usage || a.tokens }
    if (ev.type !== 'assistant' || !Array.isArray(ev.message?.content)) continue
    for (const c of ev.message.content) {
      if (c.type !== 'tool_use') continue
      a.tools[c.name] = (a.tools[c.name] || 0) + 1
      if (c.name.startsWith('mcp__')) a.mcp.add(c.name.split('__')[1])
      if (c.name === 'Skill' && c.input?.skill) a.skills.add(c.input.skill)
      if ((c.name === 'Task' || c.name === 'Agent') && c.input?.subagent_type) a.agents.add(c.input.subagent_type)
      if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(c.name) && c.input?.file_path) a.files.add(c.input.file_path)
    }
  }
  return { ...a, files: [...a.files], skills: [...a.skills], mcp: [...a.mcp], agents: [...a.agents] }
}
app.post('/api/actions/run', (req, res) => {
  const { cmd, cwd, args, runner } = req.body
  const isCursor = runner === 'cursor'
  if (!cmd || (!isCursor && !String(cmd).startsWith('/'))) return res.status(400).json({ error: isCursor ? 'prompt required' : 'cmd must be a /slash-command' })
  if (!cwd || !fs.existsSync(cwd)) return res.status(400).json({ error: 'cwd does not exist' })
  if ([...chats.values()].filter(c => c.alive && c.action).length >= 3) return res.status(429).json({ error: 'max 3 concurrent action runs' }) // ponytail: global cap
  const prompt = args ? `${cmd} ${args}` : cmd
  const child = isCursor
    ? spawn('cursor-agent', ['-p', prompt, '--output-format', 'stream-json', '-f'], { cwd, env: process.env, shell: WIN, stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn('claude', ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'], { cwd, env: process.env, shell: WIN, stdio: ['ignore', 'pipe', 'pipe'] })
  const id = Math.random().toString(36).slice(2, 10)
  const chat = { child, cwd, sessionId: null, alive: true, events: [], listeners: new Set(), action: { cmd, args: args || '', runner: runner || 'claude', startedAt: Date.now() } }
  chats.set(id, chat)
  let buf = ''
  child.stdout.on('data', d => {
    buf += d
    const lines = buf.split('\n')
    buf = lines.pop()
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const ev = JSON.parse(line)
        if (ev.type === 'system' && ev.subtype === 'init') chat.sessionId = ev.session_id
        chatBroadcast(chat, ev)
      } catch {}
    }
  })
  child.stderr.on('data', d => chatBroadcast(chat, { type: 'stderr', text: String(d).slice(0, 2000) }))
  const finish = code => {
    if (!chat.alive) return
    chat.alive = false
    chat.action.endedAt = Date.now()
    chat.action.exitCode = code
    chat.analysis = analyzeRun(chat.events)
    chatBroadcast(chat, { type: 'closed', code })
  }
  child.on('error', e => { chatBroadcast(chat, { type: 'stderr', text: e.message }); finish(-1) })
  child.on('exit', finish)
  res.json({ id })
})
app.get('/api/actions', (req, res) =>
  res.json([...chats.entries()].filter(([, c]) => c.action).map(([id, c]) => ({
    id, cwd: c.cwd, alive: c.alive, sessionId: c.sessionId, ...c.action, analysis: c.analysis || null,
  })).sort((a, b) => b.startedAt - a.startedAt)))
app.get('/api/chat/sessions', (req, res) => {
  const dir = path.join(CLAUDE, 'projects', String(req.query.cwd || '').replace(/[\\/:._]/g, '-'))
  const out = []
  try {
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'))) {
      const p = path.join(dir, f), st = fs.statSync(p)
      let title = ''
      try {
        // ponytail: first 64KB is enough to find the opening user message
        const fd = fs.openSync(p, 'r'), b = Buffer.alloc(65536)
        const n = fs.readSync(fd, b, 0, b.length, 0)
        fs.closeSync(fd)
        for (const line of b.toString('utf8', 0, n).split('\n')) {
          try {
            const j = JSON.parse(line)
            if (j.type !== 'user') continue
            const c = j.message?.content
            const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x => x.type === 'text').map(x => x.text).join(' ') : ''
            if (text.trim() && !text.startsWith('<')) { title = text.slice(0, 120); break }
          } catch {}
        }
      } catch {}
      out.push({ sessionId: f.replace(/\.jsonl$/, ''), mtime: st.mtimeMs, size: st.size, title })
    }
  } catch {}
  out.sort((a, b) => b.mtime - a.mtime)
  res.json(out.slice(0, 20))
})

mountAgentTeams(app)

const HARNESS_DEFAULTS = {
  turnPolicy: { maxTurns: 40, stopConditions: ['task done', 'needs input', 'budget hit'], retry: '3x exp backoff (2s->8s)', onError: 'checkpoint + retry', checkpointInterval: 5 },
  context: { windowSize: 200000, compactionThreshold: 0.82, keepTurns: 12, alwaysLoadedBudget: { systemPrompt: 2100, toolDefs: 1700, softCap: 8000 } },
  modelRouting: [
    { task: 'Plan & architect', model: 'opus-4-8', fallback: 'sonnet-4-6' },
    { task: 'Implement & edit', model: 'sonnet-4-6', fallback: 'sonnet-4-6' },
    { task: 'Quick edits & grep', model: 'haiku-4-5', fallback: 'sonnet-4-6' },
    { task: 'Subagent default', model: 'sonnet-4-6', fallback: 'haiku-4-5' },
  ],
  environment: { sandbox: 'filesystem · repo-scoped', network: 'off (opt-in)' },
}
const GUARDRAIL_DEFS = [
  { rule: 'Destructive shell (rm -rf, dd)', pattern: 'Bash(rm -rf*)', dflt: 'BLOCK' },
  { rule: 'git push / force-push', pattern: 'Bash(git push*)', dflt: 'ASK' },
  { rule: 'Outbound network requests', pattern: 'WebFetch', dflt: 'ASK' },
  { rule: 'Read secret files (.env, keys)', pattern: 'Read(./.env)', dflt: 'DENY' },
  { rule: 'Package install', pattern: 'Bash(npm install*)', dflt: 'ALLOW' },
]
const settingsFileFor = scope => (scope === 'global' ? path.join(CLAUDE, 'settings.json') : path.join(scope, '.claude', 'settings.json'))
const claudeMdFor = scope => (scope === 'global' ? path.join(CLAUDE, 'CLAUDE.md') : path.join(scope, 'CLAUDE.md'))
const leafPaths = (obj, prefix = '') => {
  let out = []
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null) continue
    const p = prefix ? prefix + '.' + k : k
    if (typeof v === 'object' && !Array.isArray(v)) out = out.concat(leafPaths(v, p))
    else out.push(p)
  }
  return out
}
const getPath = (obj, p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[Array.isArray(o) ? Number(k) : k]), obj)
const deepMerge = (base, over) => {
  if (over === undefined) return base
  if (base && over && typeof base === 'object' && typeof over === 'object' && !Array.isArray(base) && !Array.isArray(over)) {
    const out = { ...base }
    for (const k of Object.keys(over)) out[k] = deepMerge(base[k], over[k])
    return out
  }
  return over
}
function harnessResolve(scope) {
  const gRaw = readJson(settingsFileFor('global'), {})
  const pRaw = scope === 'global' ? {} : readJson(settingsFileFor(scope), {})
  const overridden = scope === 'global' ? [] : leafPaths({ harness: pRaw.harness, permissions: pRaw.permissions, model: pRaw.model, env: pRaw.env })
  const settings = deepMerge(gRaw, pRaw)
  const h = deepMerge(HARNESS_DEFAULTS, settings.harness || {})
  const perms = settings.permissions || {}
  const guardMode = pat => {
    const inList = l => (perms[l] || []).some(r => r === pat)
    return inList('deny') ? 'DENY' : inList('ask') ? 'ASK' : inList('allow') ? 'ALLOW' : null
  }
  const guardrails = GUARDRAIL_DEFS.map(g => ({ ...g, mode: guardMode(g.pattern) || g.dflt, fromConfig: !!guardMode(g.pattern) }))
  const gates = []
  for (const [event, matchers] of Object.entries(settings.hooks || {}))
    for (const m of Array.isArray(matchers) ? matchers : [])
      for (const hk of m.hooks || [])
        gates.push({ name: `${event}${m.matcher ? ' · ' + m.matcher : ''}`, command: String(hk.command || '').slice(0, 80), status: 'hook', kind: 'hook' })
  for (const v of Array.isArray(settings.harness?.verification) ? settings.harness.verification : (Array.isArray(h.verification) ? h.verification : []))
    gates.push({ name: v.name, command: v.command, status: verifyResults.get(scope + '|' + v.name)?.status || 'manual', kind: 'gate' })
  const conflicts = []
  for (const [s, f] of [['global', settingsFileFor('global')], [scope, settingsFileFor(scope)]]) {
    if (s === 'global' && scope !== 'global') {}
    if (!fs.existsSync(f)) continue
    try { JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) { conflicts.push(`${f}: invalid JSON — ${e.message.slice(0, 60)}`) }
  }
  for (const l of ['allow', 'ask', 'deny']) for (const r of perms[l] || []) if (typeof r !== 'string') conflicts.push(`permissions.${l} contains a non-string entry`)
  const dupes = (perms.allow || []).filter(r => (perms.deny || []).includes(r))
  for (const d of dupes) conflicts.push(`"${d}" is in both allow and deny`)
  if (h.turnPolicy.maxTurns < 1 || h.turnPolicy.maxTurns > 500) conflicts.push('harness.turnPolicy.maxTurns out of range (1-500)')
  if (h.context.compactionThreshold < 0.3 || h.context.compactionThreshold > 0.98) conflicts.push('harness.context.compactionThreshold out of range (0.3-0.98)')
  const mdPath = claudeMdFor(scope)
  const md = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : (scope !== 'global' && fs.existsSync(path.join(scope, '.claude', 'CLAUDE.md')) ? fs.readFileSync(path.join(scope, '.claude', 'CLAUDE.md'), 'utf8') : null)
  const claudeMdTokens = md ? tokens(md) : 0
  let usedTokens = null
  try {
    const { entries } = collectUsage()
    const proj = scope === 'global' ? null : mangle(scope)
    const rel = proj ? entries.filter(e => e.proj === proj) : entries
    const last = rel[rel.length - 1]
    if (last) usedTokens = Math.min(last.in + last.cr, h.context.windowSize)
  } catch {}
  const checks = [
    ['add a deny list', (perms.deny || []).length > 0, 15],
    ['add ask-first rules', (perms.ask || []).length > 0, 10],
    ['add auto-allow rules', (perms.allow || []).length > 0, 10],
    ['create CLAUDE.md', !!md, 10],
    ['trim always-loaded budget under soft cap', h.context.alwaysLoadedBudget.systemPrompt + h.context.alwaysLoadedBudget.toolDefs + claudeMdTokens <= h.context.alwaysLoadedBudget.softCap, 10],
    ['set compaction between 50–95%', h.context.compactionThreshold >= 0.5 && h.context.compactionThreshold <= 0.95, 10],
    ['set turn budget between 10–200', h.turnPolicy.maxTurns >= 10 && h.turnPolicy.maxTurns <= 200, 10],
    ['add ≥2 verification gates', gates.length >= 2, 15],
    ['resolve schema conflicts', conflicts.length === 0, 10],
  ]
  const health = checks.reduce((s, [, ok, w]) => s + (ok ? w : 0), 0)
  const failing = checks.filter(c => !c[1]).map(c => c[0])
  return {
    resolved: {
      turnPolicy: h.turnPolicy, context: h.context, modelRouting: h.modelRouting,
      guardrails: guardrails.map(({ rule, pattern, mode }) => ({ rule, pattern, mode })),
      permissions: { autoAllow: perms.allow || [], askFirst: perms.ask || [], denied: perms.deny || [], sandbox: h.environment.sandbox },
      environment: { workingDir: scope === 'global' ? HOME : scope, sandbox: h.environment.sandbox, network: h.environment.network, shell: (process.env.SHELL || process.env.ComSpec || '/bin/sh') + ' · non-interactive', envVars: Object.keys(settings.env || {}).length },
      model: settings.model || null,
    },
    verification: gates, overridden,
    meta: { configPath: settingsFileFor(scope), instrPath: mdPath, claudeMd: md, claudeMdTokens, usedTokens, windowSize: h.context.windowSize },
    health: { score: health, failing },
    valid: { ok: conflicts.length === 0, conflicts },
  }
}
const verifyResults = new Map()
app.get('/api/harness', (req, res) => {
  const cj = readJson(CLAUDE_JSON, {})
  const scopes = [{ id: 'global', label: 'Global', path: settingsFileFor('global'), ovCount: 0 }]
  for (const dir of Object.keys(cj.projects || {})) {
    if (dir === HOME || !fs.existsSync(dir)) continue
    const pset = readJson(path.join(dir, '.claude', 'settings.json'), null)
    scopes.push({ id: dir, label: path.basename(dir), path: path.join(dir, '.claude', 'settings.json'), ovCount: pset ? leafPaths({ harness: pset.harness, permissions: pset.permissions, model: pset.model, env: pset.env }).length : 0 })
  }
  const scope = req.query.scope && (req.query.scope === 'global' || scopes.some(s => s.id === req.query.scope)) ? req.query.scope : 'global'
  res.json({ scopes, scope, ...harnessResolve(scope) })
})
app.patch('/api/harness', (req, res) => {
  const { scope, path: dotPath, value } = req.body
  if (!dotPath || !/^(harness|permissions|model|env)(\.|$)/.test(dotPath)) return res.status(400).json({ error: 'path must be under harness/permissions/model/env' })
  const file = settingsFileFor(scope)
  const settings = readJson(file, {})
  const keys = dotPath.split('.')
  let o = settings
  for (const k of keys.slice(0, -1)) o = o[k] = (o[k] && typeof o[k] === 'object') ? o[k] : {}
  if (value === null) delete o[keys[keys.length - 1]]
  else o[keys[keys.length - 1]] = value
  const content = JSON.stringify(settings, null, 2)
  if (scope === 'global') return res.json({ ok: true, proposed: propose(file, content, `set ${dotPath}`), ...harnessResolve(scope) })
  track(file, content, { scope, summary: `set ${dotPath}` })
  res.json({ ok: true, ...harnessResolve(scope) })
})
app.get('/api/harness/raw', (req, res) => {
  const file = settingsFileFor(req.query.scope || 'global')
  res.json({ path: file, content: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '{\n}\n' })
})
app.put('/api/harness/raw', (req, res) => {
  const { scope, content } = req.body
  try { JSON.parse(content) } catch (e) { return res.status(400).json({ error: 'invalid JSON: ' + e.message }) }
  const file = settingsFileFor(scope || 'global')
  if ((scope || 'global') === 'global') return res.json({ ok: true, proposed: propose(file, content, 'edit settings.json (raw)') })
  track(file, content, { scope, summary: 'edit settings.json (raw)' })
  res.json({ ok: true })
})
app.post('/api/harness/verify', (req, res) => {
  const { scope, name, command } = req.body
  const cwd = scope === 'global' ? HOME : scope
  exec(command, { cwd, timeout: 60000 }, (err, stdout, stderr) => {
    const status = err ? 'failing' : 'passing'
    verifyResults.set(scope + '|' + name, { status, t: Date.now() })
    res.json({ status, out: String(stdout || '').slice(-400), err: String(stderr || '').slice(-400) })
  })
})

// ---------- project harness hub ----------
const readIf = p => { try { return fs.readFileSync(p, 'utf8') } catch { return null } }
const splitSections = src => {
  const out = []
  let cur = { heading: '(preamble)', text: '' }
  for (const line of (src || '').split('\n')) {
    if (/^#{1,3} /.test(line)) { if (cur.text.trim()) out.push(cur); cur = { heading: line.replace(/^#+ /, '').trim(), text: '' } }
    cur.text += line + '\n'
  }
  if (cur.text.trim()) out.push(cur)
  return out
}
function hubListSkills(dir, scope) {
  const out = []
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const src = readIf(path.join(dir, e.name, 'SKILL.md'))
      if (src == null) continue
      const { fm, body } = parseFM(src)
      const st = fs.statSync(path.join(dir, e.name, 'SKILL.md'))
      out.push({ name: e.name, scope, trigger: String(fm.description || '').slice(0, 160), descTokens: tokens(String(fm.description || '')), fullTokens: tokens(src), mtime: st.mtimeMs, path: path.join(dir, e.name, 'SKILL.md'), body })
    }
  } catch {}
  return out
}
function hubListAgents(dir, scope) {
  const out = []
  try {
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md'))) {
      const src = readIf(path.join(dir, f))
      const { fm, body } = parseFM(src || '')
      const toolsRaw = fm.tools
      const tools = Array.isArray(toolsRaw) ? toolsRaw : String(toolsRaw || '').split(',').map(s => s.trim()).filter(Boolean)
      out.push({ name: f.replace(/\.md$/, ''), scope, model: fm.model || 'inherit', tools, depth: tools.some(t => /^(Task|Agent|\*)$/.test(t)) || tools.length === 0 ? 2 : 1, path: path.join(dir, f), body, desc: String(fm.description || '').slice(0, 140) })
    }
  } catch {}
  return out
}
function hubResolve(project) {
  const H = harnessResolve(project)
  const softCap = H.resolved.context.alwaysLoadedBudget.softCap
  // ---- rules stack in load order ----
  const ruleFiles = [
    { layer: 'global', label: '~/.claude/CLAUDE.md', file: path.join(CLAUDE, 'CLAUDE.md') },
    { layer: 'project', label: '.claude/CLAUDE.md', file: path.join(project, '.claude', 'CLAUDE.md') },
    { layer: 'project', label: 'CLAUDE.md', file: path.join(project, 'CLAUDE.md') },
    { layer: 'project', label: 'AGENTS.md', file: path.join(project, 'AGENTS.md') },
    { layer: 'project', label: '.cursorrules', file: path.join(project, '.cursorrules') },
  ].map(r => { const src = readIf(r.file); return { ...r, exists: src != null, tokens: src ? tokens(src) : 0, src } })
  const rules = ruleFiles.filter(r => r.exists)
  const globalSections = splitSections(rules.find(r => r.layer === 'global')?.src || '')
  // ---- prompt preview blocks with provenance ----
  const promptBlocks = []
  for (const r of rules)
    for (const sec of splitSections(r.src)) {
      const overrides = r.layer === 'project' && globalSections.some(g => g.heading !== '(preamble)' && g.heading.toLowerCase() === sec.heading.toLowerCase())
      promptBlocks.push({ source: r.label, layer: r.layer, path: r.file, heading: sec.heading, text: sec.text.slice(0, 4000), relation: overrides ? 'overrides' : 'appends' })
    }
  // ---- skills / agents (global + project) ----
  const skills = [...hubListSkills(path.join(CLAUDE, 'skills'), 'global'), ...hubListSkills(path.join(project, '.claude', 'skills'), 'project')]
  const agents = [...hubListAgents(path.join(CLAUDE, 'agents'), 'global'), ...hubListAgents(path.join(project, '.claude', 'agents'), 'project')]
  // ---- ADRs ----
  const adrs = []
  for (const d of ['docs/adr', 'docs/adrs', 'adr', 'docs/decisions', 'docs/architecture/decisions'].map(d => path.join(project, d))) {
    try {
      for (const f of fs.readdirSync(d).filter(f => f.endsWith('.md'))) {
        const src = readIf(path.join(d, f)) || ''
        const title = (src.match(/^#\s+(.+)$/m) || [])[1] || f.replace(/\.md$/, '')
        const status = ((src.match(/status[:\s]+\**\s*(proposed|accepted|superseded|rejected|deprecated)/i) || [])[1] || 'proposed').toLowerCase()
        const constrains = (src.split(/^##\s/m)[1] || src).replace(/^.+\n/, '').trim().slice(0, 180)
        adrs.push({ id: f.replace(/\.md$/, ''), title: title.slice(0, 90), status, constrains, path: path.join(d, f), body: src })
      }
    } catch {}
  }
  // ---- references: URLs cited by rules/skills/adrs ----
  const refMap = new Map()
  const cite = (src, byType, byName) => {
    for (const url of (src || '').match(/https?:\/\/[^\s)>"'\]]+/g) || []) {
      const key = url.replace(/[.,;]$/, '')
      if (!refMap.has(key)) refMap.set(key, { url: key, citedBy: [] })
      const r = refMap.get(key)
      if (!r.citedBy.some(c => c.name === byName)) r.citedBy.push({ type: byType, name: byName })
    }
  }
  for (const r of rules) cite(r.src, 'rule', r.label)
  for (const s of skills) cite(s.body, 'skill', s.name)
  for (const a of adrs) cite(a.body, 'adr', a.id)
  const references = [...refMap.values()].slice(0, 40)
  // ---- MCP servers ----
  const cj = readJson(CLAUDE_JSON, {})
  const mcpDefs = []
  for (const [name, config] of Object.entries(cj.mcpServers || {})) mcpDefs.push({ name, scope: 'global', config })
  for (const [name, config] of Object.entries(cj.projects?.[project]?.mcpServers || {})) mcpDefs.push({ name, scope: 'project', config })
  for (const [name, config] of Object.entries(readJson(path.join(project, '.mcp.json'), {}).mcpServers || {})) mcpDefs.push({ name, scope: 'project', config })
  const mcps = mcpDefs.map(m => {
    const usedBy = []
    for (const s of skills) if ((s.body || '').includes(m.name)) usedBy.push({ type: 'skill', name: s.name })
    for (const a of agents) if (a.tools.some(t => t.includes('mcp__' + m.name)) || (a.body || '').includes('mcp__' + m.name)) usedBy.push({ type: 'agent', name: a.name })
    return { name: m.name, scope: m.scope, transport: m.config.url ? 'http' : 'stdio', toolsHint: m.config.url || m.config.command || '', usedBy, estTokens: 600 }
  })
  // ---- context budget contributors ----
  const contributors = [
    { name: 'system prompt', kind: 'system', tokens: H.resolved.context.alwaysLoadedBudget.systemPrompt, mode: 'always', scope: 'global', est: true },
    ...rules.map(r => ({ name: r.label, kind: 'rules', tokens: r.tokens, mode: 'always', scope: r.layer, path: r.file })),
    ...skills.map(s => ({ name: s.name, kind: 'skill', tokens: s.descTokens, onInvoke: s.fullTokens, mode: 'on-invoke', scope: s.scope, path: s.path })),
    ...mcps.map(m => ({ name: m.name, kind: 'mcp', tokens: m.estTokens, mode: 'always', scope: m.scope, est: true })),
    ...references.slice(0, 10).map(r => ({ name: r.url.replace(/^https?:\/\//, '').slice(0, 40), kind: 'reference', tokens: 0, mode: 'on-demand', scope: 'project' })),
  ]
  const alwaysOn = contributors.filter(c => c.mode === 'always').reduce((s, c) => s + c.tokens, 0) + skills.reduce((s, x) => s + x.descTokens, 0)
  // ---- memory / scratchpad ----
  const memory = []
  const memDir = path.join(CLAUDE, 'projects', mangle(project), 'memory')
  try { for (const f of fs.readdirSync(memDir)) { const st = fs.statSync(path.join(memDir, f)); memory.push({ name: 'memory/' + f, path: path.join(memDir, f), mtime: st.mtimeMs, persists: true }) } } catch {}
  for (const f of ['MEMORY.md', '.planning/STATE.md', '.planning/ROADMAP.md', 'docs/superpowers']) {
    try { const st = fs.statSync(path.join(project, f)); memory.push({ name: f, path: path.join(project, f), mtime: st.mtimeMs, persists: true, dir: st.isDirectory() }) } catch {}
  }
  memory.push({ name: 'session scratchpad (/tmp)', path: null, mtime: null, persists: false })
  // ---- graph ----
  const nodes = [], edges = []
  const addNode = (id, type, label, p) => { if (!nodes.some(n => n.id === id)) nodes.push({ id, type, label, path: p || null }) }
  const projRules = rules.filter(r => r.layer === 'project')
  addNode('rules:global', 'rule', 'global rules', path.join(CLAUDE, 'CLAUDE.md'))
  for (const r of projRules) addNode('rules:' + r.label, 'rule', r.label, r.file)
  const topSkills = [...skills].sort((a, b) => b.mtime - a.mtime).slice(0, 10)
  for (const s of topSkills) addNode('skill:' + s.name, 'skill', s.name, s.path)
  for (const a of agents.slice(0, 8)) addNode('agent:' + a.name, 'agent', a.name, a.path)
  for (const m of mcps.slice(0, 8)) addNode('mcp:' + m.name, 'mcp', m.name, null)
  for (const a of adrs.slice(0, 8)) addNode('adr:' + a.id, 'adr', a.id, a.path)
  for (const r of references.slice(0, 6)) addNode('ref:' + r.url, 'ref', r.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 24), null)
  const addEdge = (a, b, rel) => { if (nodes.some(n => n.id === a) && nodes.some(n => n.id === b) && !edges.some(e => e.a === a && e.b === b)) edges.push({ a, b, rel }) }
  for (const s of topSkills) {
    for (const m of mcps) if ((s.body || '').includes(m.name)) addEdge('skill:' + s.name, 'mcp:' + m.name, 'uses')
    for (const r of references.slice(0, 6)) if ((s.body || '').includes(r.url)) addEdge('skill:' + s.name, 'ref:' + r.url, 'cites')
  }
  for (const a of agents.slice(0, 8)) {
    addEdge('agent:' + a.name, projRules.length ? 'rules:' + projRules[0].label : 'rules:global', 'bound by')
    for (const m of mcps) if (a.tools.some(t => t.includes('mcp__' + m.name))) addEdge('agent:' + a.name, 'mcp:' + m.name, 'uses')
  }
  for (const a of adrs.slice(0, 8)) {
    const mentioned = rules.some(r => (r.src || '').includes(a.id)) || (a.body || '').match(/CLAUDE\.md|AGENTS\.md/i)
    if (mentioned) addEdge('adr:' + a.id, projRules.length ? 'rules:' + projRules[0].label : 'rules:global', 'justifies')
  }
  // ---- trigger map ----
  const settingsMerged = deepMerge(readJson(settingsFileFor('global'), {}), readJson(settingsFileFor(project), {}))
  const triggers = []
  for (const [event, ms] of Object.entries(settingsMerged.hooks || {}))
    for (const m of Array.isArray(ms) ? ms : [])
      for (const hk of m.hooks || []) triggers.push({ event: event + (m.matcher ? ` (${m.matcher})` : ''), target: String(hk.command || '').slice(0, 60), kind: 'hook' })
  for (const s of topSkills) if (s.trigger) triggers.push({ event: 'prompt: ' + s.trigger.slice(0, 60), target: '/' + s.name, kind: 'skill' })
  for (const a of agents.slice(0, 6)) if (a.desc) triggers.push({ event: 'delegation: ' + a.desc.slice(0, 60), target: a.name + ' agent', kind: 'agent' })
  // ---- conflict / redundancy audit ----
  const findings = []
  const F = (severity, text, artifact) => findings.push({ severity, text, artifact })
  const names = {}
  for (const s of skills) { (names[s.name] ||= []).push(s) }
  for (const [n, list] of Object.entries(names)) if (list.length > 1) F('warning', `duplicate skill "${n}" exists in global and project scope — project wins`, { type: 'skill', name: n, path: list.find(s => s.scope === 'project')?.path })
  for (const m of mcps) if (!m.usedBy.length) F('info', `MCP server "${m.name}" is referenced by no skill or agent`, { type: 'mcp', name: m.name })
  const mergedRules = rules.map(r => r.src).join('\n')
  if (/\b(test|lint|typecheck)\b/i.test(mergedRules) && triggers.filter(t => t.kind === 'hook').length === 0 && !H.verification.some(g => g.kind === 'gate'))
    F('warning', 'rules mention test/lint/typecheck but no hook or verification gate enforces them', { type: 'rule', name: 'rules stack' })
  if (alwaysOn > softCap) F('error', `always-loaded context (${Math.round(alwaysOn / 100) / 10}k) exceeds the ${Math.round(softCap / 1000)}k soft cap`, { type: 'budget', name: 'context budget' })
  for (const a of adrs) if (a.status === 'superseded') F('info', `ADR "${a.id}" is superseded — check nothing still cites it`, { type: 'adr', name: a.id, path: a.path })
  for (const b of promptBlocks) if (b.relation === 'overrides') F('info', `project section "${b.heading}" overrides the global section of the same name`, { type: 'rule', name: b.source, path: b.path })
  for (const c of H.valid.conflicts) F('error', c, { type: 'config', name: 'settings.json' })
  const sev = { error: 15, warning: 8, info: 2 }
  const health = Math.max(5, 100 - findings.reduce((s, f) => s + sev[f.severity], 0))
  // ---- sessions (for replay) ----
  const sessions = []
  try {
    const sdir = path.join(CLAUDE, 'projects', mangle(project))
    for (const f of fs.readdirSync(sdir).filter(f => f.endsWith('.jsonl')).slice(0, 200)) {
      const st = fs.statSync(path.join(sdir, f))
      sessions.push({ id: f.replace(/\.jsonl$/, ''), mtime: st.mtimeMs, size: st.size })
    }
  } catch {}
  sessions.sort((a, b) => b.mtime - a.mtime)
  return {
    project, harness: { overridden: H.overridden, health: H.health, valid: H.valid, context: H.resolved.context },
    budget: { contributors, alwaysOn, softCap, onInvoke: skills.reduce((s, x) => s + x.fullTokens, 0) },
    promptBlocks, graph: { nodes, edges },
    inventory: {
      skills: skills.map(({ body, ...s }) => s), agents: agents.map(({ body, ...a }) => a),
      rules: ruleFiles.map(({ src, ...r }) => r), adrs: adrs.map(({ body, ...a }) => a), references, mcps, memory,
    },
    triggers: triggers.slice(0, 40), findings, health, sessions: sessions.slice(0, 8),
  }
}
app.get('/api/hub', (req, res) => {
  const project = req.query.project
  if (!project || !fs.existsSync(project)) return res.status(400).json({ error: 'unknown project' })
  res.json(hubResolve(project))
})
app.get('/api/hub/session', (req, res) => {
  const { project, id } = req.query
  const f = path.join(CLAUDE, 'projects', mangle(String(project || '')), String(id || '') + '.jsonl')
  if (!/^[\w-]+$/.test(String(id || '')) || !fs.existsSync(f)) return res.status(404).json({ error: 'no such session' })
  const out = { skills: [], agents: [], tools: {}, msgs: 0, compactions: 0, first: null, last: null }
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line) continue
    try {
      const j = JSON.parse(line)
      if (j.timestamp) { out.last = Date.parse(j.timestamp); out.first ??= out.last }
      if (j.isCompactSummary || j.type === 'summary') out.compactions++
      if (j.type !== 'assistant' || !Array.isArray(j.message?.content)) continue
      out.msgs++
      for (const c of j.message.content) {
        if (c.type !== 'tool_use') continue
        out.tools[c.name] = (out.tools[c.name] || 0) + 1
        if (c.name === 'Skill' && c.input?.skill) out.skills.push(c.input.skill)
        if ((c.name === 'Task' || c.name === 'Agent') && c.input) out.agents.push(c.input.subagent_type || c.input.description || 'agent')
      }
    } catch {}
  }
  out.skills = [...new Set(out.skills)]
  res.json(out)
})
app.get('/api/hub/file', (req, res) => {
  const p = path.resolve(String(req.query.path || ''))
  const cj = readJson(CLAUDE_JSON, {})
  const roots = [CLAUDE, ...Object.keys(cj.projects || {})]
  if (!roots.some(r => p === r || p.startsWith(r + path.sep))) return res.status(403).json({ error: 'outside allowed roots' })
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) return res.status(404).json({ error: 'not a file' })
  res.json({ path: p, content: fs.readFileSync(p, 'utf8') })
})
app.put('/api/hub/file', (req, res) => {
  const p = path.resolve(String(req.body.path || ''))
  const cj = readJson(CLAUDE_JSON, {})
  const roots = [CLAUDE, ...Object.keys(cj.projects || {})]
  if (!roots.some(r => p === r || p.startsWith(r + path.sep))) return res.status(403).json({ error: 'outside allowed roots' })
  if (p.endsWith('.json')) { try { JSON.parse(req.body.content) } catch (e) { return res.status(400).json({ error: 'invalid JSON: ' + e.message }) } }
  const scope = roots.find(r => r !== CLAUDE && p.startsWith(r + path.sep)) || 'global'
  track(p, req.body.content, { scope, summary: 'edit ' + path.basename(p) })
  res.json({ ok: true })
})

// ---------- governance: version history, approvals, audit ----------
app.get('/api/gov/versions', (req, res) => {
  const { scope, file, author, q } = req.query
  let v = readVersions()
  if (scope) v = v.filter(x => x.scope === scope)
  if (file) v = v.filter(x => x.file.includes(file))
  if (author) v = v.filter(x => x.author === author)
  if (q) v = v.filter(x => (x.summary + x.file).toLowerCase().includes(String(q).toLowerCase()))
  res.json(v.slice(-300).reverse().map(({ prev, content, ...meta }) => ({ ...meta, bytes: (content || '').length })))
})
app.get('/api/gov/versions/:id', (req, res) => {
  const v = readVersions().find(x => x.id === req.params.id)
  if (!v) return res.status(404).json({ error: 'no such version' })
  res.json(v)
})
app.post('/api/gov/rollback', (req, res) => {
  const v = readVersions().find(x => x.id === req.body.id)
  if (!v) return res.status(404).json({ error: 'no such version' })
  const target = req.body.to === 'prev' ? v.prev : v.content
  if (target == null) return res.status(400).json({ error: 'nothing to roll back to' })
  const id = track(v.file, target, { scope: v.scope, summary: `rollback to ${v.id}${req.body.to === 'prev' ? ' (before)' : ''}` })
  res.json({ ok: true, id })
})
app.get('/api/gov/approvals', (req, res) => res.json(readApprovals().slice(-100).reverse()))
app.post('/api/gov/approvals/:id', (req, res) => {
  const a = readApprovals()
  const p = a.find(x => x.id === req.params.id)
  if (!p || p.status !== 'proposed') return res.status(404).json({ error: 'no pending proposal' })
  p.status = req.body.approve ? 'approved' : 'rejected'
  p.reviewedBy = AUTHOR; p.reviewedAt = Date.now(); p.note = req.body.note || ''
  if (req.body.approve) track(p.file, p.content, { scope: 'global', summary: p.summary, approvedBy: AUTHOR })
  writeApprovals(a)
  res.json({ ok: true, status: p.status })
})

// ---------- dry-run: resolve a hypothetical settings content without committing ----------
app.post('/api/gov/dryrun', (req, res) => {
  const { scope, content } = req.body
  let proposed
  try { proposed = JSON.parse(content) } catch (e) { return res.status(400).json({ error: 'invalid JSON: ' + e.message }) }
  const before = harnessResolve(scope)
  const file = settingsFileFor(scope)
  const real = readIf(file)
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(proposed, null, 2)) // ponytail: write+revert beats threading an override through the resolver
    const after = harnessResolve(scope)
    const pick = H => ({
      alwaysBudget: H.resolved.context.alwaysLoadedBudget, compaction: H.resolved.context.compactionThreshold,
      maxTurns: H.resolved.turnPolicy.maxTurns, guardrails: H.resolved.guardrails, routing: H.resolved.modelRouting,
      gates: H.verification.length, health: H.health.score, conflicts: H.valid.conflicts,
      permissions: H.resolved.permissions,
    })
    res.json({ before: pick(before), after: pick(after) })
  } finally {
    if (real == null) fs.rmSync(file, { force: true })
    else fs.writeFileSync(file, real)
  }
})

// ---------- failure & retry analytics ----------
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
        toolErrs: {}, toolUses: {}, byHour: {}, turns: 0, compactions: 0, retries: 0, last: 0,
        errs: [], bytes: {}, sizes: {}, big: [],
      }
      const idName = {}
      let lastErrTool = null
      const RESULT_TEXT = c => (typeof c.content === 'string' ? c.content : Array.isArray(c.content) ? c.content.map(x => x?.text || (typeof x === 'string' ? x : '')).join('\n') : c.content ? JSON.stringify(c.content) : '')
      try {
        for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
          if (!line) continue
          const isErr = line.includes('"is_error":true')
          if (!isErr && !line.includes('"tool_use"') && !line.includes('tool_result') && !line.includes('isCompactSummary') && !line.includes('"type":"summary"')) continue
          try {
            const j = JSON.parse(line)
            const t = Date.parse(j.timestamp) || 0
            rec.last = Math.max(rec.last, t)
            if (j.isCompactSummary || j.type === 'summary') { rec.compactions++; continue }
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
  const tools = Object.keys(toolUses).map(name => ({ name, uses: toolUses[name], errors: toolErrs[name] || 0, rate: toolUses[name] ? (toolErrs[name] || 0) / toolUses[name] : 0 }))
    .filter(t => t.uses >= 3).sort((a, b) => b.errors - a.errors).slice(0, 12)
  res.json({ tools, byHour, compactions, retries, turnsDist, sessions: recs.length })
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
      } else if (j.isCompactSummary || j.type === 'summary') steps.push({ kind: 'checkpoint', ts, text: 'context compacted' })
    } catch {}
  }
  for (let i = 0; i < steps.length; i++) steps[i].latency = steps[i + 1]?.ts && steps[i].ts ? steps[i + 1].ts - steps[i].ts : null
  const ver = readVersions().filter(v => v.ts <= (firstTs || 0)).pop() || null
  res.json({ steps: steps.slice(0, 400), total: steps.length, startedAt: firstTs, configVersion: ver ? { id: ver.id, summary: ver.summary, file: ver.file, ts: ver.ts } : null })
})

// ---------- eval / regression suite ----------
const EVALS_FILE = path.join(CLAUDE, 'harness-evals.json')
const EVAL_RUNS = path.join(CLAUDE, 'harness-eval-runs.jsonl')
const DEFAULT_EVALS = [
  { name: 'sanity: instruction following', prompt: 'Reply with exactly the word: HARNESS_OK', expect: 'HARNESS_OK' },
  { name: 'reasoning: arithmetic', prompt: 'What is 17*23? Reply with just the number.', expect: '391' },
  { name: 'tool use: filesystem', prompt: 'List the files in the current directory, then reply with the word FS_DONE at the end.', expect: 'FS_DONE' },
]
const evalRuns = () => { try { return fs.readFileSync(EVAL_RUNS, 'utf8').split('\n').filter(Boolean).map(JSON.parse) } catch { return [] } }
const activeEvals = new Map()
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
function costAlerts() {
  const { entries } = collectUsage()
  const today = new Date().toISOString().slice(0, 10)
  const gRaw = readJson(settingsFileFor('global'), {})
  const budgets = deepMerge({ dailyUSD: null, dailyTokens: null }, gRaw.harness?.budgets || {})
  let usd = 0, tok = 0
  for (const e of entries) if (new Date(e.t).toISOString().slice(0, 10) === today) { usd += entryCost(e); tok += e.in + e.out + e.cc }
  const alerts = []
  for (const [key, cap, val, unit] of [['dailyUSD', budgets.dailyUSD, usd, '$'], ['dailyTokens', budgets.dailyTokens, tok, ' tok']]) {
    if (!cap) continue
    if (val >= cap) alerts.push({ level: 'error', text: `${key} cap exceeded: ${unit === '$' ? '$' + val.toFixed(2) : Math.round(val).toLocaleString() + unit} / ${unit === '$' ? '$' + cap : cap.toLocaleString() + unit}` })
    else if (val >= cap * 0.8) alerts.push({ level: 'warning', text: `${key} at ${Math.round((val / cap) * 100)}% of cap` })
  }
  return { todayUSD: usd, todayTokens: tok, budgets, alerts }
}
app.get('/api/gov/costs', (req, res) => {
  const days = Number(req.query.days) || 30
  const { entries } = collectUsage()
  const cutoff = Date.now() - days * 86400_000
  const byDay = {}, byProj = {}, byModel = {}
  for (const e of entries) {
    if (e.t < cutoff) continue
    const c = entryCost(e), d = new Date(e.t).toISOString().slice(0, 10)
    ;(byDay[d] ||= { usd: 0, tok: 0 }); byDay[d].usd += c; byDay[d].tok += e.in + e.out + e.cc
    ;(byProj[e.proj] ||= { usd: 0, tok: 0 }); byProj[e.proj].usd += c; byProj[e.proj].tok += e.in + e.out + e.cc
    ;(byModel[e.model] ||= { usd: 0, tok: 0 }); byModel[e.model].usd += c; byModel[e.model].tok += e.in + e.out + e.cc
  }
  res.json({ byDay, byProj, byModel, ...costAlerts() })
})

// ---------- profiles / presets ----------
const PROFILES_FILE = path.join(CLAUDE, 'harness-profiles.json')
const DEFAULT_PROFILES = [
  { name: 'deep refactor', description: 'long horizon, strict verification, opus for planning', harness: { turnPolicy: { maxTurns: 120, checkpointInterval: 3 }, modelRouting: [{ task: 'Plan & architect', model: 'opus-4-8', fallback: 'sonnet-4-6' }, { task: 'Implement & edit', model: 'sonnet-4-6', fallback: 'sonnet-4-6' }, { task: 'Quick edits & grep', model: 'haiku-4-5', fallback: 'sonnet-4-6' }, { task: 'Subagent default', model: 'sonnet-4-6', fallback: 'haiku-4-5' }] } },
  { name: 'quick fix', description: 'short horizon, fast models, minimal ceremony', harness: { turnPolicy: { maxTurns: 15, checkpointInterval: 10 }, modelRouting: [{ task: 'Plan & architect', model: 'sonnet-4-6', fallback: 'haiku-4-5' }, { task: 'Implement & edit', model: 'sonnet-4-6', fallback: 'haiku-4-5' }, { task: 'Quick edits & grep', model: 'haiku-4-5', fallback: 'haiku-4-5' }, { task: 'Subagent default', model: 'haiku-4-5', fallback: 'haiku-4-5' }] } },
  { name: 'research', description: 'wide context, high compaction threshold, read-heavy', harness: { turnPolicy: { maxTurns: 60 }, context: { compactionThreshold: 0.9, keepTurns: 20 } } },
]
const readProfiles = () => readJson(PROFILES_FILE, DEFAULT_PROFILES)
app.get('/api/gov/profiles', (req, res) => res.json(readProfiles()))
app.put('/api/gov/profiles', (req, res) => {
  track(PROFILES_FILE, JSON.stringify(req.body.profiles, null, 2), { summary: 'update harness profiles' })
  res.json({ ok: true })
})
app.post('/api/gov/profiles/apply', (req, res) => {
  const { name, scope } = req.body
  const p = readProfiles().find(x => x.name === name)
  if (!p) return res.status(404).json({ error: 'no such profile' })
  const file = settingsFileFor(scope)
  const settings = readJson(file, {})
  const next = JSON.stringify({ ...settings, harness: deepMerge(settings.harness || {}, p.harness) }, null, 2)
  if (scope === 'global') return res.json({ ok: true, proposed: propose(file, next, `apply profile "${name}" to global`) })
  track(file, next, { scope, summary: `apply profile "${name}"` })
  res.json({ ok: true })
})

// ---------- import / export / library + drift ----------
const LIBRARY_DIR = path.join(CLAUDE, 'harness-library')
function exportBundle(project, name, description) {
  const grab = p => readIf(p)
  const bundle = {
    name, description, provenance: { author: AUTHOR, machine: os.hostname(), project, createdAt: Date.now() },
    settings: readJson(path.join(project, '.claude', 'settings.json'), null),
    rules: Object.fromEntries([['CLAUDE.md', grab(path.join(project, 'CLAUDE.md'))], ['.claude/CLAUDE.md', grab(path.join(project, '.claude', 'CLAUDE.md'))], ['AGENTS.md', grab(path.join(project, 'AGENTS.md'))]].filter(([, v]) => v != null)),
    skills: Object.fromEntries(hubListSkills(path.join(project, '.claude', 'skills'), 'project').map(s => [s.name, readIf(s.path)])),
    agents: Object.fromEntries(hubListAgents(path.join(project, '.claude', 'agents'), 'project').map(a => [a.name, readIf(a.path)])),
    mcp: readJson(path.join(project, '.mcp.json'), null),
    profiles: readProfiles(),
  }
  return bundle
}
app.post('/api/gov/bundle/export', (req, res) => {
  const { project, name, description } = req.body
  if (!project || !fs.existsSync(project)) return res.status(400).json({ error: 'unknown project' })
  const bundle = exportBundle(project, name || path.basename(project), description || '')
  fs.mkdirSync(LIBRARY_DIR, { recursive: true })
  const file = path.join(LIBRARY_DIR, (name || path.basename(project)).replace(/[^\w.-]/g, '_') + '.json')
  track(file, JSON.stringify(bundle, null, 2), { summary: `export bundle from ${path.basename(project)}` })
  res.json({ ok: true, file, bundle })
})
app.get('/api/gov/library', (req, res) => {
  const out = []
  try {
    for (const f of fs.readdirSync(LIBRARY_DIR).filter(f => f.endsWith('.json'))) {
      const b = readJson(path.join(LIBRARY_DIR, f), null)
      if (b) out.push({ file: f, name: b.name, description: b.description, provenance: b.provenance, counts: { rules: Object.keys(b.rules || {}).length, skills: Object.keys(b.skills || {}).length, agents: Object.keys(b.agents || {}).length } })
    }
  } catch {}
  res.json(out)
})
app.post('/api/gov/bundle/import', (req, res) => {
  const { file, project } = req.body
  const b = readJson(path.join(LIBRARY_DIR, path.basename(file || '')), null)
  if (!b || !project || !fs.existsSync(project)) return res.status(400).json({ error: 'bad bundle or project' })
  const written = []
  const w = (rel, content) => { const p = path.join(project, rel); track(p, content, { scope: project, summary: `import from bundle "${b.name}"` }); written.push(rel) }
  if (b.settings) w('.claude/settings.json', JSON.stringify(b.settings, null, 2))
  for (const [rel, src] of Object.entries(b.rules || {})) w(rel, src)
  for (const [n, src] of Object.entries(b.skills || {})) w(path.join('.claude', 'skills', n, 'SKILL.md'), src)
  for (const [n, src] of Object.entries(b.agents || {})) w(path.join('.claude', 'agents', n + '.md'), src)
  if (b.mcp) w('.mcp.json', JSON.stringify(b.mcp, null, 2))
  res.json({ ok: true, written })
})
app.post('/api/gov/baseline', (req, res) => {
  const meta = readMeta()
  ;(meta.baselines ||= {})[req.body.project] = req.body.file
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2))
  res.json({ ok: true })
})
function driftFor(project) {
  const meta = readMeta()
  const bFile = meta.baselines?.[project]
  if (!bFile) return { baseline: null, drifts: [] }
  const b = readJson(path.join(LIBRARY_DIR, path.basename(bFile)), null)
  if (!b) return { baseline: bFile, error: 'baseline bundle missing', drifts: [] }
  return { baseline: bFile, provenance: b.provenance, drifts: driftVs(b, project) }
}
app.get('/api/gov/drift', (req, res) => res.json(driftFor(req.query.project)))
function syncDriftField(project, field) {
  const meta = readMeta()
  const b = readJson(path.join(LIBRARY_DIR, path.basename(meta.baselines?.[project] || '')), null)
  if (!b) throw Object.assign(new Error('no baseline'), { status: 400 })
  if (field === 'settings.harness' || field === 'settings.permissions') {
    const file = path.join(project, '.claude', 'settings.json')
    const s = readJson(file, {})
    const key = field.split('.')[1]
    if (b.settings?.[key] === undefined) delete s[key]; else s[key] = b.settings[key]
    track(file, JSON.stringify(s, null, 2), { scope: project, summary: `sync ${field} from baseline` })
  } else if (field.startsWith('rules/')) {
    const rel = field.slice(6)
    if (b.rules?.[rel] != null) track(path.join(project, rel), b.rules[rel], { scope: project, summary: `sync ${rel} from baseline` })
  } else throw Object.assign(new Error('field not syncable'), { status: 400 })
}
app.post('/api/gov/drift/sync', (req, res) => {
  syncDriftField(req.body.project, req.body.field)
  res.json({ ok: true })
})

// ---------- recommendations ----------
app.get('/api/gov/recs', (req, res) => {
  const project = req.query.project
  const meta = readMeta()
  const dismissed = meta.recsDismissed || {}
  const recs = []
  if (project && fs.existsSync(project)) {
    const hub = hubResolve(project)
    for (const f of hub.findings) recs.push({ key: 'finding:' + f.text.slice(0, 60), severity: f.severity, text: f.text, fix: f.artifact?.path || null })
    const stale = hub.inventory.skills.filter(s => s.fullTokens > 3000 && Date.now() - s.mtime > 60 * 86400_000).slice(0, 5)
    if (stale.length) recs.push({ key: 'stale-skills:' + project, severity: 'info', text: `${stale.length} large skills untouched for 60+ days (${stale.map(s => s.name).slice(0, 3).join(', ')}) — consider pruning or making on-demand`, fix: stale[0].path })
    if (hub.budget.alwaysOn > hub.budget.softCap) recs.push({ key: 'budget:' + project, severity: 'error', text: `always-loaded budget ${Math.round(hub.budget.alwaysOn / 100) / 10}k exceeds the ${Math.round(hub.budget.softCap / 1000)}k cap — trim rules or skill metadata`, fix: null })
  }
  const { alerts } = costAlerts()
  for (const a of alerts) recs.push({ key: 'cost:' + a.text.slice(0, 40), severity: a.level, text: a.text + ' — consider downgrading model routing for routine tasks', fix: null })
  if (project && fs.existsSync(project)) {
    try {
      const dd = designDrift(project)
      if (dd.manifest && dd.drifts.length) recs.push({ key: 'design-drift:' + project, severity: 'warning', text: `${dd.drifts.length} design-system drift(s) vs the Figma manifest (${dd.drifts.slice(0, 3).map(d => d.component).join(', ')}…) — see Quality → Design drift`, fix: dd.manifest })
    } catch {}
    try {
      for (const rc of reviewData(project).recurring.slice(0, 3))
        recs.push({ key: 'recurring-finding:' + rc.category, severity: 'warning', text: `"${rc.category}" flagged in ${rc.passes} separate reviews (${rc.count} findings) — add a PreToolUse hook to block the pattern automatically (Hooks → Library)`, fix: null })
    } catch {}
  }
  res.json(recs.map(r => ({ ...r, dismissed: dismissed[r.key] || null })))
})
app.post('/api/gov/recs/dismiss', (req, res) => {
  const meta = readMeta()
  ;(meta.recsDismissed ||= {})[req.body.key] = { reason: req.body.reason || '', ts: Date.now(), by: AUTHOR }
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2))
  res.json({ ok: true })
})

mountPromptLibrary(app, { chats, usageCache })

const scanCache = new Map()
function scanTranscripts() {
  const base = path.join(CLAUDE, 'projects')
  const files = []
  const walkS = d => { try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walkS(p); else if (e.name.endsWith('.jsonl')) files.push(p) } } catch {} }
  walkS(base)
  const all = { prompts: [], invocations: [], sessions: [], hooks: {}, hookBlocks: 0, reviews: [], hookEvents: [], edits: [], cmds: [], texts: [] }
  const HOOK_RE = /(PreToolUse|PostToolUse|UserPromptSubmit|SessionStart|SessionEnd|Stop|SubagentStop|PreCompact|Notification)(?::[\w./ -]+)? hook/
  const PATH_KEYS = ['file_path', 'path', 'notebook_path', 'filePath']
  for (const f of files) {
    let st; try { st = fs.statSync(f) } catch { continue }
    const proj = path.relative(base, f).split(path.sep)[0]
    const sessionId = path.basename(f, '.jsonl')
    let rec = scanCache.get(f)
    if (!rec || rec.v !== 3 || rec.mtime !== st.mtimeMs || rec.size !== st.size) {
      rec = {
        v: 3, mtime: st.mtimeMs, size: st.size, prompts: [], invocations: [], reviews: [], hooks: {}, hookBlocks: 0,
        userMsgs: 0, toolCalls: 0, first: 0, last: 0, cwd: '', branch: '',
        hookEvents: [], edits: [], cmds: [], texts: [], files: [],
      }
      const touched = new Set()
      // ponytail: "src" attribution = last Skill invoked since the user's prompt — a heuristic, not a real call graph
      let lastSkill = null
      try {
        for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
          if (!line) continue
          if (line.includes(' hook')) {
            const m = HOOK_RE.exec(line)
            if (m) rec.hooks[m[1]] = (rec.hooks[m[1]] || 0) + 1
            if (/hook (denied|blocked)/.test(line)) rec.hookBlocks++
          }
          let j; try { j = JSON.parse(line) } catch { continue }
          const t = j.timestamp ? Date.parse(j.timestamp) : 0
          if (t) { rec.first ||= t; rec.last = Math.max(rec.last, t) }
          if (j.cwd) rec.cwd = j.cwd
          if (j.gitBranch) rec.branch = j.gitBranch
          const at = j.attachment
          if (at && typeof at.type === 'string' && at.type.startsWith('hook_') && at.hookName) {
            const std = String(at.stdout || '') + String(at.content || '')
            const blocked = at.exitCode === 2 || at.type === 'hook_blocked' || /"permissionDecision"\s*:\s*"(deny|ask)"|"decision"\s*:\s*"block"/.test(std)
            const reason = blocked ? (/"(?:permissionDecisionReason|reason)"\s*:\s*"((?:[^"\\]|\\.){0,200})"/.exec(std)?.[1] || String(at.stderr || '').trim() || '').slice(0, 200) : ''
            const hookEv = {
              t, hook: at.hookName, event: at.hookEvent || at.hookName.split(':')[0],
              tool: at.hookName.includes(':') ? at.hookName.split(':').slice(1).join(':') : null,
              ms: typeof at.durationMs === 'number' ? at.durationMs : null,
              exit: typeof at.exitCode === 'number' ? at.exitCode : null,
              blocked, reason, cancelled: at.type === 'hook_cancelled',
            }
            if (rec.hookEvents.length < 800) rec.hookEvents.push(hookEv)
            if (blocked) rec.hookBlocks++
          }
          const tur = j.toolUseResult
          if (tur && typeof tur === 'object' && Array.isArray(tur.structuredPatch) && tur.filePath) {
            touched.add(tur.filePath)
            let add = 0, del = 0
            const hunk = []
            for (const h of tur.structuredPatch) for (const l of h.lines || []) {
              if (l[0] === '+') add++; else if (l[0] === '-') del++
              if (hunk.length < 24) hunk.push(l)
            }
            if (rec.edits.length < 400) rec.edits.push({ t, file: tur.filePath, add, del, hunk: hunk.join('\n').slice(0, 600) })
          }
          if (j.type === 'user' && !j.isMeta && j.message) {
            const c = j.message.content
            const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x => x.type === 'text').map(x => x.text).join(' ') : ''
            if (text.trim() && !text.startsWith('<') && !text.startsWith('[Request interrupted')) { rec.prompts.push({ t, text: text.slice(0, 500) }); rec.userMsgs++; lastSkill = null }
          } else if (j.type === 'assistant' && Array.isArray(j.message?.content)) {
            for (const c of j.message.content) {
              if (c.type === 'text' && c.text?.trim() && rec.texts.length < 400) { rec.texts.push({ t, text: c.text.replace(/\s+/g, ' ').trim().slice(0, 400) }); continue }
              if (c.type !== 'tool_use') continue
              rec.toolCalls++
              if (c.input && typeof c.input === 'object') {
                for (const k of PATH_KEYS) if (typeof c.input[k] === 'string' && c.input[k].startsWith('/')) touched.add(c.input[k])
                if (c.name === 'Bash' && typeof c.input.command === 'string' && rec.cmds.length < 400)
                  rec.cmds.push({ t, cmd: c.input.command.replace(/\s+/g, ' ').trim().slice(0, 240) })
              }
              if (c.name === 'Skill' && c.input?.skill) { rec.invocations.push({ t, kind: 'skill', name: String(c.input.skill), src: lastSkill }); lastSkill = 'skill:' + c.input.skill }
              else if ((c.name === 'Task' || c.name === 'Agent') && c.input?.subagent_type) rec.invocations.push({ t, kind: 'agent', name: String(c.input.subagent_type), src: lastSkill })
              else if (c.name.startsWith('mcp__')) rec.invocations.push({ t, kind: 'mcp', name: c.name.slice(5).split('__')[0], src: lastSkill })
              else if (c.name === 'ReportFindings' && Array.isArray(c.input?.findings)) rec.reviews.push({
                t, level: c.input.level || null,
                findings: c.input.findings.slice(0, 32).map(x => ({ file: x.file, line: x.line, summary: String(x.summary || '').slice(0, 240), category: x.category || 'uncategorized', verdict: x.verdict || null, outcome: x.outcome || null })),
              })
            }
          }
        }
      } catch {}
      rec.files = [...touched].slice(0, 500)
      scanCache.set(f, rec)
    }
    for (const p of rec.prompts) all.prompts.push({ ...p, proj, sessionId })
    for (const i of rec.invocations) all.invocations.push({ ...i, proj, sessionId })
    for (const r of rec.reviews) all.reviews.push({ ...r, proj, sessionId, isAgent: f.includes('subagents') })
    for (const [ev, n] of Object.entries(rec.hooks)) all.hooks[ev] = (all.hooks[ev] || 0) + n
    all.hookBlocks += rec.hookBlocks
    for (const h of rec.hookEvents) all.hookEvents.push({ ...h, proj, sessionId })
    for (const e of rec.edits) all.edits.push({ ...e, proj, sessionId })
    for (const c of rec.cmds) all.cmds.push({ ...c, proj, sessionId })
    for (const x of rec.texts) all.texts.push({ ...x, proj, sessionId })
    all.sessions.push({ proj, sessionId, userMsgs: rec.userMsgs, toolCalls: rec.toolCalls, first: rec.first, last: rec.last, isAgent: f.includes('subagents'), cwd: rec.cwd, branch: rec.branch, files: rec.files })
  }
  all.prompts.sort((a, b) => a.t - b.t)
  return all
}

// ---------- 13: skills & agents flow graph ----------
app.get('/api/flow', (req, res) => {
  const project = req.query.project && req.query.project !== 'global' && fs.existsSync(req.query.project) ? req.query.project : null
  const nodes = [], seen = new Set()
  const nid = (kind, name) => kind + ':' + name
  const addNode = (kind, name, extra = {}) => { const id = nid(kind, name); if (!seen.has(id)) { seen.add(id); nodes.push({ id, kind, name, ...extra }) }; return id }
  addNode('entry', 'prompt')
  const bodies = {}
  for (const kind of ['skills', 'commands', 'agents']) {
    const dirs = [{ scope: 'global', dir: path.join(CLAUDE, kind) }]
    if (project) dirs.push({ scope: 'project', dir: path.join(project, '.claude', kind) })
    for (const { scope, dir } of dirs) {
      if (!fs.existsSync(dir)) continue
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const name = kind === 'skills' ? entry.name : entry.name.replace(/\.md$/, '')
        const file = kind === 'skills' ? path.join(dir, name, 'SKILL.md') : path.join(dir, name + '.md')
        if (!fs.existsSync(file)) continue
        const content = fs.readFileSync(file, 'utf8')
        const { fm } = parseFM(content)
        const nodeKind = kind === 'agents' ? 'agent' : kind === 'skills' ? 'skill' : 'command'
        const id = addNode(nodeKind, name, { scope, model: fm.model || null, description: String(fm.description || '').slice(0, 160) })
        bodies[id] = content
      }
    }
  }
  try { for (const name of Object.keys(readClaudeJson().mcpServers || {})) addNode('mcp', name, { scope: 'global' }) } catch {}
  if (project) for (const name of Object.keys(readJson(path.join(project, '.mcp.json'), {}).mcpServers || {})) addNode('mcp', name, { scope: 'project' })
  const defined = new Map()
  const named = nodes.filter(n => n.kind !== 'entry')
  for (const [srcId, body] of Object.entries(bodies)) {
    for (const n of named) {
      if (n.id === srcId || n.name.length < 4) continue
      const hit = n.kind === 'mcp' ? body.includes('mcp__' + n.name) :
        new RegExp('(^|[\\s"`\'(/])' + n.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([\\s"`\'):.,]|$)', 'm').test(body)
      if (hit) defined.set(srcId + '→' + n.id, { from: srcId, to: n.id })
    }
  }
  for (const n of nodes) if (n.kind === 'skill' || n.kind === 'command') defined.set('entry:prompt→' + n.id, { from: 'entry:prompt', to: n.id, trigger: true })
  const { invocations } = scanTranscripts()
  const projFilter = project ? mangle(project) : null
  const observed = new Map(), nodeUse = {}
  for (const inv of invocations) {
    if (projFilter && inv.proj !== projFilter) continue
    const to = nid(inv.kind, inv.name)
    if (!seen.has(to)) addNode(inv.kind, inv.name, { ghost: true })
    const from = inv.src && seen.has(inv.src) ? inv.src : 'entry:prompt'
    const k = from + '→' + to
    const e = observed.get(k) || { from, to, count: 0, last: 0 }
    e.count++; e.last = Math.max(e.last, inv.t); observed.set(k, e)
    const u = nodeUse[to] ||= { count: 0, last: 0 }; u.count++; u.last = Math.max(u.last, inv.t)
  }
  for (const n of nodes) Object.assign(n, nodeUse[n.id] || { count: 0, last: null })
  const deadEnds = nodes.filter(n => n.kind !== 'entry' && !n.ghost && !n.count).map(n => n.id)
  const adj = {}; for (const e of defined.values()) (adj[e.from] ||= []).push(e.to)
  const cycles = [], state = {}
  const dfs = (v, stack) => {
    state[v] = 1
    for (const w of adj[v] || []) {
      if (state[w] === 1) cycles.push([...stack.slice(stack.indexOf(w)), w].join(' → '))
      else if (!state[w]) dfs(w, [...stack, w])
    }
    state[v] = 2
  }
  for (const n of nodes) if (!state[n.id]) dfs(n.id, [n.id])
  const out = {}; for (const e of observed.values()) (out[e.from] ||= []).push(e)
  const trail = ['entry:prompt']
  for (let i = 0; i < 6; i++) {
    const next = (out[trail[trail.length - 1]] || []).filter(e => !trail.includes(e.to)).sort((a, b) => b.count - a.count)[0]
    if (!next) break
    trail.push(next.to)
  }
  res.json({ nodes, defined: [...defined.values()], observed: [...observed.values()], deadEnds, cycles: [...new Set(cycles)].slice(0, 10), trail: trail.length > 1 ? trail : [] })
})

// ---------- 14: duplicated prompts across chats ----------
const normPrompt = s => s.toLowerCase().replace(/\s+/g, ' ').trim()
const tokset = s => new Set(normPrompt(s).split(' ').filter(w => w.length > 2))
const jaccard = (a, b) => { let i = 0; for (const w of a) if (b.has(w)) i++; return i / (a.size + b.size - i || 1) }
app.get('/api/dupes', (req, res) => {
  const days = Number(req.query.days) || 90
  const sim = Math.min(1, Math.max(0.3, Number(req.query.sim) || 0.75))
  const projFilter = req.query.project ? mangle(req.query.project) : null
  const cutoff = Date.now() - days * 86400_000
  const { prompts } = scanTranscripts()
  const list = prompts.filter(p => p.t >= cutoff && (!projFilter || p.proj === projFilter) && p.text.length >= 25 && !p.text.startsWith('/')).slice(-4000)
  const clusters = []
  for (const p of list) {
    const toks = tokset(p.text)
    let best = null, bestScore = 0
    for (const c of clusters) { const s = jaccard(toks, c.toks); if (s > bestScore) { bestScore = s; best = c } }
    if (best && bestScore >= sim) best.items.push(p)
    else clusters.push({ canonical: p.text, toks, items: [p] })
  }
  const out = clusters.filter(c => c.items.length >= 2).sort((a, b) => b.items.length - a.items.length).slice(0, 60).map(c => ({
    canonical: c.canonical, count: c.items.length,
    projects: [...new Set(c.items.map(i => i.proj))],
    sessions: new Set(c.items.map(i => i.sessionId)).size,
    first: c.items[0].t, last: c.items[c.items.length - 1].t,
    exact: new Set(c.items.map(i => normPrompt(i.text))).size === 1,
    items: c.items.slice(-10).map(({ t, proj, sessionId, text }) => ({ t, proj, sessionId, text: text.slice(0, 240) })),
  }))
  res.json({ scanned: list.length, clusters: out })
})

// ---------- 15: chat stats ----------
app.get('/api/chatstats', (req, res) => {
  const days = Number(req.query.days) || 30
  const projFilter = req.query.project ? mangle(req.query.project) : null
  const cutoff = Date.now() - days * 86400_000
  const { prompts, sessions } = scanTranscripts()
  const { entries } = collectUsage()
  const sess = sessions.filter(s => !s.isAgent && s.userMsgs > 0 && s.last >= cutoff && (!projFilter || s.proj === projFilter))
  const pr = prompts.filter(p => p.t >= cutoff && (!projFilter || p.proj === projFilter))
  const en = entries.filter(e => e.t >= cutoff && (!projFilter || e.proj === projFilter))
  const heat = Array.from({ length: 7 }, () => new Array(24).fill(0))
  for (const p of pr) { const d = new Date(p.t); heat[d.getDay()][d.getHours()]++ }
  let reprompts = 0
  const prevBySess = {}
  for (const p of pr) {
    const prev = prevBySess[p.sessionId]
    if (prev && p.t - prev.t < 180_000 && jaccard(tokset(p.text), tokset(prev.text)) >= 0.5) reprompts++
    prevBySess[p.sessionId] = p
  }
  const oneShot = sess.filter(s => s.userMsgs === 1 && s.toolCalls > 0).length
  // ponytail: "abandoned" = one prompt, zero tool calls — crude but observable
  const abandoned = sess.filter(s => s.userMsgs === 1 && s.toolCalls === 0).length
  const cost = en.reduce((s, e) => s + entryCost(e), 0)
  const byProj = {}, byModel = {}
  for (const e of en) { byProj[e.proj] = (byProj[e.proj] || 0) + entryCost(e); byModel[e.model] = (byModel[e.model] || 0) + entryCost(e) }
  const durs = sess.map(s => s.last - s.first).filter(d => d > 0)
  const dupes = new Map()
  for (const p of pr) { if (p.text.length >= 25 && !p.text.startsWith('/')) { const k = normPrompt(p.text); dupes.set(k, (dupes.get(k) || 0) + 1) } }
  const reused = [...dupes.entries()].filter(([, n]) => n >= 2)
  const byHour = new Array(24).fill(0); for (const p of pr) byHour[new Date(p.t).getHours()]++
  res.json({
    chats: sess.length, msgs: pr.length,
    avgMsgs: sess.length ? pr.length / sess.length : 0,
    activeDays: new Set(pr.map(p => new Date(p.t).toISOString().slice(0, 10))).size,
    heat, byHour,
    avgSessionMs: durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : 0,
    toolsPerChat: sess.length ? sess.reduce((x, s) => x + s.toolCalls, 0) / sess.length : 0,
    oneShotRate: sess.length ? oneShot / sess.length : 0,
    abandonRate: sess.length ? abandoned / sess.length : 0,
    repromptRate: pr.length ? reprompts / pr.length : 0,
    reuseRate: dupes.size ? reused.reduce((s, [, n]) => s + n, 0) / Math.max(1, [...dupes.values()].reduce((a, b) => a + b, 0)) : 0,
    dupClusters: reused.length,
    tokIn: en.reduce((s, e) => s + e.in + e.cc + e.cr, 0), tokOut: en.reduce((s, e) => s + e.out, 0),
    cost, costPerChat: sess.length ? cost / sess.length : 0,
    byProj: Object.entries(byProj).sort((a, b) => b[1] - a[1]).slice(0, 6),
    byModel: Object.entries(byModel).sort((a, b) => b[1] - a[1]).slice(0, 6),
    longest: [...sess].sort((a, b) => b.userMsgs - a.userMsgs).slice(0, 6).map(s => ({ proj: s.proj, sessionId: s.sessionId, userMsgs: s.userMsgs, toolCalls: s.toolCalls, last: s.last })),
    topPrompts: reused.sort((a, b) => b[1] - a[1]).slice(0, 6).map(([text, n]) => ({ text: text.slice(0, 140), count: n })),
  })
})

// ---------- 16: search my past self (palette) ----------
app.get('/api/search', (req, res) => {
  const q = String(req.query.q || '').toLowerCase()
  const file = String(req.query.file || '').toLowerCase()
  const kinds = new Set(String(req.query.kind || 'all').split(',').map(s => s.trim()))
  const wants = k => kinds.has('all') || kinds.has(k)
  const limit = Math.min(100, Number(req.query.limit) || 25)
  if (q.length < 3 && !file) return res.json([])
  const { prompts, texts, cmds, edits, sessions } = scanTranscripts()
  const meta = {}
  for (const s of sessions) meta[s.sessionId] = s
  const okSession = sid => !file || (meta[sid]?.files || []).some(p => p.toLowerCase().includes(file))
  const hits = []
  const snip = (text, at) => text.slice(Math.max(0, at - 60), at + 160)
  const scan = (list, kind, field, extra = () => ({})) => {
    if (!wants(kind)) return
    for (let i = list.length - 1; i >= 0; i--) {
      const r = list[i]
      const hay = String(r[field] || '')
      const idx = q ? hay.toLowerCase().indexOf(q) : 0
      if (q && idx < 0) continue
      if (!okSession(r.sessionId)) continue
      if (file && kind === 'edit' && !String(r.file || '').toLowerCase().includes(file)) continue
      const s = meta[r.sessionId]
      hits.push({
        kind, proj: r.proj, sessionId: r.sessionId, t: r.t, snippet: snip(hay, idx),
        cwd: s?.cwd || null, branch: s?.branch || null,
        files: (s?.files || []).filter(p => !file || p.toLowerCase().includes(file)).slice(0, 5),
        resume: s?.cwd ? `cd ${s.cwd} && claude --resume ${r.sessionId}` : `claude --resume ${r.sessionId}`,
        ...extra(r),
      })
    }
  }
  scan(prompts, 'prompt', 'text')
  scan(texts, 'assistant', 'text')
  scan(cmds, 'bash', 'cmd')
  scan(edits, 'edit', 'hunk', e => ({ file: e.file, add: e.add, del: e.del }))
  if (!q && file)
    for (const s of sessions) {
      const f = (s.files || []).filter(p => p.toLowerCase().includes(file))
      if (!f.length) continue
      hits.push({ kind: 'session', proj: s.proj, sessionId: s.sessionId, t: s.last, snippet: `${f.length} file(s) touched · ${s.userMsgs} prompts`, cwd: s.cwd || null, branch: s.branch || null, files: f.slice(0, 5), resume: s.cwd ? `cd ${s.cwd} && claude --resume ${s.sessionId}` : `claude --resume ${s.sessionId}` })
    }
  res.json(hits.sort((a, b) => b.t - a.t).slice(0, limit))
})

// ---------- plane-A bridge: the eng snapshot (server-eng.mjs OWNS it — we only read it) ----------
let engMod = null
const engSnap = { at: 0, errAt: 0, data: null, p: null }
const ENG_TTL = 10 * 60_000
const ENG_ERR_TTL = 15_000
const ENG_COLD_WAIT = 90_000
async function loadEngSnapshot() {
  engMod ||= await import('./eng.mjs')
  if (typeof engMod.snapshotAll === 'function') return await engMod.snapshotAll()
  const r = await fetch(`http://127.0.0.1:${PORT}/api/eng/snapshot?project=all`)
  return await r.json()
}
async function engSnapshot(wait = true) {
  const now = Date.now()
  const stale = !engSnap.data || now - engSnap.at > ENG_TTL
  const backoff = !engSnap.data && now - engSnap.errAt < ENG_ERR_TTL
  if (!engSnap.p && stale && !backoff)
    engSnap.p = loadEngSnapshot()
      .then(d => { if (d?.available) { engSnap.data = d; engSnap.at = Date.now() } else engSnap.errAt = Date.now(); engSnap.p = null; return engSnap.data })
      .catch(() => { engSnap.errAt = Date.now(); engSnap.p = null; return engSnap.data })
  if (engSnap.data) return engSnap.data
  if (!engSnap.p) return null
  if (wait) { try { return await engSnap.p } catch { return null } }
  let t
  try { return await Promise.race([engSnap.p.catch(() => null), new Promise(r => { t = setTimeout(() => r(null), ENG_COLD_WAIT) })]) }
  finally { clearTimeout(t) }
}

// ---------- 1: delivery risk in the inbox (plane A → work items) ----------
const SLA_REVIEW = 3, SLA_REVIEW_HARD = 6
const jiraUrl = i => `https://${i.host}/browse/${i.key}`
const prUrl = p => `https://github.com/${p.repo}/pull/${p.num}`
const d1 = n => (Math.round(n * 10) / 10).toFixed(1)
function workItems(snap) {
  const items = []
  if (!snap?.available) return items
  const W = (key, kind, severity, text, ts, extra) => items.push({ key, kind, severity, text, ts: ts || Date.now(), section: 'delivery', plane: 'work', ...extra })
  for (const p of snap.prs || []) {
    if (p.state === 'Merged' || p.state === 'Closed') continue
    const created = Date.parse(p.createdAt) || Date.now()
    const reviews = (p.reviewEvents || []).length
    if (!reviews && p.openDays >= SLA_REVIEW)
      W(`pr:noreview:${p.repo}#${p.num}`, 'review', p.openDays >= SLA_REVIEW_HARD ? 'error' : 'warning',
        `PR #${p.num} (${p.ticket}) has had zero reviews for ${d1(p.openDays)} working days — ${p.author} is blocked`, created,
        { link: prUrl(p), owner: p.author, ageWorkDays: p.openDays,
          nudge: `${p.repo} PR #${p.num} "${p.title}" (${p.ticket}) has been waiting ${d1(p.openDays)} working days with no review — ${p.author} is blocked on it. Can someone pick it up today? ${prUrl(p)}` })
    const changesReq = Math.max(0, (p.cycles || 1) - 1)
    if (changesReq >= 2)
      W(`pr:cr:${p.repo}#${p.num}`, 'review', 'warning',
        `PR #${p.num} (${p.ticket}) is on review round ${changesReq + 1} — ${changesReq} changes-requested`, created,
        { link: prUrl(p), owner: p.author, cycles: p.cycles,
          nudge: `${p.repo} PR #${p.num} (${p.ticket}) has had ${changesReq} rounds of changes requested. Worth 10 minutes on a call instead of another round? ${prUrl(p)}` })
  }
  for (const i of snap.issues || []) {
    if (i.live) continue
    const ts = Date.parse(i.curSince) || Date.now()
    const who = i.assignee?.name || 'unassigned'
    if (i.rec?.atRisk)
      W(`tkt:budget:${i.key}`, 'ticket', i.rec.remaining <= -2 ? 'error' : 'warning',
        `${i.key} is ${d1(-i.rec.remaining)} working days past its ${i.status} budget (${i.rec.budget}d) — next: ${i.rec.next}`, ts,
        { link: jiraUrl(i), owner: who, ageWorkDays: i.inCurrent, overBudgetBy: +(-i.rec.remaining).toFixed(2),
          nudge: `${i.key} "${i.summary}" has sat in ${i.status} for ${d1(i.inCurrent)} working days — ${d1(-i.rec.remaining)}d past the ${i.rec.budget}d budget. ${who}, what is blocking the move to ${i.rec.next}? ${jiraUrl(i)}` })
    if (i.qaCycles >= 3)
      W(`tkt:qa:${i.key}`, 'quality', 'warning', `${i.key} has been through QA ${i.qaCycles} times`, ts,
        { link: jiraUrl(i), owner: who, qaCycles: i.qaCycles,
          nudge: `${i.key} "${i.summary}" has bounced through QA ${i.qaCycles} times. Worth a dev+QA pairing pass before the next handoff? ${jiraUrl(i)}` })
    if (i.rework)
      W(`tkt:rework:${i.key}`, 'quality', 'warning', `${i.key} re-entered development after review/QA (rework)`, ts,
        { link: jiraUrl(i), owner: who,
          nudge: `${i.key} "${i.summary}" went backwards into development after review/QA. Worth capturing why in the retro? ${jiraUrl(i)}` })
    if (i.stale)
      W(`tkt:stale:${i.key}`, 'ticket', 'warning', `${i.key} is still "${i.status}" — ${i.staleNote}`, ts,
        { link: jiraUrl(i), owner: who,
          nudge: `${i.key} "${i.summary}" still shows ${i.status} but its PR is merged. ${who}, can you move it? ${jiraUrl(i)}` })
  }
  return items
}

// ---------- 17: attention inbox ----------
async function inboxItems() {
  const items = []
  for (const a of readApprovals()) if (a.status === 'proposed') items.push({ key: 'appr:' + a.id, kind: 'approval', severity: 'warning', text: `pending approval: ${a.summary}`, ts: a.ts, section: 'governance' })
  const { alerts } = costAlerts()
  for (const a of alerts) items.push({ key: 'cost:' + a.text.slice(0, 40), kind: 'budget', severity: a.level, text: a.text, ts: Date.now(), section: 'reliability' })
  for (const r of evalRuns().slice(-10)) if (r.passRate < 1) items.push({ key: 'eval:' + r.id, kind: 'eval', severity: r.passRate === 0 ? 'error' : 'warning', text: `eval run at ${Math.round(r.passRate * 100)}% pass (${r.scope === 'global' ? 'global' : path.basename(r.scope)})`, ts: r.ts, section: 'reliability' })
  for (const [id, c] of chats) {
    if (c.action) {
      if (!c.alive) items.push({ key: 'action:' + id, kind: 'action', severity: c.action.exitCode === 0 ? 'info' : 'error', text: `${c.action.cmd} in ${path.basename(c.cwd)} ${c.action.exitCode === 0 ? 'finished' : `failed (exit ${c.action.exitCode})`}${c.analysis?.cost ? ` · $${c.analysis.cost.toFixed(3)}` : ''}`, ts: c.action.endedAt, section: 'workflows' })
      continue
    }
    if (!c.alive) continue
    const lastEv = c.events[c.events.length - 1]
    if (lastEv && lastEv.type === 'result') items.push({ key: 'chat:' + id, kind: 'session', severity: 'info', text: `session in ${path.basename(c.cwd)} is waiting for your input`, ts: Date.now(), section: 'chat' })
  }
  try {
    for (const t of readBoard().tickets) {
      if (t.blocked) items.push({ key: 'board:blk:' + t.id + ':' + t.blocked.at, kind: 'board', severity: 'error', text: `ticket "${t.title}" blocked by ${t.blocked.by}: ${t.blocked.needed || t.blocked.reason}`.slice(0, 140), ts: t.blocked.at, section: 'board' })
      else if (['code-review', 'ready-for-qa', 'ready-for-release'].includes(t.stage) && !boardRuns.get(t.id)) items.push({ key: 'board:idle:' + t.id + ':' + t.stage, kind: 'board', severity: 'info', text: `ticket "${t.title}" is waiting for your ${t.stage === 'code-review' ? 'review run' : t.stage === 'ready-for-qa' ? 'QA run' : 'release'}`, ts: (t.history || []).slice(-1)[0]?.at || t.createdAt, section: 'board' })
    }
  } catch {}
  try {
    const dismissed = readMeta().recsDismissed || {}
    for (const dir of Object.keys(readClaudeJson().projects || {}).filter(d => d !== HOME && fs.existsSync(d)).slice(0, 8)) {
      const hub = hubResolve(dir)
      for (const f of (hub.findings || []).filter(f => f.severity === 'error').slice(0, 2)) {
        const legacyKey = 'finding:' + f.text.slice(0, 60)
        const key = `finding:${dir}:${f.text.slice(0, 60)}`
        if (!dismissed[key] && !dismissed[legacyKey]) items.push({ key, legacyKey, kind: 'recommendation', severity: 'error', text: `${path.basename(dir)}: ${f.text}`, ts: Date.now(), section: 'library' })
      }
    }
  } catch {}
  try {
    for (const r of scanRuns()) {
      if (r.status === 'failed') items.push({ key: 'run:fail:' + r.proj + ':' + r.ticket, kind: 'run', severity: 'error', text: `loush ${r.flow || 'run'} for ${r.ticket} failed (${r.projName})`, ts: r.updatedAt || Date.now(), section: 'workflows' })
      else if (r.awaitingApproval) items.push({ key: 'run:appr:' + r.proj + ':' + r.ticket, kind: 'run', severity: 'warning', text: `loush ${r.flow || 'run'} for ${r.ticket} awaits approval (${r.projName})`, ts: r.updatedAt || Date.now(), section: 'workflows' })
      else if (r.status === 'blocked') items.push({ key: 'run:blk:' + r.proj + ':' + r.ticket, kind: 'run', severity: 'warning', text: `loush ${r.flow || 'run'} for ${r.ticket} is blocked (${r.projName})`, ts: r.updatedAt || Date.now(), section: 'workflows' })
    }
  } catch {}
  try { items.push(...schedulerInbox(CLAUDE)) } catch {}
  try {
    const MARK = { 'block-prod-file-edit': 'protected path', 'secret-scan-pre-write': 'looks like a secret' }
    const userHooks = JSON.stringify(readJson(SETTINGS_FILES.user, {}).hooks || {})
    const missing = Object.entries(MARK).filter(([, m]) => !userHooks.includes(m)).map(([n]) => n)
    if (missing.length && !(readMeta().inboxDone || {})['hooks:safety'])
      items.push({ key: 'hooks:safety', kind: 'recommendation', severity: 'info', section: 'hooks', ts: Date.now(), text: `${missing.length} recommended safety hook${missing.length === 1 ? '' : 's'} not installed (${missing.join(', ')}) — install from Hooks` })
  } catch {}
  for (const i of items) i.plane ||= 'harness'
  const snap = await engSnapshot(false).catch(() => null)
  items.push(...workItems(snap))
  try {
    for (const r of (await ciHealth(14, false, false)).repos) {
      if (!r.mainRed) continue
      items.push({
        key: `ci:red:${r.repo}`, kind: 'ci', severity: 'error', plane: 'work', section: 'delivery',
        text: `main is RED on ${r.repo} — ${r.lastRun?.workflowName || 'CI'} failed`, ts: r.lastRun?.at || Date.now(),
        link: r.lastRun?.url || `https://github.com/${r.repo}/actions`, owner: r.lastRun?.actor || null,
        nudge: `main is red on ${r.repo} (${r.lastRun?.workflowName || 'CI'}, ${r.lastRun?.headSha?.slice(0, 7) || '?'}). Everyone branching off main is blocked. ${r.lastRun?.url || ''}`,
      })
    }
  } catch {}
  const done = readMeta().inboxDone || {}
  const doneOf = v => {
    if (!v) return { done: false, snoozedUntil: null }
    if (typeof v !== 'object') return { done: true, snoozedUntil: null }
    if (v.until == null) return { done: true, snoozedUntil: null }
    return v.until > Date.now() ? { done: true, snoozedUntil: v.until } : { done: false, snoozedUntil: null }
  }
  const sev = { error: 0, warning: 1, info: 2 }
  return items
    .map(({ legacyKey, ...i }) => ({ ...i, ...doneOf(done[i.key] ?? (legacyKey ? done[legacyKey] : undefined)) }))
    .sort((a, b) => sev[a.severity] - sev[b.severity] || b.ts - a.ts)
}
app.get('/api/inbox', async (req, res) => {
  const items = await inboxItems()
  const plane = req.query.plane
  res.json(plane ? items.filter(i => i.plane === plane) : items)
})
app.post('/api/inbox/done', (req, res) => {
  const { key, done, snoozeHours } = req.body
  const meta = readMeta()
  meta.inboxDone ||= {}
  if (snoozeHours > 0) meta.inboxDone[key] = { at: Date.now(), until: Date.now() + snoozeHours * 3600_000 }
  else if (done) meta.inboxDone[key] = { at: Date.now(), until: null }
  else delete meta.inboxDone[key]
  for (const [k, v] of Object.entries(meta.inboxDone)) if (v && typeof v === 'object' && v.until && v.until < Date.now()) delete meta.inboxDone[k]
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2))
  res.json({ ok: true })
})

// ---------- 24: daily digest ----------
app.get('/api/digest', async (req, res) => {
  const since = Date.now() - (Number(req.query.days) || 1) * 86400_000
  const { entries, lineEvents } = collectUsage()
  const en = entries.filter(e => e.t >= since)
  const byProj = {}
  for (const e of en) { const p = byProj[e.proj] ||= { out: 0, cost: 0, msgs: 0 }; p.out += e.out; p.cost += entryCost(e); p.msgs++ }
  const lines = lineEvents.filter(l => l.t >= since)
  const commits = []
  try {
    for (const dir of Object.keys(readClaudeJson().projects || {}).filter(d => d !== HOME && fs.existsSync(d))) {
      const r = spawnSync('git', ['-C', dir, 'log', '--since=' + new Date(since).toISOString(), '--oneline'], { timeout: 3000 })
      const list = r.stdout ? r.stdout.toString().split('\n').filter(Boolean) : []
      if (list.length) commits.push({ project: path.basename(dir), count: list.length, latest: list[0].slice(0, 90) })
    }
  } catch {}
  const evals = evalRuns().filter(r => r.ts >= since)
  const drift = []
  for (const proj of Object.keys(readMeta().baselines || {})) {
    try { const d = driftFor(proj); if (d.drifts.length) drift.push({ project: path.basename(proj), fields: d.drifts.length }) } catch {}
  }
  res.json({
    since,
    tokens: en.reduce((s, e) => s + e.out, 0), cost: en.reduce((s, e) => s + entryCost(e), 0), msgs: en.length,
    lines: { add: lines.reduce((s, l) => s + l.add, 0), del: lines.reduce((s, l) => s + l.del, 0) },
    byProj: Object.entries(byProj).sort((a, b) => b[1].cost - a[1].cost).slice(0, 8),
    commits: commits.sort((a, b) => b.count - a.count),
    evals: { runs: evals.length, passRate: evals.length ? evals.reduce((s, r) => s + r.passRate, 0) / evals.length : null },
    drift,
    attention: (await inboxItems()).filter(i => !i.done).slice(0, 6),
  })
})

// ---------- 5: skill/agent/MCP ROI ledger — fires × always-on cost ----------
const CAP_KIND = { skills: 'skill', agents: 'agent', commands: 'command', mcp: 'mcp' }
function capabilityLedger() {
  const items = overviewItems()
  const { invocations, prompts, sessions } = scanTranscripts()
  const now = Date.now(), d30 = now - 30 * 86400_000, d90 = now - 90 * 86400_000
  const use = {}
  const bump = (kind, name, t) => {
    const u = (use[kind + ':' + name] ||= { c30: 0, c90: 0, all: 0, last: 0 })
    u.all++; if (t >= d30) u.c30++; if (t >= d90) u.c90++; u.last = Math.max(u.last, t)
  }
  for (const i of invocations) bump(i.kind, i.name, i.t)
  const cmds = new Set(items.filter(i => i.kind === 'commands').map(i => i.name))
  for (const p of prompts) {
    const m = /^\/([\w:.-]+)/.exec(p.text.trim())
    if (!m) continue
    const full = m[1], short = full.split(':').pop()
    if (cmds.has(full)) bump('command', full, p.t)
    else if (cmds.has(short)) bump('command', short, p.t)
  }
  const real = sessions.filter(s => !s.isAgent)
  const sessions30 = real.filter(s => s.last >= d30).length
  const sessions90 = real.filter(s => s.last >= d90).length
  const sessionTimes = real.map(s => s.last).filter(Boolean)
  const rows = items.filter(i => CAP_KIND[i.kind]).map(i => {
    const u = use[CAP_KIND[i.kind] + ':' + i.name] || { c30: 0, c90: 0, all: 0, last: 0 }
    const ageDays = i.mtime ? (now - i.mtime) / 86400_000 : null
    const sinceInstall = sessionsSince(sessionTimes, i.mtime ?? null, d90)
    return {
      kind: i.kind, name: i.name, scope: i.scope, group: i.group,
      alwaysOnTokens: i.descTokens || 0,
      fullTokens: i.fullTokens || 0,
      fires30: u.c30, fires90: u.c90, firesAll: u.all, last: u.last || null,
      installedAt: i.mtime ?? null,
      ageDays: ageDays == null ? null : Math.round(ageDays),
      sessionsSinceInstall: sinceInstall,
      tokPerFire: tokPerFire({ descTokens: i.descTokens || 0, fires: u.c90, sessionsSinceInstall: sinceInstall ?? sessions90 }),
      verdict: capabilityVerdict({ firesAll: u.all, fires30: u.c30, ageDays }),
    }
  })
  const rank = { DEAD: 0, COLD: 1, NEW: 2, HOT: 3 }
  rows.sort((a, b) => rank[a.verdict] - rank[b.verdict] || b.alwaysOnTokens - a.alwaysOnTokens || b.fires90 - a.fires90)
  const sum = (l, f) => l.reduce((s, x) => s + f(x), 0)
  const dead = rows.filter(r => r.verdict === 'DEAD'), cold = rows.filter(r => r.verdict === 'COLD')
  const fresh = rows.filter(r => r.verdict === 'NEW')
  const alwaysOn = sum(rows, r => r.alwaysOnTokens)
  return {
    items: rows, sessions30, sessions90,
    headline: {
      alwaysOnTokens: alwaysOn, deadCount: dead.length, deadTokens: sum(dead, r => r.alwaysOnTokens),
      coldCount: cold.length, coldTokens: sum(cold, r => r.alwaysOnTokens),
      newCount: fresh.length, newTokens: sum(fresh, r => r.alwaysOnTokens), newAfterDays: NEW_CAPABILITY_DAYS,
      hotCount: rows.length - dead.length - cold.length - fresh.length,
      text: `you pay ${alwaysOn.toLocaleString()} tok every session for ${rows.length} capabilities — ${dead.length} of them (${sum(dead, r => r.alwaysOnTokens).toLocaleString()} tok/session) have never fired`
        + (fresh.length ? ` · ${fresh.length} more are too new to judge (installed < ${NEW_CAPABILITY_DAYS}d ago)` : ''),
    },
  }
}
app.get('/api/capabilities', (req, res) => res.json(capabilityLedger()))
app.post('/api/capabilities/archive', (req, res) => {
  const { items = [], project, dryRun } = req.body
  const out = []
  for (const it of items) {
    const { kind, name, scope = 'user' } = it
    if (!KINDS[kind]) { out.push({ ...it, error: 'kind not archivable (only skills/commands/agents)' }); continue }
    try {
      if (project && scope === 'project') {
        const plan = batchPlan('disable-skill', project, { skill: name })
        if (!dryRun && plan.changed && plan.apply) plan.apply()
        out.push({ kind, name, scope, target: project, desc: plan.desc, changed: plan.changed, applied: !dryRun && plan.changed })
        continue
      }
      const root = safe(itemRoot(kind, scopeDir(kind, scope), name))
      const exists = fs.existsSync(root)
      const tok = exists ? tokens(readIf(itemFile(kind, scopeDir(kind, scope), name)) || '') : 0
      if (dryRun || !exists) { out.push({ kind, name, scope, path: root, exists, reclaimTokens: tok, changed: exists, applied: false }); continue }
      const bak = backup(root)
      fs.rmSync(root, { recursive: true, force: true })
      appendVersion({ id: 'v' + Date.now().toString(36), ts: Date.now(), author: AUTHOR, machine: os.hostname(), scope, file: root, summary: `archive ${kind}/${name} (ROI ledger)`, prev: null, content: null, backup: bak })
      out.push({ kind, name, scope, path: root, exists: true, reclaimTokens: tok, changed: true, applied: true, backup: bak })
    } catch (e) { out.push({ ...it, error: e.message }) }
  }
  respCache.clear()
  res.json({ dryRun: !!dryRun, reclaimTokens: out.reduce((s, o) => s + (o.reclaimTokens || 0), 0), results: out })
})

mountSessionForensics(app, { collectUsage: (...a) => collectUsage(...a), errSig: (...a) => errSig(...a), failStats: (...a) => failStats(...a), median: (...a) => median(...a), scanTranscripts: (...a) => scanTranscripts(...a) })

// ---------- 8: /api/roi — cohort-level AI ROI (THE ONLY CROSS-PLANE JOIN) ----------
app.get('/api/roi', async (req, res) => {
  const days = Number(req.query.days) || 90
  const cutoff = Date.now() - days * 86400_000
  const snap = await engSnapshot()
  if (!snap?.available) return res.json({ available: false, reason: 'no eng snapshot (JIRA creds / gh auth)', plane: 'cohort' })
  const { files } = collectUsage()
  const keyRes = [...new Set((snap.projects || []).map(p => p.jiraProjectKey).filter(Boolean))].map(k => new RegExp(`${k}-\\d+`, 'i'))
  const branchTicket = {}
  for (const p of snap.prs || []) if (p.branch) branchTicket[p.branch] = p.ticket
  const ticketOf = branch => {
    if (!branch) return null
    for (const re of keyRes) { const m = branch.match(re); if (m) return m[0].toUpperCase() }
    return branchTicket[branch] || null
  }
  const spendByTicket = {}, weekly = {}
  let attributed = 0, total = 0
  const wk = t => { const d = new Date(t); const day = (d.getUTCDay() + 6) % 7; return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10) }
  for (const f of files) {
    for (const [branch, b] of Object.entries(f.branches || {})) {
      if (!b.last || b.last < cutoff) continue
      total += b.cost
      const w = (weekly[wk(b.last)] ||= { week: wk(b.last), spend: 0, points: 0, tickets: new Set() })
      w.spend += b.cost
      const tk = ticketOf(branch)
      if (!tk) continue
      attributed += b.cost
      const s = (spendByTicket[tk] ||= { cost: 0, sessions: 0, last: 0 })
      s.cost += b.cost; s.sessions++; s.last = Math.max(s.last, b.last)
      w.tickets.add(tk)
    }
  }
  const shipped = (snap.issues || []).filter(i => i.live && i.pts > 0 && Date.parse(i.closedAt || 0) >= cutoff)
  for (const i of shipped) { const w = (weekly[wk(Date.parse(i.closedAt))] ||= { week: wk(Date.parse(i.closedAt)), spend: 0, points: 0, tickets: new Set() }); w.points += i.pts }
  const trend = Object.values(weekly).sort((a, b) => a.week.localeCompare(b.week)).map(w => ({
    week: w.week, spend: +w.spend.toFixed(2), points: w.points,
    perPoint: w.points ? +(w.spend / w.points).toFixed(2) : null, n: w.tickets.size,
  }))
  const BUCKETS = [[1, 2, '1–2'], [3, 3, '3'], [5, 5, '5'], [8, 8, '8'], [13, 99, '13+']]
  const cohort = BUCKETS.map(([lo, hi, label]) => {
    const inB = shipped.filter(i => i.pts >= lo && i.pts <= hi)
    const cut = list => ({
      n: list.length, low: list.length < 5,
      medianCycleDays: list.length ? +median(list.map(i => i.delivery)).toFixed(2) : null,
      medianActiveDays: list.length ? +median(list.map(i => i.activeDays)).toFixed(2) : null,
      medianQaCycles: list.length ? +median(list.map(i => i.qaCycles || 0)).toFixed(2) : null,
      reworkRate: list.length ? +(list.filter(i => i.rework).length / list.length).toFixed(2) : null,
      medianSpend: list.length ? +median(list.map(i => spendByTicket[i.key]?.cost || 0)).toFixed(2) : null,
    })
    const ai = inB.filter(i => spendByTicket[i.key])
    const un = inB.filter(i => !spendByTicket[i.key])
    return { bucket: label, pts: lo, aiTouched: cut(ai), untouched: cut(un) }
  })
  const shippedPts = shipped.reduce((s, i) => s + i.pts, 0)
  const shippedWithSpend = shipped.filter(i => spendByTicket[i.key])
  const cohortSpend = shippedWithSpend.reduce((s, i) => s + (spendByTicket[i.key]?.cost || 0), 0)
  const cohortPts = shippedWithSpend.reduce((s, i) => s + i.pts, 0)
  res.json({
    available: true, plane: 'cohort', days, caveat: 'correlational, not causal · AI spend is the viewer\'s own Claude usage (plane B is self-only) · spendPerPoint is computed over AI-touched shipped tickets only, so numerator and denominator share a cohort · which tickets get pointed at Claude is a CHOICE, so the cohort split is selection-biased, not a controlled comparison · no author/assignee field is read or emitted',
    headline: {
      spend: +total.toFixed(2), shippedPoints: shippedPts,
      spendPerPoint: cohortPts ? +(cohortSpend / cohortPts).toFixed(2) : null,
      spendPerPointBasis: { spend: +cohortSpend.toFixed(2), points: cohortPts, tickets: shippedWithSpend.length },
      selfSpendOverTeamPoints: shippedPts ? +(total / shippedPts).toFixed(2) : null,
      attributedPct: total ? +(attributed / total).toFixed(3) : 0,
      unattributedPct: total ? +(1 - attributed / total).toFixed(3) : 1,
      ticketsWithSpend: Object.keys(spendByTicket).length, shippedTickets: shipped.length,
      reworkRate: shipped.length ? +(shipped.filter(i => i.rework).length / shipped.length).toFixed(2) : null,
      medianQaCycles: shipped.length ? +median(shipped.map(i => i.qaCycles || 0)).toFixed(2) : null,
      reworkedTickets: shipped.filter(i => i.rework).length,
      unpointedShipped: (snap.issues || []).filter(i => i.live && !(i.pts > 0) && Date.parse(i.closedAt || 0) >= cutoff).length,
    },
    trend, cohort,
  })
})

// ---------- 14: team harness baseline (repos from projects.json + a team-harness.json read from git) ----------
function driftVs(bundle, project) {
  const cur = exportBundle(project, 'current', '')
  const drifts = []
  const cmp = (field, a, c) => { const A = JSON.stringify(a ?? null), C = JSON.stringify(c ?? null); if (A !== C) drifts.push({ field, baseline: A.slice(0, 400), current: C.slice(0, 400), syncable: true }) }
  cmp('settings.harness', bundle.settings?.harness, cur.settings?.harness)
  cmp('settings.permissions', bundle.settings?.permissions, cur.settings?.permissions)
  for (const k of new Set([...Object.keys(bundle.rules || {}), ...Object.keys(cur.rules || {})])) cmp('rules/' + k, bundle.rules?.[k], cur.rules?.[k])
  for (const k of new Set([...Object.keys(bundle.skills || {}), ...Object.keys(cur.skills || {})])) cmp('skills/' + k, bundle.skills?.[k] ? 'present' : null, cur.skills?.[k] ? 'present' : null)
  return drifts
}
app.get('/api/gov/team', async (req, res) => {
  const meta = readMeta()
  const file = req.query.file || meta.teamHarness || null
  const bundle = file ? readJson(file, null) : null
  const projects = await engProjectList().catch(() => [])
  const repos = projects.filter(p => p.githubRepo).map(p => {
    const local = localCloneOf(p.githubRepo)
    const scaffolded = local ? fs.existsSync(path.join(local, '.claude')) : false
    let drifts = []
    if (bundle && local && scaffolded) { try { drifts = driftVs(bundle, local) } catch {} }
    return {
      key: p.key, name: p.name, repo: p.githubRepo, localPath: local,
      status: !local ? 'not-cloned' : !scaffolded ? 'never-scaffolded' : !bundle ? 'no-baseline' : drifts.length ? 'drifted' : 'on-baseline',
      drifts,
    }
  })
  res.json({ plane: 'work', file, hasBaseline: !!bundle, provenance: bundle?.provenance || null, repos })
})
app.post('/api/gov/team/baseline', (req, res) => {
  const { file } = req.body
  if (!file || !fs.existsSync(file)) return res.status(400).json({ error: 'team-harness.json not found at that path — clone the repo first' })
  if (!readJson(file, null)) return res.status(400).json({ error: 'not valid JSON' })
  const meta = readMeta()
  meta.teamHarness = file
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2))
  respCache.clear()
  res.json({ ok: true, file })
})
app.post('/api/gov/team/export', (req, res) => {
  const { project, file, dryRun } = req.body
  if (!project || !fs.existsSync(project)) return res.status(400).json({ error: 'unknown project' })
  const target = file || readMeta().teamHarness
  if (!target) return res.status(400).json({ error: 'no team-harness.json path set — POST /api/gov/team/baseline first' })
  const bundle = exportBundle(project, 'team-harness', `team baseline from ${path.basename(project)}`)
  const content = JSON.stringify(bundle, null, 2)
  if (dryRun) return res.json({ dryRun: true, file: target, bytes: content.length, skills: Object.keys(bundle.skills || {}), rules: Object.keys(bundle.rules || {}) })
  track(target, content, { scope: project, summary: 'export team harness baseline' })
  const meta = readMeta(); meta.teamHarness = target; fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2))
  res.json({ ok: true, file: target, note: 'commit and push team-harness.json to share it' })
})
app.post('/api/gov/team/sync', (req, res) => {
  const { project, fields, dryRun } = req.body
  const bundle = readJson(readMeta().teamHarness || '', null)
  if (!bundle) return res.status(400).json({ error: 'no team baseline set' })
  if (!project || !fs.existsSync(project)) return res.status(400).json({ error: 'unknown project' })
  const drifts = driftVs(bundle, project).filter(d => d.syncable && (!fields?.length || fields.includes(d.field)))
  if (dryRun) return res.json({ dryRun: true, drifts })
  const applied = []
  for (const d of drifts) {
    if (d.field === 'settings.harness' || d.field === 'settings.permissions') {
      const f = path.join(project, '.claude', 'settings.json')
      const s = readJson(f, {})
      const key = d.field.split('.')[1]
      if (bundle.settings?.[key] === undefined) delete s[key]; else s[key] = bundle.settings[key]
      track(f, JSON.stringify(s, null, 2), { scope: project, summary: `sync ${d.field} from team baseline` })
      applied.push(d.field)
    } else if (d.field.startsWith('rules/') && bundle.rules?.[d.field.slice(6)] != null) {
      track(path.join(project, d.field.slice(6)), bundle.rules[d.field.slice(6)], { scope: project, summary: `sync ${d.field} from team baseline` })
      applied.push(d.field)
    }
  }
  res.json({ ok: true, applied })
})

// ---------- 18: new-project harness scaffolder ----------
function scaffoldFiles(dir, { profile, cloneFrom, skills = [] }) {
  const files = []
  let settings = { permissions: { deny: ['Read(./.env)', 'Read(./.env.*)', 'Read(./secrets/**)'], ask: ['Bash(git push*)', 'WebFetch'], allow: ['Bash(git status*)', 'Bash(git diff*)', 'Bash(git log*)'] } }
  const p = profile ? readProfiles().find(x => x.name === profile) : null
  if (p) settings.harness = p.harness
  if (cloneFrom && fs.existsSync(cloneFrom)) {
    const src = readJson(path.join(cloneFrom, '.claude', 'settings.json'), null)
    if (src) settings = p ? { ...src, harness: deepMerge(src.harness || {}, p.harness) } : src
    const mcp = readJson(path.join(cloneFrom, '.mcp.json'), null)
    if (mcp) files.push({ rel: '.mcp.json', content: JSON.stringify(mcp, null, 2) })
    for (const s of hubListSkills(path.join(cloneFrom, '.claude', 'skills'), 'project')) files.push({ rel: `.claude/skills/${s.name}/SKILL.md`, content: readIf(s.path) || '' })
    for (const a of hubListAgents(path.join(cloneFrom, '.claude', 'agents'), 'project')) files.push({ rel: `.claude/agents/${a.name}.md`, content: readIf(a.path) || '' })
    const md = readIf(path.join(cloneFrom, 'CLAUDE.md'))
    if (md) files.push({ rel: 'CLAUDE.md', content: md })
  }
  files.unshift({ rel: '.claude/settings.json', content: JSON.stringify(settings, null, 2) })
  if (!files.some(f => f.rel === 'CLAUDE.md')) {
    let langs = []
    try { langs = repoInfo(dir).langs } catch {}
    files.push({ rel: 'CLAUDE.md', content: `# ${path.basename(dir)}\n\n${langs.length ? `Primary language: ${langs.join(', ')}.\n\n` : ''}## Conventions\n\n- Keep diffs small; prefer already-installed dependencies.\n- Run the project's tests before claiming a change works.\n\n## Commands\n\n<!-- build / test / run commands here -->\n` })
  }
  for (const name of skills) {
    const src = readIf(path.join(CLAUDE, 'skills', name, 'SKILL.md'))
    if (src && !files.some(f => f.rel === `.claude/skills/${name}/SKILL.md`)) files.push({ rel: `.claude/skills/${name}/SKILL.md`, content: src })
  }
  return files
}
app.post('/api/scaffold', (req, res) => {
  const { dir, profile, cloneFrom, skills, dryRun } = req.body
  if (!dir || !fs.existsSync(dir)) return res.status(400).json({ error: 'target directory does not exist — create it first' })
  const files = scaffoldFiles(dir, { profile, cloneFrom, skills })
  if (dryRun) return res.json({ files: files.map(f => ({ ...f, exists: fs.existsSync(path.join(dir, f.rel)) })) })
  const written = []
  for (const f of files) { track(path.join(dir, f.rel), f.content, { scope: dir, summary: 'scaffold harness' }); written.push(f.rel) }
  try {
    const cj = readClaudeJson()
    if (!cj.projects?.[dir]) { (cj.projects ||= {})[dir] = {}; backup(CLAUDE_JSON); fs.writeFileSync(CLAUDE_JSON, JSON.stringify(cj, null, 2)) }
  } catch {}
  res.json({ ok: true, written })
})

// ---------- 19: batch operations across projects ----------
function batchPlan(op, target, params) {
  if (op === 'set-setting') {
    if (!/^(harness|permissions|model|env)(\.|$)/.test(params.path || '')) throw new Error('path must be under harness/permissions/model/env')
    const file = path.join(target, '.claude', 'settings.json')
    const s = readJson(file, {})
    const before = JSON.stringify(getPath(s, params.path) ?? null)
    const keys = params.path.split('.')
    let o = s
    for (const k of keys.slice(0, -1)) o = o[k] = (o[k] && typeof o[k] === 'object') ? o[k] : {}
    if (params.value === null) delete o[keys[keys.length - 1]]
    else o[keys[keys.length - 1]] = params.value
    const content = JSON.stringify(s, null, 2)
    const changed = before !== JSON.stringify(params.value ?? null)
    return { desc: `${params.path}: ${before} → ${JSON.stringify(params.value)}`, changed, apply: () => track(file, content, { scope: target, summary: `batch: set ${params.path}` }) }
  }
  if (op === 'enable-skill') {
    const src = path.join(CLAUDE, 'skills', params.skill, 'SKILL.md')
    const dst = path.join(target, '.claude', 'skills', params.skill, 'SKILL.md')
    if (!fs.existsSync(src)) return { desc: `global skill "${params.skill}" not found`, changed: false }
    const changed = !fs.existsSync(dst)
    return { desc: changed ? `copy skill "${params.skill}" into project` : 'already enabled', changed, apply: () => track(dst, fs.readFileSync(src, 'utf8'), { scope: target, summary: `batch: enable skill ${params.skill}` }) }
  }
  if (op === 'disable-skill') {
    const dst = path.join(target, '.claude', 'skills', params.skill)
    const changed = fs.existsSync(dst)
    return {
      desc: changed ? `remove project skill "${params.skill}"` : 'not present', changed,
      apply: () => { backup(dst); fs.rmSync(dst, { recursive: true }); appendVersion({ id: 'v' + Date.now().toString(36), ts: Date.now(), author: AUTHOR, machine: os.hostname(), scope: target, file: dst, summary: `batch: disable skill ${params.skill}`, prev: null, content: null }) },
    }
  }
  if (op === 'push-rule') {
    const file = path.join(target, 'CLAUDE.md')
    const cur = readIf(file) || ''
    const rule = String(params.rule || '').trim()
    if (!rule) throw new Error('empty rule')
    const changed = !cur.includes(rule)
    return { desc: changed ? 'append rule to CLAUDE.md' : 'rule already present', changed, apply: () => track(file, cur + (cur && !cur.endsWith('\n') ? '\n' : '') + '\n' + rule + '\n', { scope: target, summary: 'batch: push rule' }) }
  }
  if (op === 'sync-drift') {
    const d = driftFor(target)
    const syncable = (d.drifts || []).filter(x => x.syncable)
    return { desc: d.baseline ? `${syncable.length} drifted field(s): ${syncable.map(x => x.field).join(', ').slice(0, 120)}` : 'no baseline set', changed: syncable.length > 0, apply: () => syncable.forEach(x => syncDriftField(target, x.field)) }
  }
  throw new Error('unknown op: ' + op)
}
app.post('/api/batch', (req, res) => {
  const { op, targets, params = {}, dryRun } = req.body
  const results = []
  for (const t of targets || []) {
    if (!fs.existsSync(t)) { results.push({ target: t, desc: 'directory missing', changed: false }); continue }
    try {
      const plan = batchPlan(op, t, params)
      if (!dryRun && plan.changed && plan.apply) plan.apply()
      results.push({ target: t, desc: plan.desc, changed: plan.changed, applied: !dryRun && plan.changed })
    } catch (e) { results.push({ target: t, desc: 'error: ' + e.message, changed: false }) }
  }
  res.json({ dryRun: !!dryRun, results })
})

// ---------- 21: session bookmarks (pins live in dashboard-meta.json) ----------
app.get('/api/pins', (req, res) => {
  const meta = readMeta()
  res.json(Object.values(meta.pins || {}).sort((a, b) => b.ts - a.ts))
})
app.put('/api/pins', (req, res) => {
  const { sessionId, cwd, label, title, pinned } = req.body
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' })
  const meta = readMeta()
  meta.pins ||= {}
  if (pinned) meta.pins[sessionId] = { sessionId, cwd, label: label || '', title: title || '', ts: Date.now(), configVersion: readVersions().slice(-1)[0]?.id || null }
  else delete meta.pins[sessionId]
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2))
  res.json({ ok: true })
})

// ---------- 22: reusable context bundles ----------
const CTX_FILE = path.join(CLAUDE, 'context-bundles.json')
app.get('/api/ctxbundles', (req, res) => res.json(readJson(CTX_FILE, [])))
app.put('/api/ctxbundles', (req, res) => {
  track(CTX_FILE, JSON.stringify(req.body.bundles || [], null, 2), { summary: 'update context bundles' })
  res.json({ ok: true })
})

// ---------- 20: quick capture — notes land in ~/.claude/notes (visible in Artifacts) ----------
app.post('/api/notes', (req, res) => {
  const dir = path.join(CLAUDE, 'notes')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, (String(req.body.title || 'note').replace(/[^\w-]+/g, '-').slice(0, 40) || 'note') + '-' + Date.now().toString(36) + '.md')
  fs.writeFileSync(file, req.body.content || '')
  res.json({ ok: true, path: file })
})

// ---------- 23: notifications (desktop handled client-side; slack via webhook) ----------
app.get('/api/notify', (req, res) => res.json(readMeta().notify || { desktop: true, slackWebhook: '' }))
app.put('/api/notify', (req, res) => {
  const meta = readMeta()
  meta.notify = { desktop: !!req.body.desktop, slackWebhook: String(req.body.slackWebhook || '') }
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2))
  res.json({ ok: true })
})
app.post('/api/notify/test', async (req, res) => {
  const hook = (readMeta().notify || {}).slackWebhook
  if (!hook) return res.status(400).json({ error: 'no slack webhook configured' })
  try {
    const r = await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'claude-dashboard: test notification' }), signal: AbortSignal.timeout(8000) })
    res.json({ ok: r.ok, status: r.status })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
const slackNotified = new Set()
setInterval(async () => {
  const hook = (readMeta().notify || {}).slackWebhook
  if (!hook) return
  try {
    for (const i of await inboxItems()) {
      if (i.done || i.severity === 'info' || slackNotified.has(i.key)) continue
      slackNotified.add(i.key)
      fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: `[claude-dashboard] ${i.severity.toUpperCase()}: ${i.text}` }) }).catch(() => {})
    }
  } catch {}
}, 60_000)

// ---------- agent teams: activation flag + team designer with AI review ----------
const TEAMS_FLAG = 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'
app.get('/api/team/flag', (req, res) => {
  const s = readJson(settingsFileFor('global'), {})
  res.json({ enabled: s.env?.[TEAMS_FLAG] === '1' })
})
app.post('/api/team/flag', (req, res) => {
  const file = settingsFileFor('global')
  const s = readJson(file, {})
  s.env ||= {}
  if (req.body.enable === false) delete s.env[TEAMS_FLAG]
  else s.env[TEAMS_FLAG] = '1'
  track(file, JSON.stringify(s, null, 2), { summary: (req.body.enable === false ? 'disable' : 'enable') + ' agent teams flag' })
  res.json({ ok: true, enabled: req.body.enable !== false })
})

const TEAM_DESIGNS = path.join(CLAUDE, 'team-designs.json')
app.get('/api/team/designs', (req, res) => res.json(readJson(TEAM_DESIGNS, [])))
app.put('/api/team/designs', (req, res) => {
  track(TEAM_DESIGNS, JSON.stringify(req.body.designs || [], null, 2), { summary: 'update team designs' })
  res.json({ ok: true })
})

app.post('/api/team/design/review', (req, res) => {
  const design = req.body.design
  if (!design?.name || !Array.isArray(design.members)) return res.status(400).json({ error: 'design needs a name and members[]' })
  const rubric = `You are reviewing an agent-team design for Claude Code agent teams (a lead session spawns teammates that share a task list and message each other). Judge it like a pragmatic senior engineer: teams cost tokens, so every member must earn its place. An agent whose job is a single transformation with no tool use or autonomy should be "just-a-prompt" (a skill/command instead). Overlapping members should be "merge". Members that add nothing should be "unnecessary".

Reply with ONLY valid JSON (no markdown fences, no prose) matching exactly:
{"score": <0-100>, "summary": "<2 sentences>",
 "config": [{"check": "<configuration point>", "pass": true|false, "note": "<short>"}],
 "members": [{"name": "<member name>", "verdict": "keep"|"just-a-prompt"|"unnecessary"|"merge", "reason": "<short>",
   "inputs": "<what it consumes>", "outputs": "<what it returns>", "artifacts": ["<files/reports it generates>"],
   "tasks": ["<initial task list>"], "skills": ["<skills it should use>"], "connectors": ["<MCP servers/tools>"], "adrs": ["<decisions to record>"]}],
 "collaboration": [{"from": "<member>", "to": "<member>", "what": "<what flows on this edge>"}],
 "risks": ["<top risks>"]}

The design to review:
${JSON.stringify(design, null, 2)}`
  const child = spawn('claude', ['-p', rubric, '--output-format', 'json', '--dangerously-skip-permissions'], { cwd: HOME, env: process.env, shell: WIN })
  let out = ''
  const timer = setTimeout(() => { try { child.kill() } catch {}; res.status(504).json({ error: 'review timed out (180s)' }) }, 180_000)
  child.stdout.on('data', d => out += d)
  child.on('error', e => { clearTimeout(timer); res.status(500).json({ error: e.message }) })
  child.on('exit', () => {
    clearTimeout(timer)
    if (res.headersSent) return
    try {
      const j = JSON.parse(out)
      const raw = String(j.result || '')
      const review = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
      res.json({ review, cost: j.total_cost_usd || null, ms: j.duration_ms || null })
    } catch (e) { res.status(500).json({ error: 'could not parse AI review: ' + e.message, raw: out.slice(0, 800) }) }
  })
})

// ================= 25 bugs · 26 hooks · 27 CI gating · 28 analytics · 29 design drift · 30 review loop =================

mountBugTriage(app)
mountNativeHooks(app, { scanTranscripts: (...a) => scanTranscripts(...a), settingsFileFor: (...a) => settingsFileFor(...a) })

const ciWorkflowPath = (project, provider) => provider === 'gitlab' ? path.join(project, '.gitlab-ci.yml') : path.join(project, '.github', 'workflows', 'harness-evals.yml')
function ciYaml(provider, minPass) {
  const runner = `node -e "const fs=require('fs'),{execSync}=require('child_process');const tasks=JSON.parse(fs.readFileSync('.claude/harness-evals.json','utf8'));let pass=0;for(const t of tasks){let ok=false;try{const r=JSON.parse(execSync('claude -p '+JSON.stringify(t.prompt)+' --output-format json --dangerously-skip-permissions',{timeout:180000,encoding:'utf8'}));ok=new RegExp(t.expect).test(r.result||'')}catch(e){}console.log((ok?'PASS':'FAIL')+' '+t.name);if(ok)pass++}const rate=pass/tasks.length;console.log('pass rate '+Math.round(rate*100)+'% (gate ${Math.round(minPass * 100)}%)');if(rate<${minPass})process.exit(1)"`
  if (provider === 'gitlab') return `# generated by claude-dashboard — harness eval gate (min pass ${Math.round(minPass * 100)}%)
harness-evals:
  image: node:22
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      changes: [".claude/**/*"]
  script:
    - npm install -g @anthropic-ai/claude-code
    - ${runner}
  variables:
    ANTHROPIC_API_KEY: $ANTHROPIC_API_KEY
`
  return `# generated by claude-dashboard — harness eval gate (min pass ${Math.round(minPass * 100)}%)
name: harness-evals
on:
  pull_request:
    paths: ['.claude/**']
jobs:
  evals:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm install -g @anthropic-ai/claude-code
      - run: ${runner}
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
`
}
app.get('/api/ci/status', (req, res) => {
  const project = req.query.project
  if (!project || !fs.existsSync(project)) return res.status(400).json({ error: 'unknown project' })
  let existing = null
  for (const provider of ['github', 'gitlab']) {
    const p = ciWorkflowPath(project, provider)
    const src = readIf(p)
    if (src && src.includes('harness-eval')) existing = { provider, path: p, minPass: Number((/min pass (\d+)%/.exec(src) || [])[1] || 0) / 100 }
  }
  const gh = spawnSync('gh', ['--version'], { timeout: 3000 })
  res.json({ workflow: existing, ghAvailable: gh.status === 0, evalsInRepo: fs.existsSync(path.join(project, '.claude', 'harness-evals.json')) })
})
app.post('/api/ci/generate', (req, res) => {
  const { project, provider = 'github', minPass = 0.9, dryRun } = req.body
  if (!project || !fs.existsSync(project)) return res.status(400).json({ error: 'unknown project' })
  const files = [
    { rel: path.relative(project, ciWorkflowPath(project, provider)), content: ciYaml(provider, minPass) },
    { rel: '.claude/harness-evals.json', content: JSON.stringify(readJson(EVALS_FILE, DEFAULT_EVALS), null, 2) },
  ]
  if (dryRun) return res.json({ files: files.map(f => ({ ...f, exists: fs.existsSync(path.join(project, f.rel)) })) })
  for (const f of files) track(path.join(project, f.rel), f.content, { scope: project, summary: `CI eval gate (${provider}, min ${Math.round(minPass * 100)}%)` })
  res.json({ ok: true, written: files.map(f => f.rel), note: 'set the ANTHROPIC_API_KEY secret in your repo settings' })
})
// ---------- 4: cross-repo CI health (main-branch failure rate, time-to-green, flakes) ----------
const ghAvailable = () => { try { return spawnSync('gh', ['auth', 'status'], { timeout: 8000 }).status === 0 } catch { return false } }
async function engProjectList() {
  engMod ||= await import('./eng.mjs')
  if (typeof engMod.projectList === 'function') return engMod.projectList()
  const r = await fetch(`http://127.0.0.1:${PORT}/api/eng/projects`)
  return await r.json()
}
const RUN_FIELDS = 'databaseId,status,conclusion,workflowName,headSha,headBranch,createdAt,updatedAt,url,displayTitle'
function repoRuns(repo, branch, limit = 100) {
  const r = spawnSync('gh', ['run', 'list', '--repo', repo, '--branch', branch, '--json', RUN_FIELDS, '--limit', String(limit)], { timeout: 25000, maxBuffer: 32 * 1024 * 1024 })
  if (r.status !== 0) throw new Error((r.stderr || '').toString().trim().slice(0, 160) || 'gh run list failed')
  return JSON.parse(r.stdout.toString() || '[]')
}
function repoCI(repo, project, days) {
  const cutoff = Date.now() - days * 86400_000
  let raw = repoRuns(repo, 'main')
  let branch = 'main'
  if (!raw.length) { raw = repoRuns(repo, 'master'); branch = raw.length ? 'master' : 'main' }
  const runs = raw.filter(x => Date.parse(x.createdAt) >= cutoff)
    .map(x => ({ id: x.databaseId, status: x.status, conclusion: x.conclusion, workflowName: x.workflowName, headSha: x.headSha, at: Date.parse(x.createdAt), endedAt: Date.parse(x.updatedAt), url: x.url, title: x.displayTitle }))
    .sort((a, b) => a.at - b.at)
  const done = runs.filter(r => r.conclusion === 'success' || r.conclusion === 'failure')
  const fails = done.filter(r => r.conclusion === 'failure')
  const greens = []
  for (const f of fails) {
    const fix = done.find(r => r.workflowName === f.workflowName && r.at > f.at && r.conclusion === 'success')
    if (fix) greens.push((fix.at - f.at) / 60000)
  }
  const bySha = {}
  for (const r of done) { const s = (bySha[r.headSha] ||= { ok: 0, bad: 0, wf: new Set(), last: 0 }); if (r.conclusion === 'success') s.ok++; else s.bad++; s.wf.add(r.workflowName); s.last = Math.max(s.last, r.at) }
  const flakySha = Object.entries(bySha).filter(([, s]) => s.ok && s.bad)
  const byWf = {}
  for (const [sha, s] of flakySha) for (const w of s.wf) { const e = (byWf[w] ||= { workflow: w, count: 0, shas: [], last: 0 }); e.count++; if (e.shas.length < 5) e.shas.push(sha.slice(0, 7)); e.last = Math.max(e.last, s.last) }
  const last = done[done.length - 1] || null
  return {
    repo, project, branch, days,
    runs: runs.length, completed: done.length, failures: fails.length,
    failureRate: done.length ? +(fails.length / done.length).toFixed(3) : null,
    mainRed: last ? last.conclusion === 'failure' : false,
    lastRun: last,
    medianTimeToGreenMin: greens.length ? Math.round(median(greens)) : null,
    medianDurationMin: done.length ? Math.round(median(done.map(r => (r.endedAt - r.at) / 60000))) : null,
    flaky: Object.values(byWf).sort((a, b) => b.count - a.count).slice(0, 10),
    flakyShas: flakySha.length,
    recent: runs.slice(-15).reverse(),
  }
}
const ciCache = { at: 0, data: null }
const CI_TTL = 10 * 60_000
async function ciHealth(days = 14, fresh = false, wait = true) {
  if (!fresh && ciCache.data && Date.now() - ciCache.at < CI_TTL && ciCache.data.days === days) return ciCache.data
  if (!wait) {
    if (Date.now() - ciCache.at > CI_TTL) { ciCache.at = Date.now(); setTimeout(() => ciHealth(days, true).catch(() => {}), 0) }
    return ciCache.data || { days, ghAvailable: false, repos: [], redRepos: [], cold: true }
  }
  engMod ||= await import('./eng.mjs')
  if (typeof engMod.ciHealth === 'function') return await engMod.ciHealth(days)
  const gh = ghAvailable()
  const projects = gh ? await engProjectList().catch(() => []) : []
  const repos = []
  for (const p of projects) {
    if (!p.githubRepo) continue
    try { repos.push(repoCI(p.githubRepo, p.key, days)) }
    catch (e) { repos.push({ repo: p.githubRepo, project: p.key, error: e.message, runs: 0, mainRed: false, flaky: [] }) }
  }
  const data = { days, ghAvailable: gh, generatedAt: Date.now(), repos, redRepos: repos.filter(r => r.mainRed).map(r => r.repo) }
  ciCache.at = Date.now(); ciCache.data = data
  return data
}
app.get('/api/ci/runs', async (req, res) => {
  const project = req.query.project
  if (project) {
    if (!fs.existsSync(project)) return res.status(400).json({ error: 'unknown project' })
    const r = spawnSync('gh', ['run', 'list', '--workflow', 'harness-evals.yml', '--json', 'status,conclusion,createdAt,headBranch,displayTitle,url', '--limit', '15'], { cwd: project, timeout: 15000 })
    if (r.status !== 0) return res.json({ error: (r.stderr || '').toString().slice(0, 200) || 'gh CLI unavailable or no workflow runs', runs: [] })
    try { return res.json({ runs: JSON.parse(r.stdout.toString()).map(x => ({ ...x, source: 'CI' })) }) } catch { return res.json({ runs: [] }) }
  }
  res.json(await ciHealth(Number(req.query.days) || 14, req.query.fresh === '1'))
})
app.get('/api/ci/health', async (req, res) => res.json(await ciHealth(Number(req.query.days) || 14, req.query.fresh === '1')))
app.post('/api/ci/rerun', (req, res) => {
  const { repo, id, failedOnly } = req.body
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '') || !/^\d+$/.test(String(id || ''))) return res.status(400).json({ error: 'repo (owner/name) and numeric run id required' })
  const args = ['run', 'rerun', String(id), '--repo', repo, ...(failedOnly ? ['--failed'] : [])]
  const r = spawnSync('gh', args, { timeout: 20000 })
  if (r.status !== 0) return res.status(500).json({ error: (r.stderr || '').toString().slice(0, 200) })
  ciCache.at = 0
  res.json({ ok: true })
})

mountDrift(app, { projectDirs: (...a) => projectDirs(...a), scanTranscripts: (...a) => scanTranscripts(...a) })

// ---------- 31–37: agentic task board — JIRA-style dev → review → QA → release pipeline ----------
mountBoard(app)

// ---------- loush runs: .loush/<ticket>/ across known repos (contract §12–16) ----------
mountLoushRuns(app, { collectUsage: (...a) => collectUsage(...a) })


app.get('/api/scheduler', (req, res) => res.json(readSchedulerConfig(CLAUDE)))
app.put('/api/scheduler', (req, res) => res.json(writeSchedulerConfig(CLAUDE, req.body || {})))

app.get('/api/meta', (req, res) => res.json({ home: HOME, claudeDir: CLAUDE, project: PROJECT, backups: BACKUPS }))

app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }))
const server = app.listen(PORT, bindHost(), () => {
  const host = bindHost()
  try { publishInstance({ port: PORT, host }) } catch (e) { console.warn('[claude-dashboard] could not publish instance for hooks:', e.message) }
  console.log(`[claude-dashboard] API on http://localhost:${PORT}`)
  if (isExposedBind(host)) console.warn(`[claude-dashboard] WARNING: bound to ${host}, not loopback — this dashboard is reachable from other machines`)
  engSnapshot(true).then(s => console.log(`[claude-dashboard] eng snapshot ${s?.available ? 'warm' : 'unavailable (will retry)'}`)).catch(() => {})
  startScheduler({ CLAUDE, port: PORT, runAgent, log: console.log })
})

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {
  try { unpublishInstance() } catch {}
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 500).unref()
})
