// ponytail: timing/status/counts only — token cost isn't in the stream (agents never estimate
export function deriveRunMetrics(events) {
  if (!events?.length) return { status: 'unknown', startedAt: null, endedAt: null, durationMs: null, steps: [], toolCalls: 0, outputs: [] }
  const at = e => Date.parse(e.t)
  const term = [...events].reverse().find(e => e.type === 'run.completed' || e.type === 'run.failed')
  const t0 = at(events[0])
  const tEnd = term ? at(term) : at(events[events.length - 1])
  const openByLabel = {}
  const steps = []
  const outputs = []
  let toolCalls = 0
  for (const e of events) {
    if (e.type === 'tool.call') toolCalls++
    else if (e.type === 'output' && (e.data?.text != null)) outputs.push({ text: String(e.data.text), at: at(e) })
    else if (e.type === 'step.started') (openByLabel[e.data?.label] ||= []).push(e)
    else if (e.type === 'step.completed') {
      const s = openByLabel[e.data?.label]?.shift()
      steps.push({ label: e.data?.label || 'step', agent: e.data?.agent || s?.data?.agent || null, ms: s ? at(e) - at(s) : null, status: e.data?.status || 'passed', at: at(e), decision: e.data?.decision, findings: e.data?.findings })
    }
  }
  for (const q of Object.values(openByLabel)) for (const s of q) steps.push({ label: s.data?.label || 'step', agent: s.data?.agent || null, ms: null, status: 'running', at: at(s) })
  steps.sort((a, b) => a.at - b.at)
  const status = term ? (term.type === 'run.completed' ? (term.data?.status || 'completed') : 'failed') : 'running'
  return { status, startedAt: t0, endedAt: term ? tEnd : null, durationMs: tEnd - t0, steps, toolCalls, outputs }
}

export const fmtDur = ms =>
  ms == null ? '—' : ms < 1000 ? ms + 'ms' : ms < 60_000 ? (ms / 1000).toFixed(1) + 's' : Math.floor(ms / 60_000) + 'm' + String(Math.round((ms % 60_000) / 1000)).padStart(2, '0') + 's'

export const relTime = ms => {
  if (!ms) return '—'
  const s = Math.floor((Date.now() - ms) / 1000)
  return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + 'm ago' : s < 86400 ? Math.floor(s / 3600) + 'h ago' : Math.floor(s / 86400) + 'd ago'
}
