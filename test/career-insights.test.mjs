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
