// harness-metrics.mjs — pure plane-B metrics extracted from server.mjs so their arithmetic can be
// pinned by tests. server.mjs starts a listener on import and cannot be imported by a test file,
// which is exactly why these were never covered.

// ---------------------------------------------------------------------------
// capability ROI: verdict + the always-on tax per fire
// ---------------------------------------------------------------------------
//
// WAS: `verdict = !firesAll ? 'DEAD' : fires30 === 0 ? 'COLD' : 'HOT'`, and
//      `tokPerFire = descTokens * sessions90 / fires90`.
//
// Two problems, both of which punish a capability for being NEW:
//   1. A skill installed this morning has never fired, so it was labelled **DEAD** — the same label
//      as one abandoned a year ago — and the headline invited you to archive it.
//   2. tokPerFire multiplied by *every* session in the 90-day window, including the hundreds that
//      ran before the file existed. Install a skill yesterday, fire it once, and it was charged 90
//      days of sessions' worth of always-on tax.
//
// NOW: both are scoped to the capability's own lifetime. `sessionsSinceInstall` is the sessions that
// could actually have loaded it, and anything younger than `minAgeDays` with no fires is **NEW**
// (not yet judgeable) rather than DEAD.
//
// `installedAt` is the file's mtime, which is a lower bound on age: editing a file resets it, so an
// old-but-recently-edited capability reads as young. That error is in the safe direction — it
// withholds a DEAD verdict rather than inventing one.
export const NEW_CAPABILITY_DAYS = 14

export function capabilityVerdict({ firesAll = 0, fires30 = 0, ageDays = null, minAgeDays = NEW_CAPABILITY_DAYS }) {
  if (firesAll > 0) return fires30 === 0 ? 'COLD' : 'HOT'
  if (ageDays != null && ageDays < minAgeDays) return 'NEW'
  return 'DEAD'
}

/** Always-on tokens actually paid per invocation, over the sessions that could have loaded it. */
export function tokPerFire({ descTokens = 0, fires = 0, sessionsSinceInstall = null }) {
  if (!fires || sessionsSinceInstall == null || sessionsSinceInstall <= 0) return null
  return Math.round(descTokens * sessionsSinceInstall / fires)
}

/** Sessions that started after the capability existed. Null installedAt → cannot scope, so null. */
export function sessionsSince(sessionTimes = [], installedAt = null, windowStart = 0) {
  if (installedAt == null) return null
  const from = Math.max(installedAt, windowStart)
  return sessionTimes.filter(t => t >= from).length
}

// ---------------------------------------------------------------------------
// context pressure
// ---------------------------------------------------------------------------
//
// WAS: `share = bytes[tool] / totalBytes`, rendered under a heading about the context WINDOW. It is
// the share of tool-result CHARACTERS, which is a different denominator: it excludes the system
// prompt, CLAUDE.md, user turns and assistant output — several of the window's largest occupants.
// So a tool at "60%" was 60% of tool results, not 60% of the window, and the panel invited the
// second reading.
//
// Three further bugs in the old version:
//   * `median(sizes[name] || [0])` turned "no results recorded" into a median of 0.
//   * The p90 line sorted `sizes[name]` IN PLACE, mutating the caller's array mid-computation.
//   * Characters were presented as if they were tokens.
//
// NOW: the field is named `shareOfToolBytes` so it cannot be misread as window share, characters are
// converted to an explicitly-labelled token ESTIMATE, sorting is done on a copy, and a tool with no
// recorded results gets `null` medians rather than 0.
export const CHARS_PER_TOKEN = 4 // rough, and labelled as such wherever it surfaces

const pctl = (arr, p) => {
  if (!arr.length) return null
  const a = [...arr].sort((x, y) => x - y)          // copy: never sort the caller's array
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
      // share of TOOL-RESULT bytes — deliberately not called "share of context"
      shareOfToolBytes: totalBytes ? +(bytesByTool[name] / totalBytes).toFixed(3) : null,
      results: sizes.length,
      medianChars: med == null ? null : Math.round(med),   // null, not 0, when nothing was recorded
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
