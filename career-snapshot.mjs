import { parseUsageData, groupByProject } from './career-insights.mjs'
import { parseReportNarrative } from './career-insights-report.mjs'
import { attributeBugs, attributeBugsWithBlame } from './career-attribution.mjs'
import { focusItems } from './career-heuristics.mjs'
import { harnessScore } from './career-harness.mjs'

export const quarterOf = iso => { const d = new Date(iso); return `${d.getUTCFullYear()}Q${Math.floor(d.getUTCMonth() / 3) + 1}` }
// prior PERIOD baseline = previous quarter's recorded ratio (null if none). Never the last refresh (fix 2).
export function priorQuarterRatio(rollup, todayIso) {
  const d = new Date(todayIso + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 3)
  const v = rollup?.quarterlyBugRatio?.[quarterOf(d.toISOString().slice(0, 10))]
  return v == null ? null : v
}
// LOCAL hour of a session; tzOffsetHours=null → server-local, else explicit UTC offset (deterministic in tests). (fix 1)
export function localHour(iso, tzOffsetHours) {
  const d = new Date(iso)
  return tzOffsetHours == null ? d.getHours() : (d.getUTCHours() + tzOffsetHours + 24) % 24
}
const inWindow = (hr, w) => w.startHour <= w.endHour ? (hr >= w.startHour && hr < w.endHour) : (hr >= w.startHour || hr < w.endHour)

export function buildSnapshot(deps) {
  const { usageDir, mtimeCache, config, resolved, readBugs, readTasks, readReport, readRunning, github = null, jira = null, probeRepo = null } = deps
  const { sessions, skipped, parsed } = parseUsageData(usageDir, { mtimeCache })
  const byProject = groupByProject(sessions)

  const bugInput = readBugs()
  // GitHub import, when present, is the better PR-count source than the (empty) Phase-1 stub.
  const myPrCount = github?.prLifecycle?.reviewRoundsPerPr?.length || bugInput.myPrCount || 0
  // Blame (computed at import, pure data here) augments attribution when a GitHub import exists;
  // otherwise fall back to the Phase-1 attributor. Escaped-vs-caught split is identical either way.
  const quality = github && !github.error
    ? attributeBugsWithBlame({ ...bugInput, myPrCount, resolved,
        bugs: (bugInput.bugs || []).map(b => github.blame?.[b.id] ? { ...b, introducingAuthorEmail: github.blame[b.id] } : b) })
    : attributeBugs({ ...bugInput, myPrCount, resolved })
  const todayIso = new Date().toISOString().slice(0, 10)
  const priorChangeFailProxy = priorQuarterRatio(config.rollup, todayIso)   // null when no prior quarter

  // flow / workflow rollups from all sessions — after-hours uses a LOCAL, configurable window (fix 1)
  const win = config.afterHoursWindow || { startHour: 19, endHour: 6 }
  const totalFriction = {}, helpfulness = {}
  let afterHours = 0, withTimes = 0, oneShot = 0
  for (const s of sessions) {
    for (const [k, v] of Object.entries(s.friction_counts || {})) totalFriction[k] = (totalFriction[k] || 0) + v
    if (s.start_time) { withTimes++; if (inWindow(localHour(s.start_time, config.tzOffsetHours), win)) afterHours++ }
    if (s.claude_helpfulness) helpfulness[s.claude_helpfulness] = (helpfulness[s.claude_helpfulness] || 0) + 1
    // one-shot = a single-task session that ran without interruptions (spec §11.A workflow)
    if ((s.session_type === 'one_shot' || s.session_type === 'single_task') && !(s.user_interruptions > 0)) oneShot++
  }
  const oneShotRate = sessions.length ? oneShot / sessions.length : 0
  const topFriction = Object.entries(totalFriction).sort((a, b) => b[1] - a[1])[0]?.[0] || null
  // org-wide friction-per-session baseline for the harness score (Task 4)
  const totalFrictionEvents = Object.values(totalFriction).reduce((a, b) => a + b, 0)
  const baselineFrictionRate = sessions.length ? totalFrictionEvents / sessions.length : 1
  const tasks = readTasks()

  const snap = {
    generatedAt: Date.now(), parsed, skipped,
    me: { runningNow: readRunning ? readRunning() : [], sessionCount: sessions.length },
    flow: { afterHoursPct: withTimes ? afterHours / withTimes : 0, wip: tasks.filter(t => t.stage === 'in-progress').length,
            sessionTypes: sessions.reduce((a, s) => (a[s.session_type] = (a[s.session_type] || 0) + 1, a), {}) },
    quality: { ...quality, priorChangeFailProxy, myPrCount },
    github: github && !github.error ? {
      reviewFootprint: { ...github.reviewFootprint, reviewedForOthers: Object.fromEntries(github.reviewFootprint.reviewedForOthers) },
      prLifecycle: github.prLifecycle,
    } : null,
    jira: jira && !jira.error ? jira : null,
    workflow: { topFriction, friction: totalFriction, helpfulness, oneShotRate,
                interruptRate: sessions.length ? sessions.reduce((a, s) => a + (s.user_interruptions || 0), 0) / sessions.length : 0,
                sessionTypes: sessions.reduce((a, s) => (a[s.session_type] = (a[s.session_type] || 0) + 1, a), {}),
                tools: sessions.reduce((a, s) => { for (const [k, v] of Object.entries(s.tool_counts || {})) a[k] = (a[k] || 0) + v; return a }, {}) },
    tasks,
    insights: { narrative: parseReportNarrative(readReport()) },
    projects: [...byProject.entries()].map(([path, v]) => ({ path, ...v.totals, sessions: v.sessions.length,
      // harness score re-detected each refresh (no persistence, §11.B/D). probeRepo is server-supplied.
      harness: harnessScore({ project: path, sessionsForProject: v.sessions, baselineFrictionRate,
        repoProbe: probeRepo ? probeRepo(path) : {} }) })),
  }
  // hydrate the acted-on mark (guarded — `focusActed` is introduced in Task 13; guard keeps this correct before/after)
  snap.focus = focusItems(snap).map(f => ({ ...f, actedOn: (config.focusActed || {})[f.id] || null }))
  return snap
}

const MEANINGFUL_PR_MIN = 5   // don't let a trivial 0/small-sample window own "personal best" forever (fix 4)

export function updateRollup(config, snapshot, todayIso) {
  const rollup = JSON.parse(JSON.stringify(config.rollup || { activityDays: [], streaks: {}, personalBests: {}, quarterlyBugRatio: {} }))
  const days = new Set(rollup.activityDays)
  const activeToday = snapshot.me.sessionCount > 0
  if (activeToday) days.add(todayIso)
  rollup.activityDays = [...days].sort()
  // coding streak: today-idle must NOT break it (spec §3.2) — start the walk at today if active, else yesterday (fix 3)
  let streak = 0
  let d = new Date(todayIso + 'T00:00:00Z')
  if (!activeToday) d.setUTCDate(d.getUTCDate() - 1)
  while (days.has(d.toISOString().slice(0, 10))) { streak++; d.setUTCDate(d.getUTCDate() - 1) }
  rollup.streaks.coding = streak
  // bug ratio: escaped-only source, current PERIOD only; never overwrite a prior-period baseline (fix 2)
  const ratio = snapshot.quality.changeFailProxy
  rollup.quarterlyBugRatio[quarterOf(todayIso)] = ratio
  // personal best only from a meaningful window (fix 4)
  if ((snapshot.quality.myPrCount || 0) >= MEANINGFUL_PR_MIN)
    rollup.personalBests.lowestBugRatio = rollup.personalBests.lowestBugRatio == null ? ratio : Math.min(rollup.personalBests.lowestBugRatio, ratio)
  return { rollup }
}
