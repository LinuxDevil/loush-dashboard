// Execution-plan graph schema: parse the JSON DAG a session emits, and lay it out by dependency depth.
// The schema (one object per step): { step_id, description, dependencies[], expected_skill[],
// active_rules[], mcp_server, tool_to_call, expected_params{} }. Placeholder values like
// "TBD based on step 1" are just strings — nothing here special-cases them.

// Return the LAST valid plan found in the chat text blocks (most recent plan wins).
export function extractPlan(blocks) {
  let plan = null
  for (const b of blocks) {
    if (b.kind !== 'text' || typeof b.text !== 'string') continue
    for (const m of b.text.matchAll(/```json\s*([\s\S]*?)```/g)) {
      try {
        const p = JSON.parse(m[1])
        if (Array.isArray(p) && p.length && p.every(s => s && typeof s === 'object' && 'step_id' in s)) plan = p
      } catch { /* not a plan block — skip */ }
    }
  }
  return plan
}

// Derive a plan-shaped step list from what a session ACTUALLY did — one step per tool call.
// `column` = conversation turn (each user message starts a new column); dependencies chain
// each action to the previous one so the graph reads as one connected thread of execution.
// Subagent (Task/Agent) actions are attached as `substeps` so you can see what they did.
// Same schema as extractPlan output, so it renders in the same PlanGraph.
const CAP = 60
const shortArg = i => {
  if (i == null || typeof i !== 'object') return String(i ?? '')
  const v = i.command || i.file_path || i.pattern || i.path || i.prompt || i.description || i.url || ''
  return String(v).replace(/\s+/g, ' ').slice(0, 60)
}
const toolName = b => b.name.startsWith('mcp__') ? (b.name.split('__')[2] || b.name) : b.name
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
    // recurse into the subagent's own actions so each subagent gets its own graph (nested arbitrarily deep)
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
      subplan,
    })
    prevId = steps.length
    turnHasSteps = true
  }
  return steps
}

// Heuristic diagnosis of a session from its blocks — concrete, actionable findings.
// level: 'warn' (worth fixing) | 'info' (consider) | 'good' (positive signal).
export function diagnoseSession(blocks) {
  const tools = []
  const walk = bs => bs.forEach(b => { if (b.kind === 'tool') { tools.push(b); if (Array.isArray(b.children)) walk(b.children) } })
  walk(blocks)
  const out = []
  if (!tools.length) return out

  const shellRead = tools.filter(t => t.name === 'Bash' && /(^|\s|\|)(cat|sed|grep|head|tail|awk|ls|find)\b/.test(t.input?.command || ''))
  if (shellRead.length >= 3) out.push({ level: 'warn', title: `${shellRead.length} shell calls did file reading/searching`, detail: 'Prefer Read / Grep / Glob over cat·sed·grep·find in Bash — structured, cheaper, and your global CLAUDE.md discourages them.' })

  const reads = tools.filter(t => t.name === 'Read').map(t => t.input?.file_path).filter(Boolean)
  const dups = [...new Set(reads.filter((f, i) => reads.indexOf(f) !== i))]
  if (dups.length) out.push({ level: 'info', title: `${dups.length} file(s) read more than once`, detail: 'Re-reading suggests lost context: ' + dups.slice(0, 3).map(f => f.split('/').pop()).join(', ') })

  const errRe = /\b(error|failed|not found|no such|cannot|exception|traceback|denied)\b/i
  const errs = tools.filter(t => errRe.test(String(t.result || '')))
  if (errs.length) out.push({ level: errs.length >= 3 ? 'warn' : 'info', title: `${errs.length} tool call(s) hit errors`, detail: 'Check for wasted retry loops — the first failure is usually the real signal.' })

  // busiest single turn
  const perTurn = {}
  for (const s of blocksToPlan(blocks)) perTurn[s.column] = (perTurn[s.column] || 0) + 1
  const busiest = Math.max(0, ...Object.values(perTurn))
  if (busiest >= 25) out.push({ level: 'info', title: `One turn ran ${busiest} actions with no checkpoint`, detail: 'Long unbroken turns are hard to review or recover — consider intermediate check-ins.' })

  const agents = tools.filter(t => t.name === 'Task' || t.name === 'Agent')
  if (agents.length) {
    const counts = {}
    for (const a of agents) { const k = a.input?.subagent_type || 'agent'; counts[k] = (counts[k] || 0) + 1 }
    const summary = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => n > 1 ? `${k} ×${n}` : k).join(', ')
    out.push({ level: 'good', title: `${agents.length} subagent run(s)`, detail: `${summary} — click a subagent node to open its own graph.` })
  }

  if (!extractPlan(blocks) && tools.length >= 20) out.push({ level: 'info', title: 'No execution plan emitted', detail: `For a ${tools.length}-action session, asking for a plan first (the plan graph) improves reviewability.` })

  const order = { warn: 0, info: 1, good: 2 }
  return out.sort((a, b) => order[a.level] - order[b.level])
}

// Depth = longest dependency chain to a root. Cycle-safe (a step inside a cycle resolves to 0).
// Returns { depth: Map<step_id,int>, byId: Map<step_id,step>, maxDepth }.
export function planLayout(steps) {
  const byId = new Map(steps.map(s => [s.step_id, s]))
  const depth = new Map(), visiting = new Set()
  const compute = id => {
    if (depth.has(id)) return depth.get(id)
    if (visiting.has(id)) return 0 // cycle guard
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
