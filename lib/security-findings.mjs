// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------


import {
  ID_DESCRIPTION_CHARS, MAX_RAW_EXCERPT,
  isObj, str, num, excerpt, malformedEntry, fileExtension, normSeverity,
} from './security-findings-shared.mjs'
import { hardExclusionRules, applyFilters } from './security-findings-filter.mjs'

export { ID_DESCRIPTION_CHARS, MAX_RAW_EXCERPT, fileExtension, hardExclusionRules, applyFilters }

export const PRE_SEEDED_REACTION_BASELINE = 1

export const REVIEW_COMMENT_MARKER = '🤖 **Security Issue:'

export const FAIL_OPEN_SIGNATURES = [
  { pattern: /claude api failed/i, kind: 'api_error', note: 'per-finding filter call failed; finding kept unfiltered' },
  { pattern: /claude filtering disabled/i, kind: 'filter_disabled', note: 'API access probe failed; LLM filtering ran for no finding in this run' },
]


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
