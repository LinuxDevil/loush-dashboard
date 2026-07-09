// Blame is computed ONCE at import time (spec §2.4 perf: no subprocess on snapshot refresh).
// Produces a pure { bugId -> introducingAuthorEmail } map the snapshot consumes as data.
// Degrades to {} for any bug that lacks fixed-line locations or whose blame fails — never throws.
import { spawnSync } from 'node:child_process'

// bug.fixedLines = [{ repo, file, line }] — the lines the fix touched. Blame each to find who introduced it.
export function blameMapForBugs(bugs = [], spawn = spawnSync) {
  const out = {}
  const memo = new Map()   // `${repo}:${file}:${line}` -> email, so re-fixed lines don't re-spawn
  for (const b of bugs) {
    const lines = b.fixedLines || []
    if (!b.id || !lines.length) continue
    for (const { repo, file, line } of lines) {
      if (!repo || !file || !line) continue
      const key = `${repo}:${file}:${line}`
      let email = memo.get(key)
      if (email === undefined) {
        email = blameLine(repo, file, line, spawn)
        memo.set(key, email)
      }
      if (email) { out[b.id] = email; break }   // first resolvable introducing author wins
    }
  }
  return out
}

function blameLine(repo, file, line, spawn) {
  try {
    const r = spawn('git', ['-C', repo, 'blame', '-L', `${line},${line}`, '--porcelain', '--', file], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 })
    if (r.status !== 0) return null
    const m = /^author-mail <([^>]+)>/m.exec(r.stdout.toString())
    return m ? m[1].toLowerCase() : null
  } catch { return null }
}
