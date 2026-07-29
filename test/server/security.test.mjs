import test from 'node:test'
import assert from 'node:assert/strict'
import {
  hostHeaderGuard, loopbackCorsGuard, tokenGate, bindHost, isExposedBind,
  parseHost, isLoopbackHost, safeEqual, presentedToken, securityMiddleware,
  DEFAULT_BIND_HOST, HOST_DENIED, ORIGIN_DENIED, TOKEN_DENIED,
} from '../../server/security.mjs'

// Middleware is exercised directly with stubs — no ports are bound, so the suite stays fast and
// cannot collide with a dashboard already running on the developer's machine.
const mkReq = (headers = {}, over = {}) => ({
  method: 'GET',
  headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
  get(h) { return this.headers[String(h).toLowerCase()] },
  ...over,
})

const mkRes = () => {
  const res = {
    statusCode: null, body: null, headers: {}, ended: false,
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
    set(k, v) { this.headers[String(k).toLowerCase()] = v; return this },
    end() { this.ended = true; return this },
  }
  return res
}

// Runs a middleware and reports whether it called next() or answered the request itself.
const run = (mw, req) => {
  const res = mkRes()
  let nexted = false
  mw(req, res, () => { nexted = true })
  return { res, nexted }
}

// ---------------------------------------------------------------------------------------------
// parseHost / isLoopbackHost

test('parseHost splits names, ports and IPv6 literals', () => {
  assert.deepEqual(parseHost('localhost'), { host: 'localhost', port: '' })
  assert.deepEqual(parseHost('LocalHost:5178'), { host: 'localhost', port: '5178' })
  assert.deepEqual(parseHost('[::1]:5178'), { host: '::1', port: '5178' })
  assert.deepEqual(parseHost('[::1]'), { host: '::1', port: '' })
  assert.deepEqual(parseHost('  127.0.0.1:80  '), { host: '127.0.0.1', port: '80' })
})

test('parseHost returns null for absent or unparseable headers', () => {
  for (const bad of [undefined, null, '', '   ', 'localhost:notaport', '[::1'])
    assert.equal(parseHost(bad), null, `${JSON.stringify(bad)} must not parse`)
})

test('the whole 127.0.0.0/8 block counts as loopback, other addresses do not', () => {
  for (const good of ['localhost', 'LOCALHOST', '127.0.0.1', '127.0.0.2', '127.1.2.3', '::1', '[::1]'])
    assert.equal(isLoopbackHost(good), true, `${good} is loopback`)
  for (const bad of ['evil.example', '128.0.0.1', '10.0.0.4', '0.0.0.0', '', '127.0.0.300'])
    assert.equal(isLoopbackHost(bad), false, `${bad} is not loopback`)
})

// ---------------------------------------------------------------------------------------------
// hostHeaderGuard

test('loopback hosts pass the Host guard, on any port', () => {
  const mw = hostHeaderGuard({ env: {} })
  for (const host of ['localhost:5178', 'localhost', '127.0.0.1:5178', '127.0.0.1:31337', '[::1]:5178', '127.0.0.2:80']) {
    const { nexted, res } = run(mw, mkReq({ host }))
    assert.equal(nexted, true, `${host} should pass`)
    assert.equal(res.statusCode, null)
  }
})

test('a rebinding Host is rejected with 403 and an explanation', () => {
  // The attack this exists for: evil.example resolves to 127.0.0.1, so the packet arrives on
  // loopback, but the Host header still says evil.example and that is what gives it away.
  const { nexted, res } = run(hostHeaderGuard({ env: {} }), mkReq({ host: 'evil.example:5178' }))
  assert.equal(nexted, false, 'a disallowed host must never reach the route')
  assert.equal(res.statusCode, 403)
  assert.equal(res.body.error, HOST_DENIED)
  assert.equal(res.body.host, 'evil.example:5178')
  assert.match(res.body.howToPermit, /DASH_ALLOWED_HOSTS/)
  assert.ok(res.body.reason.length > 0, 'the rejection must say what was rejected')
})

test('a request with no Host header is rejected, not allowed through', () => {
  const { nexted, res } = run(hostHeaderGuard({ env: {} }), mkReq({}))
  assert.equal(nexted, false)
  assert.equal(res.statusCode, 403)
  assert.equal(res.body.host, null)
  assert.match(res.body.reason, /no Host header/)
})

test('a host that merely starts with an allowed name is still rejected', () => {
  const mw = hostHeaderGuard({ env: {} })
  for (const host of ['localhost.evil.example', 'notlocalhost', '127.0.0.1.evil.example', '1127.0.0.1'])
    assert.equal(run(mw, mkReq({ host })).nexted, false, `${host} must not pass`)
})

test('extra hosts can be allowed by option or by DASH_ALLOWED_HOSTS', () => {
  const byOpt = hostHeaderGuard({ env: {}, allow: ['dash.local'] })
  assert.equal(run(byOpt, mkReq({ host: 'dash.local:5178' })).nexted, true, 'name-only entry ignores port')
  assert.equal(run(byOpt, mkReq({ host: 'other.local' })).nexted, false)

  const byEnv = hostHeaderGuard({ env: { DASH_ALLOWED_HOSTS: 'a.local:5178, b.local' } })
  assert.equal(run(byEnv, mkReq({ host: 'a.local:5178' })).nexted, true)
  assert.equal(run(byEnv, mkReq({ host: 'a.local:9999' })).nexted, false, 'an entry with a port pins that port')
  assert.equal(run(byEnv, mkReq({ host: 'b.local:9999' })).nexted, true)
})

test('the Host guard defaults to guarding and only opens on an explicit enabled:false', () => {
  assert.equal(run(hostHeaderGuard(), mkReq({ host: 'evil.example' })).nexted, false)
  assert.equal(run(hostHeaderGuard({ env: {} }), mkReq({ host: 'evil.example' })).nexted, false)
  assert.equal(run(hostHeaderGuard({ env: {}, enabled: false }), mkReq({ host: 'evil.example' })).nexted, true)
})

test('hostHeaderGuard exposes .permits for callers with no (req,res,next) — e.g. WS upgrade', () => {
  const mw = hostHeaderGuard({ env: {} })
  assert.equal(mw.permits('localhost:5178'), true)
  assert.equal(mw.permits('evil.example'), false)
  assert.equal(mw.permits(undefined), false)
})

// ---------------------------------------------------------------------------------------------
// loopbackCorsGuard

test('loopback origins are permitted and echoed back with credentials', () => {
  const { nexted, res } = run(loopbackCorsGuard({ env: {} }), mkReq({ origin: 'http://localhost:5173' }))
  assert.equal(nexted, true)
  assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:5173')
  assert.equal(res.headers['access-control-allow-credentials'], 'true')
  assert.equal(res.headers['vary'], 'Origin')
})

test('cross-origin browser requests are rejected with 403', () => {
  const mw = loopbackCorsGuard({ env: {} })
  for (const origin of ['https://evil.example', 'http://evil.example:5178', 'null', 'file://', 'not a url']) {
    const { nexted, res } = run(mw, mkReq({ origin }))
    assert.equal(nexted, false, `${origin} must be rejected`)
    assert.equal(res.statusCode, 403)
    assert.equal(res.body.error, ORIGIN_DENIED)
    assert.match(res.body.howToPermit, /DASH_ALLOWED_ORIGINS/)
  }
})

test('a request with no Origin passes — not a cross-origin browser request', () => {
  const { nexted, res } = run(loopbackCorsGuard({ env: {} }), mkReq({ host: 'localhost:5178' }))
  assert.equal(nexted, true)
  assert.equal(res.headers['access-control-allow-origin'], undefined, 'nothing to echo')
})

test('extra origins can be allowed via DASH_ALLOWED_ORIGINS', () => {
  const mw = loopbackCorsGuard({ env: { DASH_ALLOWED_ORIGINS: 'http://dash.local:5178' } })
  assert.equal(run(mw, mkReq({ origin: 'http://dash.local:5178' })).nexted, true)
  assert.equal(run(mw, mkReq({ origin: 'http://dash.local:9999' })).nexted, false)
})

test('a permitted OPTIONS preflight is answered 204 without reaching the route', () => {
  const { nexted, res } = run(loopbackCorsGuard({ env: {} }), mkReq({ origin: 'http://127.0.0.1:5173' }, { method: 'OPTIONS' }))
  assert.equal(nexted, false)
  assert.equal(res.statusCode, 204)
  assert.equal(res.ended, true)
  assert.equal(res.headers['access-control-allow-origin'], 'http://127.0.0.1:5173')
})

test('the CORS guard defaults to guarding', () => {
  assert.equal(run(loopbackCorsGuard(), mkReq({ origin: 'https://evil.example' })).nexted, false)
  assert.equal(run(loopbackCorsGuard({ env: {}, enabled: false }), mkReq({ origin: 'https://evil.example' })).nexted, true)
})

// ---------------------------------------------------------------------------------------------
// tokenGate

test('with no token configured the gate passes everything through — optional by design', () => {
  const mw = tokenGate({ env: {} })
  assert.equal(mw.configured, false)
  assert.equal(run(mw, mkReq({})).nexted, true)
  assert.equal(run(mw, mkReq({ 'x-dashboard-token': 'anything' })).nexted, true)
})

test('a correct token is accepted from either header form', () => {
  const mw = tokenGate({ token: 's3cret', env: {} })
  assert.equal(mw.configured, true)
  assert.equal(run(mw, mkReq({ 'x-dashboard-token': 's3cret' })).nexted, true)
  assert.equal(run(mw, mkReq({ authorization: 'Bearer s3cret' })).nexted, true)
  assert.equal(run(mw, mkReq({ authorization: 'bearer s3cret' })).nexted, true, 'scheme is case-insensitive')
})

test('an incorrect token is rejected with 403 and instructions', () => {
  const { nexted, res } = run(tokenGate({ token: 's3cret', env: {} }), mkReq({ 'x-dashboard-token': 'wrong' }))
  assert.equal(nexted, false)
  assert.equal(res.statusCode, 403)
  assert.equal(res.body.error, TOKEN_DENIED)
  assert.match(res.body.reason, /does not match/)
  assert.match(res.body.howToPermit, /DASH_TOKEN/)
})

test('an absent token is rejected once a token is configured', () => {
  const { nexted, res } = run(tokenGate({ token: 's3cret', env: {} }), mkReq({}))
  assert.equal(nexted, false)
  assert.equal(res.statusCode, 403)
  assert.match(res.body.reason, /presented none/)
})

test('the token gate reads DASH_TOKEN from the environment', () => {
  const mw = tokenGate({ env: { DASH_TOKEN: 'from-env' } })
  assert.equal(mw.configured, true)
  assert.equal(run(mw, mkReq({ 'x-dashboard-token': 'from-env' })).nexted, true)
  assert.equal(run(mw, mkReq({ 'x-dashboard-token': 'from-env-x' })).nexted, false)
})

test('safeEqual compares in constant time and survives mismatched lengths', () => {
  // crypto.timingSafeEqual throws on unequal buffer lengths; hashing first is what stops that,
  // without leaking the token length through an early return.
  assert.equal(safeEqual('abc', 'abc'), true)
  assert.equal(safeEqual('abc', 'abcdefghijklmnop'), false)
  assert.equal(safeEqual('abcdefghijklmnop', 'abc'), false)
  assert.equal(safeEqual('', ''), true)
  assert.equal(safeEqual('abc', ''), false)
  assert.equal(safeEqual('abc', undefined), false)
  assert.equal(safeEqual(null, null), false)
  assert.doesNotThrow(() => safeEqual('a', 'a'.repeat(10000)))
})

test('a token gate with a very long wrong token rejects rather than throwing', () => {
  const { nexted, res } = run(tokenGate({ token: 'short', env: {} }), mkReq({ 'x-dashboard-token': 'x'.repeat(5000) }))
  assert.equal(nexted, false)
  assert.equal(res.statusCode, 403)
})

test('presentedToken prefers the dedicated header and tolerates junk Authorization values', () => {
  assert.equal(presentedToken(mkReq({ 'x-dashboard-token': ' tok ' })), 'tok')
  assert.equal(presentedToken(mkReq({ authorization: 'Bearer  tok ' })), 'tok')
  assert.equal(presentedToken(mkReq({ authorization: 'Basic abc' })), '')
  assert.equal(presentedToken(mkReq({})), '')
  assert.equal(presentedToken(undefined), '')
})

// ---------------------------------------------------------------------------------------------
// bindHost

test('bindHost defaults to loopback and is overridable by DASH_BIND_HOST', () => {
  assert.equal(DEFAULT_BIND_HOST, '127.0.0.1')
  assert.equal(bindHost({}), '127.0.0.1')
  assert.equal(bindHost({ DASH_BIND_HOST: '0.0.0.0' }), '0.0.0.0')
  assert.equal(bindHost({ DASH_BIND_HOST: '  ' }), '127.0.0.1', 'a blank override is an accident, not consent to expose')
  assert.equal(bindHost(undefined), bindHost(process.env))
})

test('isExposedBind flags binds that reach beyond this machine', () => {
  assert.equal(isExposedBind('127.0.0.1'), false)
  assert.equal(isExposedBind('::1'), false)
  assert.equal(isExposedBind('localhost'), false)
  assert.equal(isExposedBind('0.0.0.0'), true)
  assert.equal(isExposedBind('::'), true)
  assert.equal(isExposedBind('192.168.1.10'), true)
})

// ---------------------------------------------------------------------------------------------
// composition

test('securityMiddleware returns the three guards in order, each usable on its own', () => {
  const stack = securityMiddleware({ env: {}, token: { token: 'tok' } })
  assert.equal(stack.length, 3)

  // A rebinding request dies at the first guard and never reaches the token check.
  const res1 = mkRes()
  let reached = 0
  stack[0](mkReq({ host: 'evil.example' }), res1, () => { reached++ })
  assert.equal(reached, 0)
  assert.equal(res1.statusCode, 403)

  // A good local request with the right token traverses all three.
  const req = mkReq({ host: 'localhost:5178', origin: 'http://localhost:5178', 'x-dashboard-token': 'tok' })
  let passed = 0
  for (const mw of stack) mw(req, mkRes(), () => { passed++ })
  assert.equal(passed, 3)
})
