import { isObj, str, arr, num } from './event-shared.mjs'
import { clip, MAX_PREVIEW, shortPath, parseShellHeadline, summarizeToolCall } from './tool-call-summary.mjs'
import { firstEnclosingContext, countHunks } from './diff-context.mjs'

export { summarizeToolCall, firstEnclosingContext, countHunks, parseShellHeadline, shortPath }

const blocksOf = record => {
  const content = isObj(record?.message) ? record.message.content : record?.content
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return arr(content).filter(isObj)
}

const resultIdOf = block => str(block?.tool_use_id) ?? str(block?.toolUseId) ?? str(block?.toolUseID)

const parentIdOf = rec =>
  str(rec?.parentToolUseId) ?? str(rec?.parent_tool_use_id) ??
  str(rec?.sourceToolUseID) ?? str(rec?.sourceToolUseId) ?? null

const targetOf = (name, detail) =>
  str(detail?.path) ?? str(detail?.headline) ?? str(detail?.pattern) ?? str(detail?.host) ??
  str(detail?.query) ?? str(detail?.subagentType) ?? null

const roleOf = record =>
  str(record?.message?.role) ?? (record?.type === 'user' ? 'user' : record?.type === 'assistant' ? 'assistant' : null)

/**
 * Collapse a flat transcript event list into readable groups.
 *
 * Returns:
 *   {
 *     groups,       // top-level groups, in first-seen order; subagent work nests in `children`
 *     unpaired,     // every tool_use with no matching tool_result — reported, never dropped
 *     orphans,      // subagent events whose parentToolUseId matched no tool_use we saw
 *     counts,       // { records, blocks, toolCalls, groups, malformed }
 *     truncated,    // null, or { limit, omitted } when opts.maxGroups cut the list
 *   }
 */
export function groupEvents(records, opts = {}) {
  const options = isObj(opts) ? opts : {}
  const collapse = options.collapse !== false
  const maxGroups = num(options.maxGroups)
  const includeText = options.includeText !== false

  const list = arr(records)
  const counts = {
    records: list.length,
    blocks: 0,
    toolCalls: 0,
    groups: 0,
    malformed: 0,
    sidechain: 0,
    sidechainUnlinked: 0,
    skippedRecordTypes: {},
  }

  const results = new Map()
  for (const rec of list) {
    if (!isObj(rec)) { counts.malformed++; continue }
    for (const b of blocksOf(rec)) {
      if (b.type !== 'tool_result') continue
      const id = resultIdOf(b) ?? resultIdOf(rec)
      if (!id) { counts.malformed++; continue }
      results.set(id, { block: b, record: rec })
    }
  }

  const items = []
  for (let i = 0; i < list.length; i++) {
    const rec = list[i]
    if (!isObj(rec)) continue
    const meta = {
      uuid: str(rec.uuid),
      parentUuid: str(rec.parentUuid),
      parentToolUseId: parentIdOf(rec),
      isSidechain: rec.isSidechain === true,
      agentId: str(rec.agentId),
      agentType: str(rec.agentType),
      spawnDepth: num(rec.spawnDepth),
      timestamp: str(rec.timestamp),
      index: i,
      role: roleOf(rec),
    }
    if (meta.isSidechain) {
      counts.sidechain++
      if (!meta.parentToolUseId) counts.sidechainUnlinked++
    }

    if (rec.type === 'system') {
      items.push({
        kind: 'system',
        tool: null,
        title: str(rec.subtype) ? `System: ${rec.subtype}` : 'System event',
        summary: str(rec.subtype) === 'compact_boundary'
          ? 'The conversation was compacted at this point.'
          : 'A system record was written at this point.',
        detail: { subtype: str(rec.subtype) },
        status: 'ok',
        meta,
      })
      continue
    }

    const blocks = blocksOf(rec)
    if (blocks.length === 0 && rec.type !== 'user' && rec.type !== 'assistant') {
      const t = str(rec.type) ?? 'unknown'
      counts.skippedRecordTypes[t] = (counts.skippedRecordTypes[t] ?? 0) + 1
      continue
    }

    for (const b of blocks) {
      counts.blocks++
      if (b.type === 'tool_result') continue

      if (b.type === 'tool_use') {
        counts.toolCalls++
        const s = summarizeToolCall(b)
        const id = str(b.id) ?? str(rec.toolUseID)
        const paired = id ? results.get(id) : undefined
        const status = !paired ? 'running' : paired.block?.is_error === true ? 'error' : 'ok'
        const detail = { ...s.detail }

        const tur = paired?.record?.toolUseResult
        const patch = isObj(tur) ? tur.structuredPatch : null
        if (Array.isArray(patch)) {
          detail.patch = countHunks(patch)
          detail.enclosingContext = firstEnclosingContext(patch[0] ?? null)
        }

        items.push({
          isToolUse: true,
          kind: s.kind,
          tool: str(b.name),
          title: s.title,
          summary: s.summary,
          detail,
          status,
          toolUseId: id,
          resultIsError: paired ? paired.block?.is_error === true : null,
          meta,
        })
        continue
      }

      if (!includeText) continue

      if (b.type === 'thinking' || b.type === 'redacted_thinking') {
        const text = str(b.thinking) ?? ''
        items.push({
          kind: 'thinking',
          tool: null,
          title: 'Thinking',
          summary: `${text.length} characters of extended thinking (not shown).`,
          detail: { length: text.length, redacted: b.type === 'redacted_thinking' },
          status: 'ok',
          meta,
        })
        continue
      }

      if (b.type === 'text') {
        const c = clip(b.text, MAX_PREVIEW)
        if (c.text == null || c.text.trim() === '') continue
        items.push({
          kind: 'text',
          tool: null,
          title: meta.role === 'user' ? 'User message' : 'Assistant message',
          summary: c.text,
          detail: { length: c.fullLength, truncated: c.truncated },
          status: 'ok',
          meta,
        })
        continue
      }

      items.push({
        kind: 'unknown',
        tool: null,
        title: str(b.type) ? `Unrecognised block: ${b.type}` : 'Unrecognised block',
        summary: 'This content block has a type this build does not render.',
        detail: { blockType: str(b.type) },
        status: 'ok',
        meta,
      })
    }
  }

  const knownToolUseIds = new Set(items.filter(it => it.toolUseId).map(it => it.toolUseId))
  const top = []
  const byParent = new Map()
  const orphans = []
  for (const it of items) {
    const pid = it.meta.parentToolUseId
    if (pid && knownToolUseIds.has(pid)) {
      if (!byParent.has(pid)) byParent.set(pid, [])
      byParent.get(pid).push(it)
    } else if (pid) {
      const flagged = { ...it, orphanParentToolUseId: pid }
      orphans.push({ toolUseId: it.toolUseId ?? null, tool: it.tool, title: it.title, index: it.meta.index, parentToolUseId: pid })
      top.push(flagged)
    } else {
      top.push(it)
    }
  }

  const built = collapseItems(top, collapse)

  const attach = groups => {
    for (const g of groups) {
      const kids = []
      for (const id of g.toolUseIds) {
        const bucket = byParent.get(id)
        if (bucket) kids.push(...collapseItems(bucket, collapse))
      }
      if (kids.length) {
        attach(kids)
        g.children = kids
      }
    }
  }
  attach(built)

  const unpaired = []
  for (const it of items) {
    if (!it.isToolUse) continue
    if (!it.toolUseId) {
      unpaired.push({ toolUseId: null, tool: it.tool, title: it.title, index: it.meta.index, reason: 'missing-tool-use-id' })
    } else if (it.status === 'running') {
      unpaired.push({ toolUseId: it.toolUseId, tool: it.tool, title: it.title, index: it.meta.index, reason: 'no-tool-result' })
    }
  }

  let groups = built
  let truncated = null
  if (maxGroups != null && maxGroups >= 0 && built.length > maxGroups) {
    groups = built.slice(0, maxGroups)
    truncated = { limit: maxGroups, omitted: built.length - maxGroups }
  }
  counts.groups = built.length

  return { groups, unpaired, orphans, counts, truncated }
}

function collapseItems(items, collapse) {
  const out = []
  for (const it of items) {
    const target = it.tool ? targetOf(it.tool, it.detail) : null
    const prev = out[out.length - 1]
    const mergeable =
      collapse && prev && it.tool && prev.tool === it.tool && prev.target === target && target != null
    if (mergeable) {
      prev.count++
      prev.items.push(it)
      if (it.toolUseId) prev.toolUseIds.push(it.toolUseId)
      prev.status = prev.status === it.status ? prev.status : 'mixed'
      prev.summary = `${prev.count} consecutive ${it.tool} calls on ${target}.`
      prev.lastIndex = it.meta.index
      continue
    }
    out.push({
      kind: it.kind,
      tool: it.tool,
      target,
      title: it.title,
      summary: it.summary,
      detail: it.detail,
      status: it.status,
      count: 1,
      toolUseIds: it.toolUseId ? [it.toolUseId] : [],
      items: [it],
      children: [],
      firstIndex: it.meta.index,
      lastIndex: it.meta.index,
      isSidechain: it.meta.isSidechain,
      parentToolUseId: it.meta.parentToolUseId ?? null,
      orphanParentToolUseId: it.orphanParentToolUseId ?? null,
      timestamp: it.meta.timestamp,
    })
  }
  return out
}
