// Parse "level | area | expectation" lines into ladder rows, preserving evidence/links on re-parse by area+level.
export function parseLadder(text, prev = []) {
  const byKey = new Map(prev.map(r => [`${r.level}|${r.area}`, r]))
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const [level = '', area = '', expectation = ''] = line.split('|').map(s => s.trim())
    const k = `${level}|${area}`, old = byKey.get(k)
    return { level, area, expectation, evidenceState: old?.evidenceState || 'yellow', bragLinks: old?.bragLinks || [] }
  })
}
