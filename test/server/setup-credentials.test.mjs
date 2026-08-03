
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

import mountSetup, { resolveServiceAccount, credState } from '../../server/setup.mjs'

// A real RS256 keypair: the sheets test signs a JWT for real, only the network is stubbed.
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' })
const EMAIL = 'dossier@some-project.iam.gserviceaccount.com'
const KEY = { type: 'service_account', client_email: EMAIL, private_key: PEM }

const mkRes = () => ({
  statusCode: 200, body: null,
  status(c) { this.statusCode = c; return this },
  json(b) { this.body = b; return this },
})

// A stand-in for the express app: mountSetup only ever calls get/put/post/delete.
function mount(deps = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-creds-'))
  const secretsFile = path.join(dir, '.eng.local.json')
  const gitignoreFile = path.join(dir, '.gitignore')
  fs.writeFileSync(gitignoreFile, 'node_modules\n.eng.local.json\n')
  const routes = {}
  const add = m => (p, h) => { routes[`${m} ${p}`] = h }
  const app = { get: add('GET'), put: add('PUT'), post: add('POST'), delete: add('DELETE') }
  mountSetup(app, { secretsFile, gitignoreFile, ...deps })
  const call = async (route, body = {}) => {
    const res = mkRes()
    await routes[route]({ body, query: {} }, res)
    return res
  }
  return { dir, secretsFile, gitignoreFile, call, stored: () => JSON.parse(fs.readFileSync(secretsFile, 'utf8')) }
}

const save = (h, sheetsServiceAccount) => h.call('PUT /api/setup/credentials', { sheetsServiceAccount })

// The whole point of the redaction rule: the key must not appear ANYWHERE in a body, at any depth.
const leaksKey = body => JSON.stringify(body || {}).includes('PRIVATE KEY')

// ------------------------------------------------------------ resolveServiceAccount

test('a service account with no private_key is rejected with a message that says which field', () => {
  const { error, sa } = resolveServiceAccount({ client_email: EMAIL })
  assert.equal(sa, undefined)
  assert.match(error, /private_key/)
})

test('a service account with no client_email is rejected', () => {
  assert.match(resolveServiceAccount({ private_key: PEM }).error, /client_email/)
})

test('a hand-mangled private_key is rejected — this is how pasting a PEM into JSON goes wrong', () => {
  const { error } = resolveServiceAccount({ client_email: EMAIL, private_key: 'MIIEvQIBADANBg...' })
  assert.match(error, /PEM/)
})

test('a rejection never echoes the key back', () => {
  for (const bad of ['{"client_email":"x","private_key":"-----BEGIN PRIVATE KEY-----\nsecret', { private_key: PEM }])
    assert.equal(leaksKey(resolveServiceAccount(bad).error), false)
})

test('the key object, its JSON text, and a path to the file all resolve the same way', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-'))
  const file = path.join(dir, 'key.json')
  fs.writeFileSync(file, JSON.stringify(KEY))
  for (const input of [KEY, JSON.stringify(KEY), file])
    assert.equal(resolveServiceAccount(input).sa.client_email, EMAIL)
  assert.match(resolveServiceAccount(path.join(dir, 'nope.json')).error, /path/)
})

// ------------------------------------------------------------ storage + leakage

test('a valid key is stored under sheetsServiceAccount and credState reports it as "file"', async () => {
  const h = mount()
  const res = await save(h, KEY)
  assert.equal(res.statusCode, 200)
  assert.equal(h.stored().sheetsServiceAccount.client_email, EMAIL)
  const c = res.body.credentials.sheets
  assert.deepEqual({ set: c.set, source: c.source, account: c.account }, { set: true, source: 'file', account: EMAIL })
})

test('no response body ever contains the private key', async () => {
  const h = mount()
  assert.equal(leaksKey((await save(h, KEY)).body), false, 'the save response')
  assert.equal(leaksKey(credState(h.secretsFile, h.gitignoreFile)), false, 'credState')
  assert.equal(leaksKey((await save(h, { client_email: EMAIL })).body), false, 'a rejection')
})

test('a path is stored as a path, so rotating the key file in place needs no re-paste', async () => {
  const h = mount()
  const file = path.join(h.dir, 'key.json')
  fs.writeFileSync(file, JSON.stringify(KEY))
  await save(h, file)
  assert.equal(h.stored().sheetsServiceAccount, file)
  assert.equal(credState(h.secretsFile, h.gitignoreFile).sheets.account, EMAIL)
})

test('an empty string clears the stored key', async () => {
  const h = mount()
  await save(h, KEY)
  const res = await save(h, '')
  assert.equal('sheetsServiceAccount' in h.stored(), false)
  assert.equal(res.body.credentials.sheets.set, false)
})

test('a bad key is rejected with 400 and nothing is written', async () => {
  const h = mount()
  const res = await save(h, { client_email: EMAIL })
  assert.equal(res.statusCode, 400)
  assert.equal(fs.existsSync(h.secretsFile), false, 'a rejected save must not create the file')
})

test('the not-gitignored warning still fires', async () => {
  const h = mount()
  fs.writeFileSync(h.gitignoreFile, 'node_modules\n')
  const res = await save(h, KEY)
  assert.match(res.body.warning, /NOT in \.gitignore/)
  assert.equal(res.body.credentials.file.gitignored, false)
})

// ------------------------------------------------------------ figma

test('the Figma field reports env-managed when FIGMA_TOKEN is set', t => {
  const h = mount()
  const before = process.env.FIGMA_TOKEN
  t.after(() => { before === undefined ? delete process.env.FIGMA_TOKEN : (process.env.FIGMA_TOKEN = before) })

  process.env.FIGMA_TOKEN = 'figd_from_the_environment'
  const on = credState(h.secretsFile, h.gitignoreFile).figma
  assert.deepEqual({ set: on.set, source: on.source, envLocked: on.envLocked }, { set: true, source: 'env', envLocked: true })
  assert.equal(leaksKey(on), false)
  assert.equal(JSON.stringify(on).includes('from_the_environment'), false, 'the token value must not be reported')

  delete process.env.FIGMA_TOKEN
  assert.equal(credState(h.secretsFile, h.gitignoreFile).figma.envLocked, false)
})

test('POST /api/setup/test/figma reads the account and separates 401 from 403', async t => {
  const before = process.env.FIGMA_TOKEN
  t.after(() => { before === undefined ? delete process.env.FIGMA_TOKEN : (process.env.FIGMA_TOKEN = before) })
  process.env.FIGMA_TOKEN = 'figd_test'

  const reply = (status, data) => async (url, opt) => {
    assert.equal(url, 'https://api.figma.com/v1/me')
    assert.equal(opt.headers['X-Figma-Token'], 'figd_test')
    return { ok: status === 200, status, json: async () => data }
  }
  const ok = await mount({ fetch: reply(200, { email: 'me@example.com' }) }).call('POST /api/setup/test/figma')
  assert.deepEqual(ok.body, { ok: true, account: 'me@example.com' })

  const bad = await mount({ fetch: reply(401, {}) }).call('POST /api/setup/test/figma')
  assert.equal(bad.body.ok, false)
  assert.match(bad.body.error, /check the key/)

  const forbidden = await mount({ fetch: reply(403, {}) }).call('POST /api/setup/test/figma')
  assert.match(forbidden.body.error, /not permitted/)
  assert.notEqual(forbidden.body.error, bad.body.error, 'a scope problem must not read as a bad key')
})

// ------------------------------------------------------------ sheets test

// Google's token endpoint, then the Sheets API. `sheetStatus` null means the token exchange failed.
const googleStub = ({ tokenStatus = 200, token = { access_token: 'ya29.stub' }, sheetStatus = 200, sheetBody = { properties: { title: 'Copy deck' } } } = {}) =>
  async url => url.startsWith('https://oauth2.googleapis.com')
    ? { ok: tokenStatus === 200, status: tokenStatus, json: async () => token }
    : { ok: sheetStatus === 200, status: sheetStatus, json: async () => sheetBody }

async function withKey(stub) {
  const h = mount({ fetch: stub })
  await save(h, KEY)
  return h
}

test('the sheets test reports the service-account address on success', async () => {
  const h = await withKey(googleStub())
  const res = await h.call('POST /api/setup/test/sheets', {})
  assert.deepEqual(res.body, { ok: true, account: EMAIL })
  assert.equal(leaksKey(res.body), false)
})

test('a key Google refuses reads as a key problem', async () => {
  const h = await withKey(googleStub({ tokenStatus: 400, token: { error_description: 'Invalid JWT Signature.' } }))
  const res = await h.call('POST /api/setup/test/sheets', {})
  assert.equal(res.body.ok, false)
  assert.match(res.body.error, /refused this key/)
  assert.equal(leaksKey(res.body), false)
})

test('a valid key against an unshared sheet does NOT read like a bad key — it names the address to share with', async () => {
  const badKey = await withKey(googleStub({ tokenStatus: 400, token: {} }))
  const unshared = await withKey(googleStub({ sheetStatus: 403 }))
  const sheet = 'https://docs.google.com/spreadsheets/d/1AbC_dEf-123/edit#gid=0'

  const a = (await badKey.call('POST /api/setup/test/sheets', { sheet })).body
  const b = (await unshared.call('POST /api/setup/test/sheets', { sheet })).body

  assert.match(b.error, /not shared with/)
  assert.match(b.error, new RegExp(EMAIL.replace('.', '\\.')), 'the fix is to share with THIS address, so it must be in the message')
  assert.equal(b.shared, false)
  assert.doesNotMatch(b.error, /refused this key/)
  assert.notEqual(a.error, b.error, 'a sharing problem and a key problem are fixed in different places')
})

test('a sheet id is taken out of a pasted edit URL', async () => {
  const seen = []
  const h = mount({ fetch: async (url, opt) => { seen.push(url); return googleStub()(url, opt) } })
  await save(h, KEY)
  await h.call('POST /api/setup/test/sheets', { sheet: 'https://docs.google.com/spreadsheets/d/1AbC_dEf-123/edit#gid=955095625' })
  assert.ok(seen.some(u => u.includes('/spreadsheets/1AbC_dEf-123?')), `expected the sheet id in ${seen.join(' ')}`)
})

test('a missing spreadsheet is not confused with an unshared one', async () => {
  const h = await withKey(googleStub({ sheetStatus: 404 }))
  const res = await h.call('POST /api/setup/test/sheets', { sheet: 'https://docs.google.com/spreadsheets/d/gone/edit' })
  assert.match(res.body.error, /No such spreadsheet/)
})

test('the sheets test says so when there is no key at all', async () => {
  const res = await mount().call('POST /api/setup/test/sheets', {})
  assert.equal(res.statusCode, 400)
  assert.match(res.body.error, /No Google service-account key/)
})
