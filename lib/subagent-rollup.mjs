// What subagents actually cost, and what delegating to a cheaper model would have saved.
//
// Two things here are easy to get quietly wrong, and both matter because the output is a number
// somebody will quote.
//
// 1. A subagent's turns are not all on one model. Electing a "dominant" model and pricing the
//    whole subagent at it — which is how this metric is usually built — silently misprices every
//    mixed-model run. So cost is summed PER TURN at that turn's real rate, and the dominant model
//    is reported as a LABEL only, alongside how much of the subagent it actually covers. When that
//    share is low the label is worse than useless, so `dominantShare` travels with it.
//
// 2. "You would have saved X by using Haiku" is not a measurement. Nobody ran that. It is the same
//    token counts re-priced at another model's rates, which assumes the cheaper model would have
//    produced the identical tokens — and if it would have, there was no reason to use the
//    expensive one. Every function that computes it says `modelled: true` and states the
//    assumption in the result, because this figure is the one most likely to be quoted as if it
//    were observed.
//
// Unpriced models are counted separately rather than as zero. A run with three unpriced turns and
// a $0.40 total is not a $0.40 run, and reporting it as one understates by an unknown amount.

import { rateFor, entryCost, splitCacheWrite } from './pricing.mjs'

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * Normalise one usage record. Accepts the shape collectUsage produces.
 * `agent` is the subagent identity; null means the main thread.
 */
const entryOf = r => ({
  model: r?.model ?? null,
  t: r?.t ?? r?.at ?? null,
  in: num(r?.in), out: num(r?.out), cr: num(r?.cr),
  cc: num(r?.cc), cc5: num(r?.cc5), cc1h: num(r?.cc1h),
  agent: r?.agent ?? r?.agentId ?? r?.sourceToolUseID ?? null,
  tool: r?.tool ?? r?.subagentType ?? null,
  session: r?.session ?? r?.sessionId ?? null,
})

export const totalTokens = e => e.in + e.out + e.cr + e.cc

/**
 * Elect the model that accounts for the most tokens, and say how dominant it actually is.
 * Returns `share: null` when there are no tokens at all — 0/0 is not 0%.
 */
export function electDominantModel(entries) {
  const byModel = new Map()
  let total = 0
  for (const e of entries) {
    const t = totalTokens(e)
    total += t
    if (!e.model) continue
    byModel.set(e.model, (byModel.get(e.model) || 0) + t)
  }
  if (!byModel.size) return { model: null, share: null, models: [], reason: 'no-model-on-any-turn' }
  const ranked = [...byModel.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const [model, tokens] = ranked[0]
  return {
    model,
    share: total ? tokens / total : null,
    models: ranked.map(([m, t]) => ({ model: m, tokens: t, share: total ? t / total : null })),
    // Said out loud: a 40%-dominant label describes less than half the run.
    reason: ranked.length > 1 ? 'mixed-model' : null,
  }
}

/**
 * Roll usage records up per subagent.
 *
 * Cost is summed per turn at that turn's own rate — never at the dominant model's rate.
 */
export function rollupSubagents(records) {
  const entries = (Array.isArray(records) ? records : []).map(entryOf)
  const byAgent = new Map()
  for (const e of entries) {
    // null keys the main thread. A Map takes any key, so no in-band sentinel string is needed —
    // an in-band marker is a value that can collide with a real one.
    const k = e.agent || null
    if (!byAgent.has(k)) byAgent.set(k, [])
    byAgent.get(k).push(e)
  }

  const agents = []
  let unpricedTurnsTotal = 0
  for (const [k, list] of byAgent) {
    let cost = 0, unpricedTurns = 0, unpricedTokens = 0
    for (const e of list) {
      if (rateFor(e.model, e.t) == null) { unpricedTurns++; unpricedTokens += totalTokens(e); continue }
      cost += entryCost(e)
    }
    unpricedTurnsTotal += unpricedTurns
    const dom = electDominantModel(list)
    agents.push({
      agent: k,
      isMain: k === null,
      tool: list.find(e => e.tool)?.tool ?? null,
      turns: list.length,
      tokens: list.reduce((n, e) => n + totalTokens(e), 0),
      in: list.reduce((n, e) => n + e.in, 0),
      out: list.reduce((n, e) => n + e.out, 0),
      cacheRead: list.reduce((n, e) => n + e.cr, 0),
      cacheWrite: list.reduce((n, e) => n + e.cc, 0),
      // null, not 0, when nothing could be priced: "we could not price this" is not "free".
      cost: unpricedTurns === list.length ? null : cost,
      costComplete: unpricedTurns === 0,
      unpricedTurns, unpricedTokens,
      dominantModel: dom.model,
      dominantShare: dom.share,
      mixedModel: dom.reason === 'mixed-model',
      models: dom.models,
    })
  }
  agents.sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1) || b.tokens - a.tokens)

  const priced = agents.filter(a => a.cost != null)
  return {
    agents,
    subagents: agents.filter(a => !a.isMain),
    totals: {
      turns: entries.length,
      tokens: entries.reduce((n, e) => n + totalTokens(e), 0),
      cost: priced.length ? priced.reduce((n, a) => n + a.cost, 0) : null,
      unpricedTurns: unpricedTurnsTotal,
      agents: agents.filter(a => !a.isMain).length,
    },
    note: unpricedTurnsTotal
      ? `${unpricedTurnsTotal} turn(s) are on models with no price in the table — their cost is missing from these totals, not zero`
      : null,
  }
}

/**
 * Re-price the same token counts at another model's rates.
 *
 * This is a MODEL, not a measurement, and the result says so. The assumption it rests on is that
 * the cheaper model would have produced the same tokens — and if that were true, there was no
 * reason to use the expensive one. Stated in the result rather than left for the reader to supply.
 */
export function modelDelegationSavings(records, cheaperModel, opts = {}) {
  const entries = (Array.isArray(records) ? records : []).map(entryOf)
  const at = opts.at ?? null
  const target = rateFor(cheaperModel, at)
  if (!target) {
    return {
      modelled: true, ok: false, reason: 'target-model-unpriced',
      detail: `"${cheaperModel}" has no entry in the price table, so there is nothing to re-price against`,
      candidate: cheaperModel,
    }
  }

  let actual = 0, hypothetical = 0, comparable = 0, skippedUnpriced = 0, alreadyCheaper = 0
  for (const e of entries) {
    const r = rateFor(e.model, e.t)
    // A turn we cannot price cannot be compared. Counting it as a saving of its full hypothetical
    // cost would invent money.
    if (r == null) { skippedUnpriced++; continue }
    if (e.model === cheaperModel) { alreadyCheaper++; continue }
    const { cc5, cc1h } = splitCacheWrite(e.cc, e.cc5, e.cc1h)
    const hypo = (e.in * target.in + e.out * target.out + e.cr * target.cacheRead
      + cc5 * target.cacheWrite5m + cc1h * target.cacheWrite1h) / 1e6
    actual += entryCost(e)
    hypothetical += hypo
    comparable++
  }

  const saving = actual - hypothetical
  return {
    modelled: true,
    ok: comparable > 0,
    candidate: cheaperModel,
    comparableTurns: comparable,
    skippedUnpriced,
    alreadyOnCandidate: alreadyCheaper,
    actualCost: comparable ? actual : null,
    modelledCost: comparable ? hypothetical : null,
    modelledSaving: comparable ? saving : null,
    modelledSavingPct: comparable && actual > 0 ? (saving / actual) * 100 : null,
    // The negative case is real and worth surfacing: on cache-heavy work a "cheaper" model can
    // cost more, because cache-read rates do not scale with the headline price.
    wouldCostMore: comparable > 0 && saving < 0,
    assumption: `assumes ${cheaperModel} would have produced identical token counts on the same ${comparable} turn(s) — nobody ran it, so this is arithmetic on the tokens that were actually produced by another model`,
    caveat: skippedUnpriced ? `${skippedUnpriced} turn(s) could not be priced and are excluded from both sides` : null,
  }
}

/**
 * Subagents still running, for a live board.
 * A subagent is "active" when its last turn is inside `windowMs`; without a timestamp it is
 * reported as unknown rather than assumed idle.
 */
export function activeSubagents(records, { now = Date.now(), windowMs = 120_000 } = {}) {
  const entries = (Array.isArray(records) ? records : []).map(entryOf).filter(e => e.agent)
  const byAgent = new Map()
  for (const e of entries) {
    const t = e.t ? Date.parse(e.t) : NaN
    const cur = byAgent.get(e.agent) || { agent: e.agent, tool: e.tool, turns: 0, lastAt: null, undated: 0 }
    cur.turns++
    if (Number.isFinite(t)) cur.lastAt = Math.max(cur.lastAt ?? -Infinity, t)
    else cur.undated++
    cur.tool ||= e.tool
    byAgent.set(e.agent, cur)
  }
  const active = [], idle = [], unknown = []
  for (const a of byAgent.values()) {
    const row = { ...a, lastAt: a.lastAt ? new Date(a.lastAt).toISOString() : null, ageMs: a.lastAt ? now - a.lastAt : null }
    if (a.lastAt == null) unknown.push(row)
    else if (now - a.lastAt <= windowMs) active.push(row)
    else idle.push(row)
  }
  active.sort((x, y) => x.ageMs - y.ageMs)
  return {
    active, idle, unknown,
    counts: { active: active.length, idle: idle.length, unknown: unknown.length },
    windowMs,
    note: unknown.length ? `${unknown.length} subagent(s) have no timestamped turn, so whether they are running is unknown — they are not counted as idle` : null,
  }
}
