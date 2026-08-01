// Tests for lib/contracts.mjs — the schema/contract drift guard.
//
// Every test here pins an HONESTY property, not a happy path. The properties, in priority order:
//   1. Zero samples => "could-not-check". A boot check that passes when it checked nothing is the
//      single worst outcome this module can produce, so it gets the most tests.
//   2. A field absent from one sample is not proof of removal — every verdict carries its sample count.
//   3. Declared-optional absence is never drift.
//   4. Malformed input never throws.
// The final block runs against the REAL files on this machine and SKIPS with a reason when there are
// none; it must never pass vacuously.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  CONTRACT, REQ, hasPath, findTranscripts, checkTranscriptRecords, checkJsonDocs,
  checkAll, formatReport, readTranscriptSample, KNOWN_RECORD_TYPES,
} from '../../lib/contracts.mjs'

// A minimal record that satisfies every ALWAYS field for its type, so tests can subtract one field
// at a time and attribute the resulting drift unambiguously.
const turn = over => ({
  type: 'assistant', sessionId: 's1', uuid: 'u1', parentUuid: null,
  timestamp: '2026-07-30T00:00:00Z', cwd: '/repo', gitBranch: 'main', version: '1.0.0',
  isSidechain: false, userType: 'external', entrypoint: 'cli', requestId: 'r1', effort: 'high',
  message: {
    model: 'claude-opus-5', content: [], stop_reason: 'end_turn',
    usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4, service_tier: 'standard' },
  },
  ...over,
})

describe('zero samples must say "could not check", never "satisfied"', () => {
  test('checkTranscriptRecords([]) => ok:null, checked:false, and a reason', () => {
    const r = checkTranscriptRecords([])
    assert.equal(r.ok, null, 'ok must be null, not true and not false')
    assert.equal(r.checked, false)
    assert.equal(r.status, 'could-not-check')
    assert.ok(r.reason && r.reason.length > 0, 'a could-not-check must explain itself')
    assert.equal(r.recordsChecked, 0)
    assert.deepEqual(r.drifts, [], 'no samples means no drift claims either — silence, not an all-clear')
  })

  test('with zero samples EVERY declared field is could-not-check, none is "present"', () => {
    const r = checkTranscriptRecords([])
    assert.equal(r.fields.length, CONTRACT.transcriptJsonl.fields.length)
    for (const f of r.fields) {
      assert.equal(f.status, 'could-not-check', `${f.path} must not be judged from zero samples`)
      assert.equal(f.applicableSamples, 0)
      assert.equal(f.presentPct, null, 'a percentage over zero samples must be null, not 0 and not 100')
    }
  })

  test('checkJsonDocs with a missing file => could-not-check (this is the settings.json case)', () => {
    const r = checkJsonDocs('settingsJson', [], { reason: 'file does not exist' })
    assert.equal(r.ok, null)
    assert.equal(r.status, 'could-not-check')
    assert.match(r.reason, /does not exist/)
    assert.notEqual(r.status, 'ok')
  })

  test('checkAll against an EMPTY home reports could-not-check overall and does not claim a pass', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'contracts-empty-'))
    try {
      const r = checkAll({ home: tmp })
      assert.equal(r.ok, null, 'overall ok must be null when nothing was checked')
      assert.equal(r.status, 'could-not-check')
      assert.deepEqual(r.sourcesChecked, [])
      assert.equal(r.sourcesNotChecked.length, 3, 'all three declared sources must be listed as not checked')
      for (const s of r.sourcesNotChecked) assert.ok(s.reason, `${s.source} must say why it could not be checked`)
      const text = formatReport(r)
      assert.match(text, /COULD NOT CHECK/)
      assert.doesNotMatch(text, /contract satisfied/, 'the words "contract satisfied" must not appear when nothing was checked')
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })

  test('an existing-but-empty projects dir is still could-not-check, with the search described', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'contracts-emptyproj-'))
    try {
      fs.mkdirSync(path.join(tmp, '.claude', 'projects'), { recursive: true })
      const r = checkAll({ home: tmp })
      assert.equal(r.ok, null)
      assert.match(r.results.transcriptJsonl.reason, /no \.jsonl files/)
      assert.match(r.results.transcriptJsonl.reason, /recursively/, 'must state the search was recursive, or "none found" is not credible')
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })
})

describe('a verdict without a sample count is unactionable', () => {
  test('every field verdict carries presentIn AND applicableSamples', () => {
    const r = checkTranscriptRecords([turn(), turn({ uuid: 'u2' })].map(rec => ({ rec })))
    assert.equal(r.checked, true)
    for (const f of r.fields) {
      assert.equal(typeof f.presentIn, 'number')
      assert.equal(typeof f.applicableSamples, 'number')
      assert.ok(f.presentIn <= f.applicableSamples)
    }
  })

  test('drift entries quote the counts behind them', () => {
    const bad = turn(); delete bad.message.model
    const r = checkTranscriptRecords([{ rec: bad }, { rec: turn() }])
    const d = r.drifts.find(x => x.field === 'message.model')
    assert.ok(d, 'a required field present in 1 of 2 samples must raise drift')
    assert.equal(d.applicableSamples, 2)
    assert.equal(d.presentIn, 1)
    assert.match(d.message, /1 of 2/)
    assert.equal(r.fields.find(f => f.path === 'message.model').status, 'present-partial')
  })

  test('a required field read by this repo drifts at level "error"; one nobody reads at "warn"', () => {
    const noModel = turn(); delete noModel.message.model
    const noEffort = turn(); delete noEffort.effort
    assert.equal(checkTranscriptRecords([{ rec: noModel }]).drifts.find(d => d.field === 'message.model').level, 'error')
    // `effort` is declared TYPICAL and read by nobody — must not be an error
    const r = checkTranscriptRecords([{ rec: noEffort }])
    const d = r.drifts.find(x => x.field === 'effort')
    assert.equal(d.level, 'warn')
  })

  test('a field with no APPLICABLE records is could-not-check, not absent', () => {
    // Only assistant records supplied => the system-only field `subtype` was never examined.
    const r = checkTranscriptRecords([{ rec: turn() }])
    const f = r.fields.find(x => x.path === 'subtype')
    assert.equal(f.status, 'could-not-check')
    assert.equal(f.applicableSamples, 0)
    assert.ok(r.fieldsNotChecked.some(x => x.path === 'subtype'), 'unchecked fields must be listed alongside an "ok"')
    assert.equal(r.ok, true, 'ok is still true — but only because fieldsNotChecked discloses what was skipped')
    assert.ok(r.fieldsNotChecked.length > 0)
  })
})

describe('declared-optional absence is never drift', () => {
  test('toolUseResult absent from every user record does not raise drift', () => {
    const users = [1, 2, 3].map(i => ({ rec: turn({ type: 'user', uuid: 'u' + i, promptId: 'p' + i, requestId: undefined, effort: undefined, message: { role: 'user', content: [] } }) }))
    const r = checkTranscriptRecords(users)
    const f = r.fields.find(x => x.path === 'toolUseResult')
    assert.equal(f.status, 'absent-optional')
    assert.equal(f.drift, null)
    assert.match(f.because, /NOT evidence it was removed/)
    assert.ok(!r.drifts.some(d => d.field === 'toolUseResult'))
  })

  test('the contract declares toolUseResult OPTIONAL — a regression here would nag on every healthy boot', () => {
    const f = CONTRACT.transcriptJsonl.fields.find(x => x.path === 'toolUseResult')
    assert.equal(f.req, REQ.OPTIONAL)
  })

  test('settings.json fields are all optional — an empty {} settings file is valid, not drift', () => {
    const r = checkJsonDocs('settingsJson', [{}])
    assert.equal(r.ok, true)
    assert.deepEqual(r.drifts, [])
    assert.equal(r.samplesChecked, 1)
    assert.ok(r.fields.every(f => f.status === 'absent-optional'))
  })
})

describe('bounds are reported, never silent', () => {
  test('a maxFiles cap that bites is reported', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'contracts-bounds-'))
    try {
      const d = path.join(tmp, 'p', 'sess', 'subagents')
      fs.mkdirSync(d, { recursive: true })
      for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(d, `a${i}.jsonl`), JSON.stringify(turn()) + '\n')
      const found = findTranscripts(tmp, { maxFiles: 2 })
      assert.equal(found.files.length, 2)
      const b = found.bounds.find(x => x.what === 'transcript files opened')
      assert.ok(b && b.hit === true, 'a cap that changed the result must appear in bounds')
      assert.equal(b.limit, 2)
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })

  test('no cap bites => no phantom bounds', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'contracts-nobounds-'))
    try {
      fs.mkdirSync(path.join(tmp, 'p'), { recursive: true })
      fs.writeFileSync(path.join(tmp, 'p', 'a.jsonl'), JSON.stringify(turn()) + '\n')
      assert.deepEqual(findTranscripts(tmp).bounds, [])
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })
})

describe('recursive discovery — the shallow glob would miss most files', () => {
  test('nested subagent transcripts are found, and the shallow shortfall is quantified', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'contracts-nested-'))
    try {
      const proj = path.join(tmp, '-home-u-repo')
      fs.mkdirSync(path.join(proj, 'sess', 'subagents'), { recursive: true })
      fs.writeFileSync(path.join(proj, 'sess.jsonl'), '')
      for (let i = 0; i < 4; i++) fs.writeFileSync(path.join(proj, 'sess', 'subagents', `agent-${i}.jsonl`), '')
      const found = findTranscripts(tmp)
      assert.equal(found.files.length, 5, 'recursive walk must find the nested subagent transcripts')
      assert.equal(found.shallowGlobWouldFind, 1)
      assert.equal(found.missedByShallowGlob, 4, 'the shortfall must be reported so "checked" can be believed')
      assert.ok(found.maxDepthSeen >= 2)
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })

  test('discovery on a nonexistent root does not throw and says the root is missing', () => {
    const found = findTranscripts('/definitely/not/here/at/all')
    assert.equal(found.rootExists, false)
    assert.deepEqual(found.files, [])
  })
})

describe('malformed input is a finding, never a crash', () => {
  test('garbage record shapes do not throw', () => {
    for (const junk of [null, undefined, 0, '', 'str', [], NaN, { rec: null }, { rec: [1, 2] }, { rec: 'x' }]) {
      assert.doesNotThrow(() => checkTranscriptRecords([junk]))
    }
    assert.doesNotThrow(() => checkTranscriptRecords(null))
    assert.doesNotThrow(() => checkTranscriptRecords('nope'))
    assert.doesNotThrow(() => checkJsonDocs('claudeJson', [null, 5, 'x', []]))
    assert.doesNotThrow(() => checkJsonDocs('no-such-contract', [{}]))
    assert.doesNotThrow(() => formatReport(null))
    assert.doesNotThrow(() => formatReport(undefined))
  })

  test('an unknown contract id is could-not-check, not a silent pass', () => {
    const r = checkJsonDocs('no-such-contract', [{ a: 1 }])
    assert.equal(r.ok, null)
    assert.equal(r.status, 'could-not-check')
  })

  test('unparseable JSONL lines are COUNTED, not swallowed', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'contracts-malformed-'))
    try {
      fs.mkdirSync(path.join(tmp, 'p'), { recursive: true })
      fs.writeFileSync(path.join(tmp, 'p', 'a.jsonl'), `${JSON.stringify(turn())}\n{not json\n\n{"type":"mode","sessionId":"s"}\n`)
      const s = readTranscriptSample(tmp)
      assert.equal(s.records.length, 2)
      assert.equal(s.malformedLines, 1, 'a spike in malformed lines IS a format change; it must be visible')
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })

  test('a record type outside the declared set is surfaced, not ignored', () => {
    const r = checkTranscriptRecords([{ rec: { type: 'brand-new-thing', sessionId: 's' } }])
    assert.deepEqual(r.unknownRecordTypes, ['brand-new-thing'])
    assert.ok(!KNOWN_RECORD_TYPES.includes('brand-new-thing'))
  })

  test('hasPath treats an explicit null value as PRESENT (thread roots are not violations)', () => {
    assert.equal(hasPath({ parentUuid: null }, 'parentUuid'), true)
    assert.equal(hasPath({}, 'parentUuid'), false)
    assert.equal(hasPath({ a: { b: 0 } }, 'a.b'), true)
    assert.equal(hasPath({ a: [1] }, 'a.0'), false, 'arrays are not traversed as objects')
    assert.equal(hasPath(null, 'a'), false)
  })
})

describe('drift is actually detected when a field really disappears', () => {
  test('renaming cache_read_input_tokens raises an error-level drift naming the affected code', () => {
    const renamed = turn()
    delete renamed.message.usage.cache_read_input_tokens
    renamed.message.usage.cacheReadInputTokens = 3
    const r = checkTranscriptRecords([{ rec: renamed }])
    assert.equal(r.ok, false)
    const d = r.drifts.find(x => x.field === 'message.usage.cache_read_input_tokens')
    assert.ok(d)
    assert.equal(d.level, 'error')
    assert.match(d.impact, /entryCost/, 'drift must name what breaks, not just what changed')
  })

  test('undeclared top-level keys in a JSON doc are surfaced (how a rename becomes visible)', () => {
    const r = checkJsonDocs('settingsJson', [{ permissionRules: {} }])
    assert.ok(r.undeclaredKeys.includes('permissionRules'))
  })
})

// ---------------------------------------------------------------------------
// The automated contract test against the REAL files on this machine.
// It SKIPS with a clear message when there are none — it must never pass vacuously.
// ---------------------------------------------------------------------------
describe('real files on this machine', () => {
  const report = checkAll()
  const anythingChecked = report.sourcesChecked.length > 0

  test('the declared contract holds against whatever real files exist', { skip: anythingChecked ? false : `SKIPPED — no readable Claude Code files under ${report.home}: ${report.sourcesNotChecked.map(s => `${s.label} (${s.reason})`).join('; ')}. This test asserts NOTHING; it did not pass.` }, () => {
    assert.notEqual(report.ok, null, 'sources were checked, so the verdict must not be "unknown"')
    assert.equal(report.ok, true, `contract drift against real files:\n${formatReport(report)}`)
  })

  test('the real-file check names its sample sizes', { skip: anythingChecked ? false : 'SKIPPED — nothing to sample' }, () => {
    for (const id of report.sourcesChecked) {
      const r = report.results[id]
      const n = r.recordsChecked ?? r.samplesChecked
      assert.ok(n > 0, `${id} claims to be checked but reports ${n} samples`)
    }
  })

  test('recursive discovery beats the shallow glob on real transcripts', { skip: report.results.transcriptJsonl.checked ? false : 'SKIPPED — no real transcripts on this machine' }, () => {
    const d = report.results.transcriptJsonl.discovery
    assert.ok(d.files.length >= d.shallowGlobWouldFind, 'recursion can never find fewer files than a shallow glob')
  })

  test('checkAll never throws regardless of what is on disk', () => {
    assert.doesNotThrow(() => checkAll())
    assert.doesNotThrow(() => checkAll({ home: '/nonexistent-home-xyz' }))
    assert.equal(checkAll({ home: '/nonexistent-home-xyz' }).ok, null)
  })
})
