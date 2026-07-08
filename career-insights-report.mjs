// QUARANTINED: this module parses the undocumented /insights report.html. It must NEVER throw
// into callers — every export is wrapped so a schema change here can't take down numeric panels.
const strip = s => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
const all = (re, s) => { const out = []; let m; while ((m = re.exec(s))) out.push(m); return out }
const between = (s, startRe, endRe) => { const a = startRe.exec(s); if (!a) return ''; const rest = s.slice(a.index + a[0].length); const b = endRe.exec(rest); return b ? rest.slice(0, b.index) : rest }

const emptyShape = () => ({
  atAGlance: {}, wins: [], friction: [], horizon: [], suggestedClaudeMd: [], features: [], patterns: [],
  stats: { messages: 0, sessions: 0, dateRange: '' },
})

function parse(html) {
  const h = String(html || '')
  const glance = {}
  for (const m of all(/<div class="glance-section"><strong>([^:]+):<\/strong>([\s\S]*?)<\/div>/g, h)) {
    const key = strip(m[1]).toLowerCase()
    const text = strip(m[2]).replace(/→$/, '').trim()
    if (key.includes('working')) glance.working = text
    else if (key.includes('hindering')) glance.hindering = text
    else if (key.includes('quick')) glance.quickWins = text
    else if (key.includes('ambitious')) glance.ambitious = text
  }
  const wins = all(/<div class="big-win-title">([\s\S]*?)<\/div>\s*<div class="big-win-desc">([\s\S]*?)<\/div>/g, h)
    .map(m => ({ title: strip(m[1]), desc: strip(m[2]) }))
  const friction = all(/<div class="friction-title">([\s\S]*?)<\/div>\s*<div class="friction-desc">([\s\S]*?)<\/div>(?:\s*<ul class="friction-examples">([\s\S]*?)<\/ul>)?/g, h)
    .map(m => ({
      title: strip(m[1]),
      desc: strip(m[2]),
      examples: m[3] ? all(/<li>([\s\S]*?)<\/li>/g, m[3]).map(li => strip(li[1])) : [],
    }))
  const horizon = all(/<div class="horizon-title">([\s\S]*?)<\/div>\s*<div class="horizon-possible">([\s\S]*?)<\/div>/g, h)
    .map(m => ({ title: strip(m[1]), possible: strip(m[2]) }))
  const suggestedClaudeMd = all(/<code class="cmd-code">([\s\S]*?)<\/code>[\s\S]*?<div class="cmd-why">([\s\S]*?)<\/div>/g, h)
    .map(m => ({ code: strip(m[1]), why: strip(m[2]) }))
  const features = all(/<div class="feature-title">([\s\S]*?)<\/div>\s*<div class="feature-oneliner">([\s\S]*?)<\/div>[\s\S]*?<div class="feature-why">([\s\S]*?)<\/div>/g, h)
    .map(m => ({ title: strip(m[1]), oneliner: strip(m[2]), why: strip(m[3]) }))
  const patterns = all(/<div class="pattern-title">([\s\S]*?)<\/div>\s*<div class="pattern-summary">([\s\S]*?)<\/div>\s*<div class="pattern-detail">([\s\S]*?)<\/div>(?:[\s\S]*?<code class="copyable-prompt">([\s\S]*?)<\/code>)?/g, h)
    .map(m => ({ title: strip(m[1]), summary: strip(m[2]), detail: strip(m[3]), prompt: m[4] ? strip(m[4]) : '' }))
  const sub = strip(between(h, /<p class="subtitle">/, /<\/p>/))
  const mm = /(\d+)\s+messages? across\s+(\d+)\s+sessions/i.exec(sub)
  const stats = { messages: mm ? +mm[1] : 0, sessions: mm ? +mm[2] : 0, dateRange: (sub.split('|')[1] || '').trim() }
  return { atAGlance: glance, wins, friction, horizon, suggestedClaudeMd, features, patterns, stats }
}

export function parseReportNarrative(html) {
  try { return parse(html) }
  catch (e) { return { error: e.message, ...emptyShape() } }
}
