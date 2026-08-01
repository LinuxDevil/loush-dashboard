// lib/repo-complexity.mjs — a deterministic 0-6 complexity score for a real checkout, plus an
// over-engineering audit that cross-references INSTALLED capabilities against ones that have
// actually FIRED.
//
// WHY THIS EXISTS, AND WHAT IT REFUSES TO SAY
//
// The tempting headline is "you have 23 skills installed, 14 have never fired." It is a great
// sentence and, as stated, an unsupportable accusation. "Never fired" is a claim about all of
// history; what we actually have is a pile of transcripts covering some window, plus a `skillUsage`
// map in ~/.claude.json that — by construction — only contains skills that HAVE fired. Neither is a
// complete record of non-events. Three specific ways the naive number is wrong:
//
//   * THE CAPABILITY PREDATES THE RECORD, or the record predates the capability. A skill installed
//     yesterday cannot have fired in last month's transcripts. Counting that as "never fired"
//     charges it for a window it did not exist in.
//   * THE RECORD IS INCOMPLETE. Transcripts get deleted, rotated, and live on other machines.
//     `skillUsage` counts only invocations the CLI happened to log. Absence of a record is not a
//     record of absence.
//   * THE OBSERVATION WINDOW IS ITSELF DERIVED. It comes from the timestamps we happen to hold. On
//     this machine that is barely a day. "Unused in a 1-day window" is nearly no information, and
//     rendering it as "14 unused skills" launders that into a recommendation.
//
// So this module reports `noRecordedInvocation`, never `unused`; it always reports the observation
// window and its provenance; and when the window is unknown it returns null with a reason rather
// than a confident count. `provenUnusedCount` is hard-wired to 0 with an explanation, because with
// this evidence it can never be anything else.
//
// DETERMINISM
// Same repo in, same score out. `scoreComplexity()` is pure: no Date.now(), no Math.random(), no
// mtimes, no environment, no filesystem order dependence (directory entries are sorted). Time only
// ever enters the AUDIT, and there it is an explicit `now` parameter so a test can pin it.

import fs from 'node:fs'
import path from 'node:path'

export const DEFAULT_LIMITS = {
  maxFiles: 20000,
  maxDepth: 16,
}

// Directories that describe the toolchain, not the codebase. Counting node_modules would make every
// repo maximally complex and the score useless.
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.cache', '.venv', '__pycache__', 'vendor'])

/** True when `dir` is the root of another git repository (submodule, vendored copy, worktree).
 * A worktree's `.git` is a FILE containing a gitdir pointer, not a directory, so both are checked. */
function isNestedCheckout(dir, fs) {
  try { fs.statSync(path.join(dir, '.git')); return true } catch { return false }
}

const SOURCE_EXT = new Set(['.mjs', '.cjs', '.js', '.jsx', '.ts', '.tsx', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.php', '.cs', '.swift', '.scala', '.sh', '.css', '.scss', '.vue', '.svelte'])
const TEST_RE = /(^|[.\-/])(test|spec)\.[a-z]+$|(^|\/)(tests?|__tests__)\//i

// ---------------------------------------------------------------------------
// THE RUBRIC. Six independent dimensions, each worth exactly 1 point, each measured from a stated
// artifact on disk. Thresholds are declared here (not buried in the scorer) so that a score can be
// argued with — which is the only thing that makes a number like "4/6" worth printing.
// ---------------------------------------------------------------------------
export const RUBRIC = [
  { key: 'breadth', label: 'Code breadth',
    measuredFrom: 'count of source files (known source extensions, excluding node_modules/.git/dist/build)',
    threshold: 100, unit: 'files',
    rationale: 'a repo you can hold in your head is not complex regardless of what else is true' },
  { key: 'languageMix', label: 'Language / file-type mix',
    measuredFrom: 'count of DISTINCT source extensions present',
    threshold: 3, unit: 'distinct extensions',
    rationale: 'each additional language is another toolchain, another lint config, another way to be wrong' },
  { key: 'dependencyLoad', label: 'Third-party dependency surface',
    measuredFrom: 'package.json dependencies + devDependencies (declared, not installed)',
    threshold: 10, unit: 'declared packages',
    rationale: 'dependencies are code you own the failure modes of but not the source of' },
  { key: 'structuralDepth', label: 'Structural depth',
    measuredFrom: 'maximum directory nesting depth of any counted file, relative to the repo root',
    threshold: 5, unit: 'path segments',
    rationale: 'deep trees mean navigation cost and usually mean layered indirection' },
  { key: 'automation', label: 'Build / CI automation surface',
    measuredFrom: 'CI workflow files + npm scripts + build-config files (vite/webpack/rollup/tsconfig/babel/docker/Makefile)',
    threshold: 6, unit: 'automation artifacts',
    rationale: 'every pipeline step is a thing that can break independently of the code' },
  { key: 'testSurface', label: 'Test surface',
    measuredFrom: 'count of files matching *.test.* / *.spec.* or living under test/ tests/ __tests__/',
    threshold: 10, unit: 'test files',
    rationale: 'a large test suite is both a complexity SYMPTOM and a complexity COST to maintain' },
]

export const MAX_SCORE = RUBRIC.length

// ---------------------------------------------------------------------------
// Evidence gathering. Filesystem only, bounded, never throws.
// Returns raw counts; scoring is a separate pure step so the score can be tested without a disk.
// ---------------------------------------------------------------------------
export function gatherRepoEvidence(root, limits = {}) {
  const L = { ...DEFAULT_LIMITS, ...limits }
  const bounds = []
  const ev = {
    root, rootReadable: false,
    sourceFiles: 0, extensions: {}, maxDepth: 0, testFiles: 0,
    totalFilesSeen: 0, deniedDirs: 0,
    // Reported, not silently dropped: a reader must be able to see that a vendored checkout was
    // excluded, otherwise a suspiciously low count looks like a broken walk.
    nestedCheckoutsSkipped: [],
    packageJson: { found: false, dependencies: null, devDependencies: null, scripts: null, parseError: null },
    ciWorkflows: 0, buildConfigs: [],
    unreadable: [],
  }
  let filesHit = false, depthHit = false

  const walk = (dir, depth) => {
    if (depth > L.maxDepth) { depthHit = true; return }
    if (ev.totalFilesSeen >= L.maxFiles) { filesHit = true; return }
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { ev.deniedDirs++; return }
    // Sorting makes the traversal order — and therefore anything order-sensitive downstream —
    // identical on every filesystem and every run. This is half of "deterministic".
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue
        const sub = path.join(dir, e.name)
        // A directory containing `.git` is a SEPARATE repository — a submodule, a vendored
        // checkout, or a git worktree. Its files are not this repo's, and counting them inflates
        // every dimension: this repo scored 5/6 on 1557 "source files", of which ~1250 were eight
        // agent worktrees under .claude/worktrees holding copies of the same 300 files.
        //
        // It also breaks the determinism this module claims, because the score then depends on
        // whether someone happens to have a worktree checked out when it runs. Name-based skips
        // cannot fix that; the presence of `.git` is the actual signal.
        if (isNestedCheckout(sub, fs)) { ev.nestedCheckoutsSkipped.push(path.relative(root, sub)); continue }
        walk(sub, depth + 1)
        continue
      }
      if (!e.isFile()) continue
      if (ev.totalFilesSeen >= L.maxFiles) { filesHit = true; return }
      ev.totalFilesSeen++
      const rel = path.relative(root, path.join(dir, e.name))
      const ext = path.extname(e.name).toLowerCase()
      if (TEST_RE.test(rel.split(path.sep).join('/'))) ev.testFiles++
      if (SOURCE_EXT.has(ext)) {
        ev.sourceFiles++
        ev.extensions[ext] = (ev.extensions[ext] || 0) + 1
        ev.maxDepth = Math.max(ev.maxDepth, rel.split(path.sep).length)
      }
    }
  }

  try { ev.rootReadable = fs.statSync(root).isDirectory() } catch { ev.rootReadable = false }
  if (!ev.rootReadable) return { ...ev, bounds, reason: `repo root is not a readable directory: ${root}` }

  walk(root, 0)

  // package.json — a missing or malformed one is RECORDED, not defaulted to zero deps. Treating an
  // unreadable manifest as "0 dependencies" would score a broken checkout as pleasingly simple.
  const pkgPath = path.join(root, 'package.json')
  try {
    const raw = fs.readFileSync(pkgPath, 'utf8')
    try {
      const pkg = JSON.parse(raw)
      ev.packageJson = {
        found: true, parseError: null,
        dependencies: Object.keys(pkg.dependencies || {}).length,
        devDependencies: Object.keys(pkg.devDependencies || {}).length,
        scripts: Object.keys(pkg.scripts || {}).length,
      }
    } catch (e) { ev.packageJson = { found: true, parseError: e.message, dependencies: null, devDependencies: null, scripts: null } }
  } catch { ev.packageJson.found = false }

  for (const dir of ['.github/workflows', '.gitlab-ci', '.circleci']) {
    try { ev.ciWorkflows += fs.readdirSync(path.join(root, dir)).filter(f => /\.(ya?ml)$/.test(f)).length } catch { /* absent is normal */ }
  }
  for (const f of ['vite.config.js', 'vite.config.mjs', 'vite.config.ts', 'webpack.config.js', 'rollup.config.js',
    'tsconfig.json', 'babel.config.js', '.babelrc', 'Dockerfile', 'docker-compose.yml', 'Makefile',
    'eslint.config.js', '.eslintrc.json', '.eslintrc.js', 'jest.config.js', 'playwright.config.js']) {
    try { if (fs.statSync(path.join(root, f)).isFile()) ev.buildConfigs.push(f) } catch { /* absent is normal */ }
  }
  ev.buildConfigs.sort()

  if (filesHit) bounds.push({ what: 'files walked', limit: L.maxFiles, hit: true, note: 'counts are a LOWER BOUND; the score may understate complexity' })
  if (depthHit) bounds.push({ what: 'directory depth', limit: L.maxDepth, hit: true, note: 'deeper files were not counted' })
  if (ev.deniedDirs) bounds.push({ what: 'unreadable directories', limit: null, hit: true, count: ev.deniedDirs, note: 'their contents are missing from every count below' })

  return { ...ev, bounds, reason: null }
}

// ---------------------------------------------------------------------------
// Pure scorer. evidence -> {score, dimensions[]}
// Any dimension whose evidence is unavailable scores null and is EXCLUDED from the total, and the
// total is reported out of the number of dimensions that could actually be measured. Defaulting an
// unmeasurable dimension to 0 would report a broken scan as a simple repo.
// ---------------------------------------------------------------------------
export function scoreComplexity(evidence) {
  // `rootReadable === true` and not an array: anything else (null, a string, an array, a bare {})
  // is not evidence. Accepting a shape that merely LOOKS object-ish would let `scoreComplexity([])`
  // return 0/6 — a fabricated "this repo is simple" from no evidence at all.
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence) || evidence.rootReadable !== true) {
    return {
      score: null, maxScore: MAX_SCORE, dimensionsMeasured: 0,
      reason: (evidence && evidence.reason) || 'no readable evidence was gathered',
      dimensions: RUBRIC.map(r => ({ key: r.key, label: r.label, measuredFrom: r.measuredFrom, threshold: r.threshold, unit: r.unit, measured: null, met: null, because: 'repo evidence unavailable' })),
      bounds: (evidence && evidence.bounds) || [],
    }
  }

  const pkg = evidence.packageJson || {}
  const depTotal = pkg.dependencies == null || pkg.devDependencies == null ? null : pkg.dependencies + pkg.devDependencies
  const automation = (evidence.ciWorkflows || 0) + (pkg.scripts == null ? 0 : pkg.scripts) + (evidence.buildConfigs || []).length
  const automationKnown = pkg.scripts != null || !pkg.found

  const measurements = {
    breadth: { value: evidence.sourceFiles, detail: `${evidence.sourceFiles} source files of ${evidence.totalFilesSeen} files seen` },
    languageMix: { value: Object.keys(evidence.extensions || {}).length,
      detail: Object.entries(evidence.extensions || {}).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([e, n]) => `${e}:${n}`).join(' ') },
    dependencyLoad: { value: depTotal,
      detail: depTotal == null
        ? (pkg.found ? `package.json present but unparseable (${pkg.parseError})` : 'no package.json found')
        : `${pkg.dependencies} dependencies + ${pkg.devDependencies} devDependencies` },
    structuralDepth: { value: evidence.maxDepth, detail: `deepest counted source file is ${evidence.maxDepth} path segments from the root` },
    automation: { value: automationKnown ? automation : null,
      detail: `${evidence.ciWorkflows} CI workflow file(s) + ${pkg.scripts ?? '?'} npm script(s) + ${(evidence.buildConfigs || []).length} build config(s)${evidence.buildConfigs?.length ? ` [${evidence.buildConfigs.join(', ')}]` : ''}` },
    testSurface: { value: evidence.testFiles, detail: `${evidence.testFiles} files matched the test-file pattern` },
  }

  const dimensions = RUBRIC.map(r => {
    const m = measurements[r.key]
    const measured = m.value
    return {
      key: r.key, label: r.label, measuredFrom: r.measuredFrom,
      threshold: r.threshold, unit: r.unit, rationale: r.rationale,
      measured, evidence: m.detail,
      met: measured == null ? null : measured >= r.threshold,
      because: measured == null ? 'the underlying evidence could not be read; this dimension is EXCLUDED from the score rather than counted as 0' : null,
      points: measured == null ? null : (measured >= r.threshold ? 1 : 0),
    }
  })

  const scorable = dimensions.filter(d => d.points != null)
  const score = scorable.reduce((s, d) => s + d.points, 0)

  return {
    score,
    maxScore: MAX_SCORE,
    dimensionsMeasured: scorable.length,
    // If some dimension could not be measured, the score is out of fewer than 6 and says so. The
    // headline stays honest instead of quietly grading on a curve.
    scoreOutOf: scorable.length,
    complete: scorable.length === MAX_SCORE,
    incompleteNote: scorable.length === MAX_SCORE ? null
      : `only ${scorable.length} of ${MAX_SCORE} dimensions could be measured — the score is out of ${scorable.length}, not ${MAX_SCORE}, and is a LOWER BOUND`,
    dimensions,
    bounds: evidence.bounds || [],
    reason: null,
  }
}

/** Convenience: gather + score. Deterministic for a fixed tree. */
export function complexityOf(root, limits = {}) {
  return scoreComplexity(gatherRepoEvidence(root, limits))
}

// ---------------------------------------------------------------------------
// OVER-ENGINEERING AUDIT
//
// installed:    [{ kind, name, installedAt?: epoch-ms|null, alwaysOnTokens?: number|null }]
// invocations:  [{ kind, name, t: epoch-ms }]   — every recorded firing we can see
// window:       { start, end, source }          — the span the invocation record actually covers
// recordCompleteness: 'complete' | 'partial' | 'unknown'  (default 'unknown' — the honest default)
// ---------------------------------------------------------------------------
export function auditOverEngineering(args) {
  // A default parameter only fires on `undefined`; `auditOverEngineering(null)` would destructure
  // null and throw. Upstream readers legitimately return null on a failed read.
  const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {}
  const { installed = [], invocations = [], window = null, recordCompleteness = 'unknown', now = null } = a
  const inst = Array.isArray(installed) ? installed.filter(i => i && typeof i.name === 'string') : []
  const invs = Array.isArray(invocations) ? invocations.filter(i => i && typeof i.name === 'string' && Number.isFinite(i.t)) : []

  const caveats = [
    'A capability with no recorded invocation is NOT proven unused. It is a capability with no recorded invocation — a statement about the record, not about the capability.',
    `Invocation-record completeness is "${recordCompleteness}". Transcripts can be deleted, rotated, or made on another machine, and ~/.claude.json skillUsage only ever lists capabilities that HAVE fired, so it can never evidence non-use.`,
    'Capabilities installed after the window opened could not have fired for the whole window; they are flagged `installedAfterWindowStart` and should not be judged on it.',
    'Capabilities with an unknown install date cannot be placed relative to the window at all; they are flagged `installDateUnknown`.',
  ]

  // No window means we do not know what span the "never fired" claim would even cover. The count is
  // then meaningless and is returned as null. This is the branch that stops the headline from being
  // manufactured out of an empty transcript directory.
  if (!window || !Number.isFinite(window.start) || !Number.isFinite(window.end) || window.end < window.start) {
    return {
      installedCount: inst.length,
      withRecordedInvocation: null,
      noRecordedInvocationCount: null,
      provenUnusedCount: 0,
      headline: null,
      reason: 'observation-window-unknown',
      because: 'no valid observation window was supplied, so "has not fired" has no span to be true over. A count without a window is an accusation that cannot be defended.',
      observationWindow: null,
      items: [], caveats,
    }
  }

  const windowDays = (window.end - window.start) / 86400_000
  const fired = new Map()
  let outsideWindow = 0
  for (const v of invs) {
    if (v.t < window.start || v.t > window.end) { outsideWindow++; continue }
    const k = `${v.kind || '*'}:${v.name}`
    const f = fired.get(k) || { count: 0, last: 0, first: Infinity }
    f.count++; f.last = Math.max(f.last, v.t); f.first = Math.min(f.first, v.t)
    fired.set(k, f)
  }

  const items = inst.map(i => {
    const k = `${i.kind || '*'}:${i.name}`
    const f = fired.get(k) || null
    const installedAt = Number.isFinite(i.installedAt) ? i.installedAt : null
    const installedAfterWindowStart = installedAt == null ? null : installedAt > window.start
    // How much of the window this capability actually existed for. A skill installed 2 hours into a
    // 3-hour window has had 1 hour of exposure; "never fired" over 1 hour is not a finding.
    const observedDays = installedAt == null ? null
      : Math.max(0, (window.end - Math.max(window.start, installedAt)) / 86400_000)
    return {
      kind: i.kind || null, name: i.name,
      alwaysOnTokens: Number.isFinite(i.alwaysOnTokens) ? i.alwaysOnTokens : null,
      installedAt,
      installDateUnknown: installedAt == null,
      installedAfterWindowStart,
      observedDays: observedDays == null ? null : Math.round(observedDays * 100) / 100,
      recordedInvocations: f ? f.count : 0,
      lastRecordedInvocation: f ? f.last : null,
      // Deliberately NOT called `unused`. The name of the field is the argument.
      noRecordedInvocation: !f,
      // The only thing we can say with confidence, and it is a conditional.
      claim: f
        ? `fired ${f.count}x within the observed window`
        : `no invocation recorded in the ${windowDays.toFixed(2)}-day observed window${observedDays != null ? ` (of which it existed for ${observedDays.toFixed(2)} days)` : '; install date unknown, so its exposure to the window is unknown'}`,
    }
  })

  // Invocations naming capabilities that are NOT in the installed set. Observed for real on this
  // machine: `claude-api` fired twice but does not exist under ~/.claude/skills, because managed and
  // plugin-supplied skills are not on local disk. This matters twice over — the installed list is
  // demonstrably not the whole capability set, and if it under-counts installs it may equally
  // under-count fires, which weakens every "no recorded invocation" row below. Silently dropping
  // these would hide the one piece of evidence that the inventory is incomplete.
  const installedKeys = new Set(inst.map(i => `${i.kind || '*'}:${i.name}`))
  const unmatched = [...fired.entries()]
    .filter(([k]) => !installedKeys.has(k))
    .map(([k, f]) => ({ key: k, recordedInvocations: f.count, lastRecordedInvocation: f.last }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))

  const none = items.filter(i => i.noRecordedInvocation)
  const judgeable = none.filter(i => i.installedAfterWindowStart === false)
  const tooNew = none.filter(i => i.installedAfterWindowStart === true)
  const unknownDate = none.filter(i => i.installDateUnknown)

  // A window this short cannot support a claim about habitual non-use, and saying so is the whole
  // difference between a metric and a nag.
  const windowTooShort = windowDays < 7

  return {
    installedCount: inst.length,
    withRecordedInvocation: items.length - none.length,
    noRecordedInvocationCount: none.length,
    // Hard-wired 0. With this evidence there is no path to proving a negative, so the field exists
    // to make that permanent rather than to be filled in later.
    provenUnusedCount: 0,
    provenUnusedNote: 'Always 0. Nothing in transcripts or skillUsage can prove a capability was never invoked; both are records of events, not of non-events.',
    observationWindow: {
      start: window.start, end: window.end,
      days: Math.round(windowDays * 100) / 100,
      source: window.source || 'unspecified',
      recordCompleteness,
      tooShortForHabitClaims: windowTooShort,
      note: windowTooShort
        ? `The observed window is ${windowDays.toFixed(2)} days. That is too short to distinguish "not needed" from "not needed THIS WEEK"; treat every zero below as "no data yet", not as a recommendation to remove.`
        : null,
    },
    invocationsConsidered: invs.length,
    invocationsOutsideWindow: outsideWindow,
    unmatchedInvocations: unmatched,
    inventoryCompleteness: unmatched.length === 0 ? 'no contradiction found' : 'DEMONSTRABLY INCOMPLETE',
    inventoryNote: unmatched.length === 0 ? null
      : `${unmatched.length} capability name(s) fired but are absent from the installed inventory (${unmatched.map(u => u.key).join(', ')}). The inventory is therefore known to be incomplete, so both counts below are about the inventory that was passed in, not about every capability available to this user.`,
    headline:
      `${inst.length} capabilities installed; ${none.length} have no recorded invocation in the observed ${windowDays.toFixed(2)}-day window `
      + `(${judgeable.length} of those existed for the whole window, ${tooNew.length} were installed after it opened, ${unknownDate.length} have an unknown install date). `
      + `0 are proven unused — this record cannot prove a negative.`
      + (unmatched.length ? ` NOTE: ${unmatched.length} capability name(s) fired but are missing from the installed inventory, so the inventory itself is known to be incomplete.` : ''),
    breakdown: {
      existedForWholeWindow: judgeable.length,
      installedAfterWindowStart: tooNew.length,
      installDateUnknown: unknownDate.length,
    },
    // The only tokens it is fair to describe as "possibly reclaimable", and even then only for
    // capabilities that existed for the entire window. Null-tokened items are excluded, not zeroed.
    reclaimableTokensUpperBound: judgeable.some(i => i.alwaysOnTokens == null)
      ? null
      : judgeable.reduce((s, i) => s + i.alwaysOnTokens, 0),
    reclaimableTokensNote: judgeable.some(i => i.alwaysOnTokens == null)
      ? 'null — at least one candidate has no measured always-on token cost, so a total would be part-measurement part-guess'
      : 'UPPER bound over capabilities that existed for the whole window; it assumes the window is representative, which a short window is not',
    items, caveats,
    now: Number.isFinite(now) ? now : null,
  }
}

// ---------------------------------------------------------------------------
// Derive an observation window from the evidence itself, rather than assuming one.
// Returns null (with a reason) when there is nothing to derive it from — which is exactly when the
// audit must refuse to produce a count.
// ---------------------------------------------------------------------------
export function deriveObservationWindow(args) {
  const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {}
  const { invocationTimes = [], transcriptTimes = [], firstStartTime = null } = a
  const times = [...(Array.isArray(invocationTimes) ? invocationTimes : []), ...(Array.isArray(transcriptTimes) ? transcriptTimes : [])].filter(Number.isFinite)
  if (times.length === 0) {
    return { window: null, reason: 'no timestamps available from transcripts or invocation records — the observation window is unknown' }
  }
  let start = Math.min(...times)
  const end = Math.max(...times)
  let source = `${times.length} timestamps from transcripts/invocation records`
  // firstStartTime is a floor on how long ANYTHING could have been recorded. If the CLI first ran
  // after our earliest timestamp, the earlier data is from somewhere else and the window should not
  // silently claim to cover it.
  if (Number.isFinite(firstStartTime) && firstStartTime > start) {
    start = firstStartTime
    source += `, clamped to ~/.claude.json firstStartTime (${new Date(firstStartTime).toISOString()}) because nothing could have been recorded before the CLI first ran`
  }
  return { window: { start, end, source }, reason: null }
}
