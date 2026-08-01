// lib/contracts.mjs — a DECLARED contract for the external file shapes this dashboard depends on,
// checked against the real files on this disk.
//
// WHY THIS EXISTS
// Every field this app reads out of Claude Code's own files is read defensively: `o.message?.usage
// ?.input_tokens || 0`, `readJson(CLAUDE_JSON, {})`, `try { ... } catch {}`. That is correct error
// handling and a terrible early-warning system. When Anthropic renames `cache_read_input_tokens`,
// nothing throws — the cost panel reads 0, the "you saved 94% on cache" headline reads 100%, and the
// dashboard reports a *number* instead of a *problem*. The whole point of this module is to make a
// format change loud instead of arithmetic.
//
// THREE FAILURE MODES IT IS BUILT TO PREVENT
//
// 1. THE VACUOUS PASS. A boot check that finds zero sample files and prints "contract satisfied" is
//    strictly worse than no check: it manufactures confidence out of nothing. Zero samples is
//    `could-not-check`, never `ok`. `ok` is a tri-state (true / false / null) precisely so that
//    "unknown" cannot be spelled the same way as "fine".
//
// 2. THE ONE-SAMPLE ACCUSATION. `toolUseResult` is absent from 39% of user records on this machine —
//    because only tool results carry it, not because it was removed. A field missing from a sample
//    is not proof of removal. So every verdict carries `presentIn / applicableSamples`, and a
//    declared-optional field being absent is reported as `absent-optional`, not as drift.
//
// 3. THE SHALLOW GLOB. `~/.claude/projects/*/*.jsonl` finds 1 file on this machine.
//    `~/.claude/projects/**/*.jsonl` finds 29 — the other 28 are subagent transcripts nested under
//    `<session-id>/subagents/`. A contract check that samples 1 of 30 files and reports "checked"
//    is lying by omission, so `findTranscripts` recurses and reports how deep it went.
//
// Nothing here throws. A malformed sample is counted as malformed and carries on; that is a
// *finding*, not a crash.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// ---------------------------------------------------------------------------
// Bounds. Declared here, always reported in `report.bounds`, never applied silently.
// A truncated scan that reports "checked 30 files" when it stopped at 12 is the same class of lie
// as the shallow glob, so every limit that actually bit shows up in the output with `hit: true`.
// ---------------------------------------------------------------------------
export const DEFAULT_LIMITS = {
  maxFiles: 500,        // transcript files opened
  maxRecordsPerFile: 5000,
  maxDepth: 12,         // directory recursion depth under projects/
  maxBytesPerFile: 64 * 1024 * 1024,
}

/** requirement levels for a declared field */
export const REQ = {
  ALWAYS: 'always',       // must appear in 100% of applicable samples; anything less is drift
  TYPICAL: 'typical',     // expected on most applicable samples; a floor is declared per field
  OPTIONAL: 'optional',   // may legitimately be absent everywhere — absence is never drift
}

// ---------------------------------------------------------------------------
// THE CONTRACT
//
// Declared from two sources, both real, neither assumed:
//   (a) what is ACTUALLY in the files on this machine (30 transcripts / 4,658 records observed), and
//   (b) what this repo's code ACTUALLY reads — see `readBy` on each field, which names the call
//       site. A field nobody reads is not in the contract; a field the code reads that the files
//       never contain is exactly the drift we want to hear about.
//
// `appliesTo` scopes a field to the record types it belongs to. Without it, `requestId` looks like a
// 52%-present field ("suspicious!") instead of what it is: 100% present on assistant records and
// meaningless on the other six record types.
// ---------------------------------------------------------------------------

/** Record types observed in real transcripts. Unknown types are reported, not rejected. */
export const KNOWN_RECORD_TYPES = [
  'user', 'assistant', 'system', 'attachment', 'last-prompt', 'mode', 'queue-operation',
]

const TURN_TYPES = ['user', 'assistant', 'system', 'attachment']

export const CONTRACT = {
  transcriptJsonl: {
    id: 'transcriptJsonl',
    label: 'Claude Code transcript JSONL',
    locate: 'recursive glob of ~/.claude/projects/**/*.jsonl (INCLUDING <session>/subagents/*.jsonl)',
    fields: [
      // -- envelope, every record ------------------------------------------------
      { path: 'type', appliesTo: '*', req: REQ.ALWAYS,
        readBy: ['server/index.mjs scanTranscripts', 'lib/harness-metrics.mjs'],
        note: 'record discriminator; everything else is scoped by it' },
      { path: 'sessionId', appliesTo: '*', req: REQ.ALWAYS,
        readBy: ['server/index.mjs (66 references)'],
        note: 'primary join key for every per-session metric' },

      // -- turn envelope ---------------------------------------------------------
      { path: 'uuid', appliesTo: TURN_TYPES, req: REQ.ALWAYS, readBy: ['server/index.mjs transcript threading'] },
      { path: 'parentUuid', appliesTo: TURN_TYPES, req: REQ.ALWAYS,
        readBy: ['server/index.mjs transcript threading'],
        note: 'nullable VALUE (roots have null) but the KEY must be present' },
      { path: 'timestamp', appliesTo: TURN_TYPES, req: REQ.ALWAYS,
        readBy: ['server/index.mjs windowing', 'lib/harness-usage-trends.mjs'],
        note: 'every time-windowed metric silently empties if this moves' },
      { path: 'cwd', appliesTo: TURN_TYPES, req: REQ.ALWAYS, readBy: ['server/index.mjs (39 references)'] },
      { path: 'gitBranch', appliesTo: TURN_TYPES, req: REQ.ALWAYS, readBy: ['server/index.mjs'] },
      { path: 'version', appliesTo: TURN_TYPES, req: REQ.ALWAYS, readBy: ['server/index.mjs'] },
      { path: 'isSidechain', appliesTo: TURN_TYPES, req: REQ.ALWAYS,
        readBy: ['server/index.mjs'], note: 'separates subagent turns from the main thread' },
      { path: 'userType', appliesTo: TURN_TYPES, req: REQ.ALWAYS, readBy: ['server/index.mjs'] },
      { path: 'entrypoint', appliesTo: TURN_TYPES, req: REQ.ALWAYS, readBy: ['server/index.mjs'] },

      // -- assistant -------------------------------------------------------------
      { path: 'message.model', appliesTo: ['assistant'], req: REQ.ALWAYS,
        readBy: ['server/index.mjs entryCost (41 references)'],
        note: 'the price-table key. If this renames, every cost on the dashboard becomes $0.00 — the exact failure this module exists to catch.' },
      { path: 'message.usage.input_tokens', appliesTo: ['assistant'], req: REQ.ALWAYS, readBy: ['server/index.mjs entryCost'] },
      { path: 'message.usage.output_tokens', appliesTo: ['assistant'], req: REQ.ALWAYS, readBy: ['server/index.mjs entryCost'] },
      { path: 'message.usage.cache_read_input_tokens', appliesTo: ['assistant'], req: REQ.ALWAYS, readBy: ['server/index.mjs entryCost'] },
      { path: 'message.usage.cache_creation_input_tokens', appliesTo: ['assistant'], req: REQ.ALWAYS, readBy: ['server/index.mjs entryCost'] },
      { path: 'message.content', appliesTo: ['assistant', 'user'], req: REQ.ALWAYS,
        readBy: ['server/index.mjs scanTranscripts (tool_use extraction)'],
        note: 'tool_use blocks live here; capability invocation counts come from nothing else' },
      { path: 'message.stop_reason', appliesTo: ['assistant'], req: REQ.ALWAYS, readBy: ['server/index.mjs failStats'] },
      { path: 'requestId', appliesTo: ['assistant'], req: REQ.ALWAYS, readBy: ['server/index.mjs dedupe'] },

      // -- observed on 100% here but NOT depended on: declared TYPICAL, so a drop is a notice, not an error
      { path: 'effort', appliesTo: ['assistant'], req: REQ.TYPICAL, floor: 0.5, readBy: [] },
      { path: 'message.usage.service_tier', appliesTo: ['assistant'], req: REQ.TYPICAL, floor: 0.5, readBy: [] },

      // -- user ------------------------------------------------------------------
      { path: 'promptId', appliesTo: ['user'], req: REQ.TYPICAL, floor: 0.9, readBy: ['server/index.mjs prompts'] },
      // 61% of user records on this machine. Only TOOL RESULT turns carry it. Declaring this ALWAYS
      // would fire a drift warning on a perfectly healthy install, every boot, forever — which is
      // how a drift check trains its user to ignore it.
      { path: 'toolUseResult', appliesTo: ['user'], req: REQ.OPTIONAL, readBy: ['server/index.mjs tool outcome parsing'] },
      { path: 'permissionMode', appliesTo: ['user'], req: REQ.OPTIONAL, readBy: ['server/index.mjs'] },
      { path: 'isMeta', appliesTo: ['user', 'system'], req: REQ.OPTIONAL, readBy: ['server/index.mjs filters'] },

      // -- subagent attribution (present only when subagents ran) -------------------
      { path: 'agentId', appliesTo: ['user', 'assistant'], req: REQ.OPTIONAL, readBy: ['server/index.mjs agent attribution'] },
      { path: 'slug', appliesTo: ['user', 'assistant', 'system'], req: REQ.OPTIONAL, readBy: ['server/index.mjs (9 references)'] },

      // -- system ----------------------------------------------------------------
      { path: 'subtype', appliesTo: ['system'], req: REQ.ALWAYS, readBy: ['server/index.mjs hook analysis'] },
      { path: 'level', appliesTo: ['system'], req: REQ.ALWAYS, readBy: ['server/index.mjs'] },
      { path: 'hookInfos', appliesTo: ['system'], req: REQ.OPTIONAL, readBy: ['server/index.mjs hook blast radius'] },
    ],
  },

  settingsJson: {
    id: 'settingsJson',
    label: '~/.claude/settings.json',
    locate: '~/.claude/settings.json (single file; MAY NOT EXIST — that is could-not-check, not a violation)',
    // Every one of these is optional-by-design: settings.json is a user override file and a valid
    // install has none of them, or no file at all. The contract here is about SHAPE (if `permissions`
    // exists it is an object with allow/deny arrays), not about presence.
    fields: [
      { path: 'permissions', appliesTo: '*', req: REQ.OPTIONAL, readBy: ['server/setup.mjs'] },
      { path: 'permissions.allow', appliesTo: '*', req: REQ.OPTIONAL, readBy: ['server/setup.mjs'] },
      { path: 'permissions.deny', appliesTo: '*', req: REQ.OPTIONAL, readBy: ['server/setup.mjs'] },
      { path: 'hooks', appliesTo: '*', req: REQ.OPTIONAL, readBy: ['server/index.mjs hook inventory'] },
      { path: 'env', appliesTo: '*', req: REQ.OPTIONAL, readBy: [] },
      { path: 'model', appliesTo: '*', req: REQ.OPTIONAL, readBy: [] },
      { path: 'statusLine', appliesTo: '*', req: REQ.OPTIONAL, readBy: [] },
      { path: 'enabledPlugins', appliesTo: '*', req: REQ.OPTIONAL, readBy: ['server/index.mjs plugin inventory'] },
    ],
  },

  claudeJson: {
    id: 'claudeJson',
    label: '~/.claude.json',
    locate: '~/.claude.json (single file)',
    fields: [
      { path: 'projects', appliesTo: '*', req: REQ.ALWAYS,
        readBy: ['server/index.mjs hubResolve (per-project mcpServers)'],
        note: 'the per-project config map; hubResolve reads projects[dir].mcpServers off it' },
      { path: 'oauthAccount', appliesTo: '*', req: REQ.TYPICAL, floor: 1,
        readBy: [], note: 'presence identifies the logged-in account; used to scope per-user metrics' },
      { path: 'oauthAccount.accountUuid', appliesTo: '*', req: REQ.TYPICAL, floor: 1,
        readBy: ['lib/context-reduction.mjs (per-user scoping)'],
        note: 'the ONLY stable per-user id on disk. Without it a "per-user" metric is a per-machine metric wearing a hat.' },
      { path: 'firstStartTime', appliesTo: '*', req: REQ.TYPICAL, floor: 1,
        readBy: ['lib/repo-complexity.mjs (observation-window floor)'],
        note: 'lower bound on how long anything could possibly have been recorded — the audit needs it to avoid calling a capability unused over a window that predates the install' },
      { path: 'skillUsage', appliesTo: '*', req: REQ.OPTIONAL,
        readBy: ['lib/repo-complexity.mjs (invocation evidence)'],
        note: 'map of skill -> {usageCount,lastUsedAt}. OPTIONAL and INCOMPLETE by construction: it holds only skills that HAVE fired, so its absence for a skill is not evidence of non-use.' },
      { path: 'mcpServers', appliesTo: '*', req: REQ.OPTIONAL, readBy: ['server/index.mjs hubResolve'] },
      { path: 'userID', appliesTo: '*', req: REQ.TYPICAL, floor: 1, readBy: [] },
    ],
  },
}

// ---------------------------------------------------------------------------
// helpers — none of them throw
// ---------------------------------------------------------------------------

/** Does `obj` structurally contain the dotted path? Presence of the KEY, not truthiness of the
 *  value: `parentUuid: null` on a root turn is PRESENT. Conflating the two would report every
 *  thread root as a contract violation. */
export function hasPath(obj, dotted) {
  let cur = obj
  for (const seg of String(dotted).split('.')) {
    if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) return false
    if (!Object.prototype.hasOwnProperty.call(cur, seg)) return false
    cur = cur[seg]
  }
  return true
}

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const applies = (field, recType) => field.appliesTo === '*' || (Array.isArray(field.appliesTo) && field.appliesTo.includes(recType))

// ---------------------------------------------------------------------------
// Recursive transcript discovery.
//
// Returns files AND the shallow count, so a caller can SEE the difference the recursion made rather
// than take it on faith. On this machine that is 29 vs 1.
// ---------------------------------------------------------------------------
export function findTranscripts(projectsDir, limits = {}) {
  const L = { ...DEFAULT_LIMITS, ...limits }
  const out = [], bounds = []
  let dirsSeen = 0, maxDepthSeen = 0, deniedDirs = 0, depthHit = false, filesHit = false

  const walk = (dir, depth) => {
    if (depth > L.maxDepth) { depthHit = true; return }
    if (out.length >= L.maxFiles) { filesHit = true; return }
    let entries
    // A single unreadable directory (permissions, a race with a session writing) must not abort the
    // whole scan and must not be invisible — it is counted and surfaced as a bound.
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { deniedDirs++; return }
    dirsSeen++
    maxDepthSeen = Math.max(maxDepthSeen, depth)
    // Sort so the sample set is deterministic across runs and across filesystems.
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full, depth + 1)
      else if (e.isFile() && e.name.endsWith('.jsonl')) {
        if (out.length >= L.maxFiles) { filesHit = true; return }
        out.push(full)
      }
    }
  }

  let rootExists = false
  try { rootExists = fs.statSync(projectsDir).isDirectory() } catch { rootExists = false }
  if (rootExists) walk(projectsDir, 0)

  let shallowCount = 0
  try {
    for (const e of fs.readdirSync(projectsDir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      try {
        for (const f of fs.readdirSync(path.join(projectsDir, e.name))) if (f.endsWith('.jsonl')) shallowCount++
      } catch { /* counted via deniedDirs in the real walk */ }
    }
  } catch { shallowCount = 0 }

  if (filesHit) bounds.push({ what: 'transcript files opened', limit: L.maxFiles, hit: true, note: 'more transcripts exist than were sampled; results describe the sampled subset only' })
  if (depthHit) bounds.push({ what: 'directory recursion depth', limit: L.maxDepth, hit: true, note: 'directories deeper than the limit were not scanned' })
  if (deniedDirs) bounds.push({ what: 'unreadable directories', limit: null, hit: true, count: deniedDirs, note: 'skipped; their transcripts are not represented in the sample' })

  return {
    root: projectsDir, rootExists, files: out,
    shallowGlobWouldFind: shallowCount,
    missedByShallowGlob: Math.max(0, out.length - shallowCount),
    dirsScanned: dirsSeen, maxDepthSeen, deniedDirs, bounds,
  }
}

// ---------------------------------------------------------------------------
// Verdict for one field, from raw tallies. Pure; this is where the honesty rules actually live.
// ---------------------------------------------------------------------------
function verdictFor(field, applicableSamples, presentIn) {
  const readBy = field.readBy || []
  const base = {
    path: field.path, requirement: field.req,
    appliesTo: field.appliesTo === '*' ? 'all records' : field.appliesTo,
    applicableSamples, presentIn,
    presentPct: applicableSamples > 0 ? presentIn / applicableSamples : null,
    readBy, note: field.note || null,
  }

  // No applicable sample means we learned NOTHING about this field. Not "absent". Not "fine".
  // A user with no subagent runs has zero `system` records; reporting `subtype` as missing would be
  // a fabricated alarm, and reporting it as satisfied would be a fabricated all-clear.
  if (applicableSamples === 0) {
    return { ...base, status: 'could-not-check', drift: null,
      because: `no sample records of type ${base.appliesTo} were found, so this field was never examined` }
  }

  const pct = presentIn / applicableSamples

  if (field.req === REQ.ALWAYS) {
    if (presentIn === applicableSamples) return { ...base, status: 'present', drift: null }
    const level = readBy.length ? 'error' : 'warn'
    return { ...base, status: presentIn === 0 ? 'absent' : 'present-partial',
      drift: { level,
        message: presentIn === 0
          ? `DECLARED REQUIRED but present in 0 of ${applicableSamples} applicable records`
          : `DECLARED REQUIRED but present in only ${presentIn} of ${applicableSamples} applicable records (${(pct * 100).toFixed(1)}%)`,
        impact: readBy.length ? `read by ${readBy.join(', ')} — those reads now silently return a default` : 'not currently read by this repo' } }
  }

  if (field.req === REQ.TYPICAL) {
    const floor = typeof field.floor === 'number' ? field.floor : 0.5
    if (pct >= floor) return { ...base, status: 'present', floor, drift: null }
    return { ...base, status: presentIn === 0 ? 'absent' : 'present-partial', floor,
      drift: { level: 'warn',
        message: `expected in at least ${(floor * 100).toFixed(0)}% of ${applicableSamples} applicable records, found ${(pct * 100).toFixed(1)}% (${presentIn})`,
        impact: readBy.length ? `read by ${readBy.join(', ')}` : 'not currently read by this repo' } }
  }

  // OPTIONAL. Absence is a fact, never a violation. This is the branch that keeps the check
  // credible: without it, `toolUseResult` (61% here, by design) would raise drift on every boot.
  if (presentIn === 0) {
    return { ...base, status: 'absent-optional', drift: null,
      because: `declared optional; absent from all ${applicableSamples} applicable records in this sample, which is NOT evidence it was removed` }
  }
  return { ...base, status: 'present', drift: null }
}

// ---------------------------------------------------------------------------
// Check the JSONL contract against parsed records.
// `records` = [{ rec, file }] — already parsed, so this stays pure and testable.
// ---------------------------------------------------------------------------
export function checkTranscriptRecords(records, meta = {}) {
  const spec = CONTRACT.transcriptJsonl
  const list = Array.isArray(records) ? records : []

  if (list.length === 0) {
    return {
      source: spec.id, label: spec.label, locate: spec.locate,
      checked: false, ok: null, status: 'could-not-check',
      reason: meta.reason || 'no transcript records were available to check',
      filesChecked: meta.filesChecked ?? 0, recordsChecked: 0,
      fields: spec.fields.map(f => verdictFor(f, 0, 0)),
      drifts: [], byRecordType: {}, unknownRecordTypes: [], malformedLines: meta.malformedLines ?? 0,
      bounds: meta.bounds || [],
    }
  }

  const byType = {}
  const tally = new Map(spec.fields.map(f => [f.path, { applicable: 0, present: 0 }]))
  const unknown = new Set()

  for (const item of list) {
    const rec = item && item.rec !== undefined ? item.rec : item
    if (!isObj(rec)) continue
    const t = typeof rec.type === 'string' ? rec.type : '(missing type)'
    byType[t] = (byType[t] || 0) + 1
    if (!KNOWN_RECORD_TYPES.includes(t)) unknown.add(t)
    for (const f of spec.fields) {
      if (!applies(f, t)) continue
      const c = tally.get(f.path)
      c.applicable++
      if (hasPath(rec, f.path)) c.present++
    }
  }

  const fields = spec.fields.map(f => { const c = tally.get(f.path); return verdictFor(f, c.applicable, c.present) })
  const drifts = fields.filter(f => f.drift).map(f => ({ field: f.path, ...f.drift, presentIn: f.presentIn, applicableSamples: f.applicableSamples }))
  const uncheckable = fields.filter(f => f.status === 'could-not-check')

  return {
    source: spec.id, label: spec.label, locate: spec.locate,
    checked: true,
    // ok:false on any drift. ok stays TRUE with uncheckable fields present, but `fieldsNotChecked`
    // is reported alongside so "ok" is never mistaken for "everything was examined".
    ok: drifts.length === 0,
    status: drifts.length === 0 ? 'ok' : 'drift',
    filesChecked: meta.filesChecked ?? null,
    recordsChecked: list.length,
    malformedLines: meta.malformedLines ?? 0,
    byRecordType: byType,
    unknownRecordTypes: [...unknown],
    fields, drifts,
    fieldsNotChecked: uncheckable.map(f => ({ path: f.path, because: f.because })),
    bounds: meta.bounds || [],
  }
}

// ---------------------------------------------------------------------------
// Check a flat-JSON contract (settings.json, .claude.json) against 0..n parsed documents.
// Multiple documents are supported because settings.json legitimately exists at user, project and
// local scope; the sample count is what makes an "absent" verdict interpretable.
// ---------------------------------------------------------------------------
export function checkJsonDocs(specId, docs, meta = {}) {
  const spec = CONTRACT[specId]
  if (!spec) {
    return { source: specId, checked: false, ok: null, status: 'could-not-check', reason: `no declared contract named "${specId}"`, fields: [], drifts: [] }
  }
  const list = (Array.isArray(docs) ? docs : []).filter(isObj)

  if (list.length === 0) {
    return {
      source: spec.id, label: spec.label, locate: spec.locate,
      checked: false, ok: null, status: 'could-not-check',
      // THE headline behaviour: a file that does not exist yields "could not check", never
      // "contract satisfied". ~/.claude/settings.json is genuinely absent on some installs.
      reason: meta.reason || `no readable ${spec.label} was found, so nothing was checked`,
      samplesChecked: 0, filesChecked: meta.filesChecked ?? 0,
      fields: spec.fields.map(f => verdictFor(f, 0, 0)),
      drifts: [], unreadable: meta.unreadable || [], bounds: meta.bounds || [],
    }
  }

  const fields = spec.fields.map(f => {
    let present = 0
    for (const d of list) if (hasPath(d, f.path)) present++
    return verdictFor(f, list.length, present)
  })
  const drifts = fields.filter(f => f.drift).map(f => ({ field: f.path, ...f.drift, presentIn: f.presentIn, applicableSamples: f.applicableSamples }))

  // Keys on disk that the contract never declared. Not an error — new keys appear all the time —
  // but they are how you notice a rename: `permissions` gone AND `permissionRules` new.
  const declaredTop = new Set(spec.fields.map(f => f.path.split('.')[0]))
  const undeclared = new Set()
  for (const d of list) for (const k of Object.keys(d)) if (!declaredTop.has(k)) undeclared.add(k)

  return {
    source: spec.id, label: spec.label, locate: spec.locate,
    checked: true, ok: drifts.length === 0, status: drifts.length === 0 ? 'ok' : 'drift',
    samplesChecked: list.length, filesChecked: meta.filesChecked ?? list.length,
    fields, drifts,
    fieldsNotChecked: fields.filter(f => f.status === 'could-not-check').map(f => ({ path: f.path, because: f.because })),
    undeclaredKeys: [...undeclared].sort(),
    unreadable: meta.unreadable || [], bounds: meta.bounds || [],
  }
}

// ---------------------------------------------------------------------------
// Disk readers. Bounded, non-throwing, and they report what they could not read.
// ---------------------------------------------------------------------------

export function readTranscriptSample(projectsDir, limits = {}) {
  const L = { ...DEFAULT_LIMITS, ...limits }
  const found = findTranscripts(projectsDir, L)
  const bounds = [...found.bounds]
  const records = []
  let malformed = 0, filesRead = 0, filesUnreadable = 0, recordCapHit = false, byteCapHit = false

  for (const file of found.files) {
    let text
    try {
      const st = fs.statSync(file)
      if (st.size > L.maxBytesPerFile) { byteCapHit = true; continue }
      text = fs.readFileSync(file, 'utf8')
    } catch { filesUnreadable++; continue }
    filesRead++
    let n = 0
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      if (n >= L.maxRecordsPerFile) { recordCapHit = true; break }
      n++
      // A single corrupt line (a half-written record from a live session) is counted, not fatal.
      // Reporting the count matters: a sudden spike in malformed lines IS a format change.
      try { records.push({ rec: JSON.parse(line), file }) } catch { malformed++ }
    }
  }

  if (recordCapHit) bounds.push({ what: 'records read per file', limit: L.maxRecordsPerFile, hit: true, note: 'later records in some files were not examined' })
  if (byteCapHit) bounds.push({ what: 'max bytes per file', limit: L.maxBytesPerFile, hit: true, note: 'oversized transcripts were skipped entirely' })
  if (filesUnreadable) bounds.push({ what: 'unreadable transcript files', limit: null, hit: true, count: filesUnreadable })

  return { records, discovery: found, filesRead, filesUnreadable, malformedLines: malformed, bounds }
}

function readJsonFile(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8')
    try { return { ok: true, doc: JSON.parse(raw), file } }
    catch (e) { return { ok: false, file, reason: `present but not valid JSON: ${e.message}` } }
  } catch (e) {
    return { ok: false, file, reason: e && e.code === 'ENOENT' ? 'file does not exist' : `unreadable: ${e && e.message}` }
  }
}

/**
 * Check every declared contract against the real files under `home`.
 * Returns a tri-state overall verdict. Never throws.
 */
export function checkAll({ home = os.homedir(), limits = {} } = {}) {
  const results = {}

  // --- transcripts ---
  const projectsDir = path.join(home, '.claude', 'projects')
  const sample = readTranscriptSample(projectsDir, limits)
  results.transcriptJsonl = checkTranscriptRecords(sample.records, {
    filesChecked: sample.filesRead,
    malformedLines: sample.malformedLines,
    bounds: sample.bounds,
    reason: !sample.discovery.rootExists
      ? `${projectsDir} does not exist — no transcripts to check`
      : sample.discovery.files.length === 0
        ? `${projectsDir} exists but contains no .jsonl files (searched recursively to depth ${sample.discovery.maxDepthSeen})`
        : 'transcript files were found but none yielded a parseable record',
  })
  results.transcriptJsonl.discovery = sample.discovery

  // --- settings.json (user + local; both legitimately absent) ---
  const settingsCandidates = [
    path.join(home, '.claude', 'settings.json'),
    path.join(home, '.claude', 'settings.local.json'),
  ]
  const settingsRead = settingsCandidates.map(readJsonFile)
  results.settingsJson = checkJsonDocs('settingsJson', settingsRead.filter(r => r.ok).map(r => r.doc), {
    filesChecked: settingsRead.filter(r => r.ok).length,
    unreadable: settingsRead.filter(r => !r.ok).map(r => ({ file: r.file, reason: r.reason })),
    reason: `none of the candidate paths were readable: ${settingsRead.map(r => `${r.file} (${r.reason})`).join('; ')}`,
  })
  results.settingsJson.candidates = settingsCandidates

  // --- .claude.json ---
  const cj = readJsonFile(path.join(home, '.claude.json'))
  results.claudeJson = checkJsonDocs('claudeJson', cj.ok ? [cj.doc] : [], {
    filesChecked: cj.ok ? 1 : 0,
    unreadable: cj.ok ? [] : [{ file: cj.file, reason: cj.reason }],
    reason: cj.ok ? undefined : `${cj.file}: ${cj.reason}`,
  })

  const all = Object.values(results)
  const checkedSources = all.filter(r => r.checked)
  const drifts = all.flatMap(r => (r.drifts || []).map(d => ({ source: r.source, ...d })))

  // OVERALL is tri-state on purpose:
  //   null  = nothing was checked. The one thing this module must never render as "satisfied".
  //   false = at least one declared field drifted.
  //   true  = every source that COULD be checked passed — and `sourcesNotChecked` says which could not.
  const ok = checkedSources.length === 0 ? null : drifts.length === 0

  return {
    home,
    ok,
    status: ok === null ? 'could-not-check' : ok ? 'ok' : 'drift',
    headline: ok === null
      ? `COULD NOT CHECK — 0 of ${all.length} declared sources had any readable sample on this machine. This is not a pass.`
      : ok
        ? `contract satisfied across ${checkedSources.length} of ${all.length} sources (${checkedSources.map(r => `${r.label}: ${r.recordsChecked ?? r.samplesChecked} samples`).join('; ')})`
        : `${drifts.length} contract drift(s) across ${checkedSources.length} checked source(s)`,
    sourcesChecked: checkedSources.map(r => r.source),
    sourcesNotChecked: all.filter(r => !r.checked).map(r => ({ source: r.source, label: r.label, reason: r.reason })),
    drifts,
    bounds: all.flatMap(r => (r.bounds || []).map(b => ({ source: r.source, ...b }))),
    results,
  }
}

/** Plain-text report. Every line that states a verdict also states the evidence count behind it. */
export function formatReport(report) {
  if (!report || typeof report !== 'object') return 'contract check: no report'
  const L = []
  L.push(`CONTRACT CHECK — ${String(report.status).toUpperCase()}`)
  L.push(report.headline)
  if (report.sourcesNotChecked?.length) {
    L.push('', 'NOT CHECKED (no verdict is claimed for these):')
    for (const s of report.sourcesNotChecked) L.push(`  - ${s.label}: ${s.reason}`)
  }
  for (const r of Object.values(report.results || {})) {
    if (!r.checked) continue
    const n = r.recordsChecked ?? r.samplesChecked
    L.push('', `${r.label} — ${r.status}, ${n} sample(s)${r.filesChecked != null ? ` from ${r.filesChecked} file(s)` : ''}`)
    if (r.malformedLines) L.push(`  ${r.malformedLines} malformed line(s) skipped`)
    for (const d of r.drifts || []) L.push(`  DRIFT [${d.level}] ${d.field}: ${d.message} — ${d.impact}`)
    const opt = (r.fields || []).filter(f => f.status === 'absent-optional')
    if (opt.length) L.push(`  absent-but-optional (NOT drift): ${opt.map(f => `${f.path} (0/${f.applicableSamples})`).join(', ')}`)
    if (r.fieldsNotChecked?.length) L.push(`  not checked: ${r.fieldsNotChecked.map(f => f.path).join(', ')}`)
    if (r.undeclaredKeys?.length) L.push(`  keys on disk not in the contract: ${r.undeclaredKeys.join(', ')}`)
  }
  if (report.bounds?.length) {
    L.push('', 'BOUNDS APPLIED (results describe only what was sampled):')
    for (const b of report.bounds) L.push(`  - ${b.source}: ${b.what}${b.limit != null ? ` limit=${b.limit}` : ''}${b.count != null ? ` count=${b.count}` : ''}${b.note ? ` — ${b.note}` : ''}`)
  }
  return L.join('\n')
}
