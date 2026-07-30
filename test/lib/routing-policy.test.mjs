// test/lib/routing-policy.test.mjs — 113. Pure: no fs beyond one source read, no express, no React.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  MODEL_TIERS, COMPLEXITY_LEVELS, AGENT_TYPES, RULES, DEFAULT_ROUTE, CLASSIFIER_CONTRACT,
  route, routeAll, validateRules, checkShadowing, ruleMatches, normalizeComplexity, modelledCostEffect,
} from '../../lib/routing-policy.mjs'

/** Stand-in for lib/complexity.mjs, which reports a TIER per prompt. */
const tierClassifier = tier => () => tier
const levelClassifier = level => () => ({ level, reason: `stub said ${level}` })

// ---------------------------------------------------------------- the classifier is injected, not copied
test('this module carries NO classifier of its own — it takes one as a dependency', () => {
  const src = fs.readFileSync(new URL('../../lib/routing-policy.mjs', import.meta.url), 'utf8')
  assert.equal(/from '\.\/complexity\.mjs'/.test(src), false, 'must not import a path it cannot verify')
  assert.equal(/const SIGNALS\b|function classifyComplexity\b/.test(src), false, 'a second signal table here would be a second classifier')
  assert.ok(CLASSIFIER_CONTRACT.accepts && CLASSIFIER_CONTRACT.returns.length, 'the contract is published, so a caller can satisfy it')
  assert.match(CLASSIFIER_CONTRACT.tierToLevel, /positional|assumption/)
})

test('WITH NO CLASSIFIER the override does not run, and the route says exactly that', () => {
  const r = route('root cause the intermittent deadlock')
  assert.equal(r.complexity.level, null)
  assert.equal(r.complexity.source, 'none')
  assert.equal(r.override.applied, false)
  assert.equal(r.override.classifier, 'absent')
  assert.match(r.override.reason, /no complexity classifier was injected/)
  assert.match(r.override.reason, /not treated as simple/)
  assert.equal(r.model, 'opus', 'the table tier stands, unadjusted')
})

test('normalizeComplexity accepts every shape in the contract and rejects the rest BY NAME', () => {
  assert.equal(normalizeComplexity('complex').level, 'complex')
  assert.equal(normalizeComplexity({ level: 'trivial' }).level, 'trivial')
  assert.equal(normalizeComplexity({ complexity: 'moderate' }).level, 'moderate')
  assert.equal(normalizeComplexity({ tier: 'opus' }).level, 'complex')
  assert.equal(normalizeComplexity({ model: 'haiku' }).level, 'trivial')
  assert.equal(normalizeComplexity('sonnet').level, 'moderate')

  const bad = normalizeComplexity('spicy')
  assert.equal(bad.level, null)
  assert.match(bad.reason, /"spicy" is neither a complexity level nor a model tier/)
  assert.deepEqual(bad.allowed, { levels: [...COMPLEXITY_LEVELS], tiers: [...MODEL_TIERS] })

  for (const junk of [null, undefined, 42, [], {}]) assert.equal(normalizeComplexity(junk).level, null)
  assert.match(normalizeComplexity(null).reason, /CLASSIFIER_CONTRACT/)
})

test('reading a TIER as a LEVEL is surfaced as an assumption, not buried', () => {
  const n = normalizeComplexity('opus')
  assert.match(n.assumption, /read as complexity/)
  assert.match(n.assumption, /Nobody verified/)
  const r = route('refactor the parser', { classifier: tierClassifier('opus') })
  assert.match(r.override.assumption, /read as complexity/)
  // a level-shaped classifier makes no such assumption
  assert.equal(route('refactor the parser', { classifier: levelClassifier('complex') }).override.assumption, undefined)
})

test('a classifier that THROWS is reported as "not classified", never as simple', () => {
  const r = route('rename a typo', { classifier: () => { throw new Error('boom') } })
  assert.equal(r.complexity.level, null)
  assert.equal(r.override.applied, false)
  assert.match(r.override.reason, /threw \(boom\)/)
  assert.match(r.override.reason, /never as "simple"/)
  assert.equal(r.model, 'haiku', 'the table tier is untouched')
})

test('a classifier returning something unrecognised does not silently become "moderate"', () => {
  const r = route('refactor the parser', { classifier: () => ({ level: 'medium-ish' }) })
  assert.equal(r.complexity.level, null)
  assert.equal(r.override.applied, false)
  assert.match(r.override.reason, /"medium-ish" is neither/)
})

// ---------------------------------------------------------------- the table
test('the shipped rule table validates; unknown enums are rejected by name', () => {
  assert.equal(validateRules().ok, true)
  const v = validateRules([{ id: 'r', keywords: ['x'], agent: 'wizard', model: 'gpt-9' }])
  assert.equal(v.ok, false)
  const m = v.errors.find(e => e.field === 'rules[0].model')
  assert.match(m.reason, /"gpt-9" is not a model tier/)
  assert.deepEqual(m.allowed, MODEL_TIERS)
  const a = v.errors.find(e => e.field === 'rules[0].agent')
  assert.match(a.reason, /"wizard" is not a known agent type/)
  assert.deepEqual(a.allowed, AGENT_TYPES)

  assert.equal(validateRules('nope').ok, false)                                    // never throws
  assert.equal(validateRules([{ id: 'a', keywords: [], agent: 'explorer', model: 'haiku' }]).ok, false)
  assert.match(validateRules([{ id: 'a', keywords: ['x'], agent: 'explorer', model: 'haiku' }, { id: 'a', keywords: ['y'], agent: 'explorer', model: 'haiku' }]).errors[0].reason, /duplicate rule id/)
})

test('a signal matching no rule falls through to the EXPLICIT default, and says so', () => {
  const r = route('please water the office plants', { classifier: levelClassifier('moderate') })
  assert.equal(r.matched, false)
  assert.equal(r.ruleId, null)
  assert.equal(r.isDefault, true)
  assert.equal(r.agent, DEFAULT_ROUTE.agent)
  assert.match(r.reason, /NO RULE MATCHED/)
  assert.match(r.reason, /the table is missing a rule/)
})

test('an empty/absent task routes to the default and names that as the reason', () => {
  for (const junk of [null, undefined, '', 42]) {
    const r = route(junk, { classifier: levelClassifier('complex') })
    assert.equal(r.isDefault, true)
    assert.match(r.reason, /no task text to route/)
    assert.equal(r.complexity.level, null)
    assert.equal(r.override, null)
  }
})

test('routing matches and reports which rule and which keyword', () => {
  const r = route('please do a security review of the auth flow')
  assert.equal(r.ruleId, 'security-review')
  assert.equal(r.agent, 'security-reviewer')
  assert.ok(r.matchedKeyword)
  assert.match(r.reason, /matched rule "security-review"/)
  assert.equal(route('update the readme').ruleId, 'docs')
  assert.equal(route('where is the ticket route defined').agent, 'explorer')
})

// ---------------------------------------------------------------- shadowing
test('SHADOWING IS REPORTED — an unreachable rule is named with the rule that eats it', () => {
  const rules = [
    { id: 'broad-test', keywords: ['test'], agent: 'test-writer', model: 'sonnet' },
    { id: 'narrow-unit-test', keywords: ['unit test', 'test case'], agent: 'test-writer', model: 'haiku' },
  ]
  const s = checkShadowing(rules)
  assert.equal(s.ok, true)
  assert.equal(s.unreachable.length, 1)
  const u = s.unreachable[0]
  assert.equal(u.ruleId, 'narrow-unit-test')
  assert.deepEqual(u.shadowedBy, ['broad-test'])
  assert.match(u.reason, /UNREACHABLE/)
  assert.match(u.reason, /can never fire/)
  assert.match(s.note, /can never fire/)

  // route() agrees with the report: the shadowed rule really does never win.
  assert.equal(route('write a unit test', { rules }).ruleId, 'broad-test')
})

test('partial shadowing is reported separately — the row still fires, for less', () => {
  const rules = [
    { id: 'first', keywords: ['refactor'], agent: 'architect', model: 'sonnet' },
    { id: 'second', keywords: ['refactor the parser', 'rewrite the parser'], agent: 'architect', model: 'opus' },
  ]
  const s = checkShadowing(rules)
  assert.equal(s.unreachable.length, 0)
  assert.equal(s.partial.length, 1)
  assert.equal(s.partial[0].ruleId, 'second')
  assert.match(s.partial[0].reason, /PARTIALLY shadowed/)
  assert.match(s.partial[0].reason, /1 of 2 keywords/)
})

test('the SHIPPED table has no unreachable rows', () => {
  const s = checkShadowing()
  assert.deepEqual(s.unreachable, [], `shipped table has dead rules: ${JSON.stringify(s.unreachable)}`)
  assert.match(s.note, /every rule is reachable/)
  assert.equal(checkShadowing('nope').ok, false)     // never throws
})

test('a shadowed rule is still listed in the table, not silently deleted', () => {
  const rules = [
    { id: 'broad', keywords: ['test'], agent: 'test-writer', model: 'sonnet' },
    { id: 'dead', keywords: ['unit test'], agent: 'test-writer', model: 'haiku' },
  ]
  assert.equal(rules.length, 2)
  const s = checkShadowing(rules)
  assert.equal(s.unreachable.length, 1)
  assert.match(s.note, /still in the table/)
})

// ---------------------------------------------------------------- the override
test('complexity raises the tier for a complex task, and reports the change', () => {
  const r = route('refactor the locking across multiple modules', { classifier: levelClassifier('complex') })
  assert.equal(r.ruleId, 'refactor')
  assert.equal(r.complexity.source, 'injected-classifier')
  assert.equal(r.override.direction, 'up')
  assert.equal(r.override.applied, true)
  assert.equal(r.override.from, 'sonnet')
  assert.equal(r.model, 'opus')
  assert.ok(MODEL_TIERS.indexOf(r.model) > MODEL_TIERS.indexOf(r.override.from))
  assert.ok(r.override.because)
})

test('HOUSE RULE 2 — the tier clamp at the top is REPORTED, not silent', () => {
  const r = route('root cause the intermittent deadlock', { classifier: levelClassifier('complex') })
  assert.equal(r.model, 'opus')
  assert.match(r.override.clampedAt, /already at the top tier/)
})

test('a trivial task is downgraded only as far as the rule\'s minModel floor, which is reported', () => {
  // `code-review` is sonnet with a sonnet floor: the trivial downgrade wants haiku and is stopped.
  const r = route('code review this diff', { classifier: levelClassifier('trivial') })
  assert.equal(r.ruleId, 'code-review')
  assert.equal(r.override.direction, 'down')
  assert.equal(r.model, 'sonnet', 'the floor holds it at sonnet rather than letting it reach haiku')
  assert.equal(r.override.applied, false, 'floored to where it already was — reported as no change, not as a downgrade')
  assert.match(r.override.flooredAt, /minModel="sonnet"/)

  // where there is headroom above the floor, the downgrade happens and is reported.
  const d = route('a typo in the security review checklist', { classifier: levelClassifier('trivial') })
  assert.equal(d.ruleId, 'security-review')
  assert.equal(d.override.from, 'opus')
  assert.equal(d.model, 'sonnet')
  assert.equal(d.override.flooredAt, null)
})

test('a caller-supplied complexity is used, and its provenance is reported', () => {
  const r = route('update the readme', { complexity: 'complex' })
  assert.equal(r.complexity.source, 'caller-supplied')
  assert.equal(r.model, 'sonnet')          // haiku raised one tier
  const n = route('update the readme', { complexity: { level: null, reason: 'classifier unavailable' } })
  assert.equal(n.override.applied, false)
  assert.match(n.override.reason, /did NOT run/)
  assert.equal(n.model, 'haiku')
})

test('the override can be turned off, and says that is why it did nothing', () => {
  const r = route('root cause the deadlock', { classifier: levelClassifier('trivial'), applyComplexityOverride: false })
  assert.equal(r.override.applied, false)
  assert.match(r.override.reason, /disabled by the caller/)
  assert.equal(r.model, 'opus')
})

test('route refuses to run against an invalid table instead of routing anyway', () => {
  const r = route('anything', { rules: [{ id: 'x', keywords: ['anything'], agent: 'x', model: 'x' }] })
  assert.equal(r.ok, false)
  assert.match(r.reason, /refusing to route/)
  assert.ok(r.errors.length)
})

// ---------------------------------------------------------------- modelled, not predicted
test('routeAll reports both holes: unmatched rules AND unclassified tasks', () => {
  const r = routeAll(['update the readme', 'water the plants', 'code review this diff'])
  assert.equal(r.ok, true)
  assert.equal(r.unmatched, 1)
  assert.equal(r.unclassified, 3, 'no classifier was injected — every task is unclassified, and it says so')
  assert.match(r.note, /1\/3 task\(s\) hit the explicit default/)
  assert.match(r.note, /3\/3 task\(s\) were not classified/)
  assert.equal(routeAll('nope').ok, false)
})

test('the cost number carries modelled:true and an assumption string, and claims no saving', () => {
  const tasks = ['update the readme', 'root cause the intermittent deadlock', 'code review this diff']
  const m = modelledCostEffect(tasks, { haiku: 0.01, sonnet: 0.1, opus: 0.5 }, { classifier: levelClassifier('moderate') })
  assert.equal(m.ok, true)
  assert.equal(m.modelled, true)
  assert.equal(m.measured, false)
  assert.equal(m.is_prediction, false)
  assert.equal(typeof m.assumption, 'string')
  assert.match(m.assumption, /MODELLED, not observed/)
  assert.match(m.assumption, /nobody ran these 3 task\(s\)/)
  assert.match(m.assumption, /not a measurement of spend and not a forecast/)
  assert.ok(m.assumptions.some(a => /quality is equal/i.test(a)), 'the quality assumption must be stated')
  assert.ok(m.assumptions.some(a => /token volume/i.test(a)))
  assert.equal(typeof m.difference, 'number')
  // nothing anywhere in the payload claims a saving
  assert.equal(/\bsave[sd]?\b|\bsavings\b|\bcheaper\b/i.test(JSON.stringify(m)), false)
})

test('unclassified tasks are carried into the cost payload as a stated assumption', () => {
  const m = modelledCostEffect(['update the readme'], { haiku: 1, sonnet: 2, opus: 3 })
  assert.equal(m.unclassified, 1)
  assert.ok(m.assumptions.some(a => /no complexity classification/.test(a)))
})

test('modelledCostEffect ships NO prices and refuses to invent one', () => {
  assert.match(modelledCostEffect([], null).reason, /pricePerTask is required/)
  const r = modelledCostEffect([], { haiku: 0.01 })
  assert.equal(r.ok, false)
  assert.match(r.reason, /missing a finite value for: sonnet, opus/)
  assert.deepEqual(r.required, MODEL_TIERS)
  assert.equal(modelledCostEffect('nope', { haiku: 1, sonnet: 1, opus: 1 }).ok, false)
  assert.match(modelledCostEffect([], { haiku: 1, sonnet: 1, opus: 1 }, { baseline: 'gpt' }).reason, /is not a model tier/)
})

test('ruleMatches is a dumb auditable substring test, case-insensitively', () => {
  assert.equal(ruleMatches(RULES[0], 'a SECURITY REVIEW please'), true)
  assert.equal(ruleMatches(RULES[0], 'nothing relevant'), false)
})
