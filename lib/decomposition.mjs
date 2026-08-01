// Parse and CHECK a generated task decomposition against the real repository.
//
// A model asked to split an epic into tasks will produce something plausible every time. The
// plausible failures are specific and all of them are silent:
//
//   · a task depends on a number that is not in the list
//   · two tasks depend on each other, so the plan can never start
//   · tasks declared parallel touch the same file, so running them together conflicts
//   · a named file does not exist in the checkout, which means the plan is about an imagined repo
//
// None of these are visible by reading the document — it looks fine. So the decomposition is
// parsed and every one of them is checked, and the findings ride along with the artifact. This is
// the part a generator working from a ticket alone cannot do: we have the checkout.
//
// Nothing here rewrites the model's output. A problem is reported against the task it is in; the
// document the model wrote is the document that gets stored.

export const SIZES = ['XS', 'S', 'M', 'L', 'XL']
export const MAX_TASKS = 10

/**
 * Glob → RegExp. Supports `**` (any depth, including none), `*` (within one segment), `?`, and
 * `{a,b}` alternation, which is the subset that shows up in a file-scope list.
 */
export function globToRegExp(glob) {
  const g = String(glob ?? '').trim()
  if (!g) return null
  let out = '', i = 0
  while (i < g.length) {
    const c = g[i]
    if (c === '*') {
      if (g[i + 1] === '*') {
        // `a/**/b` must also match `a/b`, so the slash is absorbed into the wildcard.
        if (g[i + 2] === '/') { out += '(?:.*/)?'; i += 3; continue }
        out += '.*'; i += 2; continue
      }
      out += '[^/]*'; i++; continue
    }
    if (c === '?') { out += '[^/]'; i++; continue }
    if (c === '{') {
      const close = g.indexOf('}', i)
      if (close > i) {
        out += '(?:' + g.slice(i + 1, close).split(',').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')'
        i = close + 1
        continue
      }
    }
    out += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    i++
  }
  try { return new RegExp('^' + out + '$') } catch { return null }
}

/** Files in `paths` that a glob matches. */
export function matchGlob(glob, paths) {
  const re = globToRegExp(glob)
  if (!re) return []
  return (paths || []).filter(p => re.test(p))
}

const listField = v => String(v ?? '')
  .replace(/^\[|\]$/g, '')
  .split(',')
  .map(s => s.trim().replace(/^["']|["']$/g, ''))
  .filter(Boolean)

/**
 * Parse the task list out of the generated markdown.
 *
 * Format: `## <n>. <title>` followed by `- key: value` lines. Deliberately forgiving about
 * ordering and casing, and strict about the task number — a task whose heading has no number
 * cannot be depended on, so it is reported rather than renumbered into place.
 */
export function parseTasks(md) {
  const text = String(md ?? '')
  const tasks = [], malformed = []
  // Split on level-2 headings, keeping each heading with its body.
  const chunks = text.split(/^##\s+/m).slice(1)
  for (const chunk of chunks) {
    const nl = chunk.indexOf('\n')
    const heading = (nl === -1 ? chunk : chunk.slice(0, nl)).trim()
    const body = nl === -1 ? '' : chunk.slice(nl + 1)
    const m = /^(\d+)[.)]?\s*(.*)$/.exec(heading)
    if (!m) { malformed.push({ heading, reason: 'heading carries no task number, so nothing can depend on it' }); continue }
    const fields = {}
    for (const line of body.split('\n')) {
      const f = /^\s*[-*]\s*([A-Za-z_ ]+?)\s*:\s*(.*)$/.exec(line)
      if (f) fields[f[1].trim().toLowerCase().replace(/\s+/g, '_')] = f[2].trim()
    }
    const sizeRaw = (fields.size || '').toUpperCase().replace(/[^A-Z]/g, '')
    tasks.push({
      id: Number(m[1]),
      title: m[2] || '(untitled)',
      size: SIZES.includes(sizeRaw) ? sizeRaw : null,
      sizeRaw: fields.size || null,
      dependsOn: listField(fields.depends_on).map(Number).filter(Number.isFinite),
      conflictsWith: listField(fields.conflicts_with).map(Number).filter(Number.isFinite),
      parallel: /^(true|yes)$/i.test(fields.parallel || ''),
      files: listField(fields.files),
      body,
    })
  }
  return { tasks, malformed }
}

const cycleCheck = tasks => {
  const deps = new Map(tasks.map(t => [t.id, t.dependsOn.filter(d => tasks.some(x => x.id === d))]))
  const colour = new Map(), cycles = []
  for (const root of deps.keys()) {
    if (colour.get(root)) continue
    const stack = [[root, 0]], onPath = []
    while (stack.length) {
      const frame = stack[stack.length - 1]
      const [id, i] = frame
      if (i === 0) {
        if (colour.get(id) === 2) { stack.pop(); continue }
        colour.set(id, 1); onPath.push(id)
      }
      const d = deps.get(id) || []
      if (i >= d.length) { colour.set(id, 2); onPath.pop(); stack.pop(); continue }
      frame[1]++
      const next = d[i]
      if (colour.get(next) === 1) { const at = onPath.indexOf(next); if (at >= 0) cycles.push(onPath.slice(at).concat(next)); continue }
      if (colour.get(next) === 2) continue
      stack.push([next, 0])
    }
  }
  const seen = new Set(), out = []
  for (const c of cycles) {
    const sig = [...new Set(c)].sort((a, b) => a - b).join('>')
    if (!seen.has(sig)) { seen.add(sig); out.push(c) }
  }
  return out
}

/**
 * Check a parsed decomposition.
 *
 * @param {{tasks: Array, malformed: Array}} parsed
 * @param {string[]} [repoFiles]  every path in the checkout; omit to skip the file checks, which
 *                                are then reported as skipped rather than silently passing
 */
export function validateTasks(parsed, repoFiles) {
  const tasks = parsed?.tasks || []
  const problems = []
  const ids = new Set(tasks.map(t => t.id))

  for (const m of parsed?.malformed || []) problems.push({ severity: 'error', kind: 'malformed-task', detail: m.reason, heading: m.heading })

  const seen = new Set()
  for (const t of tasks) {
    if (seen.has(t.id)) problems.push({ severity: 'error', kind: 'duplicate-id', task: t.id, detail: `two tasks are numbered ${t.id}, so a dependency on it is ambiguous` })
    seen.add(t.id)
    for (const d of t.dependsOn) {
      if (d === t.id) problems.push({ severity: 'error', kind: 'self-dependency', task: t.id, detail: `task ${t.id} depends on itself` })
      else if (!ids.has(d)) problems.push({ severity: 'error', kind: 'unknown-dependency', task: t.id, detail: `task ${t.id} depends on ${d}, which is not in this decomposition` })
    }
    for (const c of t.conflictsWith) {
      if (!ids.has(c)) problems.push({ severity: 'warn', kind: 'unknown-conflict', task: t.id, detail: `task ${t.id} declares a conflict with ${c}, which is not in this decomposition` })
    }
    if (!t.size) problems.push({ severity: 'warn', kind: 'missing-size', task: t.id, detail: t.sizeRaw ? `size "${t.sizeRaw}" is not one of ${SIZES.join('/')}` : 'no size given' })
    if (!t.files.length) problems.push({ severity: 'warn', kind: 'no-file-scope', task: t.id, detail: `task ${t.id} names no files, so its scope cannot be checked for overlap with anything else` })
  }

  for (const c of cycleCheck(tasks)) {
    problems.push({ severity: 'error', kind: 'dependency-cycle', detail: `tasks ${c.join(' → ')} depend on each other — this plan can never start`, cycle: c })
  }

  if (tasks.length > MAX_TASKS) {
    problems.push({ severity: 'warn', kind: 'too-many-tasks', detail: `${tasks.length} tasks — the format is capped at ${MAX_TASKS}; past that a decomposition is a backlog, not a plan` })
  }
  if (!tasks.length) problems.push({ severity: 'error', kind: 'no-tasks', detail: 'nothing parsed as a task — the generator did not follow the format' })

  // ---- file scope, only if we were given the real tree ----
  const scopes = new Map()
  let filesChecked = false
  if (Array.isArray(repoFiles)) {
    filesChecked = true
    for (const t of tasks) {
      const matched = new Set()
      for (const f of t.files) {
        const hits = matchGlob(f, repoFiles)
        // A path that matches nothing is the tell that the plan is about an imagined repository.
        // New files a task will CREATE legitimately match nothing, so this is a warning with the
        // pattern named, not an error — the reader decides.
        if (!hits.length) problems.push({ severity: 'warn', kind: 'path-not-in-repo', task: t.id, pattern: f, detail: `task ${t.id} names "${f}", which matches nothing in the checkout — either it is a file to be created, or the plan is about a repository that does not look like this one` })
        for (const h of hits) matched.add(h)
      }
      scopes.set(t.id, matched)
    }
    // Overlap only matters between tasks that could run at the same time: neither depends on the
    // other, directly or transitively.
    const reach = new Map()
    const reachable = id => {
      if (reach.has(id)) return reach.get(id)
      const out = new Set()
      reach.set(id, out)
      const t = tasks.find(x => x.id === id)
      for (const d of t?.dependsOn || []) { out.add(d); for (const r of reachable(d)) out.add(r) }
      return out
    }
    for (let i = 0; i < tasks.length; i++) {
      for (let j = i + 1; j < tasks.length; j++) {
        const a = tasks[i], b = tasks[j]
        if (reachable(a.id).has(b.id) || reachable(b.id).has(a.id)) continue   // ordered — cannot collide
        const shared = [...(scopes.get(a.id) || [])].filter(p => (scopes.get(b.id) || new Set()).has(p))
        if (!shared.length) continue
        const declared = a.conflictsWith.includes(b.id) || b.conflictsWith.includes(a.id)
        problems.push({
          severity: declared ? 'info' : 'error',
          kind: declared ? 'declared-conflict' : 'undeclared-overlap',
          tasks: [a.id, b.id], files: shared.slice(0, 10),
          detail: declared
            ? `tasks ${a.id} and ${b.id} share ${shared.length} file(s) and correctly declare the conflict`
            : `tasks ${a.id} and ${b.id} have no ordering between them and both touch ${shared.map(s => `"${s}"`).slice(0, 3).join(', ')}${shared.length > 3 ? ` (+${shared.length - 3} more)` : ''} — running them in parallel conflicts, and neither declares it`,
        })
      }
    }
  }

  const errors = problems.filter(p => p.severity === 'error').length
  return {
    tasks, problems,
    counts: { tasks: tasks.length, errors, warnings: problems.filter(p => p.severity === 'warn').length },
    filesChecked,
    // Said out loud: without the checkout, "no overlap problems" means "not looked for".
    note: filesChecked ? null : 'the checkout was not available, so file scopes and parallel-overlap conflicts were NOT checked',
    ok: errors === 0,
  }
}
