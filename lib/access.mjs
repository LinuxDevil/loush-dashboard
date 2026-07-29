// Per-(profile, project) access policy, expressed as a UNIX-style rwx matrix.
//
// The shape is taken from the beadle writeup in RESEARCH_MERGED.md (MIT), retargeted: beadle
// keys permissions by (identity, contact) for messages arriving from strangers over a network.
// Nothing here arrives from a stranger — every input is a local file the user already owns — so
// the transport-trust half of its model is dropped and only the matrix is kept, rekeyed to the
// question this dashboard actually has to answer:
//
//   r  the dashboard may read and display this project
//   w  the dashboard may write into it (config, captures, tickets)
//   x  the dashboard may run commands against it
//
// Two properties are load-bearing and deliberately inconvenient:
//
//   Whitelist-only. A cell with no entry is `---`, not "allow". Access is something you grant,
//   never something that accrues from an omission.
//
//   No inheritance. A cell is looked up exactly. A profile with `rwx` on one project has no
//   claim on any other, and there is no wildcard row that quietly covers everything. This is
//   the property that makes the matrix readable: what you see in a cell is what applies.
//
// The store lives outside any project directory (see server/access.mjs) — the one idea worth
// keeping from NanoClaw, whose container isolation is otherwise the wrong threat model here: a
// project must not be able to widen its own access by editing a file inside itself.

export const MODES = ['r', 'w', 'x']
export const DENY = '---'
export const FULL = 'rwx'

// "rw-" -> {r:true,w:true,x:false}. Anything malformed is refused rather than coerced: silently
// reading "rwz" as read-write would grant access the user never wrote down.
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
  // enforced:false so adding this to an existing install changes nothing until the user opts in.
  // The matrix is recorded and previewed first; see checkAccess().
  return { version: 1, enforced: false, permissions: {} }
}

// Tolerates a hand-edited or partially-corrupt file: unknown keys are dropped and an invalid
// mode string becomes DENY rather than disabling the whole policy. Fail closed, cell by cell.
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

// Exact lookup. No wildcard, no parent-directory match, no "default" profile — see the header.
export function modeFor(store, profile, project) {
  const raw = store?.permissions?.[profile]?.[project]
  return isValidMode(raw) ? String(raw) : DENY
}

// The decision. `need` is one of r/w/x.
//
// When the policy is not being enforced this still reports what it *would* decide, via
// `wouldDeny`. That is what makes the matrix safe to fill in on a live install: you can see
// which of your real actions the policy would have blocked before you switch it on.
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

// Immutable update; returns a new store. Setting DENY keeps the explicit cell rather than
// deleting it, so "denied on purpose" and "never configured" stay distinguishable in the UI.
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

// Dense grid for rendering: every known profile crossed with every known project, so unconfigured
// cells are visible as `---` rather than being absent from the table.
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
