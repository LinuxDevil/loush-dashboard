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

import {
  ID_DESCRIPTION_CHARS, MAX_RAW_EXCERPT,
  isObj, num, malformedEntry, fileExtension, normSeverity,
} from './security-findings-shared.mjs'

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
