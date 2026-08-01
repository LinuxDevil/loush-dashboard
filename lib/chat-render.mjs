// Chat rendering: the live context budget, and one tool-renderer lookup shared by the live chat
// and the historical transcript view.
//
// Written from a capability description; no upstream source was consulted.
//
// The registry deliberately does NOT reimplement per-tool summarising. lib/event-grouping.mjs
// already does that, and it is where the secret-safety rules live — tool input VALUES are never
// echoed, because a Bash command can carry a token. A second set of renderers here would be a
// second place for that rule to be forgotten.

import { summarizeToolCall } from './event-grouping.mjs'
import { contextWindowFor } from './session-status.mjs'

/**
 * Pull context-window state out of a streaming chat event.
 *
 * Returns `known:false` with `percent:null` when the model's window is unknown, while still
 * reporting the real token count — the measurement is real even when the denominator is not.
 * `percent` is intentionally NOT clamped: a reading over 100 means our window figure for that
 * model is wrong, and that is exactly the thing worth seeing rather than hiding at the bar's end.
 */
export function extractTokenBudget(event) {
  const msg = event?.message ?? event
  const u = msg?.usage
  const model = msg?.model ?? event?.model ?? null
  if (!u || typeof u !== 'object') return { known: false, used: null, window: null, percent: null, model, reason: 'no-usage-on-event' }
  const used = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
  if (!used) return { known: false, used: null, window: null, percent: null, model, reason: 'no-input-tokens' }
  const window = model ? contextWindowFor(model) : null
  if (!window) return { known: false, used, window: null, percent: null, model, reason: model ? 'unknown-model-window' : 'no-model-on-event' }
  const percent = (used / window) * 100
  return { known: true, used, window, percent, over: percent > 100, model, reason: null }
}

const registry = new Map()

/** Register a renderer for a tool name. Later registrations replace earlier ones. */
export function registerRenderer(name, fn) {
  if (typeof name !== 'string' || !name || typeof fn !== 'function') return false
  registry.set(name, fn)
  return true
}

/**
 * Look up a renderer. Falls back to event-grouping's summariser, which handles the known tools
 * and returns a truthful generic result for anything it does not recognise — it names the tool
 * rather than inventing a description of what it did.
 */
export function rendererFor(name) {
  return registry.get(name) || (record => summarizeToolCall(record))
}

export function renderToolCall(record) {
  const name = record?.name ?? record?.tool ?? record?.message?.content?.find?.(b => b?.type === 'tool_use')?.name ?? null
  try { return rendererFor(name)(record) } catch (e) {
    // A renderer that throws must not take the transcript view down with it.
    return { title: name || 'tool', summary: null, kind: 'unknown', error: String(e.message).slice(0, 200) }
  }
}

/**
 * Nest subagent events under the parent that spawned them.
 *
 * Measured across this machine's transcripts (23 files, 2300 usage-bearing records): 710 records
 * are sidechains and ALL of them carry `agentId` with `isSidechain`; `sourceToolUseID` appears
 * zero times, and `parentToolUseId` — the field the research described — appears zero times too.
 * Both are still read, because a different CLI version may emit them, but `agentId` is the one
 * that is actually there.
 *
 * `agentId` names the subagent, not the tool_use that spawned it, so it groups a subagent's own
 * records together without linking them to a parent. Those are reported as unlinked rather than
 * flattened into the main thread, which would make a subagent's work look like the parent's.
 */
export function groupBySubagent(records) {
  const list = Array.isArray(records) ? records : []
  const roots = [], byParent = new Map()
  let unlinked = 0, sidechain = 0
  for (const r of list) {
    if (!r || typeof r !== 'object') continue
    const parent = r.sourceToolUseID ?? r.sourceToolAssistantUUID ?? r.parent_tool_use_id ?? r.parentToolUseId ?? null   // agentId deliberately absent: it identifies the child, not the parent
    if (r.isSidechain) sidechain++
    if (parent) {
      if (!byParent.has(parent)) byParent.set(parent, [])
      byParent.get(parent).push(r)
    } else if (r.isSidechain) {
      unlinked++
      roots.push(r)
    } else {
      roots.push(r)
    }
  }
  return {
    roots,
    childrenOf: id => byParent.get(id) || [],
    counts: { total: list.length, sidechain, sidechainUnlinked: unlinked, parents: byParent.size },
    // Said out loud so a flat-looking view is not read as "there were no subagents".
    note: unlinked ? `${unlinked} sidechain record(s) carry no parent link and could not be nested` : null,
  }
}
