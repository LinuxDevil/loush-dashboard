import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  ITEMS, CHECKS, CATEGORIES, STACK_TAGS, STATUSES, MANUAL_REASONS, SCAN_LIMITS,
  applicableItems, auditRepo, verdictFor, envExampleKeys,
} from '../../lib/freeze-audit.mjs'

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------

function repo(t, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freeze-audit-'))
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, body)
  }
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} })
  return dir
}

const GIT_AVAILABLE = (() => {
  try { return spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0 } catch { return false }
})()

function gitInit(dir, { commit = true } = {}) {
  const run = args => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
  run(['init', '-q'])
  run(['config', 'user.email', 'test@example.invalid'])
  run(['config', 'user.name', 'Freeze Audit Test'])
  run(['config', 'commit.gpgsign', 'false'])
  if (commit) {
    run(['add', '-A'])
    run(['commit', '-q', '-m', 'fixture'])
  }
  return dir
}

function compliantRepo(t, extra = {}) {
  return repo(t, {
    '.claude/agents/security-reviewer.md': '# security reviewer\n',
    '.claude/agents/test-coverage.md': '# test coverage\n',
    '.claude/hooks/pre_tool_use.py': '#!/usr/bin/env python3\nimport sys\nsys.exit(0)\n',
    '.claude/settings.json': JSON.stringify({ permissions: { defaultMode: 'acceptEdits' }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '.claude/hooks/pre_tool_use.py' }] }] } }, null, 2),
    '.gitignore': 'node_modules\n.claude/settings.local.json\n',
    '.env.example': '# API access\nAPI_TOKEN=\nDATABASE_URL=\n',
    '.npmrc': 'force=true\n',
    'package.json': JSON.stringify({ name: 'fixture', scripts: { test: 'node --test' } }),
    'package-lock.json': '{"lockfileVersion":3}',
    'LICENSE': 'MIT License\n\nCopyright (c) 2026\n',
    'src/app.mjs': 'export const token = process.env.API_TOKEN\nexport const db = process.env.DATABASE_URL\n',
    'test/app.test.mjs': 'import test from "node:test"\ntest("ok", () => {})\n',
    'tests/role-tests.md': '# Role tests\n- admin\n',
    'STATE.md': '# State\nPhase 1 complete 2026-01-01\n',
    'CONTEXT.md': '# Context\nDecisions.\n',
    'lessons-learned.md': '# Lessons\n',
    'docs/resources/README.md': '# Resources\n',
    ...extra,
  })
}

const itemById = (result, id) => result.items.find(i => i.id === id)
const checkById = (result, id) => result.checks.find(c => c.id === id)

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------

test('the checklist is exactly 75 items numbered FA-001 through FA-075', () => {
  assert.equal(ITEMS.length, 75)
  assert.deepEqual(ITEMS.map(i => i.id), Array.from({ length: 75 }, (_, n) => `FA-${String(n + 1).padStart(3, '0')}`))
  assert.equal(new Set(ITEMS.map(i => i.id)).size, 75, 'ids must be unique')
})

test('every item carries text, a category and a resolvable appliesTo tag', () => {
  const checkIds = new Set(CHECKS.map(c => c.id))
  for (const i of ITEMS) {
    assert.ok(i.text && i.text.length > 10, `${i.id} has no usable text`)
    assert.ok(CATEGORIES.includes(i.category), `${i.id} has an unlisted category`)
    assert.ok(i.appliesTo === null || (Array.isArray(i.appliesTo) && i.appliesTo.length), `${i.id}: appliesTo must be null or a non-empty array, never []`)
    if (i.appliesTo) for (const tag of i.appliesTo) assert.ok(STACK_TAGS.includes(tag), `${i.id} uses tag ${tag} missing from STACK_TAGS`)
    if (i.auto) assert.ok(checkIds.has(i.auto), `${i.id} points at unknown check ${i.auto}`)
  }
})

test('an item without an automated check states why it is manual', () => {
  for (const i of ITEMS) {
    if (i.auto) assert.equal(i.manualReason, undefined, `${i.id} has both a check and a manualReason`)
    else assert.ok(i.manualReason in MANUAL_REASONS, `${i.id} is manual with no valid reason (got ${i.manualReason})`)
  }
})

test('stack-specific items are tagged so they are filtered, not shown as failures', () => {
  const universal = ITEMS.filter(i => !i.appliesTo)
  const scoped = ITEMS.filter(i => i.appliesTo)
  assert.equal(universal.length + scoped.length, 75)
  assert.equal(universal.length, 44)
  assert.equal(scoped.length, 31)
  for (const id of ['FA-005', 'FA-006', 'FA-007', 'FA-008', 'FA-009', 'FA-013', 'FA-054', 'FA-059', 'FA-072']) {
    assert.ok(ITEMS.find(i => i.id === id).appliesTo, `${id} is stack-specific upstream and must be tagged`)
  }
  for (const id of ['FA-032', 'FA-035', 'FA-036', 'FA-053', 'FA-058']) {
    assert.deepEqual(ITEMS.find(i => i.id === id).appliesTo, ['ccbf'], `${id} checks a framework-private file and must be scoped to it`)
  }
})

test('applicableItems keeps everything when no stack is declared', () => {
  assert.equal(applicableItems(null).length, 75)
  assert.equal(applicableItems([]).length, 44)
  const supa = applicableItems(['supabase'])
  assert.ok(supa.some(i => i.id === 'FA-005'))
  assert.ok(!supa.some(i => i.id === 'FA-013'), 'a React-only item must not ride along with supabase')
})

test('envExampleKeys reads assignments and ignores comments and blank lines', () => {
  assert.deepEqual(envExampleKeys('# group\nA=1\n\nexport B=\n#C=2\nD =3\n'), ['A', 'B', 'D'])
})

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------

test('every non-manual result carries evidence', async t => {
  const r = auditRepo(compliantRepo(t), {})
  for (const row of [...r.items, ...r.checks]) {
    if (row.status === 'manual') continue
    assert.ok(row.evidence, `${row.id} is ${row.status} with no evidence`)
    assert.equal(typeof row.evidence.detail, 'string')
    assert.ok(row.evidence.detail.length > 10, `${row.id} evidence detail is too thin: ${row.evidence.detail}`)
    assert.ok(Array.isArray(row.evidence.paths) || row.evidence.command, `${row.id} evidence names neither a path nor a command`)
  }
})

test('no result ever carries a status outside the declared vocabulary', async t => {
  const r = auditRepo(compliantRepo(t))
  for (const row of [...r.items, ...r.checks]) assert.ok(row.status in STATUSES, `${row.id} has bogus status ${row.status}`)
})

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------

test('a compliant checkout produces no failures on the checks it can decide', { skip: !GIT_AVAILABLE && 'git is not installed' }, async t => {
  const dir = compliantRepo(t)
  gitInit(dir)
  const r = auditRepo(dir)
  const failed = r.checks.filter(c => c.status === 'fail')
  assert.deepEqual(failed.map(c => `${c.id}: ${c.evidence.detail}`), [], 'a compliant fixture must not fail any check')
  assert.equal(checkById(r, 'agents-dir').status, 'pass')
  assert.equal(checkById(r, 'pre-tool-use-hook').status, 'pass')
  assert.equal(checkById(r, 'settings-json').status, 'pass')
  assert.equal(checkById(r, 'env-example-sync').status, 'pass')
  assert.equal(checkById(r, 'license-file').status, 'pass')
  assert.equal(checkById(r, 'test-command').status, 'pass')
  assert.equal(checkById(r, 'tests-exist').status, 'pass')
  assert.equal(checkById(r, 'npmrc-force').status, 'pass')
})

test('an empty directory fails the file checks rather than reporting unknown', async t => {
  const dir = repo(t, {})
  const r = auditRepo(dir)
  assert.equal(checkById(r, 'agents-dir').status, 'fail')
  assert.match(checkById(r, 'agents-dir').evidence.detail, /\.claude\/agents\/ does not exist/)
  assert.equal(checkById(r, 'settings-json').status, 'fail')
  assert.equal(checkById(r, 'license-file').status, 'fail')
  assert.equal(checkById(r, 'test-command').status, 'fail', 'no ecosystem marker means no detectable test command')
  assert.equal(checkById(r, 'tests-exist').status, 'fail')
  const unknownIds = r.checks.filter(c => c.status === 'unknown').map(c => c.id)
  assert.deepEqual(unknownIds, ['env-file-not-tracked'], 'a readable directory must not produce unknowns beyond the git-dependent ones')
})

test('an existing but empty .claude/agents directory is a failure, not a pass', async t => {
  const dir = repo(t, {})
  fs.mkdirSync(path.join(dir, '.claude', 'agents'), { recursive: true })
  const c = checkById(auditRepo(dir), 'agents-dir')
  assert.equal(c.status, 'fail')
  assert.match(c.evidence.detail, /contains no files/)
})

test('agent evidence names the files found and which recommended agents are missing', async t => {
  const dir = compliantRepo(t)
  const c = checkById(auditRepo(dir), 'agents-dir')
  assert.deepEqual(c.evidence.agents, ['security-reviewer.md', 'test-coverage.md'])
  assert.deepEqual(c.evidence.recommendedMissing, ['component-checker'])
})

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------

test('settings.json missing hooks or permissions.defaultMode fails and names what is missing', async t => {
  const dir = repo(t, { '.claude/settings.json': JSON.stringify({ permissions: {} }) })
  const c = checkById(auditRepo(dir), 'settings-json')
  assert.equal(c.status, 'fail')
  assert.match(c.evidence.detail, /missing: hooks \(absent or empty\), permissions\.defaultMode/)
  assert.deepEqual(c.evidence.hookEvents, [])
})

test('an unparseable settings.json is a failure of the repo, not of the check', async t => {
  const dir = repo(t, { '.claude/settings.json': '{ "hooks": ' })
  const c = checkById(auditRepo(dir), 'settings-json')
  assert.equal(c.status, 'fail')
  assert.match(c.evidence.detail, /not valid JSON/)
})

test('a pre-tool-use hook on disk but absent from settings.json is a failure', async t => {
  const dir = repo(t, {
    '.claude/hooks/pre_tool_use.py': 'import sys\n',
    '.claude/settings.json': JSON.stringify({ permissions: { defaultMode: 'acceptEdits' }, hooks: { PostToolUse: [] } }),
  })
  const c = checkById(auditRepo(dir), 'pre-tool-use-hook')
  assert.equal(c.status, 'fail')
  assert.equal(c.evidence.registered, false)
})

test('a pre-tool-use hook with no settings.json to confirm it is only partly verified', async t => {
  const dir = repo(t, { '.claude/hooks/pre-tool-use.sh': '#!/bin/sh\nexit 0\n' })
  const r = auditRepo(dir)
  const c = checkById(r, 'pre-tool-use-hook')
  assert.equal(c.status, 'pass')
  assert.equal(c.partial, true)
  assert.equal(itemById(r, 'FA-020').status, 'manual', 'a half-verified item must land on a human, not on a green tick')
})

test('a hook that shells out to the network fails with the file and line', async t => {
  const dir = repo(t, { '.claude/hooks/pre_tool_use.sh': '#!/bin/sh\necho hi\ncurl -X POST https://example.invalid/collect\n' })
  const c = checkById(auditRepo(dir), 'hook-network-scan')
  assert.equal(c.status, 'fail')
  assert.equal(c.evidence.hits[0].line, 3)
  assert.equal(c.evidence.hits[0].pattern, 'curl')
})

test('a clean hook scan is never reported as a pass on the item', async t => {
  const dir = repo(t, { '.claude/hooks/pre_tool_use.sh': '#!/bin/sh\nexit 0\n' })
  const r = auditRepo(dir)
  assert.equal(checkById(r, 'hook-network-scan').status, 'pass')
  assert.equal(checkById(r, 'hook-network-scan').partial, true)
  assert.equal(itemById(r, 'FA-021').status, 'manual')
  assert.match(itemById(r, 'FA-021').evidence.detail, /not proof of safety/)
})

test('a repo with no hooks directory marks the hook-content item n-a, not failed', async t => {
  const dir = repo(t, {})
  assert.equal(checkById(auditRepo(dir), 'hook-network-scan').status, 'n-a')
})

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------

test('settings.local.json missing from .gitignore fails via the text fallback', async t => {
  const dir = repo(t, { '.gitignore': 'node_modules\ndist\n' })
  const c = checkById(auditRepo(dir), 'settings-local-gitignored')
  assert.equal(c.status, 'fail')
  assert.equal(c.evidence.matchedPattern, null)
  assert.match(c.evidence.detail, /\.gitignore text scan/, 'evidence must say which method produced the verdict')
})

test('ignoring the whole .claude directory counts as ignoring settings.local.json', async t => {
  const dir = repo(t, { '.gitignore': '.claude/\n' })
  const c = checkById(auditRepo(dir), 'settings-local-gitignored')
  assert.equal(c.status, 'pass')
  assert.equal(c.evidence.matchedPattern, '.claude/')
})

test('a negated .gitignore pattern does not count as an ignore rule', async t => {
  const dir = repo(t, { '.gitignore': '!settings.local.json\n' })
  assert.equal(checkById(auditRepo(dir), 'settings-local-gitignored').status, 'fail')
})

test('git check-ignore is used when the directory really is a repo', { skip: !GIT_AVAILABLE && 'git is not installed' }, async t => {
  const dir = repo(t, { '.gitignore': '.claude/settings.local.json\n' })
  gitInit(dir)
  const c = checkById(auditRepo(dir), 'settings-local-gitignored')
  assert.equal(c.status, 'pass')
  assert.equal(c.evidence.method, 'git check-ignore')
  assert.deepEqual(c.evidence.command.slice(1), ['-C', dir, 'check-ignore', '-q', '--', '.claude/settings.local.json'])
})

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------

test('an env var read in source but undocumented fails with the file and line that used it', async t => {
  const dir = repo(t, {
    '.env.example': 'API_TOKEN=\n',
    'src/a.mjs': 'const t = process.env.API_TOKEN\n',
    'src/b.mjs': '\nconst s = process.env.SECRET_KEY\n',
  })
  const c = checkById(auditRepo(dir), 'env-example-sync')
  assert.equal(c.status, 'fail')
  assert.deepEqual(c.evidence.missing, ['SECRET_KEY'])
  assert.equal(c.evidence.usage.SECRET_KEY, path.join('src', 'b.mjs') + ':2')
})

test('a documented key nothing reads is reported stale rather than ignored', async t => {
  const dir = repo(t, { '.env.example': 'USED=\nGONE=\n', 'src/a.mjs': 'process.env.USED\n' })
  const c = checkById(auditRepo(dir), 'env-example-sync')
  assert.equal(c.status, 'fail')
  assert.deepEqual(c.evidence.stale, ['GONE'])
})

test('bracket and import.meta env access are counted, and NODE_ENV is excluded out loud', async t => {
  const dir = repo(t, {
    '.env.example': 'VITE_API=\n',
    'src/a.mjs': 'process.env["BRACKET_KEY"]\nimport.meta.env.VITE_API\nprocess.env.NODE_ENV\n',
  })
  const c = checkById(auditRepo(dir), 'env-example-sync')
  assert.deepEqual(c.evidence.missing, ['BRACKET_KEY'])
  assert.ok(!c.evidence.missing.includes('NODE_ENV'))
  assert.deepEqual(c.evidence.ignoredKeys, ['NODE_ENV'])
  assert.match(c.evidence.detail, /ignored by name: NODE_ENV/, 'an exclusion the user cannot see is a silent skip')
})

test('node_modules is not scanned for env usage', async t => {
  const dir = repo(t, { '.env.example': '', 'node_modules/pkg/index.js': 'process.env.THEIR_KEY\n' })
  const c = checkById(auditRepo(dir), 'env-example-sync')
  assert.equal(c.status, 'pass')
  assert.match(c.evidence.detail, /skipping node_modules/, 'the skip list must be stated in the evidence')
})

test('a truncated source scan reports unknown instead of a clean bill of health', async t => {
  const deep = Array.from({ length: SCAN_LIMITS.maxDepth + 2 }, (_, n) => `d${n}`).join('/')
  const dir = repo(t, { '.env.example': 'API=\n', 'src/a.mjs': 'process.env.API\n', [`${deep}/buried.mjs`]: 'process.env.HIDDEN\n' })
  const c = checkById(auditRepo(dir), 'env-example-sync')
  assert.equal(c.status, 'unknown')
  assert.equal(c.evidence.truncated, true)
  assert.match(c.evidence.detail, /TRUNCATED/)
  assert.equal(c.evidence.limits.maxDepth, SCAN_LIMITS.maxDepth, 'the bound that changed the answer must be reported')
})

test('a mismatch still fails even when the scan was truncated', async t => {
  const deep = Array.from({ length: SCAN_LIMITS.maxDepth + 2 }, (_, n) => `d${n}`).join('/')
  const dir = repo(t, { '.env.example': 'API=\n', 'src/a.mjs': 'process.env.OTHER\n', [`${deep}/buried.mjs`]: '\n' })
  const c = checkById(auditRepo(dir), 'env-example-sync')
  assert.equal(c.status, 'fail')
  assert.deepEqual(c.evidence.missing, ['OTHER'])
})

test('a missing .env.example fails both env items and lists what source expects', async t => {
  const dir = repo(t, { 'src/a.mjs': 'process.env.API_TOKEN\n' })
  const r = auditRepo(dir)
  assert.equal(itemById(r, 'FA-046').status, 'fail')
  assert.equal(itemById(r, 'FA-047').status, 'fail')
  assert.deepEqual(checkById(r, 'env-example-sync').evidence.missing, ['API_TOKEN'])
})

test('a present .env.example resolves FA-046 to manual because its prose cannot be graded', async t => {
  const dir = compliantRepo(t)
  const r = auditRepo(dir)
  assert.equal(checkById(r, 'env-example-exists').status, 'pass')
  assert.equal(itemById(r, 'FA-046').status, 'manual')
  assert.match(itemById(r, 'FA-046').evidence.detail, /grouping, descriptions and source instructions/)
})

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------

test('a missing git binary yields unknown with the reason, never fail', { skip: !GIT_AVAILABLE && 'git is not installed' }, async t => {
  const dir = compliantRepo(t)
  gitInit(dir)
  const r = auditRepo(dir, { gitBin: 'definitely-not-a-real-git-binary' })
  for (const id of ['git-clean', 'env-file-not-tracked', 'lockfile-committed']) {
    const c = checkById(r, id)
    assert.equal(c.status, 'unknown', `${id} must be unknown when git is absent`)
    assert.notEqual(c.status, 'fail')
    assert.match(c.evidence.detail, /ENOENT|not found/, `${id} must say why it could not run`)
  }
  assert.equal(itemById(r, 'FA-057').status, 'unknown')
})

test('git is invoked with an argv array, and the exact argv is the evidence', { skip: !GIT_AVAILABLE && 'git is not installed' }, async t => {
  const dir = compliantRepo(t)
  gitInit(dir)
  const c = checkById(auditRepo(dir), 'git-clean')
  assert.deepEqual(c.evidence.command, ['git', '-C', dir, 'status', '--porcelain'])
})

test('a dirty working tree fails and names the changed paths', { skip: !GIT_AVAILABLE && 'git is not installed' }, async t => {
  const dir = compliantRepo(t)
  gitInit(dir)
  fs.writeFileSync(path.join(dir, 'untracked.txt'), 'x')
  const r = auditRepo(dir)
  const c = checkById(r, 'git-clean')
  assert.equal(c.status, 'fail')
  assert.ok(c.evidence.dirty.some(l => l.includes('untracked.txt')))
  assert.equal(itemById(r, 'FA-057').status, 'fail')
})

test('a clean tree does not attest the "descriptive commit history" half of FA-057', { skip: !GIT_AVAILABLE && 'git is not installed' }, async t => {
  const dir = compliantRepo(t)
  gitInit(dir)
  const r = auditRepo(dir)
  assert.equal(checkById(r, 'git-clean').status, 'pass')
  assert.equal(itemById(r, 'FA-057').status, 'manual')
  assert.match(itemById(r, 'FA-057').evidence.detail, /descriptive commit history/)
})

test('a directory that is not a git repository fails the git item without crashing', { skip: !GIT_AVAILABLE && 'git is not installed' }, async t => {
  const dir = repo(t, { 'a.txt': 'x' })
  const c = checkById(auditRepo(dir), 'git-clean')
  assert.equal(c.status, 'fail')
  assert.match(c.evidence.detail, /not a git repository/)
})

test('a tracked .env file fails the secrets item', { skip: !GIT_AVAILABLE && 'git is not installed' }, async t => {
  const dir = compliantRepo(t, { '.env': 'API_TOKEN=real-secret\n' })
  gitInit(dir)
  const c = checkById(auditRepo(dir), 'env-file-not-tracked')
  assert.equal(c.status, 'fail')
  assert.deepEqual(c.evidence.paths, ['.env'])
})

test('an untracked lockfile fails even though the file is on disk', { skip: !GIT_AVAILABLE && 'git is not installed' }, async t => {
  const dir = repo(t, { 'package.json': '{}', '.gitignore': 'package-lock.json\n' })
  gitInit(dir)
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}')
  const c = checkById(auditRepo(dir), 'lockfile-committed')
  assert.equal(c.status, 'fail')
})

test('a project with no package.json marks the npm items n-a rather than failing them', async t => {
  const dir = repo(t, { 'main.go': 'package main\n' })
  const r = auditRepo(dir)
  assert.equal(checkById(r, 'lockfile-committed').status, 'n-a')
  assert.equal(checkById(r, 'npmrc-force').status, 'n-a')
})

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------

test('a directory that does not exist makes every item unknown, never fail', async t => {
  const r = auditRepo(path.join(os.tmpdir(), 'freeze-audit-nonexistent-' + Date.now()))
  assert.equal(r.summary.unknown, 75)
  assert.equal(r.summary.fail, 0)
  assert.equal(r.summary.pass, 0)
  assert.match(r.preflightError, /ENOENT/)
  assert.match(r.items[0].evidence.detail, /audit could not run/)
  assert.equal(r.verdict, 'READ-ONLY PLAN')
})

test('a path that is a file rather than a directory is unknown', async t => {
  const dir = repo(t, { 'file.txt': 'x' })
  const r = auditRepo(path.join(dir, 'file.txt'))
  assert.equal(r.summary.unknown, 75)
  assert.equal(r.summary.fail, 0)
  assert.match(r.preflightError, /not a directory|ENOTDIR/)
})

test('a null or empty directory argument is unknown rather than an exception', async t => {
  for (const bad of [undefined, null, '']) {
    const r = auditRepo(bad)
    assert.equal(r.summary.unknown, 75, `auditRepo(${JSON.stringify(bad)}) must degrade, not throw`)
    assert.equal(r.summary.fail, 0)
  }
})

test('an unreadable directory is unknown, not fail', { skip: process.getuid && process.getuid() === 0 ? 'running as root, which bypasses mode bits' : false }, async t => {
  const dir = repo(t, {})
  fs.chmodSync(dir, 0o000)
  t.after(() => { try { fs.chmodSync(dir, 0o755) } catch {} })
  const r = auditRepo(dir)
  assert.equal(r.summary.fail, 0)
  assert.equal(r.summary.unknown, 75)
  assert.match(r.preflightError, /EACCES/)
})

test('an unreadable subdirectory makes only its own check unknown', { skip: process.getuid && process.getuid() === 0 ? 'running as root, which bypasses mode bits' : false }, async t => {
  const dir = compliantRepo(t)
  fs.chmodSync(path.join(dir, '.claude', 'agents'), 0o000)
  t.after(() => { try { fs.chmodSync(path.join(dir, '.claude', 'agents'), 0o755) } catch {} })
  const r = auditRepo(dir)
  assert.equal(checkById(r, 'agents-dir').status, 'unknown')
  assert.match(checkById(r, 'agents-dir').evidence.detail, /EACCES/)
  assert.equal(checkById(r, 'license-file').status, 'pass', 'unrelated checks must still run')
})

test('a directory that cannot be listed is unknown, and takes no other check down with it', async t => {
  const dir = compliantRepo(t)
  fs.rmSync(path.join(dir, '.claude', 'agents'), { recursive: true, force: true })
  fs.symlinkSync('agents', path.join(dir, '.claude', 'agents'))
  const r = auditRepo(dir)
  const c = checkById(r, 'agents-dir')
  assert.equal(c.status, 'unknown')
  assert.notEqual(c.status, 'fail')
  assert.match(c.evidence.detail, /ELOOP/, 'the reason the check could not run must be in the evidence')
  assert.equal(itemById(r, 'FA-019').status, 'unknown')
  assert.equal(checkById(r, 'license-file').status, 'pass', 'one broken check must not poison the rest')
})

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------

test('items scoped to an undeclared stack become n-a with evidence saying so', async t => {
  const dir = compliantRepo(t)
  const r = auditRepo(dir, { stacks: ['npm'] })
  const supa = itemById(r, 'FA-005')
  assert.equal(supa.status, 'n-a')
  assert.match(supa.evidence.detail, /scoped to \[supabase, postgres\]/)
  assert.equal(itemById(r, 'FA-059').status !== 'n-a', true, 'an npm-tagged item stays in scope when npm is declared')
})

test('declaring no stacks leaves stack-specific items in play rather than hiding them', async t => {
  const dir = compliantRepo(t)
  const r = auditRepo(dir)
  assert.notEqual(itemById(r, 'FA-005').status, 'n-a')
})

test('the verdict is READ-ONLY PLAN while anything is failed, unknown or unticked', async t => {
  const dir = compliantRepo(t)
  const r = auditRepo(dir)
  assert.equal(r.verdict, 'READ-ONLY PLAN')
  assert.ok(r.blockers.length > 0)
  assert.ok(r.blockers.includes('FA-001'), 'an untouched manual item blocks the freeze')
})

test('a human tick can clear a manual item but never a fail or an unknown', async t => {
  const rows = [
    { id: 'A', status: 'manual' },
    { id: 'B', status: 'fail' },
    { id: 'C', status: 'unknown' },
    { id: 'D', status: 'pass' },
    { id: 'E', status: 'n-a' },
  ]
  assert.deepEqual(verdictFor(rows, ['A']).blockers, ['B', 'C'])
  assert.deepEqual(verdictFor(rows, ['A', 'B', 'C']).blockers, ['B', 'C'])
  assert.equal(verdictFor([{ id: 'A', status: 'manual' }, { id: 'D', status: 'pass' }], ['A']).verdict, 'READY TO FREEZE')
})

test('ticked items are marked on the row without altering the machine status', async t => {
  const dir = compliantRepo(t)
  const r = auditRepo(dir, { ticked: ['FA-001', 'FA-019'] })
  assert.equal(itemById(r, 'FA-001').status, 'manual')
  assert.equal(itemById(r, 'FA-001').tickedByHuman, true)
  assert.equal(itemById(r, 'FA-019').status, 'pass', 'a tick must not overwrite what the check found')
  assert.ok(!r.blockers.includes('FA-001'))
})

test('auditRepo reads the directory it is given and not the process cwd', async t => {
  const dir = repo(t, {})
  const before = process.cwd()
  const r = auditRepo(dir)
  assert.equal(r.dir, dir)
  assert.equal(process.cwd(), before)
  assert.equal(checkById(r, 'license-file').status, 'fail', 'the empty fixture has no LICENSE; this repo does')
})

test('the scan limits that can change an answer are exported', async t => {
  assert.ok(SCAN_LIMITS.maxSourceFiles > 0 && SCAN_LIMITS.maxFileBytes > 0 && SCAN_LIMITS.maxDepth > 0)
  assert.ok(Object.isFrozen(SCAN_LIMITS))
  const dir = compliantRepo(t)
  assert.equal(auditRepo(dir).limits, SCAN_LIMITS)
})

test('every check reports either an item binding or an explicit null', async t => {
  const ids = new Set(ITEMS.map(i => i.id))
  for (const c of CHECKS) {
    assert.ok(c.itemId === null || ids.has(c.itemId), `${c.id} binds to unknown item ${c.itemId}`)
    if (c.itemId) assert.equal(ITEMS.find(i => i.id === c.itemId).auto, c.id, `${c.itemId} and ${c.id} must point at each other`)
  }
  assert.equal(new Set(CHECKS.map(c => c.id)).size, CHECKS.length, 'check ids must be unique')
})
