// lib/open-folder.mjs — reveal a folder in the OS file manager.
//
// THREAT MODEL (read this before changing anything here)
// This function takes a path from an HTTP request body and launches a program. That makes it the
// highest-risk code in this batch. Two failure modes to keep closed:
//
//  1. COMMAND INJECTION. There is no shell here, ever. `execFile(cmd, [path])` with `shell:false`
//     passes the path as a single argv element, so `/tmp/x; rm -rf ~` is a directory name with a
//     semicolon in it and nothing more. Building `open "${dir}"` and handing it to a shell would make
//     every quote in a filename an escape hatch. This is why there is no template literal below.
//
//  2. ARBITRARY-FOLDER DISCLOSURE. `xdg-open ~/.ssh` is not a code-execution bug, it is still a bug:
//     the dashboard would open any directory on the machine on request, and on macOS `open` will
//     happily LAUNCH an application bundle. So the target must be inside a configured project root.
//     The allowlist check runs on the REALPATH of the target and the REALPATH of each root, which is
//     what makes both `../../..` traversal and a symlink planted inside a project root fail: a
//     symlink at <root>/escape -> /etc resolves to /etc, which is under no root.
//
// Roots are a PARAMETER, not read from disk here — the caller owns configuration, and a module that
// silently defaults its own allowlist is a module whose allowlist nobody reviews. No roots => refuse.
//
// Never throws. Every refusal names the check that failed.

import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'

export const OPEN_LIMITS = Object.freeze({
  timeoutMs: 5000,       // a file manager that never returns must not pin an HTTP request
  maxPathLength: 4096,   // PATH_MAX; longer is refused rather than passed to execve
  maxRoots: 200,
})

/**
 * The per-platform launcher table. Explicit, so an unknown platform is REFUSED rather than guessed
 * at with whatever happens to be on PATH.
 *   darwin — `open -R <dir>` reveals the item in Finder (selects it) instead of opening a new window
 *            rooted inside it. `open` is /usr/bin/open, always present.
 *   win32  — `explorer.exe <dir>`. NOTE: explorer.exe exits with code 1 even on success, so a
 *            non-zero exit is NOT treated as failure on this platform (see `successExitCodes`).
 *   linux  — `xdg-open <dir>`. Part of xdg-utils, which is NOT guaranteed to be installed; ENOENT
 *            from execFile is reported as `launcher-not-installed` so the UI can say what to install.
 */
export const PLATFORM_COMMANDS = Object.freeze({
  darwin: { command: 'open', args: dir => ['-R', dir], successExitCodes: [0], note: 'reveals in Finder' },
  win32: { command: 'explorer.exe', args: dir => [dir], successExitCodes: [0, 1], note: 'explorer.exe returns 1 on success' },
  linux: { command: 'xdg-open', args: dir => [dir], successExitCodes: [0], note: 'requires xdg-utils' },
})

export const SUPPORTED_PLATFORMS = Object.freeze(Object.keys(PLATFORM_COMMANDS))

const refuse = (reason, check, extra = {}) => ({ ok: false, refused: true, reason, check, limits: OPEN_LIMITS, ...extra })

/**
 * Resolve `target` and prove it is inside one of `roots`. Pure — no process is launched.
 * Exported separately so a route can validate without opening, and so every refusal path is testable.
 *
 * @param {string} target client-supplied path
 * @param {string[]} roots configured project roots
 * @returns {{ok:true, resolved:string, root:string, rel:string, viaSymlink:boolean, rootsSkipped:object[]}
 *          | {ok:false, refused:true, reason:string, check:string}}
 */
export function resolveOpenTarget(target, roots) {
  if (typeof target !== 'string' || target.trim() === '') return refuse('target-required', 'target-type')
  // A NUL truncates the string inside execve/openat, so `/allowed\0/../../etc` could pass a JS-level
  // check and then act as `/allowed`. Refuse outright rather than sanitise.
  if (target.includes('\0')) return refuse('target-contains-nul', 'target-nul')
  if (target.length > OPEN_LIMITS.maxPathLength) {
    return refuse('target-too-long', 'target-length', { max: OPEN_LIMITS.maxPathLength, given: target.length })
  }

  if (!Array.isArray(roots)) return refuse('roots-must-be-array', 'roots-type')
  // Fail CLOSED. An empty allowlist means "nothing is allowed", never "everything is allowed" —
  // getting this backwards is how a config-loading bug becomes a filesystem browser.
  if (roots.length === 0) return refuse('no-roots-configured', 'roots-empty')
  if (roots.length > OPEN_LIMITS.maxRoots) return refuse('too-many-roots', 'roots-count', { max: OPEN_LIMITS.maxRoots, given: roots.length })

  const realRoots = []
  const rootsSkipped = []
  for (const r of roots) {
    if (typeof r !== 'string' || r === '' || r.includes('\0')) { rootsSkipped.push({ root: String(r), reason: 'root-invalid' }); continue }
    try {
      const rp = fs.realpathSync(r)
      if (!fs.statSync(rp).isDirectory()) { rootsSkipped.push({ root: r, reason: 'root-not-a-directory' }); continue }
      realRoots.push({ configured: r, real: rp })
    } catch (e) {
      // A misconfigured root is REPORTED, not silently dropped — otherwise the user's folder button
      // just stops working with no explanation.
      rootsSkipped.push({ root: r, reason: e?.code === 'ENOENT' ? 'root-not-found' : 'root-unresolvable', errno: e?.code || null })
    }
  }
  if (realRoots.length === 0) return refuse('no-usable-roots', 'roots-unresolvable', { rootsSkipped })

  const abs = path.resolve(target)
  let lstat = null
  try { lstat = fs.lstatSync(abs) } catch (e) {
    return e?.code === 'ENOENT'
      ? refuse('target-not-found', 'target-exists')
      : refuse('target-unreadable', 'target-stat', { errno: e?.code || null })
  }
  const viaSymlink = lstat.isSymbolicLink()

  let resolved
  try { resolved = fs.realpathSync(abs) } catch (e) {
    return refuse(e?.code === 'ENOENT' ? 'target-broken-symlink' : 'target-unresolvable', 'target-realpath', { errno: e?.code || null })
  }

  let st
  try { st = fs.statSync(resolved) } catch (e) { return refuse('target-unreadable', 'target-stat', { errno: e?.code || null }) }
  if (!st.isDirectory()) return refuse('target-not-a-directory', 'target-kind', { resolved })

  // Containment on the RESOLVED path. `path.relative` + the separator check is used instead of
  // `startsWith`, because `/home/user/project-secrets`.startsWith(`/home/user/project`) is true and
  // that would allow a sibling directory whose name merely shares a prefix.
  for (const r of realRoots) {
    const rel = path.relative(r.real, resolved)
    if (rel === '') return { ok: true, resolved, root: r.real, configuredRoot: r.configured, rel: '.', viaSymlink, rootsSkipped }
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
      return { ok: true, resolved, root: r.real, configuredRoot: r.configured, rel, viaSymlink, rootsSkipped }
    }
  }
  return refuse('outside-allowed-roots', 'containment', {
    resolved, viaSymlink, roots: realRoots.map(r => r.real), rootsSkipped,
  })
}

/**
 * Reveal `target` in the OS file manager.
 *
 * @param {string} target
 * @param {{roots:string[], platform?:string, timeoutMs?:number, execFileImpl?:Function}} opts
 *        `platform` and `execFileImpl` exist so every branch — including win32 and darwin — is
 *        testable on a Linux CI box without actually launching a file manager.
 * @returns {Promise<object>} always resolves; never rejects, never throws.
 */
export async function openFolder(target, opts = {}) {
  const platform = typeof opts.platform === 'string' ? opts.platform : process.platform
  const entry = PLATFORM_COMMANDS[platform]

  // Platform is checked FIRST so an unsupported platform is a clear answer even when the path is
  // also bad — the user needs to know the feature does not exist here, not that their path is wrong.
  if (!entry) {
    return refuse('unsupported-platform', 'platform', { platform, supported: SUPPORTED_PLATFORMS })
  }

  const check = resolveOpenTarget(target, opts.roots)
  if (!check.ok) return { ...check, platform }

  const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : OPEN_LIMITS.timeoutMs
  const run = typeof opts.execFileImpl === 'function' ? opts.execFileImpl : execFile
  const argv = entry.args(check.resolved)

  const result = await new Promise(resolve => {
    let settled = false
    const done = v => { if (!settled) { settled = true; resolve(v) } }
    try {
      // shell:false is the default for execFile and is stated explicitly because it is the property
      // the whole module depends on. Do not add `shell:true` to "support paths with spaces" — argv
      // arrays already handle spaces; a shell would reintroduce injection.
      const child = run(entry.command, argv, { timeout: timeoutMs, shell: false, windowsHide: true },
        (error, stdout, stderr) => {
          if (error) {
            const code = error.code
            if (code === 'ENOENT') return done(refuse('launcher-not-installed', 'launcher', { platform, command: entry.command, note: entry.note }))
            if (error.killed || code === 'ETIMEDOUT') return done(refuse('launcher-timeout', 'launcher', { platform, command: entry.command, timeoutMs }))
            const exit = typeof code === 'number' ? code : null
            if (exit !== null && entry.successExitCodes.includes(exit)) return done(null) // e.g. explorer.exe -> 1
            return done(refuse('launcher-failed', 'launcher', {
              platform, command: entry.command, exitCode: exit,
              stderr: String(stderr || '').slice(0, 2000), stderrTruncated: String(stderr || '').length > 2000,
            }))
          }
          done(null)
        })
      if (child && typeof child.on === 'function') child.on('error', () => { /* surfaced via the callback; a second throw path must not escape */ })
    } catch (e) {
      done(refuse('launcher-spawn-threw', 'launcher', { platform, command: entry.command, errorMessage: String(e?.message || e) }))
    }
  })

  if (result) return result
  return {
    ok: true, refused: false, platform, command: entry.command, argv,
    resolved: check.resolved, root: check.root, rel: check.rel,
    viaSymlink: check.viaSymlink, rootsSkipped: check.rootsSkipped,
    limits: OPEN_LIMITS, timeoutMs,
  }
}
