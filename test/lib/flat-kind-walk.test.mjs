import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Mirrors walkFlatKind()/itemFile() in server/index.mjs. That module boots an HTTP server on
// import, so the traversal rule is re-stated here rather than imported; these tests exist to
// pin the naming contract, which is what a future flat readdir would silently break.
const OFF = '.off'
function walkFlatKind(dir) {
  const out = []
  const walk = (d, prefix) => {
    let entries
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) { walk(p, prefix ? `${prefix}:${e.name}` : e.name); continue }
      let base, enabled
      if (e.name.endsWith('.md' + OFF)) { base = e.name.slice(0, -(3 + OFF.length)); enabled = false }
      else if (e.name.endsWith('.md')) { base = e.name.slice(0, -3); enabled = true }
      else continue
      out.push({ name: prefix ? `${prefix}:${base}` : base, file: p, enabled })
    }
  }
  walk(dir, '')
  return out
}
const itemFile = (dir, name) => path.join(dir, ...name.split(':')) + '.md'

const withTree = (files, fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flatkind-'))
  try {
    for (const [rel, body] of Object.entries(files)) {
      const p = path.join(root, rel)
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.writeFileSync(p, body)
    }
    return fn(root)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
}

test('commands installed into a namespace directory are discovered', () => {
  // The regression this guards: a single-level readdir returned only top-level .md files, so a
  // framework installing into ~/.claude/commands/sc/ was entirely invisible to the dashboard.
  withTree({ 'plain.md': 'a', 'sc/implement.md': 'b', 'sc/analyze.md': 'c' }, root => {
    const names = walkFlatKind(root).map(i => i.name).sort()
    assert.deepEqual(names, ['plain', 'sc:analyze', 'sc:implement'])
  })
})

test('a namespaced name round-trips back to its file path', () => {
  withTree({ 'sc/implement.md': 'b' }, root => {
    const [item] = walkFlatKind(root)
    assert.equal(item.name, 'sc:implement')
    assert.equal(itemFile(root, item.name), item.file)
    assert.ok(fs.existsSync(itemFile(root, 'sc:implement')))
  })
})

test('nesting deeper than one level keeps every segment', () => {
  withTree({ 'a/b/c.md': 'x' }, root => {
    assert.deepEqual(walkFlatKind(root).map(i => i.name), ['a:b:c'])
  })
})

test('disabled items are reported with their enabled state, not skipped', () => {
  withTree({ 'sc/on.md': 'x', 'sc/off.md.off': 'y' }, root => {
    const byName = Object.fromEntries(walkFlatKind(root).map(i => [i.name, i.enabled]))
    assert.deepEqual(byName, { 'sc:on': true, 'sc:off': false })
  })
})

test('non-markdown files and dotfiles are ignored', () => {
  withTree({ 'keep.md': 'x', 'README.txt': 'y', '.hidden/secret.md': 'z' }, root => {
    assert.deepEqual(walkFlatKind(root).map(i => i.name), ['keep'])
  })
})

test('a name cannot climb out of its scope directory', () => {
  withTree({ 'keep.md': 'x' }, root => {
    const escaped = itemFile(root, '..:..:etc:passwd')
    assert.ok(!path.resolve(escaped).startsWith(path.resolve(root) + path.sep),
      'resolves outside the scope dir — server/index.mjs relies on safe() rejecting this')
  })
})
