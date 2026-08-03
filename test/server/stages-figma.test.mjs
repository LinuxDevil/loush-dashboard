// The figma stage's risk is all in what it does NOT do: not fetch the 2.4M-char tree, not render 24
// screens, not throw when the token is missing, not print resolved comment noise. Every one of those
// is invisible in a passing run against a real file — a bloated dossier and a complete one look the
// same until an agent stage is handed one. So the network is stubbed and the bounds are asserted.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { figma } from '../../server/stages/figma.mjs'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'figma-stage-'))

/** The upstream half: `links.json` in the repo half, located through `artifacts[0]` exactly as `stageLinks` writes it. */
function ctxFor({ urls = ['https://figma.com/design/FILE123/Flow?node-id=1-2'], linksStatus = 'ok' } = {}) {
  const repoDir = tmp(), cacheDir = tmp()
  fs.mkdirSync(path.join(repoDir, 'docs', 'ABC-1'), { recursive: true })
  fs.writeFileSync(path.join(repoDir, 'docs', 'ABC-1', 'links.json'), JSON.stringify({ figma: urls, discovered: [] }))
  return {
    repoDir, cacheDir, key: 'ABC-1', cfg: {},
    manifest: { stages: { links: { stage: 'links', status: linksStatus, reason: 'x', artifacts: ['docs/ABC-1/links.json'] } } },
  }
}

const doc = (ctx, name) => fs.readFileSync(path.join(ctx.repoDir, 'docs', 'ABC-1', name), 'utf8')

/** A page with `sections` sections of `perSection` frames each, and a deep subtree under every frame. */
function tree({ sections = 2, perSection = 3, deep = 40 } = {}) {
  const chain = (n, id) => n === 0 ? [] : [{ id: `${id}:${n}`, name: `deep-layer-${n}`, type: 'TEXT', children: chain(n - 1, id) }]
  const frames = s => Array.from({ length: perSection }, (_, i) => ({
    id: `f${s}-${i}`, name: 'Desktop', type: 'FRAME',
    absoluteBoundingBox: { width: 2800, height: 1600 }, children: chain(deep, `f${s}-${i}`),
  }))
  return {
    id: '1:2', name: 'Page 1', type: 'CANVAS',
    children: Array.from({ length: sections }, (_, s) => ({
      id: `s${s}`, name: `Section ${s}`, type: 'SECTION',
      absoluteBoundingBox: { width: 9000, height: 5000 }, children: frames(s),
    })),
  }
}

/**
 * A fake Figma. `depth=2` is honoured for real, so a stage that ignored it would still see the deep
 * tree — the test would pass for the wrong reason otherwise.
 */
function fakeFigma({ root = tree(), comments = [], fail = {} } = {}) {
  const calls = []
  const cut = (n, d) => d <= 0 ? { ...n, children: undefined } : { ...n, children: (n.children || []).map(c => cut(c, d - 1)) }
  const find = (n, id) => n.id === id ? n : (n.children || []).reduce((a, c) => a || find(c, id), null)
  const json = body => ({ ok: true, status: 200, json: async () => body })
  const fetch = async (url) => {
    calls.push(url)
    const u = new URL(url)
    if (u.hostname === 'img') return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('PNG').buffer }
    for (const [frag, res] of Object.entries(fail)) if (url.includes(frag)) return { ok: false, status: res, json: async () => ({ err: 'nope' }) }
    const depth = Number(u.searchParams.get('depth') || 99)
    if (u.pathname.endsWith('/comments')) return json({ comments })
    if (u.pathname.includes('/nodes')) {
      const nodes = {}
      for (const id of u.searchParams.get('ids').split(',')) {
        const n = id === '1:2' ? root : find(root, id)
        if (n) nodes[id] = { document: cut(n, depth) }
      }
      return json({ nodes })
    }
    if (u.pathname.startsWith('/v1/images/')) {
      return json({ images: Object.fromEntries(u.searchParams.get('ids').split(',').map(id => [id, 'https://img/' + id])) })
    }
    return json({ document: cut({ id: '0:0', name: 'Doc', type: 'DOCUMENT', children: [root] }, depth) })
  }
  return { fetch, calls }
}

test('depth-2 pruning bounds the outline — the deep tree never reaches disk', async () => {
  const ctx = ctxFor()
  const { fetch, calls } = fakeFigma({ root: tree({ sections: 2, perSection: 3, deep: 60 }) })
  const e = await figma(ctx, { token: 't', fetch })

  assert.equal(e.status, 'ok', e.reason)
  const outline = doc(ctx, 'figma-outline.md')
  assert.ok(outline.length < 4000, `outline should stay tiny, got ${outline.length} chars`)
  assert.ok(!outline.includes('deep-layer'), 'depth-3+ node names must not appear in the outline')
  assert.match(outline, /Section 0 \(SECTION/)
  // The metadata call must ask the API to prune; pruning after the download is the 2.4M-char mistake.
  assert.ok(calls.some(c => c.includes('/nodes') && c.includes('depth=2')), calls.join('\n'))

  const cached = fs.readdirSync(ctx.cacheDir)
  assert.ok(cached.some(f => f.endsWith('-meta.json')), cached.join())
  assert.ok(!JSON.stringify(JSON.parse(fs.readFileSync(path.join(ctx.cacheDir, cached.find(f => f.endsWith('-meta.json'))), 'utf8'))).includes('deep-layer'))
})

test('the zoom ladder renders section overviews then per-frame, and PNGs stay in the cache half', async () => {
  const ctx = ctxFor()
  const { fetch, calls } = fakeFigma({ root: tree({ sections: 2, perSection: 2 }) })
  const e = await figma(ctx, { token: 't', fetch })

  assert.equal(e.provenance.renders, 6)              // 2 section overviews + 4 frames
  assert.equal(fs.readdirSync(ctx.cacheDir).filter(f => f.endsWith('.png')).length, 6)
  assert.deepEqual(e.artifacts, ['docs/ABC-1/figma-outline.md', 'docs/ABC-1/figma-comments.md'])
  // 1400/2800 for a frame, 2000/9000 for a section — the ladder, not one flat scale.
  const scales = new Set(calls.filter(c => c.includes('/images/')).map(c => new URL(c).searchParams.get('scale')))
  assert.deepEqual([...scales].sort(), ['0.22', '0.5'])
})

test('a capped render count records what was dropped instead of truncating silently', async () => {
  const ctx = ctxFor()
  const { fetch } = fakeFigma({ root: tree({ sections: 4, perSection: 6 }) })   // 4 + 24 = 28 wanted, cap 12
  const e = await figma(ctx, { token: 't', fetch })

  assert.equal(e.status, 'ok')
  assert.equal(e.provenance.renders, 12)
  assert.equal(e.provenance.dropped.length, 16)
  assert.match(e.reason, /16 item\(s\) not fetched \(render cap 12\)/)
  assert.match(doc(ctx, 'figma-outline.md'), /## Not rendered/)
})

test('dev-mode annotations are reported unavailable with a reason, and never chased over the network', async () => {
  const ctx = ctxFor()
  const { fetch, calls } = fakeFigma()
  const e = await figma(ctx, { token: 't', fetch })

  assert.equal(e.provenance.devModeAnnotations.status, 'unavailable')
  assert.match(e.provenance.devModeAnnotations.reason, /not exposed by the Figma REST API/)
  assert.match(doc(ctx, 'figma-outline.md'), /Dev-mode annotations: \*\*unavailable\*\*/)
  assert.ok(!calls.some(c => /annotation/i.test(c)), 'no annotation endpoint should be probed')
})

test('a missing token is a non-ok entry, not a throw — and costs no request', async () => {
  const ctx = ctxFor()
  const { fetch, calls } = fakeFigma()
  const e = await figma(ctx, { token: '', fetch })

  assert.equal(e.status, 'unavailable')
  assert.match(e.reason, /no Figma API token/)
  assert.deepEqual(calls, [])
})

test('a token the API rejects is unavailable, not a throw', async () => {
  const ctx = ctxFor()
  const { fetch } = fakeFigma({ fail: { '/nodes': 403 } })
  const e = await figma(ctx, { token: 'bad', fetch })

  assert.equal(e.status, 'unavailable')
  assert.match(e.reason, /Figma metadata for FILE123: nope/)
})

test('no Figma link, and an upstream that did not succeed, both come back as entries', async () => {
  const none = await figma(ctxFor({ urls: [] }), { token: 't', fetch: () => { throw new Error('should not fetch') } })
  assert.equal(none.status, 'unavailable')
  assert.match(none.reason, /links no Figma file/)

  const up = await figma(ctxFor({ linksStatus: 'failed' }), { token: 't', fetch: () => { throw new Error('should not fetch') } })
  assert.equal(up.status, 'skipped')
  assert.match(up.reason, /the `links` stage is "failed"/)   // names the upstream, per spec §3
})

test('`links` leaves Figma uncapped, so this stage caps files itself and records the overflow', async () => {
  const ctx = ctxFor({ urls: ['https://figma.com/design/A/One', 'https://figma.com/design/B/Two', 'https://figma.com/design/C/Three'] })
  const e = await figma(ctx, { token: 't', fetch: fakeFigma({ root: tree({ sections: 1, perSection: 1 }) }).fetch })

  assert.deepEqual(e.provenance.files, ['A', 'B'])
  assert.deepEqual(e.provenance.discovered, [{ kind: 'figma', ref: 'https://figma.com/design/C/Three', why: "over this stage's cap of 2 Figma file(s) — linked from the ticket but not fetched" }])
  assert.match(e.reason, /1 linked Figma file\(s\) over the cap of 2/)
})

test('a non-git workspace carries tracked: false through to the entry', async () => {
  const ctx = ctxFor()
  ctx.manifest.tracked = false
  const e = await figma(ctx, { token: 't', fetch: fakeFigma().fetch })
  assert.equal(e.tracked, false)
})

test('comments thread by parent_id and resolved threads are filtered out', async () => {
  const comments = [
    { id: 'c1', message: 'top open', user: { handle: 'ada' }, client_meta: { node_id: 'f0-0' }, created_at: '2026-01-01' },
    { id: 'c2', message: 'a reply', user: { handle: 'bob' }, parent_id: 'c1' },
    { id: 'c3', message: 'second reply', user: { handle: 'cy' }, parent_id: 'c1' },
    { id: 'c4', message: 'settled already', user: { handle: 'dee' }, resolved_at: '2026-02-02' },
    { id: 'c5', message: 'reply under resolved', user: { handle: 'eve' }, parent_id: 'c4' },
  ]
  const ctx = ctxFor()
  const e = await figma(ctx, { token: 't', fetch: fakeFigma({ comments }).fetch })
  const md = doc(ctx, 'figma-comments.md')

  assert.match(md, /5 comments · 2 threads · 1 resolved \(omitted\) · 1\/1 open threads node-anchored/)
  assert.match(md, /## ada @f0-0/)
  assert.match(md, /> \*\*bob\*\*: a reply/)
  assert.match(md, /> \*\*cy\*\*: second reply/)
  assert.ok(!md.includes('settled already') && !md.includes('reply under resolved'), 'resolved threads are noise resolved_at exists to filter')
  assert.equal(e.provenance.comments, 5)
})

test('unfetchable comments degrade the digest, not the whole stage', async () => {
  const ctx = ctxFor()
  const e = await figma(ctx, { token: 't', fetch: fakeFigma({ fail: { '/comments': 500 } }).fetch })

  assert.equal(e.status, 'ok')
  assert.match(e.reason, /comments for FILE123 could not be fetched: nope/)
  assert.deepEqual(e.artifacts, ['docs/ABC-1/figma-outline.md'])
})
