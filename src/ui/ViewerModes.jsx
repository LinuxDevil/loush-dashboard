// src/ui/ViewerModes.jsx — feature 073: the Source / Preview / Diff segmented control, plus the Diff
// pane itself.
//
// Diff is a MODE of the file you are already looking at, not a separate screen: same header, same
// selection, same scroll container. Flipping to Diff and back must not lose your place in the file.
//
// The rule that makes this control honest: an unavailable mode is a DISABLED button carrying its reason
// in `title` (and in an aria-label, so it is not mouse-only). It is never hidden — hiding it makes the
// feature look absent — and it never silently falls back to Source, which makes the toggle look broken.

import React, { useMemo } from 'react'
import { modeAvailability, resolveMode } from '../lib/viewerModes.js'
import { computeLineDiff, summariseDiff } from '../lib/lineDiff.js'

const seg = {
  wrap: { display: 'inline-flex', border: '1px solid var(--border-default)', borderRadius: 7, overflow: 'hidden' },
  btn: on => ({
    height: 'auto', margin: 0, padding: '3px 11px', border: 'none', borderRadius: 0,
    borderRight: '1px solid var(--border-default)',
    font: `${on ? 600 : 500} 11px var(--body)`,
    background: on ? 'var(--bg-surface-active)' : 'transparent',
    color: on ? 'var(--text-primary)' : 'var(--text-secondary)',
  }),
}

/**
 * @param {{file:object, mode:string, onMode:function, extraNote?:string}} props
 *   `file` is `{ext, name, size, isBinary, hasBaseline, dirty}` — see lib/viewerModes.js.
 */
export function ViewerModeToggle({ file, mode, onMode, availability }) {
  const av = availability || modeAvailability(file)
  const resolved = resolveMode(mode, av)
  return (
    <div>
      <div style={seg.wrap} role="group" aria-label="view mode">
        {av.modes.map((m, i) => {
          const on = resolved.mode === m.id
          const why = m.available ? (m.warning || undefined) : m.reason
          return (
            <button
              key={m.id}
              type="button"
              disabled={!m.available}
              aria-disabled={!m.available}
              aria-label={m.available ? m.label : `${m.label} — unavailable: ${m.reason}`}
              title={why}
              style={{ ...seg.btn(on), borderRight: i === av.modes.length - 1 ? 'none' : seg.btn(on).borderRight, opacity: m.available ? 1 : 0.45, cursor: m.available ? 'pointer' : 'not-allowed' }}
              onClick={() => m.available && onMode(m.id)}
            >
              {m.label}{!m.available && ' ⃠'}{m.available && m.warning ? ' ⚠' : ''}
            </button>
          )
        })}
      </div>
      {/* A fallback the user did not ask for is stated out loud, not just applied. */}
      {resolved.changed && resolved.reason && (
        <div className="dim" style={{ font: '400 10px var(--mono)', marginTop: 4 }}>{resolved.reason}</div>
      )}
      {!resolved.changed && resolved.warning && (
        <div className="dim" style={{ font: '400 10px var(--mono)', marginTop: 4, color: 'var(--amber)' }}>⚠ {resolved.warning}</div>
      )}
    </div>
  )
}

const row = {
  add: { background: 'color-mix(in srgb, var(--green-solid) 14%, transparent)' },
  del: { background: 'color-mix(in srgb, var(--red) 14%, transparent)' },
  same: {},
}
const sign = { add: '+', del: '−', same: ' ' }

/**
 * The Diff pane. `before`/`after` may be null — that is a stated reason, not an empty diff, because an
 * empty diff means "no changes" and a missing baseline does not.
 */
export function DiffPane({ before, after, maxLines }) {
  const d = useMemo(() => computeLineDiff(before, after, { maxLines }), [before, after, maxLines])

  if (!d.hunks) return <p className="muted center" style={{ padding: 20 }}>{d.reason}</p>
  if (d.stats.added === 0 && d.stats.removed === 0)
    return <p className="muted center" style={{ padding: 20 }}>no changes — the buffer matches the saved file{d.truncated ? ` (compared the first ${d.truncated.limit} lines only)` : ''}</p>

  return (
    <div style={{ height: '100%', overflow: 'auto' }}>
      <div className="dim" style={{ font: '400 11px var(--mono)', padding: '6px 10px', borderBottom: '1px solid var(--border-subtle)', position: 'sticky', top: 0, background: 'var(--bg-surface)' }}>
        {summariseDiff(d)}
      </div>
      {/* Both caps are announced where the user is reading, not just recorded on the object. */}
      {d.truncated && (
        <div style={{ font: '400 11px var(--mono)', padding: '5px 10px', color: 'var(--amber)' }}>
          ⚠ compared the first {d.truncated.limit} lines only — the file has {Math.max(d.truncated.beforeTotal, d.truncated.afterTotal)}. Changes past that line are not shown.
        </div>
      )}
      {d.degraded && (
        <div style={{ font: '400 11px var(--mono)', padding: '5px 10px', color: 'var(--amber)' }}>⚠ {d.degraded.reason}</div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', font: '400 12px var(--mono)' }}>
        <tbody>
          {d.hunks.map((h, i) => (
            <tr key={i} style={row[h.type]}>
              <td style={{ width: 44, textAlign: 'right', padding: '0 6px', color: 'var(--text-tertiary)', userSelect: 'none' }}>{h.beforeLine ?? ''}</td>
              <td style={{ width: 44, textAlign: 'right', padding: '0 6px', color: 'var(--text-tertiary)', userSelect: 'none' }}>{h.afterLine ?? ''}</td>
              <td style={{ width: 14, color: 'var(--text-tertiary)', userSelect: 'none' }}>{sign[h.type]}</td>
              <td style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', padding: '0 8px 0 0' }}>{h.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default ViewerModeToggle
