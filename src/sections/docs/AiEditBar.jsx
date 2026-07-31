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
//
// When the bar is disabled it says WHY in the same place the scope would be. A control that is greyed
// out with no reason reads as broken, and the reason here — unsaved changes — is one the user can act
// on in a single click.
export default function AiEditBar({ instruction, onInstruction, selection, busy, disabled, reason, onRun }) {
  const scope = selection ? `selection (${selection.length} chars)` : 'whole document'
  const note = disabled && reason ? reason : scope
  return (
    <div className="docs-ai-bar">
      <input
        placeholder="ask for an edit — e.g. tighten this paragraph, convert to a table…"
        value={instruction}
        disabled={disabled || busy}
        onChange={e => onInstruction(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && instruction.trim() && !busy && !disabled) onRun() }}
      />
      <span className="docs-ai-scope">{note}</span>
      <button className="mini" title={disabled ? reason || '' : ''}
        disabled={disabled || busy || !instruction.trim()} onClick={onRun}>
        {busy ? 'thinking…' : 'AI edit'}
      </button>
    </div>
  )
}
