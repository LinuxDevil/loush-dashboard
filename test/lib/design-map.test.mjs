import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { harvestStories, markCollisions, enumerateComponents, buildMap } from '../../lib/design-map.mjs'

const DS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'ds-repo')

test('harvestStories reads parameters.design.figma.url from every story', () => {
  const found = harvestStories(DS)
  const byComponent = Object.fromEntries(found.map(r => [r.component, r]))

  // %3A decodes to a colon
  assert.deepEqual(byComponent.Button.figma, { fileKey: 'FILEKEY1', nodeId: '601:5' })
  // the dashed form normalises to a colon, and the &t= tracking param is not swallowed
  assert.deepEqual(byComponent.Card.figma, { fileKey: 'FILEKEY1', nodeId: '646:2324' })
  // the copy-pasted duplicate is harvested as-is; collision detection is a separate step
  assert.deepEqual(byComponent.IconButton.figma, { fileKey: 'FILEKEY1', nodeId: '601:5' })
  // a story with no design param yields no row
  assert.equal(byComponent.Icons, undefined)

  assert.equal(found.length, 3)
  assert.ok(found.every(r => r.source === 'story'))
})

test('harvestStories returns [] for a directory with no stories', () => {
  assert.deepEqual(harvestStories(path.join(DS, 'src')), [])
})

test('harvestStories takes the first figma.com URL when a story has two', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-map-'))
  fs.mkdirSync(path.join(tmp, 'stories'))
  fs.writeFileSync(
    path.join(tmp, 'stories', 'Multi.stories.tsx'),
    `export default {
      parameters: {
        // stray earlier reference — should lose to the real one below
        design: { type: 'figma', url: 'https://www.figma.com/file/STALEKEY/Old?node-id=1:1' },
      },
    }
    // a second, later link that must NOT win
    // https://www.figma.com/file/REALKEY/New?node-id=2:2
    `,
  )

  const [row] = harvestStories(tmp)
  assert.deepEqual(row.figma, { fileKey: 'STALEKEY', nodeId: '1:1' })
})

test('markCollisions flags every component claiming a shared node', () => {
  const rows = markCollisions(harvestStories(DS))
  const by = Object.fromEntries(rows.map(r => [r.component, r]))

  // Button and IconButton both claim FILEKEY1|601:5 — each names the other
  assert.deepEqual(by.Button.evidence.collisionWith, ['IconButton'])
  assert.deepEqual(by.IconButton.evidence.collisionWith, ['Button'])
  // Card's node is claimed once, so no collision
  assert.deepEqual(by.Card.evidence.collisionWith, [])
})

test('markCollisions keys on fileKey AND nodeId, not nodeId alone', () => {
  const rows = markCollisions([
    { component: 'A', figma: { fileKey: 'F1', nodeId: '1:1' }, source: 'story' },
    { component: 'B', figma: { fileKey: 'F2', nodeId: '1:1' }, source: 'story' },
  ])
  // same node id in DIFFERENT files is not a collision
  assert.deepEqual(rows[0].evidence.collisionWith, [])
  assert.deepEqual(rows[1].evidence.collisionWith, [])
})

test('markCollisions tolerates rows with no figma link', () => {
  const rows = markCollisions([{ component: 'A', figma: null, source: null }])
  assert.deepEqual(rows[0].evidence.collisionWith, [])
})

test('markCollisions names ALL other claimants on a 3+-way collision, not just one', () => {
  // Mirrors the real ct-web-design-system case: node 601:5 is claimed by 7 components at once.
  // A 2-member fixture can't catch a regression from `.filter(c => c !== r.component)` to
  // `[claimants.find(...)]` — both would pass with only two claimants. This pins the full list.
  const shared = { fileKey: 'F1', nodeId: '601:5' }
  const rows = markCollisions([
    { component: 'Button', figma: shared, source: 'story' },
    { component: 'VoucherCodeField', figma: shared, source: 'story' },
    { component: 'InputFieldDesktop', figma: shared, source: 'story' },
  ])
  const by = Object.fromEntries(rows.map(r => [r.component, r]))

  assert.deepEqual(by.Button.evidence.collisionWith, ['VoucherCodeField', 'InputFieldDesktop'])
  assert.deepEqual(by.VoucherCodeField.evidence.collisionWith, ['Button', 'InputFieldDesktop'])
  assert.deepEqual(by.InputFieldDesktop.evidence.collisionWith, ['Button', 'VoucherCodeField'])
})

test('enumerateComponents lists every src/components/<Name> directory', () => {
  assert.deepEqual(enumerateComponents(DS), ['Button', 'Card', 'IconButton', 'Icons', 'Tooltip'])
})

test('buildMap merges stories with the component list', () => {
  const map = buildMap(DS)
  assert.equal(map.dsPackage, '@tajawal/ct-web-design-system')
  assert.equal(map.dsVersion, '0.28.0-rc.0')
  assert.equal(map.rows.length, 5)

  const by = Object.fromEntries(map.rows.map(r => [r.component, r]))
  // a component with no story link is explicitly unmapped, not missing
  assert.equal(by.Tooltip.status, 'unmapped')
  assert.equal(by.Tooltip.figma, null)
  assert.equal(by.Tooltip.source, null)
  // one with a link starts as proposed — never confirmed on harvest alone
  assert.equal(by.Button.status, 'proposed')
  assert.equal(by.Button.codePath, 'src/components/Button')
  assert.equal(by.Button.importFrom, '@tajawal/ct-web-design-system')
  assert.deepEqual(by.Button.evidence.collisionWith, ['IconButton'])
  // rows are sorted by component name for a stable diff
  assert.deepEqual(map.rows.map(r => r.component), ['Button', 'Card', 'IconButton', 'Icons', 'Tooltip'])
})

test('buildMap never marks a row confirmed', () => {
  assert.equal(buildMap(DS).rows.some(r => r.status === 'confirmed'), false)
})
