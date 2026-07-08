const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
const RANK = { high: 3, med: 2, low: 1 }
const mk = (severity, area, message, evidenceRefs = []) => ({ id: `${area}:${slug(message)}`, severity, area, message, evidenceRefs, actedOn: null })

export function focusItems(snapshot = {}) {
  const out = []
  const q = snapshot.quality || {}
  // only fire when a real prior PERIOD exists; null prior (no previous quarter) must not false-fire (fix 2)
  if (q.priorChangeFailProxy != null && (q.changeFailProxy || 0) - q.priorChangeFailProxy > 0.1)
    out.push(mk('high', 'quality', 'Change-fail rose sharply — shore up tests and verification', ['quality']))
  const w = snapshot.workflow || {}
  if (w.topFriction === 'wrong_approach')
    out.push(mk('med', 'workflow', 'Front-load explicit constraints — wrong-approach is your top friction', ['workflow']))
  const f = snapshot.flow || {}
  if ((f.afterHoursPct || 0) > 0.35 || (f.wip || 0) > 4)
    out.push(mk('med', 'flow', 'Sustainability: high after-hours load or WIP — protect deep-work blocks', ['flow']))
  for (const t of snapshot.tasks || [])
    if (t.stage === 'in-progress' && (t.ageDays || 0) > (t.slaDays || Infinity))
      out.push(mk('high', 'tasks', `Risk to commitments: ${t.id} is past its expected date`, [t.id]))
  return out.sort((a, b) => RANK[b.severity] - RANK[a.severity])
}
