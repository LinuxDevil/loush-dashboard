// Outbound-network guard.
//
// The README claims this dashboard is local-first with zero telemetry. That claim is normally
// only as good as the reader's trust. This module turns it into something a machine checks:
// every socket this process opens has to be pointed at loopback, and anything else is recorded
// (mode 'report') or refused (mode 'block').
//
// ---------------------------------------------------------------------------------------
// SCOPE — read this before quoting the guarantee anywhere user-facing.
//
// This patches `net.Socket.prototype.connect` in the CURRENT V8 isolate. That means it covers
// this process only. Specifically it does NOT cover:
//   - child processes. If the dashboard spawns Claude Code, a git subprocess, npm, or anything
//     else, that child has its own Node/native runtime and this guard is invisible to it.
//   - worker threads started before install, or native addons that open sockets from C++
//     without going through net.Socket.
//   - DNS lookups themselves (those go out over UDP via c-ares/getaddrinfo, not net.Socket),
//     so a hostname that never connects can still have leaked to a resolver.
//   - the browser tab. The frontend is a separate process on the user's machine.
//
// So the honest phrasing of what an installed guard buys you is:
//   "this process makes no outbound connections"
// and NOT "nothing this app does reaches the network". Do not upgrade that sentence.
// ---------------------------------------------------------------------------------------

import net from 'node:net'

// Exact-match allowlist from the spec. Everything else is compared against these after
// normalisation (case, brackets, IPv6 zone id, trailing dot).
export const LOOPBACK_HOSTS = new Set([
  '127.0.0.1',
  'localhost',
  '::1',
  '0.0.0.0',
  '0:0:0:0:0:0:0:1', // fully expanded ::1, as some resolvers hand it back
  '::ffff:127.0.0.1', // IPv4-mapped IPv6 loopback
  '::', // the IPv6 unspecified address, the ::-form counterpart of 0.0.0.0
])

// When net.connect is given a port with no host, Node itself defaults to 'localhost'.
// We mirror that default at the parsing layer rather than inside isLoopback, so isLoopback
// can stay strict about what it was actually handed.
const DEFAULT_HOST = 'localhost'

const normaliseHost = host => {
  if (typeof host !== 'string') return null
  let h = host.trim().toLowerCase()
  if (h === '') return null
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1) // [::1]:5173 style
  const zone = h.indexOf('%') // IPv6 scope id, e.g. fe80::1%lo0
  if (zone !== -1) h = h.slice(0, zone)
  if (h.length > 1 && h.endsWith('.')) h = h.slice(0, -1) // fully-qualified 'localhost.'
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
  // The whole 127.0.0.0/8 block is loopback per RFC 1122, not just 127.0.0.1; tools bind
  // 127.0.0.2+ often enough that rejecting them would be wrong rather than cautious.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) && h.split('.').every(o => Number(o) <= 255)
}

// --- installed state -------------------------------------------------------------------
// Module-level, because the thing being patched (a prototype method) is module-level too.
// Holding the original in exactly one place is what makes uninstall able to be exact.
let installed = null
const violations = []

/** Recorded connection attempts that were not loopback. Returns a copy — callers must not
 *  be able to edit the audit log by mutating what they were handed. */
export const getViolations = () => violations.map(v => ({ ...v }))

export const clearViolations = () => {
  violations.length = 0
}

/** Whether a guard is currently patched in. */
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
    // An IPC socket never leaves the machine, so there is nothing here to guard.
    if (typeof a.path === 'string' && a.path !== '') return { host: null, port: null, ipc: true }
    return { host: a.host === undefined ? DEFAULT_HOST : a.host, port: a.port ?? null, ipc: false }
  }

  if (typeof a === 'string') {
    // A numeric string is a port; anything else in this position is an IPC path.
    if (/^\d+$/.test(a.trim())) return { host: typeof b === 'string' ? b : DEFAULT_HOST, port: Number(a), ipc: false }
    return { host: null, port: null, ipc: true }
  }

  if (typeof a === 'number') {
    return { host: typeof b === 'string' ? b : DEFAULT_HOST, port: a, ipc: false }
  }

  // Shape we do not recognise. Fail closed: report it as a non-loopback attempt with a null
  // host rather than waving it through because we could not read it.
  return { host: null, port: null, ipc: false }
}

const record = (host, port, opts) => {
  const v = {
    host: typeof host === 'string' ? host : null,
    port: typeof port === 'number' || typeof port === 'string' ? port : null,
    at: new Date().toISOString(),
    mode: opts.mode,
    // The stack is the whole point of the audit trail: "something phoned home" is not
    // actionable, "this line in this dependency phoned home" is. Recorded at the call site
    // so the frames still lead back to the caller rather than into the guard.
    stack: new Error('outbound connection attempt').stack,
  }
  violations.push(v)
  if (typeof opts.onViolation === 'function') {
    // A broken reporter must not take out the connection path it was observing.
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
  // The live config lives in a cell the patched function closes over, not in the module-level
  // `installed` record. A stray reference to the patched function can outlive uninstall, and
  // reading through `installed` would then dereference null at the worst possible moment.
  const cell = { config }

  function guardedConnect(...args) {
    const { host, port, ipc } = parseConnectArgs(args)
    const normalised = normaliseHost(host)
    const permitted = ipc || isLoopback(host) || (normalised !== null && cell.config.allow.has(normalised))

    if (!permitted) {
      record(host, port, cell.config)
      if (cell.config.mode === 'block') {
        // Synchronous throw rather than a deferred 'error' event. It is louder and it is
        // deterministic; emitting 'error' on a socket with no error listener would take the
        // process down anyway, just further from the call that caused it.
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
