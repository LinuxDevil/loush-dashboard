# Design Map L0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `design-map.json` — one verified row per design-system component linking it to a Figma node and a code path — and a dashboard review queue to confirm the rows, replacing the freehand annotation editor.

**Architecture:** One pure module `lib/design-map.mjs` does all the work (harvest story links → detect collisions → verify against Figma → merge). It takes paths and an injected fetch-shaped function, returns data, and never touches Express. `server/design-map.mjs` is HTTP-only glue. The UI is a review table: the machine proposes rows, a human confirms them. Only `confirmed` rows ever leave L0.

**Tech Stack:** Node 20+ ESM, `node --test` + `node:assert/strict`, Express 4, React 18, Vite. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-26-design-code-mapping-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/design-map.mjs` (create) | Pure. Harvest, collide, enumerate, verify, merge, read/write. No HTTP, no network of its own — callers inject `fetchFn`. |
| `test/lib/design-map.test.mjs` (create) | Tests for every pure function, using fixtures. No token, no network. |
| `test/fixtures/ds-repo/` (create) | A miniature design-system repo: `stories/*.stories.tsx` + `src/components/*/`. |
| `lib/paths.mjs` (modify) | Add `DESIGN_MAP_FILE`. |
| `scripts/design-map-report.mjs` (create) | CLI printing the drift report. Runs with no Figma token. |
| `server/design-map.mjs` (create) | HTTP endpoints. Delegates everything to `lib/design-map.mjs`. |
| `server/index.mjs` (modify) | Mount the new router. |
| `src/almosafer/DesignMapSection.jsx` (create) | Review queue UI. |
| `src/App.jsx` (modify) | Register the section; drop the old one. |
| `src/almosafer/FigmaCaptureSection.jsx` (modify) | Delete the annotation canvas; keep capture create/list/screenshot. |
| `server/figma-capture.mjs` (modify) | Delete annotation + context + project-components endpoints. |

**Row shape** (used by every task — do not drift from it):

```js
// One row per design-system component.
{
  component: 'Button',                    // string, unique key across rows
  codePath: 'src/components/Button',      // relative to the DS repo, or null if not found
  importFrom: '@tajawal/ct-web-design-system',
  figma: null,                            // or { fileKey, nodeId, nodeName, nodeType }
  source: 'story',                        // 'story' | 'matched' | 'manual' | null
  status: 'proposed',                     // 'proposed' | 'confirmed' | 'rejected' | 'unmapped'
  evidence: {
    nameScore: 0,                         // 0 | 0.5 | 1
    collisionWith: [],                    // other component names claiming the same nodeId
    verifiedAt: null,                     // ISO string once checked against Figma
  },
}
```

**Test file convention:** every task after Task 2 appends tests to the *same* file,
`test/lib/design-map.test.mjs`. Each task lists the new named exports it needs — **merge them into
the single existing `import { … } from '../../lib/design-map.mjs'` statement** rather than adding
another one. Re-importing a name that is already imported is a `SyntaxError`, not a warning, and it
takes the whole file down.

---

### Task 1: Fixture design-system repo

A miniature DS repo that reproduces the real one's shape, including a real collision. Every later test uses it.

**Files:**
- Create: `test/fixtures/ds-repo/stories/Button.stories.tsx`
- Create: `test/fixtures/ds-repo/stories/IconButton.stories.tsx`
- Create: `test/fixtures/ds-repo/stories/Card.stories.tsx`
- Create: `test/fixtures/ds-repo/stories/Icons.stories.tsx`
- Create: `test/fixtures/ds-repo/src/components/Button/index.tsx`
- Create: `test/fixtures/ds-repo/src/components/IconButton/index.tsx`
- Create: `test/fixtures/ds-repo/src/components/Card/index.tsx`
- Create: `test/fixtures/ds-repo/src/components/Icons/index.tsx`
- Create: `test/fixtures/ds-repo/src/components/Tooltip/index.tsx`
- Create: `test/fixtures/ds-repo/package.json`

- [ ] **Step 1: Create the four story files**

`test/fixtures/ds-repo/stories/Button.stories.tsx` — note the node id uses the `%3A` encoding, exactly as the real repo does:

```tsx
import Button from '../src/components/Button'

export default {
  title: 'Components/Button',
  component: Button,
  parameters: {
    controls: { expanded: true },
    design: { type: 'figma', url: 'https://www.figma.com/file/FILEKEY1/Styles-%2B-Components?node-id=601%3A5' },
  },
}

export const Basic = () => <Button>Go</Button>
```

`test/fixtures/ds-repo/stories/IconButton.stories.tsx` — the copy-paste collision: same node as Button.

```tsx
import IconButton from '../src/components/IconButton'

export default {
  title: 'Components/IconButton',
  component: IconButton,
  parameters: {
    design: { type: 'figma', url: 'https://www.figma.com/file/FILEKEY1/Styles-%2B-Components?node-id=601%3A5' },
  },
}

export const Basic = () => <IconButton />
```

`test/fixtures/ds-repo/stories/Card.stories.tsx` — unique node, and the dashed id form that must normalise to a colon:

```tsx
import Card from '../src/components/Card'

export default {
  title: 'Components/Card',
  component: Card,
  parameters: {
    design: { type: 'figma', url: 'https://www.figma.com/design/FILEKEY1/Styles?node-id=646-2324&t=abc-0' },
  },
}

export const Basic = () => <Card />
```

`test/fixtures/ds-repo/stories/Icons.stories.tsx` — a story with no design param at all:

```tsx
import Icons from '../src/components/Icons'

export default { title: 'Images/Icons', component: Icons }

export const Basic = () => <Icons />
```

- [ ] **Step 2: Create the five component files**

Each is a one-line stub. `test/fixtures/ds-repo/src/components/Button/index.tsx`:

```tsx
export default function Button({ children }: { children?: unknown }) { return children }
```

Repeat the same content, changing only the function name, for:
- `test/fixtures/ds-repo/src/components/IconButton/index.tsx` → `export default function IconButton() { return null }`
- `test/fixtures/ds-repo/src/components/Card/index.tsx` → `export default function Card() { return null }`
- `test/fixtures/ds-repo/src/components/Icons/index.tsx` → `export default function Icons() { return null }`
- `test/fixtures/ds-repo/src/components/Tooltip/index.tsx` → `export default function Tooltip() { return null }`

`Tooltip` deliberately has **no story file** — it is the `unmapped` case.

- [ ] **Step 3: Create `test/fixtures/ds-repo/package.json`**

```json
{
  "name": "@tajawal/ct-web-design-system",
  "version": "0.28.0-rc.0",
  "main": "dist/index.js"
}
```

- [ ] **Step 4: Verify the fixture tree**

Run: `find test/fixtures/ds-repo -type f | sort`

Expected — exactly 10 files:
```
test/fixtures/ds-repo/package.json
test/fixtures/ds-repo/src/components/Button/index.tsx
test/fixtures/ds-repo/src/components/Card/index.tsx
test/fixtures/ds-repo/src/components/IconButton/index.tsx
test/fixtures/ds-repo/src/components/Icons/index.tsx
test/fixtures/ds-repo/src/components/Tooltip/index.tsx
test/fixtures/ds-repo/stories/Button.stories.tsx
test/fixtures/ds-repo/stories/Card.stories.tsx
test/fixtures/ds-repo/stories/IconButton.stories.tsx
test/fixtures/ds-repo/stories/Icons.stories.tsx
```

- [ ] **Step 5: Commit**

```bash
git add test/fixtures/ds-repo
git commit -m "test: fixture design-system repo with a real node-id collision"
```

---

### Task 2: `harvestStories()` — read the seed links

**Files:**
- Create: `lib/design-map.mjs`
- Create: `test/lib/design-map.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/lib/design-map.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/lib/design-map.test.mjs`

Expected: FAIL — `Cannot find module '.../lib/design-map.mjs'`

- [ ] **Step 3: Write the minimal implementation**

Create `lib/design-map.mjs`:

```js
// lib/design-map.mjs — the design-system ⇄ Figma ⇄ code mapping.
//
// WHY THIS EXISTS
// ct-web-design-system's stories already carry `parameters.design.figma.url` for 47 of 52
// components — and they resolve to only 19 unique Figma nodes. Node 601:5 alone is claimed by
// seven components (Button, VoucherCodeField, InputFieldDesktop, IconButton, Autocomplete,
// Dropdown, DropdownDesktop). So the seed data LOOKS like 90% coverage and is ~40% correct at
// best. Every function here treats a story link as a CLAIM to be checked, never as a fact.
//
// Pure by design: paths and an injected fetch-shaped function in, data out. No Express, no
// process.env, no ambient network — that is what makes it testable without a Figma token.
import fs from 'node:fs'
import path from 'node:path'

const STORY_RE = /\.stories\.tsx?$/
// Matches both /file/ and /design/ URLs. The node id stops at a quote, &, or whitespace so a
// trailing &t=<tracking> is not swallowed into the id.
// Deliberately NOT global: both call sites (here and parseFigmaLink in Task 7) exec once and never
// iterate matches, so a /g flag would only add cross-call lastIndex state to have to reset.
// ponytail: grep over source text, not an AST — the first figma.com URL in a story file wins, so a
// stray earlier reference would be picked up instead. Parse the `parameters.design` object properly
// if that ever bites.
const FIGMA_URL_RE = /figma\.com\/(?:file|design)\/([A-Za-z0-9]+)\/[^"'\s]*?node-id=([^"'&\s]+)/

// Figma writes the same node id three ways: "601:5", "601%3A5" and "601-5". Normalise to colons
// so a collision check can actually see duplicates. Node ids contain no other dashes.
// These URLs are hand-copied, so a malformed %-sequence is in scope: decodeURIComponent throws
// URIError on one, and an uncaught throw here would abort the harvest of every OTHER story file
// too. Fall back to the raw string — a wrong-but-harmless id beats losing the whole run.
export const normaliseNodeId = raw => {
  const s = String(raw)
  let decoded
  try { decoded = decodeURIComponent(s) } catch { decoded = s }
  return decoded.replace(/-/g, ':')
}

export function harvestStories(dsRepo) {
  const dir = path.join(dsRepo, 'stories')
  let entries
  try { entries = fs.readdirSync(dir) } catch { return [] }
  const rows = []
  for (const file of entries.sort()) {
    if (!STORY_RE.test(file)) continue
    let src
    try { src = fs.readFileSync(path.join(dir, file), 'utf8') } catch { continue }
    const m = FIGMA_URL_RE.exec(src)
    if (!m) continue
    rows.push({
      component: file.replace(STORY_RE, ''),
      figma: { fileKey: m[1], nodeId: normaliseNodeId(m[2]) },
      source: 'story',
    })
  }
  return rows
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/lib/design-map.test.mjs`

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/design-map.mjs test/lib/design-map.test.mjs
git commit -m "feat(design-map): harvest Figma links from design-system stories"
```

---

### Task 3: `markCollisions()` — the zero-API drift report

This is the headline finding. It needs no Figma token.

**Files:**
- Modify: `lib/design-map.mjs`
- Modify: `test/lib/design-map.test.mjs`

- [ ] **Step 1: Write the failing test**

**Extend the existing import** at the top of `test/lib/design-map.test.mjs` — do not add a second
import statement for this module, or `harvestStories` will be declared twice and the file will not
parse:

```js
import { harvestStories, markCollisions } from '../../lib/design-map.mjs'
```

Then append the tests to `test/lib/design-map.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/lib/design-map.test.mjs`

Expected: FAIL — `markCollisions is not a function` (`SyntaxError: ... does not provide an export named 'markCollisions'`).

- [ ] **Step 3: Write the minimal implementation**

Append to `lib/design-map.mjs`:

```js
const nodeKey = figma => figma ? `${figma.fileKey}|${figma.nodeId}` : null

// The ONE definition of "unset evidence". Every writer of `evidence` — markCollisions here,
// buildMap in Task 4, verifyRows in Task 6 — must start from this. Three hand-copied literals is
// how the meaning of "unscored" silently drifts apart between writers.
const EMPTY_EVIDENCE = { nameScore: 0, collisionWith: [], verifiedAt: null }

// A node claimed by more than one component means the story link was copy-pasted from a sibling.
// Costs zero Figma API calls and is the single highest-signal check in L0: on the real repo it
// flags 37 components across 9 nodes.
export function markCollisions(rows) {
  const claimants = new Map()
  for (const r of rows) {
    const k = nodeKey(r.figma)
    if (!k) continue
    if (!claimants.has(k)) claimants.set(k, [])
    claimants.get(k).push(r.component)
  }
  return rows.map(r => {
    const k = nodeKey(r.figma)
    const others = k ? claimants.get(k).filter(c => c !== r.component) : []
    // collisionWith is recomputed from scratch every call, so it comes AFTER the spread of any
    // existing evidence — a stale list from a previous run must never win.
    return { ...r, evidence: { ...EMPTY_EVIDENCE, ...r.evidence, collisionWith: others } }
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/lib/design-map.test.mjs`

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/design-map.mjs test/lib/design-map.test.mjs
git commit -m "feat(design-map): detect copy-pasted Figma node collisions with no API calls"
```

---

### Task 4: `enumerateComponents()` and `buildMap()`

Unmapped components must be *visible as unmapped*, not absent — otherwise coverage looks better than it is.

**Files:**
- Modify: `lib/design-map.mjs`
- Modify: `test/lib/design-map.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `test/lib/design-map.test.mjs`:

```js
import { enumerateComponents, buildMap } from '../../lib/design-map.mjs'

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/lib/design-map.test.mjs`

Expected: FAIL — no export named `enumerateComponents`.

- [ ] **Step 3: Write the minimal implementation**

Append to `lib/design-map.mjs`:

```js
export function enumerateComponents(dsRepo) {
  const dir = path.join(dsRepo, 'src', 'components')
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory() && /^[A-Z]/.test(e.name))
      .map(e => e.name).sort()
  } catch { return [] }
}

const readJson = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return fallback } }

// Harvest + enumerate + collide, in one pass. Produces a complete map where every component has a
// row: `unmapped` when no story link exists, `proposed` when one does. Nothing is ever `confirmed`
// here — confirmation requires either a Figma check (verifyRows) or a human (the review queue).
export function buildMap(dsRepo) {
  const pkg = readJson(path.join(dsRepo, 'package.json'), {})
  const harvested = new Map(markCollisions(harvestStories(dsRepo)).map(r => [r.component, r]))
  const importFrom = pkg.name || '@tajawal/ct-web-design-system'

  const rows = enumerateComponents(dsRepo).map(component => {
    const hit = harvested.get(component)
    return {
      component,
      codePath: `src/components/${component}`,
      importFrom,
      figma: hit?.figma ?? null,
      source: hit ? 'story' : null,
      status: hit ? 'proposed' : 'unmapped',
      evidence: { ...EMPTY_EVIDENCE, collisionWith: hit?.evidence?.collisionWith ?? [] },
    }
  })

  // A story can name a component with no src/components dir (Colors, Tokens, TypographyList in the
  // real repo). Keep those rows — they are real mappings, just not directories.
  for (const [component, hit] of harvested) {
    if (rows.some(r => r.component === component)) continue
    rows.push({
      component, codePath: null, importFrom,
      figma: hit.figma, source: 'story', status: 'proposed',
      evidence: { ...EMPTY_EVIDENCE, collisionWith: hit.evidence?.collisionWith ?? [] },
    })
  }

  rows.sort((a, b) => a.component.localeCompare(b.component))
  return { dsRepo, dsPackage: importFrom, dsVersion: pkg.version || null, rows }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/lib/design-map.test.mjs`

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/design-map.mjs test/lib/design-map.test.mjs
git commit -m "feat(design-map): build a complete map where unmapped components stay visible"
```

---

### Task 5: `summarise()` and the report CLI

Ships the headline finding with no Figma token.

**Files:**
- Modify: `lib/design-map.mjs`
- Modify: `test/lib/design-map.test.mjs`
- Create: `scripts/design-map-report.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

Append to `test/lib/design-map.test.mjs`:

```js
import { summarise } from '../../lib/design-map.mjs'

test('summarise quantifies coverage and provable wrongness', () => {
  const s = summarise(buildMap(DS))
  assert.equal(s.components, 5)
  assert.equal(s.linked, 3)          // Button, Card, IconButton
  assert.equal(s.unmapped, 2)        // Icons, Tooltip
  assert.equal(s.uniqueNodes, 2)     // 601:5 and 646:2324
  assert.equal(s.collidingComponents, 2)  // Button + IconButton
  assert.equal(s.collidingNodes, 1)       // 601:5
  // 3 links over 2 unique nodes: at most 2 can be right, so at least 1 is wrong
  assert.equal(s.provablyWrong, 1)
  assert.deepEqual(s.collisions, [{ fileKey: 'FILEKEY1', nodeId: '601:5', components: ['Button', 'IconButton'] }])
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/lib/design-map.test.mjs`

Expected: FAIL — no export named `summarise`.

- [ ] **Step 3: Write the minimal implementation**

Append to `lib/design-map.mjs`:

```js
// `provablyWrong` is the load-bearing number: a Figma node can be the true source for at most ONE
// component, so (links - uniqueNodes) links are wrong no matter which claimant is right. On the
// real repo this is 47 - 19 = 28.
export function summarise(map) {
  const linked = map.rows.filter(r => r.figma)
  const claimants = new Map()
  for (const r of linked) {
    const k = `${r.figma.fileKey}|${r.figma.nodeId}`
    if (!claimants.has(k)) claimants.set(k, [])
    claimants.get(k).push(r.component)
  }
  const collisions = [...claimants.entries()]
    .filter(([, cs]) => cs.length > 1)
    .map(([k, cs]) => ({ fileKey: k.split('|')[0], nodeId: k.split('|')[1], components: cs.sort() }))
    .sort((a, b) => b.components.length - a.components.length)

  return {
    components: map.rows.length,
    linked: linked.length,
    unmapped: map.rows.filter(r => r.status === 'unmapped').length,
    confirmed: map.rows.filter(r => r.status === 'confirmed').length,
    uniqueNodes: claimants.size,
    collidingNodes: collisions.length,
    collidingComponents: collisions.reduce((n, c) => n + c.components.length, 0),
    provablyWrong: linked.length - claimants.size,
    collisions,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/lib/design-map.test.mjs`

Expected: PASS, 9 tests.

- [ ] **Step 5: Write the CLI**

Create `scripts/design-map-report.mjs`:

```js
// Print the design-map drift report for a design-system repo. Needs no Figma token.
//   node scripts/design-map-report.mjs ~/workspace/ct-web-design-system
import { buildMap, summarise } from '../lib/design-map.mjs'

const dsRepo = process.argv[2]
if (!dsRepo) {
  console.error('usage: node scripts/design-map-report.mjs <path-to-design-system-repo>')
  process.exit(1)
}

const map = buildMap(dsRepo)
const s = summarise(map)

console.log(`\n${map.dsPackage}@${map.dsVersion ?? '?'}  —  ${dsRepo}\n`)
console.log(`components        ${s.components}`)
console.log(`with a Figma link ${s.linked}  (${s.unmapped} unmapped)`)
console.log(`unique nodes      ${s.uniqueNodes}`)
console.log(`provably wrong    ${s.provablyWrong}  of ${s.linked} links`)
if (s.collisions.length) {
  console.log(`\n${s.collidingNodes} node(s) claimed by more than one component:\n`)
  for (const c of s.collisions) {
    console.log(`  ${c.nodeId}  ×${c.components.length}  ${c.components.join(', ')}`)
  }
}
console.log('')
```

- [ ] **Step 6: Add the npm script**

In `package.json`, add to `"scripts"` after the `"test"` entry:

```json
"designmap:report": "node scripts/design-map-report.mjs"
```

- [ ] **Step 7: Run it against the real design system**

Run: `npm run designmap:report -- ~/workspace/ct-web-design-system`

Expected output shape (numbers should match the spec's findings):
```
@tajawal/ct-web-design-system@0.28.0-rc.0  —  /Users/.../ct-web-design-system

components        48
with a Figma link 47
unique nodes      19
provably wrong    28  of 47 links

9 node(s) claimed by more than one component:

  601:5  ×7  Autocomplete, Button, Dropdown, DropdownDesktop, IconButton, InputFieldDesktop, VoucherCodeField
  ...
```

If `provably wrong` is not 28, stop and reconcile against the spec before continuing — the seed
parse has drifted.

- [ ] **Step 8: Commit**

```bash
git add lib/design-map.mjs test/lib/design-map.test.mjs scripts/design-map-report.mjs package.json
git commit -m "feat(design-map): drift report CLI — quantifies provably-wrong Figma links"
```

---

### Task 6: `verifyRows()` — check claims against Figma

The critical invariant: **a colliding row can never auto-confirm, however good its name match.**

**Files:**
- Modify: `lib/design-map.mjs`
- Modify: `test/lib/design-map.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `test/lib/design-map.test.mjs`:

```js
import { nameScore, verifyRows } from '../../lib/design-map.mjs'

test('nameScore: exact normalised match scores 1, partial 0.5, unrelated 0', () => {
  assert.equal(nameScore('Button', 'Button'), 1)
  assert.equal(nameScore('Button', 'Button/Primary'), 1)   // first path segment wins
  assert.equal(nameScore('IconButton', 'icon button'), 1)  // case + separators normalised
  assert.equal(nameScore('Button', 'Button Group'), 0.5)   // one contains the other
  assert.equal(nameScore('Button', 'Accordion'), 0)
})

// A fetch-shaped stub. Returns the node payload Figma's /v1/files/:key/nodes gives back.
function stubFetch(nodesByFileKey) {
  return async url => {
    const fileKey = url.match(/files\/([^/]+)\/nodes/)[1]
    const ids = new URLSearchParams(url.split('?')[1]).get('ids').split(',')
    const nodes = {}
    for (const id of ids) {
      const doc = nodesByFileKey[fileKey]?.[id]
      if (doc) nodes[id] = { document: doc }
    }
    return { ok: true, status: 200, json: async () => ({ nodes }) }
  }
}

test('verifyRows auto-confirms only an exact-named component node with no collision', async () => {
  const rows = [
    { component: 'Card', figma: { fileKey: 'F1', nodeId: '646:2324' }, source: 'story', status: 'proposed', evidence: { nameScore: 0, collisionWith: [], verifiedAt: null } },
  ]
  const fetchFn = stubFetch({ F1: { '646:2324': { id: '646:2324', name: 'Card', type: 'COMPONENT_SET' } } })
  const [row] = await verifyRows(rows, fetchFn, { token: 't', now: () => '2026-07-26T00:00:00.000Z' })

  assert.equal(row.status, 'confirmed')
  assert.equal(row.figma.nodeName, 'Card')
  assert.equal(row.figma.nodeType, 'COMPONENT_SET')
  assert.equal(row.evidence.nameScore, 1)
  assert.equal(row.evidence.verifiedAt, '2026-07-26T00:00:00.000Z')
})

test('verifyRows refuses to confirm a colliding row even on a perfect name match', async () => {
  const rows = [
    { component: 'Button', figma: { fileKey: 'F1', nodeId: '601:5' }, source: 'story', status: 'proposed', evidence: { nameScore: 0, collisionWith: ['IconButton'], verifiedAt: null } },
  ]
  const fetchFn = stubFetch({ F1: { '601:5': { id: '601:5', name: 'Button', type: 'COMPONENT_SET' } } })
  const [row] = await verifyRows(rows, fetchFn, { token: 't', now: () => 'NOW' })

  assert.equal(row.evidence.nameScore, 1)   // the name really does match
  assert.equal(row.status, 'proposed')      // ...and it still is not confirmed
})

test('verifyRows leaves a frame (non-component) node proposed', async () => {
  const rows = [
    { component: 'Card', figma: { fileKey: 'F1', nodeId: '646:2324' }, source: 'story', status: 'proposed', evidence: { nameScore: 0, collisionWith: [], verifiedAt: null } },
  ]
  const fetchFn = stubFetch({ F1: { '646:2324': { id: '646:2324', name: 'Card', type: 'FRAME' } } })
  const [row] = await verifyRows(rows, fetchFn, { token: 't', now: () => 'NOW' })
  assert.equal(row.status, 'proposed')
  assert.equal(row.figma.nodeType, 'FRAME')
})

test('verifyRows marks a vanished node rejected', async () => {
  const rows = [
    { component: 'Card', figma: { fileKey: 'F1', nodeId: '999:999' }, source: 'story', status: 'proposed', evidence: { nameScore: 0, collisionWith: [], verifiedAt: null } },
  ]
  const [row] = await verifyRows(rows, stubFetch({ F1: {} }), { token: 't', now: () => 'NOW' })
  assert.equal(row.status, 'rejected')
  assert.equal(row.figma.nodeName, null)
})

test('verifyRows batches one request per file key', async () => {
  const calls = []
  const rows = [
    { component: 'A', figma: { fileKey: 'F1', nodeId: '1:1' }, source: 'story', status: 'proposed', evidence: { nameScore: 0, collisionWith: [], verifiedAt: null } },
    { component: 'B', figma: { fileKey: 'F1', nodeId: '2:2' }, source: 'story', status: 'proposed', evidence: { nameScore: 0, collisionWith: [], verifiedAt: null } },
    { component: 'C', figma: { fileKey: 'F2', nodeId: '3:3' }, source: 'story', status: 'proposed', evidence: { nameScore: 0, collisionWith: [], verifiedAt: null } },
  ]
  const fetchFn = async url => { calls.push(url); return { ok: true, status: 200, json: async () => ({ nodes: {} }) } }
  await verifyRows(rows, fetchFn, { token: 't', now: () => 'NOW' })

  assert.equal(calls.length, 2)  // 3 nodes, 2 files, 2 calls
  const f1 = calls.find(u => u.includes('/files/F1/nodes'))
  const ids = decodeURIComponent(new URLSearchParams(f1.split('?')[1]).get('ids'))
  assert.equal(ids, '1:1,2:2')   // both F1 nodes in one request
  assert.ok(calls.some(u => u.includes('/files/F2/nodes')))
})

test('verifyRows never re-verifies a confirmed row', async () => {
  const rows = [
    { component: 'Card', figma: { fileKey: 'F1', nodeId: '646:2324', nodeName: 'Card', nodeType: 'COMPONENT' }, source: 'manual', status: 'confirmed', evidence: { nameScore: 1, collisionWith: [], verifiedAt: 'EARLIER' } },
  ]
  let called = false
  await verifyRows(rows, async () => { called = true; return { ok: true, status: 200, json: async () => ({ nodes: {} }) } }, { token: 't', now: () => 'NOW' })
  assert.equal(called, false)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/lib/design-map.test.mjs`

Expected: FAIL — no export named `nameScore`.

- [ ] **Step 3: Write the minimal implementation**

Append to `lib/design-map.mjs`:

```js
// Figma component names are paths ("Button/Primary/Large"); the component identity is the first
// segment. Normalise away case and separators so "IconButton" matches "icon button".
const norm = s => String(s || '').split('/')[0].toLowerCase().replace(/[^a-z0-9]/g, '')

// ponytail: three-valued score, no edit-distance library. 1 = exact, 0.5 = one contains the other,
// 0 = unrelated. Only 1 can auto-confirm, so a fuzzier scale would buy nothing.
export function nameScore(component, nodeName) {
  const a = norm(component), b = norm(nodeName)
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.includes(b) || b.includes(a)) return 0.5
  return 0
}

const CONFIRMABLE_TYPES = new Set(['COMPONENT', 'COMPONENT_SET'])

// Check each proposed row's claim against the real Figma node. `fetchFn` is injected so this runs
// in tests with no token and no network.
//
// Auto-confirm needs ALL THREE: an exact name match, a real COMPONENT/COMPONENT_SET node, and no
// collision. The collision veto is the point — on the real repo, Button's story link scores a
// perfect name match against node 601:5 AND so would six other components' links to the same node.
// Name evidence cannot break that tie, so a human has to.
export async function verifyRows(rows, fetchFn, { token, now = () => new Date().toISOString() } = {}) {
  const pending = rows.filter(r => r.figma?.nodeId && r.status !== 'confirmed')
  const byFile = new Map()
  for (const r of pending) {
    if (!byFile.has(r.figma.fileKey)) byFile.set(r.figma.fileKey, new Set())
    byFile.get(r.figma.fileKey).add(r.figma.nodeId)
  }

  const docs = new Map() // `${fileKey}|${nodeId}` -> node document
  for (const [fileKey, ids] of byFile) {
    const url = `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent([...ids].join(','))}`
    const res = await fetchFn(url, { headers: { 'X-Figma-Token': token } })
    const json = await res.json()
    if (!res.ok) throw Object.assign(new Error(json?.err || json?.message || `Figma API ${res.status}`), { status: res.status })
    for (const [id, entry] of Object.entries(json.nodes || {})) {
      if (entry?.document) docs.set(`${fileKey}|${id}`, entry.document)
    }
  }

  const stamp = now()
  return rows.map(row => {
    if (!pending.includes(row)) return row
    const doc = docs.get(`${row.figma.fileKey}|${row.figma.nodeId}`)
    if (!doc) {
      return { ...row, figma: { ...row.figma, nodeName: null, nodeType: null }, status: 'rejected',
        evidence: { ...row.evidence, nameScore: 0, verifiedAt: stamp } }
    }
    const score = nameScore(row.component, doc.name)
    const colliding = (row.evidence?.collisionWith?.length ?? 0) > 0
    const confirmable = score === 1 && CONFIRMABLE_TYPES.has(doc.type) && !colliding
    return {
      ...row,
      figma: { ...row.figma, nodeName: doc.name, nodeType: doc.type },
      status: confirmable ? 'confirmed' : 'proposed',
      evidence: { ...row.evidence, nameScore: score, verifiedAt: stamp },
    }
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/lib/design-map.test.mjs`

Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/design-map.mjs test/lib/design-map.test.mjs
git commit -m "feat(design-map): verify claims against Figma; collision vetoes auto-confirm"
```

---

### Task 7: Persistence — `DESIGN_MAP_FILE`, read/write, and row edits

**Files:**
- Modify: `lib/paths.mjs`
- Modify: `lib/design-map.mjs`
- Modify: `test/lib/design-map.test.mjs`

- [ ] **Step 1: Add the path constant**

In `lib/paths.mjs`, immediately after the existing `CATALOG_FILE` line (line 57):

```js
export const DESIGN_MAP_FILE = path.join(APP_ROOT, 'design-map.json')
```

- [ ] **Step 2: Write the failing test**

Append to `test/lib/design-map.test.mjs`:

```js
import fs from 'node:fs'
import os from 'node:os'
import { readMap, writeMap, applyRowEdit } from '../../lib/design-map.mjs'

test('writeMap then readMap round-trips', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dm-')), 'design-map.json')
  const map = buildMap(DS)
  writeMap(file, map)
  const back = readMap(file)
  assert.equal(back.rows.length, map.rows.length)
  assert.equal(back.dsPackage, map.dsPackage)
  assert.ok(back.generatedAt)
})

test('readMap returns an empty map when the file is absent', () => {
  const back = readMap(path.join(os.tmpdir(), 'definitely-not-here-' + Math.random(), 'x.json'))
  assert.deepEqual(back.rows, [])
})

test('applyRowEdit confirms a row and records the human as the source', () => {
  const map = buildMap(DS)
  const next = applyRowEdit(map, 'Button', { status: 'confirmed' }, () => 'NOW')
  const row = next.rows.find(r => r.component === 'Button')
  assert.equal(row.status, 'confirmed')
  assert.equal(row.source, 'manual')
  assert.equal(row.evidence.confirmedAt, 'NOW')
  // untouched rows are unchanged
  assert.equal(next.rows.find(r => r.component === 'Card').status, 'proposed')
})

test('applyRowEdit accepts a pasted Figma link and re-keys the node', () => {
  const map = buildMap(DS)
  const next = applyRowEdit(map, 'Tooltip', {
    figmaLink: 'https://www.figma.com/design/FILEKEY1/Styles?node-id=4812-49526',
    status: 'confirmed',
  }, () => 'NOW')
  const row = next.rows.find(r => r.component === 'Tooltip')
  assert.deepEqual(row.figma, { fileKey: 'FILEKEY1', nodeId: '4812:49526', nodeName: null, nodeType: null })
  assert.equal(row.source, 'manual')
  assert.equal(row.status, 'confirmed')
})

test('applyRowEdit throws on an unknown component', () => {
  assert.throws(() => applyRowEdit(buildMap(DS), 'Nope', { status: 'confirmed' }), /Nope/)
})

test('applyRowEdit rejects an unknown status', () => {
  assert.throws(() => applyRowEdit(buildMap(DS), 'Button', { status: 'blessed' }), /status/)
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test test/lib/design-map.test.mjs`

Expected: FAIL — no export named `readMap`.

- [ ] **Step 4: Write the minimal implementation**

Append to `lib/design-map.mjs`:

```js
const STATUSES = new Set(['proposed', 'confirmed', 'rejected', 'unmapped'])

export function readMap(file) {
  const m = readJson(file, null)
  return m && Array.isArray(m.rows) ? m : { dsRepo: null, dsPackage: null, dsVersion: null, rows: [], generatedAt: null }
}

export function writeMap(file, map, now = () => new Date().toISOString()) {
  const out = { ...map, generatedAt: now() }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(out, null, 2))
  return out
}

// Parse a pasted Figma URL into { fileKey, nodeId }. Throws with a message aimed at the human who
// pasted it, since this is reached straight from a UI field.
export function parseFigmaLink(link) {
  const m = FIGMA_URL_RE.exec(String(link))
  if (!m) throw Object.assign(new Error('link must include a file key and a node-id (select the component in Figma, then Share > Copy link)'), { status: 400 })
  return { fileKey: m[1], nodeId: normaliseNodeId(m[2]) }
}

// A human's decision on one row. Any human edit sets source: 'manual' — it outranks the harvested
// story link permanently, so a later re-harvest must not silently overwrite it.
export function applyRowEdit(map, component, { status, figmaLink, note } = {}, now = () => new Date().toISOString()) {
  const i = map.rows.findIndex(r => r.component === component)
  if (i === -1) throw Object.assign(new Error(`no such component in the map: ${component}`), { status: 404 })
  if (status !== undefined && !STATUSES.has(status)) throw Object.assign(new Error(`bad status: ${status}`), { status: 400 })

  const row = map.rows[i]
  const figma = figmaLink ? { ...parseFigmaLink(figmaLink), nodeName: null, nodeType: null } : row.figma
  const next = {
    ...row,
    figma,
    source: 'manual',
    status: status ?? row.status,
    evidence: { ...row.evidence, confirmedAt: now(), ...(note === undefined ? {} : { note }) },
  }
  const rows = [...map.rows]
  rows[i] = next
  return { ...map, rows }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/lib/design-map.test.mjs`

Expected: PASS, 22 tests.

- [ ] **Step 6: Run the whole suite for regressions**

Run: `npm test`

Expected: all pre-existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add lib/paths.mjs lib/design-map.mjs test/lib/design-map.test.mjs
git commit -m "feat(design-map): persist the map and apply human row decisions"
```

---

### Task 8: HTTP endpoints

**Files:**
- Create: `server/design-map.mjs`
- Modify: `server/index.mjs`

- [ ] **Step 1: Read how the existing router is mounted**

Run: `grep -n "mountFigmaCapture\|import mount" server/index.mjs`

Expected: an import of `./figma-capture.mjs` and a `mountFigmaCapture(app)` call. Mirror that pattern exactly.

- [ ] **Step 2: Write the router**

Create `server/design-map.mjs`:

```js
// HTTP surface for the design-system ⇄ Figma ⇄ code map. All logic lives in lib/design-map.mjs;
// this file only parses requests and shapes responses.
//
// The Figma token is resolved the same way figma-capture.mjs does it — env wins, else a 0600 file
// the UI writes — so both features share one credential and neither echoes it back.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DESIGN_MAP_FILE } from '../lib/paths.mjs'
import { buildMap, summarise, verifyRows, readMap, writeMap, applyRowEdit } from '../lib/design-map.mjs'

const TOKEN_FILE = path.join(os.homedir(), '.claude', 'dashboard-figma-token.json')
const readJson = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return fallback } }
const figmaToken = () => process.env.FIGMA_TOKEN || readJson(TOKEN_FILE, {}).token || ''

export default function mountDesignMap(app) {
  // current map + summary
  app.get('/api/design-map', (req, res) => {
    const map = readMap(DESIGN_MAP_FILE)
    res.json({ map, summary: summarise(map) })
  })

  // (re)harvest from a design-system repo. Human decisions survive: any row already marked
  // 'manual' keeps its figma link and status.
  app.post('/api/design-map/harvest', (req, res) => {
    try {
      const dsRepo = path.resolve(String(req.body?.dsRepo || ''))
      if (!fs.existsSync(path.join(dsRepo, 'package.json'))) {
        return res.status(400).json({ error: `not a design-system repo (no package.json): ${dsRepo}` })
      }
      const fresh = buildMap(dsRepo)
      const previous = new Map(readMap(DESIGN_MAP_FILE).rows.filter(r => r.source === 'manual').map(r => [r.component, r]))
      const rows = fresh.rows.map(r => previous.get(r.component) ?? r)
      for (const [component, kept] of previous) if (!rows.some(r => r.component === component)) rows.push(kept)
      rows.sort((a, b) => a.component.localeCompare(b.component))

      const map = writeMap(DESIGN_MAP_FILE, { ...fresh, rows })
      res.json({ map, summary: summarise(map) })
    } catch (e) { res.status(e.status || 500).json({ error: e.message }) }
  })

  // verify every proposed row against Figma
  app.post('/api/design-map/verify', async (req, res) => {
    const token = figmaToken()
    if (!token) return res.status(400).json({ error: 'No Figma API key set — add one on the Figma Capture page (or set FIGMA_TOKEN on the server).' })
    try {
      const current = readMap(DESIGN_MAP_FILE)
      if (!current.rows.length) return res.status(400).json({ error: 'no map yet — harvest a design-system repo first' })
      const rows = await verifyRows(current.rows, fetch, { token })
      const map = writeMap(DESIGN_MAP_FILE, { ...current, rows })
      res.json({ map, summary: summarise(map) })
    } catch (e) { res.status(e.status || 500).json({ error: e.message }) }
  })

  // a human's decision on one row
  app.put('/api/design-map/rows/:component', (req, res) => {
    try {
      const current = readMap(DESIGN_MAP_FILE)
      const next = applyRowEdit(current, req.params.component, {
        status: req.body?.status,
        figmaLink: req.body?.figmaLink,
        note: req.body?.note,
      })
      const map = writeMap(DESIGN_MAP_FILE, next)
      res.json({ map, summary: summarise(map) })
    } catch (e) { res.status(e.status || 500).json({ error: e.message }) }
  })
}
```

- [ ] **Step 3: Mount it**

In `server/index.mjs`, next to the existing `figma-capture` import:

```js
import mountDesignMap from './design-map.mjs'
```

and next to the existing `mountFigmaCapture(app)` call:

```js
mountDesignMap(app)
```

- [ ] **Step 4: Verify the endpoints by hand**

Start the server: `node server/index.mjs`

In another shell:

```bash
curl -s localhost:5174/api/design-map | head -c 300
```

Expected: `{"map":{"dsRepo":null,...,"rows":[]},"summary":{"components":0,...}}`
(If the port differs, read it from `server/index.mjs`.)

Then harvest:

```bash
curl -s -X POST localhost:5174/api/design-map/harvest -H 'content-type: application/json' -d '{"dsRepo":"'"$HOME"'/workspace/ct-web-design-system"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["summary"])'
```

Expected: a summary with `components: 48`, `linked: 47`, `uniqueNodes: 19`, `provablyWrong: 28`.

- [ ] **Step 5: Confirm `design-map.json` is gitignored or committed deliberately**

Run: `grep -n "design-map" .gitignore`

The map is generated state that contains human decisions worth keeping. **Commit it** — so if it is
matched by an existing ignore rule, add a negation. Otherwise no change is needed.

- [ ] **Step 6: Commit**

```bash
git add server/design-map.mjs server/index.mjs
git commit -m "feat(design-map): HTTP endpoints for harvest, verify and row decisions"
```

---

### Task 9: The review queue UI

Replaces the annotation canvas. The machine proposes; the human confirms.

**Files:**
- Create: `src/almosafer/DesignMapSection.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Read the conventions to copy**

Run: `sed -n '1,20p' src/almosafer/FigmaCaptureSection.jsx`

Copy its token usage exactly: `MONO`/`HEAD`/`SANS` consts, the `PANEL` style object, the `Dim`
helper, and `api`/`tildify` from `../lib/api.js`. Do not introduce new colours — only `var(--…)`
tokens.

- [ ] **Step 2: Write the section**

Create `src/almosafer/DesignMapSection.jsx`:

```jsx
import React, { useEffect, useState } from 'react'
import { api, tildify } from '../lib/api.js'

const MONO = 'var(--mono)'
const SANS = 'var(--body)'
const PANEL = { background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 8, padding: 12, minWidth: 0 }
const Dim = ({ children, style }) => <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-tertiary)', ...style }}>{children}</div>

const STATUS_COLOR = {
  confirmed: 'var(--green)',
  proposed: 'var(--amber)',
  rejected: 'var(--red)',
  unmapped: 'var(--text-tertiary)',
}

function Summary({ s }) {
  if (!s) return null
  const cells = [
    ['components', s.components],
    ['linked', s.linked],
    ['confirmed', s.confirmed],
    ['unique nodes', s.uniqueNodes],
    ['provably wrong', s.provablyWrong],
  ]
  return (
    <div style={{ ...PANEL, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
      {cells.map(([label, v]) => (
        <div key={label}>
          <div style={{ font: `600 20px ${MONO}`, color: label === 'provably wrong' && v > 0 ? 'var(--red)' : 'var(--text-primary)' }}>{v}</div>
          <Dim>{label}</Dim>
        </div>
      ))}
    </div>
  )
}

function Collisions({ collisions }) {
  if (!collisions?.length) return null
  return (
    <div style={{ ...PANEL, marginTop: 12 }}>
      <div style={{ font: `600 12px ${SANS}`, marginBottom: 8 }}>
        {collisions.length} Figma node{collisions.length === 1 ? '' : 's'} claimed by more than one component
      </div>
      <Dim style={{ marginBottom: 8 }}>
        A node can be the true source for at most one component, so every extra claimant is a
        copy-pasted link. These can never auto-confirm.
      </Dim>
      {collisions.map(c => (
        <div key={c.nodeId} style={{ font: `400 11px ${MONO}`, padding: '3px 0', borderTop: '1px solid var(--border-subtle)' }}>
          <span style={{ color: 'var(--red)' }}>{c.nodeId}</span>
          <span style={{ color: 'var(--text-tertiary)' }}> ×{c.components.length} </span>
          {c.components.join(', ')}
        </div>
      ))}
    </div>
  )
}

function Row({ row, onEdit, busy }) {
  const [link, setLink] = useState('')
  const [open, setOpen] = useState(false)
  const f = row.figma
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr 130px 200px', gap: 10, alignItems: 'center', padding: '6px 0', borderTop: '1px solid var(--border-subtle)' }}>
      <div style={{ font: `600 12px ${MONO}` }}>{row.component}</div>
      <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-secondary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {f ? `${f.nodeId}${f.nodeName ? ` · ${f.nodeName}` : ''}${f.nodeType ? ` (${f.nodeType})` : ''}` : '—'}
        {row.evidence?.collisionWith?.length ? (
          <span style={{ color: 'var(--red)' }}> · shared with {row.evidence.collisionWith.join(', ')}</span>
        ) : null}
      </div>
      <div style={{ font: `600 11px ${MONO}`, color: STATUS_COLOR[row.status] }}>{row.status}</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {row.status !== 'confirmed' && f && (
          <button disabled={busy} onClick={() => onEdit(row.component, { status: 'confirmed' })}>confirm</button>
        )}
        {row.status !== 'rejected' && f && (
          <button disabled={busy} onClick={() => onEdit(row.component, { status: 'rejected' })}>reject</button>
        )}
        <button disabled={busy} onClick={() => setOpen(o => !o)}>link</button>
        {open && (
          <div style={{ position: 'absolute', zIndex: 2, ...PANEL, marginTop: 60 }}>
            <input
              value={link} onChange={e => setLink(e.target.value)} placeholder="paste the Figma component link"
              style={{ font: `400 11px ${MONO}`, width: 320 }}
            />
            <button
              disabled={busy || !link}
              onClick={() => { onEdit(row.component, { figmaLink: link, status: 'confirmed' }); setOpen(false); setLink('') }}
            >save</button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function DesignMapSection() {
  const [state, setState] = useState(null)   // { map, summary }
  const [dsRepo, setDsRepo] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [filter, setFilter] = useState('all')

  const load = () => api('/api/design-map').then(setState).catch(e => setErr(e.message))
  useEffect(() => { load() }, [])
  useEffect(() => { if (state?.map?.dsRepo && !dsRepo) setDsRepo(state.map.dsRepo) }, [state])

  const run = async (fn) => {
    setBusy(true); setErr(null)
    try { setState(await fn()) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const harvest = () => run(() => api('/api/design-map/harvest', { method: 'POST', body: { dsRepo } }))
  const verify = () => run(() => api('/api/design-map/verify', { method: 'POST' }))
  const edit = (component, patch) => run(() =>
    api(`/api/design-map/rows/${encodeURIComponent(component)}`, { method: 'PUT', body: patch }))

  const rows = (state?.map?.rows || []).filter(r => filter === 'all' || r.status === filter)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={PANEL}>
        <div style={{ font: `600 12px ${SANS}`, marginBottom: 6 }}>Design-system repo</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={dsRepo} onChange={e => setDsRepo(e.target.value)}
            placeholder="/path/to/ct-web-design-system"
            style={{ font: `400 11px ${MONO}`, flex: 1 }}
          />
          <button disabled={busy || !dsRepo} onClick={harvest}>harvest</button>
          <button disabled={busy || !state?.map?.rows?.length} onClick={verify}>verify against Figma</button>
        </div>
        {state?.map?.dsVersion && <Dim style={{ marginTop: 6 }}>{state.map.dsPackage}@{state.map.dsVersion} · {tildify(state.map.dsRepo || '')}</Dim>}
        {err && <div style={{ font: `400 11px ${MONO}`, color: 'var(--red)', marginTop: 6 }}>{err}</div>}
      </div>

      <Summary s={state?.summary} />
      <Collisions collisions={state?.summary?.collisions} />

      <div style={PANEL}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          {['all', 'proposed', 'confirmed', 'rejected', 'unmapped'].map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{ fontWeight: filter === f ? 700 : 400 }}>{f}</button>
          ))}
        </div>
        {!rows.length && <Dim>No rows. Point at a design-system repo and harvest.</Dim>}
        {rows.map(r => <Row key={r.component} row={r} onEdit={edit} busy={busy} />)}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Register the section**

In `src/App.jsx`, add next to the existing Figma import (line ~30):

```jsx
import DesignMapSection from './almosafer/DesignMapSection.jsx'
```

and change the tab list entry at line ~122 from:

```jsx
{ label: 'Figma Capture', el: <FigmaCaptureSection /> },
```

to:

```jsx
{ label: 'Design Map', el: <DesignMapSection /> },
{ label: 'Figma Capture', el: <FigmaCaptureSection /> },
```

- [ ] **Step 4: Verify in the browser**

Start the dev server via the preview tooling (not `npm run dev` in a raw shell), open the
**Design Map** tab, and check:
1. It renders with an empty state and no console errors.
2. Typing `~/workspace/ct-web-design-system`'s absolute path and clicking **harvest** shows
   `components 48`, `linked 47`, `unique nodes 19`, `provably wrong 28` in red.
3. The collisions panel lists `601:5 ×7 Autocomplete, Button, …`.
4. Clicking **confirm** on a row flips its status to green `confirmed` and persists across a reload.
5. Toggle a dark/light theme switch — no hardcoded colour survives (everything is a `var(--…)`).

- [ ] **Step 5: Commit**

```bash
git add src/almosafer/DesignMapSection.jsx src/App.jsx design-map.json
git commit -m "feat(design-map): review queue replacing the annotation canvas"
```

---

### Task 10: Delete what L0 made redundant

Deletion is part of the deliverable. Do this last so the replacement is proven first.

**Files:**
- Modify: `server/figma-capture.mjs`
- Modify: `src/almosafer/FigmaCaptureSection.jsx`
- Delete: `scripts/refresh-design-catalog.mjs`
- Delete: `design-system-catalog.json`
- Modify: `lib/paths.mjs`
- Modify: `package.json`

- [ ] **Step 1: Confirm nothing else reads the catalog**

Run: `grep -rn "CATALOG_FILE\|design-system-catalog\|catalog:refresh\|project-components\|annotations" --include="*.mjs" --include="*.jsx" --include="*.js" --include="*.json" lib server src scripts package.json | grep -v node_modules`

Expected: hits only in `server/figma-capture.mjs`, `src/almosafer/FigmaCaptureSection.jsx`,
`lib/paths.mjs`, `scripts/refresh-design-catalog.mjs`, `package.json`. If anything else appears,
stop and handle that consumer before deleting.

- [ ] **Step 2: Strip the server**

In `server/figma-capture.mjs` delete:
- the `contextMarkdown()` function
- `IGNORE_DIRS`, `COMPONENT_EXTS`, `MAX_FILES_SCANNED`, `MAX_PROJECT_COMPONENTS`, `COMPONENT_EXPORT_RES`, `scanProjectComponents()`, `projectComponentsCache`, `PROJECT_COMPONENTS_TTL`, `cachedProjectComponents()`
- the `CATALOG_FILE` import
- the `GET /api/figma-capture/catalog` handler
- the `GET /api/figma-capture/project-components` handler
- the `POST /api/figma-capture/:slug/annotations` handler
- the `POST /api/figma-capture/:slug/context` handler
- the `annotations.json` reads in `GET /api/figma-capture/list` and `GET /api/figma-capture/:slug`
  (drop `annotationCount` from the list payload and `annotations` from the detail payload)

Keep: token handling, `create`, `list`, `:slug`, `:slug/screenshot`, `branch`, `parseFigmaLink`,
`fetchCapture`, `flattenNode`.

Also delete the `annotations.json` write in the `create` handler — nothing reads it now.

- [ ] **Step 3: Strip the UI**

In `src/almosafer/FigmaCaptureSection.jsx` delete `nodeAt()`, `ComponentPicker`, `AnnotationForm`,
and the whole `Editor` component, plus the `slug`/`catalog` state and the branch of
`FigmaCaptureSection` that renders `<Editor/>`. What remains is the project picker,
`FigmaTokenBar`, `BranchChip`, `CreateCaptureForm` and `CaptureList` — capture creation and listing,
with no annotation surface.

- [ ] **Step 4: Delete the catalog and its scraper**

```bash
git rm scripts/refresh-design-catalog.mjs design-system-catalog.json
```

Remove the `CATALOG_FILE` export (line 57) from `lib/paths.mjs`, and remove the `catalog:refresh`
entry from `package.json`'s `scripts`.

- [ ] **Step 5: Verify nothing broke**

Run: `npm test`
Expected: all tests pass.

Run: `grep -rn "CATALOG_FILE\|design-system-catalog\|catalog:refresh\|project-components" lib server src scripts package.json | grep -v node_modules`
Expected: **no output.**

Then in the browser: the **Figma Capture** tab still lists captures, creates one from a link, and
shows a screenshot; the **Design Map** tab is unaffected. No console errors on either.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: delete the annotation editor and the Storybook bundle scraper

The review queue in Design Map replaces hand-drawn annotations, and reading
the local design-system repo replaces regexing a webpack bundle off GitHub
Pages. Removes ~600 lines and a dependency on a build artifact's
minification settings."
```

---

## Deliberately deferred from L0

**Spec L0 step 4 — gap-filling by name-matching Figma's published components** is not in this plan.
It depends on `GET /v1/files/:key/components` returning a non-empty list, which is spec risk #1 and
is still unverified (no Figma token was available when the spec was written). Planning an
auto-proposal step against a data source that may not exist would mean writing tests for a shape
nobody has seen.

Nothing is lost in the meantime: `applyRowEdit` accepts a pasted Figma link (Task 7), so a human can
map any `unmapped` row from the review queue. Gap-filling is an automation convenience over that
path, not a missing capability. Add it as a follow-up once the verification below passes — the
`source: 'matched'` value already exists in the row shape for it, and such rows must never
auto-confirm.

## Definition of done

- `npm test` passes, including 22 new `design-map` tests.
- `npm run designmap:report -- ~/workspace/ct-web-design-system` prints `provably wrong 28 of 47`.
- The **Design Map** tab harvests, verifies, and persists per-row human decisions.
- No colliding row is ever `confirmed` without a human clicking confirm.
- `design-system-catalog.json`, `refresh-design-catalog.mjs`, and the annotation editor are gone.
- `design-map.json` is committed with real confirmed rows.

## Verify before starting L1

Two spec assumptions gate the next plan. Check them once a token is available:

1. `curl -s -H "X-Figma-Token: $FIGMA_TOKEN" "https://api.figma.com/v1/files/8nasqgUrdKsT8JgQRBHwPB/components" | head -c 400`
   — a non-empty `meta.components` confirms the DS file is a published library. If it is empty, L3's
   data source changes (fall back to polling `/nodes` for confirmed ids) and L0 step 4's gap-filling
   is not available.
2. Whether `npx figma connect publish` succeeds against that file, or needs edit access the author
   does not have. If it fails, L1 degrades to repo-local mappings and L0/L2/L3 are unaffected.
