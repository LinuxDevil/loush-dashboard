import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseResultsJson,
  parseReviewComments,
  hardExclusionRules,
  applyFilters,
  fileExtension,
  findingKey,
  REVIEW_COMMENT_MARKER,
  PRE_SEEDED_REACTION_BASELINE,
} from '../../lib/security-findings.mjs'

const artifact = (over = {}) => ({
  pr_number: 123,
  repo: 'owner/repo',
  findings: [
    {
      file: 'src/db.py',
      line: 42,
      severity: 'HIGH',
      category: 'sql_injection',
      description: 'User input passed to SQL query without parameterization',
      exploit_scenario: 'Attacker could extract database contents via the search parameter',
      recommendation: 'Use parameterized queries',
      confidence: 0.95,
      _filter_metadata: { confidence_score: 8, justification: 'Clear SQL injection with a specific exploit path' },
    },
  ],
  analysis_summary: { files_reviewed: 8, high_severity: 1, medium_severity: 0, low_severity: 0, review_completed: true },
  filtering_summary: {
    total_original_findings: 7,
    excluded_findings: 5,
    kept_findings: 2,
    filter_analysis: {
      total_findings: 7,
      kept_findings: 2,
      excluded_findings: 5,
      hard_excluded: 3,
      claude_excluded: 2,
      exclusion_breakdown: { 'Generic DOS/resource exhaustion finding': 2 },
      average_confidence: 7.5,
      runtime_seconds: 41.2,
      directory_excluded_count: 0,
    },
    excluded_findings_details: [],
  },
  ...over,
})

const comment = (over = {}) => ({
  id: 900,
  path: 'src/api.js',
  line: 17,
  commit_id: 'abc123',
  html_url: 'https://github.com/owner/repo/pull/1#discussion_r900',
  user: { type: 'Bot', login: 'github-actions[bot]' },
  reactions: { '+1': 1, '-1': 4, total_count: 5 },
  body: [
    '🤖 **Security Issue: Reflected XSS in the search handler**',
    '',
    '**Severity:** HIGH',
    '**Category:** xss',
    '**Tool:** ClaudeCode AI Security Analysis',
    '',
    '**Exploit Scenario:** An attacker crafts a link containing script tags.',
    '',
    '**Recommendation:** Escape the parameter before writing it into the DOM.',
  ].join('\n'),
  ...over,
})


test('a well-formed artifact yields findings with both confidence scales kept separate', () => {
  const r = parseResultsJson(artifact())
  assert.equal(r.ok, true)
  assert.equal(r.error, null)
  assert.equal(r.prNumber, 123)
  assert.equal(r.repo, 'owner/repo')
  assert.equal(r.findings.length, 1)
  const f = r.findings[0]
  assert.equal(f.file, 'src/db.py')
  assert.equal(f.line, 42)
  assert.equal(f.severity, 'HIGH')
  assert.equal(f.category, 'sql_injection')
  assert.equal(f.exploitScenario, 'Attacker could extract database contents via the search parameter')
  assert.equal(f.recommendation, 'Use parameterized queries')
  assert.equal(f.confidence, 0.95)
  assert.equal(f.filterConfidenceScore, 8)
  assert.equal(f.source, 'results-json')
})

test('a JSON string and an already-parsed object parse identically', () => {
  const asObject = parseResultsJson(artifact())
  const asString = parseResultsJson(JSON.stringify(artifact()))
  assert.deepEqual(asString.findings.map(f => f.key), asObject.findings.map(f => f.key))
  assert.equal(asString.ok, true)
})

test('filter statistics carry through, and the model self-report stays namespaced', () => {
  const r = parseResultsJson(artifact())
  assert.equal(r.filterStats.hardExcluded, 3)
  assert.equal(r.filterStats.claudeExcluded, 2)
  assert.equal(r.filterStats.averageConfidence, 7.5)
  assert.equal(r.filterStats.runtimeSeconds, 41.2)
  assert.equal(r.filteringSummary.totalOriginalFindings, 7)
  assert.equal(r.analysisSummaryPreFilter.highSeverity, 1)
  assert.ok(!('highSeverity' in r.filterStats))
})

test('missing filter statistics are null rather than zero', () => {
  const doc = artifact()
  delete doc.filtering_summary.filter_analysis.average_confidence
  delete doc.filtering_summary.filter_analysis.hard_excluded
  const r = parseResultsJson(doc)
  assert.equal(r.filterStats.averageConfidence, null)
  assert.equal(r.filterStats.hardExcluded, null)
  assert.notEqual(r.filterStats.hardExcluded, 0)
})

test('an artifact with no filtering_summary reports null stats, not empty stats', () => {
  const doc = artifact()
  delete doc.filtering_summary
  const r = parseResultsJson(doc)
  assert.equal(r.filterStats, null)
  assert.equal(r.filteringSummary, null)
  assert.equal(r.findings.length, 1)
})

test('a finding with no severity is null, never defaulted to medium', () => {
  const doc = artifact()
  delete doc.findings[0].severity
  const r = parseResultsJson(doc)
  assert.equal(r.findings[0].severity, null)
  assert.equal(r.findings[0].severityRaw, null)
  assert.notEqual(r.findings[0].severity, 'MEDIUM')
})

test('severity casing drift is normalised without inventing a value', () => {
  const doc = artifact()
  doc.findings[0].severity = 'high'
  const r = parseResultsJson(doc)
  assert.equal(r.findings[0].severity, 'HIGH')
  assert.equal(r.findings[0].severityRaw, 'high')
})

test('fail-open is detected when a per-finding filter call errored', () => {
  const doc = artifact()
  doc.findings[0]._filter_metadata = { confidence_score: 10.0, justification: 'Claude API failed: connection reset by peer' }
  const r = parseResultsJson(doc)
  assert.equal(r.filterFailedOpen, true)
  assert.deepEqual(r.failOpen.kinds, ['api_error'])
  assert.equal(r.failOpen.affectedFindings, 1)
  assert.ok(r.failOpen.justifications[0].includes('Claude API failed'))
  assert.equal(r.findings[0].failOpen.kind, 'api_error')
})

test('fail-open is detected when LLM filtering was disabled for the whole run', () => {
  const doc = artifact()
  doc.findings[0]._filter_metadata = { confidence_score: 10.0, justification: 'Claude filtering disabled' }
  const r = parseResultsJson(doc)
  assert.equal(r.filterFailedOpen, true)
  assert.deepEqual(r.failOpen.kinds, ['filter_disabled'])
})

test('a confidence score of 10 alone does not assert fail-open', () => {
  const doc = artifact()
  doc.findings[0]._filter_metadata = { confidence_score: 10, justification: 'Unambiguous hardcoded credential' }
  const r = parseResultsJson(doc)
  assert.equal(r.filterFailedOpen, false)
  assert.equal(r.findings[0].failOpen, null)
})

test('a fail-open justification on an excluded record is detected too', () => {
  const doc = artifact()
  doc.filtering_summary.excluded_findings_details = [{
    finding: { file: 'a.py', line: 1, severity: 'LOW', description: 'x', _filter_metadata: { confidence_score: 10.0, justification: 'Claude API failed: timeout' } },
    confidence_score: 3,
    exclusion_reason: 'Low confidence score: 3',
    justification: 'weak',
    filter_stage: 'claude_api',
  }]
  const r = parseResultsJson(doc)
  assert.equal(r.filterFailedOpen, true)
  assert.equal(r.failOpen.affectedFindings, 1)
})

test('the three excluded-record shapes are all recognised by filter_stage', () => {
  const doc = artifact()
  doc.filtering_summary.excluded_findings_details = [
    { finding: { file: 'a.py', line: 1, severity: 'LOW', category: 'dos', description: 'unbounded loop' }, index: 3, exclusion_reason: 'Generic DOS/resource exhaustion finding (low signal)', filter_stage: 'hard_rules' },
    { finding: { file: 'b.py', line: 2, severity: 'MEDIUM', category: 'xss', description: 'maybe xss' }, confidence_score: 3, exclusion_reason: 'Low confidence score: 3', justification: 'speculative', filter_stage: 'claude_api' },
    { file: 'vendor/c.py', line: 9, severity: 'HIGH', category: 'rce', description: 'in an excluded directory' },
  ]
  const r = parseResultsJson(doc)
  assert.deepEqual(r.excluded.map(e => e.stage), ['hard_rules', 'claude_api', 'directory'])
  assert.equal(r.excluded[0].reason, 'Generic DOS/resource exhaustion finding (low signal)')
  assert.equal(r.excluded[1].confidenceScore, 3)
  assert.equal(r.excluded[2].finding.file, 'vendor/c.py')
  assert.equal(r.excluded[2].finding.severity, 'HIGH')
})

test('a truncated artifact returns an empty result plus a malformed entry instead of throwing', () => {
  const truncated = JSON.stringify(artifact()).slice(0, 120)
  const r = parseResultsJson(truncated)
  assert.equal(r.ok, false)
  assert.deepEqual(r.findings, [])
  assert.equal(r.malformed.length, 1)
  assert.equal(r.malformed[0].where, 'root')
  assert.ok(r.malformed[0].reason.startsWith('JSON parse failed'))
})

test('malformed findings inside an otherwise valid artifact are reported, not dropped in silence', () => {
  const doc = artifact()
  doc.findings.push('not a finding', null)
  const r = parseResultsJson(doc)
  assert.equal(r.findings.length, 1)
  assert.equal(r.malformed.length, 2)
  assert.deepEqual(r.malformed.map(m => m.where), ['findings[1]', 'findings[2]'])
})

test('the {"error": …} failure shape is surfaced, not read as a clean scan', () => {
  const r = parseResultsJson({ error: 'Claude Code invocation timed out' })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'Claude Code invocation timed out')
  assert.deepEqual(r.findings, [])
})

test('the empty extraction shell is flagged as an extraction failure', () => {
  const r = parseResultsJson({
    findings: [],
    analysis_summary: { files_reviewed: 0, high_severity: 0, medium_severity: 0, low_severity: 0, review_completed: false },
  })
  assert.equal(r.extractionFailed, true)
  assert.equal(r.analysisSummaryPreFilter.reviewCompleted, false)
})

test('non-object and non-JSON input never throws', () => {
  for (const input of ['', 'not json at all', null, undefined, 42, [], '<html>404</html>']) {
    const r = parseResultsJson(input)
    assert.equal(Array.isArray(r.findings), true)
    assert.ok(r.malformed.length >= 1, `expected a malformed entry for ${JSON.stringify(input)}`)
  }
})


test('a bot security comment is parsed into the same finding shape as the artifact', () => {
  const r = parseReviewComments([comment()])
  assert.equal(r.findings.length, 1)
  const f = r.findings[0]
  assert.equal(f.source, 'pr-comment')
  assert.equal(f.file, 'src/api.js')
  assert.equal(f.line, 17)
  assert.equal(f.severity, 'HIGH')
  assert.equal(f.category, 'xss')
  assert.equal(f.description, 'Reflected XSS in the search handler')
  assert.equal(f.exploitScenario, 'An attacker crafts a link containing script tags.')
  assert.equal(f.recommendation, 'Escape the parameter before writing it into the DOM.')
  assert.equal(f.tool, 'ClaudeCode AI Security Analysis')
  assert.equal(f.commentId, 900)
  assert.equal(f.commitId, 'abc123')
  assert.equal(f.authorIsBot, true)
})

test('non-bot comments are skipped without being called malformed', () => {
  const r = parseReviewComments([comment(), { id: 1, body: 'looks good to me' }, { id: 2, body: 'nit: rename this' }])
  assert.equal(r.findings.length, 1)
  assert.equal(r.skipped.length, 2)
  assert.equal(r.malformed.length, 0)
  assert.deepEqual(r.skipped.map(s => s.id), [1, 2])
})

test('reaction counts are reported raw and net of the bot pre-seed', () => {
  const r = parseReviewComments([comment()])
  const f = r.findings[0]
  assert.deepEqual(f.reactions, { up: 1, down: 4, total: 5 })
  assert.equal(f.reactionsAboveBaseline.up, 0)
  assert.equal(f.reactionsAboveBaseline.down, 3)
  assert.equal(f.reactionsAboveBaseline.baseline, PRE_SEEDED_REACTION_BASELINE)
})

test('a comment without a reactions block reports null reactions rather than zeroes', () => {
  const c = comment()
  delete c.reactions
  const r = parseReviewComments([c])
  assert.equal(r.findings[0].reactions, null)
  assert.equal(r.findings[0].reactionsAboveBaseline, null)
})

test('a comment missing the Severity line yields a null severity', () => {
  const c = comment({ body: `${REVIEW_COMMENT_MARKER} Hardcoded token**\n\n**Category:** secrets\n**Tool:** ClaudeCode AI Security Analysis` })
  const r = parseReviewComments([c])
  assert.equal(r.findings[0].severity, null)
  assert.equal(r.findings[0].category, 'secrets')
  assert.equal(r.findings[0].description, 'Hardcoded token')
})

test('optional Exploit Scenario and Recommendation sections stay null when omitted', () => {
  const c = comment({ body: `${REVIEW_COMMENT_MARKER} Path traversal**\n\n**Severity:** MEDIUM\n**Category:** path_traversal\n**Tool:** ClaudeCode AI Security Analysis` })
  const r = parseReviewComments([c])
  assert.equal(r.findings[0].exploitScenario, null)
  assert.equal(r.findings[0].recommendation, null)
})

test('a multi-line recommendation is captured whole', () => {
  const c = comment({ body: [
    `${REVIEW_COMMENT_MARKER} Weak crypto**`, '',
    '**Severity:** MEDIUM', '**Category:** weak_crypto', '**Tool:** ClaudeCode AI Security Analysis', '',
    '**Recommendation:** Replace MD5 with SHA-256.', 'Then rotate the stored digests.',
  ].join('\n') })
  const r = parseReviewComments([c])
  assert.equal(r.findings[0].recommendation, 'Replace MD5 with SHA-256.\nThen rotate the stored digests.')
})

test('malformed comment input never throws', () => {
  for (const input of [null, undefined, 'nope', { message: 'Not Found' }, [null, 7, { id: 1 }]]) {
    const r = parseReviewComments(input)
    assert.equal(Array.isArray(r.findings), true)
  }
  assert.equal(parseReviewComments([{ id: 1 }]).malformed.length, 1)
})


test('the rule set exposes seven regex families plus the Markdown rule, in upstream order', () => {
  const ids = hardExclusionRules().map(r => r.id)
  assert.deepEqual(ids, [
    'markdown_file', 'dos', 'rate_limiting', 'resource_management',
    'open_redirect', 'regex_injection', 'memory_safety', 'ssrf_in_html',
  ])
  assert.equal(ids.filter(id => id !== 'markdown_file').length, 7)
})

test('hardExclusionRules returns a fresh array so a caller can tune without mutating the module', () => {
  const a = hardExclusionRules()
  a.splice(0, 4)
  assert.equal(hardExclusionRules().length, 8)
  assert.notEqual(a, hardExclusionRules())
})

test('each exclusion records which rule fired and on what text', () => {
  const findings = [{ file: 'src/api.js', severity: 'MEDIUM', description: 'Unbounded loop allows resource exhaustion' }]
  const { kept, excluded } = applyFilters(findings)
  assert.equal(kept.length, 0)
  assert.equal(excluded.length, 1)
  assert.equal(excluded[0].ruleId, 'dos')
  assert.equal(excluded[0].reason, 'Generic DOS/resource exhaustion finding (low signal)')
  assert.equal(excluded[0].matchedOn, 'description')
  assert.ok(excluded[0].pattern)
  assert.ok(excluded[0].evidence)
  assert.equal(excluded[0].finding, findings[0])
})

test('each regex family excludes a representative finding', () => {
  const cases = [
    ['dos', 'src/a.js', 'Denial of service via large payloads'],
    ['rate_limiting', 'src/a.js', 'Missing rate limit on the login endpoint'],
    ['resource_management', 'src/a.js', 'Unclosed file handle in the export path'],
    ['open_redirect', 'src/a.js', 'Open redirect in the return_to parameter'],
    ['regex_injection', 'src/a.js', 'Regex injection through the user-supplied filter'],
    ['memory_safety', 'src/a.js', 'Buffer overflow when copying the header'],
    ['ssrf_in_html', 'page.html', 'SSRF through the embedded fetch target'],
    ['markdown_file', 'docs/guide.md', 'Hardcoded API key in the example'],
  ]
  for (const [expected, file, description] of cases) {
    const { excluded } = applyFilters([{ file, severity: 'HIGH', description }])
    assert.equal(excluded.length, 1, `expected ${description} to be excluded`)
    assert.equal(excluded[0].ruleId, expected, `${description} -> ${excluded[0].ruleId}`)
  }
})

test('memory-safety findings survive in C/C++ files but not elsewhere', () => {
  const desc = 'Heap overflow when parsing the length prefix'
  assert.equal(applyFilters([{ file: 'src/parser.c', severity: 'HIGH', description: desc }]).kept.length, 1)
  assert.equal(applyFilters([{ file: 'src/parser.cpp', severity: 'HIGH', description: desc }]).kept.length, 1)
  assert.equal(applyFilters([{ file: 'src/parser.h', severity: 'HIGH', description: desc }]).kept.length, 1)
  assert.equal(applyFilters([{ file: 'src/parser.js', severity: 'HIGH', description: desc }]).excluded.length, 1)
  assert.equal(applyFilters([{ file: 'Makefile', severity: 'HIGH', description: desc }]).excluded.length, 1)
})

test('SSRF is only excluded inside .html files', () => {
  const desc = 'SSRF through an attacker-controlled URL'
  assert.equal(applyFilters([{ file: 'page.html', severity: 'HIGH', description: desc }]).excluded.length, 1)
  assert.equal(applyFilters([{ file: 'server/fetch.py', severity: 'HIGH', description: desc }]).kept.length, 1)
})

test('rules match description only, never category', () => {
  const { kept } = applyFilters([{ file: 'src/a.js', severity: 'HIGH', category: 'denial_of_service', description: 'Attacker can read arbitrary rows from the users table' }])
  assert.equal(kept.length, 1)
})

test('disabling a rule keeps its findings and reports the rule as skipped', () => {
  const findings = [{ file: 'docs/x.md', severity: 'HIGH', description: 'Hardcoded API key in the example' }]
  const r = applyFilters(findings, { disabledRuleIds: ['markdown_file'] })
  assert.equal(r.kept.length, 1)
  assert.equal(r.excluded.length, 0)
  assert.deepEqual(r.rulesSkipped, ['markdown_file'])
  assert.ok(!r.rulesApplied.includes('markdown_file'))
})

test('first match wins, so a finding matching two families is attributed to the earlier one', () => {
  const { excluded } = applyFilters([{ file: 'src/a.js', severity: 'HIGH', description: 'Infinite loop causes resource exhaustion and an unclosed connection' }])
  assert.equal(excluded[0].ruleId, 'dos')
})

test('a finding with unknown severity survives filtering by default', () => {
  const findings = [{ file: 'src/a.js', severity: null, description: 'Credentials written to the debug log' }]
  const r = applyFilters(findings, { severityAllow: ['HIGH'] })
  assert.equal(r.kept.length, 1)
  assert.equal(r.excluded.length, 0)
})

test('unknown severity is only dropped when the caller explicitly asks, and the drop is attributed', () => {
  const r = applyFilters([{ file: 'src/a.js', severity: null, description: 'Credentials in the debug log' }], { excludeUnknownSeverity: true })
  assert.equal(r.kept.length, 0)
  assert.equal(r.excluded[0].ruleId, 'severity_unknown')
  assert.equal(r.excluded[0].stage, 'severity')
})

test('a severity allow-list drops only graded findings outside the set', () => {
  const r = applyFilters([
    { file: 'a.js', severity: 'HIGH', description: 'sqli' },
    { file: 'b.js', severity: 'low', description: 'verbose error' },
  ], { severityAllow: ['HIGH'] })
  assert.equal(r.kept.length, 1)
  assert.equal(r.excluded[0].ruleId, 'severity_filter')
  assert.equal(r.excluded[0].evidence, 'LOW')
})

test('a confidence threshold keeps unscored findings rather than treating absent as low', () => {
  const r = applyFilters([
    { file: 'a.js', severity: 'HIGH', description: 'sqli', filterConfidenceScore: 8 },
    { file: 'b.js', severity: 'HIGH', description: 'xss', filterConfidenceScore: 3 },
    { file: 'c.js', severity: 'HIGH', description: 'rce', filterConfidenceScore: null },
  ], { minFilterConfidence: 5 })
  assert.equal(r.kept.length, 2)
  assert.deepEqual(r.kept.map(f => f.file), ['a.js', 'c.js'])
  assert.equal(r.excluded[0].ruleId, 'min_filter_confidence')
})

test('counts reconcile: kept + excluded + malformed equals the input length', () => {
  const findings = [
    { file: 'a.js', severity: 'HIGH', description: 'sqli' },
    { file: 'b.md', severity: 'HIGH', description: 'hardcoded key' },
    'garbage',
  ]
  const r = applyFilters(findings)
  assert.equal(r.kept.length + r.excluded.length + r.malformed.length, findings.length)
  assert.equal(r.total, 3)
  assert.equal(r.bounds.capped, false)
})

test('applyFilters never throws on shapeless input', () => {
  for (const input of [null, undefined, 'nope', {}, [null], [{}], [{ file: null, description: null }]]) {
    const r = applyFilters(input)
    assert.equal(Array.isArray(r.kept), true)
    assert.equal(Array.isArray(r.excluded), true)
  }
})

test('a rule that throws is reported and does not stop the remaining rules', () => {
  const rules = [{ id: 'boom', test() { throw new Error('bad rule') } }, ...hardExclusionRules()]
  const r = applyFilters([{ file: 'x.md', severity: 'HIGH', description: 'key' }], { rules })
  assert.equal(r.excluded.length, 1)
  assert.equal(r.excluded[0].ruleId, 'markdown_file')
  assert.equal(r.malformed.length, 1)
  assert.ok(r.malformed[0].reason.includes('bad rule'))
})


test('artifact and comment findings for the same issue produce the same key', () => {
  const fromArtifact = parseResultsJson(artifact({
    findings: [{ file: 'src/api.js', line: 17, category: 'xss', description: 'Reflected  XSS in the   search handler', severity: 'HIGH' }],
  })).findings[0]
  const fromComment = parseReviewComments([comment()]).findings[0]
  assert.equal(fromArtifact.key, fromComment.key)
})

test('the dedupe key truncates long descriptions at a declared bound', () => {
  const long = 'a'.repeat(5000)
  const key = findingKey({ file: 'a.js', line: 1, category: 'x', description: long })
  assert.ok(key.length < 300)
  assert.equal(parseResultsJson(artifact()).bounds.idDescriptionChars, 200)
})

test('file extension handling matches the upstream last-dot rule', () => {
  assert.equal(fileExtension('src/a.MD'), '.md')
  assert.equal(fileExtension('Makefile'), '')
  assert.equal(fileExtension('a.b/c'), '.b/c')
  assert.equal(fileExtension(null), '')
})
