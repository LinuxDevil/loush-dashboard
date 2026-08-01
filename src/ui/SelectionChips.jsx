// src/ui/SelectionChips.jsx — feature 077: the chip tray above the chat input, plus the store the
// editor pushes selections into.
//
// Everything about what gets attached is decided in src/lib/selectionChips.js. This file's only job is
// to make each of those decisions VISIBLE:
//   * "data not included" on an opt-out chip — you can see what the model will not get.
//   * "truncated: 4.1 KiB of 61 KiB" on a capped chip — a silently truncated payload makes the model
//     answer confidently about data the user believes it has in full.
//   * "3 values stripped" with the paths on hover, for cycles and non-JSON values.
//   * A line when tab-close removed chips, so they do not just vanish.

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { packChips, chipsToPrompt, chipsForOpenTabs, CHIP_TOTAL_CAP_BYTES } from '../lib/selectionChips.js'

const SELECT_EVENT = 'editor-selection'      // editor → chat: CustomEvent(detail = raw chip)
const TABS_EVENT = 'editor-tabs-changed'     // editor → chat: CustomEvent(detail = { openTabIds: [] })

/** Editors call this. Deliberately a window event: chat may not be mounted when the selection happens. */
export const pushSelection = chip => window.dispatchEvent(new CustomEvent(SELECT_EVENT, { detail: chip }))
export const announceOpenTabs = openTabIds => window.dispatchEvent(new CustomEvent(TABS_EVENT, { detail: { openTabIds } }))

/**
 * Chip state for the chat input. Returns the packed chips (already capped/serialised), the prompt
 * block to prepend on send, and the removal handlers.
 */
export function useSelectionChips() {
  const [raw, setRaw] = useState([])
  const [tabNotice, setTabNotice] = useState(null)

  useEffect(() => {
    const onSel = e => {
      const c = e?.detail
      if (!c || typeof c !== 'object') return // a malformed event must not blank the tray
      setRaw(prev => (prev.some(p => p && p.id === c.id) ? prev.map(p => (p.id === c.id ? c : p)) : [...prev, c]))
    }
    const onTabs = e => {
      const ids = e?.detail?.openTabIds
      if (!Array.isArray(ids)) return
      setRaw(prev => {
        const { kept, notice } = chipsForOpenTabs(prev, ids)
        setTabNotice(notice)
        return kept.length === prev.length ? prev : kept
      })
    }
    window.addEventListener(SELECT_EVENT, onSel)
    window.addEventListener(TABS_EVENT, onTabs)
    return () => { window.removeEventListener(SELECT_EVENT, onSel); window.removeEventListener(TABS_EVENT, onTabs) }
  }, [])

  const packed = useMemo(() => packChips(raw, { capBytes: CHIP_TOTAL_CAP_BYTES }), [raw])
  const remove = useCallback(id => setRaw(prev => prev.filter(c => c.id !== id)), [])
  const clear = useCallback(() => { setRaw([]); setTabNotice(null) }, [])
  // Per-chip opt-in toggle: the user can attach the data for one chip without changing the others.
  const toggleData = useCallback(id => setRaw(prev => prev.map(c => (c.id === id ? { ...c, includeData: !(c.includeData === true) } : c))), [])

  return { packed, remove, clear, toggleData, tabNotice, dismissTabNotice: () => setTabNotice(null), promptBlock: chipsToPrompt(packed) }
}

const kib = n => (n >= 1024 ? (n / 1024).toFixed(1) + ' KiB' : n + ' B')

export default function SelectionChips({ packed, onRemove, onClear, onToggleData, tabNotice, onDismissNotice }) {
  if (!packed) return null
  const { chips, totalBytes, capBytes, capHit, notes, rejected, overflow } = packed
  if (!chips.length && !tabNotice && !rejected?.length) return null

  return (
    <div className="chat-atts" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      {chips.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          {chips.map(c => (
            <span key={c.id} className="chat-att"
              style={{ borderColor: c.truncated ? 'var(--amber)' : undefined }}
              title={[
                c.description,
                c.source,
                c.note,
                c.dropped.length ? 'stripped: ' + c.dropped.map(d => `${d.path} (${d.why})`).join('; ') : null,
              ].filter(Boolean).join('\n')}>
              <span>{c.icon}</span>
              <span>{c.label}</span>
              {/* Opt-in state is always on screen, never inferred from the absence of a badge. */}
              {c.hasData && (
                <button
                  onClick={() => onToggleData?.(c.id)}
                  title={c.includeData ? 'data is attached — click to send label only' : 'data is NOT attached — click to include it'}
                  style={{ color: c.includeData ? 'var(--green-solid)' : 'var(--text-tertiary)' }}>
                  {c.includeData ? `⛁ ${kib(c.bytes)}` : '⛁ off'}
                </button>
              )}
              {c.truncated && <span style={{ color: 'var(--amber)' }}>⚠ truncated {kib(c.bytes)}/{kib(c.truncatedFrom)}</span>}
              {!c.truncated && c.dropped.length > 0 && <span style={{ color: 'var(--amber)' }}>⚠ {c.dropped.length} stripped</span>}
              <button onClick={() => onRemove?.(c.id)} title="remove this chip">✕</button>
            </span>
          ))}
          <button className="mini" style={{ marginTop: 0 }} onClick={onClear} title="remove all chips">clear</button>
        </div>
      )}

      {/* Budget is reported every time, not only when it is exceeded — so "why is this one truncated
          and that one not?" is answerable without opening devtools. */}
      {chips.some(c => c.payload) && (
        <div className="dim" style={{ font: '400 10px var(--mono)', color: capHit ? 'var(--amber)' : undefined }}>
          {kib(totalBytes)} of the {kib(capBytes)} attachment budget used{capHit ? ' — budget reached' : ''}
        </div>
      )}
      {notes?.map((n, i) => <div key={i} className="dim" style={{ font: '400 10px var(--mono)', color: 'var(--amber)' }}>⚠ {n}</div>)}
      {overflow?.length > 0 && (
        <div className="dim" style={{ font: '400 10px var(--mono)' }}>not attached: {overflow.map(c => c.label).join(', ')}</div>
      )}
      {rejected?.map((r, i) => <div key={'r' + i} className="dim" style={{ font: '400 10px var(--mono)', color: 'var(--amber)' }}>⚠ {r.reason}</div>)}
      {tabNotice && (
        <div className="dim" style={{ font: '400 10px var(--mono)' }}>
          {tabNotice} <button className="mini" style={{ marginTop: 0 }} onClick={onDismissNotice}>ok</button>
        </div>
      )}
    </div>
  )
}
