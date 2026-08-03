import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { STAGES, stageTicket, stageLinks, stageJiraLinked, stageConfluence } from '../../server/stages/jira.mjs'

const KEY = 'ABC-1234'
const cfg = { key: 'ABC', jiraProjectKey: 'ABC', jiraHost: 'example.atlassian.net' }

/**
 * A stand-in for the runner: it owns the manifest, merges each returned entry into it, and hands the
 * updated manifest to the next stage. Threading it here is the point — `jira-linked` and
 * `confluence` locate links.json through `manifest.stages.links.artifacts[0]`, so a test that
 * skipped this step would pass while the real pipeline found nothing.
 */
function runner(over = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stages-jira-'))
  const ctx = {
    repoDir: path.join(root, 'repo'),
    cacheDir: path.join(root, 'state', 'ws', KEY, 'cache'),
    key: KEY, cfg,
    manifest: { v: 1, key: KEY, stages: {}, ...over },
  }
  fs.mkdirSync(ctx.repoDir, { recursive: true })
  return {
    ctx,
    async step(stage, seam) {
      const e = await stage({ ...ctx, ...seam })
      ctx.manifest = { ...ctx.manifest, stages: { ...ctx.manifest.stages, [e.stage]: e } }
      return e
    },
    doc: name => fs.readFileSync(path.join(ctx.repoDir, 'docs', KEY, name), 'utf8'),
    cached: rel => fs.existsSync(path.join(ctx.cacheDir, rel)),
  }
}

const detail = (over = {}) => ({
  key: KEY, summary: 'Checkout flow', type: 'Story', status: 'In Progress',
  description: 'see the design', comments: [], history: [], prs: [],
  prContext: { loaded: true, prs: 0, commits: false },
  ...over,
})

test('every stage is reachable by name, so the runner does not import four symbols', () => {
  assert.deepEqual(Object.keys(STAGES), ['ticket', 'links', 'jira-linked', 'confluence'])
  for (const [name, fn] of Object.entries(STAGES)) assert.equal(typeof fn, 'function', name)
})

// ---- stage 1: ticket ----

test('ticket puts the raw payload in the cache half and a readable digest in the repo half', async () => {
  const r = runner()
  const e = await r.step(stageTicket, { fetchDetail: async () => detail({ comments: [{ author: 'Sam', at: 'now', body: 'ship it' }] }) })

  assert.equal(e.stage, 'ticket')
  assert.equal(e.status, 'ok')
  assert.equal(e.sourceUrl, `https://${cfg.jiraHost}/browse/${KEY}`)
  assert.ok(e.provenance.reqHash, 'the ticket entry carries the hash staleness is measured against')

  assert.ok(e.artifacts.includes(`docs/${KEY}/ticket.md`), 'the repo-half path is repo-relative so it travels with a clone')
  assert.match(r.doc('ticket.md'), /Checkout flow[\s\S]*ship it/)

  const raw = JSON.parse(fs.readFileSync(path.join(r.ctx.cacheDir, 'ticket.json'), 'utf8'))
  assert.equal(raw.summary, 'Checkout flow', 'the raw fetch is re-fetchable, so it stays out of git')
  assert.ok(!fs.existsSync(path.join(r.ctx.repoDir, 'docs', KEY, 'ticket.json')), 'no raw payload in the repo half')
})

test('a jira fetch that throws is failed with a reason, not an exception out of the stage', async () => {
  const e = await runner().step(stageTicket, { fetchDetail: async () => { throw new Error('401 unauthorized') } })
  assert.equal(e.status, 'failed')
  assert.match(e.reason, /401 unauthorized/)
})

// ---- stage 2: links, and the depth-1 caps ----

const sixJira = ['ABC-1', 'ABC-2', 'ABC-3', 'ABC-4', 'ABC-5', 'ABC-6']
  .map(k => `https://example.atlassian.net/browse/${k}`).join(' ')
const fourPages = [1, 2, 3, 4].map(n => `https://example.atlassian.net/wiki/spaces/X/pages/1000${n}/Page`).join(' ')
const twoSheets = [1, 2].map(n => `https://docs.google.com/spreadsheets/d/sheet${n}/edit#gid=${n}0`).join(' ')

/** ticket then links, the way the runner would, since every later stage needs both. */
async function linked(description, over) {
  const r = runner(over)
  await r.step(stageTicket, { fetchDetail: async () => detail({ description }) })
  const e = await r.step(stageLinks)
  return { r, e }
}

test('the 6th jira link is discovered-but-not-followed, never dropped', async () => {
  const { r, e } = await linked(`${sixJira} ${fourPages} ${twoSheets}`)

  assert.equal(e.status, 'ok')
  assert.equal(e.artifacts[0], `docs/${KEY}/links.json`, 'four stages locate it via artifacts[0]')

  const links = JSON.parse(r.doc('links.json'))
  assert.deepEqual(links.jira, ['ABC-1', 'ABC-2', 'ABC-3', 'ABC-4', 'ABC-5'])
  assert.equal(links.confluence.length, 3)
  assert.equal(links.sheets.length, 1)

  const over = links.discovered.map(d => d.ref)
  assert.ok(over.includes('ABC-6'), 'the 6th jira link survives as discovered')
  assert.equal(links.discovered.filter(d => d.kind === 'confluence').length, 1)
  assert.equal(links.discovered.filter(d => d.kind === 'sheets').length, 1)
  for (const d of links.discovered) assert.ok(d.why, 'a link we did not follow has to say why in words')

  assert.deepEqual(e.provenance.discovered, links.discovered, 'the manifest carries it too — that is the file every reader has open')
})

test('a sheet carries the gid — it names a tab, so losing it reads the wrong strings silently', async () => {
  const { r } = await linked(twoSheets)
  assert.deepEqual(JSON.parse(r.doc('links.json')).sheets, [
    { url: 'https://docs.google.com/spreadsheets/d/sheet1/edit#gid=10', id: 'sheet1', gid: '10' },
  ])
})

test('a sheet link with no gid gets null, not 0 — "which tab" unanswered is not "tab 1"', async () => {
  const { r } = await linked('https://docs.google.com/spreadsheets/d/plain/edit')
  assert.deepEqual(JSON.parse(r.doc('links.json')).sheets, [
    { url: 'https://docs.google.com/spreadsheets/d/plain/edit', id: 'plain', gid: null },
  ])
})

test('the legacy public-CSV url is never carried into links.json', async () => {
  const { r } = await linked(twoSheets)
  assert.ok(!('csv' in JSON.parse(r.doc('links.json')).sheets[0]))
})

test('links without a ticket payload is skipped with a reason naming the upstream stage', async () => {
  const e = await runner().step(stageLinks)
  assert.equal(e.status, 'skipped')
  assert.match(e.reason, /ticket/)
})

// ---- stage 3: jira-linked ----

test('jira-linked follows at most 5 and records what the linked issues pointed at as depth 2', async () => {
  const { r } = await linked(sixJira)

  const seen = []
  const e = await r.step(stageJiraLinked, {
    fetchDetail: async (_cfg, k) => {
      seen.push(k)
      return detail({ key: k, summary: `linked ${k}`, description: 'https://example.atlassian.net/browse/DEEP-9' })
    },
  })

  assert.equal(e.status, 'ok')
  assert.deepEqual(seen, ['ABC-1', 'ABC-2', 'ABC-3', 'ABC-4', 'ABC-5'], 'the 6th was never fetched')
  assert.match(r.doc('jira-linked.md'), /linked ABC-1/)
  assert.ok(r.cached(path.join('jira-linked', 'ABC-1.json')), 'raw linked payloads go to the cache half')

  const deep = e.provenance.discovered.find(d => d.ref === 'DEEP-9')
  assert.ok(deep, 'a link found inside a linked issue is depth 2 and must still be recorded')
  assert.match(deep.why, /depth 2/)
  assert.deepEqual(e.provenance.handoff, { passed: ['links'], excluded: [] })
})

test('jira-linked without a links entry in the manifest is skipped, naming links', async () => {
  const e = await runner().step(stageJiraLinked, { fetchDetail: async () => { throw new Error('should not be called') } })
  assert.equal(e.status, 'skipped')
  assert.match(e.reason, /links/)
})

test('a ticket that links no issues says so in words rather than rendering as an empty row', async () => {
  const { r } = await linked('no links here')
  const e = await r.step(stageJiraLinked, { fetchDetail: async () => { throw new Error('should not be called') } })
  assert.equal(e.status, 'ok')
  assert.match(e.reason, /no other issues/)
})

// ---- stage 4: confluence ----

test('an unreadable confluence page becomes unavailable with a reason naming the page', async () => {
  const { r } = await linked(fourPages)
  const e = await r.step(stageConfluence, { fetchPage: async () => null })   // confluencePage returns null, never throws
  assert.equal(e.status, 'unavailable')
  assert.match(e.reason, /10001/, 'the reason names the page a human would go and check')
  assert.deepEqual(e.artifacts, [])
})

test('confluence reads what it can and names what it could not', async () => {
  const { r } = await linked(fourPages)
  const e = await r.step(stageConfluence, {
    fetchPage: async (_cfg, id) => (id === '10001' ? { id, title: 'Decision log', text: 'we chose B', truncated: false } : null),
  })
  assert.equal(e.status, 'ok')
  assert.match(e.reason, /10002/)
  assert.doesNotMatch(e.reason, /10001/)
  assert.match(r.doc('confluence.md'), /Decision log[\s\S]*we chose B/)
  assert.ok(r.cached(path.join('confluence', '10001.json')))
})

test('at most 3 pages are read', async () => {
  const { r } = await linked(fourPages)
  const seen = []
  await r.step(stageConfluence, { fetchPage: async (_cfg, id) => { seen.push(id); return { id, title: id, text: 't' } } })
  assert.deepEqual(seen, ['10001', '10002', '10003'])
})

// ---- the non-git workspace ----

test('every entry inherits the manifest tracked flag — a degraded run must not read as durable', async () => {
  const { r, e } = await linked('no links here', { tracked: false })
  assert.equal(e.tracked, false, 'links')
  assert.equal(r.ctx.manifest.stages.ticket.tracked, false, 'ticket')
})
