// G4 domain/expertise map. Computes which code AREAS (top-level dirs) you own, and your bus-factor
// per area, from `git log --name-only` over your owned repos. Import-time only (git spawn — never on refresh).
// Pure parser (`parseGitLog`) + a thin runner (`computeDomain`) so the aggregation is unit-testable.
import { spawnSync } from 'node:child_process'

const MARK = '\x01'   // commit-header sentinel; file paths never contain it (unlike a bare 'C' prefix)
const KEYSTONE_MIN_COMMITS = 10   // don't crown a 1-commit dir; a keystone needs a real footprint
const KEYSTONE_SHARE = 0.8        // you authored ≥80% of the area's file-touches → you're the keystone

const areaOf = f => { const s = String(f).split('/'); return s.length > 1 ? s[0] : '(root)' }

// Parse `git log --name-only --pretty=format:\x01%ae` output → per-area { mine, total } file-touch counts.
export function parseGitLog(text = '', myEmails = []) {
  const me = new Set(myEmails.map(e => String(e).toLowerCase()))
  const areas = {}
  let mine = false
  for (const line of text.split('\n')) {
    if (line[0] === MARK) { mine = me.has(line.slice(1).trim().toLowerCase()); continue }
    const f = line.trim()
    if (!f) continue
    const a = (areas[areaOf(f)] ||= { mine: 0, total: 0 })
    a.total++; if (mine) a.mine++
  }
  return areas
}

// Shape the parsed areas into a ranked map + your keystone areas (high ownership over a real sample).
export function shapeDomain(areas = {}) {
  const rows = Object.entries(areas).map(([area, v]) => ({
    area, mine: v.mine, total: v.total, ownership: v.total ? v.mine / v.total : 0,
  })).filter(r => r.mine > 0).sort((a, b) => b.mine - a.mine)
  const keystones = rows.filter(r => r.mine >= KEYSTONE_MIN_COMMITS && r.ownership >= KEYSTONE_SHARE).map(r => r.area)
  return { areas: rows, keystones }
}

// Runner: `git log` per owned repo path, merged, then shaped. Quarantined per repo — a bad path is skipped.
export function computeDomain(repoPaths = [], myEmails = [], spawn = spawnSync, since = '1 year ago') {
  const merged = {}
  for (const repo of repoPaths) {
    try {
      const r = spawn('git', ['-C', repo, 'log', `--since=${since}`, '--name-only', `--pretty=format:${MARK}%ae`],
        { timeout: 20000, maxBuffer: 64 * 1024 * 1024 })
      if (r.status !== 0) continue
      const areas = parseGitLog(r.stdout.toString(), myEmails)
      for (const [a, v] of Object.entries(areas)) { const m = (merged[a] ||= { mine: 0, total: 0 }); m.mine += v.mine; m.total += v.total }
    } catch {}
  }
  return shapeDomain(merged)
}
