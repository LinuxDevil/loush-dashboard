import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLadder } from '../src/career/ladder.mjs'

test('parses level|area|expectation and preserves evidence on re-parse', () => {
  const rows = parseLadder('Senior | Direction | Drives decisions\nSenior | Talent | Mentors juniors')
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], { level: 'Senior', area: 'Direction', expectation: 'Drives decisions', evidenceState: 'yellow', bragLinks: [] })
  // re-parse with a prior red tag on Direction keeps it
  const prev = [{ level: 'Senior', area: 'Direction', expectation: 'x', evidenceState: 'red', bragLinks: ['b1'] }]
  const again = parseLadder('Senior | Direction | Drives decisions', prev)
  assert.equal(again[0].evidenceState, 'red')
  assert.deepEqual(again[0].bragLinks, ['b1'])
})
