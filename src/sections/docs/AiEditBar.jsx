import React from 'react'

// The AI edit control. This file is AGPL-3.0-only and is derived in part from Odysseus
// (https://github.com/odysseus-dev/odysseus), Copyright (c) the Odysseus contributors, AGPL-3.0 —
// see NOTICE, clause 1. Consulted `static/js/document.js` for the shape of this interaction: an
// instruction typed against the current selection, the model's answer returned for review.
// Modified 2026-07-31 (AGPL §5(a)): upstream collects the instruction with `window.prompt` and
// applies the answer straight to the buffer; here the scope is shown before the run and the answer
// goes through an accept/reject diff. Stated in full rather than deferring to DocsSection.jsx's
// header, because a notice that only exists in another file travels badly when this one is copied.
//
// The scope is stated on the button, never inferred silently: with a selection it says how much text
// it will send, and with none it says the whole document. "AI edit" on its own would leave the user
// guessing which one they just authorised.
export default function AiEditBar({ instruction, onInstruction, selection, busy, disabled, onRun }) {
  const scope = selection ? `selection (${selection.length} chars)` : 'whole document'
  return (
    <div className="docs-ai-bar">
      <input
        placeholder="ask for an edit — e.g. tighten this paragraph, convert to a table…"
        value={instruction}
        disabled={disabled || busy}
        onChange={e => onInstruction(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && instruction.trim() && !busy) onRun() }}
      />
      <span className="docs-ai-scope">{scope}</span>
      <button className="mini" disabled={disabled || busy || !instruction.trim()} onClick={onRun}>
        {busy ? 'thinking…' : 'AI edit'}
      </button>
    </div>
  )
}
