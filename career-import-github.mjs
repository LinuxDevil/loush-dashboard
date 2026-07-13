// GitHub review-footprint + PR-lifecycle import. Quarantined: never throws; a format change
// degrades this source to empty (spec §11.A). Written against the exact Task-0 fixture shapes:
//   reviews.json = `gh api search/issues?q=reviewed-by:@me` → { items:[{ number, user.login, ... }] }
//   prs.json     = `gh pr list --author @me --json ...`     → [{ createdAt, mergedAt, reviews:[{author.login,state,submittedAt}], additions, deletions, files }]
import { matchesMe } from './career-identity.mjs'
import { reviewInsights, reviewTurnaround } from './career-review-insights.mjs'

const HRS = ms => ms / 3_600_000
const bucketOf = n => n < 30 ? 'S' : n < 150 ? 'M' : n < 500 ? 'L' : 'XL'

function parse({ ghJson, resolved }) {
  const items = ghJson.reviews.items || []            // throws if reviews is null → caught below
  const prs = ghJson.prs || []                        // array; throws on non-iterable below

  // Review footprint: PRs I reviewed, grouped by their author (mentorship = reviews on others' code).
  const reviewedForOthers = new Map()
  for (const it of items) {
    const author = it.user?.login
    if (author && !matchesMe(resolved, { login: author }))
      reviewedForOthers.set(author, (reviewedForOthers.get(author) || 0) + 1)
  }
  const reviewFootprint = {
    prsReviewed: items.length,
    // G8: real count of my review submissions across the fetched reviewed-PRs (computed at import); the old
    // items.length was a ≥1-per-PR placeholder. Degrades to that placeholder when reviewPasses is absent.
    commentsLeftEstimate: ghJson.reviewPasses ?? items.length,
    reviewedForOthers,
    requestedAsReviewer: items.length,                // every reviewed-by:@me hit had me as a reviewer
  }

  // PR lifecycle from my authored PRs. commitCount = commits that landed in my PRs (G1 AI-code-share
  // denominator). revertCount = my "Revert …" PRs (G8: feeds changeFailProxy as escaped-change reverts).
  const timeToFirstReviewHrs = [], reviewRoundsPerPr = [], sizeBuckets = {}
  let commitCount = 0, revertCount = 0, prLines = 0
  for (const p of prs) {
    const reviews = p.reviews || []
    reviewRoundsPerPr.push(reviews.length)
    const firstAt = reviews.map(r => Date.parse(r.submittedAt)).filter(t => !Number.isNaN(t)).sort((a, b) => a - b)[0]
    const created = Date.parse(p.createdAt)
    if (firstAt && !Number.isNaN(created)) timeToFirstReviewHrs.push(HRS(firstAt - created))
    const size = (p.additions || 0) + (p.deletions || 0)
    const b = bucketOf(size); sizeBuckets[b] = (sizeBuckets[b] || 0) + 1
    commitCount += (p.commits?.length || 0)
    prLines += size
    if (/^revert[:\s"]/i.test(p.title || '')) revertCount++
  }

  return { reviewFootprint, prLifecycle: { timeToFirstReviewHrs, reviewRoundsPerPr, sizeBuckets }, commitCount, revertCount, prLines,
    reviewInsights: reviewInsights({ prs, reviewedForOthers, resolved }),
    reviewTurnaround: reviewTurnaround(ghJson.reviewedPrs || []) }
}

const empty = () => ({
  reviewFootprint: { prsReviewed: 0, commentsLeftEstimate: 0, reviewedForOthers: new Map(), requestedAsReviewer: 0 },
  prLifecycle: { timeToFirstReviewHrs: [], reviewRoundsPerPr: [], sizeBuckets: {} }, commitCount: 0, revertCount: 0, prLines: 0,
  reviewInsights: reviewInsights({}),
  reviewTurnaround: reviewTurnaround([]),
})

export function importGithub({ ghJson = {}, resolved } = {}) {
  try { return parse({ ghJson, resolved }) }
  catch (e) { return { error: e.message, ...empty() } }
}
