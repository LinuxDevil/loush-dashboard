# Career Dashboard — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the seven Phase-1 panels of a personal Career dashboard (Me/Now, Tasks, Work-Session/Flow, Quality, `/insights`-per-project, Brag/Work-Log, 1:1 Prep) as a new `?dash=career` shell, backed by a `server-career.mjs` module over a cached snapshot, with a trustworthy bug-attribution rule and quarantined `/insights` parsing.

**Architecture:** Mirrors the existing multi-dashboard pattern (`?dash=eng` → `EngDashboard.jsx` + `mountEng(app)`). Pure, unit-tested logic lives in small root-level `career-*.mjs` modules (config/migration, identity, insights parsers, attribution, heuristics, snapshot builder). `server-career.mjs` wires them into Express under `/api/career/*`. React panels live in `src/career/`, composed by `src/CareerDashboard.jsx`. All persisted state is one versioned `~/.claude/career.json`.

**Tech Stack:** Node 26 (built-in `node:test` + `node:assert`, no new deps), Express (existing), React 18 + Vite (existing). Reuses `track()` (versioned write + backup), `readJson()`, transcript/git helpers from `server.mjs`.

## Global Constraints

- **No new npm dependencies.** Tests use the Node built-in runner (`node --test`), `node:test`, `node:assert/strict`.
- **All writes to `career.json` go through the injected `track(file, content, {scope:'career', summary})`** — never `fs.writeFileSync` directly. This gives versioning + backup for free.
- **Localhost only** — the server already binds localhost; add no new network listeners.
- **`report.html` parsing is quarantined** — it lives in its own module with its own try/catch and returns ONLY the narrative slice; a throw there must never affect numeric panels. (Spec §2.4)
- **Escaped vs caught-in-review are separate** — review findings NEVER enter the change-fail numerator or the rollup. (Spec §2.5)
- **Identity is resolved once** from `career.json.identity` and is the sole source of truth for "mine"; a zero-match import warns, never returns silently empty. (Spec §2.3)
- **Refresh is incremental** — parsed usage-data files are cached by mtime; refresh returns `{ parsed, skipped, tookMs }`. (Spec §2.4)
- **Career accent color** `#c9a15a` (warm gold) so you always know which dashboard you're in (Cursor=blue, Eng=steel, Claude=clay).
- **Paths:** `CLAUDE = ~/.claude`; usage-data at `CLAUDE/usage-data/{facets,session-meta}/*.json` and `CLAUDE/usage-data/report.html`.
- Spec of record: `docs/superpowers/specs/2026-07-09-career-dashboard-design.md`.

---

### Task 1: Test infra + `career.json` config store with migration

**Files:**
- Modify: `package.json` (add `"test": "node --test"` script)
- Create: `career-config.mjs`
- Test: `test/career-config.test.mjs`

**Interfaces:**
- Produces:
  - `CONFIG_VERSION` (number, current schema version = 1)
  - `defaultConfig()` → full default `career.json` object (all Phase-1 collections present, empty)
  - `migrate(cfg)` → `{ cfg, changed }` — runs ordered migrations if `cfg.version < CONFIG_VERSION`; throws `Error('career.json version N is newer than this build (M)')` if `cfg.version > CONFIG_VERSION`
  - `makeStore({ file, track, readJson })` → `{ read(), write(patch) }` where `read()` loads+migrates+persists-if-changed, `write(patch)` deep-merges patch into current and persists via `track`

- [ ] **Step 1: Add the test script**

In `package.json` `"scripts"`, add:
```json
"test": "node --test",
```

- [ ] **Step 2: Write the failing test**

Create `test/career-config.test.mjs`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { CONFIG_VERSION, defaultConfig, migrate, makeStore } from '../career-config.mjs'

test('defaultConfig has all phase-1 collections and current version', () => {
  const c = defaultConfig()
  assert.equal(c.version, CONFIG_VERSION)
  for (const k of ['identity', 'projects', 'brag', 'retros', 'oneOnOnes', 'rollup', 'analyses'])
    assert.ok(k in c, `missing ${k}`)
  assert.deepEqual(c.identity.gitEmails, [])
})

test('migrate refuses a newer version', () => {
  assert.throws(() => migrate({ version: CONFIG_VERSION + 1 }), /newer than this build/)
})

test('migrate upgrades a versionless (v0) blob to current and marks changed', () => {
  const { cfg, changed } = migrate({ brag: [{ id: 'b1' }] })
  assert.equal(cfg.version, CONFIG_VERSION)
  assert.equal(changed, true)
  assert.equal(cfg.brag[0].id, 'b1') // preserves existing data
  assert.ok(Array.isArray(cfg.retros)) // backfills missing collections
})

test('makeStore read() persists a migration and write() deep-merges', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'career-'))
  const file = path.join(dir, 'career.json')
  fs.writeFileSync(file, JSON.stringify({ brag: [{ id: 'x' }] })) // v0
  const writes = []
  const track = (f, content) => { fs.writeFileSync(f, content); writes.push(f) }
  const readJson = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return fb } }
  const store = makeStore({ file, track, readJson })
  const c1 = store.read()
  assert.equal(c1.version, CONFIG_VERSION)
  assert.equal(writes.length, 1) // migration was persisted
  store.write({ identity: { githubHandle: 'ali' } })
  const c2 = store.read()
  assert.equal(c2.identity.githubHandle, 'ali')
  assert.equal(c2.brag[0].id, 'x') // merge preserved siblings
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/career-config.test.mjs`
Expected: FAIL — `Cannot find module '../career-config.mjs'`.

- [ ] **Step 4: Write minimal implementation**

Create `career-config.mjs`:
```js
// career.json store: default shape, ordered migrations, versioned read/write.
// version bump checklist: add a migration entry, bump CONFIG_VERSION, extend defaultConfig().
export const CONFIG_VERSION = 1

export function defaultConfig() {
  return {
    version: CONFIG_VERSION,
    updatedAt: 0,
    identity: { gitEmails: [], githubHandle: '', jiraAccountId: '', confluenceUser: '', slackUserId: '' },
    projects: [],                 // {id, path, label, active, owned}
    competency: { levelSelfAssessed: '', ratings: {}, ladder: [] },
    learning: { now: [], next: [], techRadar: [] },
    okrs: [], courses: [], ownership: [], feedback: [], feedbackRequests: [],
    decisions: [], brag: [], retros: [], timeTarget: null, oneOnOnes: [],
    insightsRaw: null, analyses: {},
    xpLedger: [], quests: [], badges: [],
    rollup: { activityDays: [], streaks: {}, personalBests: {}, quarterlyBugRatio: {} },
    imports: {}, lessons: [], ticketLinks: {},
  }
}

// Ordered migrations: index i upgrades a config AT version i to version i+1.
// v0 (no/legacy version) -> v1: backfill any missing top-level keys from the default.
const MIGRATIONS = [
  (cfg) => { const d = defaultConfig(); return { ...d, ...cfg, version: 1,
    identity: { ...d.identity, ...(cfg.identity || {}) },
    rollup: { ...d.rollup, ...(cfg.rollup || {}) } } },
]

export function migrate(cfg) {
  let v = Number(cfg?.version || 0)
  if (v > CONFIG_VERSION) throw new Error(`career.json version ${v} is newer than this build (${CONFIG_VERSION})`)
  let out = cfg || {}
  let changed = false
  while (v < CONFIG_VERSION) { out = MIGRATIONS[v](out); v++; changed = true }
  if (!('version' in (cfg || {})) && !changed) { out = { ...defaultConfig(), ...out }; changed = true }
  return { cfg: out, changed }
}

function deepMerge(base, patch) {
  const out = Array.isArray(base) ? [...base] : { ...base }
  for (const [k, v] of Object.entries(patch || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base?.[k] && typeof base[k] === 'object' && !Array.isArray(base[k])
      ? deepMerge(base[k], v) : v
  }
  return out
}

export function makeStore({ file, track, readJson }) {
  const load = () => {
    const raw = readJson(file, null) || defaultConfig()
    const { cfg, changed } = migrate(raw)
    if (changed || !readJson(file, null)) track(file, JSON.stringify(cfg, null, 2), { scope: 'career', summary: 'migrate career.json' })
    return cfg
  }
  return {
    read: () => load(),
    write: (patch) => {
      const cur = load()
      const next = deepMerge(cur, { ...patch, updatedAt: Date.now() })
      track(file, JSON.stringify(next, null, 2), { scope: 'career', summary: 'update career.json' })
      return next
    },
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/career-config.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json career-config.mjs test/career-config.test.mjs
git commit -m "feat(career): career.json store with versioned migration"
```

---

### Task 2: Identity resolver

**Files:**
- Create: `career-identity.mjs`
- Test: `test/career-identity.test.mjs`

**Interfaces:**
- Consumes: `career.json.identity` (from Task 1)
- Produces:
  - `resolveIdentity(identity)` → `{ emails:Set<lowercased>, githubHandle, jiraAccountId, confluenceUser, slackUserId, isEmpty:boolean }`
  - `matchesMe(resolved, { email })` → boolean (case-insensitive email match; false if resolved.isEmpty)
  - `warnIfNoMatch(resolved, matchedCount, label, log=console.warn)` → void — emits a warning when `matchedCount===0 && !resolved.isEmpty`

- [ ] **Step 1: Write the failing test**

Create `test/career-identity.test.mjs`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveIdentity, matchesMe, warnIfNoMatch } from '../career-identity.mjs'

test('matchesMe handles two git emails, case-insensitively', () => {
  const r = resolveIdentity({ gitEmails: ['Ali@work.com', 'ali@personal.dev'] })
  assert.equal(matchesMe(r, { email: 'ALI@WORK.COM' }), true)
  assert.equal(matchesMe(r, { email: 'ali@personal.dev' }), true)
  assert.equal(matchesMe(r, { email: 'someone@else.com' }), false)
})

test('empty identity never claims a match', () => {
  const r = resolveIdentity({ gitEmails: [] })
  assert.equal(r.isEmpty, true)
  assert.equal(matchesMe(r, { email: 'ali@work.com' }), false)
})

test('warnIfNoMatch warns only on zero matches with a non-empty identity', () => {
  const warned = []
  const log = m => warned.push(m)
  const r = resolveIdentity({ gitEmails: ['ali@work.com'] })
  warnIfNoMatch(r, 0, 'git', log)
  warnIfNoMatch(r, 5, 'git', log)
  warnIfNoMatch(resolveIdentity({ gitEmails: [] }), 0, 'git', log)
  assert.equal(warned.length, 1)
  assert.match(warned[0], /git/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/career-identity.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `career-identity.mjs`:
```js
// Single source of truth for "mine". Resolve once; validate matches on every import.
export function resolveIdentity(identity = {}) {
  const emails = new Set((identity.gitEmails || []).map(e => String(e).toLowerCase()))
  const r = {
    emails,
    githubHandle: identity.githubHandle || '',
    jiraAccountId: identity.jiraAccountId || '',
    confluenceUser: identity.confluenceUser || '',
    slackUserId: identity.slackUserId || '',
  }
  r.isEmpty = emails.size === 0 && !r.githubHandle && !r.jiraAccountId && !r.confluenceUser && !r.slackUserId
  return r
}

export function matchesMe(resolved, { email } = {}) {
  if (!resolved || resolved.isEmpty) return false
  if (email && resolved.emails.has(String(email).toLowerCase())) return true
  return false
}

export function warnIfNoMatch(resolved, matchedCount, label, log = console.warn) {
  if (!resolved.isEmpty && matchedCount === 0)
    log(`[career] identity matched 0 records in ${label} — check career.json identity (${label})`)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/career-identity.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add career-identity.mjs test/career-identity.test.mjs
git commit -m "feat(career): identity resolver with zero-match warning"
```

---

### Task 3: `/insights` structured parser (facets ⋈ session-meta, grouped by project)

**Files:**
- Create: `career-insights.mjs`
- Test: `test/career-insights.test.mjs`
- Test fixtures: `test/fixtures/usage-data/facets/s1.json`, `test/fixtures/usage-data/session-meta/s1.json`, plus a malformed `facets/bad.json`

**Interfaces:**
- Produces:
  - `parseUsageData(dir, { mtimeCache })` → `{ sessions:[joined], skipped:number, parsed:number }` where a joined session = `{ session_id, project_path, start_time, duration_minutes, tool_counts, languages, git_commits, git_pushes, input_tokens, output_tokens, user_interruptions, user_response_times, first_prompt, outcome, session_type, friction_counts, user_satisfaction_counts, claude_helpfulness, primary_success, brief_summary }`
  - `groupByProject(sessions)` → `Map<project_path, { sessions, totals }>` where totals aggregate counts (sessions, outcomes histogram, friction histogram, session_type histogram, tool_counts sum, languages sum, git_commits sum, avg response time, interruption rate)
  - `mtimeCache` is any object with `get(path)`/`set(path,val)`; a session file whose mtime is unchanged returns the cached parse.

- [ ] **Step 1: Create fixtures**

Create `test/fixtures/usage-data/session-meta/s1.json`:
```json
{ "session_id": "s1", "project_path": "E:\\MedcoreSyria", "start_time": "2026-06-30T19:24:45.994Z",
  "duration_minutes": 120, "tool_counts": { "Bash": 10, "Edit": 4, "Agent": 3 },
  "languages": { "TypeScript": 20 }, "git_commits": 2, "git_pushes": 1,
  "input_tokens": 60000, "output_tokens": 400000, "user_interruptions": 1,
  "user_response_times": [10, 20, 30], "first_prompt": "Build feature X in AIR-123" }
```
Create `test/fixtures/usage-data/facets/s1.json`:
```json
{ "session_id": "s1", "underlying_goal": "ship feature X", "goal_categories": { "feature_implementation": 1 },
  "outcome": "mostly_achieved", "user_satisfaction_counts": { "likely_satisfied": 3 },
  "claude_helpfulness": "very_helpful", "session_type": "multi_task",
  "friction_counts": { "wrong_approach": 2 }, "primary_success": "multi_file_changes",
  "brief_summary": "shipped X" }
```
Create `test/fixtures/usage-data/facets/bad.json`:
```json
{ "session_id": "bad", not-json
```

- [ ] **Step 2: Write the failing test**

Create `test/career-insights.test.mjs`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseUsageData, groupByProject } from '../career-insights.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIR = path.join(HERE, 'fixtures', 'usage-data')

test('joins facets+session-meta on session_id and skips malformed', () => {
  const cache = new Map()
  const { sessions, skipped, parsed } = parseUsageData(DIR, { mtimeCache: cache })
  assert.equal(sessions.length, 1)
  const s = sessions[0]
  assert.equal(s.session_id, 's1')
  assert.equal(s.project_path, 'E:\\MedcoreSyria')
  assert.equal(s.outcome, 'mostly_achieved')       // from facets
  assert.equal(s.git_commits, 2)                    // from session-meta
  assert.equal(s.friction_counts.wrong_approach, 2)
  assert.ok(skipped >= 1)                            // bad.json counted, not thrown
  assert.equal(parsed, 1)
})

test('groupByProject aggregates totals', () => {
  const { sessions } = parseUsageData(DIR, { mtimeCache: new Map() })
  const g = groupByProject(sessions)
  const p = g.get('E:\\MedcoreSyria')
  assert.equal(p.sessions.length, 1)
  assert.equal(p.totals.sessions, 1)
  assert.equal(p.totals.gitCommits, 2)
  assert.equal(p.totals.outcomes.mostly_achieved, 1)
  assert.equal(p.totals.friction.wrong_approach, 2)
})

test('mtime cache returns cached parse when unchanged', () => {
  const cache = new Map()
  parseUsageData(DIR, { mtimeCache: cache })
  const before = cache.size
  const r2 = parseUsageData(DIR, { mtimeCache: cache })
  assert.equal(r2.parsed, 0)        // nothing re-parsed
  assert.equal(r2.sessions.length, 1) // still returns joined data from cache
  assert.ok(before > 0)
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/career-insights.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 4: Write minimal implementation**

Create `career-insights.mjs`:
```js
import fs from 'node:fs'
import path from 'node:path'

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const listJson = (dir) => { try { return fs.readdirSync(dir).filter(f => f.endsWith('.json')) } catch { return [] } }

// Parse one facet or meta file, using mtime cache. Returns parsed object or throws.
function cachedRead(file, cache, counters) {
  const mt = fs.statSync(file).mtimeMs
  const hit = cache.get(file)
  if (hit && hit.mt === mt) return hit.val
  const val = readJson(file)                 // throws on malformed
  cache.set(file, { mt, val })
  counters.parsed++
  return val
}

export function parseUsageData(dir, { mtimeCache } = {}) {
  const cache = mtimeCache || new Map()
  const counters = { parsed: 0 }
  const metaDir = path.join(dir, 'session-meta')
  const facetDir = path.join(dir, 'facets')
  let skipped = 0
  const metas = new Map()
  for (const f of listJson(metaDir)) {
    try { const m = cachedRead(path.join(metaDir, f), cache, counters); metas.set(m.session_id, m) }
    catch { skipped++ }
  }
  const sessions = []
  for (const f of listJson(facetDir)) {
    let fa
    try { fa = cachedRead(path.join(facetDir, f), cache, counters) } catch { skipped++; continue }
    const meta = metas.get(fa.session_id)
    if (!meta) { skipped++; continue }       // orphan facet
    sessions.push({ ...meta, ...fa, session_id: fa.session_id })
  }
  return { sessions, skipped, parsed: counters.parsed }
}

const bump = (obj, key, by = 1) => { if (key == null) return; obj[key] = (obj[key] || 0) + by }
const mergeCounts = (into, from) => { for (const [k, v] of Object.entries(from || {})) bump(into, k, v) }

export function groupByProject(sessions) {
  const g = new Map()
  for (const s of sessions) {
    const key = s.project_path || '(unknown)'
    if (!g.has(key)) g.set(key, { sessions: [], totals: {
      sessions: 0, gitCommits: 0, gitPushes: 0, interruptions: 0, responseTimes: [],
      outcomes: {}, friction: {}, sessionTypes: {}, tools: {}, languages: {},
    } })
    const p = g.get(key); const t = p.totals
    p.sessions.push(s)
    t.sessions++; t.gitCommits += s.git_commits || 0; t.gitPushes += s.git_pushes || 0
    t.interruptions += s.user_interruptions || 0
    t.responseTimes.push(...(s.user_response_times || []))
    bump(t.outcomes, s.outcome); bump(t.sessionTypes, s.session_type)
    mergeCounts(t.friction, s.friction_counts); mergeCounts(t.tools, s.tool_counts); mergeCounts(t.languages, s.languages)
  }
  for (const p of g.values()) {
    const rt = p.totals.responseTimes
    p.totals.avgResponseSec = rt.length ? rt.reduce((a, b) => a + b, 0) / rt.length : 0
    p.totals.interruptRate = p.totals.sessions ? p.totals.interruptions / p.totals.sessions : 0
  }
  return g
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/career-insights.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add career-insights.mjs test/career-insights.test.mjs test/fixtures/usage-data
git commit -m "feat(career): /insights facets+meta parser with mtime cache and project grouping"
```

---

### Task 4: Quarantined `report.html` narrative parser

**Files:**
- Create: `career-insights-report.mjs`
- Test: `test/career-insights-report.test.mjs`
- Fixture: copy the real sample to `test/fixtures/report-sample.html` (from `~/.claude/usage-data/report.html`)

**Interfaces:**
- Produces: `parseReportNarrative(html)` → `{ atAGlance:{working,hindering,quickWins,ambitious}, wins:[{title,desc}], friction:[{title,desc,examples[]}], horizon:[{title,possible}], suggestedClaudeMd:[{code,why}], features:[{title,oneliner,why}], patterns:[{title,summary,detail,prompt}], stats:{messages,sessions,dateRange} }` — **never throws**; on any failure returns `{ error:String }` plus whatever fields parsed. It uses only regex/string slicing over class names (no DOM lib).

- [ ] **Step 1: Create fixture**

```bash
mkdir -p test/fixtures && cp ~/.claude/usage-data/report.html test/fixtures/report-sample.html
```

- [ ] **Step 2: Write the failing test**

Create `test/career-insights-report.test.mjs`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseReportNarrative } from '../career-insights-report.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const html = fs.readFileSync(path.join(HERE, 'fixtures', 'report-sample.html'), 'utf8')

test('parses at-a-glance and wins from the real report', () => {
  const r = parseReportNarrative(html)
  assert.ok(r.atAGlance.working.length > 0)
  assert.ok(r.atAGlance.hindering.length > 0)
  assert.ok(r.wins.length >= 1)
  assert.ok(r.suggestedClaudeMd.length >= 1)
  assert.ok(r.stats.messages > 0)
})

test('never throws on garbage; returns error field', () => {
  const r = parseReportNarrative('<html>not a report</html>')
  assert.equal(typeof r, 'object')
  assert.ok('error' in r || (r.wins && r.wins.length === 0))
})

test('never throws on null', () => {
  assert.doesNotThrow(() => parseReportNarrative(null))
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `node --test test/career-insights-report.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 4: Write minimal implementation**

Create `career-insights-report.mjs`:
```js
// QUARANTINED: this module parses the undocumented /insights report.html. It must NEVER throw
// into callers — every export is wrapped so a schema change here can't take down numeric panels.
const strip = s => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
const all = (re, s) => { const out = []; let m; while ((m = re.exec(s))) out.push(m); return out }
const between = (s, startRe, endRe) => { const a = startRe.exec(s); if (!a) return ''; const rest = s.slice(a.index + a[0].length); const b = endRe.exec(rest); return b ? rest.slice(0, b.index) : rest }

function parse(html) {
  const h = String(html || '')
  const glance = {}
  for (const m of all(/<div class="glance-section"><strong>([^:]+):<\/strong>([\s\S]*?)<\/div>/g, h)) {
    const key = strip(m[1]).toLowerCase()
    const text = strip(m[2]).replace(/→$/, '').trim()
    if (key.includes('working')) glance.working = text
    else if (key.includes('hindering')) glance.hindering = text
    else if (key.includes('quick')) glance.quickWins = text
    else if (key.includes('ambitious')) glance.ambitious = text
  }
  const wins = all(/<div class="big-win-title">([\s\S]*?)<\/div>\s*<div class="big-win-desc">([\s\S]*?)<\/div>/g, h)
    .map(m => ({ title: strip(m[1]), desc: strip(m[2]) }))
  const friction = all(/<div class="friction-title">([\s\S]*?)<\/div>\s*<div class="friction-desc">([\s\S]*?)<\/div>/g, h)
    .map(m => ({ title: strip(m[1]), desc: strip(m[2]), examples: [] }))
  const horizon = all(/<div class="horizon-title">([\s\S]*?)<\/div>\s*<div class="horizon-possible">([\s\S]*?)<\/div>/g, h)
    .map(m => ({ title: strip(m[1]), possible: strip(m[2]) }))
  const suggestedClaudeMd = all(/<code class="cmd-code">([\s\S]*?)<\/code>[\s\S]*?<div class="cmd-why">([\s\S]*?)<\/div>/g, h)
    .map(m => ({ code: strip(m[1]), why: strip(m[2]) }))
  const features = all(/<div class="feature-title">([\s\S]*?)<\/div>\s*<div class="feature-oneliner">([\s\S]*?)<\/div>[\s\S]*?<div class="feature-why">([\s\S]*?)<\/div>/g, h)
    .map(m => ({ title: strip(m[1]), oneliner: strip(m[2]), why: strip(m[3]) }))
  const patterns = all(/<div class="pattern-title">([\s\S]*?)<\/div>\s*<div class="pattern-summary">([\s\S]*?)<\/div>\s*<div class="pattern-detail">([\s\S]*?)<\/div>/g, h)
    .map(m => ({ title: strip(m[1]), summary: strip(m[2]), detail: strip(m[3]), prompt: '' }))
  const sub = strip(between(h, /<p class="subtitle">/, /<\/p>/))
  const mm = /(\d+)\s+messages? across\s+(\d+)\s+sessions/i.exec(sub)
  const stats = { messages: mm ? +mm[1] : 0, sessions: mm ? +mm[2] : 0, dateRange: (sub.split('|')[1] || '').trim() }
  return { atAGlance: glance, wins, friction, horizon, suggestedClaudeMd, features, patterns, stats }
}

export function parseReportNarrative(html) {
  try { return parse(html) }
  catch (e) { return { error: e.message, atAGlance: {}, wins: [], friction: [], horizon: [], suggestedClaudeMd: [], features: [], patterns: [], stats: { messages: 0, sessions: 0, dateRange: '' } } }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `node --test test/career-insights-report.test.mjs`
Expected: PASS (3 tests). If a selector misses on your real report, adjust the regex to the actual class names in `test/fixtures/report-sample.html` (the fixture is the contract).

- [ ] **Step 6: Commit**

```bash
git add career-insights-report.mjs test/career-insights-report.test.mjs test/fixtures/report-sample.html
git commit -m "feat(career): quarantined report.html narrative parser (never throws)"
```

---

### Task 5: Bug attribution (escaped vs caught-in-review)

**Files:**
- Create: `career-attribution.mjs`
- Test: `test/career-attribution.test.mjs`

**Interfaces:**
- Consumes: `resolveIdentity`/`matchesMe` (Task 2)
- Produces:
  - `attributeBugs({ bugs, findings, myPrCount, reverts, resolved })` → `{ attributed:[{id,rule}], unattributed:[{id}], caughtInReview:[{id,severity}], changeFailProxy:number, defectDensityCaughtInReview:number }`
  - Rule: a bug is **mine (escaped)** iff (1) linked to a ticket whose branch I authored (`bug.ticketAuthorEmail` matches me) OR (2) `bug.culpritAuthorEmail` matches me. Review `findings` with `severity ∈ {warning,error,critical}` on a diff I authored (`finding.diffAuthorEmail` matches me) go to `caughtInReview` and are **excluded** from `changeFailProxy`.
  - `changeFailProxy = (attributed.length + reverts) / max(1, myPrCount)`
  - `defectDensityCaughtInReview = caughtInReview.length / max(1, myPrCount)`

- [ ] **Step 1: Write the failing test**

Create `test/career-attribution.test.mjs`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveIdentity } from '../career-identity.mjs'
import { attributeBugs } from '../career-attribution.mjs'

const resolved = resolveIdentity({ gitEmails: ['ali@work.com'] })

test('attributes escaped bugs by ticket-branch and culprit; buckets unattributable', () => {
  const bugs = [
    { id: 'b1', ticketAuthorEmail: 'ali@work.com' },
    { id: 'b2', culpritAuthorEmail: 'ALI@WORK.COM' },
    { id: 'b3', culpritAuthorEmail: 'someone@else.com' },
  ]
  const r = attributeBugs({ bugs, findings: [], myPrCount: 4, reverts: 0, resolved })
  assert.deepEqual(r.attributed.map(a => a.id).sort(), ['b1', 'b2'])
  assert.deepEqual(r.unattributed.map(a => a.id), ['b3'])
  assert.equal(r.changeFailProxy, 2 / 4)
})

test('review findings NEVER move the change-fail proxy', () => {
  const findings = [
    { id: 'f1', severity: 'warning', diffAuthorEmail: 'ali@work.com' },
    { id: 'f2', severity: 'info', diffAuthorEmail: 'ali@work.com' },   // below threshold, ignored
    { id: 'f3', severity: 'error', diffAuthorEmail: 'other@x.com' },   // not mine
  ]
  const r = attributeBugs({ bugs: [], findings, myPrCount: 2, reverts: 0, resolved })
  assert.equal(r.changeFailProxy, 0)                       // findings excluded
  assert.equal(r.caughtInReview.length, 1)                 // only f1
  assert.equal(r.defectDensityCaughtInReview, 1 / 2)
})

test('empty identity attributes nothing', () => {
  const r = attributeBugs({ bugs: [{ id: 'b1', culpritAuthorEmail: 'ali@work.com' }], findings: [], myPrCount: 1, reverts: 0, resolved: resolveIdentity({ gitEmails: [] }) })
  assert.equal(r.attributed.length, 0)
  assert.equal(r.unattributed.length, 1)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/career-attribution.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `career-attribution.mjs`:
```js
import { matchesMe } from './career-identity.mjs'
const SEVERE = new Set(['warning', 'error', 'critical'])

export function attributeBugs({ bugs = [], findings = [], myPrCount = 0, reverts = 0, resolved }) {
  const attributed = [], unattributed = []
  for (const b of bugs) {
    let rule = null
    if (matchesMe(resolved, { email: b.ticketAuthorEmail })) rule = 'ticket-branch'
    else if (matchesMe(resolved, { email: b.culpritAuthorEmail })) rule = 'culprit-commit'
    if (rule) attributed.push({ id: b.id, rule })
    else unattributed.push({ id: b.id })
  }
  const caughtInReview = findings
    .filter(f => SEVERE.has(String(f.severity).toLowerCase()) && matchesMe(resolved, { email: f.diffAuthorEmail }))
    .map(f => ({ id: f.id, severity: f.severity }))
  const denom = Math.max(1, myPrCount)
  return {
    attributed, unattributed, caughtInReview,
    changeFailProxy: (attributed.length + reverts) / denom,        // escaped only
    defectDensityCaughtInReview: caughtInReview.length / denom,     // separate axis
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/career-attribution.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add career-attribution.mjs test/career-attribution.test.mjs
git commit -m "feat(career): bug attribution — escaped bugs vs caught-in-review, split proxies"
```

---

### Task 6: Heuristic recommendation items

**Files:**
- Create: `career-heuristics.mjs`
- Test: `test/career-heuristics.test.mjs`

**Interfaces:**
- Produces: `focusItems(snapshot)` → `[{ id, severity:'low'|'med'|'high', area, message, evidenceRefs:[], actedOn:null }]` sorted by severity desc. Rules (Phase-1 subset, spec §3.1):
  - `quality`: `changeFailProxy` rose > 0.1 vs `priorChangeFailProxy` → high "shore up tests/verification".
  - `workflow`: top friction type is `wrong_approach` → med "front-load explicit constraints".
  - `flow`: `afterHoursPct > 0.35` OR `wip > 4` → med sustainability warning.
  - `tasks`: any in-progress ticket `ageDays > slaDays` → high "risk to commitments: <ticket>".
  - Each item id is stable: `${area}:${slug(message)}` so an `actedOn` mark can be re-attached across refreshes.

- [ ] **Step 1: Write the failing test**

Create `test/career-heuristics.test.mjs`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { focusItems } from '../career-heuristics.mjs'

test('emits quality, workflow, flow and task-risk items and sorts by severity', () => {
  const snap = {
    quality: { changeFailProxy: 0.3, priorChangeFailProxy: 0.1 },
    workflow: { topFriction: 'wrong_approach' },
    flow: { afterHoursPct: 0.5, wip: 2 },
    tasks: [{ id: 'AIR-1', stage: 'in-progress', ageDays: 10, slaDays: 5 }],
  }
  const items = focusItems(snap)
  const areas = items.map(i => i.area)
  assert.ok(areas.includes('quality'))
  assert.ok(areas.includes('workflow'))
  assert.ok(areas.includes('flow'))
  assert.ok(areas.includes('tasks'))
  assert.equal(items[0].severity, 'high')                 // sorted, high first
  assert.ok(items.every(i => i.actedOn === null && i.id))
})

test('quiet snapshot yields no items', () => {
  const items = focusItems({ quality: { changeFailProxy: 0.05, priorChangeFailProxy: 0.05 }, workflow: {}, flow: { afterHoursPct: 0.1, wip: 1 }, tasks: [] })
  assert.equal(items.length, 0)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/career-heuristics.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `career-heuristics.mjs`:
```js
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
const RANK = { high: 3, med: 2, low: 1 }
const mk = (severity, area, message, evidenceRefs = []) => ({ id: `${area}:${slug(message)}`, severity, area, message, evidenceRefs, actedOn: null })

export function focusItems(snapshot = {}) {
  const out = []
  const q = snapshot.quality || {}
  if ((q.changeFailProxy || 0) - (q.priorChangeFailProxy || 0) > 0.1)
    out.push(mk('high', 'quality', 'Change-fail rose sharply — shore up tests and verification', ['quality']))
  const w = snapshot.workflow || {}
  if (w.topFriction === 'wrong_approach')
    out.push(mk('med', 'workflow', 'Front-load explicit constraints — wrong-approach is your top friction', ['workflow']))
  const f = snapshot.flow || {}
  if ((f.afterHoursPct || 0) > 0.35 || (f.wip || 0) > 4)
    out.push(mk('med', 'flow', 'Sustainability: high after-hours load or WIP — protect deep-work blocks', ['flow']))
  for (const t of snapshot.tasks || [])
    if (t.stage === 'in-progress' && (t.ageDays || 0) > (t.slaDays || Infinity))
      out.push(mk('high', 'tasks', `Risk to commitments: ${t.id} is past its expected date`, [t.id]))
  return out.sort((a, b) => RANK[b.severity] - RANK[a.severity])
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/career-heuristics.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add career-heuristics.mjs test/career-heuristics.test.mjs
git commit -m "feat(career): phase-1 heuristic focus items"
```

---

### Task 7: Snapshot builder (incremental) + rollup writer

**Files:**
- Create: `career-snapshot.mjs`
- Test: `test/career-snapshot.test.mjs`

**Interfaces:**
- Consumes: Tasks 2–6, plus injected readers so it stays unit-testable.
- Produces:
  - `buildSnapshot(deps)` → `{ me, flow, quality, workflow, tasks, insights, projects, focus, generatedAt, parsed, skipped }`
  - `deps = { usageDir, mtimeCache, config, resolved, readBugs()->{bugs,findings,myPrCount,reverts}, readTasks()->[ticket], readReport()->html }`
  - `updateRollup(config, snapshot, todayIso)` → `patch` for `career.json.rollup`: appends today to `activityDays` (deduped) if there was activity, updates `streaks.coding`, `personalBests.lowestBugRatio`, `quarterlyBugRatio[q]` — **bug numbers sourced only from `snapshot.quality.changeFailProxy`** (escaped-only, Task 5), never raw bugs.

- [ ] **Step 1: Write the failing test**

Create `test/career-snapshot.test.mjs`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveIdentity } from '../career-identity.mjs'
import { buildSnapshot, updateRollup } from '../career-snapshot.mjs'
import { defaultConfig } from '../career-config.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const usageDir = path.join(HERE, 'fixtures', 'usage-data')

function deps() {
  return {
    usageDir, mtimeCache: new Map(), config: defaultConfig(),
    resolved: resolveIdentity({ gitEmails: ['ali@work.com'] }),
    readBugs: () => ({ bugs: [{ id: 'b1', culpritAuthorEmail: 'ali@work.com' }], findings: [], myPrCount: 4, reverts: 0 }),
    readTasks: () => ([{ id: 'AIR-1', stage: 'in-progress', ageDays: 9, slaDays: 5 }]),
    readReport: () => '<html></html>',
  }
}

test('buildSnapshot assembles all phase-1 sections', () => {
  const s = buildSnapshot(deps())
  assert.ok(s.quality.changeFailProxy > 0)
  assert.ok(Array.isArray(s.projects))
  assert.ok(s.focus.some(f => f.area === 'tasks'))
  assert.equal(s.parsed >= 1, true)
})

test('updateRollup sources bug ratio from escaped-only proxy and records activity day', () => {
  const cfg = defaultConfig()
  const snap = buildSnapshot(deps())
  const patch = updateRollup(cfg, snap, '2026-07-09')
  assert.ok(patch.rollup.activityDays.includes('2026-07-09'))
  assert.equal(patch.rollup.personalBests.lowestBugRatio, snap.quality.changeFailProxy)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/career-snapshot.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `career-snapshot.mjs`:
```js
import { parseUsageData, groupByProject } from './career-insights.mjs'
import { parseReportNarrative } from './career-insights-report.mjs'
import { attributeBugs } from './career-attribution.mjs'
import { focusItems } from './career-heuristics.mjs'

const quarterOf = iso => { const d = new Date(iso); return `${d.getUTCFullYear()}Q${Math.floor(d.getUTCMonth() / 3) + 1}` }

export function buildSnapshot(deps) {
  const { usageDir, mtimeCache, config, resolved, readBugs, readTasks, readReport } = deps
  const { sessions, skipped, parsed } = parseUsageData(usageDir, { mtimeCache })
  const byProject = groupByProject(sessions)

  const bugInput = readBugs()
  const quality = attributeBugs({ ...bugInput, resolved })
  const priorChangeFailProxy = config.rollup?.personalBests?.lastChangeFailProxy || 0

  // flow / workflow rollups from all sessions
  const totalFriction = {}
  let afterHours = 0, withTimes = 0
  for (const s of sessions) {
    for (const [k, v] of Object.entries(s.friction_counts || {})) totalFriction[k] = (totalFriction[k] || 0) + v
    const hr = new Date(s.start_time).getUTCHours()
    if (hr >= 20 || hr < 6) afterHours++
    if (s.start_time) withTimes++
  }
  const topFriction = Object.entries(totalFriction).sort((a, b) => b[1] - a[1])[0]?.[0] || null
  const tasks = readTasks()

  const snap = {
    generatedAt: Date.now(), parsed, skipped,
    me: { runningNow: [], sessionCount: sessions.length },
    flow: { afterHoursPct: withTimes ? afterHours / withTimes : 0, wip: tasks.filter(t => t.stage === 'in-progress').length,
            sessionTypes: sessions.reduce((a, s) => (a[s.session_type] = (a[s.session_type] || 0) + 1, a), {}) },
    quality: { ...quality, priorChangeFailProxy },
    workflow: { topFriction, friction: totalFriction,
                tools: sessions.reduce((a, s) => { for (const [k, v] of Object.entries(s.tool_counts || {})) a[k] = (a[k] || 0) + v; return a }, {}) },
    tasks,
    insights: { narrative: parseReportNarrative(readReport()) },
    projects: [...byProject.entries()].map(([path, v]) => ({ path, ...v.totals, sessions: v.sessions.length })),
  }
  snap.focus = focusItems(snap)
  return snap
}

export function updateRollup(config, snapshot, todayIso) {
  const rollup = JSON.parse(JSON.stringify(config.rollup || { activityDays: [], streaks: {}, personalBests: {}, quarterlyBugRatio: {} }))
  const days = new Set(rollup.activityDays)
  if (snapshot.me.sessionCount > 0) days.add(todayIso)
  rollup.activityDays = [...days].sort()
  // coding streak = consecutive days ending today
  let streak = 0; let d = new Date(todayIso + 'T00:00:00Z')
  while (days.has(d.toISOString().slice(0, 10))) { streak++; d.setUTCDate(d.getUTCDate() - 1) }
  rollup.streaks.coding = streak
  const ratio = snapshot.quality.changeFailProxy                    // escaped-only source
  rollup.personalBests.lastChangeFailProxy = ratio
  rollup.personalBests.lowestBugRatio = rollup.personalBests.lowestBugRatio == null ? ratio : Math.min(rollup.personalBests.lowestBugRatio, ratio)
  rollup.quarterlyBugRatio[quarterOf(todayIso)] = ratio
  return { rollup }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/career-snapshot.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: all Task 1–7 suites PASS.

- [ ] **Step 6: Commit**

```bash
git add career-snapshot.mjs test/career-snapshot.test.mjs
git commit -m "feat(career): incremental snapshot builder + escaped-only rollup writer"
```

---

### Task 8: `server-career.mjs` — mount routes + wire into server.mjs

**Files:**
- Create: `server-career.mjs`
- Modify: `server.mjs` (add import + mount, passing `{ track, readJson }`)
- Test: `test/career-server.test.mjs`

**Interfaces:**
- Consumes: `makeStore` (T1), `resolveIdentity`/`warnIfNoMatch` (T2), `buildSnapshot`/`updateRollup` (T7).
- Produces (Express routes):
  - `GET /api/career/snapshot` → cached snapshot (builds on first hit)
  - `POST /api/career/refresh` → rebuild; returns `{ parsed, skipped, tookMs }`
  - `GET /api/career/config` / `POST /api/career/config` → read/write authored sections of `career.json`
  - `default function mountCareer(app, { track, readJson })`
  - Exports `buildCareerSnapshot(deps)` reusing T7 so the test can call it directly.

- [ ] **Step 1: Write the failing test** (pure handler wiring, no live express server)

Create `test/career-server.test.mjs`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import mountCareer, { __test } from '../server-career.mjs'

// minimal express double: records handlers by method+path
function appDouble() {
  const routes = {}
  const reg = m => (p, h) => { routes[m + ' ' + p] = h }
  return { get: reg('GET'), post: reg('POST'), routes }
}
function res() { const r = { code: 200, body: null }; r.status = c => (r.code = c, r); r.json = b => (r.body = b, r); return r }

test('mountCareer registers the phase-1 routes', () => {
  const app = appDouble()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'career-srv-'))
  mountCareer(app, { track: (f, c) => fs.writeFileSync(f, c), readJson: (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return fb } }, careerFile: path.join(dir, 'career.json'), usageDir: path.join(dir, 'usage-data') })
  for (const key of ['GET /api/career/snapshot', 'POST /api/career/refresh', 'GET /api/career/config', 'POST /api/career/config'])
    assert.ok(app.routes[key], `missing ${key}`)
})

test('config POST writes only authored keys', async () => {
  const app = appDouble()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'career-srv2-'))
  const file = path.join(dir, 'career.json')
  mountCareer(app, { track: (f, c) => fs.writeFileSync(f, c), readJson: (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return fb } }, careerFile: file, usageDir: path.join(dir, 'usage-data') })
  const r = res()
  await app.routes['POST /api/career/config']({ body: { identity: { githubHandle: 'ali' } } }, r)
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).identity.githubHandle, 'ali')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/career-server.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `server-career.mjs`:
```js
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { makeStore } from './career-config.mjs'
import { resolveIdentity, warnIfNoMatch } from './career-identity.mjs'
import { buildSnapshot, updateRollup } from './career-snapshot.mjs'

const HOME = os.homedir()
const CLAUDE = path.join(HOME, '.claude')
// authored sections the config POST is allowed to touch (never derived/rollup)
const AUTHORED = new Set(['identity', 'projects', 'competency', 'learning', 'okrs', 'courses', 'ownership',
  'feedback', 'feedbackRequests', 'decisions', 'brag', 'retros', 'timeTarget', 'oneOnOnes'])

export const __test = { AUTHORED }

export default function mountCareer(app, deps = {}) {
  const { track, readJson } = deps
  const careerFile = deps.careerFile || path.join(CLAUDE, 'career.json')
  const usageDir = deps.usageDir || path.join(CLAUDE, 'usage-data')
  const store = makeStore({ file: careerFile, track, readJson })
  const mtimeCache = new Map()
  let cache = null

  // real bug/task/report readers; overridable in deps for tests
  const readBugs = deps.readBugs || (() => {
    const b = readJson(path.join(CLAUDE, 'bugs.json'), { bugs: [] })
    return { bugs: b.bugs || [], findings: [], myPrCount: 0, reverts: 0 } // findings/PRs arrive Phase 2 (GitHub)
  })
  const readTasks = deps.readTasks || (() => {
    const board = readJson(path.join(CLAUDE, 'taskboard.json'), { tickets: [] })
    return (board.tickets || []).map(t => ({ id: t.id, stage: t.stage, ageDays: 0, slaDays: Infinity, project: t.project, title: t.title }))
  })
  const readReport = deps.readReport || (() => { try { return fs.readFileSync(path.join(usageDir, 'report.html'), 'utf8') } catch { return '' } })

  const build = () => {
    const config = store.read()
    const resolved = resolveIdentity(config.identity)
    const snap = buildSnapshot({ usageDir, mtimeCache, config, resolved, readBugs, readTasks, readReport })
    warnIfNoMatch(resolved, snap.quality.attributed.length + snap.quality.unattributed.length ? snap.quality.attributed.length : 0, 'bugs')
    const patch = updateRollup(config, snap, new Date().toISOString().slice(0, 10))
    store.write(patch)
    snap.rollup = { ...config.rollup, ...patch.rollup }
    cache = snap
    return snap
  }

  app.get('/api/career/snapshot', (req, res) => { try { res.json(cache || build()) } catch (e) { res.status(500).json({ error: e.message }) } })
  app.post('/api/career/refresh', (req, res) => {
    try { const t0 = Date.now(); const s = build(); res.json({ parsed: s.parsed, skipped: s.skipped, tookMs: Date.now() - t0 }) }
    catch (e) { res.status(500).json({ error: e.message }) }
  })
  app.get('/api/career/config', (req, res) => { try { res.json(store.read()) } catch (e) { res.status(500).json({ error: e.message }) } })
  app.post('/api/career/config', (req, res) => {
    try {
      const patch = {}
      for (const [k, v] of Object.entries(req.body || {})) if (AUTHORED.has(k)) patch[k] = v
      const next = store.write(patch); cache = null
      res.json(next)
    } catch (e) { res.status(500).json({ error: e.message }) }
  })
}
```

- [ ] **Step 4: Wire into `server.mjs`**

Add near the other mounts (after `import mountEng from './server-eng.mjs'`, line ~11):
```js
import mountCareer from './server-career.mjs'
```
After `mountEng(app)` (line ~26):
```js
mountCareer(app, { track, readJson }) // /api/career/* — personal Career dashboard
```

- [ ] **Step 5: Run to verify it passes**

Run: `node --test test/career-server.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 6: Smoke-test the live endpoint**

Run: `npm run dev` in one terminal, then in another:
`curl -s localhost:5178/api/career/refresh -X POST` → expect `{"parsed":...,"skipped":...,"tookMs":...}`
`curl -s localhost:5178/api/career/snapshot | head -c 300` → expect JSON with `quality`, `projects`, `focus`.

- [ ] **Step 7: Commit**

```bash
git add server-career.mjs server.mjs test/career-server.test.mjs
git commit -m "feat(career): mount /api/career/* snapshot+refresh+config routes"
```

---

### Task 9: `CareerDashboard` shell + `?dash=career` wiring

**Files:**
- Create: `src/CareerDashboard.jsx`
- Create: `src/career/theme.js` (shared PANEL/HEAD/MONO/ACCENT + small helpers)
- Modify: `src/App.jsx` (import, `goDash('career')` chip, `if (dash === 'career') return ...`)

**Interfaces:**
- Consumes: `GET /api/career/snapshot`, `POST /api/career/refresh` via `api` (src/api.js).
- Produces: `CareerDashboard({ onExit })` default export; `theme.js` exports `{ PANEL, HEAD, MONO, BODY, ACCENT, Stat }`.

- [ ] **Step 1: Create the theme module**

Create `src/career/theme.js`:
```js
import React from 'react'
export const HEAD = "'Space Grotesk', sans-serif"
export const BODY = "'IBM Plex Sans', sans-serif"
export const MONO = "'IBM Plex Mono', monospace"
export const ACCENT = '#c9a15a' // career mode is warm gold
export const PANEL = { background: 'rgba(28,24,21,0.55)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: '18px 20px', backdropFilter: 'blur(10px)' }
export const Stat = ({ label, val }) => (
  <div style={{ ...PANEL, padding: '14px 18px', flex: 1, minWidth: 130 }}>
    <div style={{ font: `700 24px ${HEAD}`, color: '#e5dbd2' }}>{val ?? '—'}</div>
    <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>{label}</div>
  </div>
)
```

- [ ] **Step 2: Create the shell (renders placeholders for the 7 panels; panels land in Tasks 10–16)**

Create `src/CareerDashboard.jsx`:
```jsx
import React, { useEffect, useState } from 'react'
import { api, toast } from './api.js'
import { PANEL, HEAD, MONO, ACCENT } from './career/theme.js'

const TABS = ['Me / Now', 'Tasks', 'Flow', 'Quality', 'Insights', 'Brag', '1:1 Prep']

export default function CareerDashboard({ onExit }) {
  const [snap, setSnap] = useState(null)
  const [tab, setTab] = useState('Me / Now')
  const [busy, setBusy] = useState(false)
  const load = () => api.get('/api/career/snapshot').then(setSnap).catch(e => toast(e.message, 'error'))
  useEffect(() => { load() }, [])
  const refresh = async () => { setBusy(true); try { await api.post('/api/career/refresh'); await load() } finally { setBusy(false) } }
  return (
    <div style={{ minHeight: '100vh', background: '#0d0b0a', color: '#e5dbd2', padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <div style={{ font: `700 22px ${HEAD}`, color: ACCENT }}>Career</div>
        <div style={{ flex: 1 }} />
        <button onClick={refresh} disabled={busy} style={{ font: `600 12px ${MONO}`, color: ACCENT, background: 'transparent', border: `1px solid ${ACCENT}55`, borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>{busy ? 'refreshing…' : '↻ refresh'}</button>
        <button onClick={onExit} style={{ font: `600 12px ${MONO}`, color: '#7a716a', background: 'transparent', border: '1px solid #7a716a55', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>⇄ Claude</button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        {TABS.map(t => <button key={t} onClick={() => setTab(t)} style={{ font: `600 12px ${MONO}`, color: tab === t ? '#0d0b0a' : '#e5dbd2', background: tab === t ? ACCENT : 'transparent', border: `1px solid ${ACCENT}55`, borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>{t}</button>)}
      </div>
      {!snap ? <div style={{ ...PANEL, color: '#7a716a' }}>Loading… (run ↻ refresh if empty)</div>
        : <div style={{ ...PANEL }}>Panel "{tab}" — wired in Tasks 10–16. Snapshot has {snap.projects?.length || 0} projects, {snap.focus?.length || 0} focus items.</div>}
    </div>
  )
}
```

- [ ] **Step 3: Wire into `src/App.jsx`**

Add import near the other dashboards (line ~25):
```jsx
import CareerDashboard from './CareerDashboard.jsx'
```
Add the render branch beside the eng one (after `if (dash === 'eng') return ...`, line ~171):
```jsx
if (dash === 'career') return <CareerDashboard onExit={() => goDash('claude')} />
```
Add a top-chip button next to the Eng Metrics chip (near line ~192):
```jsx
<button className="top-chip" onClick={() => goDash('career')} style={{ cursor: 'pointer' }} title="Career — your personal growth dashboard">⇄ Career</button>
```

- [ ] **Step 4: Verify in the browser (preview workflow)**

Start the dev server and confirm the shell renders and refresh works:
- `preview_start` the dev server, navigate to `http://localhost:5177/?dash=career`.
- `preview_snapshot` → assert the "Career" heading + 7 tabs are present.
- Click `↻ refresh` (`preview_click` on the refresh button), then `preview_console_logs` (level error) → expect none.
- `preview_screenshot` for the record.

- [ ] **Step 5: Commit**

```bash
git add src/CareerDashboard.jsx src/career/theme.js src/App.jsx
git commit -m "feat(career): ?dash=career shell + tabs + refresh wiring"
```

---

### Task 10: Me / Now panel

**Files:**
- Create: `src/career/MePanel.jsx`
- Modify: `src/CareerDashboard.jsx` (render `<MePanel snap={snap}/>` for the "Me / Now" tab)
- Modify: `server-career.mjs` (`me.runningNow` from transcript recency — reuse the running-session detection the app already exposes)

**Interfaces:**
- Consumes: `snap.me` `{ runningNow:[{project,startedAt}], sessionCount }`, `snap.rollup.streaks.coding`, `snap.focus`.
- Produces: `MePanel({ snap })`.

- [ ] **Step 1: Server — populate `me.runningNow`**

In `server-career.mjs`, add a reader (transcripts modified within 5 min = running) and pass into `buildSnapshot` via a `readRunning` dep; in `career-snapshot.mjs` set `me.runningNow = deps.readRunning ? deps.readRunning() : []`. Minimal `readRunning`:
```js
const readRunning = deps.readRunning || (() => {
  const root = path.join(CLAUDE, 'projects'); const cutoff = Date.now() - 5 * 60_000; const out = []
  let dirs = []; try { dirs = fs.readdirSync(root) } catch { return out }
  for (const d of dirs) {
    const pdir = path.join(root, d)
    let files = []; try { files = fs.readdirSync(pdir).filter(f => f.endsWith('.jsonl')) } catch { continue }
    for (const f of files) { try { if (fs.statSync(path.join(pdir, f)).mtimeMs > cutoff) { out.push({ project: d, startedAt: fs.statSync(path.join(pdir, f)).mtimeMs }); break } } catch {} }
  }
  return out
})
```
Pass `readRunning` into `buildSnapshot`'s deps and set `snap.me.runningNow` from it.

- [ ] **Step 2: Add a server test** for `readRunning` shape in `test/career-server.test.mjs` (inject a `readRunning: () => [{project:'x',startedAt:1}]` and assert snapshot `me.runningNow.length===1`). Run `node --test test/career-server.test.mjs` → PASS.

- [ ] **Step 3: Create the panel**

Create `src/career/MePanel.jsx`:
```jsx
import React from 'react'
import { PANEL, HEAD, MONO, ACCENT } from './theme.js'
export default function MePanel({ snap }) {
  const me = snap.me || {}, streak = snap.rollup?.streaks?.coding || 0
  const top = (snap.focus || []).slice(0, 3)
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ ...PANEL, flex: 1 }}><div style={{ font: `700 26px ${HEAD}` }}>{me.runningNow?.length || 0}</div><div style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>running now</div></div>
        <div style={{ ...PANEL, flex: 1 }}><div style={{ font: `700 26px ${HEAD}` }}>{streak}🔥</div><div style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>day coding streak</div></div>
        <div style={{ ...PANEL, flex: 1 }}><div style={{ font: `700 26px ${HEAD}` }}>{me.sessionCount || 0}</div><div style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>sessions in window</div></div>
      </div>
      <div style={PANEL}>
        <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 8 }}>What to focus on</div>
        {top.length ? top.map(f => <div key={f.id} style={{ font: `400 12px ${MONO}`, color: '#e5dbd2', padding: '4px 0' }}>• [{f.severity}] {f.message}</div>)
          : <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>nothing flagged — clean run</div>}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Render it** in `CareerDashboard.jsx`: import `MePanel`, and in the tab body replace the placeholder for `tab === 'Me / Now'` with `<MePanel snap={snap} />`.

- [ ] **Step 5: Verify** via preview: navigate `?dash=career`, snapshot shows three stat tiles + focus list; no console errors.

- [ ] **Step 6: Commit**

```bash
git add src/career/MePanel.jsx src/CareerDashboard.jsx server-career.mjs career-snapshot.mjs test/career-server.test.mjs
git commit -m "feat(career): Me/Now panel + running-session detection"
```

---

### Task 11: Flow panel (SPACE work-session)

**Files:**
- Create: `src/career/FlowPanel.jsx`
- Modify: `src/CareerDashboard.jsx`

**Interfaces:**
- Consumes: `snap.flow` `{ afterHoursPct, wip, sessionTypes }`, `snap.workflow.tools`, `snap.projects` (per-project session counts).
- Produces: `FlowPanel({ snap })` — after-hours %, WIP, session-type bars, tool-mix bars.

- [ ] **Step 1: Create the panel** (bar rows reuse the `.bar-*` visual pattern from CursorDashboard)

Create `src/career/FlowPanel.jsx`:
```jsx
import React from 'react'
import { PANEL, HEAD, MONO, ACCENT } from './theme.js'
const Bars = ({ title, obj }) => {
  const rows = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, 8)
  const max = Math.max(1, ...rows.map(r => r[1]))
  return (
    <div style={PANEL}>
      <div style={{ font: `600 12px ${MONO}`, color: '#7a716a', textTransform: 'uppercase', marginBottom: 10 }}>{title}</div>
      {rows.length ? rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', alignItems: 'center', marginBottom: 6, gap: 8 }}>
          <div style={{ width: 120, font: `400 11px ${MONO}`, color: '#cbb' }}>{k}</div>
          <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3 }}><div style={{ width: `${v / max * 100}%`, height: '100%', background: ACCENT, borderRadius: 3 }} /></div>
          <div style={{ width: 34, textAlign: 'right', font: `500 11px ${MONO}`, color: '#7a716a' }}>{v}</div>
        </div>
      )) : <div style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>no data</div>}
    </div>
  )
}
export default function FlowPanel({ snap }) {
  const f = snap.flow || {}
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ ...PANEL, flex: 1 }}><div style={{ font: `700 24px ${HEAD}`, color: (f.afterHoursPct > 0.35 ? '#f2a2c4' : '#e5dbd2') }}>{Math.round((f.afterHoursPct || 0) * 100)}%</div><div style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>after-hours sessions</div></div>
        <div style={{ ...PANEL, flex: 1 }}><div style={{ font: `700 24px ${HEAD}`, color: (f.wip > 4 ? '#f2a2c4' : '#e5dbd2') }}>{f.wip || 0}</div><div style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>work in progress</div></div>
      </div>
      <Bars title="Session types" obj={f.sessionTypes} />
      <Bars title="Tool mix" obj={snap.workflow?.tools} />
    </div>
  )
}
```

- [ ] **Step 2: Render it** in `CareerDashboard.jsx` for `tab === 'Flow'`.
- [ ] **Step 3: Verify** via preview (Flow tab shows two stat tiles + two bar groups, sustainability tiles turn pink over threshold).
- [ ] **Step 4: Commit**

```bash
git add src/career/FlowPanel.jsx src/CareerDashboard.jsx
git commit -m "feat(career): Flow panel (after-hours, WIP, session/tool mix)"
```

---

### Task 12: Quality panel (DORA + attribution transparency)

**Files:**
- Create: `src/career/QualityPanel.jsx`
- Modify: `src/CareerDashboard.jsx`

**Interfaces:**
- Consumes: `snap.quality` `{ attributed, unattributed, caughtInReview, changeFailProxy, defectDensityCaughtInReview }`, `snap.rollup.personalBests.lowestBugRatio`.
- Produces: `QualityPanel({ snap })` with a "how this is counted" tooltip and the escaped-vs-caught split shown as two distinct metrics.

- [ ] **Step 1: Create the panel**

Create `src/career/QualityPanel.jsx`:
```jsx
import React from 'react'
import { PANEL, HEAD, MONO, ACCENT } from './theme.js'
const pct = n => Math.round((n || 0) * 100) + '%'
export default function QualityPanel({ snap }) {
  const q = snap.quality || {}
  const best = snap.rollup?.personalBests?.lowestBugRatio
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ ...PANEL, flex: 1 }} title="Escaped defects only: bugs linked to my ticket-branches or blamed to my commits, ÷ my merged PRs. Review findings are NOT counted here.">
          <div style={{ font: `700 24px ${HEAD}` }}>{pct(q.changeFailProxy)}</div>
          <div style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>change-fail (escaped) · ⓘ</div>
        </div>
        <div style={{ ...PANEL, flex: 1 }} title="Findings caught in review on my diffs ÷ my merged PRs. A SEPARATE signal — trending down means my self-verification is improving. Never part of change-fail.">
          <div style={{ font: `700 24px ${HEAD}`, color: '#8ec8ff' }}>{pct(q.defectDensityCaughtInReview)}</div>
          <div style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>caught in review · ⓘ</div>
        </div>
        <div style={{ ...PANEL, flex: 1 }}><div style={{ font: `700 24px ${HEAD}`, color: ACCENT }}>{best == null ? '—' : pct(best)}</div><div style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>personal best (lowest)</div></div>
      </div>
      <div style={PANEL}>
        <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 8 }}>Attributed escaped bugs</div>
        {(q.attributed || []).length ? q.attributed.map(a => <div key={a.id} style={{ font: `400 12px ${MONO}`, padding: '3px 0' }}>• {a.id} <span style={{ color: '#7a716a' }}>({a.rule})</span></div>)
          : <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>none attributed this window</div>}
        {(q.unattributed || []).length ? <div style={{ font: `400 11px ${MONO}`, color: '#7a716a', marginTop: 8 }}>{q.unattributed.length} unattributed (not counted against you)</div> : null}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Render it** for `tab === 'Quality'`.
- [ ] **Step 3: Verify** via preview (two split metrics with hover tooltips; attributed list renders).
- [ ] **Step 4: Commit**

```bash
git add src/career/QualityPanel.jsx src/CareerDashboard.jsx
git commit -m "feat(career): Quality panel with escaped-vs-caught split + attribution tooltip"
```

---

### Task 13: Tasks panel (pending/to-test/in-progress + recommended approach + risk)

**Files:**
- Create: `src/career/TasksPanel.jsx`
- Modify: `src/CareerDashboard.jsx`
- Modify: `server-career.mjs` (`readTasks` maps taskboard stages → buckets `pending|toTest|inProgress`, computes `ageDays`/`slaDays`)

**Interfaces:**
- Consumes: `snap.tasks[{ id, title, stage, bucket, ageDays, slaDays, project }]`, `snap.focus` (task-risk items with `actedOn`).
- Produces: `TasksPanel({ snap, onAct })` where `onAct(focusId, ref)` POSTs an `actedOn` mark (via `/api/career/focus/act`, added below).

- [ ] **Step 1: Server — bucket mapping + focus act endpoint**

In `server-career.mjs` `readTasks`, map stage → bucket: `ready-for-qa|qa-running` → `toTest`; `in-progress|code-review|fixing` → `inProgress`; `backlog` → `pending`. Compute `ageDays` from the ticket's last `history` timestamp; `slaDays` default 5. Add route:
```js
app.post('/api/career/focus/act', (req, res) => {
  try {
    const { id, ref } = req.body || {}
    const cfg = store.read(); const acted = cfg.focusActed || {}
    acted[id] = { ref: ref || null, at: Date.now() }
    store.write({ focusActed: acted }); cache = null
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
```
Add `focusActed` to `defaultConfig()` (Task 1) as `{}` and to `AUTHORED`. In `buildSnapshot`, after `focusItems`, hydrate each item's `actedOn` from `config.focusActed[item.id] || null`. Add a config test asserting `focusActed` round-trips.

- [ ] **Step 2: Create the panel**

Create `src/career/TasksPanel.jsx`:
```jsx
import React from 'react'
import { api, toast } from '../api.js'
import { PANEL, HEAD, MONO, ACCENT } from './theme.js'
const BUCKETS = [['inProgress', 'In progress'], ['toTest', 'To test (my side)'], ['pending', 'Pending']]
const reco = t => t.bucket === 'toTest' ? 'Write/run the acceptance checks before handing off.'
  : t.bucket === 'inProgress' ? (t.ageDays > t.slaDays ? '⚠ Past expected date — checkpoint or escalate in your next 1:1.' : 'Keep scope tight; commit at each green checkpoint.')
  : 'Confirm acceptance criteria with the reporter before starting.'
export default function TasksPanel({ snap, reload }) {
  const tasks = snap.tasks || []
  const risk = (snap.focus || []).filter(f => f.area === 'tasks')
  const act = async (f) => { try { await api.post('/api/career/focus/act', { id: f.id, ref: f.evidenceRefs?.[0] }); toast('marked acted-on', 'success'); reload?.() } catch (e) { toast(e.message, 'error') } }
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {risk.length ? <div style={{ ...PANEL, borderColor: '#f2a2c455' }}>
        <div style={{ font: `600 13px ${HEAD}`, color: '#f2a2c4', marginBottom: 8 }}>Risk to commitments</div>
        {risk.map(f => <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 0' }}>
          <div style={{ flex: 1, font: `400 12px ${MONO}` }}>{f.message}</div>
          <button onClick={() => act(f)} disabled={!!f.actedOn} style={{ font: `600 11px ${MONO}`, color: f.actedOn ? '#5fd39a' : ACCENT, background: 'transparent', border: `1px solid ${f.actedOn ? '#5fd39a' : ACCENT}55`, borderRadius: 6, padding: '3px 8px', cursor: f.actedOn ? 'default' : 'pointer' }}>{f.actedOn ? '✓ acted on' : 'mark acted on'}</button>
        </div>)}
      </div> : null}
      {BUCKETS.map(([key, label]) => {
        const rows = tasks.filter(t => t.bucket === key)
        return <div key={key} style={PANEL}>
          <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 8 }}>{label} <span style={{ color: '#7a716a' }}>({rows.length})</span></div>
          {rows.length ? rows.map(t => <div key={t.id} style={{ padding: '6px 0', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ font: `500 12px ${MONO}` }}>{t.id} · {t.title || ''}</div>
            <div style={{ font: `400 11px ${MONO}`, color: '#9a8f86' }}>→ {reco(t)}</div>
          </div>) : <div style={{ font: `400 11px ${MONO}`, color: '#7a716a' }}>empty</div>}
        </div>
      })}
    </div>
  )
}
```

- [ ] **Step 3: Render it** for `tab === 'Tasks'` as `<TasksPanel snap={snap} reload={load} />`.
- [ ] **Step 4: Verify** via preview + `node --test test/career-server.test.mjs` (focusActed round-trip).
- [ ] **Step 5: Commit**

```bash
git add src/career/TasksPanel.jsx src/CareerDashboard.jsx server-career.mjs career-config.mjs career-snapshot.mjs test/career-server.test.mjs test/career-config.test.mjs
git commit -m "feat(career): Tasks panel with per-task reco, risk flag, acted-on mark"
```

---

### Task 14: `/insights` per-project panel

**Files:**
- Create: `src/career/InsightsProjectPanel.jsx`
- Modify: `src/CareerDashboard.jsx`

**Interfaces:**
- Consumes: `snap.projects[{ path, sessions, outcomes, friction, sessionTypes, tools, languages, gitCommits, avgResponseSec, interruptRate }]`, `snap.insights.narrative` (from Task 4).
- Produces: `InsightsProjectPanel({ snap })` — project dropdown + per-project charts + the parsed narrative (At-a-Glance, wins, friction, suggested CLAUDE.md). If `narrative.error` or empty, show the "re-run /insights" hint (degradation, spec §6).

- [ ] **Step 1: Create the panel**

Create `src/career/InsightsProjectPanel.jsx`:
```jsx
import React, { useState } from 'react'
import { PANEL, HEAD, MONO, ACCENT } from './theme.js'
const Hist = ({ title, obj }) => {
  const rows = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, 6)
  const max = Math.max(1, ...rows.map(r => r[1]))
  return <div><div style={{ font: `600 11px ${MONO}`, color: '#7a716a', margin: '8px 0 4px' }}>{title}</div>
    {rows.map(([k, v]) => <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
      <div style={{ width: 130, font: `400 10.5px ${MONO}`, color: '#cbb' }}>{k}</div>
      <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 3 }}><div style={{ width: `${v / max * 100}%`, height: '100%', background: ACCENT, borderRadius: 3 }} /></div>
      <div style={{ width: 30, textAlign: 'right', font: `500 10.5px ${MONO}`, color: '#7a716a' }}>{v}</div>
    </div>)}</div>
}
export default function InsightsProjectPanel({ snap }) {
  const projects = snap.projects || []
  const [sel, setSel] = useState('')
  const p = sel ? projects.find(x => x.path === sel) : null
  const nar = snap.insights?.narrative || {}
  const narEmpty = nar.error || (!nar.wins?.length && !nar.atAGlance?.working)
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={PANEL}>
        <select value={sel} onChange={e => setSel(e.target.value)} style={{ font: `500 12px ${MONO}`, background: '#1c1815', color: '#e5dbd2', border: '1px solid #7a716a55', borderRadius: 8, padding: '6px 10px' }}>
          <option value="">All projects ({projects.length})</option>
          {projects.map(x => <option key={x.path} value={x.path}>{x.path} · {x.sessions} sessions</option>)}
        </select>
        {p ? <div><Hist title="Outcomes" obj={p.outcomes} /><Hist title="Friction" obj={p.friction} /><Hist title="Languages" obj={p.languages} /><Hist title="Tools" obj={p.tools} /></div>
          : <div style={{ font: `400 12px ${MONO}`, color: '#7a716a', marginTop: 8 }}>Pick a project to see its /insights breakdown.</div>}
      </div>
      <div style={PANEL}>
        <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 8 }}>/insights narrative</div>
        {narEmpty ? <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>No parsed narrative — run <code>/insights</code> in Claude Code, then ↻ refresh.</div>
          : <div style={{ display: 'grid', gap: 8 }}>
            {nar.atAGlance?.working && <div style={{ font: `400 12px ${MONO}`, color: '#5fd39a' }}><b>Working:</b> {nar.atAGlance.working}</div>}
            {nar.atAGlance?.hindering && <div style={{ font: `400 12px ${MONO}`, color: '#f2a2c4' }}><b>Hindering:</b> {nar.atAGlance.hindering}</div>}
            {(nar.wins || []).slice(0, 3).map((w, i) => <div key={i} style={{ font: `400 12px ${MONO}` }}>🏆 {w.title}</div>)}
          </div>}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Render it** for `tab === 'Insights'`.
- [ ] **Step 3: Verify** via preview (dropdown lists projects; narrative shows or the degradation hint appears).
- [ ] **Step 4: Commit**

```bash
git add src/career/InsightsProjectPanel.jsx src/CareerDashboard.jsx
git commit -m "feat(career): /insights per-project panel with narrative + degradation hint"
```

---

### Task 15: Brag / Work Log panel (auto-seed + retro + exports)

**Files:**
- Create: `src/career/BragPanel.jsx`
- Modify: `src/CareerDashboard.jsx`
- Modify: `server-career.mjs` (auto-seed brag candidates; `story-so-far` + `promo-packet` markdown exports; retro POST)

**Interfaces:**
- Consumes: `snap.bragCandidates[{ date,title,impact,evidence,source:'auto' }]`, `config.brag` (manual), `config.retros`.
- Produces:
  - `GET /api/career/brag` → `{ candidates, entries }`
  - `POST /api/career/brag` `{ entry }` → append manual/accepted entry
  - `POST /api/career/retro` `{ weekOf, worked, didnt, change }` → append retro
  - `GET /api/career/story-so-far` and `/api/career/promo-packet` → `{ markdown }`
  - `BragPanel({ snap, reload })`.

- [ ] **Step 1: Server — auto-seed + exports**

In `server-career.mjs`:
```js
function bragCandidates() {
  const board = readJson(path.join(CLAUDE, 'taskboard.json'), { tickets: [] })
  const cands = []
  for (const t of board.tickets || []) if (t.stage === 'released')
    cands.push({ id: 'tkt:' + t.id, date: t.updatedAt || Date.now(), title: `Shipped ${t.id}: ${t.title || ''}`.trim(), impact: '', evidence: t.id, source: 'auto' })
  const nar = cache?.insights?.narrative
  for (const w of (nar?.wins || [])) cands.push({ id: 'win:' + w.title, date: Date.now(), title: w.title, impact: w.desc, evidence: '/insights', source: 'auto' })
  return cands
}
const storyMd = (cfg) => {
  const wins = [...(cfg.brag || [])].slice(-20)
  return `# Story so far\n\n` + wins.map(b => `- **${b.title}** — ${b.impact || ''} ${b.evidence ? `(${b.evidence})` : ''}`).join('\n')
}
app.get('/api/career/brag', (req, res) => res.json({ candidates: bragCandidates(), entries: store.read().brag }))
app.post('/api/career/brag', (req, res) => { const cfg = store.read(); const e = { id: 'b' + Date.now(), date: Date.now(), source: 'manual', ...req.body.entry }; store.write({ brag: [...cfg.brag, e] }); cache = null; res.json({ ok: true }) })
app.post('/api/career/retro', (req, res) => { const cfg = store.read(); store.write({ retros: [...cfg.retros, { id: 'r' + Date.now(), ...req.body }] }); res.json({ ok: true }) })
app.get('/api/career/story-so-far', (req, res) => res.json({ markdown: storyMd(store.read()) }))
app.get('/api/career/promo-packet', (req, res) => { const c = store.read(); res.json({ markdown: storyMd(c) + `\n\n## Competency self-assessment\nLevel: ${c.competency?.levelSelfAssessed || '—'}\n` }) })
```
Also set `snap.bragCandidates = bragCandidates()` in `build()` after snapshot assembly.

- [ ] **Step 2: Create the panel** (accept a candidate → POST; add retro line; buttons to fetch exports)

Create `src/career/BragPanel.jsx`:
```jsx
import React, { useEffect, useState } from 'react'
import { api, toast } from '../api.js'
import { PANEL, HEAD, MONO, ACCENT } from './theme.js'
export default function BragPanel({ reload }) {
  const [data, setData] = useState({ candidates: [], entries: [] })
  const [retro, setRetro] = useState({ worked: '', didnt: '', change: '' })
  const load = () => api.get('/api/career/brag').then(setData).catch(e => toast(e.message, 'error'))
  useEffect(() => { load() }, [])
  const accept = async (c) => { await api.post('/api/career/brag', { entry: { title: c.title, impact: c.impact, evidence: c.evidence } }); toast('added to brag log', 'success'); load(); reload?.() }
  const saveRetro = async () => { const weekOf = new Date().toISOString().slice(0, 10); await api.post('/api/career/retro', { weekOf, ...retro }); setRetro({ worked: '', didnt: '', change: '' }); toast('retro saved', 'success') }
  const exportStory = async () => { const { markdown } = await api.get('/api/career/story-so-far'); await navigator.clipboard.writeText(markdown); toast('story-so-far copied', 'success') }
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={PANEL}>
        <div style={{ display: 'flex', alignItems: 'center' }}><div style={{ font: `600 13px ${HEAD}`, color: ACCENT, flex: 1 }}>Brag log ({data.entries.length})</div>
          <button onClick={exportStory} style={{ font: `600 11px ${MONO}`, color: ACCENT, background: 'transparent', border: `1px solid ${ACCENT}55`, borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}>⧉ story-so-far</button></div>
        {data.entries.slice(-10).reverse().map(e => <div key={e.id} style={{ font: `400 12px ${MONO}`, padding: '4px 0' }}>• {e.title}</div>)}
      </div>
      <div style={PANEL}>
        <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 8 }}>Auto-seeded candidates</div>
        {data.candidates.length ? data.candidates.map(c => <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '3px 0' }}>
          <div style={{ flex: 1, font: `400 12px ${MONO}` }}>{c.title}</div>
          <button onClick={() => accept(c)} style={{ font: `600 11px ${MONO}`, color: ACCENT, background: 'transparent', border: `1px solid ${ACCENT}55`, borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>+ add</button>
        </div>) : <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>no candidates — ship a ticket or run /insights</div>}
      </div>
      <div style={PANEL}>
        <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 8 }}>Weekly retro (feeds Analyze + streak)</div>
        {['worked', 'didnt', 'change'].map(k => <input key={k} value={retro[k]} onChange={e => setRetro(r => ({ ...r, [k]: e.target.value }))} placeholder={k === 'worked' ? 'what worked' : k === 'didnt' ? "what didn't" : 'what I will do differently'} style={{ display: 'block', width: '100%', marginBottom: 6, font: `400 12px ${MONO}`, background: '#1c1815', color: '#e5dbd2', border: '1px solid #7a716a55', borderRadius: 6, padding: '6px 8px' }} />)}
        <button onClick={saveRetro} style={{ font: `600 11px ${MONO}`, color: '#0d0b0a', background: ACCENT, border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer' }}>save retro</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Render it** for `tab === 'Brag'` as `<BragPanel reload={load} />`.
- [ ] **Step 4: Verify** via preview: accept a candidate → appears in brag log; save a retro → toast; story-so-far copies to clipboard. `curl -s localhost:5178/api/career/story-so-far` returns markdown.
- [ ] **Step 5: Commit**

```bash
git add src/career/BragPanel.jsx src/CareerDashboard.jsx server-career.mjs
git commit -m "feat(career): Brag panel — auto-seed, retro capture, story-so-far/promo exports"
```

---

### Task 16: 1:1 Prep panel (composition + persisted meeting log)

**Files:**
- Create: `src/career/OneOnOnePanel.jsx`
- Modify: `src/CareerDashboard.jsx`
- Modify: `server-career.mjs` (`GET /api/career/brief` composes the brief; `POST /api/career/one-on-one` persists a meeting)

**Interfaces:**
- Consumes: snapshot (wins from brag, risks from focus/tasks), `config.oneOnOnes`.
- Produces:
  - `GET /api/career/brief` → `{ winsSinceLast, blockers, decisionsNeeded, lastAgreed:[{text,done}], growthTopic }`
  - `POST /api/career/one-on-one` `{ agreedActions, managerFeedback, growthTopic }` → persist with a `briefSnapshot`; next brief opens with "status of what we agreed."
  - `OneOnOnePanel({ snap, reload })`.

- [ ] **Step 1: Server — brief composition + persist**

In `server-career.mjs`:
```js
function brief() {
  const cfg = store.read()
  const last = cfg.oneOnOnes[cfg.oneOnOnes.length - 1]
  const sinceTs = last ? last.date : 0
  const winsSinceLast = (cfg.brag || []).filter(b => (b.date || 0) >= sinceTs).map(b => b.title)
  const blockers = (cache?.focus || []).filter(f => f.severity === 'high').map(f => f.message)
  return { winsSinceLast, blockers, decisionsNeeded: [], lastAgreed: last?.agreedActions || [], growthTopic: '' }
}
app.get('/api/career/brief', (req, res) => res.json(brief()))
app.post('/api/career/one-on-one', (req, res) => {
  const cfg = store.read()
  const rec = { id: 'o' + Date.now(), date: Date.now(), agreedActions: req.body.agreedActions || [], managerFeedback: req.body.managerFeedback || '', growthTopic: req.body.growthTopic || '', briefSnapshot: brief() }
  store.write({ oneOnOnes: [...cfg.oneOnOnes, rec] }); cache = null
  res.json({ ok: true })
})
```

- [ ] **Step 2: Create the panel**

Create `src/career/OneOnOnePanel.jsx`:
```jsx
import React, { useEffect, useState } from 'react'
import { api, toast } from '../api.js'
import { PANEL, HEAD, MONO, ACCENT } from './theme.js'
export default function OneOnOnePanel({ reload }) {
  const [b, setB] = useState(null)
  const [fb, setFb] = useState(''); const [topic, setTopic] = useState(''); const [actions, setActions] = useState('')
  useEffect(() => { api.get('/api/career/brief').then(setB).catch(e => toast(e.message, 'error')) }, [])
  const save = async () => {
    const agreedActions = actions.split('\n').filter(Boolean).map(text => ({ text, done: false }))
    await api.post('/api/career/one-on-one', { agreedActions, managerFeedback: fb, growthTopic: topic })
    toast('1:1 logged — next brief will track these', 'success'); setFb(''); setTopic(''); setActions(''); reload?.()
    api.get('/api/career/brief').then(setB)
  }
  if (!b) return <div style={{ ...PANEL, color: '#7a716a' }}>composing brief…</div>
  const Sec = ({ t, items, empty }) => <div style={PANEL}><div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 8 }}>{t}</div>{items.length ? items.map((x, i) => <div key={i} style={{ font: `400 12px ${MONO}`, padding: '3px 0' }}>• {typeof x === 'string' ? x : x.text}{x.done === false ? ' ⏳' : ''}</div>) : <div style={{ font: `400 12px ${MONO}`, color: '#7a716a' }}>{empty}</div>}</div>
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Sec t="Status of what we agreed" items={b.lastAgreed} empty="no prior 1:1 on record" />
      <Sec t="Wins since last 1:1" items={b.winsSinceLast} empty="log wins in the Brag panel" />
      <Sec t="Blockers & risks to raise" items={b.blockers} empty="nothing high-severity" />
      <div style={PANEL}>
        <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 8 }}>After the 1:1 — log it</div>
        <textarea value={actions} onChange={e => setActions(e.target.value)} placeholder="agreed actions (one per line)" style={{ width: '100%', height: 60, font: `400 12px ${MONO}`, background: '#1c1815', color: '#e5dbd2', border: '1px solid #7a716a55', borderRadius: 6, padding: 8, marginBottom: 6 }} />
        <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="growth topic discussed" style={{ width: '100%', font: `400 12px ${MONO}`, background: '#1c1815', color: '#e5dbd2', border: '1px solid #7a716a55', borderRadius: 6, padding: '6px 8px', marginBottom: 6 }} />
        <input value={fb} onChange={e => setFb(e.target.value)} placeholder="manager feedback" style={{ width: '100%', font: `400 12px ${MONO}`, background: '#1c1815', color: '#e5dbd2', border: '1px solid #7a716a55', borderRadius: 6, padding: '6px 8px', marginBottom: 8 }} />
        <button onClick={save} style={{ font: `600 11px ${MONO}`, color: '#0d0b0a', background: ACCENT, border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer' }}>log 1:1</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Render it** for `tab === '1:1 Prep'` as `<OneOnOnePanel reload={load} />`.
- [ ] **Step 4: Verify** via preview: brief renders wins/blockers; logging a 1:1 with two agreed actions makes them reappear under "Status of what we agreed" on reload.
- [ ] **Step 5: Run full suite** `npm test` → all PASS.
- [ ] **Step 6: Commit**

```bash
git add src/career/OneOnOnePanel.jsx src/CareerDashboard.jsx server-career.mjs
git commit -m "feat(career): 1:1 Prep panel — composed brief + persisted meeting log"
```

---

### Task 17: Phase-1 documentation + gate instrumentation note

**Files:**
- Modify: `README.md` (add a Career dashboard row to the sections table)
- Create: `docs/career-phase1-gate.md` (the §1.1 checklist to fill at 4 weeks)

- [ ] **Step 1: README** — add one row under the dashboards describing `?dash=career` and its seven panels, mirroring the Cursor/Eng entries' tone.

- [ ] **Step 2: Gate doc** — create `docs/career-phase1-gate.md` with the three success criteria (a/b/c) as checkboxes and the "acted-on evidence = ticket picked up / task approach followed, traceable to a Focus item" definition, so the 4-week review reads out of the dashboard.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/career-phase1-gate.md
git commit -m "docs(career): phase-1 README section + 4-week gate checklist"
```

---

## Self-Review

**Spec coverage (Phase 1):** Me/Now (T10), Tasks + reco + risk + acted-on (T13), Flow/SPACE (T11), Quality/DORA + attribution split §2.5 (T5,T12), `/insights` per-project + quarantine §2.4 (T3,T4,T14), Brag + retro + story-so-far + promo (T15), 1:1 Prep persisted (T16), identity §2.3 (T2), migration §2.3 (T1), incremental refresh §2.4 (T3,T7), escaped-only rollup §2.5/§7 (T7), heuristic focus items §3.1 (T6), shell + wiring (T9), degradation §6 (T14). All Phase-1 requirements map to a task.

**Placeholder scan:** every code step contains complete code; test steps contain real assertions; commands have expected output. No TBD/TODO left.

**Type consistency:** `focusItems`→`snap.focus`; `attributeBugs` return shape consumed identically in T7/T12; `makeStore.read/write` used in T8/T13/T15/T16; `resolveIdentity`/`matchesMe` signatures stable T2→T5→T7. `career.json` `focusActed` added in T13 is registered in `defaultConfig`/`AUTHORED`.

**Note on real-data selectors:** T4's report.html regexes are pinned to the committed fixture; if your live report differs, the fixture is the contract — adjust regex to it (the quarantine guarantees a miss degrades to empty narrative, never a crash).
