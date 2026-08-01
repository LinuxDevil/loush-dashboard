import crypto from 'node:crypto'

// ---------------------------------------------------------------------------------------------

const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '::1', '0:0:0:0:0:0:0:1'])
const IPV4_LOOPBACK = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/**
 * Split a Host header into { host, port }, lower-cased, with IPv6 brackets stripped.
 * Returns null when the header is absent or unparseable — callers must treat null as "reject".
 */
export function parseHost(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return null
  if (s.startsWith('[')) {
    const close = s.indexOf(']')
    if (close < 0) return null
    const host = s.slice(1, close).toLowerCase()
    const rest = s.slice(close + 1)
    if (rest && !rest.startsWith(':')) return null
    return { host, port: rest.slice(1) || '' }
  }
  const colons = s.split(':')
  if (colons.length > 2) return { host: s.toLowerCase(), port: '' }
  if (colons.length === 2) {
    const [host, port] = colons
    if (!host) return null
    if (port && !/^\d+$/.test(port)) return null
    return { host: host.toLowerCase(), port }
  }
  return { host: s.toLowerCase(), port: '' }
}

export function isLoopbackHost(host) {
  const h = String(host ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (!h) return false
  if (LOOPBACK_NAMES.has(h)) return true
  const m = IPV4_LOOPBACK.exec(h)
  if (!m) return false
  return m.slice(1).every(o => Number(o) <= 255)
}

const splitList = v => String(v ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

// ---------------------------------------------------------------------------------------------

export const HOST_DENIED = 'Host header not allowed'

/**
 * hostHeaderGuard({ allow, env }) -> express middleware
 *
 * Rejects any request whose `Host` header is not a loopback name. Port is ignored by default, so
 * the guard keeps working when DASH_PORT changes or a proxy rewrites it — the *name* is the part
 * that carries the attack, not the number.
 *
 * Options:
 *   allow     extra hostnames to permit (array or comma-separated string). Ports in these entries
 *             are significant: `dash.local:5178` permits only that port, `dash.local` permits any.
 *   env       env object to read DASH_ALLOWED_HOSTS from (default process.env).
 *   enabled   set false to disable entirely. Defaults to true — safe by default.
 *
 * A request with NO Host header is rejected. HTTP/1.1 requires one; its absence means either a
 * malformed client or something deliberately trying to slip past a name check, and "unknown" is
 * not a value we can allowlist.
 */
export function hostHeaderGuard(opts = {}) {
  const { allow = [], env = process.env, enabled = true } = opts
  const extra = new Set([
    ...(Array.isArray(allow) ? allow.map(s => String(s).trim().toLowerCase()).filter(Boolean) : splitList(allow)),
    ...splitList(env?.DASH_ALLOWED_HOSTS),
  ])

  const permitted = raw => {
    const parsed = parseHost(raw)
    if (!parsed) return false
    if (isLoopbackHost(parsed.host)) return true
    const withPort = parsed.port ? `${parsed.host}:${parsed.port}` : parsed.host
    return extra.has(withPort) || extra.has(parsed.host)
  }

  const mw = (req, res, next) => {
    if (!enabled) return next()
    const raw = req.headers?.host ?? req.get?.('host')
    if (permitted(raw)) return next()
    return res.status(403).json({
      error: HOST_DENIED,
      host: raw ? String(raw) : null,
      reason: raw
        ? 'This dashboard only answers requests addressed to localhost, to prevent DNS-rebinding attacks from other websites open in your browser.'
        : 'The request carried no Host header, so it could not be checked against the allowlist.',
      allowed: ['localhost', '127.0.0.0/8', '::1', ...extra],
      howToPermit: 'Set DASH_ALLOWED_HOSTS to a comma-separated list of host names (e.g. DASH_ALLOWED_HOSTS=dash.local:5178) if you genuinely need to reach the dashboard under another name.',
    })
  }
  mw.permits = permitted
  return mw
}

// ---------------------------------------------------------------------------------------------

export const ORIGIN_DENIED = 'Origin not allowed'

/**
 * loopbackCorsGuard({ allow, env, enabled }) -> express middleware
 *
 * Only loopback origins may make cross-origin browser requests. Complements the Host guard: Host
 * catches the rebinding case (attacker name resolving to 127.0.0.1), Origin catches the ordinary
 * cross-site case (a page on https://evil.example fetching http://localhost:5178 directly).
 *
 * Requests with no `Origin` header are allowed through. That is deliberate and is not a hole:
 * browsers always attach Origin to cross-origin requests, so a missing Origin means a same-origin
 * navigation or a non-browser client (curl, the CLI), neither of which is the threat this guard
 * addresses — and both of which are already covered by the Host guard and the token gate.
 *
 * Sets Access-Control-Allow-Origin for permitted origins and answers OPTIONS preflights with 204.
 */
export function loopbackCorsGuard(opts = {}) {
  const {
    allow = [], env = process.env, enabled = true,
    methods = 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    headers = 'Content-Type,Authorization,X-Dashboard-Token,X-Access-Profile',
    credentials = true,
  } = opts
  const extra = new Set([
    ...(Array.isArray(allow) ? allow.map(s => String(s).trim().toLowerCase()).filter(Boolean) : splitList(allow)),
    ...splitList(env?.DASH_ALLOWED_ORIGINS),
  ])

  const permitted = origin => {
    const o = String(origin ?? '').trim()
    if (!o) return true
    if (extra.has(o.toLowerCase())) return true
    if (o === 'null') return false
    let url
    try { url = new URL(o) } catch { return false }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    return isLoopbackHost(url.hostname)
  }

  const mw = (req, res, next) => {
    if (!enabled) return next()
    const origin = req.headers?.origin ?? req.get?.('origin')
    if (!permitted(origin)) {
      return res.status(403).json({
        error: ORIGIN_DENIED,
        origin: origin ? String(origin) : null,
        reason: 'Only pages served from localhost may call this dashboard from a browser.',
        allowed: ['http(s)://localhost:*', 'http(s)://127.0.0.0/8:*', 'http(s)://[::1]:*', ...extra],
        howToPermit: 'Set DASH_ALLOWED_ORIGINS to a comma-separated list of origins (e.g. DASH_ALLOWED_ORIGINS=http://dash.local:5178).',
      })
    }
    if (origin) {
      res.set?.('Access-Control-Allow-Origin', String(origin))
      res.set?.('Vary', 'Origin')
      if (credentials) res.set?.('Access-Control-Allow-Credentials', 'true')
      res.set?.('Access-Control-Allow-Methods', methods)
      res.set?.('Access-Control-Allow-Headers', headers)
    }
    if (String(req.method || '').toUpperCase() === 'OPTIONS') return res.status(204).end?.()
    return next()
  }
  mw.permits = permitted
  return mw
}

// ---------------------------------------------------------------------------------------------

export const TOKEN_DENIED = 'Dashboard token required'

/**
 * Constant-time string comparison that tolerates unequal lengths.
 *
 * crypto.timingSafeEqual throws on differing buffer lengths, and length-checking first would leak
 * the token length through timing. Hashing both sides to a fixed 32 bytes makes the compared
 * buffers the same size whatever the inputs were, so exactly one constant-time comparison runs.
 */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const ha = crypto.createHash('sha256').update(a, 'utf8').digest()
  const hb = crypto.createHash('sha256').update(b, 'utf8').digest()
  return crypto.timingSafeEqual(ha, hb)
}

export function presentedToken(req) {
  const h = req?.headers || {}
  const get = n => h[n] ?? req?.get?.(n)
  const direct = get('x-dashboard-token')
  if (direct) return String(direct).trim()
  const auth = String(get('authorization') ?? '').trim()
  const m = /^bearer\s+(.+)$/i.exec(auth)
  if (m) return m[1].trim()
  return ''
}

/**
 * tokenGate({ token, env, enabled }) -> express middleware
 *
 * OPTIONAL BY DESIGN. When no token is configured — no `token` option and no DASH_TOKEN in the
 * environment — this middleware passes every request straight through. That is intentional: the
 * dashboard's baseline protection is the loopback bind plus the Host and Origin guards above, and
 * forcing a token on a single-user localhost tool would only train people to disable it. The gate
 * exists for users who share a machine or who have deliberately widened DASH_BIND_HOST.
 *
 * Once a token IS configured the gate is strict: every request must present it, via
 * `Authorization: Bearer <token>` or `x-dashboard-token: <token>`, compared in constant time.
 */
export function tokenGate(opts = {}) {
  const { env = process.env, enabled = true } = opts
  const token = String(opts.token ?? env?.DASH_TOKEN ?? '').trim()
  const configured = token.length > 0

  const permitted = req => !configured || safeEqual(presentedToken(req), token)

  const mw = (req, res, next) => {
    if (!enabled || !configured) return next()
    if (permitted(req)) return next()
    const presented = presentedToken(req)
    return res.status(403).json({
      error: TOKEN_DENIED,
      reason: presented
        ? 'The token presented does not match the configured dashboard token.'
        : 'A dashboard token is configured, but this request presented none.',
      howToPermit: 'Send the token as `Authorization: Bearer <token>` or `X-Dashboard-Token: <token>`. It is the value of DASH_TOKEN in the server environment; unset DASH_TOKEN to turn the gate off.',
    })
  }
  mw.configured = configured
  mw.permits = permitted
  return mw
}

// ---------------------------------------------------------------------------------------------

export const DEFAULT_BIND_HOST = '127.0.0.1'

/**
 * bindHost(env) -> the address to pass to app.listen().
 *
 * Defaults to 127.0.0.1 so a fresh install is not reachable from the LAN. DASH_BIND_HOST overrides
 * it for the genuine "I want to open this from my phone" case — an explicit, visible act. An empty
 * or whitespace-only value falls back to loopback rather than to 0.0.0.0, because a blank env var
 * is far more likely to be an accident than a request to expose the process.
 */
export function bindHost(env = process.env) {
  const v = String(env?.DASH_BIND_HOST ?? '').trim()
  return v || DEFAULT_BIND_HOST
}

export function isExposedBind(host = bindHost()) {
  const h = String(host).trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (!h) return false
  if (h === '0.0.0.0' || h === '::' || h === '*') return true
  return !isLoopbackHost(h)
}

/**
 * Convenience: all three guards in the order they should run, each independently skippable.
 * Kept as a plain array so a caller can splice or reorder rather than being forced into one shape.
 */
export function securityMiddleware(opts = {}) {
  const { host = {}, cors = {}, token = {}, env = process.env } = opts
  return [
    hostHeaderGuard({ env, ...host }),
    loopbackCorsGuard({ env, ...cors }),
    tokenGate({ env, ...token }),
  ]
}

export default securityMiddleware
