import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

import { sheetStage } from '../../server/stages/sheet.mjs'

const KEY = 'ABC-1234'
const SHEET_ID = '1E3GyrTt1pkA93D_sLkQHFSupTfngLsG0-8FI2YzteO8'
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=955095625`
const EMAIL = 'loush-dossier@some-project.iam.gserviceaccount.com'

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' })

const LINKS_REL = `docs/${KEY}/links.json`

let tmpRoot
function ctxFor({ sheets = [{ url: SHEET_URL, id: SHEET_ID }], secrets = { sheetsServiceAccount: { client_email: EMAIL, private_key: PEM } }, fetch, linksStatus = 'ok', writeLinks = true } = {}) {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-stage-'))
  const repoDir = path.join(tmpRoot, 'repo')
  const cacheDir = path.join(tmpRoot, 'cache')
  fs.mkdirSync(path.join(repoDir, 'docs', KEY), { recursive: true })
  // The `links` stage's artifact — the manifest only points at it (spec §2).
  if (writeLinks) fs.writeFileSync(path.join(repoDir, LINKS_REL), JSON.stringify({ jira: [], confluence: [], sheets, figma: [], discovered: [] }))
  const secretsFile = path.join(tmpRoot, '.eng.local.json')
  if (secrets) fs.writeFileSync(secretsFile, JSON.stringify(secrets))
  return {
    repoDir, cacheDir, key: KEY, cfg: {}, secretsFile, fetch,
    manifest: { v: 1, key: KEY, stages: { links: { stage: 'links', status: linksStatus, reason: linksStatus === 'ok' ? null : 'nope', artifacts: [LINKS_REL] } } },
  }
}
const csvPath = ctx => path.join(ctx.repoDir, 'docs', KEY, 'content.csv')

/** A stubbed Google: token endpoint always succeeds; the two API calls are supplied per test. */
function google({ meta, values }) {
  const calls = []
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url: String(url), init })
      if (String(url).includes('oauth2.googleapis.com')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
      if (String(url).includes('/values/')) return values()
      return meta()
    },
  }
}
const okMeta = () => new Response(JSON.stringify({
  sheets: [
    { properties: { sheetId: 0, title: 'Sheet1' } },
    { properties: { sheetId: 955095625, title: 'Copy deck' } },
  ],
}), { status: 200 })

test('a sign-in page is not written as content.csv, and the entry is not ok', async () => {
  const g = google({ meta: okMeta, values: () => new Response('<!DOCTYPE html><html><body>Sign in to continue</body></html>', { status: 200, headers: { 'content-type': 'text/html' } }) })
  const ctx = ctxFor({ fetch: g.fetch })

  const e = await sheetStage(ctx)

  assert.notEqual(e.status, 'ok')
  assert.ok(e.reason)
  assert.equal(fs.existsSync(csvPath(ctx)), false, 'no file at all beats a sign-in page saved as CSV')
  assert.match(e.reason, /sign-in|non-JSON/i)
})

test('a missing credential is a non-ok entry naming the service-account address to share with', async () => {
  const g = google({ meta: okMeta, values: () => new Response('{}', { status: 200 }) })
  const ctx = ctxFor({ secrets: null, fetch: g.fetch })

  const e = await sheetStage(ctx)

  assert.notEqual(e.status, 'ok')
  assert.match(e.reason, /\.eng\.local\.json/)
  assert.match(e.reason, /client_email/)
  assert.match(e.reason, /service.account/i)
  assert.equal(g.calls.length, 0, 'no credential means no request was ever made')
})

test('403 says the sheet is not shared and names the address; 404 says no such sheet', async () => {
  const denied = google({ meta: () => new Response(JSON.stringify({ error: { code: 403, message: 'The caller does not have permission' } }), { status: 403 }), values: () => new Response('{}', { status: 200 }) })
  const forbidden = await sheetStage(ctxFor({ fetch: denied.fetch }))
  assert.notEqual(forbidden.status, 'ok')
  assert.match(forbidden.reason, /not shared/i)
  assert.ok(forbidden.reason.includes(EMAIL), 'the human has to know who to share with')

  const gone = google({ meta: () => new Response(JSON.stringify({ error: { code: 404, message: 'Requested entity was not found.' } }), { status: 404 }), values: () => new Response('{}', { status: 200 }) })
  const missing = await sheetStage(ctxFor({ fetch: gone.fetch }))
  assert.notEqual(missing.status, 'ok')
  assert.doesNotMatch(missing.reason, /not shared/i)
  assert.match(missing.reason, /no such|not exist|not found/i)
})

test('no sheet link at all is skipped, not failed', async () => {
  const e = await sheetStage(ctxFor({ sheets: [], fetch: async () => { throw new Error('must not fetch') } }))
  assert.equal(e.status, 'skipped')
  assert.ok(e.reason)
})

test('an upstream links stage that is not ok skips this one, naming the upstream', async () => {
  const e = await sheetStage(ctxFor({ linksStatus: 'failed', fetch: async () => { throw new Error('must not fetch') } }))
  assert.equal(e.status, 'skipped')
  assert.match(e.reason, /links/)
})

test('a links.json that is missing or unreadable is skipped, naming the path it looked at', async () => {
  const e = await sheetStage(ctxFor({ writeLinks: false, fetch: async () => { throw new Error('must not fetch') } }))
  assert.equal(e.status, 'skipped')
  assert.match(e.reason, /links\.json/)
})

// `links.json` carries only `{url, id}` (spec §2) — the gid lives in the URL fragment and this stage
// derives it, so a link without one is the ordinary case for a single-tab deck.
test('a sheet link with no gid in the URL falls back to the first tab', async () => {
  const g = google({ meta: okMeta, values: () => new Response(JSON.stringify({ values: [['a']] }), { status: 200 }) })
  const e = await sheetStage(ctxFor({ sheets: [{ url: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`, id: SHEET_ID }], fetch: g.fetch }))
  assert.equal(e.status, 'ok', e.reason || '')
  assert.ok(g.calls.some(c => c.url.includes('/values/Sheet1')), g.calls.map(c => c.url).join('\n'))
})

test('the happy path writes the tab named by the gid as CSV, plus the raw rows to the cache', async () => {
  const g = google({ meta: okMeta, values: () => new Response(JSON.stringify({ range: 'Copy deck!A1:B2', values: [['key', 'en'], ['cta.book', 'Book now, "today"']] }), { status: 200 }) })
  const ctx = ctxFor({ fetch: g.fetch })

  const e = await sheetStage(ctx)

  assert.equal(e.status, 'ok', e.reason || '')
  assert.equal(e.sourceUrl, SHEET_URL)
  assert.deepEqual(e.artifacts, [`docs/${KEY}/content.csv`])
  assert.equal(fs.readFileSync(csvPath(ctx), 'utf8'), 'key,en\ncta.book,"Book now, ""today"""\n')
  // the gid picked the second tab, not the first
  assert.ok(g.calls.some(c => c.url.includes('/values/Copy%20deck')), g.calls.map(c => c.url).join('\n'))
  assert.equal(JSON.parse(fs.readFileSync(path.join(ctx.cacheDir, 'sheet.json'), 'utf8')).values.length, 2)
})

test('the token request carries a JWT this key really signed, scoped read-only', async () => {
  const g = google({ meta: okMeta, values: () => new Response(JSON.stringify({ values: [['a']] }), { status: 200 }) })
  await sheetStage(ctxFor({ fetch: g.fetch }))

  const body = new URLSearchParams(g.calls[0].init.body)
  assert.equal(body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer')
  const [h, p, sig] = body.get('assertion').split('.')
  const claims = JSON.parse(Buffer.from(p, 'base64url'))
  assert.equal(claims.iss, EMAIL)
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/spreadsheets.readonly')
  assert.ok(crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(sig, 'base64url')))
})

test('an empty sheet is unavailable with a reason, never an empty content.csv', async () => {
  const g = google({ meta: okMeta, values: () => new Response(JSON.stringify({ range: 'Copy deck!A1' }), { status: 200 }) })
  const ctx = ctxFor({ fetch: g.fetch })

  const e = await sheetStage(ctx)

  assert.equal(e.status, 'unavailable')
  assert.equal(fs.existsSync(csvPath(ctx)), false)
})
