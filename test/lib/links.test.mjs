// Parsed against the real thing: this is the description of AIR-10817 in the shape JIRA's ADF
// converter emits it, including the board URL the ticket was pasted from — which is the one form
// of JIRA link that carries the key in a query parameter rather than the path, and the form that a
// `/browse/` regex alone silently misses.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractLinks, jiraKeys, keyFromInput, sheetLinks, confluenceLinks } from '../../lib/links.mjs'

const TICKET = `
Design: https://www.figma.com/design/oiAvGuLJ8INuWKWLOaFfiX/Flights-Experiments?node-id=23127-5347 | Scenarios: https://www.figma.com/design/oiAvGuLJ8INuWKWLOaFfiX/Flights-Experiments?node-id=23132-13147 | Content: https://docs.google.com/spreadsheets/d/1E3GyrTt1pkA93D_sLkQHFSupTfngLsG0-8FI2YzteO8/edit?gid=955095625#gid=955095625

Depends on AIR-10787 and the spec at https://data4altayyargroup.atlassian.net/wiki/spaces/FLIGHTS/pages/123456789/Fare+Families
See also https://data4altayyargroup.atlassian.net/browse/AIR-9001
Branch naming stays AIR-10817-1 style. Encoding is UTF-8.
`

test('the two Figma frames are kept apart — they differ only by node', () => {
  const { figma } = extractLinks(TICKET, 'AIR-10817')
  assert.equal(figma.length, 2)
  assert.ok(figma[0].includes('23127-5347') && figma[1].includes('23132-13147'))
})

test('a sheet link yields the CSV export URL with its gid', () => {
  const [s] = sheetLinks(TICKET)
  assert.equal(s.id, '1E3GyrTt1pkA93D_sLkQHFSupTfngLsG0-8FI2YzteO8')
  assert.equal(s.csv, 'https://docs.google.com/spreadsheets/d/1E3GyrTt1pkA93D_sLkQHFSupTfngLsG0-8FI2YzteO8/export?format=csv&gid=955095625')
})

test('a Confluence link is reduced to the page id the API wants', () => {
  const [p] = confluenceLinks(TICKET)
  assert.equal(p.id, '123456789')
})

test('issue keys: browse URLs, prose from known projects, and never the ticket itself', () => {
  const keys = jiraKeys(TICKET, 'AIR-10817', ['AIR']).sort()
  assert.deepEqual(keys, ['AIR-10787', 'AIR-9001'])
  assert.ok(!keys.includes('AIR-10817'), 'a ticket citing its own key must not be followed')
  assert.ok(!keys.includes('AIR-10817-1'), 'a branch name is not an issue key')
  assert.ok(!keys.includes('UTF-8'), 'UTF-8 matches the shape of a key and is not one')
})

test('with no known projects, prose keys are ignored rather than guessed', () => {
  // The browse URL still comes through — it is a JIRA link, not a word that looks like one.
  assert.deepEqual(jiraKeys(TICKET, 'AIR-10817'), ['AIR-9001'])
})

test('the key can be read out of whatever the user pastes', () => {
  assert.equal(keyFromInput('https://x.atlassian.net/browse/AIR-10817'), 'AIR-10817')
  assert.equal(keyFromInput('https://x.atlassian.net/jira/software/c/projects/AIR/boards/55?selectedIssue=AIR-10817'), 'AIR-10817')
  assert.equal(keyFromInput('air-10817'), 'AIR-10817')
  assert.equal(keyFromInput('not a ticket'), null)
})
