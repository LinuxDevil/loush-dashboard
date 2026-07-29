import test from 'node:test'
import assert from 'node:assert/strict'
import {
  detectFramework,
  lintFrontmatter,
  declaredDependencies,
  checkDependencies,
  analyzeCapability,
  expectedNameFromPath,
  namespacedName,
  normalizeDependencyName,
  parseFrontmatter,
  HEAD_SCAN_LINES,
  MAX_SCAN_BYTES,
} from '../../lib/capability-provenance.mjs'

// ---------------------------------------------------------------------------
// fixtures — the two malformed shapes found in the wild are spelled out in full, because the
// exact bytes are the point: both files look fine to a human and are inert to Claude Code.
// ---------------------------------------------------------------------------

/** Healthy SuperClaude-shaped command, for contrast. */
const GOOD_COMMAND = `---
name: implement
description: Implement a feature end to end
mcp-servers: [serena, morphllm]
personas: [architect, security-engineer]
---

Do the work.
`

/** REAL SHAPE 1 — the opening \`---\` was never typed. The keys are prompt text. */
const MISSING_OPEN_DELIMITER = `name: troubleshoot
description: Diagnose a failing build
category: utility
---

Walk the failure back to its cause.
`

/** REAL SHAPE 2 — the frontmatter is inside a fenced block, i.e. it is documentation. */
const FM_INSIDE_CODE_FENCE = '```yaml\n' + `---
name: brainstorm
description: Turn a vague idea into requirements
---
` + '```\n\nAsk questions until the requirement is concrete.\n'

// ---------------------------------------------------------------------------
// 115 — framework attribution
// ---------------------------------------------------------------------------

test('a command installed under commands/sc/ is attributed to SuperClaude with high confidence', () => {
  const got = detectFramework('/home/u/.claude/commands/sc/implement.md', { description: 'x' }, 'body', { kind: 'commands' })
  assert.equal(got.framework, 'superclaude')
  assert.equal(got.confidence, 'high')
  assert.equal(got.basis[0].code, 'path:commands/sc')
})

test('an agent carrying the Context Framework Note banner is attributed from its body alone', () => {
  // The banner is stamped into every SuperClaude agent; agents install flat into ~/.claude/agents,
  // so the path carries no signal and the body is the only attributing evidence there is.
  const body = 'You are an architect.\n\n> **Context Framework Note**: this agent is part of SuperClaude.\n'
  const got = detectFramework('/home/u/.claude/agents/system-architect.md', {}, body, { kind: 'agents' })
  assert.equal(got.framework, 'superclaude')
  assert.equal(got.confidence, 'high')
  assert.ok(got.basis.some(b => b.code === 'body:context-framework-note'))
})

test("a hand-written command outside any framework directory is attributed to nobody", () => {
  // The regression this guards: an "attribute to the closest match" detector labels a user's own
  // command as vendor-installed, and the ledger then bills their work to SuperClaude's ROI row.
  assert.equal(detectFramework('/home/u/.claude/commands/deploy.md', { description: 'ship it' }, 'Deploy.', { kind: 'commands' }), null)
})

test('a skill whose name merely collides with a framework skill is not attributed on that alone', () => {
  // `pm` and `brainstorm` are names a human picks unprompted. A single weak signal is not an
  // attribution — this is the case where guessing would be actively harmful.
  const got = detectFramework('/home/u/.claude/skills/brainstorm/SKILL.md', { name: 'brainstorm', description: 'ideas' }, 'Ask questions.', { kind: 'skills' })
  assert.equal(got, null)
})

test('a colliding skill name plus an installed-framework signal yields a low-confidence attribution', () => {
  const got = detectFramework(
    '/home/u/.claude/skills/brainstorm/SKILL.md',
    { name: 'brainstorm', description: 'ideas' },
    'Ask questions.',
    { kind: 'skills', settings: { enabledPlugins: { 'superclaude@superclaude': true } } },
  )
  assert.equal(got.framework, 'superclaude')
  assert.equal(got.confidence, 'low')
  assert.ok(got.basis.some(b => b.strength === 'corroborating'), 'the corroborating evidence is named, not hidden')
})

test('an installed framework on its own never attributes a file to that framework', () => {
  // Corroborating evidence says the framework exists on the machine, which is not a reason to
  // believe any particular file came from it.
  const got = detectFramework('/home/u/.claude/commands/deploy.md', {}, 'Deploy.', {
    kind: 'commands',
    settings: { enabledPlugins: { 'superclaude@superclaude': true } },
    presentPaths: ['/home/u/.superclaude/airis-mcp-gateway'],
  })
  assert.equal(got, null)
})

test('two independent weak signals reach medium confidence without any strong one', () => {
  const got = detectFramework(
    '/home/u/.claude/skills/troubleshoot/SKILL.md',
    { name: 'troubleshoot', description: 'd', category: 'utility' },
    'body',
    { kind: 'commands' }, // frontmatter-shape rule applies to flat kinds
  )
  assert.equal(got.confidence, 'medium')
  assert.equal(got.basis.length, 2)
})

test('a disabled plugin entry is not corroborating evidence', () => {
  const got = detectFramework('/home/u/.claude/skills/pm/SKILL.md', {}, '', {
    kind: 'skills',
    settings: { enabledPlugins: { 'superclaude@superclaude': false } },
  })
  assert.equal(got, null)
})

test('a file inside a marketplace plugin directory is attributed to that plugin by name', () => {
  // Path-derived rather than table-driven, so a plugin this module has never heard of still
  // attributes correctly instead of falling through to "unknown".
  const got = detectFramework('/home/u/.claude/plugins/acme-tools@acme-market/commands/lint.md', {}, '', { kind: 'commands' })
  assert.equal(got.framework, 'plugin:acme-tools@acme-market')
  assert.equal(got.name, 'acme-tools')
  assert.equal(got.confidence, 'high')
})

test('an installer provenance sidecar outranks every heuristic', () => {
  const got = detectFramework('/home/u/.claude/skills/pm/SKILL.md', {}, '', {
    kind: 'skills',
    provenance: { source: 'github.com/acme/skills' },
  })
  assert.equal(got.name, 'github.com/acme/skills')
  assert.equal(got.confidence, 'high')
})

test('windows-style paths attribute identically to posix ones', () => {
  const got = detectFramework('C:\\Users\\u\\.claude\\commands\\sc\\analyze.md', {}, '', { kind: 'commands' })
  assert.equal(got?.framework, 'superclaude')
})

test('detection never throws on junk input', () => {
  // Attribution must not be able to take down a ledger row.
  for (const args of [[null, null, null], [undefined, undefined, undefined], [42, [], {}], ['', { a: 1 }, '']])
    assert.doesNotThrow(() => detectFramework(...args))
  assert.equal(detectFramework(null, null, null), null)
})

// ---------------------------------------------------------------------------
// 116 — frontmatter linting
// ---------------------------------------------------------------------------

test('a well-formed capability file produces no findings', () => {
  const r = lintFrontmatter(GOOD_COMMAND, { file: '/home/u/.claude/commands/sc/implement.md', kind: 'commands' })
  assert.equal(r.ok, true)
  assert.deepEqual(r.findings, [])
  assert.equal(r.fm.description, 'Implement a feature end to end')
})

test('a file missing its opening --- is reported as an error, not as "no frontmatter"', () => {
  // The real failure: the author typed the closing `---` only. Claude Code finds no block, loads
  // the file as prompt text, and the `description` never reaches the selector — so the capability
  // is invisibly inert. Reporting this as a benign "no frontmatter" would bury it.
  const r = lintFrontmatter(MISSING_OPEN_DELIMITER, { file: '/home/u/.claude/commands/troubleshoot.md', kind: 'commands' })
  assert.equal(r.ok, false)
  const f = r.findings.find(x => x.code === 'FM_MISSING_OPEN_DELIMITER')
  assert.ok(f, `expected FM_MISSING_OPEN_DELIMITER, got ${r.findings.map(x => x.code)}`)
  assert.equal(f.severity, 'error')
  assert.match(f.fix, /top of the file/)
  assert.equal(r.fm, null)
})

test('frontmatter trapped inside a code fence is reported with the fence line number', () => {
  // The other real failure: a `\`\`\`yaml` fence above the block. Every key is documentation.
  const r = lintFrontmatter(FM_INSIDE_CODE_FENCE, { file: '/home/u/.claude/skills/brainstorm/SKILL.md', kind: 'skills' })
  assert.equal(r.ok, false)
  const f = r.findings.find(x => x.code === 'FM_IN_CODE_FENCE')
  assert.ok(f, `expected FM_IN_CODE_FENCE, got ${r.findings.map(x => x.code)}`)
  assert.equal(f.severity, 'error')
  assert.equal(f.line, 1)
})

test('an unterminated frontmatter block is an error rather than silently passing', () => {
  const r = lintFrontmatter('---\nname: x\ndescription: y\n\nBody text.\n', { file: '/a/x.md', kind: 'commands' })
  assert.equal(r.findings[0].code, 'FM_UNCLOSED')
  assert.equal(r.ok, false)
})

test('blank lines above the opening --- break the block and are reported as such', () => {
  const r = lintFrontmatter('\n\n---\nname: x\n---\n\nBody.\n', { file: '/a/x.md', kind: 'commands' })
  assert.equal(r.findings[0].code, 'FM_DELIMITER_NOT_FIRST_LINE')
  assert.equal(r.findings[0].line, 3)
})

test('the block delimiter is accepted exactly where server/index.mjs accepts it', () => {
  // The regression this guards: a lint stricter or looser than parseFM either invents failures
  // or passes files the reader is told are fine. `--- ` with a trailing space is accepted by
  // parseFM's `\\r?\\n?` tail, so it must be accepted here too — parity is the contract, and any
  // divergence belongs in parseFM first.
  const raw = '---\nname: x\ndescription: d\n--- \n\nBody.\n'
  assert.equal(parseFrontmatter(raw).delimited, true)
  assert.equal(lintFrontmatter(raw, { file: '/a/x.md', kind: 'commands' }).ok, true)
})

test('a leading byte-order mark is reported, since it defeats the line-1 match invisibly', () => {
  const r = lintFrontmatter('\ufeff---\nname: x\ndescription: d\n---\n\nBody.\n', { file: '/a/x.md', kind: 'commands' })
  assert.ok(r.findings.some(f => f.code === 'FM_BOM_BEFORE_DELIMITER' && f.severity === 'error'))
})

test('invalid YAML inside a well-delimited block is an error and yields no frontmatter', () => {
  const r = lintFrontmatter('---\ndescription: unquoted: colon: chaos\n\tname:\tx\n---\n\nBody.\n', { file: '/a/x.md', kind: 'commands' })
  const f = r.findings.find(x => x.code === 'FM_PARSE_ERROR')
  assert.ok(f)
  assert.equal(r.fm, null)
  assert.match(f.fix, /tab/i, 'the tab is named, because that is the actual repair')
})

test('frontmatter that parses to something other than a mapping is an error', () => {
  const r = lintFrontmatter('---\n- one\n- two\n---\n\nBody.\n', { file: '/a/x.md', kind: 'commands' })
  assert.equal(r.findings[0].code, 'FM_NOT_MAPPING')
  assert.equal(r.ok, false)
})

test('a file with no frontmatter at all is a warning, not an error', () => {
  // It still runs — it just has nothing to be selected on. Ranking it alongside the inert files
  // would drown the two failures that actually silently break a capability.
  const r = lintFrontmatter('# Notes\n\nJust prose.\n', { file: '/a/x.md', kind: 'commands' })
  assert.equal(r.findings[0].code, 'FM_ABSENT')
  assert.equal(r.findings[0].severity, 'warn')
  assert.equal(r.ok, true)
})

test("a skill's name: disagreeing with its directory is reported against the directory", () => {
  const r = lintFrontmatter('---\nname: totally-different\ndescription: d\n---\n', { file: '/home/u/.claude/skills/confidence-check/SKILL.md', kind: 'skills' })
  const f = r.findings.find(x => x.code === 'FM_NAME_MISMATCH')
  assert.equal(f.severity, 'warn')
  assert.equal(f.expected, 'confidence-check')
  assert.equal(f.declared, 'totally-different')
})

test('a prose-cased name that slugs to the directory name is info, not a mismatch', () => {
  // The real file: SuperClaude's confidence-check skill declares `name: Confidence Check`. It is
  // not the same class of problem as a genuinely different name, and grading it the same way
  // would train the reader to ignore the column.
  const r = lintFrontmatter('---\nname: Confidence Check\ndescription: d\n---\n', { file: '/home/u/.claude/skills/confidence-check/SKILL.md', kind: 'skills' })
  const f = r.findings.find(x => x.code === 'FM_NAME_NOT_SLUG')
  assert.equal(f.severity, 'info')
  assert.equal(r.ok, true)
})

test('a namespaced command compares against its leaf filename, not its colon address', () => {
  const r = lintFrontmatter('---\nname: implement\ndescription: d\n---\n', { file: '/home/u/.claude/commands/sc/implement.md', kind: 'commands' })
  assert.deepEqual(r.findings, [])
})

test('a disabled .off file is linted against the name it would have when re-enabled', () => {
  const r = lintFrontmatter('---\nname: implement\ndescription: d\n---\n', { file: '/home/u/.claude/commands/sc/implement.md.off', kind: 'commands' })
  assert.deepEqual(r.findings, [])
})

test('an empty frontmatter block warns rather than passing as valid', () => {
  const r = lintFrontmatter('---\n\n---\n\nBody.\n', { file: '/a/x.md', kind: 'commands' })
  assert.equal(r.findings[0].code, 'FM_EMPTY')
  assert.equal(r.findings[0].severity, 'warn')
})

test('two consecutive --- lines are reported as no block at all, matching the loader', () => {
  // parseFM (server/index.mjs) needs a line between the delimiters, so `---`/`---` matches
  // nothing. Calling that an "empty frontmatter block" would imply the loader saw a block.
  const r = lintFrontmatter('---\n---\n\nBody.\n', { file: '/a/x.md', kind: 'commands' })
  assert.equal(r.findings[0].code, 'FM_EMPTY_BLOCK')
  assert.equal(r.findings[0].severity, 'error')
})

test('non-string content is a finding, never a thrown error', () => {
  // The regression this guards: a lint pass over a directory dies on one unreadable file and the
  // whole ledger comes back empty.
  for (const bad of [null, undefined, 42, {}, [], Buffer.from('---')]) {
    const r = lintFrontmatter(bad, { file: '/a/x.md', kind: 'commands' })
    assert.equal(r.ok, false)
    assert.equal(r.findings[0].code, 'FM_UNREADABLE')
  }
})

test('linting reports its own scan bounds instead of applying them silently', () => {
  const r = lintFrontmatter(GOOD_COMMAND, { file: '/a/x.md', kind: 'commands' })
  assert.equal(r.limits.headScanLines, HEAD_SCAN_LINES)
  assert.equal(r.limits.maxScanBytes, MAX_SCAN_BYTES)
  assert.equal(r.limits.truncated, false)

  const huge = GOOD_COMMAND + 'x'.repeat(MAX_SCAN_BYTES)
  const big = lintFrontmatter(huge, { file: '/a/x.md', kind: 'commands' })
  assert.equal(big.limits.truncated, true)
  assert.ok(big.findings.some(f => f.code === 'FM_SCAN_TRUNCATED'), 'the truncation is stated in a finding, not just a flag')
})

test('every finding carries a severity, a code, a message and a fix', () => {
  const samples = [MISSING_OPEN_DELIMITER, FM_INSIDE_CODE_FENCE, '---\n- a\n---\n', '# prose\n', '---\nname: x\n']
  for (const s of samples)
    for (const f of lintFrontmatter(s, { file: '/a/x.md', kind: 'commands' }).findings) {
      assert.ok(['error', 'warn', 'info'].includes(f.severity), `bad severity ${f.severity}`)
      assert.ok(f.code && f.message && f.fix, `incomplete finding ${JSON.stringify(f)}`)
    }
})

// ---------------------------------------------------------------------------
// 117 — declared dependencies
// ---------------------------------------------------------------------------

test('mcp-servers and personas are read off the frontmatter', () => {
  const { fm } = parseFrontmatter(GOOD_COMMAND)
  const d = declaredDependencies(fm)
  assert.deepEqual(d.mcpServers, ['serena', 'morphllm'])
  assert.deepEqual(d.agents, ['architect', 'security-engineer'])
  assert.equal(d.declared, true)
})

test('the alternate agents: spelling is read as agent dependencies', () => {
  const d = declaredDependencies({ agents: ['reviewer'], mcpServers: ['context7'] })
  assert.deepEqual(d.agents, ['reviewer'])
  assert.deepEqual(d.mcpServers, ['context7'])
  assert.equal(d.sources.agents[0].key, 'agents')
  assert.equal(d.sources.mcpServers[0].key, 'mcpServers')
})

test('declaring an empty list is distinguishable from declaring nothing', () => {
  // "This command needs no MCP server" and "this command never said" are different facts, and
  // MCP-level ROI arithmetic is wrong if they collapse into the same empty array.
  assert.equal(declaredDependencies({ 'mcp-servers': [] }).declared, true)
  assert.equal(declaredDependencies({ description: 'd' }).declared, false)
})

test('a comma-separated string is accepted as a list', () => {
  const d = declaredDependencies({ 'mcp-servers': 'serena, morphllm' })
  assert.deepEqual(d.mcpServers, ['serena', 'morphllm'])
})

test('object entries are read by name and duplicates collapse', () => {
  const d = declaredDependencies({ 'mcp-servers': [{ name: 'serena' }, 'Serena', { server: 'playwright' }] })
  assert.deepEqual(d.mcpServers, ['serena', 'playwright'])
})

test('a "none" placeholder is recorded as an ignored value, not treated as a server named none', () => {
  const d = declaredDependencies({ 'mcp-servers': ['none'] })
  assert.deepEqual(d.mcpServers, [])
  assert.equal(d.ignored[0].value, 'none')
  assert.match(d.ignored[0].reason, /no dependencies/)
})

test('entries with no readable name are surfaced as unparsed rather than dropped', () => {
  const d = declaredDependencies({ personas: [{ role: 'architect' }, null] })
  assert.deepEqual(d.agents, [])
  assert.equal(d.unparsed.length, 2)
})

test('reading dependencies off malformed frontmatter returns empty lists instead of throwing', () => {
  for (const bad of [null, undefined, 'text', 42, []]) assert.deepEqual(declaredDependencies(bad).mcpServers, [])
})

test('a declared server that is not installed is reported as missing', () => {
  const d = declaredDependencies({ 'mcp-servers': ['serena', 'morphllm'] })
  const c = checkDependencies(d, { mcpServers: ['morphllm'], agents: [] })
  assert.deepEqual(c.missing.mcpServers, ['serena'])
  assert.deepEqual(c.satisfied.mcpServers, ['morphllm'])
  assert.equal(c.ok, false)
})

test('installed names match regardless of case or mcp__ tool prefixing', () => {
  const c = checkDependencies({ mcpServers: ['serena'] }, { mcpServers: ['mcp__Serena__find_symbol'] })
  assert.deepEqual(c.missing.mcpServers, [])
  assert.equal(normalizeDependencyName('mcp__Serena__find_symbol'), 'serena')
})

test('an installed inventory of objects is accepted alongside plain names', () => {
  const c = checkDependencies({ agents: ['architect'] }, { agents: [{ name: 'architect' }] })
  assert.deepEqual(c.missing.agents, [])
})

test('with no installed inventory supplied, missing is null and ok is null — never "all satisfied"', () => {
  // The regression this guards: an omitted inventory renders as an empty missing-list, which the
  // UI shows as a green tick for a check that was never performed.
  const c = checkDependencies({ mcpServers: ['serena'], agents: ['architect'] }, {})
  assert.equal(c.missing.mcpServers, null)
  assert.equal(c.missing.agents, null)
  assert.deepEqual(c.unknown, ['mcpServers', 'agents'])
  assert.equal(c.ok, null)
})

test('one known side and one unknown side keeps ok null while still reporting the known side', () => {
  const c = checkDependencies({ mcpServers: ['serena'], agents: ['architect'] }, { mcpServers: [] })
  assert.deepEqual(c.missing.mcpServers, ['serena'])
  assert.equal(c.missing.agents, null)
  assert.equal(c.ok, null)
})

test('checking dependencies never throws on junk arguments', () => {
  for (const args of [[null, null], [undefined, undefined], ['x', 7], [{}, { mcpServers: 'not-a-list' }]])
    assert.doesNotThrow(() => checkDependencies(...args))
})

// ---------------------------------------------------------------------------
// path/name helpers shared by all three
// ---------------------------------------------------------------------------

test('names are derived per kind: skills from the directory, flat kinds from the filename', () => {
  assert.equal(expectedNameFromPath('/home/u/.claude/skills/pm/SKILL.md', 'skills'), 'pm')
  assert.equal(expectedNameFromPath('/home/u/.claude/commands/sc/implement.md', 'commands'), 'implement')
  assert.equal(expectedNameFromPath('/home/u/.claude/agents/system-architect.md.off', 'agents'), 'system-architect')
  assert.equal(expectedNameFromPath('/home/u/.claude/skills/pm.off/SKILL.md', 'skills'), 'pm')
})

test('a path that names nothing yields null rather than an invented name', () => {
  assert.equal(expectedNameFromPath('', 'commands'), null)
  assert.equal(expectedNameFromPath('/home/u/.claude/skills/pm/README.md', 'skills'), null)
})

test('a namespaced command resolves to its colon address relative to the scope directory', () => {
  // Matches how Claude Code addresses it and how the fire-matcher keys it: sc/implement.md → sc:implement.
  assert.equal(namespacedName('/home/u/.claude/commands/sc/implement.md', 'commands', '/home/u/.claude/commands'), 'sc:implement')
  assert.equal(namespacedName('/home/u/.claude/commands/deploy.md', 'commands', '/home/u/.claude/commands'), 'deploy')
})

test('without a scope directory only the leaf name is claimed, not a guessed namespace', () => {
  assert.equal(namespacedName('/home/u/.claude/commands/sc/implement.md', 'commands'), 'implement')
})

// ---------------------------------------------------------------------------
// one pass over one file
// ---------------------------------------------------------------------------

test('a single pass yields the framework, the lint findings and the dependency check together', () => {
  const row = analyzeCapability({
    file: '/home/u/.claude/commands/sc/implement.md',
    kind: 'commands',
    scopeDir: '/home/u/.claude/commands',
    content: GOOD_COMMAND,
    installed: { mcpServers: ['morphllm'], agents: ['architect'] },
  })
  assert.equal(row.name, 'sc:implement')
  assert.equal(row.enabled, true)
  assert.equal(row.framework.framework, 'superclaude')
  assert.equal(row.lint.ok, true)
  assert.deepEqual(row.dependencies.mcpServers, ['serena', 'morphllm'])
  assert.deepEqual(row.dependencyCheck.missing.mcpServers, ['serena'])
  assert.deepEqual(row.dependencyCheck.missing.agents, ['security-engineer'])
})

test('an inert file still produces a full row: lint failure, no frontmatter, no dependencies', () => {
  // The regression this guards: the file whose frontmatter Claude Code cannot see is exactly the
  // file a ledger must still show — dropping it hides the problem it exists to report.
  const row = analyzeCapability({
    file: '/home/u/.claude/commands/troubleshoot.md',
    kind: 'commands',
    scopeDir: '/home/u/.claude/commands',
    content: MISSING_OPEN_DELIMITER,
  })
  assert.equal(row.name, 'troubleshoot')
  assert.equal(row.lint.ok, false)
  assert.equal(row.lint.findings[0].code, 'FM_MISSING_OPEN_DELIMITER')
  assert.equal(row.dependencies.declared, false)
  assert.equal(row.dependencyCheck.ok, null)
})

test('a .off file is reported as disabled rather than omitted', () => {
  const row = analyzeCapability({ file: '/home/u/.claude/commands/sc/implement.md.off', kind: 'commands', content: GOOD_COMMAND })
  assert.equal(row.enabled, false)
})

test('analysing an empty input returns a row instead of throwing', () => {
  assert.doesNotThrow(() => analyzeCapability())
  const row = analyzeCapability({})
  assert.equal(row.framework, null)
  assert.equal(row.lint.ok, false)
})
