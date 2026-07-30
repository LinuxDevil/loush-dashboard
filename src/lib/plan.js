
export function extractPlan(blocks) {
  let plan = null
  for (const b of blocks) {
    if (b.kind !== 'text' || typeof b.text !== 'string') continue
    for (const m of b.text.matchAll(/```json\s*([\s\S]*?)```/g)) {
      try {
        const p = JSON.parse(m[1])
        if (Array.isArray(p) && p.length && p.every(s => s && typeof s === 'object' && 'step_id' in s)) plan = p
      } catch { }
    }
  }
  return plan
}

const CAP = 60
export const shortArg = i => {
  if (i == null || typeof i !== 'object') return String(i ?? '')
  const path = i.file_path || i.path
  if (path && !i.command) {
    const p = String(path)
    if (p.length <= CAP) return p
    const seg = p.split('/')
    return '…/' + seg.slice(-2).join('/')
  }
  const v = i.command || i.pattern || i.prompt || i.description || i.url || ''
  return String(v).replace(/\s+/g, ' ').slice(0, CAP)
}
export const toolName = b => b.name.startsWith('mcp__') ? (b.name.split('__')[2] || b.name) : b.name
export function blocksToPlan(blocks) {
  const steps = []
  let turn = 0, turnHasSteps = false, prevId = null
  for (const b of blocks) {
    if (b.kind === 'user') { if (turnHasSteps) { turn++; turnHasSteps = false } continue }
    if (b.kind !== 'tool' || !b.name) continue
    if (steps.length >= CAP) {
      steps.push({ step_id: steps.length + 1, column: turn, description: `… session continues (showing first ${CAP} actions)`, dependencies: prevId != null ? [prevId] : [], expected_skill: [], active_rules: [], mcp_server: null, tool_to_call: null, expected_params: {} })
      break
    }
    const isMcp = b.name.startsWith('mcp__')
    const [, mserver] = isMcp ? b.name.split('__') : []
    const isAgent = b.name === 'Task' || b.name === 'Agent'
    const subplan = isAgent && Array.isArray(b.children) ? blocksToPlan(b.children) : null
    const desc = b.name === 'Skill' ? `/${b.input?.skill || 'skill'}`
      : isAgent ? `${b.input?.subagent_type || 'agent'}: ${shortArg(b.input) || 'subagent'} (${subplan ? subplan.length : 0} actions)`
      : `${toolName(b)}${shortArg(b.input) ? ' · ' + shortArg(b.input) : ''}`
    steps.push({
      step_id: steps.length + 1,
      column: turn,
      description: desc,
      dependencies: prevId != null ? [prevId] : [],
      expected_skill: b.name === 'Skill' && b.input?.skill ? [b.input.skill] : [],
      active_rules: [],
      mcp_server: isMcp ? mserver : null,
      tool_to_call: isMcp ? toolName(b) : b.name,
      expected_params: b.input && typeof b.input === 'object' ? b.input : {},
      result: b.result ?? null,
      isError: b.isError === true,
      toolResult: b.toolResult ?? null,
      ts: b.ts ?? null,
      usage: b.usage ?? null,
      subplan,
    })
    prevId = steps.length
    turnHasSteps = true
  }
  return steps
}

export function turnMetrics(steps) {
  const m = new Map()
  for (const s of steps) {
    const col = s.column || 0
    const e = m.get(col) || { tokens: 0, cached: 0, tMin: null, tMax: null }
    const u = s.usage
    if (u) {
      e.tokens += (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0)
      e.cached += u.cache_read_input_tokens || 0
    }
    if (s.ts) { const t = Date.parse(s.ts); if (!Number.isNaN(t)) { e.tMin = e.tMin == null ? t : Math.min(e.tMin, t); e.tMax = e.tMax == null ? t : Math.max(e.tMax, t) } }
    m.set(col, e)
  }
  for (const e of m.values()) e.ms = (e.tMin != null && e.tMax != null) ? e.tMax - e.tMin : null
  return m
}

export function filesTouched(steps) {
  const map = new Map()
  const bump = (p, k, n = 1) => { if (!p) return; const e = map.get(p) || { path: p, reads: 0, writes: 0, added: 0, removed: 0 }; e[k] += n; map.set(p, e) }
  for (const s of steps) {
    const p = s.expected_params?.file_path
    if (s.tool_to_call === 'Read') bump(p, 'reads')
    else if (['Write', 'Edit', 'MultiEdit'].includes(s.tool_to_call)) {
      bump(p, 'writes')
      for (const h of (Array.isArray(s.toolResult?.structuredPatch) ? s.toolResult.structuredPatch : []))
        for (const l of h.lines || []) { if (l[0] === '+') bump(p, 'added'); else if (l[0] === '-') bump(p, 'removed') }
    }
  }
  return [...map.values()].sort((a, b) => (b.writes - a.writes) || (b.reads - a.reads))
}

export function diagnoseSession(blocks) {
  const plan = blocksToPlan(blocks)
  const out = []
  if (!plan.length) return out
  const idsWhere = fn => plan.filter(fn).map(s => s.step_id)

  const shellReadIds = idsWhere(s => s.tool_to_call === 'Bash' && /(^|\s|\|)(cat|sed|grep|head|tail|awk|ls|find)\b/.test(s.expected_params?.command || ''))
  if (shellReadIds.length >= 3) out.push({ level: 'warn', title: `${shellReadIds.length} shell calls did file reading/searching`, detail: 'Prefer Read / Grep / Glob over cat·sed·grep·find in Bash — structured, cheaper, and your global CLAUDE.md discourages them.', stepIds: shellReadIds })

  const reads = plan.filter(s => s.tool_to_call === 'Read').map(s => s.expected_params?.file_path).filter(Boolean)
  const dupPaths = new Set(reads.filter((f, i) => reads.indexOf(f) !== i))
  if (dupPaths.size) out.push({ level: 'info', title: `${dupPaths.size} file(s) read more than once`, detail: 'Re-reading suggests lost context: ' + [...dupPaths].slice(0, 3).map(f => f.split('/').pop()).join(', '), stepIds: idsWhere(s => s.tool_to_call === 'Read' && dupPaths.has(s.expected_params?.file_path)) })

  const errRe = /\b(error|failed|not found|no such|cannot|exception|traceback|denied)\b/i
  const errIds = idsWhere(s => s.isError || (s.tool_to_call === 'Bash' && errRe.test(String(s.result || ''))))
  if (errIds.length) out.push({ level: errIds.length >= 3 ? 'warn' : 'info', title: `${errIds.length} tool call(s) hit errors`, detail: 'Check for wasted retry loops — the first failure is usually the real signal.', stepIds: errIds })

  const perTurn = {}
  for (const s of plan) perTurn[s.column] = (perTurn[s.column] || 0) + 1
  const busiest = Math.max(0, ...Object.values(perTurn))
  if (busiest >= 25) {
    const busyCol = Number(Object.entries(perTurn).find(([, n]) => n === busiest)?.[0])
    out.push({ level: 'info', title: `One turn ran ${busiest} actions with no checkpoint`, detail: 'Long unbroken turns are hard to review or recover — consider intermediate check-ins.', stepIds: idsWhere(s => s.column === busyCol) })
  }

  const agentSteps = plan.filter(s => s.subplan)
  if (agentSteps.length) {
    const counts = {}
    for (const a of agentSteps) { const k = (a.description.split(':')[0]) || 'agent'; counts[k] = (counts[k] || 0) + 1 }
    const summary = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => n > 1 ? `${k} ×${n}` : k).join(', ')
    out.push({ level: 'good', title: `${agentSteps.length} subagent run(s)`, detail: `${summary} — click a subagent node to open its own graph.`, stepIds: agentSteps.map(s => s.step_id) })
  }

  if (!extractPlan(blocks) && plan.length >= 20) out.push({ level: 'info', title: 'No execution plan emitted', detail: `For a ${plan.length}-action session, asking for a plan first (the plan graph) improves reviewability.`, stepIds: [] })

  const order = { warn: 0, info: 1, good: 2 }
  return out.sort((a, b) => order[a.level] - order[b.level])
}

export function planLayout(steps) {
  const byId = new Map(steps.map(s => [s.step_id, s]))
  const depth = new Map(), visiting = new Set()
  const compute = id => {
    if (depth.has(id)) return depth.get(id)
    if (visiting.has(id)) return 0
    visiting.add(id)
    const deps = (byId.get(id)?.dependencies || []).filter(d => byId.has(d))
    const d = deps.length ? 1 + Math.max(...deps.map(compute)) : 0
    visiting.delete(id)
    depth.set(id, d)
    return d
  }
  for (const s of steps) compute(s.step_id)
  return { depth, byId, maxDepth: Math.max(0, ...depth.values()) }
}
