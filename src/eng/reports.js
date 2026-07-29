import { of, pos, pctl, fx, MIN_N } from './stats.js'
import { shippedIn, prevWindow } from './TimeLens.jsx'

// §6 — ONE markdown generator, five presets. Four personas each asked for their own document; this is the
// only place any of them is written. Everything is deterministic — no model call, no upload. Caveats are
// PRINTED ON the artifact (window, working-time model, n) because these get pasted into decks unedited.
const CAVEAT = w => `\n---\n*Window: ${w.label} (${new Date(w.from).toISOString().slice(0, 10)} → ${new Date(w.to).toISOString().slice(0, 10)}). Durations are WORKING days (10:00–18:00 Sun–Thu, Asia/Riyadh). Percentiles, not means. n<${MIN_N} is not a trend.*`
const d = v => (v == null ? '—' : fx(v) + 'd')
const p = (v, dec = 0) => (v == null ? '—' : fx(v, dec) + '%')
const list = (a, f, n = 10) => (a.length ? a.slice(0, n).map(f).join('\n') : '_none_')

export const PRESETS = [
  { id: 'standup', label: 'Standup list', who: 'Lead' },
  { id: 'weekly', label: 'Weekly digest', who: 'PM' },
  { id: 'sprint', label: 'Sprint summary', who: 'PM + EM' },
  { id: 'quarter', label: 'Quarter brief', who: 'EM → VP' },
  { id: 'impact', label: 'Impact / brag doc', who: 'IC — about themselves' },
]

export function report(preset, { snap, win, me }) {
  const issues = snap.issues || [], prs = snap.prs || []
  const shipped = issues.filter(i => shippedIn(win, i))
  const cyc = of(shipped, i => pos(i.delivery))
  const lead = of(shipped, i => pos(i.leadDays))
  const R = snap.review || {}, Q = snap.quality || {}, I = snap.investment || {}
  const tri = snap.triage || []
  const date = new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  if (preset === 'standup') return [
    `# Standup — ${date}`, '',
    `**${tri.length} item${tri.length === 1 ? '' : 's'} need a human.** ${tri.filter(t => t.severity === 0).length} blocking the whole team.`, '',
    ...['red-main', 'over-budget', 'qa-blocked', 'stale-status', 'pr-no-review', 'pr-red-checks', 'no-pr', 'pr-approved-unmerged', 'pr-rework', 'qa-loops', 'wip-overload']
      .map(k => { const rows = tri.filter(t => t.kind === k); return rows.length ? `### ${k}\n${rows.map(r => `- ${r.subject} — ${r.owner?.name || r.owner?.login || 'unowned'} — ${r.detail}${r.deepLink ? ` — ${r.deepLink}` : ''}`).join('\n')}` : '' })
      .filter(Boolean),
    CAVEAT(win)].join('\n')

  if (preset === 'weekly') return [
    `# Weekly digest — ${date}`, '',
    `## Delivered (${win.label})`,
    `- **${shipped.length}** tickets shipped, **${shipped.reduce((a, i) => a + i.pts, 0)}** story points`,
    `- Cycle time (In Progress → Live): **p50 ${d(cyc.p50)}**, p85 ${d(cyc.p85)}, p90 ${d(cyc.p90)} (n=${cyc.n})`,
    `- Lead time (created → Live): p50 ${d(lead.p50)}, p90 ${d(lead.p90)} — the gap is time it sat waiting on us`, '',
    '## Flow',
    `- Request → first review: p50 ${d(R.firstReview?.p50)}, p90 ${d(R.firstReview?.p90)}`,
    `- PR merge time: p50 ${d(R.mergeTime?.p50)}, p90 ${d(R.mergeTime?.p90)}`,
    `- PRs awaiting a review right now: ${R.unanswered?.length || 0}; with no reviewer asked: ${R.noReviewerRequested?.length || 0}`, '',
    '## Quality',
    `- Escape rate (latest month): ${p(Q.escapeRate?.[Q.escapeRate.length - 1]?.rate)} — ${Q.totals?.escaped || 0} bugs reached production, ${Q.totals?.qaCaught || 0} caught in flight`,
    Q.hotspots?.length ? `- Worst area: \`${Q.hotspots[0].area}\` — ${Q.hotspots[0].bugs} bugs / ${Q.hotspots[0].shipped} shipped` : '', '',
    '## Needs a decision',
    list(tri.filter(t => t.severity <= 1), r => `- ${r.subject} — ${r.detail}`),
    CAVEAT(win)].filter(Boolean).join('\n')

  if (preset === 'sprint') {
    const s = (snap.sprints || [])[0]
    if (!s) return '_No sprint data (no Sprint items in the changelog)._'
    return [`# Sprint summary — ${s.name}`, '',
      `| | Tickets | Points |`, `|---|---:|---:|`,
      `| Committed at start | ${s.committed} | ${s.committedPts} |`,
      `| Added mid-sprint | ${s.added} | ${s.addedPts} |`,
      `| Delivered | ${s.delivered} | ${s.deliveredPts} |`,
      `| Carried over | ${s.carriedOver} | ${s.carriedOverPts} |`, '',
      `**Predictability (say/do): ${p(s.sayDoPct)}** · **Injection: ${p(s.injectionPct)}** of committed points were added after the sprint started.`, '',
      '## Carried over', list(s.keys?.carriedOver || [], k => `- ${k}`, 20), '',
      '## At risk right now', list(tri.filter(t => t.severity <= 1), r => `- ${r.subject} — ${r.detail}`),
      CAVEAT(win)].join('\n')
  }

  if (preset === 'quarter') {
    const prev = prevWindow(win)
    const cycPrev = of(issues.filter(i => shippedIn(prev, i)), i => pos(i.delivery))
    const sp = snap.sprints || []
    const sd = sp.map(x => x.sayDoPct).filter(v => v != null)
    const mix = I.months?.[I.months.length - 1]
    return [`# Quarter brief — ${win.label}`, '',
      '## The numbers', '',
      `| Metric | This window | Previous |`, `|---|---:|---:|`,
      `| Cycle time p50 | ${d(cyc.p50)} | ${d(cycPrev.p50)} |`,
      `| Cycle time p90 | ${d(cyc.p90)} | ${d(cycPrev.p90)} |`,
      `| Throughput | ${shipped.length} tickets | ${issues.filter(i => shippedIn(prev, i)).length} |`,
      `| Predictability (median say/do, ${sd.length} sprints) | ${p(pctl(sd, 0.5))} | — |`,
      `| Bug tax | ${p(I.bugTaxPct)} | ${p(I.bugTaxPrevPct)} |`,
      `| Escape rate | ${p(Q.escapeRate?.[Q.escapeRate.length - 1]?.rate)} | ${p(Q.escapeRate?.[Q.escapeRate.length - 2]?.rate)} |`,
      `| Review p90 (request → first review) | ${d(R.firstReview?.p90)} | — |`, '',
      '## Where the effort went',
      mix ? Object.entries(mix.buckets).map(([b, v]) => `- ${b}: ${v.pts} pts (${mix.pts ? Math.round(v.pts / mix.pts * 100) : 0}%)`).join('\n') : '_no delivered work in the mix window_', '',
      '## Structural risk',
      `- Review concentration: ${p(R.concentration?.top2Share)} of reviews done by 2 of ${R.concentration?.reviewerCount || 0} reviewers${R.concentration?.flagged ? ' — **flagged**' : ''}`,
      `- Bus factor: ${(Q.ownership || []).filter(o => o.busFactor).length} area(s) with a single owner`,
      `- Epics forecast late: ${(snap.epics || []).filter(e => e.risk === 'red').length}`, '',
      '## Top aging items',
      list(tri, r => `- ${r.subject} — ${r.detail}${r.overBudgetBy != null ? ` (${fx(r.overBudgetBy)}d over budget)` : ''}`, 5), '',
      '## The narrative',
      `Cycle time p50 is ${d(cyc.p50)} against a p90 of ${d(cyc.p90)} — the tail, not the median, is where the escalations come from. ` +
      `${I.bugTaxPct != null && I.bugTaxPrevPct != null && I.bugTaxPct > I.bugTaxPrevPct ? `Bug tax rose to ${p(I.bugTaxPct)} from ${p(I.bugTaxPrevPct)}: we are paying more of the quarter for work we already shipped once. ` : ''}` +
      `${R.concentration?.flagged ? 'Review load is concentrated in two people; that is the key-person risk on this list. ' : ''}` +
      `${tri.length} item(s) are stuck today and every one of them has a named owner and a link.`,
      CAVEAT(win)].join('\n')
  }

  // §6 — the impact export is what makes the privacy contract honest: nothing exists about a person that
  // they cannot pull about themselves. It includes REVIEWS GIVEN, which nobody else credits.
  if (preset === 'impact') {
    if (!me) return '_Set your identity (GitHub handle in the header) to build an impact export._'
    const mineIssues = shipped.filter(i => i.assignee?.id === me.accountId || (me.name && i.assignee?.name === me.name))
    const minePrs = prs.filter(x => me.gh && x.author?.toLowerCase() === me.gh.toLowerCase())
    const merged = minePrs.filter(x => x.mergedAt)
    const given = prs.filter(x => (x.reviewEvents || []).some(e => me.gh && e.login?.toLowerCase() === me.gh.toLowerCase()))
    const lat = given.map(x => { const e = (x.reviewEvents || []).find(e => e.login?.toLowerCase() === me.gh?.toLowerCase()); const ask = (x.reviewRequests || []).filter(r => r.login?.toLowerCase() === me.gh?.toLowerCase())[0]?.at || x.createdAt; return e && ask ? (Date.parse(e.at) - Date.parse(ask)) / 86400000 : null }).filter(v => v != null && v >= 0)
    const myCyc = of(mineIssues, i => pos(i.delivery))
    return [`# Impact — ${me.name || me.gh} · ${win.label}`, '',
      `- **${mineIssues.length}** tickets shipped (${mineIssues.reduce((a, i) => a + i.pts, 0)} points) · cycle p50 ${d(myCyc.p50)}, p90 ${d(myCyc.p90)}`,
      `- **${merged.length}** PRs merged (+${merged.reduce((a, x) => a + (x.additions || 0), 0)} / −${merged.reduce((a, x) => a + (x.deletions || 0), 0)})`,
      `- **${given.length}** reviews GIVEN — the work nobody credits — median turnaround ${lat.length ? fx(pctl(lat, 0.5)) + 'd' : '—'}`,
      `- ${mineIssues.filter(i => i.isBug).length} bugs fixed`, '',
      '## Shipped', list(mineIssues, i => `- ${i.key} — ${i.summary} (${d(i.delivery)})`, 25), '',
      '## Reviews given', list(given, x => `- #${x.num} ${x.title} (${x.repo})`, 25),
      CAVEAT(win)].join('\n')
  }
  return ''
}

// Slack mrkdwn is not markdown: ** is *, ## is *bold*, tables do not exist.
export const toSlack = md => md
  .replace(/^#{1,6}\s*(.+)$/gm, (_, t) => `*${t}*`)
  .replace(/\*\*(.+?)\*\*/g, '*$1*')
  .replace(/^\|.*\|$/gm, l => l.replace(/\s*\|\s*/g, '  ').trim())
  .replace(/^-{3,}$/gm, '')
