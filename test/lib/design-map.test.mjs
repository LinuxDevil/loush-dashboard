import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { harvestStories } from '../../lib/design-map.mjs'

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
