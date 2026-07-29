// Security-findings ingestion for `anthropics/claude-code-security-review`.
//
// Two pure parsers plus a client-side noise classifier. Nothing here touches fs or the
// network — callers own all fetching. Nothing here throws: a truncated or half-written
// artifact is the expected case, not an exception, so every entry point returns what it
// could parse alongside a `malformed` list describing what it could not.
//
// ---------------------------------------------------------------------------
// Attribution — the exclusion rules in `hardExclusionRules()` are a port of
// `claudecode/findings_filter.py::HardExclusionRules` from
// https://github.com/anthropics/claude-code-security-review
//
//   Copyright (c) 2025 Anthropic
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy
//   of this software and associated documentation files (the "Software"), to deal
//   in the Software without restriction, including without limitation the rights
//   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//   copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in all
//   copies or substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
//   SOFTWARE.
//
// Honesty note on that port: the rule *families*, their evaluation order, their reason
// strings and their file-extension conditions are taken from the documented behaviour of
// `HardExclusionRules` (RESEARCH_MERGED.md, "The false-positive pipeline — five stages",
// Stage 2). The individual regex bodies below are reconstructed from that table's pattern
// descriptions and have NOT been diffed character-for-character against upstream source.
// Treat rule identity as verified and exact pattern equivalence as unverified.
// ---------------------------------------------------------------------------
//
// Schema sources, all RESEARCH_MERGED.md, section "B. claude-code-security-review":
//   - finding fields + types ............ "Field-level facts" table
//   - `_filter_metadata` ................ "3. Enrichment and exclusion records"
//   - three excluded-record shapes ...... same section
//   - `claudecode-results.json` shape ... "4. The final artefact"
//   - `{"error": …}` failure shape ...... same section, "Failure shape"
//   - PR comment body layout ............ "6. How findings surface as PR comments"
//   - fail-open justifications .......... "Stage 3 — per-finding LLM adjudication"

// ── declared bounds (no silent caps: every bound is exported and reported) ──────────────

// Description text folded into a finding's dedupe key is truncated to this many characters.
export const ID_DESCRIPTION_CHARS = 200

// Raw text carried on a `malformed` entry for debugging is truncated to this many characters.
// When it bites, the entry carries `excerptTruncated: true`.
export const MAX_RAW_EXCERPT = 500

// The bot posts BOTH a 👍 and a 👎 to every comment it creates, as a one-click feedback
// affordance. So a reaction count of 1 is the machine's own seed, not a human opinion.
// `reactionsAboveBaseline` subtracts this; `reactions` reports the raw counts unaltered.
export const PRE_SEEDED_REACTION_BASELINE = 1

// The literal selector for a bot finding comment. Stable and unique upstream.
export const REVIEW_COMMENT_MARKER = '🤖 **Security Issue:'

// Substrings that appear in a `justification` when the LLM filter did not actually run.
// `confidence_score === 10.0` alone is ambiguous — it means "genuine 10", "API broke", or
// "filtering disabled" — and the justification string is the only disambiguator.
export const FAIL_OPEN_SIGNATURES = [
  { pattern: /claude api failed/i, kind: 'api_error', note: 'per-finding filter call failed; finding kept unfiltered' },
  { pattern: /claude filtering disabled/i, kind: 'filter_disabled', note: 'API access probe failed; LLM filtering ran for no finding in this run' },
]

// ── small, total helpers ───────────────────────────────────────────────────────────────

const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v)

const str = v => (typeof v === 'string' && v.trim() !== '' ? v : null)

// Numbers only when they really are numbers. Absent stays absent — see `num` callers:
// a missing statistic is null, never 0, because "we counted zero" and "we were not told"
// are different facts and a dashboard that renders both as 0 is lying.
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

// Lowercased extension including the dot, '' when the basename holds no dot.
// Upstream splits on the last dot of the whole path, so an extensionless file yields ''
// and is therefore treated as *not* C/C++ — memory-safety findings are dropped there too.
export const fileExtension = file => {
  const s = typeof file === 'string' ? file : ''
  const dot = s.lastIndexOf('.')
  return dot === -1 ? '' : s.slice(dot).toLowerCase()
}

// Severity is reported exactly as `null` when absent. Upstream emits HIGH/MEDIUM/LOW by
// convention only — nothing enforces the casing, and nothing enforces its presence.
// Defaulting a missing severity to 'medium' would invent a fact; we refuse to.
const normSeverity = v => {
  const s = str(v)
  return s == null ? null : s.trim().toUpperCase()
}

// Cross-run finding identity has to be reconstructed: upstream emits no rule ID, no CWE and
// no fingerprint. file + line + category + normalised description is the best available key.
export const findingKey = f => {
  const desc = (f?.description || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, ID_DESCRIPTION_CHARS)
  return [f?.file ?? '', f?.line ?? '', f?.category ?? '', desc].join('|')
}

// ── finding normalisation ──────────────────────────────────────────────────────────────

// One finding, from either ingestion path, in one shape.
//
// Note the two incompatible confidence scales upstream keeps on the same object and never
// reconciles: `confidence` is a 0.0–1.0 float from the scan prompt; `filterConfidenceScore`
// is a 1–10 integer from the filter prompt. They are kept separate here for that reason.
const normalizeFinding = (raw, source, malformed, where) => {
  if (!isObj(raw)) {
    malformed.push(malformedEntry(where, 'finding is not an object', raw))
    return null
  }
  const meta = isObj(raw._filter_metadata) ? raw._filter_metadata : null
  const justification = meta ? str(meta.justification) : null
  const f = {
    source,                                   // 'results-json' | 'pr-comment'
    file: str(raw.file) ?? str(raw.path),     // upstream's own commenter falls back to .path
    line: num(raw.line) ?? num(raw.start?.line),
    severity: normSeverity(raw.severity),     // null when absent — never defaulted
    severityRaw: str(raw.severity),
    category: str(raw.category),              // free-form snake_case; not an enum
    description: str(raw.description),
    exploitScenario: str(raw.exploit_scenario),
    recommendation: str(raw.recommendation),
    title: str(raw.title),                    // dead field upstream, read here if ever present
    confidence: num(raw.confidence),          // 0.0–1.0 float, or null
    filterConfidenceScore: meta ? num(meta.confidence_score) : null, // 1–10 int, or null
    filterJustification: justification,
    failOpen: null,                           // set below when the justification says so
    reactions: null,                          // PR-comment path only
    reactionsAboveBaseline: null,
    commentId: null,
    raw,
  }
  const sig = justification ? FAIL_OPEN_SIGNATURES.find(s => s.pattern.test(justification)) : null
  f.failOpen = sig ? { kind: sig.kind, note: sig.note, justification } : null
  f.key = findingKey(f)
  return f
}

// ── path 1: the `claudecode-results.json` artifact ─────────────────────────────────────

const normalizeFilterStats = fa => {
  if (!isObj(fa)) return null
  return {
    totalFindings: num(fa.total_findings),
    keptFindings: num(fa.kept_findings),
    excludedFindings: num(fa.excluded_findings),
    hardExcluded: num(fa.hard_excluded),
    claudeExcluded: num(fa.claude_excluded),
    directoryExcludedCount: num(fa.directory_excluded_count),
    // null when no LLM scores were collected — which is itself a fail-open tell.
    averageConfidence: num(fa.average_confidence),
    runtimeSeconds: num(fa.runtime_seconds),
    // Keys are `exclusion_reason.split('(')[0].strip()`, so the set is stable but is not an
    // enum that can be relied on across versions.
    exclusionBreakdown: isObj(fa.exclusion_breakdown) ? { ...fa.exclusion_breakdown } : null,
  }
}

// `excluded_findings_details` is a heterogeneous array of three record shapes, one of them
// unwrapped. Key off the presence of `filter_stage`, never off a uniform wrapper.
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
  // Shape (c): the bare finding, appended raw by the directory-exclusion pass.
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
      // A truncated artifact download lands here. Half a document is still worth reporting
      // as "we have nothing" rather than crashing the ingest for every other repo.
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

  // Failure shape: `main()` prints {"error": "<msg>"} INSTEAD of the results object. The
  // action's own outputs cannot distinguish an errored scan from a clean one; only this can.
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

  // The model's own PRE-filter self-report. It disagrees with filtering_summary by design,
  // so it is namespaced rather than merged; never read counts from it.
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
    // The empty-shell signature of a failed extraction: review_completed false with nothing found.
    out.extractionFailed = as.review_completed === false && out.findings.length === 0
  }

  // ── fail-open detection ──────────────────────────────────────────────────────────────
  // Upstream fails OPEN: when the per-finding filter call errors, or when the API access
  // probe fails and filtering is switched off wholesale, findings are KEPT and stamped
  // confidence_score 10.0. Nothing in the output announces it except the justification
  // string. A "2 of 7 kept" badge over an unfiltered set is a lie about how much review
  // happened, so this is surfaced as an explicit flag for the UI to badge.
  const affected = [...out.findings, ...out.excluded.map(e => e.finding)].filter(f => f.failOpen)
  const kinds = [...new Set(affected.map(f => f.failOpen.kind))]
  const justifications = [...new Set(affected.map(f => f.failOpen.justification))]
  const detectedFrom = affected.length ? ['finding_justification'] : []

  // Second, weaker tell: the filter reported no average confidence at all despite claiming
  // Claude exclusions ran. Recorded as a signal, but never on its own enough to assert.
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

// ── path 2: the bot's PR review comments ───────────────────────────────────────────────

const LABELS = ['Severity', 'Category', 'Tool', 'Exploit Scenario', 'Recommendation']

// `**Label:** value`, value running to the next label or the end of the body.
// Deliberately no `m` flag: with it, `$` in the lookahead matches the end of the first LINE,
// which truncated every multi-paragraph Exploit Scenario and Recommendation at its first
// newline and silently lost the remediation steps.
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
      // Not ours. Not malformed — most PR comments are humans talking.
      skipped.push({ index: i, id: c.id ?? null, reason: 'no security-issue marker' })
      return
    }

    // Header: `🤖 **Security Issue: {message}**`, running to the first blank line.
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
      severity: values.Severity,            // stays null when the line is absent
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

    // 👍/👎 — the only human label anywhere in this pipeline on whether a finding was real.
    const r = isObj(c.reactions) ? c.reactions : null
    if (r) {
      const up = num(r['+1'])
      const down = num(r['-1'])
      f.reactions = { up, down, total: num(r.total_count) }
      // The bot seeds one of each on every comment it creates, so the raw counts have a
      // floor of 1/1 that is not human opinion. Subtracting it is the honest reading, but
      // seeding can fail, so the raw numbers stay available alongside.
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

// ── feature 102: client-side noise classifier ──────────────────────────────────────────

const C_LIKE_EXTENSIONS = new Set(['.c', '.cc', '.cpp', '.h'])

// Seven regex families plus a Markdown-file rule, in upstream evaluation order.
// First match wins. Matched against `${title} ${description}` lowercased — never against
// `category`, and never against the file contents.
//
// Known weakness, worth surfacing in any UI built on this: these regexes match PROSE, not
// structure. A real SQL-injection finding whose description happens to say "unbounded loop"
// is dropped as DOS noise, and a finding that avoids the vocabulary sails through. That is
// precisely why the rules are exposed as data and each exclusion is attributed.
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
    // Only when the extension is NOT C/C++. An extensionless file yields '' and so is
    // treated as non-C/C++ — memory-safety findings are dropped there too, as upstream does.
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
    // Returns the matching evidence, or null. Total: never throws on a shapeless finding.
    test(finding) {
      const f = isObj(finding) ? finding : {}
      if (r.matchFile && !r.matchFile(f.file)) return null
      if (r.patterns.length === 0) {
        return { ruleId: r.id, reason: r.reason, matchedOn: 'file', pattern: null, evidence: f.file ?? null }
      }
      // Upstream matches `f"{title} {description}".lower()` — title is always empty there.
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
      // Kept out of both buckets on purpose: we cannot classify it and we will not pretend to.
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
      if (r) { hit = r; break } // first match wins, as upstream
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
      // No score is not a low score. Kept, and the caller is told the threshold could not
      // be applied rather than the finding quietly surviving or quietly vanishing.
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
    // No caps are applied to any list above; the bounds that do exist are declared.
    bounds: { idDescriptionChars: ID_DESCRIPTION_CHARS, maxRawExcerpt: MAX_RAW_EXCERPT, capped: false },
    malformed,
  }
}
