import { parseUsageData, deriveSessionsFromTranscripts, groupByProject } from './career-insights.mjs'
import { parseReportNarrative } from './career-insights-report.mjs'
import { attributeBugs, attributeBugsWithBlame } from './career-attribution.mjs'
import { focusItems } from './career-heuristics.mjs'
import { harnessScore } from './career-harness.mjs'
import { computeAllocation } from './career-allocation.mjs'
import { hydrateOkrs } from './career-okr.mjs'
import { computeStreaks, evaluateAchievements, personalBests as personalBestsOf, badgeProgress } from './career-gamify.mjs'
import { evaluateLesson } from './career-lessons.mjs'

// Feedback nudges (Phase-3 T8): a shipped ticket / merged PR is the trigger to solicit feedback.
export function feedbackNudges(tasks = [], config = {}) {
  const asked = new Set((config.feedbackRequests || []).map(r => r.trigger))
  const out = []
  for (const t of tasks) if (t.stage === 'released' && !asked.has('tkt:' + t.id))
    out.push({ id: 'nudge:tkt:' + t.id, trigger: 'tkt:' + t.id, topic: t.title || t.id,
      suggestion: `Ask your PM/reviewer for feedback on ${t.id}${t.title ? ` (${t.title})` : ''}` })
  return out
}

export const quarterOf = iso => { const d = new Date(iso); return `${d.getUTCFullYear()}Q${Math.floor(d.getUTCMonth() / 3) + 1}` }
// ISO-week key `YYYY-Www` for the weekly trend series (Thursday-anchored, ISO 8601).
export function isoWeekKey(iso) {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}
const clamp01 = x => Math.max(0, Math.min(1, x))
// G2: a linked KPI "moved" when current beats baseline in the intended direction.
export function kpiMoved(link) {
  const b = Number(link?.baseline), c = Number(link?.current)
  if (Number.isNaN(b) || Number.isNaN(c)) return false
  return (link.direction === 'down') ? c < b : c > b
}
// Current-year period window. period = '' | 'YYYY' (year-to-date) → whole year; 'YYYYQn' → one quarter.
// Year is always clamped to the CURRENT year: no previous-year data is ever served.
export function periodWindow(period, now = Date.now()) {
  const y = new Date(now).getUTCFullYear()
  const m = /Q([1-4])$/.exec(period || '')
  if (m) { const sm = (+m[1] - 1) * 3; return { start: Date.UTC(y, sm, 1), end: Math.min(now, Date.UTC(y, sm + 3, 1)), isYear: false, label: `Q${m[1]}` } }
  return { start: Date.UTC(y, 0, 1), end: now, isYear: true, label: String(y) }
}
// keep a session iff its start_time falls in the window; undated sessions count only in the full-year view.
const inPeriod = (iso, w) => { const t = Date.parse(iso); return Number.isNaN(t) ? w.isYear : (t >= w.start && t < w.end) }
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
  const { usageDir, transcriptsDir, mtimeCache, config, resolved, readBugs, readTasks, readReport, readRunning, github = null, jira = null, probeRepo = null } = deps
  // Two sources, merged by session_id: raw transcripts self-populate (zero setup), `/insights`
  // facets overlay richer LLM-judged fields (outcome/session_type/helpfulness/friction) when present.
  const facet = parseUsageData(usageDir, { mtimeCache })
  const derived = transcriptsDir ? deriveSessionsFromTranscripts(transcriptsDir, { mtimeCache }) : { sessions: [], parsed: 0, skipped: 0 }
  const bySid = new Map(derived.sessions.map(s => [s.session_id, s]))
  for (const f of facet.sessions) bySid.set(f.session_id, { ...bySid.get(f.session_id), ...f })
  let sessions = [...bySid.values()]
  if (deps.window) sessions = sessions.filter(s => inPeriod(s.start_time, deps.window))
  const parsed = facet.parsed + derived.parsed, skipped = facet.skipped + derived.skipped
  const byProject = groupByProject(sessions)

  const bugInput = readBugs()
  // GitHub import, when present, is the better PR-count source than the (empty) Phase-1 stub.
  const myPrCount = github?.prLifecycle?.reviewRoundsPerPr?.length || bugInput.myPrCount || 0
  // Blame (computed at import, pure data here) augments attribution when a GitHub import exists;
  // otherwise fall back to the Phase-1 attributor. Escaped-vs-caught split is identical either way.
  // G8: reverts come from the GitHub import (my "Revert …" PRs) — they feed changeFailProxy. Fall back to the bug stub.
  const reverts = github?.revertCount ?? bugInput.reverts ?? 0
  const quality = github && !github.error
    ? attributeBugsWithBlame({ ...bugInput, myPrCount, reverts, resolved,
        bugs: (bugInput.bugs || []).map(b => github.blame?.[b.id] ? { ...b, introducingAuthorEmail: github.blame[b.id] } : b) })
    : attributeBugs({ ...bugInput, myPrCount, reverts, resolved })
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

  // G1 AI-code-share (scoped: a ratio, not a fragile session→PR join). aiCommits = commits made inside
  // Claude sessions; denominator = commits that landed in my PRs (github import). Honest label: "of the
  // commits I shipped, this share came out of a Claude session." Paired with changeFailProxy in the UI.
  // Cursor reuse: its sessions carry REAL per-session line counts (richer than Claude commit counts) →
  // a second, lines-based share. Both tools count toward the AI footprint.
  const aiCommits = sessions.reduce((a, s) => a + (s.git_commits || 0), 0)
  const aiPushes = sessions.reduce((a, s) => a + (s.git_pushes || 0), 0)
  const prCommits = github?.commitCount || 0
  const cur = deps.cursor || { sessions: 0, linesAdded: 0, linesRemoved: 0 }
  const cursorLines = (cur.linesAdded || 0) + (cur.linesRemoved || 0)
  const prLines = github?.prLines || 0
  const ai = { aiCommits, aiPushes, prCommits, sessions: sessions.length,
    codeShare: prCommits > 0 ? clamp01(aiCommits / prCommits) : null,
    cursorSessions: cur.sessions || 0, cursorLines,
    linesShare: prLines > 0 ? clamp01(cursorLines / prLines) : null }

  // G2 business-impact linkage: authored KPI links {ticket, kpi, baseline, current, direction}. movedCount
  // gates the needle-mover badge; grants no XP (activity → badges, never raw XP — the Goodhart guard).
  const kpiLinks = config.kpiLinks || []
  const impact = { links: kpiLinks, linkedCount: kpiLinks.length, movedCount: kpiLinks.filter(kpiMoved).length }

  const snap = {
    generatedAt: Date.now(), parsed, skipped,
    me: { runningNow: readRunning ? readRunning() : [], sessionCount: sessions.length },
    flow: { afterHoursPct: withTimes ? afterHours / withTimes : 0, wip: tasks.filter(t => t.stage === 'in-progress').length,
            sessionTypes: sessions.reduce((a, s) => (s.session_type ? (a[s.session_type] = (a[s.session_type] || 0) + 1) : 0, a), {}) },
    quality: { ...quality, priorChangeFailProxy, myPrCount, reverts },
    ai, impact,
    domain: deps.domain || null,      // G4 ownership/expertise map (import-time git log)
    meetings: deps.meetings || null,   // G5 meeting analytics (imported calendar)
    github: github && !github.error ? {
      reviewFootprint: { ...github.reviewFootprint, reviewedForOthers: Object.fromEntries(github.reviewFootprint.reviewedForOthers) },
      prLifecycle: github.prLifecycle,
      reviewInsights: github.reviewInsights,
      reviewTurnaround: github.reviewTurnaround,
    } : null,
    jira: jira && !jira.error ? jira : null,
    allocation: computeAllocation({ sessions, github, target: config.timeTarget || null }),
    competency: config.competency || { ratings: {}, ladder: [] },   // authored input the heuristics read
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

  // Phase-3 sections (computed last — some read the assembled snap via metricRefs) --------------
  snap.okrs = hydrateOkrs(config.okrs || [], snap)   // KR.current pulled live from the snapshot
  const totalXp = (config.xpLedger || []).reduce((a, e) => a + (e.xp || 0), 0)
  snap.game = {
    xp: totalXp, level: Math.ceil(Math.sqrt(totalXp / 100)),
    streaks: computeStreaks(config.rollup || {}, todayIso),
    badges: evaluateAchievements(snap, config),
    badgeProgress: badgeProgress(snap, config),
    personalBests: personalBestsOf(config.rollup || {}),
    quests: (config.quests || []).map(qu => ({ id: qu.id, title: qu.title || qu.id, xp: qu.xp || 15, done: !!qu.done })),
  }
  // active lessons carry a live evaluation; graduated ones are kept for the "celebrate" view
  snap.lessons = (config.lessons || []).map(l => ({ ...l, eval: evaluateLesson(l, snap) }))
  snap.feedbackNudges = feedbackNudges(tasks, config)
  return snap
}

const MEANINGFUL_PR_MIN = 5   // don't let a trivial 0/small-sample window own "personal best" forever (fix 4)

const FLOW_WEEK_MIN_SESSIONS = 3   // don't crown a 1-session week the "best flow week"

export function updateRollup(config, snapshot, todayIso) {
  const rollup = JSON.parse(JSON.stringify(config.rollup || { activityDays: [], streaks: {}, personalBests: {}, quarterlyBugRatio: {} }))
  rollup.history = rollup.history || []   // ★ weekly metric time-series → the growth curve
  rollup.streaks = rollup.streaks || {}   // guard partial rollups (a fresh/partial config)
  rollup.personalBests = rollup.personalBests || {}
  rollup.quarterlyBugRatio = rollup.quarterlyBugRatio || {}
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

  // ★ weekly time-series: one sample per ISO week, overwritten within the week, capped to ~1 year.
  const week = isoWeekKey(todayIso)
  const sample = { week, at: snapshot.generatedAt,
    changeFailProxy: ratio,
    oneShotRate: snapshot.workflow?.oneShotRate ?? 0,
    afterHoursPct: snapshot.flow?.afterHoursPct ?? 0,
    sessions: snapshot.me?.sessionCount ?? 0,
    xp: snapshot.game?.xp ?? 0 }
  rollup.history = [...rollup.history.filter(h => h.week !== week), sample].sort((a, b) => a.week < b.week ? -1 : 1).slice(-53)

  // G8 personal bests derived from the series / ledger (were perpetually null):
  // bestFlowWeek = highest one-shot week over a meaningful sample.
  const flowWeeks = rollup.history.filter(h => (h.sessions || 0) >= FLOW_WEEK_MIN_SESSIONS)
  if (flowWeeks.length) {
    const best = flowWeeks.reduce((a, b) => b.oneShotRate > a.oneShotRate ? b : a)
    rollup.personalBests.bestFlowWeek = `${best.week} · ${Math.round(best.oneShotRate * 100)}%`
  }
  // mostKrsQuarter = most KR/OKR closures in any one quarter (from the outcome XP ledger).
  const byQuarter = {}
  for (const e of config.xpLedger || []) if ((e.type === 'kr' || e.type === 'okr') && e.at) {
    const qk = quarterOf(new Date(e.at)); byQuarter[qk] = (byQuarter[qk] || 0) + 1
  }
  const mostKrs = Math.max(0, ...Object.values(byQuarter))
  if (mostKrs > 0) rollup.personalBests.mostKrsQuarter = mostKrs
  return { rollup }
}
