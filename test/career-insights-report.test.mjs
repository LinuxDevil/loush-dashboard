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

test('parses friction with examples, horizon, features, and patterns with prompt', () => {
  const r = parseReportNarrative(html)
  assert.ok(r.friction.length >= 1)
  assert.ok(r.friction[0].examples.length >= 1, 'friction examples should be populated from the fixture')
  assert.ok(r.horizon.length >= 1)
  assert.ok(r.features.length >= 1)
  assert.ok(r.patterns.length >= 1)
  assert.ok(r.patterns[0].prompt && r.patterns[0].prompt.length > 0, 'pattern prompt should be populated from the fixture')
  assert.ok(r.stats.sessions > 0)
  assert.ok(r.stats.dateRange.length > 0)
})
