
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { detectTestCommand } from './testdetect.mjs'

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------

export const STATUSES = Object.freeze({
  pass: 'the check ran and the repo satisfies the claim',
  fail: 'the check ran and the repo does not satisfy the claim',
  'n-a': 'the item does not apply to this repo (wrong stack, or an "if applicable" clause that is not)',
  manual: 'no machine can decide this — a human must look',
  unknown: 'the check could not run; the reason is in the evidence',
})

export const MANUAL_REASONS = Object.freeze({
  'human-review': 'requires reading code or docs and forming a judgement',
  runtime: 'only observable while the system is running, not from files on disk',
  'external-service': 'the state lives in a provider dashboard, not in the checkout',
  network: 'would require a network call, which this module never makes',
  process: 'a fact about how the build was conducted, not about its artifacts',
})

export const SCAN_LIMITS = Object.freeze({
  maxSourceFiles: 2000,
  maxFileBytes: 512 * 1024,
  maxDepth: 12,
  maxHookFiles: 50,
  skipDirs: Object.freeze(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', 'vendor', '.next', '.venv', '__pycache__']),
  sourceExtensions: Object.freeze(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx']),
})

const ENV_IGNORED = ['NODE_ENV']

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------

export const ITEMS = Object.freeze([
  { id: 'FA-001', category: 'Plan & gates', text: 'Architecture matches approved plan', appliesTo: null, auto: null, manualReason: 'human-review' },
  { id: 'FA-002', category: 'Plan & gates', text: 'All PRD open questions resolved before build began — no unresolved items in PRD Section 17', appliesTo: null, auto: null, manualReason: 'human-review' },
  { id: 'FA-003', category: 'Plan & gates', text: 'Category 1 (human-only) setup confirmed complete by human before coding started -- accounts created, new projects created, `.env` populated, verified against `.env.example`', appliesTo: null, auto: null, manualReason: 'process' },
  { id: 'FA-004', category: 'AuthZ / data layer', text: 'Authorization boundaries enforced at data layer', appliesTo: null, auto: null, manualReason: 'human-review' },
  { id: 'FA-005', category: 'AuthZ / data layer', text: 'Table-level GRANTs applied to all public tables with RLS (anon + authenticated roles)', appliesTo: ['supabase', 'postgres'], auto: null, manualReason: 'external-service' },
  { id: 'FA-006', category: 'AuthZ / data layer', text: 'First-login RLS policies handle unlinked auth_user_id state (Discord OAuth fallback — skip if using Clerk)', appliesTo: ['supabase', 'discord'], auto: null, manualReason: 'external-service' },
  { id: 'FA-007', category: 'AuthZ / data layer', text: 'No RLS policies contain subqueries on auth.users (use auth.jwt() instead)', appliesTo: ['supabase', 'postgres'], auto: null, manualReason: 'external-service' },
  { id: 'FA-008', category: 'Backend / deploy', text: 'Edge Functions deployed with correct JWT verification flag (--no-verify-jwt only when function handles auth internally)', appliesTo: ['supabase'], auto: null, manualReason: 'external-service' },
  { id: 'FA-009', category: 'Backend / deploy', text: 'Edge Functions deployed from committed, tagged code on main branch (per Section 8.6)', appliesTo: ['supabase'], auto: null, manualReason: 'external-service' },
  { id: 'FA-010', category: 'Auth client', text: 'Client-side auth uses getSession() as default — getUser() not used in routine auth flows (per Section 5.2.2 — skip if using Clerk)', appliesTo: ['supabase'], auto: null, manualReason: 'human-review' },
  { id: 'FA-011', category: 'Auth client', text: 'Auth initialization uses two-effect pattern — no async operations inside onAuthStateChange (per Section 5.2.3 — skip if using Clerk)', appliesTo: ['supabase', 'react'], auto: null, manualReason: 'human-review' },
  { id: 'FA-012', category: 'Auth client', text: 'TOKEN_REFRESHED events do not trigger redundant DB lookups', appliesTo: ['supabase'], auto: null, manualReason: 'human-review' },
  { id: 'FA-013', category: 'React hygiene', text: 'React context provider values are referentially stable (useMemo on all context objects)', appliesTo: ['react'], auto: null, manualReason: 'human-review' },
  { id: 'FA-014', category: 'React hygiene', text: 'No useCallback dependency arrays include React context objects (toast, api, etc.)', appliesTo: ['react'], auto: null, manualReason: 'human-review' },
  { id: 'FA-015', category: 'React hygiene', text: 'No useEffect that makes API calls has unstable dependencies that could cause render loops', appliesTo: ['react'], auto: null, manualReason: 'human-review' },
  { id: 'FA-016', category: 'Code hygiene', text: 'No auth diagnostic logging prefixes remain in production code', appliesTo: null, auto: null, manualReason: 'human-review' },
  { id: 'FA-017', category: 'Architecture', text: 'No page file exceeds ~200 lines — decomposed into components (per Section 17.2)', appliesTo: null, auto: null, manualReason: 'human-review' },
  { id: 'FA-018', category: 'Architecture', text: 'No duplicated feature implementations across pages — shared components extracted (per Section 17.3)', appliesTo: null, auto: null, manualReason: 'human-review' },
  { id: 'FA-019', category: 'Agent config', text: 'Custom subagents created in `.claude/agents/` for Full Build projects (security-reviewer, component-checker, test-coverage recommended — per Section 20.3.3)', appliesTo: null, auto: 'agents-dir' },
  { id: 'FA-020', category: 'Agent config', text: 'Hook enforcement scripts created in `.claude/hooks/` with pre_tool_use guardrails active (per Section 20.5 — recommended for all projects, required for Full Build)', appliesTo: null, auto: 'pre-tool-use-hook' },
  { id: 'FA-021', category: 'Agent config', text: 'Hooks do not log sensitive data or make unauthorized external network calls (per Section 20.5.4)', appliesTo: null, auto: 'hook-network-scan' },
  { id: 'FA-022', category: 'Agent config', text: '`.claude/settings.json` committed with auto mode permission configuration and hooks enforcement active (per Section 20.6)', appliesTo: null, auto: 'settings-json' },
  { id: 'FA-023', category: 'Agent config', text: '`.claude/settings.local.json` is in `.gitignore`', appliesTo: null, auto: 'settings-local-gitignored' },
  { id: 'FA-024', category: 'Tenancy', text: 'Tenant isolation proven (if applicable)', appliesTo: null, auto: null, manualReason: 'runtime' },
  { id: 'FA-025', category: 'AuthZ / data layer', text: 'No recursive authorization logic', appliesTo: null, auto: null, manualReason: 'human-review' },
  { id: 'FA-026', category: 'Schema hygiene', text: 'No unused schema artifacts', appliesTo: ['postgres', 'supabase'], auto: null, manualReason: 'external-service' },
  { id: 'FA-027', category: 'Code hygiene', text: 'No commented-out production code', appliesTo: null, auto: null, manualReason: 'human-review' },
  { id: 'FA-028', category: 'Schema hygiene', text: 'No orphaned triggers or functions', appliesTo: ['postgres', 'supabase'], auto: null, manualReason: 'external-service' },
  { id: 'FA-029', category: 'Code hygiene', text: 'No duplicated business logic', appliesTo: null, auto: null, manualReason: 'human-review' },
  { id: 'FA-030', category: 'Testing', text: 'Manual isolation tests passed', appliesTo: null, auto: null, manualReason: 'runtime' },
  { id: 'FA-031', category: 'Testing', text: 'Manual role boundary tests passed', appliesTo: null, auto: null, manualReason: 'runtime' },
  { id: 'FA-032', category: 'Testing', text: 'Role-based test cases documented in `tests/role-tests.md` and passing (per Section 14.4)', appliesTo: ['ccbf'], auto: 'role-tests-doc' },
  { id: 'FA-033', category: 'Testing', text: 'Playwright end-to-end tests passing for all routes and core user journeys (per Section 14.6 — if applicable)', appliesTo: ['playwright'], auto: 'playwright-configured' },
  { id: 'FA-034', category: 'Plan & gates', text: 'Self-audit verification loop completed — all PRD acceptance criteria verified as implemented (per Section 20.1)', appliesTo: null, auto: null, manualReason: 'process' },
  { id: 'FA-035', category: 'Build state', text: '`STATE.md` exists and reflects all phases as complete with approval dates (per Section 20.7)', appliesTo: ['ccbf'], auto: 'state-md' },
  { id: 'FA-036', category: 'Build state', text: '`CONTEXT.md` exists with implementation decisions captured for all UI phases (per Section 20.8)', appliesTo: ['ccbf'], auto: 'context-md' },
  { id: 'FA-037', category: 'Agent config', text: 'Claude Code plugins reviewed and installed before build; installed plugins documented in `lessons-learned.md`', appliesTo: null, auto: null, manualReason: 'process' },
  { id: 'FA-038', category: 'Plan & gates', text: 'Selected development framework installed and design/brainstorming phase completed before coding (per Section 20.9)', appliesTo: null, auto: null, manualReason: 'process' },
  { id: 'FA-039', category: 'Audit / logging', text: 'Privileged actions logged', appliesTo: null, auto: null, manualReason: 'human-review' },
  { id: 'FA-040', category: 'Data safety', text: 'No production data deleted during development or testing (per Section 12.3)', appliesTo: null, auto: null, manualReason: 'process' },
  { id: 'FA-041', category: 'Error handling', text: 'Debug mode toggles correctly and does not leak data when off', appliesTo: null, auto: null, manualReason: 'runtime' },
  { id: 'FA-042', category: 'Error handling', text: 'Error handling covers all network calls and async operations', appliesTo: null, auto: null, manualReason: 'human-review' },
  { id: 'FA-043', category: 'Observability', text: 'Error tracking configured for production (per Section 13.3 — if applicable)', appliesTo: null, auto: null, manualReason: 'external-service' },
  { id: 'FA-044', category: 'Observability', text: 'Feature adoption tracking events implemented for key features (per Section 13.3 — if applicable)', appliesTo: null, auto: null, manualReason: 'external-service' },
  { id: 'FA-045', category: 'Secrets / env', text: 'Environment variables documented and no hardcoded secrets', appliesTo: null, auto: 'env-file-not-tracked' },
  { id: 'FA-046', category: 'Secrets / env', text: '`.env.example` exists, is committed, and documents all required variables with grouping, descriptions, and source instructions (per Section 8.3.1)', appliesTo: null, auto: 'env-example-exists' },
  { id: 'FA-047', category: 'Secrets / env', text: '`.env.example` is in sync with actual environment variable usage — no missing or stale entries', appliesTo: null, auto: 'env-example-sync' },
  { id: 'FA-048', category: 'Setup guides', text: 'Setup guide exists in `docs/resources/` for every external service in the tech stack (per Section 8.8)', appliesTo: null, auto: null, manualReason: 'human-review' },
  { id: 'FA-049', category: 'Setup guides', text: 'No setup guide contains actual API keys, secrets, or credentials -- only placeholders', appliesTo: null, auto: null, manualReason: 'human-review' },
  { id: 'FA-050', category: 'Setup guides', text: 'All setup guides have all three categories completed (human-only, automated, post-build refinement)', appliesTo: null, auto: null, manualReason: 'human-review' },
  { id: 'FA-051', category: 'Setup guides', text: 'All MCP/CLI service connections scoped to the specific new project -- no unscoped or production connections', appliesTo: null, auto: null, manualReason: 'external-service' },
  { id: 'FA-052', category: 'Setup guides', text: 'All setup guides cross-reference related guides where setup spans multiple tools', appliesTo: null, auto: null, manualReason: 'human-review' },
  { id: 'FA-053', category: 'Setup guides', text: '`docs/resources/README.md` index exists with Category 1, 2, and 3 checklists', appliesTo: ['ccbf'], auto: 'docs-resources-index' },
  { id: 'FA-054', category: 'Schema hygiene', text: 'Migration files match current schema state', appliesTo: ['postgres', 'supabase'], auto: null, manualReason: 'external-service' },
  { id: 'FA-055', category: 'Schema hygiene', text: 'No schema drift — no direct dashboard modifications to production RLS, functions, or triggers (per Section 8.7)', appliesTo: ['supabase'], auto: null, manualReason: 'external-service' },
  { id: 'FA-056', category: 'Backup / recovery', text: 'Database backup tier declared in PRD — PITR flagged as recommended for production user-facing apps (per Section 8.5)', appliesTo: ['supabase', 'postgres'], auto: null, manualReason: 'external-service' },
  { id: 'FA-057', category: 'Git', text: 'Git repository is clean with descriptive commit history', appliesTo: null, auto: 'git-clean' },
  { id: 'FA-058', category: 'Lessons', text: '`lessons-learned.md` reviewed — any items that should be folded into master `claude.md` flagged to project owner', appliesTo: ['ccbf'], auto: 'lessons-learned-doc' },
  { id: 'FA-059', category: 'Build / deploy', text: '`.npmrc` with `force=true` exists in project root (required for Windows to Railway cross-platform deploy)', appliesTo: ['railway', 'npm'], auto: 'npmrc-force' },
  { id: 'FA-060', category: 'Supply chain', text: 'Supply chain: `npm audit` shows no high or critical vulnerabilities (per Section 8.9, security-framework.md Section 7)', appliesTo: ['npm'], auto: null, manualReason: 'network' },
  { id: 'FA-061', category: 'Supply chain', text: 'Supply chain: all dependency versions pinned in lockfiles, lockfiles committed to Git', appliesTo: ['npm'], auto: 'lockfile-committed' },
  { id: 'FA-062', category: 'Supply chain', text: 'Supply chain: no dependencies with post-install scripts unless explicitly approved', appliesTo: ['npm'], auto: null, manualReason: 'human-review' },
  { id: 'FA-063', category: 'Build artifact', text: 'Build artifact: no source maps, debug files, `.env` files, or credential files in deployed/published artifact (per Section 8.9)', appliesTo: null, auto: null, manualReason: 'process' },
  { id: 'FA-064', category: 'Build artifact', text: 'Build artifact: if publishing to npm, `npm pack --dry-run` reviewed and artifact size within expected baseline', appliesTo: ['npm'], auto: null, manualReason: 'process' },
  { id: 'FA-065', category: 'Auto-remediation', text: 'Auto-remediation changelog is clean (if applicable)', appliesTo: null, auto: null, manualReason: 'human-review' },
  { id: 'FA-066', category: 'LLM cost', text: 'LLM calls use appropriate model tier per task (no Opus for mechanical tasks)', appliesTo: null, auto: null, manualReason: 'human-review' },
  { id: 'FA-067', category: 'LLM cost', text: 'No LLM calls for tasks that should be deterministic scripts', appliesTo: null, auto: null, manualReason: 'human-review' },
  { id: 'FA-068', category: 'LLM cost', text: 'LLM API calls include rate limit handling (backoff + jitter)', appliesTo: null, auto: null, manualReason: 'human-review' },
  { id: 'FA-069', category: 'LLM cost', text: 'LLM cost logging in place for runtime API calls (if applicable)', appliesTo: null, auto: null, manualReason: 'runtime' },
  { id: 'FA-070', category: 'LLM cost', text: 'Bulk operations are resumable with checkpoint/resume logic (if applicable)', appliesTo: null, auto: null, manualReason: 'human-review' },
  { id: 'FA-071', category: 'Security ops', text: 'Nightly security audit configured (if applicable)', appliesTo: null, auto: null, manualReason: 'external-service' },
  { id: 'FA-072', category: 'SEO / crawl', text: 'Crawl policy enforced: `robots.txt`, meta robots, and `X-Robots-Tag` all set to noindex/nofollow (unless explicitly authorized)', appliesTo: ['web'], auto: 'robots-txt' },
  { id: 'FA-073', category: 'SEO / crawl', text: 'Debug mode URLs permanently excluded from indexing at all three layers (robots.txt, meta tag, response header) and never present in sitemap', appliesTo: ['web'], auto: null, manualReason: 'human-review' },
  { id: 'FA-074', category: 'SEO / crawl', text: 'SEO structure in place: semantic HTML, meta tags, Open Graph, JSON-LD on public-facing pages', appliesTo: ['web'], auto: null, manualReason: 'human-review' },
  { id: 'FA-075', category: 'SEO / crawl', text: 'SEO/structured data managed via shared utility (not scattered across components)', appliesTo: ['web'], auto: null, manualReason: 'human-review' },
])

export const CATEGORIES = Object.freeze([...new Set(ITEMS.map(i => i.category))])

export const STACK_TAGS = Object.freeze([...new Set(ITEMS.flatMap(i => i.appliesTo || []))].sort())

/**
 * Items that apply given a set of declared stack tags.
 * `stacks == null` means "no stack declared" — nothing is filtered out, because hiding an item
 * we were never told about would be a silent skip. An empty array means "no stacks apply", and
 * every tagged item drops out.
 */
export function applicableItems(stacks) {
  if (stacks == null) return [...ITEMS]
  const declared = new Set(stacks)
  return ITEMS.filter(i => !i.appliesTo || i.appliesTo.some(t => declared.has(t)))
}

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------

class CheckError extends Error {
  constructor(message) { super(message); this.name = 'CheckError' }
}

function readText(p) {
  try { return fs.readFileSync(p, 'utf8') }
  catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null
    if (err.code === 'EISDIR') return null
    throw new CheckError(`cannot read ${p}: ${err.code || err.message}`)
  }
}

function statOf(p) {
  try { return fs.statSync(p) }
  catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null
    throw new CheckError(`cannot stat ${p}: ${err.code || err.message}`)
  }
}

const isFile = p => { const s = statOf(p); return !!s && s.isFile() }
const isDir = p => { const s = statOf(p); return !!s && s.isDirectory() }

function listDir(p) {
  try { return fs.readdirSync(p, { withFileTypes: true }) }
  catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null
    throw new CheckError(`cannot read directory ${p}: ${err.code || err.message}`)
  }
}

/**
 * Run git with an argv array. Never a shell string: a repo path or a branch name must never be
 * able to become a command. Returns a tagged result rather than throwing, so each caller decides
 * what a git failure means for its own claim — but "git is not installed" is `unavailable`, and
 * every caller turns that into `unknown`, never `fail`.
 */
function runGit(gitBin, args, cwd) {
  let r
  try {
    r = spawnSync(gitBin, args, { cwd, encoding: 'utf8', timeout: 10_000, maxBuffer: 16 * 1024 * 1024 })
  } catch (err) {
    return { unavailable: true, reason: `spawn ${gitBin} threw ${err.code || err.message}`, argv: [gitBin, ...args] }
  }
  const argv = [gitBin, ...args]
  if (r.error) {
    const code = r.error.code || ''
    if (code === 'ENOENT') return { unavailable: true, reason: `git binary ${JSON.stringify(gitBin)} not found on PATH (ENOENT)`, argv }
    return { unavailable: true, reason: `spawn ${gitBin} failed: ${code || r.error.message}`, argv }
  }
  if (r.status === null) return { unavailable: true, reason: `git was killed by signal ${r.signal} or timed out`, argv }
  return {
    unavailable: false,
    status: r.status,
    stdout: (r.stdout || '').toString(),
    stderr: (r.stderr || '').toString().trim(),
    argv,
  }
}

/**
 * Bounded recursive walk. Returns { files, truncated } — truncation is never silent.
 *
 * The depth cap prunes one branch and keeps walking its siblings; only the file-count cap stops
 * the walk outright. An earlier version aborted everything on the first over-deep directory,
 * which made the result depend on readdir alphabetical order: one deep vendored folder named
 * `a/` could hide the entire rest of the repo and, worse, turn a real mismatch into a clean scan.
 */
function walkSource(dir, { extensions, maxFiles, maxDepth, skipDirs }) {
  const files = []
  let truncated = false
  let stopped = false
  const skip = new Set(skipDirs)
  const visit = (cur, depth) => {
    if (stopped) return
    if (depth > maxDepth) { truncated = true; return }
    const entries = listDir(cur)
    if (!entries) return
    for (const e of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      if (stopped) return
      const full = path.join(cur, e.name)
      if (e.isDirectory()) {
        if (skip.has(e.name)) continue
        visit(full, depth + 1)
      } else if (e.isFile() && extensions.includes(path.extname(e.name))) {
        if (files.length >= maxFiles) { truncated = true; stopped = true; return }
        files.push(full)
      }
    }
  }
  visit(dir, 0)
  return { files, truncated }
}

/**
 * Interpret `git ls-files --error-unmatch`. Exit 0 means tracked and exit 1 means untracked —
 * those are answers about the repo. Anything else (128 "not a git repository", a broken index)
 * is a failure of the check, and must not masquerade as "your file is not committed".
 */
function trackedState(g) {
  if (g.unavailable) return { state: 'unknown', note: g.reason }
  if (g.status === 0) return { state: 'tracked', note: `\`${g.argv.join(' ')}\` exited 0` }
  if (g.status === 1) return { state: 'untracked', note: `\`${g.argv.join(' ')}\` exited 1${g.stderr ? `: ${g.stderr}` : ''}` }
  return { state: 'unknown', note: `\`${g.argv.join(' ')}\` exited ${g.status}${g.stderr ? `: ${g.stderr}` : ''}` }
}

const rel = (dir, p) => path.relative(dir, p) || '.'

const ev = (detail, extra = {}) => ({ detail, paths: [], ...extra })

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------

const RECOMMENDED_AGENTS = ['security-reviewer', 'component-checker', 'test-coverage']
const PRE_TOOL_USE_RE = /^pre[-_]?tool[-_]?use\b/i
const NETWORK_PATTERNS = [
  [/\bcurl\b/, 'curl'],
  [/\bwget\b/, 'wget'],
  [/\brequests\.(get|post|put|patch|delete)\s*\(/, 'python requests'],
  [/\burllib(\.request)?\b/, 'python urllib'],
  [/\bhttp\.client\b/, 'python http.client'],
  [/\bfetch\s*\(/, 'fetch()'],
  [/\baxios\b/, 'axios'],
  [/\bnet\.(connect|createConnection)\s*\(/, 'node net'],
  [/\bnc\s+-/, 'netcat'],
]

const LICENSE_NAMES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'LICENCE.txt', 'COPYING', 'COPYING.md']
const LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb']
const TRACKED_SECRET_FILES = [/^\.env$/, /^\.env\.local$/, /^\.env\.(development|production|staging|test)(\.local)?$/, /\.pem$/, /\.p12$/, /^id_rsa$/, /\.keystore$/]
const WEB_MARKERS = ['index.html', 'public', 'static', 'app', 'pages']

const checkList = dirPath => listDir(dirPath)

export const CHECKS = Object.freeze([
  {
    id: 'agents-dir',
    label: '.claude/agents/ exists and is non-empty',
    itemId: 'FA-019',
    run({ dir }) {
      const p = path.join(dir, '.claude', 'agents')
      const entries = checkList(p)
      if (entries === null) return { status: 'fail', evidence: ev('.claude/agents/ does not exist', { paths: ['.claude/agents'] }) }
      const files = entries.filter(e => e.isFile() || e.isSymbolicLink()).map(e => e.name).sort()
      if (!files.length) return { status: 'fail', evidence: ev('.claude/agents/ exists but contains no files', { paths: ['.claude/agents'], agents: [] }) }
      const present = RECOMMENDED_AGENTS.filter(a => files.some(f => f.replace(/\.[^.]+$/, '') === a))
      const missing = RECOMMENDED_AGENTS.filter(a => !present.includes(a))
      return {
        status: 'pass',
        evidence: ev(
          `${files.length} agent file(s) in .claude/agents/: ${files.join(', ')}. ` +
          `Recommended agents present: ${present.length ? present.join(', ') : 'none'}` +
          (missing.length ? `; not present: ${missing.join(', ')}` : ''),
          { paths: ['.claude/agents'], agents: files, recommendedPresent: present, recommendedMissing: missing },
        ),
      }
    },
  },

  {
    id: 'pre-tool-use-hook',
    label: 'a pre-tool-use hook script exists (and is registered)',
    itemId: 'FA-020',
    run({ dir }) {
      const hooksDir = path.join(dir, '.claude', 'hooks')
      const entries = checkList(hooksDir)
      const scripts = entries ? entries.filter(e => e.isFile()).map(e => e.name).filter(n => PRE_TOOL_USE_RE.test(n)).sort() : []
      const settingsPath = path.join(dir, '.claude', 'settings.json')
      const raw = readText(settingsPath)
      let registered = null
      if (raw != null) {
        try {
          const s = JSON.parse(raw)
          registered = !!(s && s.hooks && Array.isArray(s.hooks.PreToolUse) ? s.hooks.PreToolUse.length : s && s.hooks && s.hooks.PreToolUse)
        } catch { registered = null }
      }
      const paths = ['.claude/hooks', '.claude/settings.json']
      if (!entries) return { status: 'fail', evidence: ev('.claude/hooks/ does not exist, so no pre_tool_use guardrail can be active', { paths }) }
      if (!scripts.length) {
        const all = entries.filter(e => e.isFile()).map(e => e.name).sort()
        return { status: 'fail', evidence: ev(`.claude/hooks/ exists but holds no pre_tool_use script; files present: ${all.length ? all.join(', ') : '(none)'}`, { paths, hookFiles: all, matched: [] }) }
      }
      const detail = `pre-tool-use script(s) found: ${scripts.map(s => `.claude/hooks/${s}`).join(', ')}; ` +
        (registered === true ? 'registered under hooks.PreToolUse in .claude/settings.json'
          : registered === false ? 'NOT registered under hooks.PreToolUse in .claude/settings.json'
            : 'registration could not be determined (.claude/settings.json missing or unparseable)')
      if (registered === true) return { status: 'pass', evidence: ev(detail, { paths, matched: scripts, registered: true }) }
      if (registered === false) return { status: 'fail', evidence: ev(detail, { paths, matched: scripts, registered: false }) }
      return {
        status: 'pass', partial: true,
        partialReason: 'the script exists but its registration under hooks.PreToolUse could not be confirmed, so "guardrails active" is unverified',
        evidence: ev(detail, { paths, matched: scripts, registered: null }),
      }
    },
  },

  {
    id: 'hook-network-scan',
    label: 'hook scripts scanned for outbound network calls',
    itemId: 'FA-021',
    run({ dir }) {
      const hooksDir = path.join(dir, '.claude', 'hooks')
      const entries = checkList(hooksDir)
      if (!entries) return { status: 'n-a', evidence: ev('.claude/hooks/ does not exist — there are no hooks to audit', { paths: ['.claude/hooks'] }) }
      const files = entries.filter(e => e.isFile()).map(e => e.name).sort()
      const scanned = files.slice(0, SCAN_LIMITS.maxHookFiles)
      const truncated = files.length > scanned.length
      const hits = []
      for (const name of scanned) {
        const body = readText(path.join(hooksDir, name))
        if (body == null) continue
        const lines = body.split('\n')
        for (let i = 0; i < lines.length; i++) {
          for (const [re, what] of NETWORK_PATTERNS) {
            if (re.test(lines[i])) hits.push({ file: `.claude/hooks/${name}`, line: i + 1, pattern: what, text: lines[i].trim().slice(0, 160) })
          }
        }
      }
      const capNote = truncated
        ? ` Scan was capped at ${SCAN_LIMITS.maxHookFiles} of ${files.length} hook files (SCAN_LIMITS.maxHookFiles), so this result is incomplete.`
        : ''
      const paths = scanned.map(n => `.claude/hooks/${n}`)
      if (hits.length) {
        return {
          status: 'fail',
          evidence: ev(`${hits.length} possible outbound-network call(s) in hook scripts: ` +
            hits.slice(0, 10).map(h => `${h.file}:${h.line} (${h.pattern})`).join(', ') +
            (hits.length > 10 ? ` …and ${hits.length - 10} more` : '') +
            ' — each needs review against Section 20.5.4.' + capNote,
            { paths, hits, filesScanned: scanned.length, filesTotal: files.length, truncated }),
        }
      }
      if (truncated) {
        return { status: 'unknown', evidence: ev(`No network patterns found in the ${scanned.length} hook files scanned, but the scan was truncated.${capNote}`, { paths, hits: [], filesScanned: scanned.length, filesTotal: files.length, truncated }) }
      }
      return {
        status: 'pass', partial: true,
        partialReason: 'a pattern scan finding nothing is not proof of safety, and "does not log sensitive data" was not checked at all',
        evidence: ev(`Scanned ${scanned.length} hook file(s) for ${NETWORK_PATTERNS.length} network-call patterns; no matches. Sensitive-data logging was not checked.`,
          { paths, hits: [], filesScanned: scanned.length, filesTotal: files.length, truncated: false, patterns: NETWORK_PATTERNS.map(p => p[1]) }),
      }
    },
  },

  {
    id: 'settings-json',
    label: '.claude/settings.json has hooks and permissions.defaultMode',
    itemId: 'FA-022',
    run({ dir }) {
      const p = path.join(dir, '.claude', 'settings.json')
      const raw = readText(p)
      if (raw == null) return { status: 'fail', evidence: ev('.claude/settings.json does not exist', { paths: ['.claude/settings.json'] }) }
      let parsed
      try { parsed = JSON.parse(raw) } catch (err) {
        return { status: 'fail', evidence: ev(`.claude/settings.json is present but is not valid JSON: ${err.message}`, { paths: ['.claude/settings.json'], bytes: raw.length }) }
      }
      const hookEvents = parsed && parsed.hooks && typeof parsed.hooks === 'object' ? Object.keys(parsed.hooks) : []
      const defaultMode = parsed && parsed.permissions && typeof parsed.permissions === 'object' ? parsed.permissions.defaultMode : undefined
      const missing = []
      if (!hookEvents.length) missing.push('hooks (absent or empty)')
      if (defaultMode === undefined) missing.push('permissions.defaultMode')
      const detail = `.claude/settings.json parsed; hooks events = [${hookEvents.join(', ')}], permissions.defaultMode = ${JSON.stringify(defaultMode)}`
      const evidence = ev(missing.length ? `${detail}; missing: ${missing.join(', ')}` : detail,
        { paths: ['.claude/settings.json'], hookEvents, defaultMode: defaultMode ?? null })
      if (missing.length) return { status: 'fail', evidence }
      return {
        status: 'pass', partial: true,
        partialReason: 'whether the file is committed (as opposed to merely present) is not checked here, and "auto mode" is a judgement about the defaultMode value',
        evidence,
      }
    },
  },

  {
    id: 'settings-local-gitignored',
    label: '.claude/settings.local.json is gitignored',
    itemId: 'FA-023',
    run({ dir, gitBin }) {
      const target = '.claude/settings.local.json'
      const g = runGit(gitBin, ['-C', dir, 'check-ignore', '-q', '--', target], dir)
      if (!g.unavailable && (g.status === 0 || g.status === 1)) {
        return {
          status: g.status === 0 ? 'pass' : 'fail',
          evidence: ev(`\`${g.argv.join(' ')}\` exited ${g.status} — git reports ${target} is ${g.status === 0 ? '' : 'NOT '}ignored`,
            { paths: [target], command: g.argv, exitCode: g.status, method: 'git check-ignore' }),
        }
      }
      const why = g.unavailable ? g.reason : `git exited ${g.status}${g.stderr ? `: ${g.stderr}` : ''}`
      const gi = readText(path.join(dir, '.gitignore'))
      if (gi == null) {
        return { status: 'fail', evidence: ev(`git check-ignore unusable (${why}); fell back to reading .gitignore, which does not exist`, { paths: ['.gitignore'], method: '.gitignore text scan', gitNote: why }) }
      }
      const lines = gi.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
      const match = lines.find(l => !l.startsWith('!') && (
        l === target || l === `/${target}` || l === 'settings.local.json' ||
        l === '.claude' || l === '.claude/' || l === '/.claude' || l === '/.claude/' ||
        l === '.claude/*' || l.endsWith('/settings.local.json')))
      return {
        status: match ? 'pass' : 'fail',
        evidence: ev(`git check-ignore unusable (${why}); .gitignore text scan of ${lines.length} pattern(s) ${match ? `matched ${JSON.stringify(match)}` : `found no pattern covering ${target}`}`,
          { paths: ['.gitignore'], method: '.gitignore text scan', matchedPattern: match || null, patternCount: lines.length, gitNote: why }),
      }
    },
  },

  {
    id: 'env-file-not-tracked',
    label: 'no real .env / credential file is tracked by git',
    itemId: 'FA-045',
    run({ dir, gitBin }) {
      const g = runGit(gitBin, ['-C', dir, 'ls-files', '-z'], dir)
      if (g.unavailable) return { status: 'unknown', evidence: ev(`could not list tracked files: ${g.reason}`, { command: g.argv, paths: [] }) }
      if (g.status !== 0) return { status: 'unknown', evidence: ev(`\`${g.argv.join(' ')}\` exited ${g.status}${g.stderr ? `: ${g.stderr}` : ''} — tracked-file list unavailable`, { command: g.argv, exitCode: g.status, paths: [] }) }
      const tracked = g.stdout.split('\0').filter(Boolean)
      const offenders = tracked.filter(f => TRACKED_SECRET_FILES.some(re => re.test(path.basename(f))))
      if (offenders.length) {
        return { status: 'fail', evidence: ev(`${offenders.length} credential-bearing file(s) tracked in git: ${offenders.join(', ')}`, { command: g.argv, paths: offenders, tracked: tracked.length }) }
      }
      return {
        status: 'pass', partial: true,
        partialReason: 'only tracked .env / key files were checked; "no hardcoded secrets" in source is not machine-decidable and was not attempted',
        evidence: ev(`${tracked.length} tracked file(s); none matched the credential-file patterns (${TRACKED_SECRET_FILES.length} patterns). Hardcoded secrets in source were NOT scanned for.`,
          { command: g.argv, paths: [], tracked: tracked.length }),
      }
    },
  },

  {
    id: 'env-example-exists',
    label: '.env.example exists and is tracked',
    itemId: 'FA-046',
    run({ dir, gitBin }) {
      const p = path.join(dir, '.env.example')
      const raw = readText(p)
      if (raw == null) return { status: 'fail', evidence: ev('.env.example does not exist', { paths: ['.env.example'] }) }
      const keys = envExampleKeys(raw)
      const g = runGit(gitBin, ['-C', dir, 'ls-files', '--error-unmatch', '--', '.env.example'], dir)
      const { state, note } = trackedState(g)
      if (state === 'untracked') {
        return { status: 'fail', evidence: ev(`.env.example exists with ${keys.length} key(s) but is not committed — ${note}`, { paths: ['.env.example'], keys, command: g.argv, tracked: false }) }
      }
      const trackedNote = state === 'tracked' ? `tracked in git (${note})` : `tracked-in-git UNVERIFIED (${note})`
      return {
        status: 'pass', partial: true,
        partialReason: 'grouping, descriptions and source instructions inside .env.example require a human to read it'
          + (state === 'unknown' ? ', and whether the file is committed could not be determined' : ''),
        evidence: ev(`.env.example present with ${keys.length} key(s): ${keys.join(', ') || '(none)'}; ${trackedNote}. Grouping/descriptions/source instructions were not assessed.`,
          { paths: ['.env.example'], keys, command: g.argv, tracked: state === 'tracked' ? true : state === 'untracked' ? false : null }),
      }
    },
  },

  {
    id: 'env-example-sync',
    label: '.env.example keys match process.env usage in source',
    itemId: 'FA-047',
    run({ dir }) {
      const p = path.join(dir, '.env.example')
      const raw = readText(p)
      const documented = raw == null ? null : envExampleKeys(raw)
      const { files, truncated } = walkSource(dir, {
        extensions: SCAN_LIMITS.sourceExtensions,
        maxFiles: SCAN_LIMITS.maxSourceFiles,
        maxDepth: SCAN_LIMITS.maxDepth,
        skipDirs: SCAN_LIMITS.skipDirs,
      })
      const used = new Map()
      let bytesSkipped = 0
      for (const f of files) {
        let body
        try {
          const st = fs.statSync(f)
          if (st.size > SCAN_LIMITS.maxFileBytes) { bytesSkipped++; continue }
          body = fs.readFileSync(f, 'utf8')
        } catch { continue }
        const lines = body.split('\n')
        for (let i = 0; i < lines.length; i++) {
          for (const re of [/process\.env\.([A-Za-z_$][\w$]*)/g, /process\.env\[\s*['"`]([^'"`]+)['"`]\s*\]/g, /import\.meta\.env\.([A-Za-z_$][\w$]*)/g]) {
            re.lastIndex = 0
            let m
            while ((m = re.exec(lines[i])) !== null) {
              const key = m[1]
              if (ENV_IGNORED.includes(key)) continue
              if (!used.has(key)) used.set(key, `${rel(dir, f)}:${i + 1}`)
            }
          }
        }
      }
      const scanNote = `scanned ${files.length} source file(s) (${SCAN_LIMITS.sourceExtensions.join(', ')}), skipping ${SCAN_LIMITS.skipDirs.join('/')}` +
        (bytesSkipped ? `; ${bytesSkipped} file(s) over ${SCAN_LIMITS.maxFileBytes} bytes were not opened` : '') +
        `; ignored by name: ${ENV_IGNORED.join(', ')}`
      const base = {
        paths: ['.env.example'],
        filesScanned: files.length,
        truncated,
        oversizeSkipped: bytesSkipped,
        limits: { maxSourceFiles: SCAN_LIMITS.maxSourceFiles, maxFileBytes: SCAN_LIMITS.maxFileBytes, maxDepth: SCAN_LIMITS.maxDepth },
        ignoredKeys: [...ENV_IGNORED],
      }
      if (documented === null) {
        const usedKeys = [...used.keys()].sort()
        return { status: 'fail', evidence: ev(`.env.example does not exist, so it cannot be in sync; ${usedKeys.length} env key(s) are read from source (${scanNote})`, { ...base, missing: usedKeys, stale: [], usage: Object.fromEntries(used) }) }
      }
      const documentedSet = new Set(documented)
      const missing = [...used.keys()].filter(k => !documentedSet.has(k)).sort()
      const stale = documented.filter(k => !used.has(k)).sort()
      const evidence = ev(
        `.env.example documents ${documented.length} key(s); ${scanNote}. ` +
        `Used but undocumented: ${missing.length ? missing.map(k => `${k} (${used.get(k)})`).join(', ') : 'none'}. ` +
        `Documented but unused in scanned source: ${stale.length ? stale.join(', ') : 'none'}.` +
        (truncated ? ` SCAN WAS TRUNCATED at ${SCAN_LIMITS.maxSourceFiles} files / depth ${SCAN_LIMITS.maxDepth}.` : ''),
        { ...base, documented, missing, stale, usage: Object.fromEntries(used) })
      if (missing.length || stale.length) return { status: 'fail', evidence }
      if (truncated) return { status: 'unknown', evidence: { ...evidence, detail: `${evidence.detail} No mismatch was found in the files that were scanned, but because the scan was truncated this cannot be reported as a pass.` } }
      return { status: 'pass', evidence }
    },
  },

  {
    id: 'git-clean',
    label: 'git working tree is clean',
    itemId: 'FA-057',
    run({ dir, gitBin }) {
      const g = runGit(gitBin, ['-C', dir, 'status', '--porcelain'], dir)
      if (g.unavailable) return { status: 'unknown', evidence: ev(`git status could not be run: ${g.reason}`, { command: g.argv, paths: [] }) }
      if (g.status !== 0) {
        const notRepo = /not a git repository/i.test(g.stderr)
        return notRepo
          ? { status: 'fail', evidence: ev(`${dir} is not a git repository — \`${g.argv.join(' ')}\` exited ${g.status}: ${g.stderr}`, { command: g.argv, exitCode: g.status, paths: [] }) }
          : { status: 'unknown', evidence: ev(`\`${g.argv.join(' ')}\` exited ${g.status}${g.stderr ? `: ${g.stderr}` : ''}`, { command: g.argv, exitCode: g.status, paths: [] }) }
      }
      const entries = g.stdout.split('\n').filter(Boolean)
      if (entries.length) {
        return { status: 'fail', evidence: ev(`working tree has ${entries.length} uncommitted change(s): ${entries.slice(0, 20).map(l => l.trim()).join(' | ')}${entries.length > 20 ? ` …and ${entries.length - 20} more` : ''}`,
          { command: g.argv, exitCode: 0, dirty: entries, paths: entries.map(l => l.slice(3)) }) }
      }
      return {
        status: 'pass', partial: true,
        partialReason: '"descriptive commit history" is a judgement about commit messages, which no check can make',
        evidence: ev(`\`${g.argv.join(' ')}\` exited 0 with no output — working tree is clean. Commit-message quality was not assessed.`, { command: g.argv, exitCode: 0, dirty: [], paths: [] }),
      }
    },
  },

  {
    id: 'role-tests-doc',
    label: 'tests/role-tests.md exists',
    itemId: 'FA-032',
    run({ dir }) {
      const candidates = ['tests/role-tests.md', 'test/role-tests.md']
      const found = candidates.find(c => isFile(path.join(dir, c)))
      if (!found) return { status: 'fail', evidence: ev(`no role-test document at ${candidates.join(' or ')}`, { paths: candidates }) }
      const body = readText(path.join(dir, found)) || ''
      return {
        status: 'pass', partial: true,
        partialReason: 'whether the documented role tests are *passing* cannot be determined from the file',
        evidence: ev(`${found} exists (${body.length} bytes, ${body.split('\n').length} lines). Whether the cases pass was not determined.`, { paths: [found], bytes: body.length }),
      }
    },
  },

  {
    id: 'playwright-configured',
    label: 'Playwright is configured for this repo',
    itemId: 'FA-033',
    run({ dir }) {
      const configs = ['playwright.config.js', 'playwright.config.mjs', 'playwright.config.cjs', 'playwright.config.ts']
      const found = configs.filter(c => isFile(path.join(dir, c)))
      const pkgRaw = readText(path.join(dir, 'package.json'))
      let dep = false, pkgNote = 'package.json absent'
      if (pkgRaw != null) {
        try {
          const pkg = JSON.parse(pkgRaw)
          const all = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
          dep = !!(all['@playwright/test'] || all.playwright)
          pkgNote = dep ? 'package.json declares a Playwright dependency' : 'package.json declares no Playwright dependency'
        } catch { pkgNote = 'package.json is not valid JSON' }
      }
      if (!found.length && !dep) {
        return { status: 'n-a', evidence: ev(`no Playwright config (${configs.join(', ')}) and ${pkgNote} — the "if applicable" clause does not apply`, { paths: configs, configs: [], dependency: false }) }
      }
      return {
        status: 'pass', partial: true,
        partialReason: 'Playwright being configured says nothing about whether its tests pass, or whether they cover all routes',
        evidence: ev(`Playwright is configured: ${found.length ? `config ${found.join(', ')}` : 'no config file'}; ${pkgNote}. Test results and route coverage were not determined.`,
          { paths: found, configs: found, dependency: dep }),
      }
    },
  },

  {
    id: 'state-md',
    label: 'STATE.md exists',
    itemId: 'FA-035',
    run({ dir }) { return docPresence(dir, 'STATE.md', 'phase completion and approval dates inside the file were not parsed') },
  },
  {
    id: 'context-md',
    label: 'CONTEXT.md exists',
    itemId: 'FA-036',
    run({ dir }) { return docPresence(dir, 'CONTEXT.md', 'whether every UI phase has captured decisions was not determined') },
  },
  {
    id: 'lessons-learned-doc',
    label: 'lessons-learned.md exists',
    itemId: 'FA-058',
    run({ dir }) { return docPresence(dir, 'lessons-learned.md', '"reviewed and flagged to the project owner" is a human action with no trace on disk') },
  },
  {
    id: 'docs-resources-index',
    label: 'docs/resources/README.md exists',
    itemId: 'FA-053',
    run({ dir }) { return docPresence(dir, path.join('docs', 'resources', 'README.md'), 'presence of the Category 1/2/3 checklists inside the index was not verified') },
  },

  {
    id: 'npmrc-force',
    label: '.npmrc sets force=true',
    itemId: 'FA-059',
    run({ dir }) {
      const hasPkg = isFile(path.join(dir, 'package.json'))
      const raw = readText(path.join(dir, '.npmrc'))
      if (!hasPkg && raw == null) return { status: 'n-a', evidence: ev('no package.json and no .npmrc — this is not an npm project, so the Railway cross-platform workaround does not apply', { paths: ['package.json', '.npmrc'] }) }
      if (raw == null) return { status: 'fail', evidence: ev('.npmrc does not exist in the project root', { paths: ['.npmrc'] }) }
      const line = raw.split('\n').map(l => l.trim()).find(l => /^force\s*=\s*true$/i.test(l))
      return line
        ? { status: 'pass', evidence: ev(`.npmrc contains ${JSON.stringify(line)}`, { paths: ['.npmrc'], line }) }
        : { status: 'fail', evidence: ev(`.npmrc exists but sets no \`force=true\` (${raw.split('\n').filter(Boolean).length} non-empty line(s))`, { paths: ['.npmrc'], line: null }) }
    },
  },

  {
    id: 'lockfile-committed',
    label: 'a lockfile exists and is tracked by git',
    itemId: 'FA-061',
    run({ dir, gitBin }) {
      const present = LOCKFILES.filter(l => isFile(path.join(dir, l)))
      const hasPkg = isFile(path.join(dir, 'package.json'))
      if (!present.length) {
        return hasPkg
          ? { status: 'fail', evidence: ev(`package.json exists but no lockfile was found (looked for ${LOCKFILES.join(', ')}) — dependency versions are not pinned`, { paths: LOCKFILES }) }
          : { status: 'n-a', evidence: ev('no package.json and no lockfile — not an npm project', { paths: ['package.json'] }) }
      }
      const g = runGit(gitBin, ['-C', dir, 'ls-files', '--error-unmatch', '--', ...present], dir)
      const { state, note } = trackedState(g)
      if (state === 'unknown') return { status: 'unknown', evidence: ev(`lockfile(s) ${present.join(', ')} present, but tracked-in-git could not be checked: ${note}`, { paths: present, command: g.argv }) }
      if (state === 'untracked') return { status: 'fail', evidence: ev(`lockfile(s) ${present.join(', ')} present but not all are committed — ${note}`, { paths: present, command: g.argv, tracked: false }) }
      return { status: 'pass', evidence: ev(`lockfile(s) ${present.join(', ')} present and tracked in git (${note})`, { paths: present, command: g.argv, tracked: true }) }
    },
  },

  {
    id: 'robots-txt',
    label: 'robots.txt crawl policy',
    itemId: 'FA-072',
    run({ dir }) {
      const entries = checkList(dir)
      if (!entries) throw new CheckError(`cannot read directory ${dir}`)
      const names = new Set(entries.map(e => e.name))
      const webish = WEB_MARKERS.filter(m => names.has(m))
      if (!webish.length) return { status: 'n-a', evidence: ev(`no web entry point found (looked for ${WEB_MARKERS.join(', ')}) — there is nothing for a crawler to index`, { paths: WEB_MARKERS }) }
      const candidates = ['robots.txt', 'public/robots.txt', 'static/robots.txt', 'app/robots.txt']
      const found = candidates.filter(c => isFile(path.join(dir, c)))
      if (!found.length) {
        return { status: 'fail', evidence: ev(`repo looks web-facing (${webish.join(', ')} present) but no robots.txt was found at ${candidates.join(', ')}`, { paths: candidates, webMarkers: webish, found: [] }) }
      }
      const body = readText(path.join(dir, found[0])) || ''
      const disallowAll = /^\s*Disallow:\s*\/\s*$/mi.test(body)
      const noindex = /noindex/i.test(body)
      return {
        status: 'manual',
        evidence: ev(`${found[0]} found (${body.length} bytes): ${disallowAll ? 'contains `Disallow: /`' : 'does not contain a blanket `Disallow: /`'}${noindex ? ', mentions noindex' : ''}. Whether this is the intended policy, and the meta-robots and X-Robots-Tag layers, need a human.`,
          { paths: found, disallowAll, mentionsNoindex: noindex, webMarkers: webish }),
      }
    },
  },

  // ---- repository facts with no upstream checklist item -------------------------------------
  {
    id: 'license-file',
    label: 'a LICENSE file exists',
    itemId: null,
    run({ dir }) {
      const entries = checkList(dir)
      if (!entries) throw new CheckError(`cannot read directory ${dir}`)
      const names = entries.filter(e => e.isFile()).map(e => e.name)
      const found = LICENSE_NAMES.filter(n => names.includes(n))
      if (!found.length) return { status: 'fail', evidence: ev(`no license file in the repo root (looked for ${LICENSE_NAMES.join(', ')})`, { paths: LICENSE_NAMES, found: [] }) }
      const body = readText(path.join(dir, found[0])) || ''
      const firstLine = body.split('\n').map(l => l.trim()).find(Boolean) || '(empty)'
      return { status: 'pass', evidence: ev(`${found[0]} present (${body.length} bytes); first line: ${JSON.stringify(firstLine.slice(0, 120))}`, { paths: found, found, firstLine }) }
    },
  },

  {
    id: 'test-command',
    label: 'a test command is detectable',
    itemId: null,
    run({ dir }) {
      let detected
      try { detected = detectTestCommand(dir) }
      catch (err) { throw new CheckError(`test-command detection failed: ${err.message}`) }
      if (!detected) return { status: 'fail', evidence: ev('detectTestCommand() recognised no ecosystem marker in the repo root — no test command could be determined', { paths: [] }) }
      if (!detected.command) {
        return { status: 'fail', evidence: ev(`detectTestCommand() matched ${detected.id} via ${rel(dir, detected.marker)} but could confirm no runnable command${detected.note ? `: ${detected.note}` : ''}`, { paths: [rel(dir, detected.marker)], detector: detected.id, command: null, confidence: detected.confidence }) }
      }
      return {
        status: 'pass',
        evidence: ev(`detectTestCommand() → \`${detected.command}\` (${detected.id}, confidence ${detected.confidence}) from ${rel(dir, detected.marker)}${detected.note ? `; ${detected.note}` : ''}. The command was NOT executed.`,
          { paths: [rel(dir, detected.marker)], detector: detected.id, command: detected.command, confidence: detected.confidence }),
      }
    },
  },

  {
    id: 'tests-exist',
    label: 'test files exist on disk',
    itemId: null,
    run({ dir }) {
      const dirs = ['test', 'tests', '__tests__', 'spec']
      const entries = checkList(dir)
      if (!entries) throw new CheckError(`cannot read directory ${dir}`)
      const names = new Set(entries.map(e => e.name))
      const present = dirs.filter(d => names.has(d) && isDir(path.join(dir, d)))
      const { files, truncated } = walkSource(dir, {
        extensions: SCAN_LIMITS.sourceExtensions,
        maxFiles: SCAN_LIMITS.maxSourceFiles,
        maxDepth: SCAN_LIMITS.maxDepth,
        skipDirs: SCAN_LIMITS.skipDirs,
      })
      const testFiles = files.filter(f => /\.(test|spec)\.[mc]?[jt]sx?$/.test(path.basename(f)))
      const capNote = truncated ? ` Scan truncated at ${SCAN_LIMITS.maxSourceFiles} files / depth ${SCAN_LIMITS.maxDepth}, so the count is a lower bound.` : ''
      if (!present.length && !testFiles.length) {
        return truncated
          ? { status: 'unknown', evidence: ev(`no test directory (${dirs.join(', ')}) and no *.test.*/*.spec.* file found, but the scan was truncated so "none exist" cannot be asserted.${capNote}`, { paths: [], truncated }) }
          : { status: 'fail', evidence: ev(`no test directory (${dirs.join(', ')}) and no *.test.* / *.spec.* file among ${files.length} scanned source file(s)`, { paths: [], testDirs: [], testFiles: 0, filesScanned: files.length, truncated: false }) }
      }
      return {
        status: 'pass',
        evidence: ev(`test directories: ${present.length ? present.join(', ') : 'none'}; ${testFiles.length} *.test.*/*.spec.* file(s) among ${files.length} scanned source file(s).${capNote} No test was executed.`,
          { paths: present, testDirs: present, testFiles: testFiles.length, filesScanned: files.length, truncated }),
      }
    },
  },
])

function docPresence(dir, relPath, partialReason) {
  const p = path.join(dir, relPath)
  const body = readText(p)
  if (body == null) return { status: 'fail', evidence: ev(`${relPath} does not exist`, { paths: [relPath] }) }
  return {
    status: 'pass', partial: true, partialReason,
    evidence: ev(`${relPath} exists (${body.length} bytes, ${body.split('\n').length} lines). Contents were not assessed: ${partialReason}.`, { paths: [relPath], bytes: body.length }),
  }
}

export function envExampleKeys(text) {
  const out = []
  for (const line of String(text).split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(t)
    if (m && !out.includes(m[1]) && !ENV_IGNORED.includes(m[1])) out.push(m[1])
  }
  return out
}

const CHECK_BY_ID = new Map(CHECKS.map(c => [c.id, c]))

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------

/**
 * Run one check, converting any throw into `unknown` with the reason attached.
 * A check that crashes must never be able to produce a fail — the repo did not do anything
 * wrong, our code did.
 */
function runCheck(check, ctx) {
  let r
  try { r = check.run(ctx) }
  catch (err) {
    return { id: check.id, label: check.label, itemId: check.itemId, status: 'unknown', evidence: ev(`check "${check.id}" could not complete: ${err.message}`, { paths: [], error: err.code || err.name || 'Error' }) }
  }
  if (!r || !STATUSES[r.status]) {
    return { id: check.id, label: check.label, itemId: check.itemId, status: 'unknown', evidence: ev(`check "${check.id}" returned an unrecognised result`, { paths: [] }) }
  }
  return {
    id: check.id, label: check.label, itemId: check.itemId,
    status: r.status,
    evidence: r.evidence || null,
    ...(r.partial ? { partial: true, partialReason: r.partialReason || 'the check verifies only part of the item' } : {}),
  }
}

/**
 * Audit a checkout on disk against the freeze-audit checklist.
 *
 * @param {string} dir      repository root to inspect. Never read from cwd.
 * @param {object} [opts]
 * @param {string[]|null} [opts.stacks]  declared stack tags (see STACK_TAGS). When provided,
 *        items scoped to other stacks resolve to `n-a` with evidence saying so. When omitted,
 *        no item is filtered out — we do not guess what stack you are on.
 * @param {string} [opts.gitBin='git']   git executable. A seam for tests, and the reason a
 *        missing git binary is reachable as a real condition rather than a mocked one.
 * @param {string[]} [opts.ticked]       ids of items a human has manually attested. Only affects
 *        the verdict; a tick never overwrites a machine `fail` or `unknown`.
 *
 * @returns {{dir, stacks, items, checks, summary, verdict, blockers, limits}}
 *   `items` is one row per checklist item: { id, category, text, appliesTo, status, evidence,
 *   check, manualReason?, tickedByHuman? }.
 */
export function auditRepo(dir, opts = {}) {
  const { stacks = null, gitBin = 'git', ticked = [] } = opts
  const tickedSet = new Set(ticked)
  const ctx = { dir, gitBin }

  let preflightError = null
  if (typeof dir !== 'string' || !dir) preflightError = 'no directory was given'
  else {
    try {
      const st = fs.statSync(dir)
      if (!st.isDirectory()) preflightError = `${dir} is not a directory`
      else fs.readdirSync(dir)
    } catch (err) {
      preflightError = `cannot read ${dir}: ${err.code || err.message}`
    }
  }

  if (preflightError) {
    const evidence = ev(`audit could not run: ${preflightError}`, { paths: [typeof dir === 'string' ? dir : String(dir)], error: preflightError })
    return {
      dir,
      stacks,
      preflightError,
      checks: CHECKS.map(c => ({ id: c.id, label: c.label, itemId: c.itemId, status: 'unknown', evidence })),
      items: ITEMS.map(i => ({ ...i, status: 'unknown', evidence, check: i.auto || null })),
      summary: summarise(ITEMS.map(() => ({ status: 'unknown' }))),
      verdict: 'READ-ONLY PLAN',
      blockers: ITEMS.map(i => i.id),
      limits: SCAN_LIMITS,
    }
  }

  const checkResults = CHECKS.map(c => runCheck(c, ctx))
  const byItem = new Map(checkResults.filter(r => r.itemId).map(r => [r.itemId, r]))
  const applicable = new Set(applicableItems(stacks).map(i => i.id))

  const items = ITEMS.map(item => {
    const base = { ...item, check: item.auto || null }
    if (!applicable.has(item.id)) {
      return {
        ...base,
        status: 'n-a',
        evidence: ev(`item is scoped to [${item.appliesTo.join(', ')}]; declared stacks are [${(stacks || []).join(', ') || 'none'}]`, { paths: [], appliesTo: item.appliesTo, stacks: stacks || [] }),
      }
    }
    const r = item.auto ? byItem.get(item.id) : null
    if (!r) {
      return { ...base, status: 'manual', evidence: null }
    }
    if (r.status === 'pass' && r.partial) {
      return {
        ...base,
        status: 'manual',
        evidence: { ...r.evidence, detail: `${r.evidence.detail} Not machine-verifiable: ${r.partialReason}`, partialReason: r.partialReason },
      }
    }
    return { ...base, status: r.status, evidence: r.evidence }
  }).map(row => (tickedSet.has(row.id) ? { ...row, tickedByHuman: true } : row))

  const summary = summarise(items)
  const blockers = items.filter(i => i.status === 'fail' || i.status === 'unknown' || (i.status === 'manual' && !i.tickedByHuman)).map(i => i.id)

  return {
    dir,
    stacks,
    preflightError: null,
    checks: checkResults,
    items,
    summary,
    verdict: blockers.length ? 'READ-ONLY PLAN' : 'READY TO FREEZE',
    blockers,
    limits: SCAN_LIMITS,
  }
}

function summarise(items) {
  const s = { total: items.length, pass: 0, fail: 0, 'n-a': 0, manual: 0, unknown: 0 }
  for (const i of items) if (i.status in s) s[i.status]++
  return s
}

/**
 * The upstream verdict token for an arbitrary set of rows.
 * Exported separately so a UI that lets a human tick manual items can recompute without
 * re-running the filesystem work.
 */
export function verdictFor(items, ticked = []) {
  const t = new Set(ticked)
  const blockers = items.filter(i => i.status === 'fail' || i.status === 'unknown' || (i.status === 'manual' && !t.has(i.id))).map(i => i.id)
  return { verdict: blockers.length ? 'READ-ONLY PLAN' : 'READY TO FREEZE', blockers }
}
