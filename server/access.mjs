// Access policy store and routes. The matrix itself lives in lib/access.mjs; this owns where it
// is persisted, how it is audited, and the middleware other routes can hang off.
//
// The file sits in ~/.claude/, never inside a project. That placement is the one idea worth
// keeping from NanoClaw — whose per-session container isolation is otherwise the wrong threat
// model for a single-user localhost process. A policy file stored inside a repo can be widened
// by anything that can write to that repo, including an agent working in it, which makes the
// policy describe itself rather than constrain anything.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { normalizeStore, emptyStore, setPermission, removePermission, buildMatrix, checkAccess, isValidMode, MODES } from '../lib/access.mjs'

const CLAUDE = path.join(os.homedir(), '.claude')
export const ACCESS_FILE = path.join(CLAUDE, 'dashboard-access.json')

export function readStore(file = ACCESS_FILE) {
  try { return normalizeStore(JSON.parse(fs.readFileSync(file, 'utf8'))) } catch { return emptyStore() }
}

export function writeStore(store, file = ACCESS_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(store, null, 2), { mode: 0o600 })
  return store
}

// A project is identified by its absolute path — the same key /api/projects uses — so a cell
// cannot be made to match a different directory by renaming or by a relative path.
export const projectKey = p => path.resolve(String(p || ''))

// Middleware for routes that act on a project. `need` is r/w/x, `pick` pulls the project path
// out of the request. When the policy is not enforced this attaches req.access and continues,
// so a route can still surface "this would have been blocked" without failing.
export function requireAccess(need, pick = req => req.body?.repo || req.query?.repo) {
  return (req, res, next) => {
    const store = readStore()
    const project = projectKey(pick(req))
    const profile = String(req.get?.('x-access-profile') || req.body?.profile || req.query?.profile || 'default')
    const decision = checkAccess(store, { profile, project, need })
    req.access = decision
    if (decision.allowed) return next()
    res.status(403).json({ error: decision.reason, access: decision })
  }
}

export default function mountAccess(app, { track } = {}) {
  // Every policy change lands in the same append-only log as any other config write, so the
  // Audit log tab shows who widened access and when. A failure to record must not also block
  // the change — but it must not pass silently either.
  //
  // track() is itself a tracked *write*: it writes the file and appends the version entry. The
  // routes below call writeStore() first so the file is created with 0600 (writeFileSync
  // preserves the mode of an existing file), then track() rewrites identical content and
  // records it. Same bytes twice, and the ordering is what keeps the mode.
  const audit = (summary, store) => {
    try { track?.(ACCESS_FILE, JSON.stringify(store, null, 2), { scope: 'global', summary }) }
    catch (e) { console.error('[access] policy changed but was not written to the audit log:', e.message) }
  }

  app.get('/api/access', (req, res) => {
    const store = readStore()
    // Projects the dashboard already knows about, so the grid shows real rows on first open
    // rather than an empty table the user has to populate from memory.
    let projects = []
    try {
      const cj = JSON.parse(fs.readFileSync(path.join(CLAUDE, '.claude.json'), 'utf8'))
      projects = Object.keys(cj.projects || {}).map(projectKey)
    } catch { /* no ~/.claude.json is normal */ }
    res.json({
      file: ACCESS_FILE,
      enforced: store.enforced,
      permissions: store.permissions,
      matrix: buildMatrix(store, { profiles: ['default'], projects }),
      modes: MODES,
    })
  })

  app.put('/api/access/permission', (req, res) => {
    try {
      const { profile, project, mode } = req.body || {}
      const key = projectKey(project)
      const next = setPermission(readStore(), String(profile || ''), key, mode)
      writeStore(next)
      audit(`access: ${profile} -> ${mode} on ${key}`, next)
      res.json({ ok: true, permissions: next.permissions })
    } catch (e) { res.status(e.status || 500).json({ error: e.message }) }
  })

  app.delete('/api/access/permission', (req, res) => {
    try {
      const { profile, project } = req.body || {}
      const key = projectKey(project)
      const next = removePermission(readStore(), String(profile || ''), key)
      writeStore(next)
      audit(`access: cleared ${profile} on ${key}`, next)
      res.json({ ok: true, permissions: next.permissions })
    } catch (e) { res.status(e.status || 500).json({ error: e.message }) }
  })

  // Turning enforcement on is the consequential action here, so it is its own route and its own
  // audit line rather than a field buried in a general-purpose save.
  app.put('/api/access/enforced', (req, res) => {
    try {
      const enforced = req.body?.enforced === true
      const next = { ...readStore(), enforced }
      writeStore(next)
      audit(`access: enforcement ${enforced ? 'enabled' : 'disabled'}`, next)
      res.json({ ok: true, enforced })
    } catch (e) { res.status(e.status || 500).json({ error: e.message }) }
  })

  // Preview a decision without performing anything — what makes it safe to fill the matrix in
  // on a live install before switching enforcement on.
  app.post('/api/access/check', (req, res) => {
    try {
      const { profile = 'default', project, need = 'r' } = req.body || {}
      if (!isValidMode(need) && !MODES.includes(need)) return res.status(400).json({ error: `need must be one of ${MODES.join(', ')}` })
      res.json(checkAccess(readStore(), { profile: String(profile), project: projectKey(project), need }))
    } catch (e) { res.status(e.status || 500).json({ error: e.message }) }
  })
}
