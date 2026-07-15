import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveIdentity } from '../career-identity.mjs'
import { reviewInsights, reviewTurnaround } from '../career-review-insights.mjs'

const resolved = resolveIdentity({ githubHandle: 'me' })

test('reciprocity, bus factor, and reviewer stats from my PRs', () => {
  const prs = [
    { files: [{ path: 'pkg/a/x.ts' }], reviews: [{ author: { login: 'alice' }, state: 'APPROVED' }, { author: { login: 'me' }, state: 'COMMENTED' }] },
    { files: [{ path: 'pkg/a/y.ts' }], reviews: [{ author: { login: 'alice' }, state: 'COMMENTED' }] },
    { files: [{ path: 'pkg/b/z.ts' }], reviews: [{ author: { login: 'bob' }, state: 'APPROVED' }, { author: { login: 'github-actions[bot]' }, state: 'APPROVED' }] },
  ]
  const reviewedForOthers = new Map([['carol', 3], ['alice', 1]])
  const r = reviewInsights({ prs, reviewedForOthers, resolved })

  // 'me' and bots never counted as reviewers of my PRs
  assert.equal(r.totals.received, 3)            // alice x2 + bob x1
  assert.equal(r.busFactor.distinctReviewers, 2)
  assert.equal(r.busFactor.topReviewer.login, 'alice')
  // pkg/b reviewed only by bob (bot excluded) → solo area
  assert.ok(r.busFactor.soloReviewedAreas.some(a => a.area === 'pkg/b' && a.only === 'bob'))
  // reciprocity pairs both directions; carol is give-only, bob is receive-only
  const carol = r.reciprocity.find(p => p.login === 'carol')
  assert.deepEqual([carol.given, carol.received], [3, 0])
  const alice = r.reviewerStats.find(s => s.login === 'alice')
  assert.equal(alice.approvals, 1)
})

test('turnaround: median/p90 hours, drops negatives and non-finite', () => {
  const t = reviewTurnaround([
    { createdAt: '2026-01-01T00:00:00Z', myFirstReviewAt: '2026-01-01T02:00:00Z' }, // 2h
    { createdAt: '2026-01-01T00:00:00Z', myFirstReviewAt: '2026-01-01T06:00:00Z' }, // 6h
    { createdAt: '2026-01-01T00:00:00Z', myFirstReviewAt: '2025-12-31T00:00:00Z' }, // negative → dropped
    { createdAt: 'bad', myFirstReviewAt: 'bad' },                                    // NaN → dropped
  ])
  assert.equal(t.n, 2)
  assert.ok(t.medianHrs > 0)
})

test('empty input never throws', () => {
  assert.deepEqual(reviewTurnaround(), { n: 0, medianHrs: null, p90Hrs: null })
  const r = reviewInsights({})
  assert.deepEqual(r.totals, { given: 0, received: 0 })
})
