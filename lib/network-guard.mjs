// ---------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------

import net from 'node:net'

export const LOOPBACK_HOSTS = new Set([
  '127.0.0.1',
  'localhost',
  '::1',
  '0.0.0.0',
  '0:0:0:0:0:0:0:1',
  '::ffff:127.0.0.1',
  '::',
])

const DEFAULT_HOST = 'localhost'

const normaliseHost = host => {
  if (typeof host !== 'string') return null
  let h = host.trim().toLowerCase()
  if (h === '') return null
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1)
  const zone = h.indexOf('%')
  if (zone !== -1) h = h.slice(0, zone)
  if (h.length > 1 && h.endsWith('.')) h = h.slice(0, -1)
  return h === '' ? null : h
}

/**
 * Is this host a loopback destination?
 *
 * Pure and exported so the classification can be tested without touching a socket.
 *
 * "Unknown is a value": anything we cannot parse — a non-string, an empty string, a Buffer,
 * undefined, a host that arrived in a shape we did not anticipate — is deliberately reported
 * as NOT loopback. A guard that guesses "probably local" on input it does not understand is
 * worse than no guard, because it launders an unknown into a reassuring answer. Failing closed
 * means the worst case is a false violation record, which a human can read and dismiss.
 */
export const isLoopback = host => {
  const h = normaliseHost(host)
  if (h === null) return false
  if (LOOPBACK_HOSTS.has(h)) return true
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) && h.split('.').every(o => Number(o) <= 255)
}

// --- installed state -------------------------------------------------------------------
let installed = null
const violations = []

/** Recorded connection attempts that were not loopback. Returns a copy — callers must not
 *  be able to edit the audit log by mutating what they were handed. */
export const getViolations = () => violations.map(v => ({ ...v }))

export const clearViolations = () => {
  violations.length = 0
}

export const isInstalled = () => installed !== null

/**
 * Pull the destination out of the several shapes net.Socket#connect accepts:
 *   connect(options[, listener])          — options.host/options.port, or options.path for IPC
 *   connect(path[, listener])             — a filesystem path (unix socket / windows pipe)
 *   connect(port[, host][, listener])
 *
 * Returns { host, port, ipc }. `ipc: true` means there is no network destination at all.
 */
export const parseConnectArgs = args => {
  const [a, b] = args

  if (a !== null && typeof a === 'object') {
    if (typeof a.path === 'string' && a.path !== '') return { host: null, port: null, ipc: true }
    return { host: a.host === undefined ? DEFAULT_HOST : a.host, port: a.port ?? null, ipc: false }
  }

  if (typeof a === 'string') {
    if (/^\d+$/.test(a.trim())) return { host: typeof b === 'string' ? b : DEFAULT_HOST, port: Number(a), ipc: false }
    return { host: null, port: null, ipc: true }
  }

  if (typeof a === 'number') {
    return { host: typeof b === 'string' ? b : DEFAULT_HOST, port: a, ipc: false }
  }

  return { host: null, port: null, ipc: false }
}

const record = (host, port, opts) => {
  const v = {
    host: typeof host === 'string' ? host : null,
    port: typeof port === 'number' || typeof port === 'string' ? port : null,
    at: new Date().toISOString(),
    mode: opts.mode,
    stack: new Error('outbound connection attempt').stack,
  }
  violations.push(v)
  if (typeof opts.onViolation === 'function') {
    try {
      opts.onViolation(v)
    } catch {}
  }
  return v
}

export class NetworkGuardError extends Error {
  constructor(host, port) {
    super(`network-guard: blocked outbound connection to ${host ?? '<unparseable host>'}:${port ?? '?'} — only loopback destinations are permitted`)
    this.name = 'NetworkGuardError'
    this.code = 'ERR_NETWORK_GUARD_BLOCKED'
    this.host = host ?? null
    this.port = port ?? null
  }
}

/**
 * Install the guard.
 *
 * @param {object}   [opts]
 * @param {string[]} [opts.allow]        extra hosts to treat as permitted, exact match after
 *                                       normalisation (e.g. a LAN address the user opted into)
 * @param {'block'|'report'} [opts.mode] 'report' (default) observes and records without
 *                                       interfering; 'block' throws instead of connecting
 * @param {function} [opts.onViolation]  called with each recorded violation
 * @returns handle with { uninstall, getViolations, mode, allow }
 *
 * Default mode is 'report' on purpose. Someone adopting this needs to be able to see what
 * their install actually talks to before they let it start breaking connections; a guard that
 * defaults to blocking gets uninstalled the first time it takes out something legitimate.
 *
 * Idempotent: calling it again while installed updates the options on the existing patch and
 * returns the same handle. It never wraps the wrapper — double-patching would make the saved
 * "original" be our own function, and uninstall could then never restore the real one.
 */
export const installNetworkGuard = (opts = {}) => {
  const config = {
    mode: opts.mode === 'block' ? 'block' : 'report',
    allow: new Set((opts.allow ?? []).map(normaliseHost).filter(h => h !== null)),
    onViolation: opts.onViolation,
  }

  if (installed) {
    installed.cell.config = config
    installed.handle.mode = config.mode
    installed.handle.allow = [...config.allow]
    return installed.handle
  }

  const original = net.Socket.prototype.connect
  const cell = { config }

  function guardedConnect(...args) {
    const { host, port, ipc } = parseConnectArgs(args)
    const normalised = normaliseHost(host)
    const permitted = ipc || isLoopback(host) || (normalised !== null && cell.config.allow.has(normalised))

    if (!permitted) {
      record(host, port, cell.config)
      if (cell.config.mode === 'block') {
        throw new NetworkGuardError(typeof host === 'string' ? host : null, port)
      }
    }

    return original.apply(this, args)
  }

  net.Socket.prototype.connect = guardedConnect

  const handle = {
    mode: config.mode,
    allow: [...config.allow],
    getViolations,
    uninstall: uninstallNetworkGuard,
  }

  installed = { original, patched: guardedConnect, cell, handle }
  return handle
}

/**
 * Remove the guard, restoring net.Socket.prototype.connect to exactly the function that was
 * there at install time. Returns true if something was uninstalled.
 *
 * Exactness matters beyond tidiness: tests install and uninstall around each case, and a guard
 * that leaves a wrapper behind would make every later test in the process run through a stale
 * patch — i.e. the suite would silently become order-dependent.
 *
 * If someone else patched connect after we did, we leave their function alone rather than
 * clobbering it, and just drop our own state; stomping a later patch is the more destructive
 * of the two failure modes.
 */
export const uninstallNetworkGuard = () => {
  if (!installed) return false
  if (net.Socket.prototype.connect === installed.patched) {
    net.Socket.prototype.connect = installed.original
  }
  installed = null
  return true
}
