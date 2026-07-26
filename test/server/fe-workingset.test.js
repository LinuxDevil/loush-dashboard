// Tests for server-fe.mjs pure logic.
//
// The existing suite is 181 green tests that assert privacy shapes and never once assert that a
// computed number equals an expected number. These do the opposite: every case here pins arithmetic
// or a null-vs-zero decision, because those are the two things the audits found broken everywhere else.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {
  extractImports, resolveSpecifier, buildImportGraph, siblingsFor, classify,
  reworkScore, aggregateFiles, isOrphanCandidate, buildTimeline, contextBundle, coverageOf,
  REWORK_WEIGHTS, REWORK_MIN_SESSIONS, isTestFile, isStoryFile,
} from '../../server/fe.mjs'

// ---------------------------------------------------------------- extractImports

test('extractImports finds static, default, side-effect, re-export, require and dynamic forms', () => {
  const src = `
    import React from 'react'
    import { a, b } from './util'
    import './styles.css'
    import type { T } from '../types'
    export { x } from './x'
    export * from './y'
    const z = require('./z')
    const lazy = () => import('./Lazy')
  `
  const got = extractImports(src)
  for (const s of ['react', './util', './styles.css', '../types', './x', './y', './z', './Lazy'])
    assert.ok(got.includes(s), `missing ${s}`)
})

test('extractImports ignores commented-out imports', () => {
  const src = `
    // import { dead } from './dead'
    /* import { alsoDead } from './also-dead' */
    import { live } from './live'
  `
  const got = extractImports(src)
  assert.deepEqual(got, ['./live'])
})

test('extractImports de-duplicates repeated specifiers', () => {
  assert.deepEqual(extractImports(`import a from './x'\nimport b from './x'`), ['./x'])
})

test('extractImports on empty/garbage input returns an empty array, never throws', () => {
  assert.deepEqual(extractImports(''), [])
  assert.deepEqual(extractImports(null), [])
  assert.deepEqual(extractImports(undefined), [])
})

// ---------------------------------------------------------------- resolveSpecifier

const FS = new Set([
  'src/components/Button.tsx',
  'src/components/index.ts',
  'src/util.ts',
  'src/pages/Home.jsx',
  'src/styles.css',
])

test('resolveSpecifier resolves a relative sibling with an implicit extension', () => {
  assert.equal(resolveSpecifier('src/pages/Home.jsx', '../components/Button', FS), 'src/components/Button.tsx')
})

test('resolveSpecifier resolves a directory to its index file', () => {
  assert.equal(resolveSpecifier('src/pages/Home.jsx', '../components', FS), 'src/components/index.ts')
})

test('resolveSpecifier resolves an explicit extension exactly', () => {
  assert.equal(resolveSpecifier('src/pages/Home.jsx', '../styles.css', FS), 'src/styles.css')
})

test('resolveSpecifier handles the @/ and ~/ alias conventions', () => {
  assert.equal(resolveSpecifier('src/pages/Home.jsx', '@/util', FS, 'src'), 'src/util.ts')
  assert.equal(resolveSpecifier('src/pages/Home.jsx', '~/components/Button', FS, 'src'), 'src/components/Button.tsx')
})

test('resolveSpecifier returns null for a bare npm specifier — external, not ours', () => {
  assert.equal(resolveSpecifier('src/util.ts', 'react', FS), null)
  assert.equal(resolveSpecifier('src/util.ts', '@tanstack/react-query', FS), null)
})

test('resolveSpecifier returns null for a relative path that escapes the repo', () => {
  assert.equal(resolveSpecifier('src/util.ts', '../../../../etc/passwd', FS), null)
})

test('resolveSpecifier returns null when the target genuinely does not exist', () => {
  assert.equal(resolveSpecifier('src/util.ts', './nope', FS), null)
})

// ---------------------------------------------------------------- buildImportGraph

test('buildImportGraph inverts edges into importers and counts resolution honestly', () => {
  const sources = new Map([
    ['src/pages/Home.jsx', `import Button from '../components/Button'\nimport React from 'react'`],
    ['src/pages/About.jsx', `import Button from '../components/Button'`],
    ['src/components/Button.tsx', `import '../styles.css'\nimport { missing } from './does-not-exist'`],
  ])
  const fileSet = new Set([...FS, 'src/pages/About.jsx'])
  const { importers, imports, stats } = buildImportGraph(sources, fileSet, 'src')

  assert.equal(importers.get('src/components/Button.tsx').size, 2, 'Button has exactly two importers')
  assert.ok(importers.get('src/components/Button.tsx').has('src/pages/Home.jsx'))
  assert.ok(importers.get('src/components/Button.tsx').has('src/pages/About.jsx'))
  assert.equal(imports.get('src/pages/Home.jsx').size, 1, 'react is external, not an internal edge')

  assert.equal(stats.resolved, 3)
  assert.equal(stats.external, 1, "'react' counted as external")
  assert.equal(stats.unresolved, 1, "'./does-not-exist' counted as unresolved, not silently dropped")
})

test('buildImportGraph ignores a self-import', () => {
  const { importers } = buildImportGraph(new Map([['src/util.ts', `import x from './util'`]]), new Set(['src/util.ts']))
  assert.equal(importers.has('src/util.ts'), false)
})

// ---------------------------------------------------------------- classify / siblings

test('classify separates source, test, story, style and doc', () => {
  assert.equal(classify('src/Button.tsx'), 'source')
  assert.equal(classify('src/Button.test.tsx'), 'test')
  assert.equal(classify('src/Button.spec.ts'), 'test')
  assert.equal(classify('src/__tests__/Button.tsx'), 'test')
  assert.equal(classify('src/Button.stories.tsx'), 'story')
  assert.equal(classify('src/Button.stories.mdx'), 'story')
  assert.equal(classify('src/theme.scss'), 'style')
  assert.equal(classify('README.md'), 'doc')
  assert.equal(classify('logo.svg'), 'other')
})

test('a test file is not misread as a story and vice versa', () => {
  assert.ok(isTestFile('src/Button.test.tsx') && !isStoryFile('src/Button.test.tsx'))
  assert.ok(isStoryFile('src/Button.stories.tsx') && !isTestFile('src/Button.stories.tsx'))
})

test('siblingsFor detects colocated and __tests__/__stories__ conventions', () => {
  const fs1 = new Set(['src/Button.tsx', 'src/Button.test.tsx', 'src/Button.stories.tsx'])
  assert.deepEqual(siblingsFor('src/Button.tsx', fs1), { hasTest: true, hasStory: true })

  const fs2 = new Set(['src/Button.tsx', 'src/__tests__/Button.test.tsx'])
  assert.deepEqual(siblingsFor('src/Button.tsx', fs2), { hasTest: true, hasStory: false })

  const fs3 = new Set(['src/Button.tsx'])
  assert.deepEqual(siblingsFor('src/Button.tsx', fs3), { hasTest: false, hasStory: false })
})

// ---------------------------------------------------------------- coverageOf

test('coverageOf trusts a test that IMPORTS the file even when the names share no stem', () => {
  // The exact case that made the sibling-only check wrong: test/fe-workingset.test.js covers
  // server-fe.mjs and shares no stem with it.
  const cov = coverageOf('server-fe.mjs', ['server.mjs', 'test/fe-workingset.test.js'], new Set(['server-fe.mjs']))
  assert.equal(cov.hasTest, true)
  assert.deepEqual(cov.testedBy, ['test/fe-workingset.test.js'])
})

test('coverageOf still accepts the colocated naming convention when nothing imports the file', () => {
  const fs1 = new Set(['src/Button.tsx', 'src/Button.test.tsx'])
  const cov = coverageOf('src/Button.tsx', [], fs1)
  assert.equal(cov.hasTest, true)
  assert.deepEqual(cov.testedBy, [], 'no importer evidence — the sibling is what carried it')
})

test('coverageOf reports false, not null, when there is genuinely no test', () => {
  const cov = coverageOf('src/Button.tsx', ['src/App.tsx'], new Set(['src/Button.tsx', 'src/App.tsx']))
  assert.equal(cov.hasTest, false)
  assert.equal(cov.hasStory, false)
})

test('coverageOf distinguishes a story importer from a test importer', () => {
  const cov = coverageOf('src/Button.tsx', ['src/Button.stories.tsx'], new Set(['src/Button.tsx']))
  assert.equal(cov.hasStory, true)
  assert.equal(cov.hasTest, false, 'a story is not a test')
})

// ---------------------------------------------------------------- reworkScore

test('reworkScore returns NULL below the minimum session count — one session is work, not rework', () => {
  assert.equal(reworkScore({ sessionCount: 1, days: 1, edits: 9, failures: 4 }), null)
  assert.equal(reworkScore({ sessionCount: 0, edits: 0 }), null)
  assert.equal(reworkScore(null), null)
  assert.equal(REWORK_MIN_SESSIONS, 2)
})

test('reworkScore arithmetic is exactly the documented weighted sum', () => {
  // 3 sessions, 2 days, 1 failure, 7 edits
  //   revisitSessions 2 * 3 = 6
  //   revisitDays     1 * 2 = 2
  //   failures        1 * 2 = 2
  //   extraEdits (7-3)=4 * 1 = 4
  const r = reworkScore({ sessionCount: 3, days: 2, edits: 7, failures: 1 })
  assert.deepEqual(r.parts, { revisitSessions: 2, revisitDays: 1, failures: 1, extraEdits: 4 })
  assert.equal(r.score, 14)
  assert.equal(r.score,
    r.parts.revisitSessions * REWORK_WEIGHTS.revisitSession +
    r.parts.revisitDays * REWORK_WEIGHTS.revisitDay +
    r.parts.failures * REWORK_WEIGHTS.failure +
    r.parts.extraEdits * REWORK_WEIGHTS.extraEdit)
})

test('reworkScore ranks scattered revisits above an equal number of edits in one sitting', () => {
  const burst = reworkScore({ sessionCount: 2, days: 1, edits: 6, failures: 0 })
  const scattered = reworkScore({ sessionCount: 4, days: 4, edits: 6, failures: 0 })
  assert.ok(scattered.score > burst.score,
    'four separate returns to a file must outrank one long refactor of the same size')
})

test('reworkScore never goes negative when edits < sessions', () => {
  const r = reworkScore({ sessionCount: 3, days: 1, edits: 1, failures: 0 })
  assert.equal(r.parts.extraEdits, 0)
  assert.ok(r.score >= 0)
})

// ---------------------------------------------------------------- aggregateFiles

const ROOT = path.sep === '\\' ? 'C:\\repo' : '/repo'
const A = path.join(ROOT, 'src', 'Button.tsx')
const B = path.join(ROOT, 'src', 'Modal.tsx')
const DAY = 86_400_000
const T0 = Date.parse('2026-03-02T10:00:00Z')

test('aggregateFiles counts edits, sessions, distinct days and sums the diff', () => {
  const rows = aggregateFiles({
    root: ROOT,
    edits: [
      { file: A, t: T0, add: 10, del: 2, sessionId: 's1' },
      { file: A, t: T0 + 1000, add: 5, del: 1, sessionId: 's1' },
      { file: A, t: T0 + DAY, add: 3, del: 0, sessionId: 's2' },
      { file: B, t: T0, add: 1, del: 1, sessionId: 's1' },
    ],
    errors: [],
  })
  const a = rows.find(r => r.rel === 'src/Button.tsx')
  assert.equal(a.edits, 3)
  assert.equal(a.add, 18)
  assert.equal(a.del, 3)
  assert.equal(a.sessionCount, 2)
  assert.equal(a.days, 2)
  assert.equal(a.firstT, T0)
  assert.equal(a.lastT, T0 + DAY)

  const b = rows.find(r => r.rel === 'src/Modal.tsx')
  assert.equal(b.sessionCount, 1)
  assert.equal(b.score, null, 'single-session file scores null, not 0')
})

test('aggregateFiles attributes errors to the exact file and exposes samples', () => {
  const rows = aggregateFiles({
    root: ROOT,
    edits: [
      { file: A, t: T0, add: 1, del: 0, sessionId: 's1' },
      { file: A, t: T0 + DAY, add: 1, del: 0, sessionId: 's2' },
    ],
    errors: [
      { file: A, t: T0 + 5, tool: 'Edit', text: 'String to replace not found', sessionId: 's1' },
      { file: A, t: T0 + 6, tool: 'Edit', text: 'String to replace not found', sessionId: 's1' },
    ],
  })
  const a = rows[0]
  assert.equal(a.failures, 2)
  assert.equal(a.errSamples.length, 2)
  assert.equal(a.errSamples[0].tool, 'Edit')
})

test('aggregateFiles drops edits outside the repo root and errors on never-edited files', () => {
  const rows = aggregateFiles({
    root: ROOT,
    edits: [{ file: path.join(path.sep === '\\' ? 'C:\\other' : '/other', 'x.ts'), t: T0, add: 1, del: 0, sessionId: 's1' }],
    errors: [{ file: path.join(ROOT, 'src', 'Never.tsx'), t: T0, tool: 'Read', text: 'ENOENT', sessionId: 's1' }],
  })
  assert.equal(rows.length, 0, 'an error on a file the agent never edited is not rework evidence')
})

test('aggregateFiles returns an empty array for no input — not a fabricated row', () => {
  assert.deepEqual(aggregateFiles({ root: ROOT, edits: [], errors: [] }), [])
})

// ---------------------------------------------------------------- orphans

test('isOrphanCandidate excludes entry points, routes, configs, tests and stories', () => {
  assert.equal(isOrphanCandidate('src/components/Dead.tsx', 0), true)
  assert.equal(isOrphanCandidate('src/components/Live.tsx', 3), false)
  assert.equal(isOrphanCandidate('src/main.tsx', 0), false, 'entry point')
  assert.equal(isOrphanCandidate('src/index.ts', 0), false, 'index')
  assert.equal(isOrphanCandidate('app/dashboard/page.tsx', 0), false, 'framework route')
  assert.equal(isOrphanCandidate('pages/about.jsx', 0), false, 'pages route')
  assert.equal(isOrphanCandidate('vite.config.ts', 0), false, 'config')
  // Regression: an .mjs/.cjs entry point was reported as dead code because the extension class in
  // ENTRY_RE only covered .js/.jsx/.ts/.tsx. Caught by running the thing against its own repo.
  assert.equal(isOrphanCandidate('server.mjs', 0), false, 'node entry point')
  assert.equal(isOrphanCandidate('index.cjs', 0), false, 'commonjs entry point')
  assert.equal(isOrphanCandidate('src/Button.test.tsx', 0), false, 'tests import, they are not imported')
  assert.equal(isOrphanCandidate('src/Button.stories.tsx', 0), false, 'stories are entry points for Storybook')
  assert.equal(isOrphanCandidate('src/theme.css', 0), false, 'not a source file')
})

// ---------------------------------------------------------------- timeline

test('buildTimeline interleaves prompt, edit and error in time order', () => {
  const tl = buildTimeline({
    file: A,
    edits: [{ file: A, t: T0 + 100, add: 4, del: 1, hunk: '+ const x = 1', sessionId: 's1' }],
    errors: [{ file: A, t: T0 + 150, tool: 'Edit', text: 'not found', sessionId: 's1' }],
    prompts: [
      { t: T0 + 50, text: 'make the button smaller', sessionId: 's1' },
      { t: T0 + 900, text: 'a later prompt, after the edit', sessionId: 's1' },
    ],
  })
  assert.deepEqual(tl.map(e => e.kind), ['prompt', 'edit', 'error'])
  assert.equal(tl[0].text, 'make the button smaller', 'the prompt that CAUSED the edit, not a later one')
})

test('buildTimeline ignores prompts from other sessions', () => {
  const tl = buildTimeline({
    file: A,
    edits: [{ file: A, t: T0 + 100, add: 1, del: 0, sessionId: 's1' }],
    errors: [],
    prompts: [{ t: T0 + 50, text: 'from a different session', sessionId: 'sOTHER' }],
  })
  assert.deepEqual(tl.map(e => e.kind), ['edit'])
})

test('buildTimeline returns empty for a file with no history', () => {
  assert.deepEqual(buildTimeline({ file: A, edits: [], errors: [], prompts: [] }), [])
})

// ---------------------------------------------------------------- context bundle

test('contextBundle lists the blast radius and prior failures', () => {
  const md = contextBundle({
    rel: 'src/Button.tsx',
    importers: ['src/pages/Home.jsx', 'src/pages/About.jsx'],
    importsOf: ['src/util.ts'],
    hunks: ['+ const x = 1'],
    failures: [{ tool: 'Edit', text: 'String to replace not found' }],
  })
  assert.match(md, /2 file\(s\) import this/)
  assert.match(md, /src\/pages\/Home\.jsx/)
  assert.match(md, /do not repeat these/)
  assert.match(md, /String to replace not found/)
  assert.match(md, /```diff/)
})

test('contextBundle warns rather than reassures when nothing imports the file', () => {
  const md = contextBundle({ rel: 'src/Orphan.tsx', importers: [], importsOf: [], hunks: [], failures: [] })
  assert.match(md, /nothing in this repo imports it/i)
  assert.match(md, /Verify it is an entry point/i, 'must not imply "safe to delete"')
})
