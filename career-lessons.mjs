// Lessons pipeline: harvest recurring themes → distill (weekly Analyze) → apply/verify with graduation.
// Hard rules (spec §11.B): a STRUCTURED check {metricRef,comparator,target,window} can auto-graduate;
// a FREE-TEXT check is manual-graduate only. Cap ~5 ACTIVE lessons. Nothing enters the list without
// an explicit approve/edit/discard (distill only produces drafts).

export const ACTIVE_CAP = 5

// ---- harvest -------------------------------------------------------------
// Recurring themes only. A theme seen once across all sources is a one-off and is dropped.
export function harvestCandidates({ prFindings = [], escapedBugs = [], ticketAcGaps = [], sessionFriction = [], retros = [] } = {}) {
  const tally = new Map()   // theme -> refs[]
  for (const item of [...prFindings, ...escapedBugs, ...ticketAcGaps, ...sessionFriction, ...retros]) {
    const theme = item?.theme
    if (!theme) continue
    if (!tally.has(theme)) tally.set(theme, [])
    if (item.ref) tally.get(theme).push(item.ref)
  }
  return [...tally.entries()]
    .filter(([, refs]) => refs.length >= 2)                 // recurring, not one-off
    .map(([theme, evidenceRefs]) => ({ theme, evidenceRefs }))
}

// ---- distill -------------------------------------------------------------
// Weekly Analyze pass turns candidates into DRAFT lessons. Drafts never auto-activate.
export function distill({ candidates = [], runAnalyze } = {}) {
  return candidates.map((c, i) => {
    const drafted = (typeof runAnalyze === 'function' ? runAnalyze(c) : {}) || {}
    return {
      id: 'lsn' + i + ':' + c.theme,
      theme: c.theme, evidenceRefs: c.evidenceRefs || [],
      situation: drafted.situation || '', pattern: drafted.pattern || '',
      rule: drafted.rule || '', check: drafted.check || { freeText: '' },
      status: 'draft',
    }
  })
}

// ---- evaluate / graduate -------------------------------------------------
const CMP = { '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b }

function resolveMetric(ref, snapshot) {
  if (!ref) return null
  let cur = snapshot
  for (const seg of ref.split('.')) { if (cur == null || typeof cur !== 'object' || !(seg in cur)) return null; cur = cur[seg] }
  return typeof cur === 'number' ? cur : null
}

// Returns { status:'recurring'|'cleared'|'pending', graduate, flag1on1 }.
// ponytail: the snapshot value IS the current-window value, so "meets target over its window" is read
// off the live snapshot rather than replaying history — the whole dashboard is already window-scoped.
export function evaluateLesson(lesson, snapshot = {}) {
  const check = lesson?.check || {}
  // free-text check: cannot be auto-evaluated → pending, never graduates
  if (!check.metricRef || !check.comparator) return { status: 'pending', graduate: false, flag1on1: false }
  const val = resolveMetric(check.metricRef, snapshot)
  if (val == null) return { status: 'pending', graduate: false, flag1on1: false }
  const meets = (CMP[check.comparator] || (() => false))(val, check.target)
  const status = meets ? 'cleared' : 'recurring'
  const flag1on1 = lesson.lastStatus === 'cleared' && status === 'recurring'
  return { status, graduate: meets, flag1on1 }
}

// ---- add (cap enforcement) ----------------------------------------------
const isActive = l => l.status === 'active' || l.status === 'draft'
export function addLesson(lessons = [], lesson) {
  if (isActive(lesson) && lessons.filter(isActive).length >= ACTIVE_CAP)
    return { lessons, error: `active lessons capped at ${ACTIVE_CAP} — graduate or discard one first` }
  return { lessons: [...lessons, lesson] }
}
