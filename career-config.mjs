// career.json store: default shape, ordered migrations, versioned read/write.
// version bump checklist: add a migration entry, bump CONFIG_VERSION, extend defaultConfig().
export const CONFIG_VERSION = 3

export function defaultConfig() {
  return {
    version: CONFIG_VERSION,
    updatedAt: 0,
    identity: { gitEmails: [], githubHandle: '', jiraAccountId: '', confluenceUser: '', slackUserId: '' },
    projects: [],                 // {id, path, label, active, owned}
    competency: { levelSelfAssessed: '', ratings: {}, ladder: [] },
    learning: { now: [], next: [], techRadar: [] },
    okrs: [], courses: [], ownership: [], feedback: [], feedbackRequests: [],
    decisions: [], brag: [], retros: [], timeTarget: null, oneOnOnes: [], pendingDecisions: [],
    afterHoursWindow: { startHour: 19, endHour: 6 }, // LOCAL hours; "after hours" is personal (fix: not UTC)
    tzOffsetHours: null,          // null = server-local getHours(); set e.g. 3 for UTC+3 to make it explicit/deterministic
    insightsRaw: null, analyses: {},
    xpLedger: [], quests: [], badges: [],
    rollup: { activityDays: [], streaks: {}, personalBests: {}, quarterlyBugRatio: {} },
    imports: {}, lessons: [], ticketLinks: {},
    focusActed: {},
    kpiLinks: [],                 // G2 business-impact links {id, ticket, kpi, metric, baseline, current, direction, at, note}
  }
}

// Ordered migrations: index i upgrades a config AT version i to version i+1.
// v0 (no/legacy version) -> v1: backfill any missing top-level keys from the default.
const MIGRATIONS = [
  (cfg) => { const d = defaultConfig(); return { ...d, ...cfg, version: 1,
    identity: { ...d.identity, ...(cfg.identity || {}) },
    rollup: { ...d.rollup, ...(cfg.rollup || {}) } } },
  // v1 -> v2: backfill focusActed (Task 13, introduced mid-phase via version-bump route)
  (cfg) => ({ ...cfg, version: 2, focusActed: cfg.focusActed || {} }),
  // v2 -> v3: backfill kpiLinks (G2 business-impact linkage)
  (cfg) => ({ ...cfg, version: 3, kpiLinks: cfg.kpiLinks || [] }),
]

export function migrate(cfg) {
  let v = Number(cfg?.version || 0)
  if (v > CONFIG_VERSION) throw new Error(`career.json version ${v} is newer than this build (${CONFIG_VERSION})`)
  let out = cfg || {}
  let changed = false
  while (v < CONFIG_VERSION) { out = MIGRATIONS[v](out); v++; changed = true }
  if (!('version' in (cfg || {})) && !changed) { out = { ...defaultConfig(), ...out }; changed = true }
  return { cfg: out, changed }
}

function deepMerge(base, patch) {
  const out = Array.isArray(base) ? [...base] : { ...base }
  for (const [k, v] of Object.entries(patch || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base?.[k] && typeof base[k] === 'object' && !Array.isArray(base[k])
      ? deepMerge(base[k], v) : v
  }
  return out
}

// RULE (mid-phase keys): any key added to defaultConfig() AFTER a career.json may already exist on disk
// must EITHER be read with a fallback at every reader, OR be introduced with a CONFIG_VERSION bump + a
// migration entry that backfills it. Task 13 uses the version-bump route (to exercise the migration path).

export function makeStore({ file, track, readJson }) {
  const load = () => {
    const raw = readJson(file, null) || defaultConfig()
    const { cfg, changed } = migrate(raw)
    if (changed || !readJson(file, null)) track(file, JSON.stringify(cfg, null, 2), { scope: 'career', summary: 'migrate career.json' })
    return cfg
  }
  return {
    read: () => load(),
    write: (patch) => {
      const cur = load()
      const next = deepMerge(cur, { ...patch, updatedAt: Date.now() })
      track(file, JSON.stringify(next, null, 2), { scope: 'career', summary: 'update career.json' })
      return next
    },
  }
}
