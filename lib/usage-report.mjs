// Usage reporting rollups: cache hit rate (038), cost by project+branch (032),
// subagent dispatch attribution (033), anonymised export + CSV (039).
//
// Pure functions only — no fs, no network, no mutation of the caller's data.
// Pricing is NEVER re-derived here: every dollar figure either comes from
// `entryCost` in lib/pricing.mjs or from a cost field the collector already
// produced with `entryCost`. A second price table is a second source of truth.
import { entryCost, isPriced } from './pricing.mjs'

export { csvField, toCsv, CSV_EOL } from './csv.mjs'
import { csvField } from './csv.mjs'

const isObj = v => v != null && typeof v === 'object'
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
// null (not 0) when a field is absent: an unrecorded token count is unknown,
// and 0 would claim we know it was zero.
const numOrNull = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = v => (typeof v === 'string' ? v : null)
const arr = v => (Array.isArray(v) ? v : [])

// ---------------------------------------------------------------- 038: cache hit rate

const ZERO_RATE = { rate: null, read: 0, creation: 0, input: 0, denominator: 0, turns: 0 }

const foldEntry = (acc, e) => {
  acc.read += num(e.cr)
  acc.creation += num(e.cc)
  acc.input += num(e.in)
  acc.turns++
}

const finishRate = acc => {
  const denominator = acc.read + acc.creation + acc.input
  return {
    rate: denominator > 0 ? acc.read / denominator : null,
    read: acc.read,
    creation: acc.creation,
    input: acc.input,
    denominator,
    turns: acc.turns,
  }
}

/**
 * cache_read / (cache_read + cache_creation + input), at per-turn and per-session scope.
 *
 * `rate` is null — never 0 — when the denominator is 0. A session that moved no
 * tokens has no hit rate; reporting 0% would read as "the cache never helped".
 */
export function cacheHitRate(entries) {
  const list = arr(entries)
  const session = { read: 0, creation: 0, input: 0, turns: 0 }
  const turns = []
  let malformed = 0
  for (let i = 0; i < list.length; i++) {
    const e = list[i]
    if (!isObj(e)) { malformed++; continue }
    const one = { read: 0, creation: 0, input: 0, turns: 0 }
    foldEntry(one, e)
    foldEntry(session, e)
    const { rate, read, creation, input, denominator } = finishRate(one)
    turns.push({ index: i, t: numOrNull(e.t) ?? str(e.t), model: str(e.model), rate, read, creation, input, denominator })
  }
  return { session: finishRate(session), turns, malformed }
}

/** Convenience: the session-scope rate only (null when there is nothing to divide by). */
export const sessionCacheHitRate = entries => cacheHitRate(entries).session.rate

// ---------------------------------------------------------------- 032: cost by project + branch

export const NO_BRANCH_LABEL = '(no branch — detached HEAD or no git)'
export const NO_BRANCH_DATA_LABEL = '(branch not recorded)'
export const UNKNOWN_PROJECT_LABEL = '(unknown project)'

const emptyTokens = () => ({ in: null, out: null, cacheRead: null, cacheWrite: null, total: 0 })

const addToken = (tok, key, v) => {
  if (v == null) return false
  tok[key] = num(tok[key]) + v
  tok.total += v
  return true
}

// A branch record from the collector carries {cost, out, msgs, ...}: output tokens
// are branch-attributed but input/cache tokens are only known per file. We report
// what exists and flag the rest as unknown rather than inventing zeros.
const tokensFromRecord = rec => {
  const tok = emptyTokens()
  const parts = [
    ['in', numOrNull(rec.in)],
    ['out', numOrNull(rec.out)],
    ['cacheRead', numOrNull(rec.cr ?? rec.cacheRead)],
    ['cacheWrite', numOrNull(rec.cc ?? rec.cacheWrite)],
  ]
  let known = 0
  for (const [k, v] of parts) if (addToken(tok, k, v)) known++
  return { tokens: tok, complete: known === parts.length }
}

const tokensFromEntries = list => {
  const tok = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  for (const e of list) {
    if (!isObj(e)) continue
    addToken(tok, 'in', num(e.in))
    addToken(tok, 'out', num(e.out))
    addToken(tok, 'cacheRead', num(e.cr))
    addToken(tok, 'cacheWrite', num(e.cc))
  }
  return tok
}

const mergeTokens = (into, from, complete) => {
  for (const k of ['in', 'out', 'cacheRead', 'cacheWrite']) {
    if (from[k] == null) continue
    into[k] = num(into[k]) + from[k]
  }
  into.total += num(from.total)
  return complete
}

const branchLabel = branch => (branch == null ? NO_BRANCH_DATA_LABEL : branch === '' ? NO_BRANCH_LABEL : branch)

/**
 * Two-level cost/token/message rollup: project → branch.
 *
 * An empty branch name is a real observation (detached HEAD, or a directory with
 * no git at all). It survives as its own labelled row — it is never dropped and
 * never relabelled 'main'. A file with no branches map at all is a *different*
 * unknown and gets its own `branch: null` row.
 */
export function costByProjectBranch(files) {
  const list = arr(files)
  const projects = new Map()
  let malformed = 0
  const unpriced = new Set()

  const projectOf = key => {
    let p = projects.get(key)
    if (!p) {
      p = {
        proj: key,
        label: key == null || key === '' ? UNKNOWN_PROJECT_LABEL : key,
        cost: 0, msgs: 0, files: 0,
        tokens: emptyTokens(),
        tokensComplete: true,
        branchMap: new Map(),
      }
      projects.set(key, p)
    }
    return p
  }

  const branchOf = (p, branch) => {
    const key = branch == null ? '\u0000null' : `b:${branch}`
    let b = p.branchMap.get(key)
    if (!b) {
      b = {
        branch,
        label: branchLabel(branch),
        branchKnown: branch != null && branch !== '',
        cost: 0, msgs: 0, files: 0,
        tokens: emptyTokens(),
        tokensComplete: true,
        first: null, last: null,
      }
      p.branchMap.set(key, b)
    }
    return b
  }

  for (const f of list) {
    if (!isObj(f)) { malformed++; continue }
    const p = projectOf(str(f.proj) ?? str(f.project) ?? null)
    p.files++
    const branches = isObj(f.branches) ? f.branches : null
    const keys = branches ? Object.keys(branches) : []
    if (!keys.length) {
      // No branch information for this file: record it honestly as its own row.
      const b = branchOf(p, null)
      const { tokens, complete } = tokensFromRecord(f)
      b.files++
      b.cost += num(f.cost)
      b.msgs += num(f.msgs)
      b.tokensComplete = mergeTokens(b.tokens, tokens, complete) && b.tokensComplete
      if (numOrNull(f.first)) b.first = b.first == null ? f.first : Math.min(b.first, f.first)
      if (numOrNull(f.last)) b.last = b.last == null ? f.last : Math.max(b.last, f.last)
      continue
    }
    for (const key of keys) {
      const rec = branches[key]
      if (!isObj(rec)) { malformed++; continue }
      const b = branchOf(p, key)
      b.files++
      let cost, tokens, complete, msgs
      if (Array.isArray(rec.entries)) {
        // Richer shape: cost straight from the shared pricing path.
        cost = 0
        for (const e of rec.entries) {
          if (!isObj(e)) { malformed++; continue }
          try { cost += num(entryCost(e)) } catch { malformed++ }
          if (str(e.model) && !isPriced(e.model)) unpriced.add(e.model)
        }
        tokens = tokensFromEntries(rec.entries)
        complete = true
        msgs = numOrNull(rec.msgs) ?? rec.entries.filter(isObj).length
      } else {
        cost = num(rec.cost)
        const t = tokensFromRecord(rec)
        tokens = t.tokens
        complete = t.complete
        msgs = num(rec.msgs)
      }
      b.cost += cost
      b.msgs += msgs
      b.tokensComplete = mergeTokens(b.tokens, tokens, complete) && b.tokensComplete
      if (numOrNull(rec.first)) b.first = b.first == null ? rec.first : Math.min(b.first, rec.first)
      if (numOrNull(rec.last)) b.last = b.last == null ? rec.last : Math.max(b.last, rec.last)
    }
  }

  const out = []
  const totals = { cost: 0, msgs: 0, tokens: emptyTokens(), tokensComplete: true, projects: 0, branches: 0, files: 0 }
  for (const p of projects.values()) {
    const branches = [...p.branchMap.values()].sort((a, b) => b.cost - a.cost || String(a.label).localeCompare(String(b.label)))
    delete p.branchMap
    for (const b of branches) {
      p.cost += b.cost
      p.msgs += b.msgs
      p.tokensComplete = mergeTokens(p.tokens, b.tokens, b.tokensComplete) && p.tokensComplete
    }
    p.branches = branches
    out.push(p)
    totals.cost += p.cost
    totals.msgs += p.msgs
    totals.files += p.files
    totals.branches += branches.length
    totals.tokensComplete = mergeTokens(totals.tokens, p.tokens, p.tokensComplete) && totals.tokensComplete
  }
  out.sort((a, b) => b.cost - a.cost || String(a.label).localeCompare(String(b.label)))
  totals.projects = out.length
  return { projects: out, totals, unpricedModels: [...unpriced].sort(), malformed }
}

// ---------------------------------------------------------------- 033: subagent dispatch attribution

export const AUTO_COMPACT_PREFIX = 'acompact'
export const UNKNOWN_AGENT_TYPE_LABEL = '(unknown agent type)'

const segments = p => (typeof p === 'string' ? p.split(/[\\/]+/) : [])
const inSubagentsPath = p => segments(p).includes('subagents')

const baseName = p => {
  const segs = segments(p)
  const last = segs[segs.length - 1]
  return last ? last.replace(/\.jsonl$/i, '') : null
}

// Ids look like uuids / long hex / timestamps; the human-meaningful part is what's left.
const ID_LIKE = /^(?:[0-9a-f]{8,}|[0-9a-f-]{16,}|\d{6,})$/i

const typeFromName = name => {
  if (!name) return null
  const stripped = name.replace(/^agent-/i, '')
  const parts = stripped.split('-').filter(Boolean)
  while (parts.length > 1 && ID_LIKE.test(parts[parts.length - 1])) parts.pop()
  if (parts.length === 1 && ID_LIKE.test(parts[0])) return null
  const t = parts.join('-')
  return t || null
}

const isAutoCompact = (...candidates) => candidates.some(
  c => typeof c === 'string' && c.toLowerCase().replace(/^agent-/, '').startsWith(AUTO_COMPACT_PREFIX),
)

/**
 * Which subagent TYPE costs the most.
 *
 * Detection: `isSidechain`, a non-empty `agentId`, an `isAgent` flag, or a
 * `/subagents/` path segment. Auto-compaction runs (`acompact-*`) are machine
 * overhead, not dispatched delegation — they are bucketed separately and are
 * excluded from `types` and from `totals.dispatchedCost`.
 *
 * Entries and files are reconciled by object identity (a file's `entries` array
 * holds the same objects as the global list), so nothing is counted twice.
 */
export function subagentUsage(entries, files) {
  const entryList = arr(entries)
  const fileList = arr(files)
  let malformed = 0

  const fileOfEntry = new Map()
  for (const f of fileList) {
    if (!isObj(f)) { malformed++; continue }
    for (const e of arr(f.entries)) if (isObj(e)) if (!fileOfEntry.has(e)) fileOfEntry.set(e, f)
  }

  const detection = { byIsSidechain: 0, byAgentId: 0, byPath: 0, byFileFlag: 0, subagentEntries: 0, subagentFiles: 0 }
  const buckets = new Map()
  const auto = { type: AUTO_COMPACT_PREFIX, label: 'auto-compaction', cost: 0, msgs: 0, tokens: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, sessions: 0, sessionSet: new Set() }
  const main = { cost: 0, msgs: 0, tokens: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
  const unpriced = new Set()
  const coveredFiles = new Set()

  const bucketOf = type => {
    const key = type == null ? '\u0000unknown' : type
    let b = buckets.get(key)
    if (!b) {
      b = {
        type,
        label: type == null ? UNKNOWN_AGENT_TYPE_LABEL : type,
        cost: 0, msgs: 0,
        tokens: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        sessions: 0, sessionSet: new Set(),
      }
      buckets.set(key, b)
    }
    return b
  }

  const credit = (bucket, { cost, msgs, tokens, session }) => {
    bucket.cost += cost
    bucket.msgs += msgs
    for (const k of ['in', 'out', 'cacheRead', 'cacheWrite', 'total']) bucket.tokens[k] += num(tokens[k])
    if (session != null) bucket.sessionSet.add(session)
  }

  for (const e of entryList) {
    if (!isObj(e)) { malformed++; continue }
    const f = fileOfEntry.get(e) ?? null
    const path = str(e.path) ?? str(e.file) ?? (f ? str(f.path) : null)
    const sidechain = e.isSidechain === true
    const agentId = str(e.agentId) || null
    const viaPath = inSubagentsPath(path)
    const viaFlag = (f && f.isAgent === true) || e.isAgent === true
    const isSub = sidechain || !!agentId || viaPath || !!viaFlag
    let cost = 0
    try { cost = num(entryCost(e)) } catch { malformed++ }
    if (str(e.model) && !isPriced(e.model)) unpriced.add(e.model)
    const tokens = tokensFromEntries([e])
    if (f) coveredFiles.add(f)
    if (!isSub) {
      main.cost += cost
      main.msgs++
      for (const k of ['in', 'out', 'cacheRead', 'cacheWrite', 'total']) main.tokens[k] += num(tokens[k])
      continue
    }
    detection.subagentEntries++
    if (sidechain) detection.byIsSidechain++
    if (agentId) detection.byAgentId++
    if (viaPath) detection.byPath++
    if (viaFlag) detection.byFileFlag++
    const name = baseName(path)
    const type = str(e.agentType) || (f ? str(f.agentType) : null) || typeFromName(name) || typeFromName(agentId)
    const session = path || (f ? f.path : null) || agentId
    const payload = { cost, msgs: 1, tokens, session }
    if (isAutoCompact(type, name, agentId)) credit(auto, payload)
    else credit(bucketOf(type), payload)
  }

  // Files whose entries never appeared in the entries list still hold real spend.
  for (const f of fileList) {
    if (!isObj(f) || coveredFiles.has(f)) continue
    const path = str(f.path)
    const isSub = f.isAgent === true || inSubagentsPath(path)
    if (!isSub) continue
    detection.subagentFiles++
    if (f.isAgent === true) detection.byFileFlag++
    if (inSubagentsPath(path)) detection.byPath++
    const name = baseName(path)
    const type = str(f.agentType) || typeFromName(name)
    const { tokens } = tokensFromRecord(f)
    const payload = {
      // f.cost was produced by the collector with entryCost — reused, not recomputed.
      cost: num(f.cost) - num(f.subagentCost),
      msgs: num(f.msgs),
      tokens: { in: num(tokens.in), out: num(tokens.out), cacheRead: num(tokens.cacheRead), cacheWrite: num(tokens.cacheWrite), total: num(tokens.total) },
      session: path,
    }
    if (isAutoCompact(type, name)) credit(auto, payload)
    else credit(bucketOf(type), payload)
  }

  const types = [...buckets.values()].map(b => {
    b.sessions = b.sessionSet.size
    delete b.sessionSet
    return b
  }).sort((a, b) => b.cost - a.cost || String(a.label).localeCompare(String(b.label)))
  auto.sessions = auto.sessionSet.size
  delete auto.sessionSet

  const dispatchedCost = types.reduce((s, b) => s + b.cost, 0)
  return {
    types,
    autoCompaction: auto,
    mainChain: main,
    totals: {
      dispatchedCost,
      dispatchedMsgs: types.reduce((s, b) => s + b.msgs, 0),
      autoCompactionCost: auto.cost,
      subagentCost: dispatchedCost + auto.cost,
      mainChainCost: main.cost,
      types: types.length,
    },
    detection,
    unpricedModels: [...unpriced].sort(),
    malformed,
  }
}

// ---------------------------------------------------------------- 039: anonymised export + CSV

export const ANON_METHOD = 'sequential-labels'

// Fields that can carry a repo name, a filesystem path, a branch name or prompt text.
export const IDENTIFYING_FIELDS = {
  project: ['proj', 'project', 'projectPath', 'cwd', 'dir', 'repo', 'repoName'],
  branch: ['branch', 'gitBranch', 'branchLabel'],
  path: ['path', 'file', 'filePath', 'transcript', 'sessionPath'],
  text: ['prompt', 'name', 'sessionName', 'title', 'summary', 'text', 'message', 'label', 'firstPrompt'],
}

/**
 * Anonymise usage rows for sharing.
 *
 * Method: sequential labels (`project-1`, `branch-2`, …) assigned in first-seen
 * order *within this call*. No hash of the original value is emitted — not even a
 * salted one — so the output carries zero information about the path, repo or
 * branch it replaced and cannot be reversed or dictionary-attacked. The label
 * assignment lives only in this function's local scope and is never returned, so
 * re-running the export on different data reshuffles the labels.
 *
 * Free-text fields (prompts, session names) are dropped entirely rather than
 * labelled — their length and shape alone are identifying.
 *
 * No paging, no cap: every row handed in comes back out. `rowCount` /
 * `droppedRows` say so explicitly.
 */
export function anonymiseUsage(rows, opts = {}) {
  const o = isObj(opts) ? opts : {}
  const list = arr(rows)
  const enabled = o.anonymise !== false
  const extra = arr(o.extraFields).filter(f => typeof f === 'string')
  const keep = new Set(arr(o.keepFields).filter(f => typeof f === 'string'))

  const counters = new Map()
  const labels = new Map()
  const labelFor = (kind, value) => {
    const key = `${kind}\u0000${value}`
    if (labels.has(key)) return labels.get(key)
    const n = (counters.get(kind) || 0) + 1
    counters.set(kind, n)
    const label = `${kind}-${n}`
    labels.set(key, label)
    return label
  }

  const kindOf = field => {
    if (IDENTIFYING_FIELDS.project.includes(field)) return 'project'
    if (IDENTIFYING_FIELDS.branch.includes(field)) return 'branch'
    if (IDENTIFYING_FIELDS.path.includes(field)) return 'path'
    if (IDENTIFYING_FIELDS.text.includes(field) || extra.includes(field)) return 'text'
    return null
  }

  const redacted = { project: 0, branch: 0, path: 0, text: 0 }
  const fieldsSeen = new Set()
  const out = []
  let malformed = 0

  for (const row of list) {
    if (!isObj(row) || Array.isArray(row)) { malformed++; continue }
    const copy = {}
    for (const [k, v] of Object.entries(row)) {
      if (!enabled || keep.has(k)) { copy[k] = v; continue }
      const kind = kindOf(k)
      if (kind == null) { copy[k] = v; continue }
      fieldsSeen.add(k)
      redacted[kind]++
      if (kind === 'text') { copy[k] = null; continue }
      if (v == null) { copy[k] = null; continue }
      const s = String(v)
      // An empty branch is a real, non-identifying value — keep the distinction.
      copy[k] = s === '' ? '' : labelFor(kind, s)
    }
    out.push(copy)
  }

  return {
    rows: out,
    anonymised: enabled,
    method: enabled ? ANON_METHOD : 'none',
    reversible: false,
    hashEmitted: false,
    salted: false,
    note: enabled
      ? 'Sequential per-export labels; no hash of the original value is emitted and the label map is not returned, so the output cannot be reversed to a path, repo or branch name. Free-text fields are dropped, not labelled.'
      : 'Anonymisation disabled by opts.anonymise === false; rows are passed through unchanged.',
    redacted,
    redactedFields: [...fieldsSeen].sort(),
    distinct: { project: counters.get('project') || 0, branch: counters.get('branch') || 0, path: counters.get('path') || 0 },
    rowCount: out.length,
    inputRowCount: list.length,
    droppedRows: malformed,
    truncated: false,
    malformed,
  }
}


// RFC 4180: a field containing a quote, comma, CR or LF is quoted, and each
// embedded quote is doubled. Leading/trailing spaces are quoted too so that
// round-tripping through a trimming parser does not silently alter the value.

