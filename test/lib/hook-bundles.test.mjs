// test/lib/hook-bundles.test.mjs — 112. Pure: no fs. The settings objects here are the exact
// shape server/index.mjs:344 reads and :356 writes.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BUNDLES, HOOK_EVENTS, TOOL_EVENTS, PROVENANCE_KEY,
  listBundles, getBundle, validateBundle, matcherFor, toSettingsEntry,
  planInstall, installBundle, uninstallBundle, installedBundles,
} from '../../lib/hook-bundles.mjs'

const ids = ['code-quality', 'security', 'notifications', 'performance']

test('exactly the four preset bundles ship, declared as data', () => {
  assert.deepEqual(Object.keys(BUNDLES).sort(), [...ids].sort())
  const l = listBundles()
  assert.equal(l.length, 4)
  for (const b of l) { assert.ok(b.hooks > 0); assert.ok(b.events.every(e => HOOK_EVENTS.includes(e))) }
  // JSON-declarable: no functions, no undefined.
  assert.deepEqual(JSON.parse(JSON.stringify(BUNDLES)), JSON.parse(JSON.stringify(BUNDLES)))
})

test('an unknown bundle id is rejected BY NAME with the allowed set', () => {
  const r = getBundle('code-qualty')
  assert.equal(r.ok, false)
  assert.match(r.reason, /"code-qualty" is not a known bundle/)
  assert.deepEqual(r.allowed.sort(), [...ids].sort())
  assert.equal(getBundle(7).ok, false)     // never throws
  assert.equal(getBundle(null).ok, false)
  assert.equal(getBundle('security').ok, true)
})

test('every shipped bundle validates against the real hook-config shape', () => {
  for (const id of ids) {
    const v = validateBundle(BUNDLES[id])
    assert.equal(v.ok, true, `${id}: ${JSON.stringify(v.errors)}`)
  }
})

test('HOOK BODIES ARE CROSS-PLATFORM NODE — no sh, no shell-only syntax', () => {
  for (const id of ids) for (const h of BUNDLES[id].hooks) {
    assert.ok(h.command.startsWith('node -e "'), `${h.id} must be node -e, not a shell script`)
    assert.ok(!/^\s*(sh|bash|zsh)\s+-c/.test(h.command), `${h.id} shells out`)
    assert.ok(!h.command.includes('`'), `${h.id} contains a backtick (sh substitutes it, cmd does not)`)
    assert.ok(!h.command.includes('$('), `${h.id} contains $( )`)
    assert.ok(!/%[A-Za-z_]/.test(h.command), `${h.id} contains %VAR (cmd expands it)`)
    assert.ok(!/\$[A-Za-z_]/.test(h.command), `${h.id} contains $VAR (sh expands it)`)
  }
})

test('a shell-script hook is REJECTED by validateBundle, naming the failure mode', () => {
  // This is the shape server/index.mjs:3686 ships today for `require-tests-before-stop`.
  const bad = { id: 'x', hooks: [{ id: 'x/y', event: 'Stop', filters: { tools: null, reason: 'no tool' }, timeout: 10, command: `sh -c 'git diff --name-only HEAD | grep test'` }] }
  const v = validateBundle(bad)
  assert.equal(v.ok, false)
  const e = v.errors.find(x => x.field === 'hooks[x/y].command')
  assert.match(e.reason, /not cross-platform/)
  assert.match(e.reason, /silent no-op/)
})

test('validateBundle never throws and names each bad field', () => {
  for (const junk of [null, undefined, 'a string', 42, []]) assert.equal(validateBundle(junk).ok, false)
  const v = validateBundle({ id: 'b', hooks: [{ id: 'b/1', event: 'OnVibes', filters: { tools: ['Read'] }, timeout: 0, command: 'node -e "0"' }] })
  assert.equal(v.ok, false)
  const ev = v.errors.find(e => e.field === 'hooks[b/1].event')
  assert.match(ev.reason, /"OnVibes" is not a hook event/)
  assert.deepEqual(ev.allowed, HOOK_EVENTS)
  assert.ok(v.errors.some(e => e.field === 'hooks[b/1].timeout'))
})

test('filters.tools scopes the matcher; a non-tool event must use null WITH a reason', () => {
  const preTool = BUNDLES.security.hooks.find(h => h.id === 'security/protected-path')
  assert.deepEqual(preTool.filters.tools, ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
  assert.equal(matcherFor(preTool), 'Write|Edit|MultiEdit|NotebookEdit')
  assert.deepEqual(toSettingsEntry(preTool), { matcher: 'Write|Edit|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: preTool.command, timeout: preTool.timeout }] })

  const stop = BUNDLES['code-quality'].hooks.find(h => h.event === 'Stop')
  assert.equal(stop.filters.tools, null)
  assert.match(stop.filters.reason, /no tool_name/)
  assert.equal(matcherFor(stop), '')

  // A tool filter on a non-tool event is an error, not a silently-dead filter.
  const v = validateBundle({ id: 'b', hooks: [{ id: 'b/1', event: 'Stop', filters: { tools: ['Bash'] }, timeout: 5, command: 'node -e "0"' }] })
  assert.equal(v.ok, false)
  assert.match(v.errors.find(e => e.field === 'hooks[b/1].filters.tools').reason, /could never match/)
  assert.deepEqual(v.errors.find(e => e.field === 'hooks[b/1].filters.tools').allowed, TOOL_EVENTS)

  // null with no reason is also an error: "no filter" must be distinguishable from "forgot".
  assert.equal(validateBundle({ id: 'b', hooks: [{ id: 'b/1', event: 'Stop', filters: { tools: null }, timeout: 5, command: 'node -e "0"' }] }).ok, false)
})

test('installing into empty settings produces the exact shape server/index.mjs reads', () => {
  const r = installBundle({}, 'security')
  assert.equal(r.ok, true)
  const entry = r.settings.hooks.PreToolUse.find(e => e.matcher === 'Bash')
  assert.equal(entry.hooks[0].type, 'command')
  assert.equal(typeof entry.hooks[0].timeout, 'number')
  assert.equal(r.installed.length, BUNDLES.security.hooks.length)
  assert.equal(installBundle([], 'security').ok, false)   // never throws on junk settings
})

test('A CONFLICT IS NAMED and blocks the install until intent is given', () => {
  const existing = {
    hooks: {
      PreToolUse: [{ matcher: 'Write|Edit|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: 'node -e "console.log(1)"', timeout: 5 }] }],
    },
  }
  const plan = planInstall(existing, 'security')
  assert.equal(plan.ok, false)
  assert.equal(plan.requiresIntent, true)
  assert.match(plan.reason, /pass \{overwrite:true\} to confirm/)
  assert.equal(plan.conflicts.length, 1)

  const c = plan.conflicts[0]
  assert.equal(c.hookId, 'security/protected-path')                    // which incoming hook
  assert.equal(c.event, 'PreToolUse')
  assert.equal(c.matcher, 'Write|Edit|MultiEdit|NotebookEdit')
  assert.deepEqual(c.existing.commands, ['node -e "console.log(1)"'])  // which EXISTING hook is at risk
  assert.match(c.reason, /would be REPLACED/)

  // Without intent, nothing is written.
  const blocked = installBundle(existing, 'security')
  assert.equal(blocked.ok, false)
  assert.equal(blocked.conflicts.length, 1)
  assert.deepEqual(existing.hooks.PreToolUse[0].hooks[0].command, 'node -e "console.log(1)"')
})

test('overwrite replaces only the conflicting slot AND preserves what it replaced', () => {
  const existing = { hooks: { PreToolUse: [{ matcher: 'Write|Edit|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: 'node -e "console.log(1)"', timeout: 5 }] }] } }
  const r = installBundle(existing, 'security', { overwrite: true, now: 111 })
  assert.equal(r.ok, true)
  const slot = r.settings.hooks.PreToolUse.find(e => e.matcher === 'Write|Edit|MultiEdit|NotebookEdit')
  assert.notEqual(slot.hooks[0].command, 'node -e "console.log(1)"')
  const rec = r.settings[PROVENANCE_KEY].security
  assert.equal(rec.replaced.length, 1)
  assert.deepEqual(rec.replaced[0].previousCommands, ['node -e "console.log(1)"'])
  // input object untouched — planning and installing are pure
  assert.equal(existing.hooks.PreToolUse[0].hooks[0].command, 'node -e "console.log(1)"')
})

test('an already-present identical hook is a no-op, reported as such — not a conflict', () => {
  const once = installBundle({}, 'performance')
  const twice = planInstall(once.settings, 'performance')
  assert.equal(twice.ok, true)
  assert.equal(twice.conflicts.length, 0)
  assert.equal(twice.already.length, BUNDLES.performance.hooks.length)
  assert.equal(twice.willAdd.length, 0)
})

test('a coexisting overlapping matcher is REPORTED but does not block', () => {
  const existing = { hooks: { PreToolUse: [{ matcher: 'Bash|Read', hooks: [{ type: 'command', command: 'node -e "0"', timeout: 5 }] }] } }
  const plan = planInstall(existing, 'security')
  assert.equal(plan.ok, true, 'different matcher string = not a replacement')
  const co = plan.coexisting.find(c => c.hookId === 'security/curl-pipe-shell')
  assert.ok(co, 'the user must be told two Bash gates will now both fire')
  assert.deepEqual(co.withMatchers, ['Bash|Read'])
  assert.match(co.reason, /both hooks will fire/)
})

test('uninstall removes exactly what was installed and nothing else', () => {
  const mine = { hooks: { PreToolUse: [{ matcher: 'Task', hooks: [{ type: 'command', command: 'node -e "mine"', timeout: 5 }] }] } }
  const after = installBundle(mine, 'security', { now: 1 }).settings
  const un = uninstallBundle(after, 'security')
  assert.equal(un.ok, true)
  assert.equal(un.removed.length, BUNDLES.security.hooks.length)
  // the user's own hook is still there, byte-identical
  assert.deepEqual(un.settings.hooks.PreToolUse, [{ matcher: 'Task', hooks: [{ type: 'command', command: 'node -e "mine"', timeout: 5 }] }])
  assert.equal(un.settings[PROVENANCE_KEY], undefined)
})

test('uninstall LEAVES a hook the user edited after install, and says so', () => {
  const after = installBundle({}, 'performance', { now: 1 }).settings
  const slot = after.hooks.PostToolUse.find(e => e.matcher === 'Read')
  slot.hooks[0].command = 'node -e "my own version"'
  const un = uninstallBundle(after, 'performance')
  assert.equal(un.ok, true)
  assert.equal(un.keptModified.length, 1)
  assert.equal(un.keptModified[0].hookId, 'performance/cap-read-result')
  assert.match(un.keptModified[0].reason, /it was edited, so it is left in place/)
  assert.match(un.note, /LEFT IN PLACE/)
  assert.ok(un.settings.hooks.PostToolUse.some(e => e.hooks[0].command === 'node -e "my own version"'))
})

test('uninstall refuses when there is no provenance rather than guessing by shape', () => {
  const handmade = { hooks: { PreToolUse: [{ matcher: 'Write|Edit', hooks: [{ type: 'command', command: BUNDLES.security.hooks[1].command, timeout: 10 }] }] } }
  const un = uninstallBundle(handmade, 'security')
  assert.equal(un.ok, false)
  assert.match(un.reason, /no install record/)
  assert.match(un.reason, /nothing can be safely removed/)
  assert.equal(uninstallBundle(null, 'security').ok, false)
})

test('installedBundles distinguishes "nothing installed" from "cannot tell"', () => {
  const none = installedBundles({ hooks: {} })
  assert.deepEqual(none.bundles, [])
  assert.match(none.note, /NOT distinguishable/)
  const some = installedBundles(installBundle({}, 'notifications', { now: 9 }).settings)
  assert.deepEqual(some.bundles, [{ id: 'notifications', installedAt: 9, entries: 2 }])
})

test('every plan accounts for every hook in the bundle — no silent drops', () => {
  for (const id of ids) {
    const plan = planInstall({}, id)
    const seen = plan.willAdd.length + plan.already.length + plan.conflicts.length
    assert.equal(seen, BUNDLES[id].hooks.length, id)
    assert.match(plan.limits.note, /no cap/)
  }
})
