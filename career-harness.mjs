// Per-project "how good is my Claude harness here" score. NO persistence, NO quest dependency
// (spec §11.B/D): every input is re-detected from the repo + recent sessions each refresh.
// Pure weighted score over inputs; `fixes` = the lowest-scoring inputs rendered as advice.
const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n))
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0

// Each input: sub-score 0..1, a weight, and the fix shown when it falls below THRESHOLD.
const THRESHOLD = 0.5

export function harnessScore({ project, sessionsForProject = [], repoProbe = {}, baselineFrictionRate = 1 } = {}) {
  const s = sessionsForProject
  const n = Math.max(1, s.length)
  const frictionRate = s.reduce((t, x) => t + Object.values(x.friction_counts || {}).reduce((a, b) => a + b, 0), 0) / n
  const verifiedRate = mean(s.map(x => (x.verified || (x.tool_counts?.test || x.tool_counts?.typecheck)) ? 1 : 0))
  const oneShotRate = mean(s.map(x => x.session_type === 'one_shot' || x.oneShot ? 1 : 0))
  const interruptRate = mean(s.map(x => x.interrupted ? 1 : 0))
  const toolMix = repoProbe.toolMixHealth != null ? repoProbe.toolMixHealth : toolMixHealth(s)

  const inputs = [
    { id: 'no-claude-md', weight: 0.25, sub: repoProbe.hasClaudeMd ? 1 : 0, title: 'No CLAUDE.md in this repo', detail: 'Add a CLAUDE.md with build/test commands and conventions — the single biggest harness lever.' },
    { id: 'high-friction', weight: 0.20, sub: clamp(1 - frictionRate / (2 * baselineFrictionRate)), title: 'Friction above baseline', detail: 'Front-load constraints and examples; friction here runs above your baseline.' },
    { id: 'low-verification', weight: 0.20, sub: verifiedRate, title: 'Sessions rarely end verified', detail: 'End sessions on a green test/typecheck run so regressions surface before handoff.' },
    { id: 'claude-md-quality', weight: 0.10, sub: repoProbe.claudeMdQuality != null ? repoProbe.claudeMdQuality : (repoProbe.hasClaudeMd ? 0.6 : 0), title: 'Thin CLAUDE.md', detail: 'Expand CLAUDE.md: commands, gotchas, directory map, house style.' },
    { id: 'low-one-shot', weight: 0.10, sub: oneShotRate, title: 'Few one-shot successes', detail: 'Tighter initial prompts raise the one-shot rate and cut iteration.' },
    { id: 'high-interrupts', weight: 0.10, sub: clamp(1 - interruptRate), title: 'Interrupt-heavy sessions', detail: 'Protect deep-work blocks; frequent interrupts fragment context.' },
    { id: 'tool-mix', weight: 0.05, sub: toolMix, title: 'Skewed tool mix', detail: 'A very narrow tool mix often signals a missing skill or command.' },
  ]

  const score = Math.round(inputs.reduce((t, i) => t + i.weight * clamp(i.sub), 0) * 100)
  const fixes = inputs.filter(i => i.sub < THRESHOLD)
    .sort((a, b) => b.weight - a.weight).slice(0, 3)
    .map(({ id, title, detail }) => ({ id, title, detail }))
  return { score, fixes }
}

// Tool-mix health by distinct tools touched. A single-tool project often hides a missing skill;
// 2+ tools is a normal healthy mix (Edit-heavy is fine). No tools → neutral, not a penalty.
function toolMixHealth(sessions) {
  const tools = new Set()
  for (const s of sessions) for (const k of Object.keys(s.tool_counts || {})) tools.add(k)
  return tools.size >= 3 ? 1 : tools.size === 2 ? 0.75 : tools.size === 1 ? 0.4 : 0.7
}
