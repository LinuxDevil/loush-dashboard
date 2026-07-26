// server-setup.mjs — /api/setup/* — visual configuration for everything this app needs.
//
// WHY THIS EXISTS
// Until now, configuring this dashboard meant hand-editing JSON on disk in three different places,
// and the one thing that made it "work out of the box" was another company's production config
// hardcoded into the source. Everything org-specific is now user config — which is only an
// improvement if there is somewhere to actually enter it.
//
// SECRET HANDLING — the rules this module will not break:
//   1. A secret VALUE is never returned by any endpoint here. Not masked, not partially, not once.
//      The client is told `set: true|false` and where it came from, and nothing else. There is no
//      GET that can echo a token back, so a token cannot leak through a screenshot, a cached
//      response, or the browser devtools network tab.
//   2. Secret files are written 0600 (owner read/write only) and are never routed through the
//      dashboard-backups directory — a "helpful" backup of a credentials file is just a second
//      plaintext copy of your token in a directory you forgot about.
//   3. Every writable path is a fixed constant in this file. No endpoint accepts a path, so there
//      is nothing to traverse.
//   4. Secret files are checked against .gitignore on every read, and the UI shouts if one is
//      committable. That check is why the emails in server-eng.mjs reached a public repo.
//
// It writes config; it does not read your transcripts. Plane-neutral.

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { loadEngConfig, normalizeWork, describeWork, invalidateEngConfig, normalizeToolFlag, DEFAULT_WORK, DEFAULT_SP_DAYS } from '../lib/eng-config.mjs'
import { PROJECTS_FILE, SECRETS_FILE, LEGACY_SECRETS, GITIGNORE_FILE } from '../lib/paths.mjs'

// From lib/paths.mjs, not from this file's own location. GITIGNORE especially: if it resolves to a
// missing file, gitignoreText() returns '' and the "your token is committable" banner becomes a
// permanent false alarm — a safety check that fails open and silently.
const GITIGNORE = GITIGNORE_FILE

// ---------------------------------------------------------------------------
// pure — exported for test/setup-config.test.mjs
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const KEY_RE = /^[A-Z][A-Z0-9_]{0,19}$/
const REPO_RE = /^[\w.-]+\/[\w.-]+$/
const HOST_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/i

/** Validate one project entry. Returns [] when clean. Errors are user-facing strings. */
export function validateProject(p = {}) {
  const e = []
  const key = String(p.key || '').toUpperCase()
  if (!KEY_RE.test(key)) e.push('Key must be an uppercase JIRA project key, e.g. ABC')
  if (p.githubRepo && !REPO_RE.test(p.githubRepo)) e.push('GitHub repo must be owner/name')
  if (p.jiraHost && !HOST_RE.test(p.jiraHost)) e.push('JIRA host must be a bare hostname, e.g. your-org.atlassian.net')
  for (const field of ['devEmails', 'qaEmails', 'productEmails']) {
    for (const addr of p[field] || []) if (addr && !EMAIL_RE.test(addr)) e.push(`${field}: "${addr}" is not an email address`)
  }
  return e
}

/** Validate the work week. The most load-bearing setting in the app, so it is checked hard. */
export function validateWork(w = {}) {
  const e = []
  const n = (v, lo, hi, label) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return e.push(`${label} must be a number`)
    if (v < lo || v > hi) e.push(`${label} must be between ${lo} and ${hi}`)
  }
  n(w.tzOffsetHours, -12, 14, 'UTC offset')
  n(w.startHour, 0, 23, 'Start hour')
  n(w.endHour, 1, 24, 'End hour')
  if (typeof w.startHour === 'number' && typeof w.endHour === 'number' && w.endHour <= w.startHour)
    e.push('End hour must be after start hour — a zero-length day makes every duration in the app infinite')
  if (!Array.isArray(w.weekend)) e.push('Weekend must be a list of day numbers')
  else {
    if (w.weekend.some(d => !Number.isInteger(d) || d < 0 || d > 6)) e.push('Weekend days must be 0 (Sun) to 6 (Sat)')
    if (w.weekend.length >= 7) e.push('At least one day must be a working day')
  }
  if (!Number.isInteger(w.weekStartDay) || w.weekStartDay < 0 || w.weekStartDay > 6) e.push('Week start must be 0 (Sun) to 6 (Sat)')
  return e
}

/** Story-point table: ascending points, positive days. */
export function validateSpTable(rows) {
  const e = []
  if (!Array.isArray(rows) || !rows.length) return ['At least one points → days row is required']
  let last = -Infinity
  for (const r of rows) {
    if (!Array.isArray(r) || r.length !== 2) { e.push('Each row must be [points, days]'); continue }
    const [pts, days] = r
    if (typeof pts !== 'number' || pts <= 0) e.push(`Points must be a positive number (got ${pts})`)
    if (typeof days !== 'number' || days <= 0) e.push(`Days must be a positive number (got ${days})`)
    if (pts <= last) e.push(`Points must ascend — ${pts} follows ${last}`)
    last = pts
  }
  return e
}

/**
 * Apply a secrets patch. The three cases are deliberately distinct:
 *   key absent      -> leave the stored value alone (the UI never sends what it cannot see)
 *   key === ''      -> CLEAR the stored value (the explicit "remove my token" action)
 *   key is a string -> set it
 * Without this an edit to the email field would wipe the token, because the form has no token to
 * resubmit — it was never given one.
 */
export function mergeSecrets(existing = {}, patch = {}) {
  const out = { ...existing }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    if (v === '' || v === null) delete out[k]
    else out[k] = typeof v === 'string' ? v.trim() : v
  }
  return out
}

/** Is `basename` covered by .gitignore? Deliberately literal — this is a warning, not a resolver. */
export function isIgnored(gitignoreText, basename) {
  return String(gitignoreText || '').split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .some(l => l === basename || l === '/' + basename || l === basename + '/')
}

// ---------------------------------------------------------------------------
// io helpers
// ---------------------------------------------------------------------------

const readJsonSafe = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } }

// 0600 + atomic replace. No backup copy: a spare plaintext token in another directory is a liability.
function writeSecretFile(file, obj) {
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, file)
  try { fs.chmodSync(file, 0o600) } catch {}
}

function writeConfigFile(file, obj) {
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2))
  fs.renameSync(tmp, file)
}

const gitignoreText = () => { try { return fs.readFileSync(GITIGNORE, 'utf8') } catch { return '' } }

/** Where a JIRA credential is coming from. Mirrors server-eng.mjs creds() precedence exactly. */
function credState() {
  const gi = gitignoreText()
  const local = readJsonSafe(SECRETS_FILE, {})
  const legacy = readJsonSafe(LEGACY_SECRETS, {})
  const pick = (envVar, ...keys) => {
    if (process.env[envVar]) return 'env'
    if (keys.some(k => local[k])) return 'file'
    if (keys.some(k => legacy[k])) return 'legacy'
    return null
  }
  return {
    email: { set: !!pick('JIRA_EMAIL', 'jiraEmail', 'email'), source: pick('JIRA_EMAIL', 'jiraEmail', 'email') },
    token: { set: !!pick('JIRA_API_TOKEN', 'jiraToken', 'token', 'jiraAPIKey'), source: pick('JIRA_API_TOKEN', 'jiraToken', 'token', 'jiraAPIKey') },
    // env wins over the file, so the UI must say so instead of letting someone "save" a value that
    // is then silently ignored for the rest of the process's life.
    envOverride: !!(process.env.JIRA_EMAIL || process.env.JIRA_API_TOKEN),
    file: {
      path: SECRETS_FILE, exists: fs.existsSync(SECRETS_FILE),
      gitignored: isIgnored(gi, '.eng.local.json'),
      mode: fs.existsSync(SECRETS_FILE) ? '0' + (fs.statSync(SECRETS_FILE).mode & 0o777).toString(8) : null,
    },
  }
}

function ghState() {
  try {
    const r = spawnSync('gh', ['auth', 'status'], { timeout: 8000, encoding: 'utf8' })
    if (r.error) return { installed: false, authed: false, detail: 'gh CLI is not installed or not on PATH' }
    const txt = (r.stdout || '') + (r.stderr || '')
    const user = (txt.match(/account\s+(\S+)/i) || txt.match(/as\s+(\S+)/i) || [])[1] || null
    return { installed: true, authed: r.status === 0, user, detail: txt.split('\n').find(l => l.trim()) || '' }
  } catch (e) { return { installed: false, authed: false, detail: String(e.message || e) } }
}

// ---------------------------------------------------------------------------
// mount
// ---------------------------------------------------------------------------

export default function mountSetup(app, deps = {}) {
  const { readMeta, writeMeta } = deps

  app.get('/api/setup', (req, res) => {
    try {
      const cfg = loadEngConfig(PROJECTS_FILE)
      const gi = gitignoreText()
      const meta = typeof readMeta === 'function' ? readMeta() : {}
      res.json({
        eng: {
          jiraHost: cfg.jiraHost,
          work: { ...cfg.work, weekendSet: undefined, tzMs: undefined, dayMs: undefined },
          workDescription: describeWork(cfg.work),
          storyPointDays: cfg.storyPointDays,
          defaultDevEmails: cfg.defaultDevEmails,
          almosaferTools: cfg.almosaferTools,
          projects: cfg.projects,
          file: { path: PROJECTS_FILE, exists: fs.existsSync(PROJECTS_FILE), gitignored: isIgnored(gi, 'projects.json') },
        },
        // Values are absent by construction — see the header. `set` is all the client gets.
        credentials: credState(),
        gh: ghState(),
        notify: {
          desktop: !!meta.notify?.desktop,
          slackWebhookSet: !!meta.notify?.slackWebhook, // URL withheld: it is a bearer credential
        },
        defaults: { work: DEFAULT_WORK, storyPointDays: DEFAULT_SP_DAYS },
      })
    } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
  })

  // --- org config (projects.json) -------------------------------------------------
  app.put('/api/setup/eng', (req, res) => {
    try {
      const { jiraHost, work, storyPointDays, defaultDevEmails, almosaferTools } = req.body || {}
      const errors = []
      if (jiraHost && !HOST_RE.test(jiraHost)) errors.push('JIRA host must be a bare hostname, e.g. your-org.atlassian.net')
      if (work) errors.push(...validateWork(work))
      if (storyPointDays) errors.push(...validateSpTable(storyPointDays))
      for (const addr of defaultDevEmails || []) if (addr && !EMAIL_RE.test(addr)) errors.push(`"${addr}" is not an email address`)
      if (errors.length) return res.status(400).json({ error: errors[0], errors })

      const cur = readJsonSafe(PROJECTS_FILE, null)
      const base = cur && !Array.isArray(cur) ? cur : { projects: Array.isArray(cur) ? cur : [] }
      if (jiraHost !== undefined) base.jiraHost = jiraHost || undefined
      if (work) base.work = normalizeWorkForStorage(work)
      if (storyPointDays) base.storyPointDays = storyPointDays
      if (defaultDevEmails) base.defaultDevEmails = defaultDevEmails.filter(Boolean).map(s => s.toLowerCase())
      // Toggling this changes which server routes get MOUNTED, which only happens at boot — so the
      // response says so rather than letting the UI imply the tab appears immediately.
      if (almosaferTools !== undefined) {
        base.Almosafer_Tools = normalizeToolFlag(almosaferTools)
        delete base.almosaferTools; delete base.almosafer_tools   // never leave two spellings on disk
      }
      writeConfigFile(PROJECTS_FILE, base)
      invalidateEngConfig()
      const cfg = loadEngConfig(PROJECTS_FILE)
      res.json({ ok: true, workDescription: describeWork(cfg.work), restartRequired: almosaferTools !== undefined })
    } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
  })

  app.put('/api/setup/project', (req, res) => {
    try {
      const p = req.body || {}
      const errors = validateProject(p)
      if (errors.length) return res.status(400).json({ error: errors[0], errors })
      const key = String(p.key).toUpperCase()
      const cur = readJsonSafe(PROJECTS_FILE, null)
      const base = cur && !Array.isArray(cur) ? cur : { projects: Array.isArray(cur) ? cur : [] }
      const list = Array.isArray(base.projects) ? base.projects : []
      const clean = {
        key,
        name: p.name || key,
        githubRepo: p.githubRepo || '',
        ...(p.jiraHost ? { jiraHost: p.jiraHost } : {}),
        ...(p.jql ? { jql: p.jql } : {}),
        ...(p.spField ? { spField: p.spField } : {}),
        devEmails: (p.devEmails || []).filter(Boolean).map(s => s.toLowerCase()),
        qaEmails: (p.qaEmails || []).filter(Boolean).map(s => s.toLowerCase()),
        productEmails: (p.productEmails || []).filter(Boolean).map(s => s.toLowerCase()),
        // Explicit opt-in. With this false the dashboard copies a line for a human to send instead
        // of transitioning a ticket or commenting on a PR on your behalf.
        writes: p.writes === true,
      }
      const i = list.findIndex(x => String(x.key || x.jiraProjectKey || '').toUpperCase() === key)
      if (i >= 0) list[i] = { ...list[i], ...clean }
      else list.push(clean)
      base.projects = list
      writeConfigFile(PROJECTS_FILE, base)
      invalidateEngConfig()
      res.json({ ok: true, projects: loadEngConfig(PROJECTS_FILE).projects })
    } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
  })

  app.delete('/api/setup/project', (req, res) => {
    try {
      const key = String(req.query.key || '').toUpperCase()
      if (!key) return res.status(400).json({ error: 'key required' })
      const cur = readJsonSafe(PROJECTS_FILE, null)
      const base = cur && !Array.isArray(cur) ? cur : { projects: Array.isArray(cur) ? cur : [] }
      base.projects = (base.projects || []).filter(x => String(x.key || x.jiraProjectKey || '').toUpperCase() !== key)
      writeConfigFile(PROJECTS_FILE, base)
      invalidateEngConfig()
      res.json({ ok: true, projects: loadEngConfig(PROJECTS_FILE).projects })
    } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
  })

  // --- credentials ----------------------------------------------------------------
  app.put('/api/setup/credentials', (req, res) => {
    try {
      const { jiraEmail, jiraToken } = req.body || {}
      if (jiraEmail && !EMAIL_RE.test(jiraEmail)) return res.status(400).json({ error: 'That is not a valid email address' })
      const existing = readJsonSafe(SECRETS_FILE, {})
      const next = mergeSecrets(existing, { jiraEmail, jiraToken })
      writeSecretFile(SECRETS_FILE, next)
      if (!isIgnored(gitignoreText(), '.eng.local.json'))
        return res.json({ ok: true, warning: '.eng.local.json is NOT in .gitignore — your token is committable. Add it before your next commit.', credentials: credState() })
      res.json({ ok: true, credentials: credState() })
    } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
  })

  // Verifies against the real API using whatever creds are actually in effect. Never echoes them.
  app.post('/api/setup/test/jira', async (req, res) => {
    try {
      const cfg = loadEngConfig(PROJECTS_FILE)
      const host = req.body?.jiraHost || cfg.jiraHost
      if (!host) return res.status(400).json({ ok: false, error: 'No JIRA host configured yet' })
      const email = process.env.JIRA_EMAIL || readJsonSafe(SECRETS_FILE, {}).jiraEmail || readJsonSafe(LEGACY_SECRETS, {}).email || ''
      const token = process.env.JIRA_API_TOKEN || readJsonSafe(SECRETS_FILE, {}).jiraToken || readJsonSafe(LEGACY_SECRETS, {}).token || ''
      if (!email || !token) return res.status(400).json({ ok: false, error: 'Email and API token are both required' })
      const r = await fetch(`https://${host}/rest/api/3/myself`, {
        headers: { Authorization: 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64'), Accept: 'application/json' },
        signal: AbortSignal.timeout(12000),
      })
      if (!r.ok) return res.json({ ok: false, status: r.status, error: r.status === 401 ? 'Rejected — check the email and token' : r.status === 403 ? 'Authenticated, but not permitted' : `JIRA answered ${r.status}` })
      const me = await r.json().catch(() => ({}))
      res.json({ ok: true, account: me.displayName || me.emailAddress || 'authenticated', host })
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }) }
  })

  app.get('/api/setup/test/gh', (req, res) => res.json(ghState()))

  // --- notifications --------------------------------------------------------------
  app.put('/api/setup/notify', (req, res) => {
    try {
      if (typeof readMeta !== 'function' || typeof writeMeta !== 'function')
        return res.status(500).json({ error: 'notification storage unavailable' })
      const { desktop, slackWebhook } = req.body || {}
      const meta = readMeta()
      const cur = meta.notify || {}
      if (slackWebhook && !/^https:\/\/hooks\.slack\.com\//.test(slackWebhook))
        return res.status(400).json({ error: 'Slack webhooks start with https://hooks.slack.com/' })
      meta.notify = {
        desktop: desktop === undefined ? !!cur.desktop : !!desktop,
        // same three-case rule as credentials: absent leaves, '' clears, string sets
        slackWebhook: slackWebhook === undefined ? (cur.slackWebhook || '') : (slackWebhook || ''),
      }
      writeMeta(meta)
      res.json({ ok: true, notify: { desktop: meta.notify.desktop, slackWebhookSet: !!meta.notify.slackWebhook } })
    } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
  })
}

// storage shape only — drop the derived fields normalizeWork adds
function normalizeWorkForStorage(w) {
  const n = normalizeWork(w)
  return { tzOffsetHours: n.tzOffsetHours, startHour: n.startHour, endHour: n.endHour, weekend: n.weekend, weekStartDay: n.weekStartDay }
}
