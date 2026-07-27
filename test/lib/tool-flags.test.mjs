// Tests for the org-specific tool-bundle flag (projects.json -> Company_Tools).
//
// The Constitution reader and Figma Capture were deleted wholesale because they are useless outside
// the org whose repo layout they assume. That was half right: for that org they are load-bearing.
// The flag is the middle ground, so its semantics need pinning — particularly the default, because
// a feature flag that defaults ON is how someone else's tools ended up in everyone's sidebar.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeToolFlag, toolFlagAllows, parseEngConfig, normalizeDesignSystem } from '../../lib/eng-config.mjs'

test('an absent flag is OFF — org-specific tools must never be the default', () => {
  assert.deepEqual(normalizeToolFlag(undefined), { enabled: false, emails: [] })
  assert.deepEqual(normalizeToolFlag(null), { enabled: false, emails: [] })
  assert.equal(parseEngConfig({}).companyTools.enabled, false)
  assert.equal(parseEngConfig(null).companyTools.enabled, false)
})

test('the shorthand `true` enables it for anyone running the dashboard', () => {
  assert.deepEqual(normalizeToolFlag(true), { enabled: true, emails: [] })
  assert.equal(toolFlagAllows(true, null), true)
  assert.equal(toolFlagAllows(true, 'anyone@example.com'), true)
})

test('the object form requires enabled to be explicitly true', () => {
  assert.equal(normalizeToolFlag({ enabled: true }).enabled, true)
  assert.equal(normalizeToolFlag({ enabled: false }).enabled, false)
  assert.equal(normalizeToolFlag({}).enabled, false)
  assert.equal(normalizeToolFlag({ enabled: 'yes' }).enabled, false, 'a truthy string is not true')
  assert.equal(normalizeToolFlag({ enabled: 1 }).enabled, false)
})

test('an email allowlist gates on identity, case- and whitespace-insensitively', () => {
  const flag = { enabled: true, emails: ['  You@Example.COM ', 'other@example.com'] }
  assert.equal(toolFlagAllows(flag, 'you@example.com'), true)
  assert.equal(toolFlagAllows(flag, '  YOU@EXAMPLE.com  '), true)
  assert.equal(toolFlagAllows(flag, 'stranger@example.com'), false)
})

test('with an allowlist set, an unknown identity is refused — including a blank one', () => {
  const flag = { enabled: true, emails: ['you@example.com'] }
  for (const id of [null, undefined, '', '   ']) assert.equal(toolFlagAllows(flag, id), false, `identity ${JSON.stringify(id)}`)
})

test('an empty allowlist means "no identity restriction", not "nobody"', () => {
  assert.equal(toolFlagAllows({ enabled: true, emails: [] }, null), true)
  assert.equal(toolFlagAllows({ enabled: true }, null), true)
})

test('disabled beats any allowlist match', () => {
  assert.equal(toolFlagAllows({ enabled: false, emails: ['you@example.com'] }, 'you@example.com'), false)
})

test('garbage in the config does not throw and does not enable anything', () => {
  for (const junk of ['true', 1, [], 0, 'enabled']) {
    assert.equal(normalizeToolFlag(junk).enabled, false, `normalizeToolFlag(${JSON.stringify(junk)})`)
    assert.equal(toolFlagAllows(junk, 'you@example.com'), false)
  }
})

test('parseEngConfig carries the flag through both accepted shapes', () => {
  assert.equal(parseEngConfig({ Company_Tools: true }).companyTools.enabled, true)
  const withList = parseEngConfig({ Company_Tools: { enabled: true, emails: ['A@b.com'] } }).companyTools
  assert.equal(withList.enabled, true)
  assert.deepEqual(withList.emails, ['a@b.com'])
})

test('Company_Tools is the canonical key, with camelCase spellings tolerated', () => {
  // A hand-edited config file that silently ignores a key is indistinguishable from a broken feature.
  assert.equal(parseEngConfig({ Company_Tools: true }).companyTools.enabled, true)
  assert.equal(parseEngConfig({ companyTools: true }).companyTools.enabled, true)
  assert.equal(parseEngConfig({ company_tools: true }).companyTools.enabled, true)
  // and the canonical key wins if somehow both are present
  assert.equal(parseEngConfig({ Company_Tools: false, companyTools: true }).companyTools.enabled, false)
})

test('the pre-rename Almosafer_Tools key still works, but Company_Tools wins', () => {
  // Renaming the key must not silently disable the bundle for anyone who already had it on: an
  // existing config would otherwise parse clean and just stop mounting the routes.
  assert.equal(parseEngConfig({ Almosafer_Tools: true }).companyTools.enabled, true)
  assert.equal(parseEngConfig({ almosaferTools: true }).companyTools.enabled, true)
  assert.equal(parseEngConfig({ almosafer_tools: true }).companyTools.enabled, true)
  // the new name is authoritative when both are on disk, so a stale key cannot override a fresh save
  assert.equal(parseEngConfig({ Company_Tools: false, Almosafer_Tools: true }).companyTools.enabled, false)
})

test('designSystem accepts a package, a storybook URL, or a bare string', () => {
  assert.equal(parseEngConfig({}).designSystem, null)
  assert.deepEqual(normalizeDesignSystem('@org/ds'), { package: '@org/ds', storybook: null })
  assert.deepEqual(normalizeDesignSystem({ package: '@org/ds' }), { package: '@org/ds', storybook: null })
  assert.deepEqual(normalizeDesignSystem({ storybook: 'https://x.io/ds/' }), { package: null, storybook: 'https://x.io/ds/' })
  // blank-but-present is "unset", not a source that will fail at extraction time
  for (const junk of [null, undefined, '', '   ', {}, { package: '' }, 42, []]) {
    assert.equal(normalizeDesignSystem(junk), null, `normalizeDesignSystem(${JSON.stringify(junk)})`)
  }
})
