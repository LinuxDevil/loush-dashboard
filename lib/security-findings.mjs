// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------


export const ID_DESCRIPTION_CHARS = 200

export const MAX_RAW_EXCERPT = 500

export const PRE_SEEDED_REACTION_BASELINE = 1

export const REVIEW_COMMENT_MARKER = '🤖 **Security Issue:'

export const FAIL_OPEN_SIGNATURES = [
  { pattern: /claude api failed/i, kind: 'api_error', note: 'per-finding filter call failed; finding kept unfiltered' },
  { pattern: /claude filtering disabled/i, kind: 'filter_disabled', note: 'API access probe failed; LLM filtering ran for no finding in this run' },
]


const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v)

const str = v => (typeof v === 'string' && v.trim() !== '' ? v : null)

const num = v => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

const excerpt = v => {
  const s = typeof v === 'string' ? v : (() => { try { return JSON.stringify(v) } catch { return String(v) } })()
  if (s == null) return { text: null, excerptTruncated: false }
  return s.length > MAX_RAW_EXCERPT
    ? { text: s.slice(0, MAX_RAW_EXCERPT), excerptTruncated: true }
    : { text: s, excerptTruncated: false }
}

const malformedEntry = (where, reason, raw) => {
  const { text, excerptTruncated } = excerpt(raw)
  return { where, reason, raw: text, excerptTruncated }
}

export const fileExtension = file => {
  const s = typeof file === 'string' ? file : ''
  const dot = s.lastIndexOf('.')
  return dot === -1 ? '' : s.slice(dot).toLowerCase()
}

const normSeverity = v => {
  const s = str(v)
  return s == null ? null : s.trim().toUpperCase()
}

export const findingKey = f => {
  const desc = (f?.description || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, ID_DESCRIPTION_CHARS)
  return [f?.file ?? '', f?.line ?? '', f?.category ?? '', desc].join('|')
}


const normalizeFinding = (raw, source, malformed, where) => {
  if (!isObj(raw)) {
    malformed.push(malformedEntry(where, 'finding is not an object', raw))
    return null
  }
  const meta = isObj(raw._filter_metadata) ? raw._filter_metadata : null
  const justification = meta ? str(meta.justification) : null
  const f = {
    source,
    file: str(raw.file) ?? str(raw.path),
    line: num(raw.line) ?? num(raw.start?.line),
    severity: normSeverity(raw.severity),
    severityRaw: str(raw.severity),
    category: str(raw.category),
    description: str(raw.description),
    exploitScenario: str(raw.exploit_scenario),
    recommendation: str(raw.recommendation),
    title: str(raw.title),
    confidence: num(raw.confidence),
    filterConfidenceScore: meta ? num(meta.confidence_score) : null,
    filterJustification: justification,
    failOpen: null,
    reactions: null,
    reactionsAboveBaseline: null,
    commentId: null,
    raw,
  }
  const sig = justification ? FAIL_OPEN_SIGNATURES.find(s => s.pattern.test(justification)) : null
  f.failOpen = sig ? { kind: sig.kind, note: sig.note, justification } : null
  f.key = findingKey(f)
  return f
}


const normalizeFilterStats = fa => {
  if (!isObj(fa)) return null
  return {
    totalFindings: num(fa.total_findings),
    keptFindings: num(fa.kept_findings),
    excludedFindings: num(fa.excluded_findings),
    hardExcluded: num(fa.hard_excluded),
    claudeExcluded: num(fa.claude_excluded),
    directoryExcludedCount: num(fa.directory_excluded_count),
    averageConfidence: num(fa.average_confidence),
    runtimeSeconds: num(fa.runtime_seconds),
    exclusionBreakdown: isObj(fa.exclusion_breakdown) ? { ...fa.exclusion_breakdown } : null,
  }
}

const normalizeExcludedRecord = (rec, i, malformed) => {
  const where = `excluded_findings_details[${i}]`
  if (!isObj(rec)) {
    malformed.push(malformedEntry(where, 'excluded record is not an object', rec))
    return null
  }
  const stageRaw = str(rec.filter_stage)
  if (stageRaw === 'hard_rules' || stageRaw === 'claude_api') {
    const finding = normalizeFinding(rec.finding, 'results-json', malformed, `${where}.finding`)
    if (!finding) return null
    return {
      stage: stageRaw,
      finding,
      index: num(rec.index),
      reason: str(rec.exclusion_reason),
      justification: str(rec.justification),
      confidenceScore: num(rec.confidence_score),
    }
  }
  if (stageRaw != null) {
    malformed.push(malformedEntry(where, `unknown filter_stage "${stageRaw}"`, rec))
    const finding = normalizeFinding(rec.finding ?? rec, 'results-json', malformed, `${where}.finding`)
    if (!finding) return null
    return { stage: null, finding, index: num(rec.index), reason: str(rec.exclusion_reason), justification: str(rec.justification), confidenceScore: num(rec.confidence_score) }
  }
  const finding = normalizeFinding(rec, 'results-json', malformed, where)
  if (!finding) return null
  return { stage: 'directory', finding, index: null, reason: null, justification: null, confidenceScore: null }
}

/**
 * Parse the `claudecode-results.json` file from the `security-review-results` artifact.
 *
 * Accepts a JSON string or an already-parsed object. Never throws.
 *
 * @returns {{
 *   ok: boolean, error: string|null, extractionFailed: boolean,
 *   prNumber: number|null, repo: string|null,
 *   findings: object[], excluded: object[],
 *   filteringSummary: object|null, filterStats: object|null,
 *   analysisSummaryPreFilter: object|null,
 *   filterFailedOpen: boolean, failOpen: object,
 *   bounds: object, malformed: object[]
 * }}
 */
export function parseResultsJson(raw) {
  const malformed = []
  const empty = () => ({
    ok: false,
    error: null,
    extractionFailed: false,
    prNumber: null,
    repo: null,
    findings: [],
    excluded: [],
    filteringSummary: null,
    filterStats: null,
    analysisSummaryPreFilter: null,
    filterFailedOpen: false,
    failOpen: { failedOpen: false, kinds: [], affectedFindings: 0, justifications: [], detectedFrom: [] },
    bounds: { idDescriptionChars: ID_DESCRIPTION_CHARS, maxRawExcerpt: MAX_RAW_EXCERPT },
    malformed,
  })

  let doc = raw
  if (typeof raw === 'string') {
    try {
      doc = JSON.parse(raw)
    } catch (err) {
      const out = empty()
      out.malformed.push(malformedEntry('root', `JSON parse failed: ${err.message}`, raw))
      return out
    }
  }
  if (!isObj(doc)) {
    const out = empty()
    out.malformed.push(malformedEntry('root', 'top-level value is not an object', raw))
    return out
  }

  const out = empty()

  if (str(doc.error) && !Array.isArray(doc.findings)) {
    out.error = str(doc.error)
    return out
  }

  out.prNumber = num(doc.pr_number)
  out.repo = str(doc.repo)

  if (Array.isArray(doc.findings)) {
    out.ok = true
    doc.findings.forEach((f, i) => {
      const n = normalizeFinding(f, 'results-json', malformed, `findings[${i}]`)
      if (n) out.findings.push(n)
    })
  } else if (doc.findings != null) {
    malformed.push(malformedEntry('findings', 'expected an array', doc.findings))
  } else {
    malformed.push(malformedEntry('findings', 'key absent', null))
  }

  const fs = isObj(doc.filtering_summary) ? doc.filtering_summary : null
  if (doc.filtering_summary != null && !fs) {
    malformed.push(malformedEntry('filtering_summary', 'expected an object', doc.filtering_summary))
  }
  if (fs) {
    out.filteringSummary = {
      totalOriginalFindings: num(fs.total_original_findings),
      excludedFindings: num(fs.excluded_findings),
      keptFindings: num(fs.kept_findings),
    }
    out.filterStats = normalizeFilterStats(fs.filter_analysis)
    if (fs.filter_analysis != null && !out.filterStats) {
      malformed.push(malformedEntry('filtering_summary.filter_analysis', 'expected an object', fs.filter_analysis))
    }
    if (Array.isArray(fs.excluded_findings_details)) {
      fs.excluded_findings_details.forEach((rec, i) => {
        const n = normalizeExcludedRecord(rec, i, malformed)
        if (n) out.excluded.push(n)
      })
    } else if (fs.excluded_findings_details != null) {
      malformed.push(malformedEntry('filtering_summary.excluded_findings_details', 'expected an array', fs.excluded_findings_details))
    }
  }

  const as = isObj(doc.analysis_summary) ? doc.analysis_summary : null
  if (as) {
    out.analysisSummaryPreFilter = {
      filesReviewed: num(as.files_reviewed),
      highSeverity: num(as.high_severity),
      mediumSeverity: num(as.medium_severity),
      lowSeverity: num(as.low_severity),
      reviewCompleted: typeof as.review_completed === 'boolean' ? as.review_completed : null,
      note: 'model self-report, taken pre-filter; disagrees with filterStats by design',
    }
    out.extractionFailed = as.review_completed === false && out.findings.length === 0
  }

  const affected = [...out.findings, ...out.excluded.map(e => e.finding)].filter(f => f.failOpen)
  const kinds = [...new Set(affected.map(f => f.failOpen.kind))]
  const justifications = [...new Set(affected.map(f => f.failOpen.justification))]
  const detectedFrom = affected.length ? ['finding_justification'] : []

  if (out.filterStats && out.filterStats.averageConfidence == null && (out.filterStats.claudeExcluded ?? 0) === 0 && out.findings.length > 0) {
    detectedFrom.push('no_average_confidence')
  }

  out.filterFailedOpen = affected.length > 0
  out.failOpen = {
    failedOpen: out.filterFailedOpen,
    kinds,
    affectedFindings: affected.length,
    justifications,
    detectedFrom,
  }

  return out
}


const LABELS = ['Severity', 'Category', 'Tool', 'Exploit Scenario', 'Recommendation']

const labelValue = (body, label) => {
  const re = new RegExp(`(?:^|\\n)\\*\\*${label}:\\*\\*[ \\t]*([\\s\\S]*?)(?=\\n\\*\\*[A-Z][\\w ]*:\\*\\*|$)`)
  const m = body.match(re)
  return m ? str(m[1].trim()) : null
}

/**
 * Parse the bot's `🤖 **Security Issue:` PR review comments.
 *
 * Accepts the array returned by `GET /pulls/{n}/comments` (or issue comments). Never throws.
 * The header message is the finding's `description` — that is exactly what the upstream
 * commenter puts there (`finding.description || … || 'Security vulnerability detected'`).
 *
 * @returns {{ findings: object[], skipped: object[], reactionBaseline: number,
 *             bounds: object, malformed: object[] }}
 */
export function parseReviewComments(comments) {
  const malformed = []
  const findings = []
  const skipped = []
  const out = () => ({
    findings,
    skipped,
    reactionBaseline: PRE_SEEDED_REACTION_BASELINE,
    marker: REVIEW_COMMENT_MARKER,
    bounds: { idDescriptionChars: ID_DESCRIPTION_CHARS, maxRawExcerpt: MAX_RAW_EXCERPT },
    malformed,
  })

  let list = comments
  if (typeof list === 'string') {
    try { list = JSON.parse(list) } catch (err) {
      malformed.push(malformedEntry('root', `JSON parse failed: ${err.message}`, comments))
      return out()
    }
  }
  if (!Array.isArray(list)) {
    malformed.push(malformedEntry('root', 'expected an array of comments', comments))
    return out()
  }

  list.forEach((c, i) => {
    const where = `comments[${i}]`
    if (!isObj(c)) {
      malformed.push(malformedEntry(where, 'comment is not an object', c))
      return
    }
    const body = typeof c.body === 'string' ? c.body : null
    if (body == null) {
      malformed.push(malformedEntry(where, 'comment has no string body', c))
      return
    }
    const trimmed = body.replace(/^﻿/, '').trimStart()
    if (!trimmed.startsWith(REVIEW_COMMENT_MARKER)) {
      skipped.push({ index: i, id: c.id ?? null, reason: 'no security-issue marker' })
      return
    }

    const head = trimmed.slice(REVIEW_COMMENT_MARKER.length).split(/\n\s*\n/)[0] ?? ''
    const message = str(head.replace(/\*\*\s*$/, '').trim())
    if (message == null) {
      malformed.push(malformedEntry(where, 'security-issue marker present but header message empty', body))
    }

    const rest = trimmed
    const values = {}
    for (const label of LABELS) values[label] = labelValue(rest, label)

    const shaped = {
      file: c.path ?? null,
      line: num(c.line) ?? num(c.original_line) ?? num(c.position) ?? null,
      severity: values.Severity,
      category: values.Category,
      description: message,
      exploit_scenario: values['Exploit Scenario'],
      recommendation: values.Recommendation,
    }
    const f = normalizeFinding(shaped, 'pr-comment', malformed, where)
    if (!f) return

    f.tool = values.Tool
    f.commentId = c.id ?? null
    f.commentUrl = str(c.html_url) ?? str(c.url)
    f.commitId = str(c.commit_id) ?? str(c.original_commit_id)
    f.authorIsBot = isObj(c.user) && typeof c.user.type === 'string' ? c.user.type === 'Bot' : null
    f.raw = c

    const r = isObj(c.reactions) ? c.reactions : null
    if (r) {
      const up = num(r['+1'])
      const down = num(r['-1'])
      f.reactions = { up, down, total: num(r.total_count) }
      f.reactionsAboveBaseline = {
        up: up == null ? null : Math.max(0, up - PRE_SEEDED_REACTION_BASELINE),
        down: down == null ? null : Math.max(0, down - PRE_SEEDED_REACTION_BASELINE),
        baseline: PRE_SEEDED_REACTION_BASELINE,
        note: 'bot pre-seeds one 👍 and one 👎 per comment; counts of 1 are not human signal',
      }
    }

    findings.push(f)
  })

  return out()
}


const C_LIKE_EXTENSIONS = new Set(['.c', '.cc', '.cpp', '.h'])

const RULES = [
  {
    id: 'markdown_file',
    reason: 'Finding in Markdown documentation file',
    family: 'file path',
    patterns: [],
    matchFile: file => fileExtension(file) === '.md',
  },
  {
    id: 'dos',
    reason: 'Generic DOS/resource exhaustion finding (low signal)',
    family: 'denial of service / resource exhaustion',
    patterns: [
      /denial of service|dos attack|resource exhaustion/i,
      /(exhaust|overwhelm|overload).*(resource|memory|cpu)/i,
      /(infinite|unbounded).*(loop|recursion)/i,
    ],
  },
  {
    id: 'rate_limiting',
    reason: 'Generic rate limiting recommendation',
    family: 'rate limiting',
    patterns: [
      /(missing|lack of|no)\s+rate.?limit/i,
      /rate.?limiting (missing|required)/i,
      /(implement|add) rate.?limit/i,
      /unlimited (requests|calls|api)/i,
    ],
  },
  {
    id: 'resource_management',
    reason: 'Resource management finding (not a security vulnerability)',
    family: 'leaks / cleanup',
    patterns: [
      /(resource|memory|file) leak potential/i,
      /unclosed (resource|file|connection)/i,
      /(close|cleanup|release) resource/i,
      /potential memory leak/i,
      /(database|thread|socket|connection) leak/i,
    ],
  },
  {
    id: 'open_redirect',
    reason: 'Open redirect vulnerability (not high impact)',
    family: 'redirects',
    patterns: [
      /open redirect/i,
      /unvalidated redirect/i,
      /redirect (attack|exploit|vulnerability)|malicious redirect/i,
    ],
  },
  {
    id: 'regex_injection',
    reason: 'Regex injection finding (not applicable)',
    family: 'regex injection / ReDoS',
    patterns: [
      /(regex|regular expression) injection/i,
      /(regex|regular expression).*denial of service/i,
      /(regex|regular expression).*flooding/i,
    ],
  },
  {
    id: 'memory_safety',
    reason: 'Memory safety finding in non-C/C++ code (not applicable)',
    family: 'memory safety',
    matchFile: file => !C_LIKE_EXTENSIONS.has(fileExtension(file)),
    patterns: [
      /(buffer|stack|heap) overflow/i,
      /(oob|out.of.bounds) (read|write|access)/i,
      /out-of-bounds/i,
      /memory (safety|corruption)/i,
      /use.after.free|double.free|null.pointer.dereference/i,
      /segfault|segmentation fault/i,
      /bounds check/i,
      /integer (overflow|underflow|conversion)/i,
      /arbitrary memory read/i,
    ],
  },
  {
    id: 'ssrf_in_html',
    reason: 'SSRF finding in HTML file (not applicable to client-side code)',
    family: 'SSRF',
    matchFile: file => fileExtension(file) === '.html',
    patterns: [/ssrf|server-side request forgery/i],
  },
]

/**
 * The exclusion rule set, as inspectable data. Returns a fresh array of fresh rule objects
 * on every call, so a caller can reorder, disable or edit rules without mutating the module.
 * Each rule: { id, reason, family, patterns: string[], fileCondition: string|null, test(f) }
 */
export function hardExclusionRules() {
  return RULES.map(r => ({
    id: r.id,
    reason: r.reason,
    family: r.family,
    patterns: r.patterns.map(p => p.source),
    fileCondition:
      r.id === 'markdown_file' ? 'file extension is .md'
      : r.id === 'memory_safety' ? 'file extension is not one of .c .cc .cpp .h (an extensionless file counts as not-C/C++)'
      : r.id === 'ssrf_in_html' ? 'file extension is .html'
      : null,
    test(finding) {
      const f = isObj(finding) ? finding : {}
      if (r.matchFile && !r.matchFile(f.file)) return null
      if (r.patterns.length === 0) {
        return { ruleId: r.id, reason: r.reason, matchedOn: 'file', pattern: null, evidence: f.file ?? null }
      }
      const hay = `${f.title || ''} ${f.description || ''}`.toLowerCase()
      for (const p of r.patterns) {
        const m = hay.match(p)
        if (m) return { ruleId: r.id, reason: r.reason, matchedOn: 'description', pattern: p.source, evidence: m[0] }
      }
      return null
    },
  }))
}

/**
 * Re-run noise suppression locally over an UNFILTERED finding set, with the user's own
 * choices rather than one vendor's.
 *
 * Every exclusion is attributed — which rule fired, on what text, and why. A silently
 * dropped finding is indistinguishable from one that was never found, so nothing here
 * drops anything without a record.
 *
 * @param findings  array of normalised findings (or raw-ish objects; shapeless entries are
 *                  reported in `malformed` and kept, never silently discarded)
 * @param opts.rules              rule objects from `hardExclusionRules()` (default: all)
 * @param opts.disabledRuleIds    rule ids to skip (recorded in `rulesSkipped`)
 * @param opts.severityAllow      keep only these severities (case-insensitive)
 * @param opts.excludeUnknownSeverity  default false — a finding with no severity is kept,
 *                                because unknown is a value, not a reason to disappear
 * @param opts.minFilterConfidence     drop findings whose 1–10 filter score is below this;
 *                                a finding with no score is kept and flagged, not dropped
 */
export function applyFilters(findings, opts = {}) {
  const malformed = []
  const kept = []
  const excluded = []

  const options = isObj(opts) ? opts : {}
  const disabled = new Set(Array.isArray(options.disabledRuleIds) ? options.disabledRuleIds : [])
  const allRules = Array.isArray(options.rules) ? options.rules : hardExclusionRules()
  const rules = allRules.filter(r => isObj(r) && typeof r.test === 'function' && !disabled.has(r.id))
  const rulesSkipped = allRules.filter(r => isObj(r) && disabled.has(r.id)).map(r => r.id)

  const severityAllow = Array.isArray(options.severityAllow)
    ? new Set(options.severityAllow.map(s => String(s).toUpperCase()))
    : null
  const excludeUnknownSeverity = options.excludeUnknownSeverity === true
  const minFilterConfidence = num(options.minFilterConfidence)

  let list = findings
  if (!Array.isArray(list)) {
    malformed.push(malformedEntry('root', 'expected an array of findings', findings))
    list = []
  }

  const drop = (finding, record) => excluded.push({ finding, ...record })

  list.forEach((finding, i) => {
    if (!isObj(finding)) {
      malformed.push(malformedEntry(`findings[${i}]`, 'finding is not an object', finding))
      return
    }

    let hit = null
    for (const rule of rules) {
      let r = null
      try { r = rule.test(finding) } catch (err) {
        malformed.push(malformedEntry(`rules.${rule.id}`, `rule threw: ${err.message}`, finding.description))
        continue
      }
      if (r) { hit = r; break }
    }
    if (hit) { drop(finding, { ...hit, stage: 'hard_rules' }); return }

    const sev = normSeverity(finding.severity)
    if (sev == null && excludeUnknownSeverity) {
      drop(finding, { ruleId: 'severity_unknown', reason: 'Severity is unknown and excludeUnknownSeverity was set', matchedOn: 'severity', pattern: null, evidence: null, stage: 'severity' })
      return
    }
    if (sev != null && severityAllow && !severityAllow.has(sev)) {
      drop(finding, { ruleId: 'severity_filter', reason: `Severity ${sev} not in the allowed set`, matchedOn: 'severity', pattern: null, evidence: sev, stage: 'severity' })
      return
    }

    if (minFilterConfidence != null) {
      const score = num(finding.filterConfidenceScore)
      if (score != null && score < minFilterConfidence) {
        drop(finding, { ruleId: 'min_filter_confidence', reason: `Filter confidence ${score} below the ${minFilterConfidence} threshold`, matchedOn: 'filterConfidenceScore', pattern: null, evidence: score, stage: 'confidence' })
        return
      }
      if (score == null) {
        kept.push(finding)
        return
      }
    }

    kept.push(finding)
  })

  const byRule = {}
  for (const e of excluded) byRule[e.ruleId] = (byRule[e.ruleId] || 0) + 1

  return {
    kept,
    excluded,
    byRule,
    total: list.length,
    rulesApplied: rules.map(r => r.id),
    rulesSkipped,
    bounds: { idDescriptionChars: ID_DESCRIPTION_CHARS, maxRawExcerpt: MAX_RAW_EXCERPT, capped: false },
    malformed,
  }
}
