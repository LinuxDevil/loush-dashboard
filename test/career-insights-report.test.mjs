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

test('anchors pattern prompt regex to copyable-prompt-section to avoid stealing next card', () => {
  // Two pattern cards: first has NO copyable-prompt-section, second has one.
  // The unanchored regex would consume second card's prompt into first card.
  const html = `
    <div class="pattern-card">
      <div class="pattern-title">Pattern One</div>
      <div class="pattern-summary">No prompt here</div>
      <div class="pattern-detail">First card detail with no prompt block</div>
    </div>
    <div class="pattern-card">
      <div class="pattern-title">Pattern Two</div>
      <div class="pattern-summary">Has a prompt</div>
      <div class="pattern-detail">Second card detail</div>
      <div class="copyable-prompt-section">
        <div class="prompt-label">Prompt Label</div>
        <div class="copyable-prompt-row">
          <code class="copyable-prompt">This is the second card's prompt</code>
        </div>
      </div>
    </div>
  `
  const r = parseReportNarrative(html)
  assert.equal(r.patterns.length, 2, 'should extract both pattern cards')
  assert.equal(r.patterns[0].prompt, '', 'first pattern should have empty prompt')
  assert.ok(r.patterns[1].prompt.includes('second card'), 'second pattern should have its own prompt, not stolen by first')
})
