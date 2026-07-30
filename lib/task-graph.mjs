// Ready / blocked partition over real JIRA issue links.
//
// The issue links are already fetched on every snapshot (`computeIssue` builds `links` from
// `fields.issuelinks`) and were, until now, consumed nowhere. So this needs no new frontmatter
// convention and no self-reported state: the dependency edges are the ones a human actually
// entered in JIRA, and the blocker's status is the one JIRA reports.
//
// The whole value of this view is that it tells someone what they can start right now. That makes
// exactly one failure mode unacceptable: calling something ready when it is not. Two things fall
// out of that.
//
//   · A blocker outside the fetched set is UNKNOWN, not met. A JQL query scopes to one project
//     and one window, so cross-project and older blockers routinely fall outside it. Treating an
//     unfetched blocker as done would send someone to work on a task that is genuinely blocked —
//     which is the one thing this view must never do. They get their own bucket.
//   · A dependency cycle is reported as a cycle. Every task in one is blocked, but "blocked" reads
//     as "wait for the blocker", and a cycle never resolves on its own — somebody has to break it.
//
// Nothing here infers a dependency from prose. If the link is not in JIRA, it does not exist.

/**
 * JIRA link relationship phrases, as they arrive on `link.rel` — the human-readable half of the
 * link type ("is blocked by", "blocks"). Matched on the phrase rather than the type name because
 * the same type name carries opposite meanings on its two sides.
 */
const DEPENDS_ON = /\b(is blocked by|blocked by|depends on|is caused by)\b/i
const BLOCKS = /^\s*(blocks|causes)\b/i

/** Link relationships that are explicitly NOT dependencies, kept apart so they can be reported. */
const NON_BLOCKING = /\b(relates to|is related to|duplicates|is duplicated by|clones|is cloned by)\b/i

/**
 * Dependency edges for one issue: which keys it waits on.
 * Returns `{ dependsOn: string[], ignored: {key, rel}[] }` — ignored is reported rather than
 * dropped, so "this ticket has 4 links and no dependencies" is distinguishable from a parse miss.
 */
export function dependenciesOf(issue) {
  const dependsOn = [], ignored = [], unclassified = []
  for (const l of issue?.links || []) {
    if (!l || typeof l.key !== 'string' || !l.key) continue
    const rel = String(l.rel || '')
    if (DEPENDS_ON.test(rel)) dependsOn.push(l.key)
    else if (BLOCKS.test(rel)) continue                   // the other side depends on us, not us on it
    else if (NON_BLOCKING.test(rel)) ignored.push({ key: l.key, rel })
    else unclassified.push({ key: l.key, rel })           // a custom link type this install added
  }
  return { dependsOn: [...new Set(dependsOn)], ignored, unclassified }
}

const isDone = i => i?.statusKind === 'done'
const isOpen = i => i && i.statusKind !== 'done'

/**
 * Find dependency cycles among the given keys.
 * Iterative DFS — a deep chain must not blow the stack on a real backlog.
 */
export function findCycles(depsByKey) {
  const cycles = [], colour = new Map()   // 0 unvisited, 1 on stack, 2 done
  for (const root of depsByKey.keys()) {
    if (colour.get(root)) continue
    const stack = [[root, 0]], onPath = []
    while (stack.length) {
      const frame = stack[stack.length - 1]
      const [key, i] = frame
      if (i === 0) {
        if (colour.get(key) === 2) { stack.pop(); continue }
        colour.set(key, 1)
        onPath.push(key)
      }
      const deps = depsByKey.get(key) || []
      if (i >= deps.length) {
        colour.set(key, 2)
        onPath.pop()
        stack.pop()
        continue
      }
      frame[1]++
      const next = deps[i]
      if (!depsByKey.has(next)) continue              // outside the set — not a cycle we can see
      if (colour.get(next) === 1) {
        const at = onPath.indexOf(next)
        if (at >= 0) cycles.push(onPath.slice(at).concat(next))
        continue
      }
      if (colour.get(next) === 2) continue
      stack.push([next, 0])
    }
  }
  // A cycle is found once per entry point; dedupe on its member set so it is reported once.
  const seen = new Set(), out = []
  for (const c of cycles) {
    const sig = [...new Set(c)].sort().join('>')
    if (seen.has(sig)) continue
    seen.add(sig)
    out.push(c)
  }
  return out
}

/**
 * Partition open issues into what can be started now and what cannot.
 *
 * @param {Array} issues  issues as `computeIssue` builds them (need `key`, `statusKind`, `links`)
 * @returns {{ready, blocked, unknown, cycles, counts, note}}
 */
export function partitionByReadiness(issues) {
  const list = Array.isArray(issues) ? issues.filter(i => i && typeof i.key === 'string') : []
  const byKey = new Map(list.map(i => [i.key, i]))
  const depsByKey = new Map()
  const meta = new Map()
  for (const i of list) {
    const d = dependenciesOf(i)
    depsByKey.set(i.key, d.dependsOn)
    meta.set(i.key, d)
  }

  const cycles = findCycles(depsByKey)
  const inCycle = new Set(cycles.flat())

  const ready = [], blocked = [], unknown = []
  for (const i of list) {
    if (!isOpen(i)) continue
    const { dependsOn, unclassified } = meta.get(i.key)
    const unmet = [], unresolved = []
    for (const key of dependsOn) {
      const dep = byKey.get(key)
      // Not in the fetched set: we do not know whether it is done. Saying "ready" here is the
      // one wrong answer this view can give.
      if (!dep) { unresolved.push(key); continue }
      if (!isDone(dep)) unmet.push({ key, status: dep.status || null, statusKind: dep.statusKind || null, summary: dep.summary || null })
    }
    const entry = {
      key: i.key, summary: i.summary || null, status: i.status || null, assignee: i.assignee || null,
      url: i.url || null, type: i.type || null, unmet, unresolved,
      // A custom link type nobody classified is surfaced on the row rather than dropped, because
      // it may well be a dependency this install spells differently.
      unclassifiedLinks: unclassified,
      cycle: inCycle.has(i.key) ? (cycles.find(c => c.includes(i.key)) || null) : null,
    }
    if (unmet.length) blocked.push(entry)
    else if (unresolved.length) unknown.push(entry)
    else ready.push(entry)
  }

  const notes = []
  if (unknown.length) notes.push(`${unknown.length} issue(s) depend on keys outside the fetched set — their readiness is unknown, not ready`)
  if (cycles.length) notes.push(`${cycles.length} dependency cycle(s) — these never unblock on their own`)
  const unclassifiedTotal = [...meta.values()].reduce((n, m) => n + m.unclassified.length, 0)
  if (unclassifiedTotal) notes.push(`${unclassifiedTotal} link(s) use a relationship this build does not classify — shown on the row so they are not mistaken for "no dependencies"`)

  return {
    ready: ready.sort((a, b) => a.key.localeCompare(b.key)),
    blocked: blocked.sort((a, b) => b.unmet.length - a.unmet.length || a.key.localeCompare(b.key)),
    unknown: unknown.sort((a, b) => a.key.localeCompare(b.key)),
    cycles,
    counts: {
      total: list.length,
      open: list.filter(isOpen).length,
      ready: ready.length,
      blocked: blocked.length,
      unknown: unknown.length,
      withDependencies: [...meta.values()].filter(m => m.dependsOn.length).length,
      unclassifiedLinks: unclassifiedTotal,
    },
    note: notes.length ? notes.join('; ') : null,
  }
}

/**
 * What each finished task would unblock — the argument for doing one blocker before another.
 * Counts only the issues whose LAST unmet dependency is this key, since clearing one of three
 * blockers unblocks nothing.
 */
export function unblockImpact(issues) {
  const p = partitionByReadiness(issues)
  const impact = new Map()
  for (const b of p.blocked) {
    if (b.unmet.length !== 1) continue
    const k = b.unmet[0].key
    if (!impact.has(k)) impact.set(k, [])
    impact.get(k).push(b.key)
  }
  return [...impact.entries()]
    .map(([key, unblocks]) => ({ key, unblocks, count: unblocks.length }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}
