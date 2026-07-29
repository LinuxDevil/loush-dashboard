
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
export const NEW_CAPABILITY_DAYS = 14

export function capabilityVerdict({ firesAll = 0, fires30 = 0, ageDays = null, minAgeDays = NEW_CAPABILITY_DAYS }) {
  if (firesAll > 0) return fires30 === 0 ? 'COLD' : 'HOT'
  if (ageDays != null && ageDays < minAgeDays) return 'NEW'
  return 'DEAD'
}

export function tokPerFire({ descTokens = 0, fires = 0, sessionsSinceInstall = null }) {
  if (!fires || sessionsSinceInstall == null || sessionsSinceInstall <= 0) return null
  return Math.round(descTokens * sessionsSinceInstall / fires)
}

export function sessionsSince(sessionTimes = [], installedAt = null, windowStart = 0) {
  if (installedAt == null) return null
  const from = Math.max(installedAt, windowStart)
  return sessionTimes.filter(t => t >= from).length
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
export const CHARS_PER_TOKEN = 4

const pctl = (arr, p) => {
  if (!arr.length) return null
  const a = [...arr].sort((x, y) => x - y)
  return a[Math.min(a.length - 1, Math.max(0, Math.floor((a.length - 1) * p)))]
}
export const median = arr => pctl(arr, 0.5)

export function contextPressure({ bytesByTool = {}, sizesByTool = {}, hogChars = 20000, limit = 20 }) {
  const totalBytes = Object.values(bytesByTool).reduce((a, b) => a + b, 0)
  const tools = Object.keys(bytesByTool).map(name => {
    const sizes = sizesByTool[name] || []
    const med = median(sizes)
    return {
      name,
      chars: bytesByTool[name],
      estTokens: Math.round(bytesByTool[name] / CHARS_PER_TOKEN),
      shareOfToolBytes: totalBytes ? +(bytesByTool[name] / totalBytes).toFixed(3) : null,
      results: sizes.length,
      medianChars: med == null ? null : Math.round(med),
      p90Chars: sizes.length ? Math.round(pctl(sizes, 0.9)) : null,
      hog: med != null && med >= hogChars,
    }
  }).sort((a, b) => b.chars - a.chars).slice(0, limit)
  return {
    tools,
    totalChars: totalBytes,
    totalEstTokens: Math.round(totalBytes / CHARS_PER_TOKEN),
    charsPerToken: CHARS_PER_TOKEN,
    denominator: 'tool-result bytes only — excludes system prompt, CLAUDE.md, user turns and assistant output',
  }
}
