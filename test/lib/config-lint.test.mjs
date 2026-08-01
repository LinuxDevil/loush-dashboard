// Tests for lib/config-lint.mjs.
//
// The catalogue is only worth anything if each rule corresponds to real breakage in THIS repo, so
// the fixtures below are shaped like the real failures named in the rule messages. The honesty
// properties under test:
//   · an unparseable file yields a diagnostic, NEVER zero diagnostics (zero reads as "clean");
//   · a missing file is reported as missing, not as clean;
//   · line numbers are located or null-with-a-reason — never guessed;
//   · fixes are proposals; nothing is written to disk.
//
// The last block runs the linter over the REAL ~/.claude tree and this repo's own config.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  lintClaudeMd, lintClaudeMdLayers, lintSkill, lintSkillsDir, lintSettings,
  lintMcpConfig, lintMcpObject, lintMcpScopeCollisions, lintAll, proposedFixes,
  parseFrontmatter, SEVERITY, CLAUDE_MD_SOFT_CAP_TOKENS,
} from '../../lib/config-lint.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ids = r => (r.diagnostics || []).map(d => d.id)
const has = (r, id) => ids(r).includes(id)
const one = (r, id) => r.diagnostics.find(d => d.id === id)

let TMP
function tmp(name, content) {
  TMP ||= fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-lint-'))
  const p = path.join(TMP, name)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content)
  return p
}
test.after?.(() => { if (TMP) fs.rmSync(TMP, { recursive: true, force: true }) })

// --- the anti-"clean" property ------------------------------------------------------------------
test('an unparseable settings.json yields a diagnostic, not zero diagnostics', () => {
  const f = tmp('bad/settings.json', '{ "hooks": { "Stop": [] }, }') // trailing comma
  const r = lintSettings(f)
  assert.equal(r.parsed, false)
  assert.ok(r.diagnostics.length > 0, 'zero diagnostics on an unparseable file reads as "clean"')
  assert.equal(r.diagnostics[0].id, 'settings/parse-error')
  assert.equal(r.diagnostics[0].severity, SEVERITY.ERROR)
  assert.match(r.diagnostics[0].message, /server\/index\.mjs:348/)
  assert.match(r.diagnostics[0].message, /Fix:/)
})

test('an unparseable MCP config yields a diagnostic', () => {
  const f = tmp('bad/.mcp.json', '{"mcpServers": {"a": {command: "x"}}}')
  const r = lintMcpConfig(f)
  assert.equal(r.parsed, false)
  assert.equal(r.diagnostics[0].id, 'mcp/parse-error')
})

test('a SKILL.md with broken YAML yields a parse diagnostic, not silence', () => {
  const f = tmp('skills/broken/SKILL.md', '---\nname: broken\ndescription: a: b: c\n  bad indent\n---\nbody\n')
  const r = lintSkill(f)
  assert.equal(r.parsed, false)
  assert.equal(r.diagnostics[0].id, 'skill/parse-error')
  assert.match(r.diagnostics[0].message, /silently stops triggering/)
})

test('a missing file is reported as not-existing, and lintAll refuses to call that clean', () => {
  const r = lintSettings(path.join(TMP || os.tmpdir(), 'nope', 'settings.json'))
  assert.equal(r.exists, false)
  assert.deepEqual(r.diagnostics, [])
  assert.match(r.note, /NOT a clean result|nothing linted/)

  const all = lintAll({ settings: path.join(os.tmpdir(), 'definitely-not-here-xyz', 'settings.json') })
  assert.equal(all.counts.total, 0)
  assert.equal(all.coverage.targetsMissing, 1)
  assert.match(all.coverage.note, /means "not checked", not "clean"/)
})

// --- hooks ---------------------------------------------------------------------------------------
test('hooks[event] as an object instead of an array is an error naming both readers it breaks', () => {
  const f = tmp('h1/settings.json', JSON.stringify({ hooks: { Stop: { matcher: '', hooks: [] } } }, null, 2))
  const r = lintSettings(f)
  assert.ok(has(r, 'hook/event-not-array'))
  const d = one(r, 'hook/event-not-array')
  assert.match(d.message, /1383/)
  assert.match(d.message, /HooksSection\.jsx:66/)
  assert.equal(d.line, 3, 'the "Stop" key occurs once, so its line is determinable')
})

test('an unknown hook event is an error; a case typo proposes the exact rename', () => {
  const f = tmp('h2/settings.json', JSON.stringify({ hooks: { pretooluse: [], Frobnicate: [] } }, null, 2))
  const r = lintSettings(f)
  const dd = r.diagnostics.filter(d => d.id === 'hook/unknown-event')
  assert.equal(dd.length, 2)
  const cased = dd.find(d => /wrong case/.test(d.message))
  assert.match(cased.message, /PreToolUse/)
  assert.equal(cased.fix.kind, 'patch')
  assert.equal(cased.fix.applied, false)
  assert.equal(cased.fix.after, '"PreToolUse"')
})

test('an invalid matcher regex is an error that names the silent exact-match fallback', () => {
  const f = tmp('h3/settings.json', JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash(', hooks: [{ type: 'command', command: 'echo hi', timeout: 5 }] }] } }, null, 2))
  const r = lintSettings(f)
  const d = one(r, 'hook/bad-matcher-regex')
  assert.ok(d)
  assert.match(d.message, /falls back to exact string comparison/)
  assert.equal(d.fix.after, 'Bash\\(')
})

test('a hook group with no hooks array, and an entry with no command, are both errors', () => {
  const f = tmp('h4/settings.json', JSON.stringify({
    hooks: { PostToolUse: [{ matcher: 'Edit' }, { matcher: 'Write', hooks: [{ type: 'command', timeout: 5 }] }] },
  }, null, 2))
  const r = lintSettings(f)
  assert.ok(has(r, 'hook/group-missing-hooks'))
  assert.ok(has(r, 'hook/entry-missing-command'))
})

test('a hook pointing at a script that does not exist is an error mentioning the block risk', () => {
  const missing = path.join(os.tmpdir(), 'no-such-hook-script-xyz.sh')
  const f = tmp('h5/settings.json', JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `${missing} --check`, timeout: 5 }] }] } }, null, 2))
  const r = lintSettings(f)
  const d = one(r, 'hook/command-script-missing')
  assert.ok(d)
  assert.match(d.message, /treated as a BLOCK/)
  assert.equal(d.evidence.resolved, missing)
})

test('a matcher on an event with no tool is INFO, not an error', () => {
  const f = tmp('h6/settings.json', JSON.stringify({ hooks: { Stop: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'true', timeout: 1 }] }] } }, null, 2))
  const r = lintSettings(f)
  const d = one(r, 'hook/matcher-ignored')
  assert.equal(d.severity, SEVERITY.INFO)
})

test('a missing timeout is INFO with a proposed patch', () => {
  const f = tmp('h7/settings.json', JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'true' }] }] } }, null, 2))
  const r = lintSettings(f)
  const d = one(r, 'hook/no-timeout')
  assert.equal(d.severity, SEVERITY.INFO)
  assert.equal(d.fix.applied, false)
})

test('a hook in both hooks and _disabledHooks is flagged — the toggle would duplicate it', () => {
  const g = { matcher: 'Bash', hooks: [{ type: 'command', command: 'true', timeout: 1 }] }
  const f = tmp('h8/settings.json', JSON.stringify({ hooks: { PreToolUse: [g] }, _disabledHooks: { PreToolUse: [g] } }, null, 2))
  const r = lintSettings(f)
  const d = one(r, 'settings/disabled-shadow')
  assert.ok(d)
  assert.match(d.message, /runs twice/)
})

// --- permissions ----------------------------------------------------------------------------------
test('allow/deny conflict, non-string rule and malformed rule are all caught', () => {
  const f = tmp('p1/settings.json', JSON.stringify({
    permissions: { allow: ['Bash(npm test)', 'Bash(npm test)', 42, 'rm -rf /'], deny: ['Bash(npm test)'] },
  }, null, 2))
  const r = lintSettings(f)
  assert.ok(has(r, 'perm/allow-deny-conflict'))
  assert.ok(has(r, 'perm/non-string'))
  assert.ok(has(r, 'perm/malformed-rule'))
  assert.ok(has(r, 'perm/duplicate'))
  assert.match(one(r, 'perm/allow-deny-conflict').message, /Deny wins, silently/)
})

// --- MCP --------------------------------------------------------------------------------------------
test('MCP transport rules', () => {
  const d = lintMcpObject({
    mcpServers: {
      nostart: { args: ['-y', 'x'] },
      badargs: { command: 'npx', args: '-y x' },
      remote: { type: 'http' },
      leaky: { command: 'npx', args: [], env: { API_TOKEN: 'sk-abcdefghijklmnopqrstuvwxyz012345' } },
      shadowed: { command: 'x' },
    },
    _disabledMcpServers: { shadowed: { command: 'old' } },
  }, { file: '/fake/.mcp.json', src: null })
  const got = d.map(x => x.id)
  assert.ok(got.includes('mcp/stdio-missing-command'))
  assert.ok(got.includes('mcp/args-not-array'))
  assert.ok(got.includes('mcp/remote-missing-url'))
  assert.ok(got.includes('mcp/secret-inline'))
  assert.ok(got.includes('mcp/disabled-shadow'))
  assert.match(d.find(x => x.id === 'mcp/args-not-array').message, /NOT split into arguments/)
})

test('an MCP server declared in two scopes is a collision naming both files', () => {
  const d = lintMcpScopeCollisions([
    { scope: 'global', file: '~/.claude.json', servers: { github: {} } },
    { scope: 'project', file: '/p/.mcp.json', servers: { github: {} } },
  ])
  assert.equal(d.length, 1)
  assert.equal(d[0].id, 'mcp/name-collision')
  assert.equal(d[0].line, null)
  assert.match(d[0].lineReason, /relationship between two files/)
})

// --- SKILL.md ------------------------------------------------------------------------------------------
test('a BOM kills the frontmatter and is reported as such', () => {
  const f = tmp('skills/bommed/SKILL.md', '﻿---\nname: bommed\ndescription: x\n---\nbody\n')
  const r = lintSkill(f)
  assert.equal(r.parsed, false)
  assert.equal(r.diagnostics[0].id, 'skill/bom')
  assert.match(r.diagnostics[0].message, /server\/index\.mjs:149/)
})

test('frontmatter not on line 1 is reported with the anchored-regex explanation', () => {
  const f = tmp('skills/blank/SKILL.md', '\n---\nname: blank\ndescription: x\n---\nbody\n')
  const r = lintSkill(f)
  assert.equal(r.diagnostics[0].id, 'skill/no-frontmatter')
  assert.match(r.diagnostics[0].message, /anchored/)
})

test('a name that disagrees with the directory is an error with both names in the fix', () => {
  const f = tmp('skills/real-dir/SKILL.md', '---\nname: other-name\ndescription: does a thing\n---\n\nbody\n')
  const r = lintSkill(f)
  const d = one(r, 'skill/name-mismatch')
  assert.ok(d)
  assert.equal(d.line, 2, 'the name: key line is locatable inside the frontmatter')
  assert.deepEqual(d.evidence, { declared: 'other-name', directory: 'real-dir' })
  assert.equal(d.fix.after, 'name: real-dir')
})

test('a missing description is an error naming the field as the trigger', () => {
  const f = tmp('skills/nodesc/SKILL.md', '---\nname: nodesc\n---\n\nbody\n')
  const r = lintSkill(f)
  const d = one(r, 'skill/missing-description')
  assert.match(d.message, /That field IS the trigger/)
  assert.equal(d.line, null)
  assert.match(d.lineReason, /the key is absent/)
})

test('an empty body is a warning; a valid skill is clean', () => {
  assert.ok(has(lintSkill(tmp('skills/nobody/SKILL.md', '---\nname: nobody\ndescription: x\n---\n')), 'skill/empty-body'))
  const good = lintSkill(tmp('skills/good/SKILL.md', '---\nname: good\ndescription: Use when the user asks for a thing.\n---\n\n# Good\n\nSteps.\n'))
  assert.equal(good.parsed, true)
  assert.deepEqual(good.diagnostics, [])
})

test('a skills directory with no SKILL.md is reported', () => {
  TMP ||= fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-lint-'))
  fs.mkdirSync(path.join(TMP, 'skills', 'orphan'), { recursive: true })
  const r = lintSkillsDir(path.join(TMP, 'skills'))
  assert.ok(has(r, 'skill/missing-file'))
})

// --- CLAUDE.md ------------------------------------------------------------------------------------------
test('frontmatter in CLAUDE.md is a warning because CLAUDE.md is read raw', () => {
  const f = tmp('cm/CLAUDE.md', '---\ntitle: rules\n---\n\n# Rules\n\n- one\n')
  const r = lintClaudeMd(f)
  assert.ok(has(r, 'claude-md/frontmatter-not-supported'))
  assert.equal(one(r, 'claude-md/frontmatter-not-supported').line, 1)
  assert.match(one(r, 'claude-md/frontmatter-not-supported').message, /read raw/)
})

test('a missing @import target is an error with the resolved path', () => {
  const f = tmp('cm2/CLAUDE.md', '# Rules\n\n@./does-not-exist.md\n')
  const r = lintClaudeMd(f)
  const d = one(r, 'claude-md/missing-import')
  assert.equal(d.line, 3)
  assert.match(d.message, /dropped silently/)
})

test('an oversized CLAUDE.md reports the bound it exceeded', () => {
  const f = tmp('cm3/CLAUDE.md', '# R\n\n' + 'x'.repeat(CLAUDE_MD_SOFT_CAP_TOKENS * 4 + 100))
  const r = lintClaudeMd(f)
  const d = one(r, 'claude-md/oversized')
  assert.equal(d.evidence.cap, CLAUDE_MD_SOFT_CAP_TOKENS)
  assert.ok(d.evidence.tokens > CLAUDE_MD_SOFT_CAP_TOKENS)
})

test('CLAUDE.md and .claude/CLAUDE.md in one project is a duplicate-layer warning', () => {
  TMP ||= fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-lint-'))
  const p = path.join(TMP, 'proj')
  tmp('proj/CLAUDE.md', '# a\n')
  tmp('proj/.claude/CLAUDE.md', '# b\n')
  const r = lintClaudeMdLayers(p)
  assert.ok(has(r, 'claude-md/duplicate-location'))
  assert.match(one(r, 'claude-md/duplicate-location').message, /1535-1537/)
})

// --- cross-cutting guarantees ----------------------------------------------------------------------------
test('every diagnostic has a stable id, a severity, a Fix: and either a line or a lineReason', () => {
  const f = tmp('mix/settings.json', JSON.stringify({
    hooks: { Frobnicate: [], PostToolUse: [{ matcher: '(', hooks: [{ type: 'command' }] }] },
    permissions: { allow: [1], deny: [] },
  }, null, 2))
  const r = lintSettings(f)
  assert.ok(r.diagnostics.length >= 4)
  for (const d of r.diagnostics) {
    assert.match(d.id, /^[a-z-]+\/[a-z-]+$/, `bad id ${d.id}`)
    assert.ok([SEVERITY.ERROR, SEVERITY.WARN, SEVERITY.INFO].includes(d.severity))
    assert.match(d.message, /Fix:|Fix the|repair/i, `${d.id} does not name a fix`)
    if (d.line == null) assert.ok(d.lineReason && d.lineReason.length, `${d.id} has a null line with no reason`)
    else assert.ok(Number.isInteger(d.line) && d.line > 0)
  }
})

test('a line is null-with-a-reason when the key is ambiguous rather than guessed', () => {
  // "allow" appears in two objects, so the locator must refuse to pick one
  const f = tmp('amb/settings.json', JSON.stringify({ permissions: { allow: [1], deny: [] }, other: { allow: [] } }, null, 2))
  const r = lintSettings(f)
  const d = one(r, 'perm/non-string')
  assert.equal(d.line, null)
  assert.match(d.lineReason, /ambiguous, not guessing/)
})

test('fixes are proposals — proposedFixes never applies anything', () => {
  const f = tmp('fx/settings.json', JSON.stringify({ hooks: { stop: [] } }, null, 2))
  const before = fs.readFileSync(f, 'utf8')
  const p = proposedFixes(lintSettings(f))
  assert.equal(p.applied, false)
  assert.ok(p.count >= 1)
  for (const fx of p.fixes) assert.equal(fx.applied, false)
  assert.equal(fs.readFileSync(f, 'utf8'), before, 'linting must not modify the file')
})

test('parseFrontmatter matches server/index.mjs parseFM behaviour exactly', () => {
  assert.equal(parseFrontmatter('no fm').present, false)
  assert.equal(parseFrontmatter('\n---\na: 1\n---\n').present, false, 'anchored: not on line 1 → absent')
  const ok = parseFrontmatter('---\na: 1\n---\nbody\n')
  assert.equal(ok.present, true); assert.deepEqual(ok.fm, { a: 1 }); assert.equal(ok.body, 'body\n')
  assert.ok(parseFrontmatter('---\na: [unclosed\n---\nx\n').error)
})

// --- REAL FILES -------------------------------------------------------------------------------------------
// These lint whatever is actually on this machine. They assert structural honesty (shape, no
// throwing, coverage accounting) rather than a diagnostic count, because the count depends on the
// machine — but they DO print what was found so a regression in rule quality is visible.
test('lints the REAL ~/.claude tree and this repo without throwing', () => {
  const HOME = os.homedir()
  const targets = {
    claudeMd: [path.join(HOME, '.claude', 'CLAUDE.md'), path.join(REPO, 'CLAUDE.md'), path.join(REPO, '.claude', 'CLAUDE.md')],
    projectDirs: [REPO],
    skillsDirs: [path.join(HOME, '.claude', 'skills'), path.join(REPO, '.claude', 'skills')],
    settings: [path.join(HOME, '.claude', 'settings.json'), path.join(REPO, '.claude', 'settings.json'), path.join(REPO, '.claude', 'settings.local.json')],
    mcp: [path.join(HOME, '.claude.json'), path.join(REPO, '.mcp.json')],
  }
  const all = lintAll(targets)
  assert.equal(all.ok, true)
  assert.equal(typeof all.counts.total, 'number')
  assert.equal(all.counts.total, all.diagnostics.length)
  for (const d of all.diagnostics) {
    assert.ok(d.id && d.severity && d.message)
    if (d.line == null) assert.ok(d.lineReason)
  }
  // coverage must account for every target — a "0 problems" render over missing files is the bug
  assert.equal(
    all.coverage.targetsParsed + all.coverage.targetsMissing + all.coverage.targetsUnparseable + all.coverage.targetsRelational,
    all.coverage.targetsRequested,
    'every target must land in exactly one coverage bucket, or "0 problems" can hide an unread file',
  )
  if (process.env.LINT_VERBOSE) console.log(JSON.stringify(all.diagnostics.map(d => [d.severity, d.id, d.file, d.line]), null, 1))
})

test('every real SKILL.md under ~/.claude/skills parses or produces a diagnostic', () => {
  const dir = path.join(os.homedir(), '.claude', 'skills')
  const r = lintSkillsDir(dir)
  if (!r.exists) return // nothing installed on this machine
  for (const res of r.results) {
    // the anti-"clean" invariant: unparseable ⇒ at least one diagnostic
    if (!res.parsed) assert.ok(res.diagnostics.length > 0, `${res.file} unparseable but reported clean`)
  }
  // the directory sweep must report its own inner counts, so a caller cannot render "1 target, 0
  // problems" over a dozen unchecked skills
  assert.equal(r.skillsFound, r.results.length)
  assert.equal(r.skillsParsed + r.skillsUnparseable, r.skillsFound)
})

test("this repo's own .claude/settings.local.json lints cleanly or explains itself", () => {
  const f = path.join(REPO, '.claude', 'settings.local.json')
  if (!fs.existsSync(f)) return
  const r = lintSettings(f)
  assert.equal(r.exists, true)
  // it must PARSE — if it does not, the Hooks panel is 500ing right now
  assert.equal(r.parsed, true, 'the repo checks in a settings.local.json that does not parse')
  for (const d of r.diagnostics) assert.ok(d.message.length > 20)
})
