
export const MODES = ['r', 'w', 'x']
export const DENY = '---'
export const FULL = 'rwx'

export function parseMode(input) {
  const s = String(input ?? '')
  if (s.length !== 3) return null
  const out = {}
  for (let i = 0; i < 3; i++) {
    const c = s[i]
    if (c === MODES[i]) out[MODES[i]] = true
    else if (c === '-') out[MODES[i]] = false
    else return null
  }
  return out
}

export const formatMode = mode => MODES.map(m => (mode?.[m] ? m : '-')).join('')

export const isValidMode = input => parseMode(input) !== null

export function emptyStore() {
  return { version: 1, enforced: false, permissions: {} }
}

export function normalizeStore(raw) {
  const store = emptyStore()
  if (!raw || typeof raw !== 'object') return store
  store.enforced = raw.enforced === true
  const perms = raw.permissions && typeof raw.permissions === 'object' ? raw.permissions : {}
  for (const [profile, projects] of Object.entries(perms)) {
    if (!profile || typeof projects !== 'object' || !projects) continue
    for (const [project, mode] of Object.entries(projects)) {
      if (!project) continue
      store.permissions[profile] ||= {}
      store.permissions[profile][project] = isValidMode(mode) ? String(mode) : DENY
    }
  }
  return store
}

export function modeFor(store, profile, project) {
  const raw = store?.permissions?.[profile]?.[project]
  return isValidMode(raw) ? String(raw) : DENY
}

export function checkAccess(store, { profile, project, need }) {
  if (!MODES.includes(need)) throw Object.assign(new Error(`unknown access mode: ${need}`), { status: 400 })
  const mode = modeFor(store, profile, project)
  const granted = parseMode(mode)[need] === true
  const enforced = store?.enforced === true
  const label = { r: 'read', w: 'write to', x: 'run commands against' }[need]
  return {
    allowed: granted || !enforced,
    granted,
    enforced,
    wouldDeny: !granted,
    mode,
    profile,
    project,
    need,
    reason: granted
      ? `${profile} has ${need} on ${project} (${mode})`
      : `${profile} may not ${label} ${project} (${mode})${enforced ? '' : ' — not enforced, allowing'}`,
  }
}

export function setPermission(store, profile, project, mode) {
  if (!profile || !project) throw Object.assign(new Error('profile and project are required'), { status: 400 })
  if (!isValidMode(mode)) throw Object.assign(new Error(`invalid mode: ${mode} (expected rwx form, e.g. "r--")`), { status: 400 })
  return { ...store, permissions: { ...store.permissions, [profile]: { ...(store.permissions[profile] || {}), [project]: String(mode) } } }
}

export function removePermission(store, profile, project) {
  const row = { ...(store.permissions[profile] || {}) }
  delete row[project]
  const permissions = { ...store.permissions }
  if (Object.keys(row).length) permissions[profile] = row
  else delete permissions[profile]
  return { ...store, permissions }
}

export function buildMatrix(store, { profiles = [], projects = [] } = {}) {
  const allProfiles = [...new Set([...profiles, ...Object.keys(store.permissions || {})])].sort()
  const allProjects = [...new Set([...projects, ...Object.values(store.permissions || {}).flatMap(r => Object.keys(r))])].sort()
  return {
    profiles: allProfiles,
    projects: allProjects,
    rows: allProfiles.map(profile => ({
      profile,
      cells: allProjects.map(project => {
        const mode = modeFor(store, profile, project)
        return { project, mode, configured: store?.permissions?.[profile]?.[project] !== undefined }
      }),
    })),
  }
}
