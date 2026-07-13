// Team-health review insights, derived from ALREADY-imported GitHub data (no extra gh calls here).
// Deliberately framed team-side — reciprocity, bus factor, reviewer footprint — never a personal score.
import { matchesMe } from './career-identity.mjs'

const isBot = login => /\[bot\]$/.test(login) || login === 'github-actions'

// reviewsGiven  = reviewedForOthers (who I review for; computed at import)
// reviewsReceived = who reviews MY PRs, from p.reviews[].author.login
export function reviewInsights({ prs = [], reviewedForOthers = new Map(), resolved } = {}) {
  const given = reviewedForOthers instanceof Map ? Object.fromEntries(reviewedForOthers) : (reviewedForOthers || {})
  const received = {}        // reviewer login -> # of my PRs they reviewed
  const approvedBy = {}      // reviewer login -> # of my PRs they approved
  const roundsWith = {}      // reviewer login -> [review-round counts on PRs they touched]
  const areaReviewers = {}   // path area -> Set(reviewer logins)  (bus factor by code area)

  for (const p of prs) {
    const reviews = p.reviews || []
    const reviewers = new Set()
    const approvers = new Set()
    for (const r of reviews) {
      const login = r.author?.login
      if (!login || isBot(login) || matchesMe(resolved, { login })) continue
      reviewers.add(login)
      if (r.state === 'APPROVED') approvers.add(login)
    }
    for (const login of reviewers) {
      received[login] = (received[login] || 0) + 1
      ;(roundsWith[login] ||= []).push(reviews.length)
    }
    for (const login of approvers) approvedBy[login] = (approvedBy[login] || 0) + 1
    for (const f of (p.files || [])) {
      const area = String(f.path || '').split('/').slice(0, 2).join('/')
      if (!area) continue
      ;(areaReviewers[area] ||= new Set())
      for (const login of reviewers) areaReviewers[area].add(login)
    }
  }

  const recvTotal = Object.values(received).reduce((a, b) => a + b, 0)
  const topReviewer = Object.entries(received).sort((a, b) => b[1] - a[1])[0] || null
  const busFactor = {
    distinctReviewers: Object.keys(received).length,
    topReviewer: topReviewer ? { login: topReviewer[0], share: recvTotal ? +(topReviewer[1] / recvTotal).toFixed(2) : 0 } : null,
    // areas reviewed by exactly ONE person = single point of review failure for that area
    soloReviewedAreas: Object.entries(areaReviewers).filter(([, s]) => s.size === 1).map(([area, s]) => ({ area, only: [...s][0] })),
  }

  const reviewerStats = Object.keys(received).map(login => {
    const rounds = roundsWith[login] || []
    return { login, reviewedMyPrs: received[login], approvals: approvedBy[login] || 0,
      avgRounds: rounds.length ? +(rounds.reduce((a, b) => a + b, 0) / rounds.length).toFixed(1) : 0 }
  }).sort((a, b) => b.reviewedMyPrs - a.reviewedMyPrs)

  const people = new Set([...Object.keys(given), ...Object.keys(received)])
  const reciprocity = [...people].map(login => ({ login, given: given[login] || 0, received: received[login] || 0 }))
    .sort((a, b) => (b.given + b.received) - (a.given + a.received))

  return { reciprocity, busFactor, reviewerStats,
    totals: { given: Object.values(given).reduce((a, b) => a + b, 0), received: recvTotal } }
}

// Reviewer-side turnaround: hours from a PR being opened to MY first review, on OTHERS' PRs.
// reviewedPrs = [{ createdAt, myFirstReviewAt }] captured at import (bounded per-PR gh api, quarantined).
export function reviewTurnaround(reviewedPrs = []) {
  const hrs = reviewedPrs
    .map(p => (Date.parse(p.myFirstReviewAt) - Date.parse(p.createdAt)) / 3_600_000)
    .filter(h => Number.isFinite(h) && h >= 0)
    .sort((a, b) => a - b)
  if (!hrs.length) return { n: 0, medianHrs: null, p90Hrs: null }
  return { n: hrs.length,
    medianHrs: +hrs[hrs.length >> 1].toFixed(1),
    p90Hrs: +hrs[Math.min(hrs.length - 1, Math.floor(hrs.length * 0.9))].toFixed(1) }
}
