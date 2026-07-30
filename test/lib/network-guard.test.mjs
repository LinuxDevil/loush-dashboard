import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import {
  isLoopback,
  parseConnectArgs,
  installNetworkGuard,
  uninstallNetworkGuard,
  getViolations,
  clearViolations,
  isInstalled,
  NetworkGuardError,
} from '../../lib/network-guard.mjs'

const REAL_CONNECT = net.Socket.prototype.connect

const withSpy = (fn, opts = {}) => {
  const calls = []
  const spy = function (...args) {
    calls.push(args)
    return this
  }
  net.Socket.prototype.connect = spy
  clearViolations()
  const handle = installNetworkGuard(opts)
  try {
    return fn({ calls, spy, handle, socket: Object.create(net.Socket.prototype) })
  } finally {
    uninstallNetworkGuard()
    assert.equal(net.Socket.prototype.connect, spy, 'uninstall must restore the function it replaced')
    net.Socket.prototype.connect = REAL_CONNECT
    clearViolations()
  }
}

test('the four allowlisted forms are loopback', () => {
  assert.equal(isLoopback('127.0.0.1'), true)
  assert.equal(isLoopback('localhost'), true)
  assert.equal(isLoopback('::1'), true)
  assert.equal(isLoopback('0.0.0.0'), true)
})

test('loopback recognition survives the shapes hosts actually arrive in', () => {
  assert.equal(isLoopback('LocalHost'), true, 'hostnames are case-insensitive')
  assert.equal(isLoopback(' 127.0.0.1 '), true)
  assert.equal(isLoopback('[::1]'), true, 'bracketed IPv6 literal')
  assert.equal(isLoopback('localhost.'), true, 'fully-qualified trailing dot')
  assert.equal(isLoopback('::ffff:127.0.0.1'), true, 'IPv4-mapped IPv6')
  assert.equal(isLoopback('0:0:0:0:0:0:0:1'), true, 'expanded ::1')
  assert.equal(isLoopback('127.0.0.2'), true, 'the whole 127/8 block is loopback per RFC 1122')
})

test('lookalike hosts are not loopback', () => {
  assert.equal(isLoopback('127.0.0.1.evil.com'), false)
  assert.equal(isLoopback('localhost.evil.com'), false)
  assert.equal(isLoopback('notlocalhost'), false)
  assert.equal(isLoopback('10.0.0.1'), false)
  assert.equal(isLoopback('192.168.1.5'), false)
  assert.equal(isLoopback('api.anthropic.com'), false)
  assert.equal(isLoopback('127.0.0.999'), false, 'octets above 255 are not an address')
})

test('an unparseable host is treated as non-loopback (fail closed)', () => {
  assert.equal(isLoopback(undefined), false)
  assert.equal(isLoopback(null), false)
  assert.equal(isLoopback(''), false)
  assert.equal(isLoopback('   '), false)
  assert.equal(isLoopback(127), false)
  assert.equal(isLoopback({ host: '127.0.0.1' }), false)
  assert.equal(isLoopback(Buffer.from('127.0.0.1')), false)
})

test('connect arguments are read in all the shapes node accepts', () => {
  assert.deepEqual(parseConnectArgs([{ host: 'example.com', port: 443 }]), { host: 'example.com', port: 443, ipc: false })
  assert.deepEqual(parseConnectArgs([443, 'example.com']), { host: 'example.com', port: 443, ipc: false })
  assert.deepEqual(parseConnectArgs(['443', 'example.com']), { host: 'example.com', port: 443, ipc: false })
  assert.deepEqual(parseConnectArgs([5173, () => {}]), { host: 'localhost', port: 5173, ipc: false })
  assert.deepEqual(parseConnectArgs([{ port: 5173 }]), { host: 'localhost', port: 5173, ipc: false }, 'node itself defaults a missing host to localhost')
})

test('an IPC path is not a network destination', () => {
  assert.deepEqual(parseConnectArgs(['/var/run/docker.sock']), { host: null, port: null, ipc: true })
  assert.deepEqual(parseConnectArgs([{ path: '/tmp/x.sock' }]), { host: null, port: null, ipc: true })
})

test('report mode observes without blocking — the safe default for adoption', () => {
  withSpy(({ calls, socket }) => {
    socket.connect({ host: 'api.example.com', port: 443 })
    assert.equal(calls.length, 1, 'the connection still goes through in report mode')
    assert.equal(getViolations().length, 1, 'but it is recorded')
  })
})

test('report is the default mode when none is given', () => {
  withSpy(({ handle, calls, socket }) => {
    assert.equal(handle.mode, 'report')
    socket.connect(443, 'api.example.com')
    assert.equal(calls.length, 1)
  })
})

test('block mode refuses a non-loopback destination', () => {
  withSpy(({ calls, socket }) => {
    assert.throws(() => socket.connect({ host: 'api.example.com', port: 443 }), NetworkGuardError)
    assert.equal(calls.length, 0, 'the original connect must never be reached')
    assert.equal(getViolations().length, 1)
  }, { mode: 'block' })
})

test('loopback traffic passes untouched in block mode', () => {
  withSpy(({ calls, socket }) => {
    socket.connect({ host: '127.0.0.1', port: 5173 })
    socket.connect(3000, 'localhost')
    socket.connect({ port: 8080 })
    socket.connect({ path: '/tmp/x.sock' })
    assert.equal(calls.length, 4)
    assert.deepEqual(getViolations(), [], 'local-first traffic is not noise in the audit log')
  }, { mode: 'block' })
})

test('a violation records host, port, time and a stack to investigate with', () => {
  withSpy(({ socket }) => {
    socket.connect({ host: 'telemetry.example.com', port: 443 })
    const [v] = getViolations()
    assert.equal(v.host, 'telemetry.example.com')
    assert.equal(v.port, 443)
    assert.ok(!Number.isNaN(Date.parse(v.at)), 'at is an ISO timestamp')
    assert.equal(typeof v.stack, 'string')
    assert.ok(v.stack.includes('network-guard.test'), 'the stack leads back to the call site')
  })
})

test('getViolations hands back a copy, so the audit log cannot be edited by a caller', () => {
  withSpy(({ socket }) => {
    socket.connect({ host: 'evil.example.com', port: 443 })
    const first = getViolations()
    first[0].host = '127.0.0.1'
    first.length = 0
    assert.equal(getViolations().length, 1)
    assert.equal(getViolations()[0].host, 'evil.example.com')
  })
})

test('onViolation is notified, and a throwing reporter cannot break the connection path', () => {
  const seen = []
  withSpy(({ calls, socket }) => {
    socket.connect({ host: 'a.example.com', port: 80 })
    socket.connect({ host: 'b.example.com', port: 80 })
    assert.deepEqual(seen.map(v => v.host), ['a.example.com', 'b.example.com'])
    assert.equal(calls.length, 2, 'the reporter throwing must not take out the socket')
  }, {
    onViolation: v => {
      seen.push(v)
      throw new Error('reporter is broken')
    },
  })
})

test('an extra allowed host is permitted without becoming loopback', () => {
  withSpy(({ calls, socket }) => {
    socket.connect({ host: 'MyNas.local', port: 8384 })
    assert.equal(calls.length, 1)
    assert.deepEqual(getViolations(), [])
    assert.equal(isLoopback('mynas.local'), false, 'allowlisting is opt-in trust, not a claim of locality')
  }, { mode: 'block', allow: ['mynas.local'] })
})

test('an unrecognised connect signature is recorded rather than waved through', () => {
  withSpy(({ socket }) => {
    assert.throws(() => socket.connect(), NetworkGuardError)
    const [v] = getViolations()
    assert.equal(v.host, null, 'a host we could not read is null, not a guess')
  }, { mode: 'block' })
})

test('installing twice does not double-patch or lose the original', () => {
  const spy = function () { return this }
  net.Socket.prototype.connect = spy
  try {
    installNetworkGuard({ mode: 'report' })
    const afterFirst = net.Socket.prototype.connect
    const handle = installNetworkGuard({ mode: 'block' })
    assert.equal(net.Socket.prototype.connect, afterFirst, 'the second install must not wrap the wrapper')
    assert.equal(handle.mode, 'block', 'but it does update the live options')
    uninstallNetworkGuard()
    assert.equal(net.Socket.prototype.connect, spy, 'restoring is exact even after a double install')
  } finally {
    net.Socket.prototype.connect = REAL_CONNECT
    uninstallNetworkGuard()
    clearViolations()
  }
})

test('uninstall restores the prototype exactly, so tests never become order-dependent', () => {
  assert.equal(isInstalled(), false)
  const before = net.Socket.prototype.connect
  const handle = installNetworkGuard()
  assert.notEqual(net.Socket.prototype.connect, before, 'install replaced the method')
  assert.equal(isInstalled(), true)
  assert.equal(handle.uninstall(), true)
  assert.equal(net.Socket.prototype.connect, before)
  assert.equal(isInstalled(), false)
  assert.equal(uninstallNetworkGuard(), false, 'uninstalling twice is a no-op, not an error')
})

test('a guard removed mid-flight leaves no live patch behind', () => {
  const spy = function () { return this }
  net.Socket.prototype.connect = spy
  try {
    installNetworkGuard({ mode: 'block' })
    const patched = net.Socket.prototype.connect
    uninstallNetworkGuard()
    assert.doesNotThrow(() => patched.call(Object.create(net.Socket.prototype), { host: '127.0.0.1', port: 1 }))
  } finally {
    net.Socket.prototype.connect = REAL_CONNECT
    uninstallNetworkGuard()
    clearViolations()
  }
})
