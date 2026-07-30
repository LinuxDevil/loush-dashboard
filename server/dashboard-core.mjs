import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import YAML from 'yaml'
import { WATCHED_PROJECT } from '../lib/paths.mjs'

export const HOME = os.homedir()
export const CLAUDE = path.join(HOME, '.claude')
export const CLAUDE_JSON = path.join(HOME, '.claude.json')
export const PROJECT = WATCHED_PROJECT
export const WIN = process.platform === 'win32'
export const BACKUPS = path.join(CLAUDE, 'dashboard-backups')
export const PORT = Number(process.env.DASH_PORT) || 5178

const ALLOWED_ROOTS = [CLAUDE, path.join(PROJECT, '.claude'), CLAUDE_JSON]
export function safe(p) {
  const r = path.resolve(p)
  if (!ALLOWED_ROOTS.some(root => r === root || r.startsWith(root + path.sep)))
    throw Object.assign(new Error('path outside allowed roots: ' + r), { status: 403 })
  return r
}
export function backup(file) {
  if (!fs.existsSync(file)) return null
  fs.mkdirSync(BACKUPS, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = path.join(BACKUPS, `${ts}__${file.replaceAll(path.sep, '~')}`)
  fs.cpSync(file, dest, { recursive: true })
  return dest
}
export function parseFM(src) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src)
  if (!m) return { fm: {}, body: src }
  let fm = {}
  try { fm = YAML.parse(m[1]) || {} } catch (e) { fm = { _parse_error: e.message } }
  return { fm, body: src.slice(m[0].length) }
}

export function readClaudeJson() {
  if (!fs.existsSync(CLAUDE_JSON)) return {}
  return JSON.parse(fs.readFileSync(CLAUDE_JSON, 'utf8'))
}

export const META_FILE = path.join(CLAUDE, 'dashboard-meta.json')
export const readMeta = () => { try { return JSON.parse(fs.readFileSync(META_FILE, 'utf8')) } catch { return { tags: {} } } }
export const writeMeta = m => fs.writeFileSync(META_FILE, JSON.stringify(m, null, 2))
export const tokens = s => Math.ceil((s || '').length / 4)

export const mangle = dir => dir.replace(/[\\/:._]/g, '-')
export const readJson = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return fb } }

export const VERSIONS_FILE = path.join(CLAUDE, 'dashboard-versions.jsonl')
export const APPROVALS_FILE = path.join(CLAUDE, 'dashboard-approvals.json')
export const AUTHOR = os.userInfo().username
export const appendVersion = entry => fs.appendFileSync(VERSIONS_FILE, JSON.stringify(entry) + '\n')
export function track(file, content, { scope = 'global', summary = '', author = AUTHOR, approvedBy = null } = {}) {
  const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
  const id = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  appendVersion({ id, ts: Date.now(), author, machine: os.hostname(), scope, file, summary, approvedBy, prev, content })
  return id
}
export function readVersions() {
  try { return fs.readFileSync(VERSIONS_FILE, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) } catch { return [] }
}
export const readApprovals = () => readJson(APPROVALS_FILE, [])
export const writeApprovals = a => fs.writeFileSync(APPROVALS_FILE, JSON.stringify(a, null, 2))
export function propose(file, content, summary) {
  const a = readApprovals()
  const id = 'p' + Date.now().toString(36)
  a.push({ id, ts: Date.now(), author: AUTHOR, file, scope: 'global', summary, content, status: 'proposed' })
  writeApprovals(a)
  appendVersion({ id: id + '-proposed', ts: Date.now(), author: AUTHOR, machine: os.hostname(), scope: 'global', file, summary: 'PROPOSED: ' + summary, prev: null, content: null })
  return id
}
